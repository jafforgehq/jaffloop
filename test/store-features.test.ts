// Store methods added in 0.2.0: review, keptRate, activity, heatGrid, onTimeStreak, upcomingDates, captureMany, new settings, demo seed.
import { beforeEach, describe, expect, it } from 'vitest';
import { Store, newItem, newPerson, openMemoryDatabase } from '../src/core';
import { seed } from '../src/core/seed';
import { DEFAULT_SETTINGS, expandTemplate, linkify, upcomingLabel } from '../src/core/pure';
import { toDbDate } from '../src/core/db';

const DAY = 86_400_000;
const d = (m: number, day: number, h = 12, min = 0): number => Date.UTC(2026, m - 1, day, h, min);
const NOW = d(10, 15, 12);               // Thursday 15 Oct 2026, 12:00 (TZ=UTC; the week started Monday 12 Oct)

let store: Store;
beforeEach(() => { store = new Store(openMemoryDatabase()); });

/** An owe created at `created`, completed at `done` (null = left open). */
function owe(title: string, o: { due?: number | null; time?: boolean; created?: number; done?: number | null; person?: string } = {}): string {
  const p = o.person ? store.person(o.person)!.id : null;
  const i = newItem({ kind: 'owe', title, personId: p, dueAt: o.due ?? null, dueHasTime: o.time ?? false, now: o.created ?? d(10, 1) });
  store.insert(i, []);
  if (o.done !== undefined && o.done !== null) store.complete(i.id, o.done);
  return i.id;
}
const meet = (handle: string, ...at: number[]): void => { const id = store.person(handle)!.id; for (const t of at) store.logInteraction(id, '1on1', null, t); };
const setCadence = (handle: string, cadenceDays: number | null): void => { store.savePerson({ ...store.person(handle)!, cadenceDays }); };

