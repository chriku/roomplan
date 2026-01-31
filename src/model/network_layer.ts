import type { ProtocolMessage } from "./messages.js";

export type Message = { type: string };
export type FischMessage = { type: "fisch", data: string };
export abstract class NetworkLayer {
    static singleton: NetworkLayer | null = null;

    abstract multicast(message: ProtocolMessage): Promise<void>;
    abstract receive(): Promise<ProtocolMessage>;
}