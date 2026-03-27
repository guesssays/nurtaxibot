import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";

dayjs.extend(utc);
dayjs.extend(timezone);

export interface DayBounds {
  start: Date;
  end: Date;
}

export function getDayBounds(date: Date, timezoneName: string): DayBounds {
  const zoned = dayjs(date).tz(timezoneName);
  return {
    start: zoned.startOf("day").toDate(),
    end: zoned.endOf("day").toDate(),
  };
}

export function getYesterdayBounds(timezoneName: string): DayBounds {
  const zoned = dayjs().tz(timezoneName).subtract(1, "day");
  return {
    start: zoned.startOf("day").toDate(),
    end: zoned.endOf("day").toDate(),
  };
}

export function getTodayBounds(timezoneName: string): DayBounds {
  return getDayBounds(new Date(), timezoneName);
}

export function formatDateTime(date: Date | null | undefined, timezoneName: string): string {
  if (!date) {
    return "—";
  }

  return dayjs(date).tz(timezoneName).format("DD.MM.YYYY HH:mm:ss");
}

export function formatDateOnly(date: Date | null | undefined, timezoneName: string): string {
  if (!date) {
    return "—";
  }

  return dayjs(date).tz(timezoneName).format("DD.MM.YYYY");
}

export function parseDateInput(dateInput: string, timezoneName: string): Date {
  return dayjs.tz(dateInput, timezoneName).toDate();
}

export function formatDurationHuman(durationSeconds: number | null | undefined): string {
  if (durationSeconds === null || durationSeconds === undefined) {
    return "—";
  }

  const minutes = Math.floor(durationSeconds / 60);
  const seconds = durationSeconds % 60;
  return `${minutes}м ${seconds}с`;
}

export function toDateOnlyUtc(date: Date, timezoneName: string): Date {
  const formatted = dayjs(date).tz(timezoneName).format("YYYY-MM-DD");
  return new Date(`${formatted}T00:00:00.000Z`);
}
