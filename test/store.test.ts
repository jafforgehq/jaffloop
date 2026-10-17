import { beforeEach, describe, expect, it } from 'vitest';
import { Store, newItem, openMemoryDatabase, isSlipping, hm } from '../src/core';
import { DEFAULT_SETTINGS } from '../src/core/pure';

const DAY = 86_400_000;
let store: Store;
beforeEach(() => { store = new Store(openMemoryDatabase()); });

describe('StoreTests', () => {
  it('capture creates person and item', () => {
    const i = store.capture('owe @sara review RFC fri #rfc');
    expect(store.people().map((p) => p.handle)).toEqual(['sara']);
    expect(i.personId).toBe(store.person('sara')!.id);
    expect(store.tags(i.id)).toEqual(['rfc']);
    expect(i.inbox).toBe(false);
    expect(store.person('sara')!.name).toBe('Sara');
    expect(i.id).toMatch(/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/);
  });
  it('inbox clears when assigned', () => {
    const i = store.capture('buy cable');
    expect(i.inbox).toBe(true);
    store.assign(i.id, null, Date.now() + DAY);
    expect(store.item(i.id)!.inbox).toBe(false);
  });
  it('said and note never go to the inbox', () => {
    expect(store.capture('note remember this').inbox).toBe(false);
    expect(store.capture('said something').inbox).toBe(false);
  });
  it('snooze three times slips', () => {
    const i = store.capture('todo x today');
    for (let k = 0; k < 3; k++) store.snooze(i.id, Date.now() - 1);
    expect(isSlipping(store.item(i.id)!)).toBe(true);
    expect(store.today().slipping).toHaveLength(1);
  });
  it('recurring complete spawns next', () => {
    const now = Date.now();
    const i = store.capture('todo standup every day', 'hotkey', now);
    const next = store.complete(i.id, now);
    expect(next).not.toBeNull(); expect(store.item(i.id)!.status).toBe('done');
    expect(next!.dueAt!).toBeGreaterThan(now);
    expect(store.item(next!.id)!.recurRule).toBe('FREQ=DAILY');
    expect(store.complete(i.id, now), 'already done').toBeNull();
  });
  it('recurring complete keeps tags, person and the remind offset', () => {
    const now = Date.UTC(2026, 9, 14, 10);
    const i = store.capture('owe @sara report every day 09:00 #ops remind 1h', 'hotkey', now);
    store.update(i.id, { remindAt: i.dueAt! - 3600_000 }, now);
    const next = store.complete(i.id, now)!;
    expect(store.tags(next.id)).toEqual(['ops']);
    expect(next.personId).toBe(i.personId);
    expect(next.remindAt).toBe(next.dueAt! - 3600_000);
    expect(next.inbox).toBe(false);
    expect(store.snapshot(now).openItems.map((x) => x.id)).toContain(next.id);
  });
  it('search filters', () => {
    store.capture('owe @sara review RFC');
    store.capture('wait @amir API spec');
    expect(store.search('RFC')).toHaveLength(1);
    expect(store.search('@amir')).toHaveLength(1);
    expect(store.search('kind:owe')).toHaveLength(1);
    expect(store.search('rev'), 'prefix match').toHaveLength(1);
  });
  it('search: status, before, unknown person, quotes, bad filters', () => {
    const a = store.capture('owe @sara alpha thing fri');
    store.capture('owe @sara beta thing');
    store.complete(a.id);
    expect(store.search('thing')).toHaveLength(2);
    expect(store.search('thing status:done').map((i) => i.id)).toEqual([a.id]);
    expect(store.search('thing status:open')).toHaveLength(1);
    expect(store.search('before:2099-01-01').map((i) => i.id)).toEqual([a.id]);   // only items with a due date
    expect(store.search('before:2000-01-01')).toHaveLength(0);
    expect(store.search('@nobody')).toEqual([]);
    expect(store.search('"alpha')).toHaveLength(1);          // quotes are stripped, not a syntax error
    expect(store.search('kind:bogus')).toEqual([]);          // an unknown kind is just a word nothing matches
    expect(store.search('')).toHaveLength(2);
    expect(store.search('thing', 1)).toHaveLength(1);
  });
  it('search follows edits (FTS triggers)', () => {
    const i = store.capture('owe @sara alpha');
    store.update(i.id, { title: 'gamma' });
    expect(store.search('alpha')).toHaveLength(0);
    expect(store.search('gam')).toHaveLength(1);
  });
  it('hidden people', () => {
    store.capture('owe @sara x');
    const p = store.person('sara')!; p.hiddenFromClaude = true; store.savePerson(p);
    expect([...store.hiddenPersonIds()]).toEqual([p.id]);
  });
  it('settings round trip', () => {
    const s = store.settings();
    expect(s).toEqual(DEFAULT_SETTINGS);
    s.mcpReadOnly = true; s.eodTime = '16:00'; s.haptics = false; s.hotkey = 'Control+Shift+K'; s.staleDaysNoDue = 9;
    store.saveSettings(s);
    expect(store.settings()).toEqual(s);
    expect(hm(store.settings().eodTime)).toEqual([16, 0]);
  });
  it('capture uses the saved end of day', () => {
    const s = store.settings(); s.eodTime = '16:00'; store.saveSettings(s);
    const now = Date.UTC(2026, 9, 14, 10);
    expect(store.capture('todo x eod', 'hotkey', now).dueAt).toBe(Date.UTC(2026, 9, 14, 16));
  });
  it('legacy hotkey in the settings table is converted on read', () => {
    store.db.prepare("INSERT INTO settings(key,value) VALUES('hotkey','ctrl+opt+space')").run();
    expect(store.settings().hotkey).toBe('Control+Alt+Space');
  });
});

