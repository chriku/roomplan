import { DateRange } from "./model/date_range.js";
import { BookRoomOperation } from "./model/operation.js";
import { OperationManager } from "./model/operation_manager.js";
import { Room } from "./model/room.js";

function lookupTimeSlot(slot: number): DateRange {
    return new DateRange(new Date(2026, 2, 11, slot, 0, 0), new Date(2026, 2, 11, slot, 59, 59));
}

export function book(slot: number, roomName: string, userName: string) {
    const room = Room.findRoom(roomName);
    if (room == null) { throw Error("Unknown room: " + roomName); }
    const user = Room.findRoom(userName);
    if (user == null) { throw Error("Unknown user: " + userName); }
    OperationManager.singleton!.proposedOperation(new BookRoomOperation(lookupTimeSlot(slot), room, user));
}

export function listBookings(roomName: string) {
    const room = Room.findRoom(roomName);
    if (room == null) { throw Error("Unknown room: " + roomName); }
    for (const booking of room.bookings) {
        console.log("  Booking " + booking.id + ": From " + booking.time.startTime + " to " + booking.time.endTime + " by " + booking.user.name);
    }
}