import { describe, expect, it } from 'vitest';
import {
  birthdayToInput, dateKey, dedupeSections, heatWeekStarts, inputToBirthday, keptLine, loadShares, localDay, reviewWindow, streakText, visibleDates,
  weekLabel, weekStart, wrapupDue,
} from '../src/renderer/reports-logic';
import type { Item, UpcomingDate } from '../src/shared/types';

const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const item = (id: string) => ({ id }) as Item;

describe('week windows', () => {
  it('starts weeks on Monday', () => {
    expect(weekStart(at(2026, 10, 15, 14))).toBe(at(2026, 10, 12)); // Thursday
    expect(weekStart(at(2026, 10, 18, 23))).toBe(at(2026, 10, 12)); // Sunday belongs to the week that began Monday
    expect(weekStart(at(2026, 10, 12))).toBe(at(2026, 10, 12));
  });
  it('this week has no end, last week ends at this Monday', () => {
    const now = at(2026, 10, 15, 9);
    expect(reviewWindow(0, now)).toEqual({ from: at(2026, 10, 12), to: undefined });
    expect(reviewWindow(-1, now)).toEqual({ from: at(2026, 10, 5), to: at(2026, 10, 12) });
  });
  it('labels', () => {
    const short = (ms: number, p: string) => `${p}@${new Date(ms).getDate()}`;
    const now = at(2026, 10, 15);
    expect(weekLabel(0, now, short)).toBe('EEE d MMM@12 to now');
    expect(weekLabel(-1, now, short)).toBe('d MMM@5 to d MMM@11');
  });
});

describe('kept rate line', () => {
  it('words and rounds', () => {
    expect(keptLine({ periodDays: 7, onTime: 11, late: 2, total: 13, rate: 11 / 13 })).toBe('11 of 13 promises kept on time, 85%');
    expect(keptLine({ periodDays: 7, onTime: 1, late: 0, total: 1, rate: 1 })).toBe('1 of 1 promise kept on time, 100%');
  });
  it('is null without closed promises', () => {
    expect(keptLine({ periodDays: 7, onTime: 0, late: 0, total: 0, rate: null })).toBeNull();
  });
});

describe('dedupeSections', () => {
  it('keeps an item in the first section only', () => {
    const r = dedupeSections({ overduePromises: [item('a'), item('b')], slipped: [item('b'), item('c')], staleWaits: [item('c'), item('d')] });
    expect(r.overdue.map((i) => i.id)).toEqual(['a', 'b']);
    expect(r.slipped.map((i) => i.id)).toEqual(['c']);
    expect(r.stale.map((i) => i.id)).toEqual(['d']);
  });
});

describe('wrapupDue', () => {
  const thu = (h: number, m = 0) => at(2026, 10, 15, h, m);
  it('fires after the end of day time on a weekday, once a day', () => {
    expect(wrapupDue(thu(17, 29), '17:30', '')).toBe(false);
    expect(wrapupDue(thu(17, 30), '17:30', '')).toBe(true);
    expect(wrapupDue(thu(20), '17:30', '2026-10-14')).toBe(true);
    expect(wrapupDue(thu(20), '17:30', localDay(thu(20)))).toBe(false);
  });
  it('never on weekends or with a malformed time', () => {
    expect(wrapupDue(at(2026, 10, 17, 18), '17:30', '')).toBe(false); // Saturday
    expect(wrapupDue(at(2026, 10, 18, 18), '17:30', '')).toBe(false); // Sunday
    expect(wrapupDue(thu(18), 'soon', '')).toBe(false);
  });
});

describe('heat grid and load', () => {
  it('week starts run oldest to newest and end on the current week', () => {
    const w = heatWeekStarts(at(2026, 10, 15), 12);
    expect(w).toHaveLength(12);
    expect(w[11]).toBe(at(2026, 10, 12));
    expect(w[10]).toBe(at(2026, 10, 5));
  });
  it('scales load by the busiest person and survives an empty team', () => {
    const p = (id: string, openOwe: number, openWait: number) => ({ person: { id } as never, openOwe, openWait });
    const m = loadShares([p('a', 3, 1), p('b', 1, 0), p('c', 0, 0)]);
    expect(m.get('a')).toEqual({ owe: 75, wait: 25 });
    expect(m.get('b')).toEqual({ owe: 25, wait: 0 });
    expect(m.get('c')).toEqual({ owe: 0, wait: 0 });
    expect(loadShares([]).size).toBe(0);
  });
});

describe('person dates', () => {
  it('streak text hides at zero', () => {
    expect(streakText(0)).toBeNull();
    expect(streakText(null)).toBeNull();
    expect(streakText(1)).toBe('On cadence 1 week in a row');
    expect(streakText(9)).toBe('On cadence 9 weeks in a row');
  });
  it('birthday round trips through a date input and keeps 02-29', () => {
    expect(birthdayToInput('03-04')).toBe('2000-03-04');
    expect(birthdayToInput('02-29')).toBe('2000-02-29');
    expect(birthdayToInput(null)).toBe('');
    expect(inputToBirthday('1987-03-04')).toBe('03-04');
    expect(inputToBirthday('')).toBeNull();
  });
  it('shows at most three undismissed chips', () => {
    const u = (n: number): UpcomingDate => ({ personId: `p${n}`, kind: 'birthday', on: n, inDays: n, years: null });
    const list = [u(1), u(2), u(3), u(4), u(5)];
    expect(visibleDates(list, new Set([dateKey(u(2))])).map((x) => x.personId)).toEqual(['p1', 'p3', 'p4']);
  });
});
