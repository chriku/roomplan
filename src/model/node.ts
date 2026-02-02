import { v4 as uuidv4 } from 'uuid';
import type { Operation } from './operation.js';
import { OperationManager } from './operation_manager.js';

export class Node {
    get isLeader(): boolean { return this == OperationManager.singleton?.currentLeader(); }
    readonly causedOperations: Operation[] = [];
    constructor(readonly nickname: string, readonly id: string = uuidv4()) { }
}