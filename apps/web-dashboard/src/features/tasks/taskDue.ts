export type BeijingDateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

export function beijingPartsToUtcIso(year: number, month: number, day: number, hour: number, minute: number): string {
  if (minute !== 0 && minute !== 30) {
    throw new Error("minute must be 0 or 30");
  }
  return new Date(Date.UTC(year, month - 1, day, hour - 8, minute, 0, 0)).toISOString();
}

export function utcIsoToBeijingParts(iso: string): BeijingDateTimeParts {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("invalid ISO timestamp");
  }
  return dateToBeijingParts(parsed);
}

export function formatTaskDueAtBeijing(iso: string | null | undefined): string {
  if (!iso) {
    return "";
  }
  const parts = utcIsoToBeijingParts(iso);
  return `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)} ${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function roundUpToNextHalfHourBeijing(now: Date = new Date()): BeijingDateTimeParts {
  const shifted = new Date(now.getTime() + BEIJING_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth() + 1;
  const day = shifted.getUTCDate();
  const hour = shifted.getUTCHours();
  const minute = shifted.getUTCMinutes();
  const second = shifted.getUTCSeconds();
  const millisecond = shifted.getUTCMilliseconds();
  const addMinutes = minute < 30 ? (minute === 0 && second === 0 && millisecond === 0 ? 0 : 30 - minute) : 60 - minute;
  const rounded = new Date(Date.UTC(year, month - 1, day, hour, minute + addMinutes, 0, 0));
  return pseudoUtcToParts(rounded);
}

export function addBeijingCalendarDays(parts: BeijingDateTimeParts, days: number): BeijingDateTimeParts {
  return pseudoUtcToParts(new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days, parts.hour, parts.minute, 0, 0)));
}

export function addBeijingCalendarMonthsClamped(parts: BeijingDateTimeParts, months: number): BeijingDateTimeParts {
  const monthIndex = parts.month - 1 + months;
  const year = parts.year + Math.floor(monthIndex / 12);
  const normalizedMonthIndex = ((monthIndex % 12) + 12) % 12;
  const month = normalizedMonthIndex + 1;
  const day = Math.min(parts.day, daysInMonth(year, month));
  return { ...parts, year, month, day };
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isSameBeijingDate(a: BeijingDateTimeParts, b: BeijingDateTimeParts): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

export function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

function dateToBeijingParts(date: Date): BeijingDateTimeParts {
  return pseudoUtcToParts(new Date(date.getTime() + BEIJING_OFFSET_MS));
}

function pseudoUtcToParts(date: Date): BeijingDateTimeParts {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
  };
}
