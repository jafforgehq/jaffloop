import { describe, expect, it } from 'vitest';
import { newItem } from '../src/core/pure';
import { DEFAULT_SETTINGS } from '../src/core/pure';
import { isQuiet, nextWorkStart, planNotifications } from '../src/main/notify-plan';

// TZ=UTC (vitest.config). Wed 2026-10-14 10:00 local
const at = (d: string, h = 0, m = 0) => new Date(`${d}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`).getTime();
const NOW = at('2026-10-14', 10, 0);
const people = new Map([['p1', 'Sara Lindqvist']]);
const plan = (items = [] as ReturnType<typeof newItem>[], o: { now?: number; notified?: string[]; s?: Partial<typeof DEFAULT_SETTINGS> } = {}) =>
  planNotifications({ items, people, settings: { ...DEFAULT_SETTINGS, ...o.s }, now: o.now ?? NOW, notified: new Set(o.notified ?? []) });

describe('quiet hours', () => {
  it('weekends and outside work hours are quiet', () => {
    expect(isQuiet(at('2026-10-17', 12), DEFAULT_SETTINGS)).toBe(true); // Saturday
    expect(isQuiet(at('2026-10-14', 8, 59), DEFAULT_SETTINGS)).toBe(true);
    expect(isQuiet(at('2026-10-14', 18, 1), DEFAULT_SETTINGS)).toBe(true);
    expect(isQuiet(at('2026-10-14', 18, 0), DEFAULT_SETTINGS)).toBe(false);
    expect(isQuiet(at('2026-10-14', 9, 0), DEFAULT_SETTINGS)).toBe(false);
  });
  it('next work start skips the weekend', () => {
    expect(nextWorkStart(at('2026-10-16', 19), DEFAULT_SETTINGS)).toBe(at('2026-10-19', 9)); // Fri evening -> Mon
    expect(nextWorkStart(at('2026-10-14', 7), DEFAULT_SETTINGS)).toBe(at('2026-10-14', 9));
  });
});

describe('reminders and due times', () => {
  it('a reminder is one notification with the person as body', () => {
    const i = newItem({ kind: 'owe', title: 'Send draft', personId: 'p1', remindAt: at('2026-10-14', 14), now: NOW });
    const p = plan([i]).filter((x) => x.kind === 'reminder');
    expect(p).toEqual([{ at: at('2026-10-14', 14), id: `item.${i.id}`, title: 'Send draft', body: 'Sara Lindqvist', kind: 'reminder', itemId: i.id }]);
  });
  it('a due time notifies only inside work hours; a reminder always does', () => {
    const late = newItem({ kind: 'task', title: 'late', dueAt: at('2026-10-14', 20), dueHasTime: true, now: NOW });
    const rem = newItem({ kind: 'task', title: 'rem', dueAt: at('2026-10-14', 20), dueHasTime: true, remindAt: at('2026-10-14', 20), now: NOW });
    expect(plan([late]).filter((x) => x.kind === 'reminder')).toEqual([]);
    expect(plan([rem]).filter((x) => x.kind === 'reminder')).toHaveLength(1);
  });
  it('things within 10 minutes of the first one become one batch of at most three titles', () => {
    const mk = (t: string, min: number) => newItem({ kind: 'task', title: t, dueAt: at('2026-10-14', 14, min), dueHasTime: true, now: NOW });
    const items = [mk('a', 0), mk('b', 5), mk('c', 9), mk('d', 9), mk('far', 10)];
    const p = plan(items).filter((x) => x.kind === 'reminder' || x.kind === 'batch');
    expect(p).toHaveLength(2);
    expect(p[0]).toMatchObject({ kind: 'batch', title: '4 things due', body: 'a · b · c', at: at('2026-10-14', 14) });
    expect(p[1]).toMatchObject({ kind: 'reminder', title: 'far' });
  });
  it('past times and non-open items are skipped, and nothing is earlier than 2 seconds from now', () => {
    const past = newItem({ kind: 'task', title: 'past', remindAt: NOW - 1000, now: NOW });
    const done = newItem({ kind: 'task', title: 'done', remindAt: NOW + 3600_000, status: 'done', now: NOW });
    const soon = newItem({ kind: 'task', title: 'soon', remindAt: NOW + 500, now: NOW });
    const p = plan([past, done, soon]).filter((x) => x.kind === 'reminder');
    expect(p).toHaveLength(1);
    expect(p[0]!.at).toBe(NOW + 2000);
  });
  it('plans at most 30 groups', () => {
    const items = Array.from({ length: 40 }, (_, k) => newItem({ kind: 'task', title: `t${k}`, remindAt: NOW + (k + 1) * 3600_000, now: NOW }));
    expect(plan(items).filter((x) => x.kind === 'reminder')).toHaveLength(30);
  });
});