describe('HelperTests (store)', () => {
  it('restore undoes drop and snooze', () => {
    const i = store.capture('owe @sara x fri');
    const before = store.item(i.id)!;
    store.drop(i.id); expect(store.item(i.id)!.status).toBe('dropped');
    store.restore(before); expect(store.item(i.id)!.status).toBe('open');
    store.snooze(i.id, Date.now() + 3600_000); expect(store.item(i.id)!.snoozeCount).toBe(1);
    store.restore(before); expect(store.item(i.id)!.snoozeCount).toBe(0);
    expect(() => store.restore(newItem({ kind: 'task', title: 'ghost' }))).toThrow();
  });
});

describe('MoreHelperTests (store)', () => {
  it('history and snoozed', () => {
    const a = store.capture('owe @sara a fri'), b = store.capture('owe @sara b fri'), c = store.capture('owe @sara c fri');
    store.complete(a.id); store.drop(b.id);
    store.snooze(c.id, Date.now() + 7200_000);
    expect(new Set(store.history(null).map((i) => i.id))).toEqual(new Set([a.id, b.id]));
    expect(store.history(Date.now() + DAY)).toHaveLength(0);
    expect(store.snoozed().map((i) => i.id)).toEqual([c.id]);
    store.update(c.id, (i) => { i.snoozedUntil = null; });
    expect(store.snoozed()).toEqual([]);
  });
  it('person notes persist', () => {
    store.capture('owe @sara x');
    const p = store.person('sara')!;
    expect(p.notes).toBe('');
    p.notes = 'Prefers async. Wants a staff promo in 2027.'; store.savePerson(p);
    expect(store.person('sara')!.notes).toBe('Prefers async. Wants a staff promo in 2027.');
  });
});

