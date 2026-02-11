import { v4 as uuidv4 } from 'uuid';
import { BookRoomOperation, CancelRoomOperation, type Operation } from "./operation.js";
import { State } from "./state.js";
import { NetworkLayer } from "./network_layer.js";
import { AbstractNetworkManager, NetworkManager } from "./network_manager.js";
import { Node } from "./node.js";
import type {
    AssignOperationMsg, CatchUpMsg, CatchUpResponse,
    LeaderAnnounceMsg,
    LogRequestMsg,
    LogResponseMsg,
    NodeId,
    ProposeOperationMsg,
    ProtocolMessage,
    ResendRequestMsg,
    VoteResponseMsg
} from "./messages.js";
import { Room } from "./room.js";
import { Booking, BookingStatus } from "./booking.js";
import { User } from './user.js';
import { DateRange } from "./date_range.js";


export class OperationManager extends State {
    public static singleton: OperationManager | null = null;

    private readonly self: Node;
    private readonly networkLayer: NetworkLayer;
    private readonly networkManager: AbstractNetworkManager;

    private readonly deliveredOpIds = new Set<string>();
    private readonly pendingBySeq = new Map<number, Operation>();
    private readonly logBySeq = new Map<number, Operation>();
    private readonly queuedProposals: Operation[] = [];

    private currentEpoch = 0;
    private nextSeqToAssign = 0;
    private nextSeqToDeliver = 0;

    private leaderId: NodeId | null = null;
    private mode: "FOLLOWER" | "LEADER" | "CANDIDATE" = "FOLLOWER";

    private pendingLeadership: {
        epoch: number;
        startSeq: number;
        requiredUpTo: number;
        donorId: NodeId;
    } | null = null;

    private electionTimer: ReturnType<typeof setTimeout> | null = null;
    private voteTimer: ReturnType<typeof setTimeout> | null = null;
    private discoverLeaderTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly voteResponses = new Map<string, VoteResponseMsg>();

    constructor(self: Node) {
        super();
        this.self = self;

        const networkManager = NetworkManager.singleton;
        if (networkManager == null) throw Error("NetworkManager not initialized");
        const networkLayer = NetworkLayer.singleton;
        if (networkLayer == null) throw Error("NetworkLayer not initialized");

        this.networkLayer = networkLayer;
        this.networkManager = networkManager;
    }

    // propose operation from user point - handles leader election. Returns outcome
    proposeOperation(operation: Operation): string {
        operation.causedBy = this.self;

        if (!this.leaderId || (this.mode !== "LEADER" && this.mode !== "FOLLOWER")) {
            this.queuedProposals.push(operation);
            return "QUEUED_NO_LEADER";
        }

        if (this.mode === "LEADER") {
            void this.assignAndMulticast(operation);
            return "PROPOSED_AS_LEADER";
        }

        const msg: ProposeOperationMsg = {
            id: uuidv4(),
            kind: "PROPOSE_OP",
            from: this.self.id,
            epoch: this.currentEpoch,
            op: operation
        };

        void this.networkLayer.multicast(msg);
        return "FORWARDED_TO_LEADER";
    }

    // return the current leader
    currentLeader(): Node | null {
        if (!this.leaderId) return null;
        return this.networkManager.knownNodes.find((node) => node.id === this.leaderId) ?? null;
    }

    start(): void {
        this.catchUp();

        this.discoverLeaderTimer = setTimeout(() => {
            if (!this.leaderId) this.startElection("startup");
        }, 3000);
    }

