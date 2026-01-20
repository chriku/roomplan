import * as dgram from 'node:dgram';

/**
 * NetworkLayer class handles UDP multicast communication.
 * Provides functionality for sending and receiving multicast messages
 * over a UDP socket with configurable multicast address and port.
 */
class NetworkLayer {
    private socket: dgram.Socket;
    private multicastAddress: string;
    private multicastPort: number;

    /**
     * Creates a new NetworkLayer instance.
     * Initializes the UDP socket, sets up event listeners, and binds to the multicast port.
     * Multicast address and port can be configured via environment variables.
     */
    constructor() {
        this.multicastAddress = process.env.MULTICAST_ADDRESS || '224.0.0.124';
        this.multicastPort = parseInt(process.env.MULTICAST_PORT || '41234', 10);
        
        this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
        this.setupListeners();
        this.bind();
    }

    /**
     * Sets up event listeners for the UDP socket.
     * Handles error events, incoming messages, and listening events.
     * Automatically joins the multicast group when the socket starts listening.
     */
    private setupListeners() {
        this.socket.on('error', (err) => {
            console.error(`server error:\n${err.stack}`);
            this.socket.close();
        });

        this.socket.on('message', (msg, rinfo) => {
            console.log(`server got: ${msg} from ${rinfo.address}:${rinfo.port}`);
        });

        this.socket.on('listening', () => {
            const address = this.socket.address();
            console.log(`server listening ${address.address}:${address.port}`);
            this.socket.addMembership(this.multicastAddress);
        });
    }

    /**
     * Binds the UDP socket to the multicast port on all available interfaces.
     * Listens on 0.0.0.0 to accept multicast traffic from any interface.
     */
    private bind() {
        this.socket.bind(this.multicastPort, '0.0.0.0');
    }

    /**
     * Sends data to the multicast group.
     * @param data - The string data to be sent to all members of the multicast group
     */
    multicast(data: string) {
        this.socket.send(data, this.multicastPort, this.multicastAddress, (err) => {
            if (err) console.error(`send error: ${err}`);
        });
    }
    /**
     * Sends data to a specific address and port.
     * @param address - The target IP address to send the data to
     * @param port - The target port number to send the data to
     * @param data - The string data to be sent
     */
    send(address: string, port: number, data: string) {
        this.socket.send(data, port, address, (err) => {
            if (err) console.error(`send error: ${err}`);
        });
    }

    /**
     * Closes the UDP socket and releases all resources.
     * Should be called when the network layer is no longer needed.
     */
    close() {
        this.socket.close();
    }
}

export default NetworkLayer;



