import type { Room } from "./room.js";
import { OperationManager } from "./operation_manager.js";
import { BookRoomOperation } from "./operation.js";
import { lookupTimeSlot } from "../commands.js";

export class User {
    static readonly users: { [name: string]: User } = { chriku: new User("chriku"), axel: new User("axel"), schurpl: new User("schurpl") };
    static findUser(name: string): User | null {
        if (this.users[name] != null)
            return this.users[name];
        else
            return null;
    }
    constructor(readonly name: string) { }
    bookRoom(room: Room, slot: number) {
        OperationManager.singleton!.proposeOperation(new BookRoomOperation(lookupTimeSlot(slot), room, this));
    }
}