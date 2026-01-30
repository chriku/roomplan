import type { Booking } from './booking.js';

export abstract class RoomProvider {
    static singleton: RoomProvider | null = null;

    abstract listRooms(): Room[];
    abstract findRoom(name: string): Room | null;
}

export class Room {
    readonly bookings: Booking[] = [];
    constructor(readonly name: string, readonly capacity: number) { }
    isBooked(date: Date = new Date()) { return this.bookings.filter((it) => it.affects(date)).length > 0; }
}