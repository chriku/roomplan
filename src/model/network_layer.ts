import type { ProtocolMessage } from "./messages.js";
import * as dgram from 'node:dgram';

export type Message = { type: string };
export type FischMessage = { type: "fisch", data: string };
export abstract class NetworkLayer {
    static singleton: NetworkLayer | null = null;

    abstract multicast(message: ProtocolMessage): Promise<void>;

}
export class ConcreteNetworkLayer extends NetworkLayer {
    
    private socket: dgram.Socket;
    private multicastAddress: string;
    private multicastPort: number;
    private pendingReceivers: ((msg: ProtocolMessage) => void)[] = [];

    constructor() {
        super();
        NetworkLayer.singleton = this;
        this.multicastAddress = process.env.MULTICAST_ADDRESS || '224.0.0.124';
        this.multicastPort = parseInt(process.env.MULTICAST_PORT || '41234', 10);
        
        this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
        this.setupListeners();
        this.bind();

    }

    async multicast(message: ProtocolMessage): Promise<void> {
        const data = JSON.stringify(message);
        return new Promise((resolve, reject) => {
            this.socket.send(data, this.multicastPort, this.multicastAddress, (err) => {
                if (err) return reject(err);
                resolve();
            });
        });
    }
    
      private setupListeners() {
        this.socket.on('error', (err) => {
            console.error(`server error:\n${err.stack}`);
            this.socket.close();
        });

        this.socket.on('message', (msg, rinfo) => {
            console.log(`server got: ${msg} from ${rinfo.address}:${rinfo.port}`);
            //TODO send logic to upper layer
            try {
                const parsed: ProtocolMessage = JSON.parse(msg.toString());
                
                // If someone is waiting for a message, give it to them
                if (this.pendingReceivers.length > 0) {
                    const resolve = this.pendingReceivers.shift();
                    if (resolve) resolve(parsed);
                }
            } catch (e) {
                console.error("Failed to parse message", e);
            }
        });

        this.socket.on('listening', () => {
            const address = this.socket.address();
            console.log(`server listening ${address.address}:${address.port}`);
            this.socket.addMembership(this.multicastAddress);
        });
    }
    private bind() {
        this.socket.bind(this.multicastPort, '0.0.0.0');
    }

}