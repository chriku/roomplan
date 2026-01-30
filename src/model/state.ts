import type { Room } from "./room.js";

export abstract class State {
    abstract get rooms(): Room[];
    unbookedRooms(date: Date = new Date()) { return this.rooms.filter((it) => it.isBooked(date)) };
}