    // receive loop that filters out false messages and acts according to the message kind
    public onDeliver(msg: ProtocolMessage): void {
        console.log(`onDeliver ${JSON.stringify(msg)} while in ${this.currentEpoch}`);

        // Ignore messages which are not directed to us
        if ("to" in msg && msg.to !== this.self.id) return;

        if (msg.from !== this.self.id) {
            // Epoch handling: ignore stale, adopt newer
            if (msg.epoch != null && msg.epoch < this.currentEpoch) {
                if (
                    msg.kind == "ELECTION" ||
                    msg.kind == "LEADER_ANNOUNCE" ||
                    msg.kind == "VOTE_REQUEST" ||
                    msg.kind == "VOTE_RESPONSE"
                ) {
                    console.log(`Kill Election due to ${msg.epoch}<${this.currentEpoch}`);
                    this.killElection();
                }
                return;
            }
            if (msg.epoch != null && msg.epoch > this.currentEpoch) this.adoptNewEpoch(msg.epoch!);
        }
        switch (msg.kind) {
            case "ELECTION":
                this.onElection(msg.from);
                break;
            case "OK":
                this.onOk(msg.from);
                break;
            case "VOTE_REQUEST":
                this.onVoteRequest(msg.from);
                break;
            case "VOTE_RESPONSE":
                this.onVoteResponse(msg);
                break;
            case "LEADER_ANNOUNCE":
                this.onLeaderAnnounce(msg);
                break;
            case "PROPOSE_OP":
                this.onProposeOp(msg);
                break;
            case "ASSIGN_OP":
                this.onAssignOp(msg);
                break;
            case "RESEND_REQUEST":
                this.onResendRequest(msg);
                break;
            case "CATCH_UP":
                this.onCatchUp(msg);
                break;
            case "CATCH_UP_RESPONSE":
                this.onCatchUpResponse(msg);
                break;
            case "LOG_REQUEST":
                this.onLogRequest(msg);
                break;
            case "LOG_RESPONSE":
                this.onLogResponse(msg);
                break;
            case "ACK":
                // optional FD integration
                break;
            default:
                void msg;
        }
    }

    private adoptNewEpoch(epoch: number): void {
        this.currentEpoch = epoch;
        this.mode = "FOLLOWER";
        this.leaderId = null;
        this.voteResponses.clear();
        this.clearTimers();
    }

    private clearTimers(): void {
        if (this.electionTimer != null) clearTimeout(this.electionTimer);
        if (this.voteTimer != null) clearTimeout(this.voteTimer);
        if (this.discoverLeaderTimer) clearTimeout(this.discoverLeaderTimer);
        this.electionTimer = null;
        this.voteTimer = null;
    }

    private requestLogFrom(nodeId: NodeId, fromSeq: number, toSeq: number): void {
        if (fromSeq > toSeq) return;
        const req: LogRequestMsg = {
            id: uuidv4(),
            kind: "LOG_REQUEST",
            from: this.self.id,
            to: nodeId,
            epoch: this.currentEpoch,
            fromSeq,
            toSeq
        };
        void this.networkLayer.multicast(req);
    }

    // --- Sequencer (leader) ---
    private async assignAndMulticast(op: Operation): Promise<void> {
        const seq = this.nextSeqToAssign++;
        op.sequenceNumber = seq;

        const msg: AssignOperationMsg = {
            id: uuidv4(),
            kind: "ASSIGN_OP",
            from: this.self.id,
            leaderId: this.self.id,
            epoch: this.currentEpoch,
            seq,
            op
        };

        this.onAssignOp(msg);
        await this.networkLayer.multicast(msg);
    }

    //Propose operation from another node
    private onProposeOp(msg: ProposeOperationMsg): void {
        if (this.mode !== "LEADER") return;
        void this.assignAndMulticast(msg.op);
    }

    //assign operation
    private onAssignOp(msg: AssignOperationMsg): void {
        if (!this.leaderId) return;
        if (msg.leaderId !== this.leaderId) return;
        if (msg.from !== this.leaderId) return;
        if (this.deliveredOpIds.has(msg.op.id)) return;
        if (this.pendingBySeq.has(msg.seq)) return;

        if (msg.seq > this.nextSeqToDeliver) {
            void this.networkLayer.multicast({
                id: uuidv4(),
                kind: "RESEND_REQUEST",
                from: this.self.id,
                epoch: this.currentEpoch,
                leaderId: this.leaderId,
                fromSeq: this.nextSeqToDeliver,
                toSeq: msg.seq - 1
            });
        }

        this.pendingBySeq.set(msg.seq, msg.op);
        this.tryDeliverInOrder();
    }