describe('Store behaviour', () => {
  const now = Date.UTC(2026, 9, 14, 10);

  it('items filter, order and snoozed visibility', () => {
    const a = store.capture('owe @sara a fri', 'hotkey', now);
    const b = store.capture('owe @sara b thu', 'hotkey', now);
    const c = store.capture('todo c !', 'hotkey', now);
    const d = store.capture('todo d', 'hotkey', now);
    expect(store.items({}, now).map((i) => i.id)).toEqual([c.id, b.id, a.id, d.id]); // pinned, due soonest, undated last
    store.snooze(d.id, now + DAY, now);
    expect(store.items({}, now).map((i) => i.id)).not.toContain(d.id);
    expect(store.items({ includeSnoozed: true }, now).map((i) => i.id)).toContain(d.id);
    expect(store.items({ kinds: ['owe'] }, now)).toHaveLength(2);
    expect(store.items({ kinds: [] }, now)).toHaveLength(0);
    expect(store.items({ personId: store.person('sara')!.id }, now)).toHaveLength(2);
    expect(store.items({ inboxOnly: true }, now).map((i) => i.id)).toEqual([c.id]);
    expect(store.items({ dueBefore: Date.UTC(2026, 9, 16) }, now).map((i) => i.id)).toEqual([b.id]);
    expect(store.items({ limit: 1 }, now)).toHaveLength(1);
    store.complete(a.id, now);
    expect(store.items({ status: null }, now).length).toBeGreaterThan(store.items({}, now).length);
    expect(store.items({ status: 'done' }, now).map((i) => i.id)).toEqual([a.id]);
  });
  it('items: tag, overdueOnly, staleDays', () => {
    const a = store.capture('todo a yesterday #x', 'hotkey', now - 5 * DAY);
    store.capture('todo b #y', 'hotkey', now);
    expect(store.items({ tag: 'x' }, now).map((i) => i.id)).toEqual([a.id]);
    expect(store.items({ overdueOnly: true }, now)).toHaveLength(0);
    store.update(a.id, { dueAt: now - 2 * DAY }, now - 5 * DAY);
    expect(store.items({ overdueOnly: true }, now).map((i) => i.id)).toEqual([a.id]);
    expect(store.items({ staleDays: 3 }, now).map((i) => i.id)).toEqual([a.id]);
  });
  it('update accepts a patch and a function and clears inbox', () => {
    const i = store.capture('buy cable', 'hotkey', now);
    expect(i.inbox).toBe(true);
    store.update(i.id, { title: 'buy cables', pinned: true }, now + 1000);
    const u = store.item(i.id)!;
    expect(u.title).toBe('buy cables'); expect(u.pinned).toBe(true); expect(u.inbox).toBe(true);
    expect(u.updatedAt).toBe(now + 1000); expect(u.lastTouchedAt).toBe(now + 1000); expect(u.createdAt).toBe(now);
    store.update(i.id, (x) => { x.dueAt = now + DAY; });
    expect(store.item(i.id)!.inbox).toBe(false);
    expect(() => store.update('nope', { title: 'x' })).not.toThrow();
  });
  it('reopen, tags and allTags', () => {
    const i = store.capture('todo a #x #y', 'hotkey', now);
    store.capture('todo b #x', 'hotkey', now);
    expect(store.allTags()).toEqual([['x', 2], ['y', 1]]);
    store.setTags(i.id, ['Z', 'x']);
    expect(store.tags(i.id)).toEqual(['x', 'z']);
    store.complete(i.id, now);
    expect(store.allTags()).toEqual([['x', 1]]);
    store.reopen(i.id, now + 1);
    expect(store.item(i.id)!.status).toBe('open'); expect(store.item(i.id)!.completedAt).toBeNull();
  });
  it('people, summaries and interactions', () => {
    store.capture('owe @sara a', 'hotkey', now); store.capture('wait @sara b', 'hotkey', now); store.capture('owe @amir c', 'hotkey', now);
    const sara = store.person('sara')!;
    sara.cadenceDays = 14; store.savePerson(sara);
    store.logInteraction(sara.id, '1on1', 'notes', now - 20 * DAY);
    store.logInteraction(sara.id, 'chat', null, now - 2 * DAY);
    expect(store.interactions(sara.id).map((x) => x.kind)).toEqual(['chat', '1on1']);
    expect(store.interactions(sara.id, 1)).toHaveLength(1);
    let s = store.personSummaries(now).find((x) => x.person.handle === 'sara')!;
    expect([s.openOwe, s.openWait, s.daysSinceLast, s.cadenceOverdue]).toEqual([1, 1, 2, false]);
    store.db.prepare('DELETE FROM interactions WHERE kind = ?').run('chat');
    s = store.personSummaries(now).find((x) => x.person.handle === 'sara')!;
    expect([s.daysSinceLast, s.cadenceOverdue]).toEqual([20, true]);
    expect(store.today(now).checkIn.map((x) => x.person.handle)).toEqual(['sara']);
    expect(store.personSummaries(now, true).map((x) => x.person.handle)).toEqual(['amir', 'sara']); // by name, nocase
    store.savePerson({ ...store.person('amir')!, archived: true });
    expect(store.people().map((p) => p.handle)).toEqual(['sara']);
    expect(store.people(true)).toHaveLength(2);
    expect(store.person('nobody', false)).toBeNull();
    expect(store.person('SARA')!.id).toBe(sara.id);
    expect(store.personById(sara.id)!.handle).toBe('sara');
  });
  it('today sections', () => {
    const slip = store.capture('todo slip today', 'hotkey', now);
    for (let k = 0; k < 3; k++) store.snooze(slip.id, now - 1, now);
    const over = store.capture('owe @sara over yesterday', 'hotkey', now);
    const stale = store.capture('wait @sara stale', 'hotkey', now - 10 * DAY);
    const inbox = store.capture('buy cable', 'hotkey', now);
    const due = store.capture('owe @sara due today', 'hotkey', now);
    const pinned = store.capture('bring @sara later !', 'hotkey', now);
    const future = store.capture('owe @sara future fri', 'hotkey', now);
    store.update(over.id, { dueAt: Date.UTC(2026, 9, 13) }, now);
    store.update(due.id, { dueAt: Date.UTC(2026, 9, 14) }, now);
    const t = store.today(now);
    expect(t.slipping.map((i) => i.id)).toEqual([slip.id]);
    expect(t.overdue.map((i) => i.id)).toEqual([over.id]);
    expect(t.waitingStale.map((i) => i.id)).toEqual([stale.id]);
    expect(t.inbox.map((i) => i.id)).toEqual([inbox.id]);
    expect(new Set(t.today.map((i) => i.id))).toEqual(new Set([due.id, pinned.id]));
    expect(t.today.map((i) => i.id)).not.toContain(future.id);
    expect(store.overdueCount(now)).toBe(2);
  });
  it('week summary', () => {
    const from = Date.UTC(2026, 9, 5), to = Date.UTC(2026, 9, 12);
    const a = store.capture('owe @sara a', 'hotkey', Date.UTC(2026, 9, 6));
    const b = store.capture('owe @sara b', 'hotkey', Date.UTC(2026, 9, 7));
    store.capture('owe @sara outside', 'hotkey', Date.UTC(2026, 9, 20));
    store.complete(a.id, Date.UTC(2026, 9, 8));
    for (let k = 0; k < 3; k++) store.snooze(b.id, Date.UTC(2026, 9, 30), Date.UTC(2026, 9, 9));
    const w = store.weekSummary(from, to, Date.UTC(2026, 9, 14));
    expect(w.created.map((i) => i.id)).toEqual([a.id, b.id]);
    expect(w.completed.map((i) => i.id)).toEqual([a.id]);
    expect(w.slipped.map((i) => i.id)).toEqual([b.id]);
    expect(w.stale).toEqual([]);
  });
  it('item_events rows', () => {
    const i = store.capture('owe @sara a every day', 'mcp', now);
    store.snooze(i.id, Date.UTC(2026, 9, 15, 9), now + 1);
    store.complete(i.id, now + 2);
    store.drop(store.capture('todo b', 'hotkey', now).id, now + 3);
    const ev = store.db.prepare('SELECT event, detail FROM item_events ORDER BY id').all() as Array<{ event: string; detail: string | null }>;
    expect(ev).toEqual([
      { event: 'created', detail: 'mcp' }, { event: 'snoozed', detail: '2026-10-15T09:00:00Z' }, { event: 'completed', detail: null },
      { event: 'created', detail: 'recurrence' }, { event: 'created', detail: 'hotkey' }, { event: 'dropped', detail: null },
    ]);
  });
  it('insert writes tags lowercased and a created event', () => {
    const it2 = newItem({ kind: 'owe', title: 'x', source: 'import', now });
    store.insert(it2, ['A', 'b']);
    expect(store.tags(it2.id)).toEqual(['a', 'b']);
    expect(store.db.prepare('SELECT detail FROM item_events').get()).toEqual({ detail: 'import' });
  });
  it('audit log keeps the newest 500', () => {
    for (let k = 0; k < 505; k++) store.audit('capture', `n${k}`, k % 2 === 0, now + k);
    const log = store.auditLog(1000);
    expect(log).toHaveLength(500);
    expect(log[0]).toMatchObject({ summary: 'n504', wrote: true, tool: 'capture', at: now + 504 });
    expect(store.auditLog()).toHaveLength(50);
  });
  it('exportJSON has the Swift shape', () => {
    const i = store.capture('owe @sara review fri #t', 'mcp', now);
    store.logInteraction(store.person('sara')!.id, '1on1', null, now);
    const d = JSON.parse(store.exportJSON());
    expect(Object.keys(d)).toEqual(['custom_prompts', 'interactions', 'items', 'people']);
    expect(d.items[0]).toMatchObject({ id: i.id, kind: 'owe', person_id: i.personId, due_has_time: false, created_at: '2026-10-14T10:00:00Z', source: 'mcp' });
    expect(d.items[0]).not.toHaveProperty('body');
    expect(d.people[0]).toMatchObject({ handle: 'sara', hidden_from_claude: false, notes: '' });
    expect(d.interactions[0]).toMatchObject({ kind: '1on1', occurred_at: '2026-10-14T10:00:00Z' });
  });
  it('snapshot', () => {
    const a = store.capture('owe @sara a fri #x', 'hotkey', now);
    const b = store.capture('todo b', 'hotkey', now);
    store.snooze(b.id, now + DAY, now);
    store.audit('capture', 's', true, now);
    const s = store.snapshot(now);
    expect(s.now).toBe(now);
    expect(s.settings).toEqual(DEFAULT_SETTINGS);
    expect(s.openItems.map((i) => i.id)).toEqual([a.id]);       // snoozed items are not in openItems
    expect(s.snoozedCount).toBe(1);
    expect(s.tags).toEqual([['x', 1]]);
    expect(s.summaries.map((x) => x.person.handle)).toEqual(['sara']);
    expect(s.auditLog).toHaveLength(1);
    expect(s.today.today.map((i) => i.id)).toEqual([]);
    expect(store.snapshot(now + 2 * DAY).snoozedCount).toBe(0);
    expect(store.snapshot(now + 2 * DAY).openItems).toHaveLength(2);
  });
});
