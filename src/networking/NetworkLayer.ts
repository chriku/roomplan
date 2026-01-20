import * as dgram from 'node:dgram';

class NetworkLayer {
    private socket: dgram.Socket;
    private multicastAddress: string;
    private multicastPort: number;

    constructor() {
        this.multicastAddress = process.env.MULTICAST_ADDRESS || '224.0.0.124';
        this.multicastPort = parseInt(process.env.MULTICAST_PORT || '41234', 10);
        
        this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
        this.setupListeners();
        this.bind();
    }

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

    private bind() {
        this.socket.bind(this.multicastPort, '0.0.0.0');
    }

    multicast(data: string) {
        this.socket.send(data, this.multicastPort, this.multicastAddress, (err) => {
            if (err) console.error(`send error: ${err}`);
        });
    }
    send(address: string, port: number, data: string) {
        this.socket.send(data, port, address, (err) => {
            if (err) console.error(`send error: ${err}`);
        });
    }

    close() {
        this.socket.close();
    }
}

export default NetworkLayer;



