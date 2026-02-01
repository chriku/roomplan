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
    static readonly rooms: { [name: string]: Room } = { aula: new Room("aula"), v1: new Room("v1"), v2: new Room("v2"), s1: new Room("s1"), s2: new Room("s2") };
    static findRoom(name: string): Room | null {
        if (this.rooms[name] != null)
            return this.rooms[name];
        else
            return null;
    }
    constructor(readonly name: string) { }
    isBooked(date: Date = new Date()) { return this.bookings.filter((it) => it.affects(date)).length > 0; }

    listBookings() {
        console.log("Bookings for " + this.name);
        for (const booking of this.bookings) {
            console.log("  Booking " + booking.id + ": From " + booking.time.startTime + " to " + booking.time.endTime + " by " + booking.user.name);
        }
    }
}