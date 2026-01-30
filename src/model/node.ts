import { v4 as uuidv4 } from 'uuid';
import type { Operation } from './operation.js';

export class Node {
    public isLeader: boolean = false;
    readonly causedOperations: Operation[] = [];
    constructor(readonly nickname: string, readonly id: string = uuidv4()) { }
}