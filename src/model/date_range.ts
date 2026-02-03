export class DateRange {
    constructor(
        readonly startTime: Date,
        readonly endTime: Date
    ) {
        if (!(endTime.getTime() > startTime.getTime())) throw Error("Not a valid DateRange");
    }

    static hydrate(data: { startTime: string | Date; endTime: string | Date }): DateRange {
        return new DateRange(new Date(data.startTime), new Date(data.endTime));
    }

    contains(date: Date): boolean {
        return date >= this.startTime && date < this.endTime;
    }
    overlaps(other: DateRange): boolean {
        return this.startTime < other.endTime && other.startTime < this.endTime;
    }
}