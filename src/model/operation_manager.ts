import type { Operation } from "./operation.js";
import { State } from "./state.js";
import { NetworkLayer } from "./network_layer.js";
import { NetworkManager } from "./network_manager.js";
import { Node } from "./node.js";
import type {
    AssignOperationMsg,
    LeaderAnnounceMsg,
    NodeId,
    ProposeOperationMsg,
    ProtocolMessage,
    VoteResponseMsg
} from "./messages.js";



export class OperationManager extends State {
    public static singleton: OperationManager | null = null;

    private readonly self: Node;
    private readonly networkLayer: NetworkLayer;
    private readonly networkManager: NetworkManager;

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
            kind: "PROPOSE_OP",
            from: this.self.id,
            epoch: this.currentEpoch,
            op: operation
        };

        void this.networkLayer.multicast(msg);
        return "FORWARDED_TO_LEADER";
    }

    currentLeader(): Node | null {
        if (!this.leaderId) return null;
        return this.networkManager.knownNodes.find((node) => node.id === this.leaderId) ?? null;
    }

    private async sendToNode(toId: NodeId, msg: ProtocolMessage): Promise<void> {
        //TODO unicast message
    }

    private async sendToMany(toIds: NodeId[], msgFactory: () => ProtocolMessage): Promise<void> {
        for (const toId of toIds) {
            await this.sendToNode(toId, msgFactory());
        }
    }

    start(): void {
        void this.receiveLoop();
        if (!this.leaderId) this.startElection("startup");
    }

    private async receiveLoop(): Promise<void> {
        while (true) {
            const msg = (await this.networkLayer.receive()) as ProtocolMessage;

            // Epoch handling: ignore stale, adopt newer
            if (msg.epoch < this.currentEpoch) continue;
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
                    // TODO if leader, resend; if follower ignore
                    break;
                case "PING":
                case "ACK":
                    // optional FD integration
                    break;
                default:
                    void msg;
            }
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

        this.pendingBySeq.set(msg.seq, msg.op);
        this.tryDeliverInOrder();
    }

    private tryDeliverInOrder(): void {
        while (this.pendingBySeq.has(this.nextSeqToDeliver)) {
            const op = this.pendingBySeq.get(this.nextSeqToDeliver)!;
            this.pendingBySeq.delete(this.nextSeqToDeliver);

            this.deliveredOpIds.add(op.id);
            this.logBySeq.set(this.nextSeqToDeliver, op);

            // TODO: apply to state (rooms/bookings)

            this.nextSeqToDeliver++;
        }
    }

    // --- Election (bully) + vote validation ---
    private startElection(reason: "startup" | "leader_suspected" | "manual"): void {
        this.mode = "CANDIDATE";
        this.clearTimers();

        const higher = this.networkManager.activeNodes.filter((n) => n.id > this.self.id);
        const electionEpoch = this.currentEpoch + 1;

        void this.sendToMany(
            higher.map((n) => n.id),
            () => ({ kind: "ELECTION", from: this.self.id, epoch: electionEpoch })
        );

        this.electionTimer = setTimeout(() => {
            this.becomeCandidateLeader(electionEpoch);
        }, 600);
    }

    private onElection(fromId: string): void {
        if (fromId < this.self.id) {
            void this.sendToNode(fromId, { kind: "OK", from: this.self.id, epoch: this.currentEpoch });
            this.startElection("manual");
        }
    }

    private onOk(_fromId: string): void {
        if (this.electionTimer) {
            clearTimeout(this.electionTimer);
            this.electionTimer = null;
        }
    }

    private becomeCandidateLeader(epoch: number): void {
        this.currentEpoch = epoch;
        this.mode = "CANDIDATE";
        this.leaderId = null;
        this.voteResponses.clear();

        const peers = this.networkManager.activeNodes.filter((n) => n.id !== this.self.id).map((n) => n.id);

        void this.sendToMany(peers, () => ({
            kind: "VOTE_REQUEST",
            from: this.self.id,
            epoch: this.currentEpoch
        }));

        this.voteTimer = setTimeout(() => {
            this.tryFinalizeLeadership();
        }, 600);
    }

    private onVoteRequest(fromId: string): void {
        const lastDeliveredSeq = this.nextSeqToDeliver - 1;
        const lastOp = lastDeliveredSeq >= 0 ? (this.logBySeq.get(lastDeliveredSeq) ?? null) : null;

        const resp: VoteResponseMsg = {
            kind: "VOTE_RESPONSE",
            from: this.self.id,
            epoch: this.currentEpoch,
            lastDeliveredSeq,
            lastDeliveredOpId: lastOp?.id ?? null
        };

        void this.sendToNode(fromId, resp);
    }

    private onVoteResponse(msg: VoteResponseMsg): void {
        if (this.mode !== "CANDIDATE") return;
        this.voteResponses.set(msg.from, msg);
    }

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
            kind: "LEADER_ANNOUNCE",
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
                const p: ProposeOperationMsg = {
                    kind: "PROPOSE_OP",
                    from: this.self.id,
                    epoch: this.currentEpoch,
                    op
                };
                void this.sendToNode(leader, p);
            }
        }
    }
}