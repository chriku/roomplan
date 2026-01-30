export class DateRange {
    constructor(readonly startTime: Date, readonly endTime: Date) { }
    contains(date: Date): boolean { return (date >= this.startTime) && (date < this.endTime); }
    overlaps(other: DateRange): boolean { throw Error("NotYetImplemented"); }
}