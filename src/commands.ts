import { DateRange } from "./model/date_range.js";
import { BookRoomOperation, CancelRoomOperation } from "./model/operation.js";
import { OperationManager } from "./model/operation_manager.js";
import { Room } from "./model/room.js";
import { User } from "./model/user.js";


export function deleteBooking(uuid: string) {
    for (const room of Object.values(Room.rooms)) {
        for (const booking of room.bookings) {
            if (booking.id == uuid) {
                console.log("Deleting booking " + uuid + " from " + booking.time.startTime + " to " + booking.time.endTime + " in " + room.name);
                OperationManager.singleton!.proposeOperation(new CancelRoomOperation(booking));
                return;
            }
        }
    }
    console.log("No booking for " + uuid + " found");
}


export const rooms = Room.rooms;
export const users = User.users;
export default { ...rooms, ...users, deleteBooking };
