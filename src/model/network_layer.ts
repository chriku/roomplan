export type Message = { type: string };
export type FischMessage = { type: "fisch", data: string };
export abstract class NetworkLayer {
    static singleton: NetworkLayer | null = null;

    abstract multicast(message: Message): Promise<void>;
    abstract receive(): Promise<Message>;
}