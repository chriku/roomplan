import { Node } from "./node.js";
import type { ProtocolMessage, AckMsg, NodeId } from "./messages.js";
import { v4 as uuidv4 } from 'uuid';
import type { Network } from "node:inspector/promises";
import { NetworkLayer } from "./network_layer.js";
import { OperationManager } from "./operation_manager.js";

export abstract class AbstractNetworkManager {
    static singleton: AbstractNetworkManager | null = null;

    abstract get knownNodes(): Node[];
    abstract get activeNodes(): Node[];
    abstract get selfNode(): Node;
    public abstract handleIncoming(incomingMsg: ProtocolMessage): void;
}


interface MessageTracker {
    msg: ProtocolMessage;
    pendingAcks: Set<NodeId>;
    retryTimers: Map<NodeId, NodeJS.Timeout>;
}

export class NetworkManager extends AbstractNetworkManager {
    private messageState = new Map<string, MessageTracker>();
    private deliveredToApp = new Set<string>();
    private lastSeen = new Map<NodeId, number>();

    private _knownNodes: Node[] = [];
    private _activeNodes: Node[] = [];

    get knownNodes(): Node[] {
        return this._knownNodes;
    }

    get activeNodes(): Node[] {
        return this._knownNodes; // TODO: Remove when state tracking
        return this._activeNodes;
    }

    get selfNode(): Node {
        return this.knownNodes.filter((it) => it.id == this.myNodeId)[0];
    }

    //TODO Add view of active nodes and node 
    constructor(
        private myNodeId: NodeId,
        private senderInstance: NetworkLayer,
    ) {
        super();
        this._knownNodes.push(new Node(myNodeId));
        console.log(`Start operation as ${myNodeId}`)
        this.startHeartbeatLoops();
        this.startHeartbeatLoops()
    }

    private startHeartbeatLoops() {
        setInterval(() => {
            this.broadcastReliably({ 
                id: uuidv4(), 
                kind: "PING", 
                from: this.myNodeId, 
                epoch: null 
            });
        }, 2000);


        setInterval(() => {
            this.checkNodeHealth();
        }, 1000);
    }

    private checkNodeHealth() {
        const now = Date.now();
        const timeout = 7000; 

        const previouslyActiveCount = this._activeNodes.length;


        this._activeNodes = this._knownNodes.filter(node => {
            if (node.id === this.myNodeId) return true; 
            
            const lastContact = this.lastSeen.get(node.id) || 0;
            return (now - lastContact) < timeout;
        });

        if (this._activeNodes.length !== previouslyActiveCount) {
            console.log(`View Change: ${this._activeNodes.length} Nodes active.`);
            //TODO View changes application should be notified, stop processing requests sync elect new leader and resume operation
        }
    }



    public broadcastReliably(msg: ProtocolMessage) {
        this.startTracking(msg);
        this.senderInstance.multicast(msg);
    }

    private ensureNode(nodeId: string): Node {
        const node = this._knownNodes.find((it) => it.id == nodeId);
        if (node != null) return node;
        const n = new Node(nodeId);
        console.log(`Heard of therefore unknown node: ${nodeId}`)
        this._knownNodes.push(n);
        return n;
    }

    public handleIncoming(incomingMsg: ProtocolMessage) {
        this.ensureNode(incomingMsg.from);
        this.markNodeAsAlive(incomingMsg.from);
        if (incomingMsg.kind === "ACK") {
            if (incomingMsg.from !== this.myNodeId)
                this.processAck(incomingMsg as AckMsg);
            return;
        }
        if (incomingMsg.kind === "PING") {
            return;
        }

        if (!this.messageState.has(incomingMsg.id)) {
            this.startTracking(incomingMsg);
        }
        this.sendAck(incomingMsg);
    }

    private markNodeAsAlive(nodeId: NodeId) {
        this.lastSeen.set(nodeId, Date.now());
        
        const isActive = this._activeNodes.some(n => n.id === nodeId);
        if (!isActive) {
            const node = this.ensureNode(nodeId);
            this._activeNodes.push(node);
            console.log(`Node ${nodeId} is back online!`);
        }
    }

    private startTracking(msg: ProtocolMessage) {
        if (this.messageState.has(msg.id)) return;

        const otherNodes = this._activeNodes.map(node => node.id)
            .filter(id => id !== this.myNodeId);

        const tracker: MessageTracker = {
            msg: msg,
            pendingAcks: new Set(otherNodes),
            retryTimers: new Map()
        };

        this.messageState.set(msg.id, tracker);

        if (otherNodes.length === 0) {
            this.finalizeMessage(msg);
            return;
        }

        otherNodes.forEach(nodeId => this.scheduleRetry(msg.id, nodeId));
    }

    private processAck(ack: AckMsg) {
        const tracker = this.messageState.get(ack.ackFor);
        if (!tracker || !tracker.pendingAcks.has(ack.from)) return;

        const timer = tracker.retryTimers.get(ack.from);
        if (timer) {
            clearTimeout(timer);
            tracker.retryTimers.delete(ack.from);
        }

        tracker.pendingAcks.delete(ack.from);

        if (tracker.pendingAcks.size === 0) {
            this.finalizeMessage(tracker.msg);
        }
    }

    private finalizeMessage(msg: ProtocolMessage) {
        if (!this.deliveredToApp.has(msg.id)) {
            this.deliveredToApp.add(msg.id);

            OperationManager.singleton?.onDeliver(msg);

            this.messageState.delete(msg.id);
            setTimeout(() => this.deliveredToApp.delete(msg.id), 60000);
        }
    }

    private sendAck(originalMsg: ProtocolMessage) {
        const ack: AckMsg = {
            id: uuidv4(),
            kind: "ACK",
            from: this.myNodeId,
            epoch: originalMsg.epoch,
            ackFor: originalMsg.id
        };
        this.senderInstance.multicast(ack);
    }

    private scheduleRetry(msgId: string, nodeId: NodeId) {
        const timer = setTimeout(() => {
            const tracker = this.messageState.get(msgId);
            const isStillActive = this._activeNodes.some(n => n.id === nodeId);
            if (tracker && tracker.pendingAcks.has(nodeId)) {
                if (isStillActive) {
                    console.log(`[Retry] Message ${msgId} -> Node ${nodeId}`);
                    this.senderInstance.multicast(tracker.msg);
                    this.scheduleRetry(msgId, nodeId);

                } else {
                    console.log(`[Abort] Node ${nodeId} not active anymore. Stop Retries for ${msgId}`);
                    this.processAck({
                        kind: "ACK",
                        from: nodeId,
                        ackFor: msgId,
                        id: 'internal',
                        epoch: 0
                    } as AckMsg);
                }
            }
        }, 3000);

        this.messageState.get(msgId)?.retryTimers.set(nodeId, timer);
    }
}