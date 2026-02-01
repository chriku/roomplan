import { Room } from "./room.js";

export class State {
    get rooms(): Room[] {
        return Object.values(Room.rooms);
    }
    unbookedRooms(date: Date = new Date()) { return this.rooms.filter((it) => it.isBooked(date)) };
}