import type { Operation } from "./operation.js";

export type NodeId = string;

export type ProtocolMessage =
    | PingMsg
    | AckMsg
    | ElectionMsg
    | OkMsg
    | VoteRequestMsg
    | VoteResponseMsg
    | LeaderAnnounceMsg
    | ProposeOperationMsg
    | AssignOperationMsg
    | ResendRequestMsg;

export type BaseMsg<K extends string> = {
    id: string;
    kind: K;
    from: NodeId;
    epoch: number | null;
};

export type PingMsg = BaseMsg<"PING">;
export type AckMsg = BaseMsg<"ACK"> & {
    ackFor: string;
};

export type ElectionMsg = BaseMsg<"ELECTION">;
export type OkMsg = BaseMsg<"OK"> & {
    to: NodeId | null;
};

export type VoteRequestMsg = BaseMsg<"VOTE_REQUEST">;
export type VoteResponseMsg = BaseMsg<"VOTE_RESPONSE"> & {
    lastDeliveredSeq: number;
    lastDeliveredOpId: string | null;
    to: NodeId;
};

export type LeaderAnnounceMsg = BaseMsg<"LEADER_ANNOUNCE"> & {
    leaderId: NodeId;
    startSeq: number;
    lastSeq: number;
};

export type ProposeOperationMsg = BaseMsg<"PROPOSE_OP"> & {
    op: Operation;
};

export type AssignOperationMsg = BaseMsg<"ASSIGN_OP"> & {
    leaderId: NodeId;
    seq: number;
    op: Operation;
};

export type ResendRequestMsg = BaseMsg<"RESEND_REQUEST"> & {
    leaderId: NodeId;
    fromSeq: number;
    toSeq: number;
};
