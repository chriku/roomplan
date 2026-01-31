import { v4 as uuidv4 } from 'uuid';
import type { Booking } from './booking.js';
import type { Room } from './room.js';
import type { DateRange } from './date_range.js';
import type { User } from './user.js';
import type { Node } from './node.js';

export class Operation {
    public causedBy: Node | null = null;
    protected constructor(public sequenceNumber: number = -1, readonly timestamp: Date = new Date(), readonly id: string = uuidv4()) { }
}

export class CancelRoomOperation extends Operation {
    constructor(readonly booking: Booking, id: string = uuidv4(), sequenceNumber: number = -1, timestamp: Date = new Date()) {
        super(sequenceNumber, timestamp, id);
    }
}

export class BookRoomOperation extends Operation {
    constructor(readonly time: DateRange, readonly room: Room, readonly user: User, id: string = uuidv4(), sequenceNumber: number = -1, timestamp: Date = new Date()) {
        super(sequenceNumber, timestamp, id);
    }
}