import type { Room } from "./room.js";
import { OperationManager } from "./operation_manager.js";
import { BookRoomOperation } from "./operation.js";
import { DateRange } from "./date_range.js";


export function lookupTimeSlot(slot: number): DateRange {
    return new DateRange(new Date(2026, 2, 11, slot, 0, 0), new Date(2026, 2, 11, slot, 59, 59));
}

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
        OperationManager.singleton!.proposeOperation(new BookRoomOperation(lookupTimeSlot(slot), room.name, this.name));
    }
}