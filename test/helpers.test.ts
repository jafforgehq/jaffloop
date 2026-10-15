import { describe, expect, it } from 'vitest';
import {
  AppVersion, CadenceStrip, ItemAge, NavHistory, PeopleOrder, PinOrder, QueryTerms, RecurrenceText, TimeFormat, newItem, newPerson,
  hm, hotkeyToAccelerator, nextOccurrence, nextFutureOccurrence, nameFromHandle, personInitials, personEmails,
  addMonths, addDays, startOfWeek,
} from '../src/core/pure';
import type { PersonSummary } from '../src/shared/types';

const now = 1_800_000_000_000;
const DAY = 86_400_000;
const v = (s: string) => AppVersion.parse(s)!;

describe('HelperTests', () => {
  it('version compare', () => {
    expect(v('0.0.3').gt(v('0.0.2'))).toBe(true);
    expect(v('v0.1').gt(v('0.0.9'))).toBe(true);
    expect(v('1.0').eq(v('1.0.0'))).toBe(true);
    expect(AppVersion.parse('dev')).toBeNull();
    expect(v('v0.0.3').toString()).toBe('0.0.3');
  });
  it('localized clock', () => {
    expect(TimeFormat.localize('HH:mm', 'en-US')).toContain('a');
    expect(TimeFormat.localize('HH:mm', 'en-GB')).toContain('HH');
    expect(TimeFormat.localize('EEE', 'en-US'), 'no time part, unchanged').toBe('EEE');
  });
  const summary = (name: string, cadence: number | null, days: number | null, overdue: boolean): PersonSummary => ({
    person: newPerson({ handle: name.toLowerCase(), name, cadenceDays: cadence }), lastInteraction: null, openOwe: 0, openWait: 0,
    daysSinceLast: days, cadenceOverdue: overdue,
  });
  it('people order', () => {
    const a = summary('Amir', 7, 3, false);
    const b = summary('Bea', 14, 23, true);   // 9 days late
    const c = summary('Cy', 7, 30, true);     // 23 days late
    const d = summary('Dee', null, null, false);
    expect(PeopleOrder.sorted([a, b, c, d], new Set([d.person.id])).map((x) => x.person.name)).toEqual(['Dee', 'Cy', 'Bea', 'Amir']);
  });
  it('cadence strip', () => {
    const w = CadenceStrip.weeks([now - DAY, now - 15 * DAY], now, 4);
    expect(w).toHaveLength(4);
    expect(w).toContain(true);
    expect(CadenceStrip.weeks([], now, 3)).toEqual([false, false, false]);
  });
  it('age badge', () => {
    const old = newItem({ kind: 'wait', title: 'x', now: now - 12 * DAY });
    expect(ItemAge.badge(old, now)).toBe(12);
    expect(ItemAge.badge(newItem({ kind: 'wait', title: 'x', now: now - DAY }), now)).toBeNull();
    expect(ItemAge.badge(newItem({ kind: 'task', title: 'x', now: now - 12 * DAY }), now)).toBeNull();
  });
});

describe('MoreHelperTests', () => {
  it('recurrence text', () => {
    expect(RecurrenceText.describe('FREQ=WEEKLY;BYDAY=MO')).toBe('every Mon');
    expect(RecurrenceText.describe('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR')).toBe('weekdays');
    expect(RecurrenceText.describe('FREQ=MONTHLY')).toBe('monthly');
    expect(RecurrenceText.describe('FREQ=WEEKLY;INTERVAL=2')).toBe('every 2 weeks');
    expect(RecurrenceText.describe('FREQ=DAILY')).toBe('daily');
  });
  it('age level and query terms', () => {
    expect([ItemAge.level(3), ItemAge.level(7), ItemAge.level(14)]).toEqual([0, 1, 2]);
    expect(QueryTerms.words('@sara kind:owe review RFC before:2026-11-01 x')).toEqual(['review', 'rfc']);
  });
  it('nav history', () => {
    const h = new NavHistory<string>();
    h.visit('today', 'ledger'); h.visit('ledger', 'inbox');
    expect(h.goBack('inbox')).toBe('ledger');
    expect(h.goBack('ledger')).toBe('today');
    expect(h.goBack('today')).toBeNull();
    expect(h.goForward('today')).toBe('ledger');
    h.visit('ledger', 'people');
    expect(h.canGoForward, 'a new visit clears forward').toBe(false);
    h.visit('people', 'people');
    expect(h.back).toEqual(['today', 'ledger']);
  });
  it('pin order', () => {
    const item = (t: string, pinned: boolean) => ({ ...newItem({ kind: 'task', title: t }), id: t, pinned });
    const items = [item('a', true), item('b', false), item('c', true), item('d', true)];
    expect(PinOrder.apply(items, ['d', 'a']).map((i) => i.id)).toEqual(['d', 'a', 'c', 'b']);
    expect(PinOrder.apply(items, []).map((i) => i.id)).toEqual(['a', 'c', 'd', 'b']);
    expect(PinOrder.move('d', 'a', ['a', 'c', 'd'])).toEqual(['d', 'a', 'c']);
    expect(PinOrder.move('a', 'a', ['a', 'c'])).toEqual(['a', 'c']);
  });
});

