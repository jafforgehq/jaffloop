// Derived rules (pure). All take `now`; the stale rule takes the settings.
import type { Item, Settings } from '../shared/types';
import { addDays, dayDiff, startOfDay } from './calendar';
import { DEFAULT_SETTINGS } from './settings';

/** Snoozed 3+ times and still open. */
export function isSlipping(i: Pick<Item, 'status' | 'snoozeCount'>): boolean {
  return i.status === 'open' && i.snoozeCount >= 3;
}

/** Waiting-on with no touch for N days past due (or N days since creation when undated). */
export function isStaleWait(
  i: Pick<Item, 'kind' | 'status' | 'dueAt' | 'createdAt' | 'lastTouchedAt'>,
  now: number,
  settings: Pick<Settings, 'staleDaysAfterDue' | 'staleDaysNoDue'> = DEFAULT_SETTINGS,
): boolean {
  if (i.kind !== 'wait' || i.status !== 'open') return false;
  if (i.dueAt !== null) {
    const limit = addDays(i.dueAt, settings.staleDaysAfterDue);
    return now >= limit && i.lastTouchedAt <= limit;
  }
  const limit = addDays(i.createdAt, settings.staleDaysNoDue);
  return now >= limit && i.lastTouchedAt < limit;
}

export function isOverdue(i: Pick<Item, 'status' | 'dueAt' | 'dueHasTime'>, now: number): boolean {
  if (i.status !== 'open' || i.dueAt === null) return false;
  return i.dueHasTime ? i.dueAt < now : i.dueAt < startOfDay(now);
}

export function isHidden(i: Pick<Item, 'snoozedUntil'>, now: number): boolean {
  return i.snoozedUntil !== null && i.snoozedUntil > now;
}

/** Whole days since the last interaction. */
export function daysSince(last: number | null, now: number): number | null {
  return last === null ? null : dayDiff(last, now);
}

/** Days since the last interaction exceed the cadence. */
export function cadenceOverdue(cadenceDays: number | null, lastInteraction: number | null, now: number): boolean {
  if (cadenceDays === null) return false;
  const d = daysSince(lastInteraction, now);
  return d !== null && d > cadenceDays;
}

export const Rules = { isSlipping, isStaleWait, isOverdue, isHidden, daysSince, cadenceOverdue };