describe('due today at 16:30', () => {
  it('counts open promises due that day, weekdays only', () => {
    const a = newItem({ kind: 'owe', title: 'a', dueAt: at('2026-10-14'), now: NOW });
    const b = newItem({ kind: 'owe', title: 'b', dueAt: at('2026-10-14', 11), dueHasTime: true, now: NOW });
    const t = newItem({ kind: 'task', title: 'not a promise', dueAt: at('2026-10-14'), now: NOW });
    const sat = newItem({ kind: 'owe', title: 'sat', dueAt: at('2026-10-17'), now: NOW });
    const fri = newItem({ kind: 'owe', title: 'fri', dueAt: at('2026-10-16'), now: NOW });
    const p = plan([a, b, t, sat, fri]).filter((x) => x.kind === 'due');
    expect(p.map((x) => [x.id, x.at, x.title])).toEqual([
      ['due.0', at('2026-10-14', 16, 30), '2 promises due today'],
      ['due.2', at('2026-10-16', 16, 30), '1 promise due today'],
    ]);
  });
  it('skips today once 16:30 has passed', () => {
    const a = newItem({ kind: 'owe', title: 'a', dueAt: at('2026-10-14'), now: NOW });
    expect(plan([a], { now: at('2026-10-14', 17) }).filter((x) => x.kind === 'due')).toEqual([]);
  });
});

describe('morning brief', () => {
  it('is planned for the next weekdays with counts', () => {
    const od = newItem({ kind: 'owe', title: 'late', dueAt: at('2026-10-12'), now: at('2026-10-01') });
    const p = plan([od], { now: at('2026-10-14', 9) }).filter((x) => x.kind === 'morning');
    // 08:30 today has passed: Thu, Fri, Mon, Tue, Wed(next) -> offsets 1,2,5,6
    expect(p.map((x) => x.id)).toEqual(['morning.1', 'morning.2', 'morning.5', 'morning.6']);
    expect(p[0]).toMatchObject({ at: at('2026-10-15', 8, 30), title: 'Morning brief', body: '1 overdue promise, 0 stale waits.' });
  });
  it('follows the setting', () => {
    const p = plan([], { s: { morningBrief: '07:45' }, now: at('2026-10-14', 6) }).filter((x) => x.kind === 'morning');
    expect(p[0]!.at).toBe(at('2026-10-14', 7, 45));
  });
});

describe('stale waiting-on', () => {
  const stale = () => newItem({ kind: 'wait', title: 'API spec', personId: 'p1', dueAt: at('2026-10-01'), now: at('2026-09-25') });
  it('notifies once per item, 30 seconds from now inside work hours', () => {
    const i = stale();
    const p = plan([i]).filter((x) => x.kind === 'stale');
    expect(p).toEqual([{ at: NOW + 30_000, id: `stale.${i.id}`, title: "Sara hasn't sent API spec", body: expect.stringMatching(/^Waiting since 25 /), kind: 'stale', itemId: i.id }]);
    expect(plan([i], { notified: [i.id] }).filter((x) => x.kind === 'stale')).toEqual([]);
  });
  it('waits for the next work start when it is quiet now', () => {
    const i = stale();
    const now = at('2026-10-16', 19);
    expect(plan([i], { now }).find((x) => x.kind === 'stale')!.at).toBe(at('2026-10-19', 9));
  });
  it('says Someone when the person is unknown', () => {
    const i = { ...stale(), personId: null };
    expect(plan([i]).find((x) => x.kind === 'stale')!.title).toBe("Someone hasn't sent API spec");
  });
});