    private onResendRequest(msg: ResendRequestMsg): void {
        if (this.mode !== "LEADER") return;
        if (msg.leaderId !== this.self.id) return;

        for (let seq = msg.fromSeq; seq <= msg.toSeq; seq++) {
            const op = this.logBySeq.get(seq);
            if (!op) continue;

            void this.networkLayer.multicast({
                id: uuidv4(),
                kind: "ASSIGN_OP",
                from: this.self.id,
                leaderId: this.self.id,
                epoch: this.currentEpoch,
                seq,
                op
            });
        }
    }

    private catchUp(): void {
        void this.networkLayer.multicast({
            id: uuidv4(),
            kind: "CATCH_UP",
            from: this.self.id,
            epoch: this.currentEpoch
        });
        console.log("");
    }

    private onCatchUp(msg: CatchUpMsg): void {
        if (this.mode !== "LEADER") return;

        const lastSeq = this.nextSeqToAssign - 1;

        void this.networkLayer.multicast({
            id: uuidv4(),
            kind: "CATCH_UP_RESPONSE",
            from: this.self.id,
            to: msg.from,
            epoch: this.currentEpoch,
            leaderId: this.self.id,
            lastSeq,
            nextSeqToAssign: this.nextSeqToAssign
        });
    }

    private onCatchUpResponse(msg: CatchUpResponse): void {
        if (msg.to !== this.self.id) return;

        this.currentEpoch = msg.epoch ?? this.currentEpoch;
        this.leaderId = msg.leaderId;
        this.mode = msg.leaderId === this.self.id ? "LEADER" : "FOLLOWER";
        this.clearTimers();

        if (this.mode === "LEADER") {
            this.nextSeqToAssign = Math.max(this.nextSeqToAssign, msg.nextSeqToAssign);
            return;
        }

        const haveLast = this.nextSeqToDeliver - 1;
        const needUpTo = msg.lastSeq;

        if (needUpTo > haveLast && this.leaderId) {
            void this.networkLayer.multicast({
                id: uuidv4(),
                kind: "RESEND_REQUEST",
                from: this.self.id,
                epoch: this.currentEpoch,
                leaderId: this.leaderId,
                fromSeq: haveLast + 1,
                toSeq: needUpTo
            });
        }
    }

    private onLogRequest(msg: LogRequestMsg): void {
        if (msg.to !== this.self.id) return;

        const entries: { seq: number; op: Operation }[] = [];
        for (let seq = msg.fromSeq; seq <= msg.toSeq; seq++) {
            const op = this.logBySeq.get(seq);
            if (op) entries.push({ seq, op });
        }

        const res: LogResponseMsg = {
            id: uuidv4(),
            kind: "LOG_RESPONSE",
            from: this.self.id,
            to: msg.from,
            epoch: this.currentEpoch,
            entries
        };

        void this.networkLayer.multicast(res);
    }

    private onLogResponse(msg: LogResponseMsg): void {
        if (msg.to !== this.self.id) return;

        for (const entry of msg.entries) {
            if (this.deliveredOpIds.has(entry.op.id)) continue;
            if (this.pendingBySeq.has(entry.seq)) continue;
            if (entry.seq < this.nextSeqToDeliver) continue;
            this.pendingBySeq.set(entry.seq, entry.op);
        }

        this.tryDeliverInOrder();

        if (this.pendingLeadership) {
            const haveLast = this.nextSeqToDeliver - 1;
            if (haveLast >= this.pendingLeadership.requiredUpTo) {
                this.finalizeLeadershipAnnounce(this.pendingLeadership.startSeq);
                this.pendingLeadership = null;
            } else {
                this.requestLogFrom(
                    this.pendingLeadership.donorId,
                    haveLast + 1,
                    this.pendingLeadership.requiredUpTo
                );
            }
        }
    }

