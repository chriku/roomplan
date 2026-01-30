import type { Operation } from "./operation.js";
import { State } from "./state.js";

export abstract class OperationManager extends State {
    static singleton: OperationManager | null = null;

    abstract proposeOperation(operation: Operation): string;
    abstract currentLeader(): Node | null;
}