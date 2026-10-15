// Pure helpers for the reports screens (weekly review, Done extras, wrap-up card, heat grid, load bars, dates). No DOM, no signals.
import type { ActivityEvent, Item, KeptRate, PersonSummary, ReviewData, UpcomingDate } from '../shared/types';

/** Local midnight of the Monday of the week containing `ms`. */
export function weekStart(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

const addDays = (ms: number, n: number): number => { const d = new Date(ms); d.setDate(d.getDate() + n); return d.getTime(); };

/** The review window: offset 0 = Monday until now, -1 = the whole previous week. `to` is undefined for the current week (the main process uses now). */
export function reviewWindow(offset: 0 | -1, now: number): { from: number; to: number | undefined } {
  const monday = weekStart(now);
  return offset === 0 ? { from: monday, to: undefined } : { from: addDays(monday, -7), to: monday };
}

export function weekLabel(offset: 0 | -1, now: number, short: (ms: number, pattern: string) => string): string {
  const { from, to } = reviewWindow(offset, now);
  if (to === undefined) return `${short(from, 'EEE d MMM')} to now`;
  return `${short(from, 'd MMM')} to ${short(to - 1, 'd MMM')}`;
}

/** "11 of 13 promises kept on time, 85%"; null when no promise was closed. */
export function keptLine(k: KeptRate): string | null {
  if (k.total === 0 || k.rate == null) return null;
  return `${k.onTime} of ${k.total} ${k.total === 1 ? 'promise' : 'promises'} kept on time, ${Math.round(k.rate * 100)}%`;
}

/** Each item appears once: a promise that is also slipping or stale stays in the first section it qualifies for. */
export function dedupeSections(r: Pick<ReviewData, 'overduePromises' | 'slipped' | 'staleWaits'>): { overdue: Item[]; slipped: Item[]; stale: Item[] } {
  const seen = new Set<string>();
  const take = (l: Item[]): Item[] => l.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)));
  return { overdue: take(r.overduePromises), slipped: take(r.slipped), stale: take(r.staleWaits) };
}

export const daysAgoText = (days: number | null): string => (days == null ? 'no 1:1 logged' : days === 0 ? 'last 1:1 today' : `last 1:1 ${days} ${days === 1 ? 'day' : 'days'} ago`);

// ---------------------------------------------------------------- wrap-up

/** Local day as YYYY-MM-DD. */
export function localDay(ms: number): string {
  const d = new Date(ms), p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** True on a weekday, at or after `eodTime` ("17:30"), when the card has not been shown today. A malformed time never triggers. */
export function wrapupDue(now: number, eodTime: string, wrapupDay: string): boolean {
  const m = /^(\d{1,2}):(\d{2})$/.exec(eodTime.trim());
  if (!m) return false;
  const d = new Date(now);
  const dow = d.getDay();
  if (dow === 0 || dow === 6) return false;
  if (wrapupDay === localDay(now)) return false;
  return d.getHours() * 60 + d.getMinutes() >= Number(m[1]) * 60 + Number(m[2]);
}

export function wrapupText(closed: number, overdue: number): string {
  return `Wrapping up: you closed ${closed} today, ${overdue} still overdue.`;
}

// ---------------------------------------------------------------- heat grid and load bars

/** Start dates (local Monday midnight) of the `n` heat-grid weeks, oldest first; the last one is the current week. */
export function heatWeekStarts(now: number, n: number): number[] {
  const monday = weekStart(now);
  return Array.from({ length: n }, (_, i) => addDays(monday, -7 * (n - 1 - i)));
}

/** Widths in percent of a full bar for each person's open owes and waits, scaled by the busiest person. */
export function loadShares(list: Array<Pick<PersonSummary, 'person' | 'openOwe' | 'openWait'>>): Map<string, { owe: number; wait: number }> {
  const max = Math.max(1, ...list.map((s) => s.openOwe + s.openWait));
  return new Map(list.map((s) => [s.person.id, { owe: (s.openOwe / max) * 100, wait: (s.openWait / max) * 100 }]));
}

// ---------------------------------------------------------------- activity

export const EVENT_ICON: Record<ActivityEvent, string> = {
  created: 'plus', completed: 'circlecheck', dropped: 'circlex', snoozed: 'moon', reopened: 'repeat', edited: 'pencil',
};
export const EVENT_VERB: Record<ActivityEvent, string> = {
  created: 'Captured', completed: 'Completed', dropped: 'Dropped', snoozed: 'Snoozed', reopened: 'Reopened', edited: 'Edited',
};

// ---------------------------------------------------------------- person dates

export const streakText = (weeks: number | null): string | null => (weeks && weeks > 0 ? `On cadence ${weeks} ${weeks === 1 ? 'week' : 'weeks'} in a row` : null);

/** A birthday is stored 'MM-DD'; the date input needs a year, so a leap year is used (it also allows 02-29). */
export const birthdayToInput = (b: string | null): string => (b && /^\d{2}-\d{2}$/.test(b) ? `2000-${b}` : '');
export function inputToBirthday(v: string): string | null {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(v);
  return m ? `${m[1]}-${m[2]}` : null;
}
export const validDateInput = (v: string): string | null => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

export const dateKey = (u: UpcomingDate): string => `${u.personId}:${u.kind}:${u.on}`;
/** Up to `limit` upcoming dates that are not dismissed. */
export function visibleDates(list: UpcomingDate[], dismissed: ReadonlySet<string>, limit = 3): UpcomingDate[] {
  return list.filter((u) => !dismissed.has(dateKey(u))).slice(0, limit);
}
