import { v4 as uuidv4 } from 'uuid';
import type { Booking } from './booking.js';

export class Room {
    readonly bookings: Booking[] = [];
    constructor(readonly name: string, readonly capacity: number, readonly id: string = uuidv4()) { }
    isBooked(date: Date = new Date()) { return this.bookings.filter((it) => it.affects(date)).length > 0; }
}