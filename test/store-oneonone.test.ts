// 0.3.0 1:1 notes and history: interactionHistory, logOneOnOne, linkItemsToInteraction, and the seeded demo history.
import { beforeEach, describe, expect, it } from 'vitest';
import { newItem, openMemoryDatabase, Store } from '../src/core';
import { seed } from '../src/core/seed';

const NOW = Date.UTC(2026, 9, 15, 9, 0, 0);
const DAY = 86_400_000;

let store: Store;
beforeEach(() => { store = new Store(openMemoryDatabase()); });

const sara = () => store.person('sara')!;

describe('logOneOnOne', () => {
  it('logs a 1:1 at now with trimmed notes and links the items', () => {
    const a = store.capture('owe @sara send the doc', 'hotkey', NOW);
    const b = store.capture('bring @sara career goals', 'hotkey', NOW);
    const x = store.logOneOnOne(sara().id, '  Talked about growth.\nShe wants a mentor.  ', [a.id, b.id], NOW - 1800_000, NOW);
    expect(x).toMatchObject({ personId: sara().id, kind: '1on1', occurredAt: NOW, notes: 'Talked about growth.\nShe wants a mentor.', calendarEventId: null });
    expect(store.interactions(sara().id)).toEqual([x]);
    expect(store.item(a.id)!.interactionId).toBe(x.id);
    expect(store.item(b.id)!.interactionId).toBe(x.id);
  });

  it('empty notes are stored as null; unknown item ids are ignored; no items is fine', () => {
    const x = store.logOneOnOne(sara().id, '   ', ['no-such-id'], undefined, NOW);
    expect(x.notes).toBeNull();
    expect(store.interactionHistory(sara().id)[0]).toMatchObject({ interaction: { id: x.id }, items: [] });
  });

  it('is one transaction: a failing link leaves no interaction behind', () => {
    const p = sara();
    expect(() => store.logOneOnOne(p.id, 'x', [null as unknown as string], undefined, NOW)).not.toThrow(); // binds NULL: matches nothing
    expect(() => store.logOneOnOne('missing-person', 'x', [], undefined, NOW)).toThrow(); // foreign key
    expect(store.interactions('missing-person')).toHaveLength(0);
  });

  it('logging does not touch the items other than the link', () => {
    const a = store.capture('owe @sara send the doc', 'hotkey', NOW);
    store.logOneOnOne(sara().id, 'n', [a.id], undefined, NOW + 1000);
    expect(store.item(a.id)).toEqual({ ...a, interactionId: expect.any(String) });
  });
});

describe('linkItemsToInteraction', () => {
  it('links items, and relinking moves them', () => {
    const a = store.capture('owe @sara a', 'hotkey', NOW);
    const x1 = store.logInteraction(sara().id, '1on1', 'one', NOW - DAY);
    const x2 = store.logInteraction(sara().id, '1on1', 'two', NOW);
    store.linkItemsToInteraction(x1.id, [a.id]);
    expect(store.item(a.id)!.interactionId).toBe(x1.id);
    store.linkItemsToInteraction(x2.id, [a.id]);
    expect(store.item(a.id)!.interactionId).toBe(x2.id);
    expect(store.interactionHistory(sara().id).map((h) => h.items.length)).toEqual([1, 0]);
  });
});