    private tryDeliverInOrder(): void {
        while (this.pendingBySeq.has(this.nextSeqToDeliver)) {
            const op = this.pendingBySeq.get(this.nextSeqToDeliver)!;
            this.pendingBySeq.delete(this.nextSeqToDeliver);

            this.deliveredOpIds.add(op.id);
            this.logBySeq.set(this.nextSeqToDeliver, op);

            this.nextSeqToDeliver++;

            switch (op.kind) {
                case "BOOK_ROOM":
                    this.applyBooking(op as BookRoomOperation);
                    break;
                case "CANCEL_ROOM":
                    this.applyCancel(op as CancelRoomOperation);
                    break;
            }
        }
    }

    private applyBooking(op: BookRoomOperation) {
        const oper = op as BookRoomOperation;
        const room = Room.findRoom(oper.room);
        const user = User.findUser(oper.user)
        const time = DateRange.hydrate(oper.time); // hydrate object

        if (!room) {
            console.log("Room does not exist: " + oper.room);
            return;
        }
        if (!user) {
            console.log("User does not exist: " + oper.user);
            return;
        }

        if (room.hasOverlappingBooking(time)) {
            console.log(`Booking rejected (room already booked): ${room.name} from ${oper.time.startTime} to ${oper.time.endTime}`);
            return;
        }

        const booking = new Booking(room, time, user, BookingStatus.BOOKED, oper.id);
        room.bookings.push(booking);
        console.log("Room successfully booked: " + room.name);
    }

    private applyCancel(op: CancelRoomOperation) {
        const oper = op as CancelRoomOperation;

        for (const room of Object.values(Room.rooms)) {
            const booking = room.bookings.find((b) => b.id === oper.booking.id);
            if (booking) {
                booking.status = BookingStatus.CANCELLED;
                return;
            } else {
                console.log("Room does not exist: " + oper.booking.room.name);
            }
        }
    }

    // --- Election (bully) + vote validation ---
    private startElection(reason: "startup" | "leader_suspected" | "manual"): void {
        this.mode = "CANDIDATE";
        this.clearTimers();

        console.log("Starting election for: " + reason);

        const electionEpoch = this.currentEpoch + 1;

        this.networkLayer.multicast({
            id: uuidv4(),
            kind: "ELECTION",
            from: this.self.id,
            epoch: electionEpoch
        });

        this.electionTimer = setTimeout(() => {
            this.becomeCandidateLeader(electionEpoch);
        }, 3000);
    }

    // accept election with "Ok" if our id is higher than elected and start a new election.
    private onElection(fromId: string): void {
        if (fromId < this.self.id) {
            this.networkLayer.multicast({
                id: uuidv4(),
                kind: "OK",
                from: this.self.id,
                to: fromId,
                epoch: this.currentEpoch
            });
            this.currentEpoch = this.currentEpoch + 1; //TODO: Check if this increment is valid
            this.startElection("manual");
        }
    }

cookie={};

    public killElection(): void {
        this.clearTimers();
if(this.mode != "CANDIDATE"){
        this.networkLayer.multicast({
            id: uuidv4(),
            kind: "OK",
            from: this.self.id,
            to: null,
            epoch: this.currentEpoch
        });
        // this.currentEpoch = this.currentEpoch + 1; //TODO: Check if this increment is valid
let c={};
this.cookie=c;
setTimeout(()=>{
if(c==this.cookie){
        this.startElection("manual");
}
},Math.random()*1000);
}
    }

    // reset election timer on OK (ack) --> someone has higher id and started new election
    private onOk(_fromId: string): void {
        if (this.electionTimer != null) {
            clearTimeout(this.electionTimer);
            this.electionTimer = null;
        }
    }

    // Candidate leader elected --> start finalizing election
    private becomeCandidateLeader(epoch: number): void {
        this.currentEpoch = epoch;
        this.mode = "CANDIDATE";
        this.leaderId = null;
        this.voteResponses.clear();

        void this.networkLayer.multicast({
            kind: "VOTE_REQUEST",
            id: uuidv4(),
            from: this.self.id,
            epoch: this.currentEpoch
        });

        this.voteTimer = setTimeout(() => {
            this.tryFinalizeLeadership();
        }, 3000);
    }