describe('settings: jiraBaseUrl and captureTemplates', () => {
  it('defaults', () => {
    expect(store.settings()).toEqual(DEFAULT_SETTINGS);
    expect(store.settings().jiraBaseUrl).toBe('');
    expect(store.settings().captureTemplates).toEqual([]);
    expect(store.settings().captureTemplates).not.toBe(DEFAULT_SETTINGS.captureTemplates);
  });
  it('round trip', () => {
    const s = store.settings();
    s.jiraBaseUrl = 'https://acme.atlassian.net/browse/';
    s.captureTemplates = [{ name: 'prep', lines: ['bring @{person} a', 'bring @{person} b'] }, { name: 'fu', lines: ['wait @{person} {rest}'] }];
    store.saveSettings(s);
    expect(store.settings()).toEqual(s);
    expect(store.db.prepare("SELECT value FROM settings WHERE key = 'captureTemplates'").get()).toEqual({ value: JSON.stringify(s.captureTemplates) });
  });
  it('invalid JSON or the wrong shape reads as []', () => {
    const put = (v: string): void => { store.db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('captureTemplates', ?)").run(v); };
    for (const bad of ['{not json', '', '"text"', '{"name":"x"}', 'null', '42']) { put(bad); expect(store.settings().captureTemplates, bad).toEqual([]); }
    put(JSON.stringify([{ name: 'ok', lines: ['a', 7] }, { name: 3, lines: [] }, { lines: [] }, 'x', { name: 'nolines' }]));
    expect(store.settings().captureTemplates).toEqual([{ name: 'ok', lines: ['a'] }]);
  });
  it('a caller that omits the new fields does not break saving', () => {
    const { jiraBaseUrl: _j, captureTemplates: _c, ...old } = store.settings();
    expect(() => store.saveSettings(old as never)).not.toThrow();
    expect(store.settings()).toEqual(DEFAULT_SETTINGS);
  });
});

describe('person dates', () => {
  it('startDate and birthday default to null and persist', () => {
    expect(newPerson({ handle: 'a', name: 'A' })).toMatchObject({ startDate: null, birthday: null });
    const p = store.person('sara')!;
    expect(p).toMatchObject({ startDate: null, birthday: null });
    store.savePerson({ ...p, startDate: '2024-03-04', birthday: '11-09' });
    expect(store.person('sara')).toMatchObject({ startDate: '2024-03-04', birthday: '11-09' });
    expect(store.people()[0]).toMatchObject({ startDate: '2024-03-04', birthday: '11-09' });
    expect(store.personById(p.id)).toMatchObject({ startDate: '2024-03-04', birthday: '11-09' });
    store.savePerson({ ...p, startDate: null, birthday: null });
    expect(store.person('sara')).toMatchObject({ startDate: null, birthday: null });
  });
});

describe('keptRate', () => {
  it('counts completed owes in the period: on time vs late, null rate when nothing', () => {
    expect(store.keptRate(14, NOW)).toEqual({ periodDays: 14, onTime: 0, late: 0, total: 0, rate: null });
    owe('no due', { done: d(10, 14) });
    owe('on its due day, evening', { due: d(10, 13, 0), done: d(10, 13, 23, 59) });
    owe('day after', { due: d(10, 12, 0), done: d(10, 13, 0, 0) });
    owe('timed, on the minute', { due: d(10, 14, 9), time: true, done: d(10, 14, 9) });
    owe('timed, a minute late', { due: d(10, 14, 9), time: true, done: d(10, 14, 9, 1) });
    owe('early', { due: d(10, 20), done: d(10, 14) });
    expect(store.keptRate(14, NOW)).toEqual({ periodDays: 14, onTime: 4, late: 2, total: 6, rate: 4 / 6 });
  });
  it('ignores other kinds, open and dropped items and completions outside the period', () => {
    const t = store.capture('wait @sara x', 'hotkey', d(10, 5)); store.complete(t.id, d(10, 14));
    const todo = store.capture('todo y', 'hotkey', d(10, 5)); store.complete(todo.id, d(10, 14));
    owe('open one', { due: d(10, 1) });
    const dropped = owe('dropped'); store.drop(dropped, d(10, 14));
    owe('too old', { done: d(9, 20) });
    owe('in the future', { done: d(10, 20) });
    owe('inside', { done: d(10, 9) });
    expect(store.keptRate(7, NOW)).toMatchObject({ total: 1, onTime: 1, late: 0, rate: 1 });
    expect(store.keptRate(30, NOW)).toMatchObject({ total: 2 });     // 'too old' is Sep 20: 25 days before
    expect(store.keptRate(1, NOW).total).toBe(0);
  });
});

describe('review', () => {
  beforeEach(() => {
    store.saveSettings({ ...store.settings(), staleDaysAfterDue: 3 });
    // people: sara 14 days since the last 1:1 on a weekly cadence, amir 9 days, priya fine
    for (const [h, c, last] of [['sara', 7, d(10, 1)], ['amir', 7, d(10, 6)], ['priya', 14, d(10, 10)]] as const) { store.person(h); setCadence(h, c); meet(h, last); }
  });
  it('lists what is wrong now and what happened in the window', () => {
    const closed = owe('closed in window', { person: 'sara', due: d(10, 14, 0), created: d(10, 8), done: d(10, 13, 9) });
    owe('closed before window', { created: d(10, 2), done: d(10, 9) });
    const late = owe('closed late', { due: d(10, 5, 0), created: d(10, 2), done: d(10, 14) });
    const created = owe('new in window', { created: d(10, 13) });
    const overdue = owe('overdue promise', { due: d(10, 10, 0), created: d(10, 5), person: 'amir' });
    owe('not yet due', { due: d(10, 16, 0), created: d(10, 5) });
    const dropped = owe('dropped in window', { created: d(10, 5) }); store.drop(dropped, d(10, 14));
    const droppedBefore = owe('dropped before', { created: d(10, 5) }); store.drop(droppedBefore, d(10, 9));
    const slipped = store.capture('todo slippery', 'hotkey', d(10, 6));
    for (let k = 0; k < 3; k++) store.snooze(slipped.id, d(10, 20), d(10, 7));      // snoozed into the future: still listed
    const wait = newItem({ kind: 'wait', title: 'stale wait', dueAt: d(10, 1, 0), now: d(9, 25) }); store.insert(wait);
    store.insert(newItem({ kind: 'wait', title: 'fresh wait', dueAt: d(10, 20, 0), now: d(10, 10) }));

    const r = store.review(d(10, 12, 0), undefined, NOW);
    expect(r.from).toBe(d(10, 12, 0)); expect(r.to).toBe(NOW);
    expect(r.closed.map((i) => i.id)).toEqual([closed, late]);
    expect(r.dropped.map((i) => i.id)).toEqual([dropped]);
    expect(r.created.map((i) => i.id)).toContain(created);
    expect(r.created.map((i) => i.title)).not.toContain('closed before window');
    expect(r.overduePromises.map((i) => i.id)).toEqual([overdue]);
    expect(r.slipped.map((i) => i.id)).toEqual([slipped.id]);
    expect(r.staleWaits.map((i) => i.id)).toEqual([wait.id]);
    expect(r.offCadence.map((s) => [s.person.handle, s.daysSinceLast])).toEqual([['sara', 14], ['amir', 9]]);
    expect(r.keptRate).toEqual({ periodDays: 4, onTime: 1, late: 1, total: 2, rate: 0.5 });
  });
  it('a window with an explicit end judges open items as of that end', () => {
    owe('due Oct 10', { due: d(10, 10, 0), created: d(10, 5) });
    expect(store.review(d(10, 5, 0), d(10, 9, 12), NOW).overduePromises).toEqual([]);
    expect(store.review(d(10, 5, 0), d(10, 11, 12), NOW).overduePromises).toHaveLength(1);
    expect(store.review(d(10, 5, 0), d(10, 9, 12), NOW).keptRate).toMatchObject({ periodDays: 5, total: 0, rate: null });
    expect(store.review(d(10, 12, 0), d(10, 19, 0), NOW).keptRate.periodDays).toBe(7);
  });
  it('the window is [from, to): the end is exclusive, the start inclusive', () => {
    owe('at start', { created: d(10, 12, 0), done: d(10, 12, 0) });
    owe('at end', { created: d(10, 19, 0), done: d(10, 19, 0) });
    const r = store.review(d(10, 12, 0), d(10, 19, 0), NOW);
    expect(r.closed.map((i) => i.title)).toEqual(['at start']);
    expect(r.created.map((i) => i.title)).toEqual(['at start']);
  });
  it('an empty database gives an empty review', () => {
    const r = new Store(openMemoryDatabase()).review(d(10, 12, 0), undefined, NOW);
    expect(r).toMatchObject({ slipped: [], staleWaits: [], overduePromises: [], offCadence: [], closed: [], dropped: [], created: [] });
    expect(r.keptRate.rate).toBeNull();
  });
});

describe('activity', () => {
  it('one entry per event, newest first, joined with the item as it is now', () => {
    const a = store.capture('owe @sara alpha', 'hotkey', d(10, 13, 9));
    const b = store.capture('todo beta', 'hotkey', d(10, 13, 10));
    store.complete(a.id, d(10, 14, 9));
    store.snooze(b.id, d(10, 20), d(10, 14, 10));
    store.drop(b.id, d(10, 14, 11));
    const log = store.activity(d(10, 13, 0), 100, NOW);
    expect(log.map((e) => [e.event, e.item.title])).toEqual([['dropped', 'beta'], ['snoozed', 'beta'], ['completed', 'alpha'], ['created', 'beta'], ['created', 'alpha']]);
    expect(log[0]!.at).toBe(d(10, 14, 11));
    expect(log[0]!.item.status).toBe('dropped');          // the current row, not a snapshot
    expect(log[2]!.item.status).toBe('done');
  });
  it('from and limit, events after now are left out', () => {
    const a = store.capture('todo one', 'hotkey', d(10, 10));
    store.complete(a.id, d(10, 14));
    store.capture('todo two', 'hotkey', d(10, 16));
    expect(store.activity(d(10, 11), 100, NOW).map((e) => e.event)).toEqual(['completed']);
    expect(store.activity(0, 1, NOW)).toHaveLength(1);
    expect(store.activity(0, 100, NOW)).toHaveLength(2);
    expect(store.activity(d(10, 15), 100, NOW)).toEqual([]);
  });
  it('same-instant events keep insertion order, newest first', () => {
    const a = store.capture('todo one', 'hotkey', d(10, 14));
    store.snooze(a.id, d(10, 20), d(10, 14)); store.drop(a.id, d(10, 14));
    expect(store.activity(0, 10, NOW).map((e) => e.event)).toEqual(['dropped', 'snoozed', 'created']);
  });
  it('unknown event names show as edited', () => {
    const a = store.capture('todo one', 'hotkey', d(10, 14));
    store.db.prepare("INSERT INTO item_events(item_id, at, event, detail) VALUES(?,?,?,?)").run(a.id, toDbDate(d(10, 14, 13)), 'retitled', 'x');
    store.db.prepare("INSERT INTO item_events(item_id, at, event, detail) VALUES(?,?,?,?)").run(a.id, toDbDate(d(10, 14, 14)), 'reopened', null);
    expect(store.activity(0, 10, NOW).map((e) => e.event)).toEqual(['reopened', 'edited', 'created']);
  });
  it('a recurring completion logs the completion and the new occurrence', () => {
    const i = store.capture('todo standup every day', 'hotkey', d(10, 14));
    store.complete(i.id, d(10, 14, 13));
    expect(store.activity(0, 10, NOW).map((e) => e.event).sort()).toEqual(['completed', 'created', 'created']);
  });
});

describe('heatGrid', () => {
  it('one row per active person by name, one flag per week, oldest first', () => {
    for (const h of ['zoe', 'amir', 'sara']) store.person(h);
    store.savePerson({ ...store.person('zoe')!, archived: true });
    meet('sara', d(10, 14), d(10, 1), d(9, 14));               // this week, 2 weeks ago, 4 weeks ago
    meet('amir', d(10, 11, 23, 59), d(10, 12, 0));             // Sunday last week, Monday 00:00 this week
    const g = store.heatGrid(5, NOW);
    expect(g.map((r) => r.personId)).toEqual([store.person('amir')!.id, store.person('sara')!.id]);
    expect(g[0]!.weeks).toEqual([false, false, false, true, true]);
    expect(g[1]!.weeks).toEqual([true, false, true, false, true]);
    expect(store.heatGrid(undefined, NOW)[0]!.weeks).toHaveLength(12);
  });
  it('interactions of any kind count, older ones do not, nobody gives []', () => {
    expect(store.heatGrid(3, NOW)).toEqual([]);
    const id = store.person('sara')!.id;
    store.logInteraction(id, 'chat', null, d(10, 13));
    store.logInteraction(id, '1on1', null, d(9, 1));
    expect(store.heatGrid(3, NOW)[0]!.weeks).toEqual([false, false, true]);
  });
});

describe('onTimeStreak', () => {
  const streak = (now = NOW): number => store.onTimeStreak(store.person('sara')!.id, now);
  beforeEach(() => { store.person('sara'); });

  it('0 without a cadence, without interactions, or for an unknown person', () => {
    meet('sara', d(10, 13));
    expect(streak()).toBe(0);
    setCadence('sara', 7);
    expect(store.onTimeStreak('nobody', NOW)).toBe(0);
    store.person('amir'); setCadence('amir', 7);
    expect(store.onTimeStreak(store.person('amir')!.id, NOW)).toBe(0);
  });
  it('weekly 1:1s on time: the current week counts because it was met', () => {
    setCadence('sara', 7);
    meet('sara', d(10, 13), d(10, 6), d(9, 29), d(9, 22));
    expect(streak()).toBe(4);                         // weeks of Oct 12, Oct 5, Sep 28, Sep 21; Sep 14 is before the first 1:1
  });
  it('the current week is not counted until met, but does not break the run while still within cadence', () => {
    setCadence('sara', 7);
    meet('sara', d(10, 6), d(9, 29));
    expect(streak(d(10, 12, 12))).toBe(2);            // Monday: 6 days since Oct 6
    expect(streak(d(10, 13, 12))).toBe(2);            // Tuesday: 7 days: still within
    expect(streak(d(10, 14, 12))).toBe(0);            // Wednesday: 8 days, overdue
  });
  it('a late 1:1 breaks the run at the week where the gap was too long', () => {
    setCadence('sara', 7);
    meet('sara', d(10, 13), d(10, 6), d(9, 29), d(9, 18), d(9, 8));   // Sep 18 -> Sep 29 is 11 days
    expect(streak()).toBe(2);                         // weeks of Oct 12 and Oct 5; in the week of Sep 28 the 1:1 came 11 days after the one before
  });
  it('late in a past week: the weeks after it count, the late week does not', () => {
    setCadence('sara', 7);
    meet('sara', d(10, 13), d(10, 6), d(9, 24), d(9, 15));            // Sep 24 -> Oct 6: 12 days
    expect(streak()).toBe(1);                         // current week met; week of Oct 5 had the 12-day gap
  });
  it('a long gap without any 1:1 breaks it too', () => {
    setCadence('sara', 7);
    meet('sara', d(10, 13), d(9, 1));
    expect(streak()).toBe(0);
  });
  it('biweekly cadence: weeks without a 1:1 still count while the gap holds', () => {
    setCadence('sara', 14);
    meet('sara', d(10, 6), d(9, 22), d(9, 8));
    expect(streak()).toBe(5);                         // current (not met, +0), then Oct 5, Sep 28, Sep 21, Sep 14, Sep 7
  });
  it('interactions in the future are ignored', () => {
    setCadence('sara', 7);
    meet('sara', d(10, 13), d(10, 25));
    expect(streak()).toBe(1);
  });
});

describe('upcomingDates', () => {
  const person = (handle: string, startDate: string | null, birthday: string | null, extra: object = {}): void => {
    store.savePerson({ ...store.person(handle)!, startDate, birthday, ...extra });
  };
  it('anniversary needs at least one year, birthday has no years, sorted by date', () => {
    store.person('sara'); store.person('amir'); store.person('maya'); store.person('new');
    person('sara', '2024-10-18', null);              // 2-year anniversary in 3 days
    person('amir', null, '10-16');                    // tomorrow
    person('maya', '2020-10-15', '10-15');            // today, both
    person('new', '2026-10-17', null);                // started this year: no anniversary yet
    const u = store.upcomingDates(14, NOW);
    expect(u.map((x) => [x.personId === store.person('sara')!.id ? 'sara' : x.personId === store.person('amir')!.id ? 'amir' : 'maya', x.kind, x.inDays, x.years])).toEqual([
      ['maya', 'anniversary', 0, 6], ['maya', 'birthday', 0, null], ['amir', 'birthday', 1, null], ['sara', 'anniversary', 3, 2]]);
    expect(u.map((x) => x.on)).toEqual([d(10, 15, 0), d(10, 15, 0), d(10, 16, 0), d(10, 18, 0)]);
    expect(u.find((x) => x.kind === 'birthday' && x.inDays === 1)!.on).toBe(Date.UTC(2026, 9, 16));
  });
  it('withinDays limits, 0 is today only, people without dates and archived people are ignored', () => {
    store.person('sara'); store.person('amir'); store.person('old');
    person('sara', null, '10-29'); person('amir', null, '10-15'); person('old', null, '10-15', { archived: true });
    expect(store.upcomingDates(14, NOW).map((x) => x.inDays)).toEqual([0, 14]);
    expect(store.upcomingDates(13, NOW).map((x) => x.inDays)).toEqual([0]);
    expect(store.upcomingDates(0, NOW).map((x) => x.inDays)).toEqual([0]);
    expect(store.upcomingDates(undefined, NOW)).toHaveLength(2);
  });
  it('dates that already passed this year roll over to the next', () => {
    store.person('sara'); person('sara', '2020-10-14', '10-14');
    const u = store.upcomingDates(400, NOW);
    expect(u.map((x) => [x.kind, x.inDays, x.years, x.on])).toEqual([['anniversary', 364, 7, Date.UTC(2027, 9, 14)], ['birthday', 364, null, Date.UTC(2027, 9, 14)]]);
    expect(store.upcomingDates(14, NOW)).toEqual([]);
  });
  it('across new year', () => {
    store.person('sara'); person('sara', '2025-01-02', '01-03');
    const u = store.upcomingDates(14, d(12, 28, 12));
    expect(u.map((x) => [x.kind, x.inDays, x.years])).toEqual([['anniversary', 5, 2], ['birthday', 6, null]]);
  });
  it('Feb 29 is Feb 28 in a year without one, and Feb 29 in a leap year', () => {
    store.person('sara'); person('sara', '2020-02-29', '02-29');
    const nowFeb = d(2, 20, 12);                                     // 2026: no Feb 29
    expect(store.upcomingDates(14, nowFeb).map((x) => [x.kind, x.inDays, x.years, x.on])).toEqual([
      ['anniversary', 8, 6, Date.UTC(2026, 1, 28)], ['birthday', 8, null, Date.UTC(2026, 1, 28)]]);
    const leap = store.upcomingDates(14, Date.UTC(2028, 1, 20, 12));
    expect(leap.map((x) => [x.inDays, x.years, x.on])).toEqual([[9, 8, Date.UTC(2028, 1, 29)], [9, null, Date.UTC(2028, 1, 29)]]);
  });
  it('garbage dates are skipped', () => {
    store.person('sara'); person('sara', 'yesterday', '13-40');
    person('sara', '2020-13-01', '02-30');
    expect(store.upcomingDates(400, NOW)).toEqual([]);
  });
  it('feeds upcomingLabel', () => {
    store.person('sara'); person('sara', '2024-10-18', null);
    expect(upcomingLabel(store.upcomingDates(14, NOW)[0]!, 'Sara')).toBe("Sara's 2-year work anniversary is in 3 days");
  });
});

describe('captureMany', () => {
  beforeEach(() => {
    store.saveSettings({ ...store.settings(), captureTemplates: [
      { name: 'prep', lines: ['bring @{person} how things are going', 'bring @{person} career goals', 'bring @{person} feedback'] },
      { name: 'fu', lines: ['wait @{person} {rest} fri'] },
    ] });
  });
  it('creates every template line for the person, in one go', () => {
    const items = store.captureMany('prep @sara', NOW);
    expect(items.map((i) => [i.kind, i.title])).toEqual([['bring', 'how things are going'], ['bring', 'career goals'], ['bring', 'feedback']]);
    expect(items.every((i) => i.personId === store.person('sara')!.id && i.createdAt === NOW && i.source === 'hotkey')).toBe(true);
    expect(store.items({ kinds: ['bring'] })).toHaveLength(3);
    expect(store.activity(0, 10, NOW).filter((e) => e.event === 'created')).toHaveLength(3);
  });
  it('{rest} lands in the item and the due date parses', () => {
    const [i] = store.captureMany('fu @amir the API spec', NOW);
    expect(i).toMatchObject({ kind: 'wait', title: 'the API spec' });
    expect(i!.dueAt).not.toBeNull();
  });
  it('without a template, without a handle or with a plain line it is capture', () => {
    expect(store.captureMany('prep for the week', NOW).map((i) => i.title)).toEqual(['prep for the week']);
    expect(store.captureMany('owe @sara review RFC fri', NOW)).toHaveLength(1);
    expect(store.items({}, NOW)).toHaveLength(2);
    expect(store.captureMany('prep', NOW)[0]!.kind).toBe('task');
  });
  it('an empty template falls back to capturing the line', () => {
    store.saveSettings({ ...store.settings(), captureTemplates: [{ name: 'empty', lines: [] }] });
    expect(store.captureMany('empty @sara', NOW)).toHaveLength(1);
  });
  it('the source is passed on', () => {
    expect(store.captureMany('prep @sara', NOW, 'mcp').every((i) => i.source === 'mcp')).toBe(true);
  });
  it('all or nothing: nothing is saved when a line fails', () => {
    store.db.exec("CREATE TRIGGER boom BEFORE INSERT ON items WHEN new.title = 'feedback' BEGIN SELECT RAISE(ABORT, 'boom'); END");
    expect(() => store.captureMany('prep @sara', NOW)).toThrow();
    expect(store.items({ status: null })).toEqual([]);
  });
});

describe('demo seed shows the 0.2.0 features', () => {
  it('has dates, templates, Jira base, links and kept promises', () => {
    seed(store, NOW);
    const s = store.settings();
    expect(s.jiraBaseUrl).toBe('https://acme.atlassian.net/browse/');
    expect(s.captureTemplates.map((t) => t.name)).toEqual(['prep', 'fu']);
    expect(s.captureTemplates[0]!.lines).toHaveLength(3);
    expect(s.captureTemplates.every((t) => t.lines.every((l) => l.includes('{person}')))).toBe(true);
    expect(s.captureTemplates[1]!.lines[0]).toContain('{rest}');
    expect(expandTemplate('prep @priya', s.captureTemplates)).toHaveLength(3);

    const u = store.upcomingDates(14, NOW);
    expect(u.map((x) => [x.kind, x.inDays, x.years])).toEqual([['birthday', 1, null], ['anniversary', 3, 2]]);

    const titles = store.items({ status: null, includeSnoozed: true }, NOW).map((i) => i.title);
    expect(titles).toContain('Review PLAT-482 rollout plan');
    expect(titles).toContain('Read https://example.com/rfc-12 before Friday');
    expect(linkify('Review PLAT-482 rollout plan', s.jiraBaseUrl).some((x) => x.href === s.jiraBaseUrl + 'PLAT-482')).toBe(true);

    const k = store.keptRate(14, NOW);
    expect(k.late).toBe(1);
    expect(k.onTime).toBeGreaterThanOrEqual(6);
    expect(k.rate!).toBeGreaterThan(0.8);
    const r = store.review(NOW - 14 * DAY, undefined, NOW);
    expect(r.closed.length).toBeGreaterThanOrEqual(7);
    expect(r.overduePromises.length).toBeGreaterThan(0);
    expect(r.staleWaits.length).toBeGreaterThan(0);
    expect(r.offCadence.length).toBeGreaterThan(0);
    expect(store.activity(NOW - 14 * DAY, 100, NOW).some((e) => e.event === 'completed')).toBe(true);
  });
});
