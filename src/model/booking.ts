import type { DateRange } from "./date_range.js";
import type { Room } from "./room.js";
import { v4 as uuidv4 } from 'uuid';
import type { User } from "./user.js";

export enum BookingStatus {
    BOOKED,
    CANCELLED
}
export class Booking {
    constructor(readonly room: Room, readonly time: DateRange, readonly user: User, public status: BookingStatus = BookingStatus.BOOKED, readonly id: string = uuidv4()) { }
    affects(date: Date): boolean {
        return this.time.contains(date);
    }
    overlaps(dateRange: DateRange): boolean {
        return this.time.overlaps(dateRange);
    }
    get valid(): boolean {
        return this.status == BookingStatus.BOOKED;
    }
}