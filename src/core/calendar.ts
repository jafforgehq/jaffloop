// Local-time calendar helpers (pure). Everything uses the machine's time zone; weeks start on Monday.

export const DAY_MS = 86_400_000;

export function startOfDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Calendar days, keeping the wall-clock time (DST safe). */
export function addDays(ms: number, n: number): number {
  const d = new Date(ms);
  d.setDate(d.getDate() + n);
  return d.getTime();
}

/** Calendar months, clamping to the last day of the target month (Jan 31 + 1 = Feb 28). */
export function addMonths(ms: number, n: number): number {
  const d = new Date(ms);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return d.getTime();
}

/** Whole calendar days from the day of `from` to the day of `to`. */
export function dayDiff(from: number, to: number): number {
  const a = new Date(from), b = new Date(to);
  return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / DAY_MS);
}

/** 1 = Sunday ... 7 = Saturday (the Swift Calendar numbering). */
export function weekday(ms: number): number {
  return new Date(ms).getDay() + 1;
}

/** Monday 00:00 of the week containing `ms`. */
export function startOfWeek(ms: number): number {
  const d = startOfDay(ms);
  return addDays(d, -((new Date(d).getDay() + 6) % 7));
}

/** The given day at hour:minute (local). */
export function atTime(dayMs: number, hour: number, minute: number): number {
  const d = new Date(dayMs);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour, minute, 0, 0).getTime();
}

export function isSameDay(a: number, b: number): boolean {
  return dayDiff(a, b) === 0;
}
