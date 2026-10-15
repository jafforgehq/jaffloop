// Date and time wording used across the UI (pure). Same words as the Swift `Fmt`; the clock follows the user's locale.
// `locale` undefined = the system locale.
import type { Item } from '../shared/types';
import { dayDiff, isSameDay } from './calendar';
import { TimeFormat } from './helpers';

const weekdayName = (ms: number, style: 'short' | 'long', locale?: string): string =>
  new Intl.DateTimeFormat(locale, { weekday: style }).format(ms);
const monthName = (ms: number, style: 'short' | 'long', locale?: string): string =>
  new Intl.DateTimeFormat(locale, { month: style }).format(ms);

/**
 * Formats with a small subset of Swift/ICU date patterns: yyyy, MMMM, MMM, MM, dd, d, EEEE, EEE and HH:mm
 * (HH:mm becomes the locale's own clock, 12 or 24 hour). Anything else is copied as is.
 */
export function fmtShort(ms: number, pattern: string, locale?: string): string {
  const d = new Date(ms);
  const p2 = (n: number): string => String(n).padStart(2, '0');
  return pattern.replace(/yyyy|MMMM|MMM|MM|dd|d|EEEE|EEE|HH:mm/g, (tok) => {
    switch (tok) {
      case 'yyyy': return String(d.getFullYear());
      case 'MMMM': return monthName(ms, 'long', locale);
      case 'MMM': return monthName(ms, 'short', locale);
      case 'MM': return p2(d.getMonth() + 1);
      case 'dd': return p2(d.getDate());
      case 'd': return String(d.getDate());
      case 'EEEE': return weekdayName(ms, 'long', locale);
      case 'EEE': return weekdayName(ms, 'short', locale);
      default: return TimeFormat.clock(ms, locale);
    }
  });
}

/** "Today", "Tomorrow", "Yesterday", a weekday within 6 days either way, otherwise "MMM d"; plus the time when set. */
export function fmtDue(i: Pick<Item, 'dueAt' | 'dueHasTime'>, now: number = Date.now(), locale?: string): string | null {
  if (i.dueAt === null) return null;
  const d = i.dueAt;
  const days = dayDiff(now, d);
  let day: string;
  if (days === 0) day = 'Today';
  else if (days === 1) day = 'Tomorrow';
  else if (days === -1) day = 'Yesterday';
  else if ((days >= 2 && days <= 6) || (days < -1 && days > -7)) day = fmtShort(d, 'EEE', locale);
  else day = fmtShort(d, 'MMM d', locale);
  if (i.dueHasTime) day += ' ' + TimeFormat.clock(d, locale);
  return day;
}

/** Full date for tooltips: "Friday 16 October 2026" plus the time when there is one. */
export function fmtExact(i: Pick<Item, 'dueAt' | 'dueHasTime'>, locale?: string): string | null {
  if (i.dueAt === null) return null;
  return fmtShort(i.dueAt, i.dueHasTime ? 'EEEE d MMMM yyyy, HH:mm' : 'EEEE d MMMM yyyy', locale);
}

/** "back 15:00", "back tomorrow 09:00", "back Fri" */
export function fmtBackLabel(d: number, now: number = Date.now(), locale?: string): string {
  const time = TimeFormat.clock(d, locale);
  if (isSameDay(d, now)) return 'back ' + time;
  if (dayDiff(now, d) === 1) return `back tomorrow ${time}`;
  return 'back ' + fmtShort(d, 'EEE', locale);
}

export const Fmt = { due: fmtDue, short: fmtShort, exact: fmtExact, backLabel: fmtBackLabel };
