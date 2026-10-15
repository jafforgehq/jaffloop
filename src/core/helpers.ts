// Small pure helpers shared by the app, the renderer and the tests.
import type { Item, PersonSummary } from '../shared/types';
import { addDays, dayDiff, startOfDay, startOfWeek } from './calendar';

/** Dotted version such as "0.0.3" or "v1.2". Anything that is not numeric is invalid ("dev"). */
export class AppVersion {
  private constructor(readonly parts: number[]) {}

  static parse(s: string): AppVersion | null {
    const t = s.trim().replace(/^[vV]+/, '');
    const raw = t.split('.').filter((p) => p !== '');
    if (raw.length === 0) return null;
    const parts: number[] = [];
    for (const p of raw) {
      const m = /^\d+/.exec(p);
      if (!m) return null;
      parts.push(parseInt(m[0], 10));
    }
    return new AppVersion(parts);
  }

  toString(): string { return this.parts.join('.'); }

  /** <0, 0, >0 like a sort comparator; missing parts count as 0 ("1.0" == "1.0.0"). */
  compare(o: AppVersion): number {
    for (let i = 0; i < Math.max(this.parts.length, o.parts.length); i++) {
      const x = this.parts[i] ?? 0, y = o.parts[i] ?? 0;
      if (x !== y) return x < y ? -1 : 1;
    }
    return 0;
  }
  lt(o: AppVersion): boolean { return this.compare(o) < 0; }
  gt(o: AppVersion): boolean { return this.compare(o) > 0; }
  eq(o: AppVersion): boolean { return this.compare(o) === 0; }
}

/** Clock style (12 or 24 hour) from the user's locale. `locale` undefined = the system locale. */
export const TimeFormat = {
  is12Hour(locale?: string): boolean {
    const hc = new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions().hourCycle;
    return hc === 'h12' || hc === 'h11';
  },
  /** "15:00" or "3:00 PM" */
  clock(ms: number, locale?: string): string {
    return new Intl.DateTimeFormat(locale, { hour: TimeFormat.is12Hour(locale) ? 'numeric' : '2-digit', minute: '2-digit' }).format(ms).replace(/[  ]/g, ' ');
  },
  /** Patterns are written with a 24-hour clock ("EEE HH:mm"); swaps in the locale's own style. */
  localize(pattern: string, locale?: string): string {
    return pattern.includes('HH:mm') && TimeFormat.is12Hour(locale) ? pattern.replace('HH:mm', 'h:mm a') : pattern;
  },
};

export const PeopleOrder = {
  /** Pinned people first, then people past their 1:1 cadence (most overdue first), then by name. */
  sorted(s: PersonSummary[], pinned: Set<string>): PersonSummary[] {
    const urgency = (x: PersonSummary): number => {
      if (!x.cadenceOverdue || x.person.cadenceDays === null) return -1;
      const c = x.person.cadenceDays;
      return (x.daysSinceLast ?? c * 2) - c; // never met counts as twice the cadence
    };
    return [...s].sort((a, b) => {
      const pa = pinned.has(a.person.id), pb = pinned.has(b.person.id);
      if (pa !== pb) return pa ? -1 : 1;
      const ua = urgency(a), ub = urgency(b);
      if (ua !== ub) return ua > ub ? -1 : 1;
      return a.person.name.localeCompare(b.person.name, undefined, { sensitivity: 'accent' });
    });
  },
};

export const CadenceStrip = {
  /** One flag per week, oldest first, ending with the current week: was there a 1:1 that week? */
  weeks(dates: number[], now: number, count = 12): boolean[] {
    const thisWeek = startOfWeek(now);
    return Array.from({ length: count }, (_, i) => {
      const start = addDays(thisWeek, -7 * (count - 1 - i));
      const end = addDays(start, 7);
      return dates.some((d) => d >= start && d < end);
    });
  },
};

export const ItemAge = {
  /** Whole days since creation, for the "12d" badge on owes and waits. null under `minDays`. */
  badge(i: Pick<Item, 'kind' | 'createdAt'>, now: number, minDays = 3): number | null {
    if (i.kind !== 'owe' && i.kind !== 'wait') return null;
    const d = dayDiff(startOfDay(i.createdAt), startOfDay(now));
    return d >= minDays ? d : null;
  },
  /** 0 = fresh, 1 = a week or more, 2 = two weeks or more. Drives the badge colour. */
  level(days: number): number { return days >= 14 ? 2 : days >= 7 ? 1 : 0; },
};

export const RecurrenceText = {
  /** Human wording for the stored rule ("FREQ=WEEKLY;BYDAY=MO" -> "every Mon"). */
  describe(r: string): string {
    if (r.includes('BYDAY=MO,TU,WE,TH,FR')) return 'weekdays';
    const days: Record<string, string> = { MO: 'Mon', TU: 'Tue', WE: 'Wed', TH: 'Thu', FR: 'Fri', SA: 'Sat', SU: 'Sun' };
    const d = r.split('BYDAY=').pop()!;
    if (r.includes('BYDAY') && Object.hasOwn(days, d)) return `every ${days[d]}`;
    if (r.includes('INTERVAL=')) {
      const n = r.split('INTERVAL=').pop()!.split(';')[0]!;
      return `every ${n} ${r.includes('WEEKLY') ? 'weeks' : r.includes('MONTHLY') ? 'months' : 'days'}`;
    }
    return r.includes('MONTHLY') ? 'monthly' : r.includes('DAILY') ? 'daily' : 'weekly';
  },
};

export const QueryTerms = {
  /** The plain words of a search query, without filters like @person, kind:owe, before:2026-11-01. */
  words(q: string): string[] {
    return q.split(' ').filter((w) => w !== '' && !w.startsWith('@') && !w.includes(':') && [...w].length > 1).map((w) => w.toLowerCase());
  },
};

/** Back and forward through visited screens. */
export class NavHistory<T> {
  private _back: T[] = [];
  private _forward: T[] = [];
  get back(): readonly T[] { return this._back; }
  get forward(): readonly T[] { return this._forward; }
  get canGoBack(): boolean { return this._back.length > 0; }
  get canGoForward(): boolean { return this._forward.length > 0; }

  visit(from: T, to: T): void {
    if (from === to) return;
    this._back.push(from);
    this._forward = [];
    if (this._back.length > 50) this._back.shift();
  }
  goBack(current: T): T | null {
    const p = this._back.pop();
    if (p === undefined) return null;
    this._forward.push(current);
    return p;
  }
  goForward(current: T): T | null {
    const n = this._forward.pop();
    if (n === undefined) return null;
    this._back.push(current);
    return n;
  }
}

export const PinOrder = {
  /** Pinned items first, in the saved order (unknown ones keep their place after the known ones); the rest unchanged. */
  apply(items: Item[], order: string[]): Item[] {
    const rank = new Map(order.map((id, i) => [id, i]));
    const pinned = items.filter((i) => i.pinned).map((item, offset) => ({ item, offset }));
    pinned.sort((a, b) => {
      const ra = rank.get(a.item.id) ?? Infinity, rb = rank.get(b.item.id) ?? Infinity;
      return ra !== rb ? (ra < rb ? -1 : 1) : a.offset - b.offset;
    });
    return [...pinned.map((p) => p.item), ...items.filter((i) => !i.pinned)];
  },
  /** New saved order after dragging `id` onto `target`: it takes the target's place. */
  move(id: string, target: string, current: string[]): string[] {
    if (id === target) return current;
    const o = current.filter((x) => x !== id);
    const i = o.indexOf(target);
    if (i >= 0) o.splice(i, 0, id); else o.push(id);
    return o;
  },
};
