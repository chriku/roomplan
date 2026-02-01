import { match } from 'node:assert';
import type { Booking } from './booking.js';
import fs from "node:fs";

export abstract class RoomProvider {
    static singleton: RoomProvider | null = null;

    abstract listRooms(): Room[];
    abstract findRoom(name: string): Room | null;
}

export class Room {
    readonly bookings: Booking[] = [];
    static readonly rooms: Room[] = (JSON.parse(fs.readFileSync("rooms.json", "utf8")) as string[]).map((name) => new Room(name));
    static findRoom(name: string): Room | null {
        const matchingRooms = this.rooms.filter((it) => it.name == name);
        if (matchingRooms.length > 0)
            return matchingRooms[0];
        else return null;
    }
    constructor(readonly name: string) { }
    isBooked(date: Date = new Date()) { return this.bookings.filter((it) => it.affects(date)).length > 0; }
}