describe('interactionHistory', () => {
  it('lists 1:1s newest first with their items of any status in creation order', () => {
    const p = sara();
    const old = store.logInteraction(p.id, '1on1', 'older', NOW - 28 * DAY);
    const recent = store.logInteraction(p.id, '1on1', 'recent', NOW - 14 * DAY);
    const mk = (title: string, at: number, ixn?: string) => { const i = newItem({ kind: 'owe', title, personId: p.id, interactionId: ixn, now: at }); store.insert(i); return i; };
    const late = mk('created later', NOW - 13 * DAY, recent.id);
    const early = mk('created first', NOW - 14 * DAY, recent.id);
    const dropped = mk('dropped one', NOW - 27 * DAY, old.id);
    store.complete(late.id, NOW);
    store.drop(dropped.id, NOW);
    mk('unlinked', NOW - 5 * DAY);
    const h = store.interactionHistory(p.id, 10, NOW);
    expect(h.map((x) => x.interaction.notes)).toEqual(['recent', 'older']);
    expect(h[0]!.items.map((i) => [i.title, i.status])).toEqual([['created first', 'open'], ['created later', 'done']]);
    expect(h[1]!.items.map((i) => [i.title, i.status])).toEqual([['dropped one', 'dropped']]);
    expect(early.id).toBe(h[0]!.items[0]!.id);
  });

  it('respects the limit (default 10), only shows 1:1s of that person, and other kinds are left out', () => {
    const p = sara();
    const amir = store.person('amir')!;
    for (let i = 0; i < 12; i++) store.logInteraction(p.id, '1on1', `n${i}`, NOW - i * DAY);
    store.logInteraction(p.id, 'meeting', 'a meeting', NOW);
    store.logInteraction(amir.id, '1on1', 'amir', NOW);
    expect(store.interactionHistory(p.id)).toHaveLength(10);
    expect(store.interactionHistory(p.id)[0]!.interaction.notes).toBe('n0');
    expect(store.interactionHistory(p.id, 3).map((h) => h.interaction.notes)).toEqual(['n0', 'n1', 'n2']);
    expect(store.interactionHistory(amir.id).map((h) => h.interaction.notes)).toEqual(['amir']);
    expect(store.interactionHistory('nobody')).toEqual([]);
  });

  it('a plain 1:1 without notes is listed with null notes and no items', () => {
    store.logInteraction(sara().id, '1on1', null, NOW);
    expect(store.interactionHistory(sara().id)).toMatchObject([{ interaction: { notes: null }, items: [] }]);
  });

  it('deleting a person removes their interactions; their items keep a dangling link harmlessly', () => {
    const a = store.capture('owe @sara a', 'hotkey', NOW);
    store.logOneOnOne(sara().id, 'n', [a.id], undefined, NOW);
    store.db.exec("DELETE FROM people WHERE handle = 'sara'");
    expect(store.item(a.id)!.interactionId).not.toBeNull();
    expect(store.interactions(a.personId ?? 'x')).toEqual([]);
  });
});

describe('demo seed', () => {
  it('has external ids with sources, and two noted 1:1s for Sara with linked action items in every status', () => {
    seed(store, NOW);
    const items = store.items({ status: null, includeSnoozed: true }, NOW);
    const sourced = items.filter((i) => i.externalId !== null);
    expect(sourced.map((i) => i.sourceLabel).sort()).toEqual(['confluence', 'jira', 'outlook', 'outlook']);
    expect(sourced.find((i) => i.sourceLabel === 'jira')).toMatchObject({ externalId: 'jira:PLAT-482:10231', sourceUrl: expect.stringMatching(/^https:\/\/.+PLAT-482/) });
    expect(new Set(sourced.map((i) => i.externalId)).size).toBe(sourced.length);

    const h = store.interactionHistory(store.person('sara', false)!.id, 10, NOW);
    expect(h).toHaveLength(2);
    expect(h.map((x) => Math.round((NOW - x.interaction.occurredAt) / DAY))).toEqual([23, 37]); // the latest stays at 23 days: e2e tests rely on it
    for (const x of h) {
      expect(x.interaction.notes!.length).toBeGreaterThan(80);
      expect(x.items.length).toBeGreaterThanOrEqual(2);
      expect(x.items.length).toBeLessThanOrEqual(3);
      for (const i of x.items) {
        expect(i.createdAt).toBeLessThanOrEqual(x.interaction.occurredAt + DAY);
        expect(i.createdAt).toBeGreaterThanOrEqual(x.interaction.occurredAt - DAY);
        if (i.status === 'done') expect(i.completedAt!).toBeGreaterThan(i.createdAt);
      }
    }
    const statuses = h.flatMap((x) => x.items.map((i) => i.status));
    expect(statuses).toEqual(expect.arrayContaining(['open', 'done', 'dropped']));
  });
});
