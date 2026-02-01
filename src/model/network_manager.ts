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
}


interface MessageTracker {
    msg: ProtocolMessage;
    pendingAcks: Set<NodeId>;
    retryTimers: Map<NodeId, NodeJS.Timeout>;
}

export class NetworkManager extends AbstractNetworkManager {
    private messageState = new Map<string, MessageTracker>();
    private deliveredToApp = new Set<string>();

    private _knownNodes: Node[] = [];
    private _activeNodes: Node[] = [];

    get knownNodes(): Node[] {
        return this._knownNodes;
    }

    get activeNodes(): Node[] {
        return this._activeNodes;
    }
    //TODO Add view of active nodes and node 
    constructor(
        private myNodeId: NodeId,
        private senderInstance: NetworkLayer,
    ) {
        super();
        NetworkManager.singleton = this;
    }

    public broadcastReliably(msg: ProtocolMessage) {
        this.startTracking(msg);
        this.senderInstance.multicast(msg);
    }

    public handleIncoming(incomingMsg: ProtocolMessage) {
        if (incomingMsg.kind === "ACK") {
            this.processAck(incomingMsg as AckMsg);
            return;
        }

        if (!this.messageState.has(incomingMsg.id)) {
            this.startTracking(incomingMsg);
            this.sendAck(incomingMsg);
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