    // respond with last delivered sequence and last operation
    private onVoteRequest(fromId: string): void {
        const lastDeliveredSeq = this.nextSeqToDeliver - 1;
        const lastOp = lastDeliveredSeq >= 0 ? (this.logBySeq.get(lastDeliveredSeq) ?? null) : null;

        void this.networkLayer.multicast({
            kind: "VOTE_RESPONSE",
            id: uuidv4(),
            from: this.self.id,
            to: fromId,
            epoch: this.currentEpoch,
            lastDeliveredSeq,
            lastDeliveredOpId: lastOp?.id ?? null
        });
    }

    // count votes
    private onVoteResponse(msg: VoteResponseMsg): void {
        if (this.mode !== "CANDIDATE") return;
        if (msg.to !== this.self.id) return;
        this.voteResponses.set(msg.from, msg);
    }

    // finalize election if quorum reached --> start leader mode
    // if not, start new election after timeout
    private tryFinalizeLeadership(): void {
        if (this.mode !== "CANDIDATE") return;

        const active = this.networkManager.activeNodes;
        const quorum = Math.floor(active.length / 2) + 1;

        const responsesCount = this.voteResponses.size + 1;
        if (responsesCount < quorum) {
            this.startElection("manual");
            return;
        }

        let maxLastDelivered = this.nextSeqToDeliver - 1;
        let donorId: NodeId | null = null;

        for (const r of this.voteResponses.values()) {
            if (r.lastDeliveredSeq > maxLastDelivered) {
                maxLastDelivered = r.lastDeliveredSeq;
                donorId = r.from;
            }
        }

        const startSeq = maxLastDelivered + 1;

        const localLast = this.nextSeqToDeliver - 1;
        if (maxLastDelivered > localLast && donorId) {
            this.pendingLeadership = {
                epoch: this.currentEpoch,
                startSeq,
                requiredUpTo: maxLastDelivered,
                donorId
            };
            this.requestLogFrom(donorId, localLast + 1, maxLastDelivered);
            return;
        }

        this.finalizeLeadershipAnnounce(startSeq);
    }

    private finalizeLeadershipAnnounce(startSeq: number): void {
        const announce: LeaderAnnounceMsg = {
            kind: "LEADER_ANNOUNCE",
            id: uuidv4(),
            from: this.self.id,
            epoch: this.currentEpoch,
            leaderId: this.self.id,
            lastSeq: this.nextSeqToDeliver - 1,
            startSeq
        };

        this.mode = "LEADER";
        this.leaderId = this.self.id;
        this.nextSeqToAssign = startSeq;
        this.clearTimers();

        void this.networkLayer.multicast(announce);

        const queued = this.queuedProposals.splice(0, this.queuedProposals.length);
        for (const op of queued) void this.assignAndMulticast(op);
    }

    // set variables when leader is announced, when follower multicast proposed operation to all nodes
    private onLeaderAnnounce(msg: LeaderAnnounceMsg): void {
        if (msg.epoch != null) this.currentEpoch = msg.epoch;
        this.leaderId = msg.leaderId;
        this.mode = msg.leaderId === this.self.id ? "LEADER" : "FOLLOWER";
        this.clearTimers();

        console.log(`onLeaderAnnounce ${this.mode} `);
        if (this.mode === "LEADER") {
            this.nextSeqToAssign = msg.startSeq;
        }

        if (this.mode === "FOLLOWER") {
            const queued = this.queuedProposals.splice(0, this.queuedProposals.length);

            const leader = this.leaderId;
            if (!leader) return;

            const haveLast = this.nextSeqToDeliver - 1;
            if (msg.lastSeq > haveLast) {
                void this.networkLayer.multicast({
                    id: uuidv4(),
                    kind: "RESEND_REQUEST",
                    from: this.self.id,
                    epoch: this.currentEpoch,
                    leaderId: leader,
                    fromSeq: haveLast + 1,
                    toSeq: msg.lastSeq
                });
            }

            for (const op of queued) {
                this.networkLayer.multicast({
                    id: uuidv4(),
                    kind: "PROPOSE_OP",
                    from: this.self.id,
                    epoch: this.currentEpoch,
                    op
                });
            }
        }
    }
}
