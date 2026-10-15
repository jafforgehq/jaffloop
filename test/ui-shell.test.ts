import { describe, expect, it } from 'vitest';
import type { Item, TodaySections } from '../src/shared/types';
import { ledgerGroups, moveSelection, neighbour, nextMonday, snoozePresets, todayBlocks, todayTotal, triageDue } from '../src/renderer/ui-logic';

const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const clock = (ms: number) => `${String(new Date(ms).getHours()).padStart(2, '0')}:00`;

function item(id: string, o: Partial<Item> = {}): Item {
  return { id, kind: 'task', title: id, body: null, quote: null, personId: null, status: 'open', dueAt: null, dueHasTime: false, remindAt: null, snoozedUntil: null,
    snoozeCount: 0, recurRule: null, pinned: false, inbox: false, source: 'hotkey', createdAt: 0, updatedAt: 0, completedAt: null, lastTouchedAt: 0, ...o };
}

describe('snooze presets', () => {
  const thu = at(2026, 10, 15, 10, 30); // Thursday morning
  it('offers the afternoon only before 14:00', () => {
    expect(snoozePresets(thu, clock).map((p) => p.label)).toEqual(['1 hour', 'This afternoon', 'Tomorrow 09:00', 'Next Monday']);
    expect(snoozePresets(at(2026, 10, 15, 14, 0), clock).map((p) => p.label)).toEqual(['1 hour', 'Tomorrow 09:00', 'Next Monday']);
  });
  it('computes the dates', () => {
    const p = snoozePresets(thu, clock);
    expect(p[0]!.date).toBe(thu + 3_600_000);
    expect(p[1]!.date).toBe(at(2026, 10, 15, 15));
    expect(p[2]!.date).toBe(at(2026, 10, 16, 9));
    expect(p[3]!.date).toBe(at(2026, 10, 19, 9));
  });
});

describe('nextMonday', () => {
  it('is strictly in the future', () => {
    expect(nextMonday(at(2026, 10, 15, 10), 0)).toBe(at(2026, 10, 19));
    expect(nextMonday(at(2026, 10, 19, 8), 9)).toBe(at(2026, 10, 19, 9)); // Monday before 09:00
    expect(nextMonday(at(2026, 10, 19, 10), 9)).toBe(at(2026, 10, 26, 9));
  });
  it('triage keys', () => {
    const now = at(2026, 10, 15, 10);
    expect(triageDue('d', now)).toBe(at(2026, 10, 15));
    expect(triageDue('t', now)).toBe(at(2026, 10, 16));
    expect(triageDue('w', now)).toBe(at(2026, 10, 19));
    expect(triageDue('x', now)).toBeUndefined();
  });
});

describe('selection helpers', () => {
  const ids = ['a', 'b', 'c'];
  it('neighbour', () => {
    expect(neighbour('a', ids)).toBe('b');
    expect(neighbour('c', ids)).toBe('b');
    expect(neighbour('a', ['a'])).toBeNull();
    expect(neighbour('zz', ids)).toBeNull();
  });
  it('moveSelection clamps and starts at the ends', () => {
    expect(moveSelection(null, ids, 1)).toBe('a');
    expect(moveSelection(null, ids, -1)).toBe('c');
    expect(moveSelection('c', ids, 1)).toBe('c');
    expect(moveSelection('b', ids, -1)).toBe('a');
    expect(moveSelection('x', ids, 1)).toBe('a');
    expect(moveSelection(null, [], 1)).toBeNull();
  });
});

describe('today blocks', () => {
  const t: TodaySections = {
    slipping: [item('s1', { snoozeCount: 3 })],
    overdue: [item('o1', { personId: 'p2' }), item('o2', { personId: 'p1', kind: 'owe' })],
    today: [item('t1'), item('t2', { pinned: true, personId: 'p1' })],
    waitingStale: [item('w1', { kind: 'wait' })],
    inbox: [item('i1', { inbox: true })],
    checkIn: [],
  };
  const o = { personName: (id: string) => ({ p1: 'Zed', p2: 'Amy' } as Record<string, string>)[id], order: (x: Item[]) => x };
  it('total', () => expect(todayTotal(t)).toBe(7));
  it('sections skip empty ones', () => {
    const b = todayBlocks({ ...t, waitingStale: [] }, { ...o, group: 'section', focus: false });
    expect(b.map((x) => x.id)).toEqual(['slipping', 'overdue', 'today', 'inbox']);
  });
  it('people: by name, no person last', () => {
    const b = todayBlocks(t, { ...o, group: 'person', focus: false });
    expect(b.map((x) => x.title)).toEqual(['Amy', 'Zed', 'No person']);
  });
  it('kinds keep the canonical kind order', () => {
    const b = todayBlocks(t, { ...o, group: 'kind', focus: false });
    expect(b.map((x) => x.title)).toEqual(['owe', 'wait', 'task']);
  });
  it('focus is the top 3: slipping, overdue, pinned first', () => {
    const b = todayBlocks(t, { ...o, group: 'section', focus: true });
    expect(b).toHaveLength(1);
    expect(b[0]!.items.map((i) => i.id)).toEqual(['s1', 'o1', 'o2']);
    const c = todayBlocks({ ...t, slipping: [], overdue: [] }, { ...o, group: 'section', focus: true });
    expect(c[0]!.items.map((i) => i.id)).toEqual(['t2', 't1']);
  });
});

describe('ledger groups', () => {
  const items = [
    item('a', { personId: 'p1', dueAt: 300 }), item('b', { personId: 'p2', dueAt: 100 }), item('c', { personId: 'p1', dueAt: 50 }), item('d', { personId: null }),
  ];
  it('orders groups by earliest due and items by due', () => {
    const g = ledgerGroups(items, false, () => true);
    expect(g.order).toEqual(['p1', 'p2', '']);
    expect(g.flat.map((i) => i.id)).toEqual(['c', 'a', 'b', 'd']);
  });
  it('overdue only', () => {
    const g = ledgerGroups(items, true, (i) => i.id === 'b');
    expect(g.flat.map((i) => i.id)).toEqual(['b']);
  });
});