describe('settings and model helpers', () => {
  it('hm', () => { expect(hm('17:30')).toEqual([17, 30]); expect(hm('9')).toEqual([9, 0]); expect(hm('')).toEqual([0, 0]); });
  it('legacy hotkeys become accelerators', () => {
    expect(hotkeyToAccelerator('opt+space')).toBe('Alt+Space');
    expect(hotkeyToAccelerator('ctrl+opt+space')).toBe('Control+Alt+Space');
    expect(hotkeyToAccelerator('cmd+shift+space')).toBe('Command+Shift+Space');
    expect(hotkeyToAccelerator('opt+cmd+j')).toBe('Alt+Command+J');
    expect(hotkeyToAccelerator('ctrl+space')).toBe('Control+Space');
    expect(hotkeyToAccelerator('Alt+Space')).toBe('Alt+Space');
    expect(hotkeyToAccelerator('CommandOrControl+Shift+K')).toBe('CommandOrControl+Shift+K');
  });
  it('people helpers', () => {
    expect(nameFromHandle('sara.lee_x-y')).toBe('Sara Lee X Y');
    expect(personInitials({ name: 'Sara Lee' })).toBe('SL'); expect(personInitials({ name: 'sara' })).toBe('SA');
    expect(personEmails({ matchEmails: ' A@x.com, ,b@y.com' })).toEqual(['a@x.com', 'b@y.com']);
  });
  it('calendar math clamps months and starts weeks on Monday', () => {
    expect(addMonths(Date.UTC(2026, 0, 31), 1)).toBe(Date.UTC(2026, 1, 28));
    expect(addDays(Date.UTC(2026, 9, 31, 8), 1)).toBe(Date.UTC(2026, 10, 1, 8));
    expect(startOfWeek(Date.UTC(2026, 9, 18, 12))).toBe(Date.UTC(2026, 9, 12)); // Sunday -> Monday before
  });
  it('recurrence', () => {
    const wed = Date.UTC(2026, 9, 14, 9);
    expect(nextOccurrence(wed, 'FREQ=DAILY')).toBe(Date.UTC(2026, 9, 15, 9));
    expect(nextOccurrence(wed, 'FREQ=WEEKLY;BYDAY=MO')).toBe(Date.UTC(2026, 9, 21, 9));
    expect(nextOccurrence(wed, 'FREQ=WEEKLY;INTERVAL=2')).toBe(Date.UTC(2026, 9, 28, 9));
    expect(nextOccurrence(wed, 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR')).toBe(Date.UTC(2026, 9, 15, 9));
    expect(nextOccurrence(Date.UTC(2026, 9, 16, 9), 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR')).toBe(Date.UTC(2026, 9, 19, 9));
    expect(nextOccurrence(wed, 'FREQ=MONTHLY')).toBe(Date.UTC(2026, 10, 14, 9));
    expect(nextOccurrence(wed, 'FREQ=YEARLY')).toBeNull();
    expect(nextFutureOccurrence(Date.UTC(2026, 0, 1, 9), 'FREQ=DAILY', wed)).toBe(Date.UTC(2026, 9, 15, 9));
  });
});
