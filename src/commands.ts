import { DateRange } from "./model/date_range.js";
import { BookRoomOperation } from "./model/operation.js";
import { OperationManager } from "./model/operation_manager.js";
import { Room } from "./model/room.js";
import { User } from "./model/user.js";

export function lookupTimeSlot(slot: number): DateRange {
    return new DateRange(new Date(2026, 2, 11, slot, 0, 0), new Date(2026, 2, 11, slot, 59, 59));
}

export const rooms = Room.rooms;
export const users = User.users;
export default { ...rooms, ...users };