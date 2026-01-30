export class DateRange {
    constructor(readonly startTime: Date, readonly endTime: Date) {
        if (!(endTime > startTime)) throw Error("Not a valid DateRange");
    }
    contains(date: Date): boolean { return (date >= this.startTime) && (date < this.endTime); }
    overlaps(other: DateRange): boolean { return (this.startTime < other.endTime) && (other.startTime < this.endTime); }
}