import { Node } from "./node.js";
export abstract class NetworkManager {
    static singleton: NetworkManager | null = null;

    abstract get knownNodes(): Node[];
    abstract get activeNodes(): Node[];
}