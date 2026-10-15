// Minimal RRULE support: DAILY / WEEKLY (BYDAY, INTERVAL) / MONTHLY (INTERVAL). Pure.
import { addDays, addMonths, weekday } from './calendar';

/** Swift weekday numbers (1 = Sunday) to RRULE day codes. */
export const RRULE_DAY: Record<number, string> = { 1: 'SU', 2: 'MO', 3: 'TU', 4: 'WE', 5: 'TH', 6: 'FR', 7: 'SA' };
const DAY_NUMBER = new Map(Object.entries(RRULE_DAY).map(([n, code]) => [code, Number(n)]));

export function nextOccurrence(after: number, rule: string): number | null {
  const parts = new Map<string, string>();
  for (const kv of rule.split(';')) {
    const i = kv.indexOf('=');
    if (i > 0 && i < kv.length - 1) parts.set(kv.slice(0, i), kv.slice(i + 1));
  }
  const iv = parts.get('INTERVAL') ?? '1';
  const n = Math.max(1, /^[+-]?\d+$/.test(iv) ? parseInt(iv, 10) : 1);
  switch (parts.get('FREQ')) {
    case 'DAILY': return addDays(after, n);
    case 'MONTHLY': return addMonths(after, n);
    case 'WEEKLY': {
      const by = parts.get('BYDAY');
      if (by === undefined) return addDays(after, 7 * n);
      const wds = new Set<number>();
      for (const name of by.split(',')) { const w = DAY_NUMBER.get(name); if (w !== undefined) wds.add(w); }
      if (wds.size === 1) return addDays(after, 7 * n);
      for (let d = 1; d <= 7; d++) {
        const c = addDays(after, d);
        if (wds.has(weekday(c))) return c;
      }
      return null;
    }
    default: return null;
  }
}

/** Next occurrence strictly in the future of `now`. */
export function nextFutureOccurrence(from: number, rule: string, now: number): number | null {
  let d = from;
  for (let i = 0; i < 500; i++) {
    const n = nextOccurrence(d, rule);
    if (n === null) return null;
    d = n;
    if (d > now) return d;
  }
  return d;
}

export const Recurrence = { next: nextOccurrence, nextFuture: nextFutureOccurrence };
