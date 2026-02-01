import { v4 as uuidv4 } from 'uuid';
import { BookRoomOperation, CancelRoomOperation, type Operation } from "./operation.js";
import { State } from "./state.js";
import { NetworkLayer } from "./network_layer.js";
import { AbstractNetworkManager, NetworkManager } from "./network_manager.js";
import { Node } from "./node.js";
import type {
    AssignOperationMsg,
    LeaderAnnounceMsg,
    NodeId,
    ProposeOperationMsg,
    ProtocolMessage,
    ResendRequestMsg,
    VoteResponseMsg
} from "./messages.js";
import { Room } from "./room.js";
import { Booking, BookingStatus } from "./booking.js";


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

    private readonly queuedOperations: Operation[] = [];

    private electionTimer: ReturnType<typeof setTimeout> | null = null;
    private voteTimer: ReturnType<typeof setTimeout> | null = null;
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
            this.queuedOperations.push(operation);
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
        if (!this.leaderId) this.startElection("startup");
    }

    // receive loop that filters out false messages and acts according to the message kind
    public onDeliver(msg: ProtocolMessage): void {
        // Ignore messages which are not directed to us
        if ("to" in msg && msg.to !== this.self.id) return;

        // Epoch handling: ignore stale, adopt newer
        if (msg.epoch < this.currentEpoch) return;
        if (msg.epoch > this.currentEpoch) this.adoptNewEpoch(msg.epoch);

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
            case "PING":
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
        if (this.electionTimer) clearTimeout(this.electionTimer);
        if (this.voteTimer) clearTimeout(this.voteTimer);
        this.electionTimer = null;
        this.voteTimer = null;
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
    };

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
                    return;
                case "CANCEL_ROOM":
                    this.applyCancel(op as CancelRoomOperation);
                    return;
            }
        }
    }

    private applyBooking(op: BookRoomOperation) {
        const oper = op as BookRoomOperation;
        const room = Room.findRoom(oper.room.name);

        if (!room) {
            console.log("Room does not exist: " + oper.room.name);
            return;
        }

        const booking = new Booking(room, oper.time, oper.user, BookingStatus.BOOKED, oper.id);
        room.bookings.push(booking);
        console.log("Room successfully booked: " + room.name);
    }

    private applyCancel(op: CancelRoomOperation) {
        const oper = op as CancelRoomOperation;

        for (const room of Object.values(Room.rooms)) {
            const booking = room.bookings.find((b) => b.id === oper.id);
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
        }, 600);
    }

    // accept election with "Ok" if our id is higher than elected and start a new election.
    private onElection(fromId: string): void {
        if (fromId < this.self.id) {
            void this.networkLayer.multicast({
                id: uuidv4(),
                kind: "OK",
                from: this.self.id,
                to: fromId,
                epoch: this.currentEpoch
            });
            this.startElection("manual");
        }
    }

    // reset election timer on OK (ack) --> someone has higher id and started new election
    private onOk(_fromId: string): void {
        if (this.electionTimer) {
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
            kind: "VOTE_REQUEST", id: uuidv4(),
            from: this.self.id,
            epoch: this.currentEpoch
        });

        this.voteTimer = setTimeout(() => {
            this.tryFinalizeLeadership();
        }, 600);
    }

    // respond with last delivered sequence and last operation
    private onVoteRequest(fromId: string): void {
        const lastDeliveredSeq = this.nextSeqToDeliver - 1;
        const lastOp = lastDeliveredSeq >= 0 ? (this.logBySeq.get(lastDeliveredSeq) ?? null) : null;

        void this.networkLayer.multicast({
            kind: "VOTE_RESPONSE", id: uuidv4(),
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

        for (const r of this.voteResponses.values()) {
            if (r.lastDeliveredSeq > maxLastDelivered) maxLastDelivered = r.lastDeliveredSeq;
        }

        const startSeq = maxLastDelivered + 1;

        const announce: LeaderAnnounceMsg = {
            kind: "LEADER_ANNOUNCE", id: uuidv4(),
            from: this.self.id,
            epoch: this.currentEpoch,
            leaderId: this.self.id,
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
        this.currentEpoch = msg.epoch;
        this.leaderId = msg.leaderId;
        this.mode = msg.leaderId === this.self.id ? "LEADER" : "FOLLOWER";
        this.clearTimers();

        if (this.mode === "LEADER") {
            this.nextSeqToAssign = msg.startSeq;
        }

        if (this.mode === "FOLLOWER") {
            const queued = this.queuedProposals.splice(0, this.queuedProposals.length);

            const leader = this.leaderId;
            if (!leader) return;

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
