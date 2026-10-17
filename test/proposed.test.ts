// 0.4.0: "Review what Claude adds": proposed items are held back until accepted.
import { beforeEach, describe, expect, it } from 'vitest';
import { Store, newItem, openMemoryDatabase } from '../src/core';
import { MCPServer } from '../src/mcp/server';

const NOW = Date.UTC(2026, 9, 15, 9, 0, 0);
const DAY = 86_400_000;

let store: Store;
let server: MCPServer;
let rpcId = 0;
beforeEach(() => {
  store = new Store(openMemoryDatabase());
  store.person('sara');
  server = new MCPServer(store, { now: () => NOW });
});

function call(tool: string, args: object = {}): { text: string; isError: boolean; json: any } {
  const res = (server.handle({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name: tool, arguments: args } }) as any).result;
  const text: string = res.content[0].text;
  let json: unknown;
  try { json = JSON.parse(text); } catch { json = undefined; }
  return { text, isError: res.isError === true, json };
}
const review = (on = true): void => store.saveSettings({ ...store.settings(), reviewClaudeItems: on });
const proposed = (kind: 'owe' | 'wait' | 'task', title: string, handle: string | null, extra: Partial<Parameters<typeof newItem>[0]> = {}) =>
  newItem({ kind, title, personId: handle ? store.person(handle)!.id : null, proposed: true, source: 'mcp', now: NOW - DAY, ...extra });

describe('shareOneOnOneNotes', () => {
  const logged = (): void => { call('log_interaction', { person: 'sara', notes: 'private talk' }); };
  it('defaults to on, saves and reads back', () => {
    expect(store.settings().shareOneOnOneNotes).toBe(true);
    store.saveSettings({ ...store.settings(), shareOneOnOneNotes: false });
    expect(store.settings().shareOneOnOneNotes).toBe(false);
    store.saveSettings({ ...store.settings(), shareOneOnOneNotes: true });
    expect(store.settings().shareOneOnOneNotes).toBe(true);
  });
  it('on: get_person and prep_brief show the notes', () => {
    logged();
    expect(call('get_person', { handle: 'sara' }).json.recent_interactions[0].notes).toBe('private talk');
    expect(call('prep_brief', { person: 'sara' }).json.recent_interactions[0].notes).toBe('private talk');
  });
  it('off: the notes key is gone from get_person, prep_brief and the person resource, but log_interaction still writes them', () => {
    store.saveSettings({ ...store.settings(), shareOneOnOneNotes: false });
    logged();
    expect(store.interactions(store.person('sara')!.id)[0]!.notes).toBe('private talk');
    for (const j of [call('get_person', { handle: 'sara' }).json, call('prep_brief', { person: 'sara' }).json]) {
      expect(j.recent_interactions).toHaveLength(1);
      expect(Object.keys(j.recent_interactions[0])).toEqual(['at', 'kind']);
    }
    const res = (server.handle({ jsonrpc: '2.0', id: 1, method: 'resources/read', params: { uri: 'jaffloop://person/sara' } }) as any).result;
    expect(res.contents[0].text).not.toContain('private talk');
  });
});

describe('setting', () => {
  it('defaults to on, saves and reads back', () => {
    expect(store.settings().reviewClaudeItems).toBe(true);
    review(false);
    expect(store.settings().reviewClaudeItems).toBe(false);
    review();
    expect(store.settings().reviewClaudeItems).toBe(true);
  });

  it('off: MCP items are normal items and there are no proposals', () => {
    review(false);
    call('capture', { text: 'owe @sara review RFC fri' });
    call('add_item', { kind: 'task', title: 'x' });
    expect(store.proposedItems(NOW)).toHaveLength(0);
    expect(store.items({}, NOW)).toHaveLength(2);
    expect(call('list_items').json.items.every((i: any) => !('proposed' in i))).toBe(true);
  });
});

describe('with the setting on, everything Claude adds is proposed', () => {
  beforeEach(() => review());

  it('capture, add_item, add_items and log_interaction action_items', () => {
    call('capture', { text: 'owe @sara review RFC fri' });
    call('capture', { text: 'owe @sara second', external_id: 'x:cap' });
    call('add_item', { kind: 'wait', title: 'spec', person: 'sara' });
    call('add_items', { items: [{ kind: 'task', title: 'bulk 1' }, { kind: 'task', title: 'bulk 2', external_id: 'x:bulk' }] });
    call('log_interaction', { person: 'sara', action_items: [{ kind: 'owe', title: 'from 1:1', external_id: 'x:one' }] });
    expect(store.proposedItems(NOW)).toHaveLength(6);
    expect(store.items({ status: null, includeSnoozed: true }, NOW)).toHaveLength(0);
    expect(store.items({ status: null, includeSnoozed: true, includeProposed: true }, NOW)).toHaveLength(6);
    expect(store.items({ status: null, includeSnoozed: true, proposedOnly: true }, NOW)).toHaveLength(6);
  });

  it('a person-less task without a due date keeps its inbox flag', () => {
    call('add_item', { kind: 'task', title: 'loose' });
    expect(store.proposedItems(NOW)[0]).toMatchObject({ inbox: true, proposed: true, source: 'mcp' });
  });

  it('items made by the app (hotkey) are never proposed', () => {
    store.capture('owe @sara mine', 'hotkey', NOW);
    expect(store.proposedItems(NOW)).toHaveLength(0);
    expect(store.items({}, NOW)).toHaveLength(1);
  });
});

describe('what a proposed item is left out of', () => {
  beforeEach(() => {
    store.saveSettings({ ...store.settings(), reviewClaudeItems: true });
    const p = store.person('sara')!;
    store.insert(proposed('owe', 'overdue promise zebra', 'sara', { dueAt: NOW - 3 * DAY }), ['t1']);
    store.insert(proposed('wait', 'stale wait zebra', 'sara', { dueAt: NOW - 9 * DAY, now: NOW - 20 * DAY }));
    store.insert(proposed('task', 'inbox zebra', null, { inbox: true }));
    store.insert(proposed('task', 'today zebra', null, { dueAt: NOW + 1000 }));
    store.insert(newItem({ kind: 'owe', title: 'normal', personId: p.id, now: NOW - DAY }));
  });

  it('items, today, snapshot, counts, tags, search, history and snoozed', () => {
    expect(store.items({}, NOW).map((i) => i.title)).toEqual(['normal']);
    expect(store.items({ inboxOnly: true }, NOW)).toHaveLength(0);
    const t = store.today(NOW);
    expect([t.slipping, t.overdue, t.today, t.waitingStale, t.inbox].flat().map((i) => i.title)).toEqual([]);
    expect(store.overdueCount(NOW)).toBe(0);
    const snap = store.snapshot(NOW);
    expect(snap.openItems.map((i) => i.title)).toEqual(['normal']);
    expect(snap.proposed.map((i) => i.title).sort()).toEqual(['inbox zebra', 'overdue promise zebra', 'stale wait zebra', 'today zebra']);
    const sara = store.personSummaries(NOW).find((s) => s.person.handle === 'sara')!;
    expect(sara).toMatchObject({ openOwe: 1, openWait: 0 });
    expect(store.allTags()).toEqual([]);
    expect(store.search('zebra', 50, NOW)).toHaveLength(0);
    expect(store.search('normal', 50, NOW)).toHaveLength(1);
    expect(store.snoozed(NOW)).toHaveLength(0);
    expect(store.history(null)).toHaveLength(0);
  });

  it('review, week summary, activity', () => {
    const from = NOW - 30 * DAY;
    const r = store.review(from, NOW, NOW);
    expect([r.slipped, r.staleWaits, r.overduePromises, r.created].flat().map((i) => i.title).filter((x) => x.includes('zebra'))).toEqual([]);
    expect(r.created.map((i) => i.title)).toEqual(['normal']);
    const w = store.weekSummary(from, NOW, NOW);
    expect([w.created, w.completed, w.slipped, w.stale].flat().map((i) => i.title)).toEqual(['normal']);
    expect(store.activity(from, 100, NOW).map((e) => e.item.title)).toEqual(['normal']);
  });

  it('MCP: list_items returns them with "proposed": true; get_person, search, ledger and today do not', () => {
    const items = call('list_items', { limit: 50 }).json.items as any[];
    expect(items).toHaveLength(5);
    expect(items.filter((i) => i.proposed === true)).toHaveLength(4);
    expect('proposed' in items.find((i) => i.title === 'normal')).toBe(false);
    expect(call('list_items', { person: 'sara', overdue: true }).json.items.map((i: any) => i.title).sort()).toEqual(['overdue promise zebra', 'stale wait zebra']);
    const p = call('get_person', { handle: 'sara' }).json;
    expect(p).toMatchObject({ open_i_owe: 1, open_they_owe: 0 });
    expect(p.i_owe_them.map((i: any) => i.title)).toEqual(['normal']);
    expect(p.they_owe_me).toEqual([]);
    expect(call('search', { query: 'zebra' }).json.count).toBe(0);
    const today = JSON.parse((server.handle({ jsonrpc: '2.0', id: 100, method: 'resources/read', params: { uri: 'jaffloop://today' } }) as any).result.contents[0].text);
    expect(Object.values(today).flat()).toEqual([]);
    const ledger = JSON.parse((server.handle({ jsonrpc: '2.0', id: 101, method: 'resources/read', params: { uri: 'jaffloop://ledger' } }) as any).result.contents[0].text);
    expect(Object.values(ledger).flat().map((i: any) => i.title)).toEqual(['normal']);
  });

  it('MCP: complete_item and update_item work on a proposed item and end its proposal', () => {
    const id = store.proposedItems(NOW).find((i) => i.title === 'overdue promise zebra')!.id;
    expect(call('update_item', { id, fields: { title: 'renamed' } }).json).toMatchObject({ title: 'renamed', proposed: true });
    expect(store.item(id)!.proposed).toBe(true);
    const done = call('complete_item', { id }).json.completed;
    expect(done).toMatchObject({ status: 'done' });
    expect('proposed' in done).toBe(false);
    expect(store.item(id)).toMatchObject({ status: 'done', proposed: false });
    expect(store.proposedItems(NOW).map((i) => i.id)).not.toContain(id);
  });
});

describe('accept and dismiss', () => {
  it('proposedItems lists open proposals newest first', () => {
    const a = proposed('task', 'old', null, { now: NOW - 3 * DAY, inbox: true });
    const b = proposed('task', 'new', null, { now: NOW - DAY, inbox: true });
    store.insert(a); store.insert(b);
    expect(store.proposedItems(NOW).map((i) => i.title)).toEqual(['new', 'old']);
  });

  it('acceptProposed clears the flag and bumps timestamps; inbox stays only without person and due date', () => {
    const loose = proposed('task', 'loose', null, { inbox: true });
    const withPerson = proposed('owe', 'with person', 'sara', { inbox: true });
    const withDue = proposed('task', 'with due', null, { inbox: true, dueAt: NOW + DAY });
    for (const i of [loose, withPerson, withDue]) store.insert(i);
    store.acceptProposed([loose.id, withPerson.id, withDue.id, 'unknown'], NOW);
    expect(store.proposedItems(NOW)).toHaveLength(0);
    expect(store.item(loose.id)).toMatchObject({ proposed: false, inbox: true, updatedAt: NOW, lastTouchedAt: NOW, status: 'open' });
    expect(store.item(withPerson.id)).toMatchObject({ proposed: false, inbox: false });
    expect(store.item(withDue.id)).toMatchObject({ proposed: false, inbox: false });
    expect(store.items({}, NOW)).toHaveLength(3);
    expect(store.snapshot(NOW).today.inbox.map((i) => i.id)).toEqual([loose.id]);
  });

  it('accepting a normal item or a finished one changes nothing', () => {
    const n = newItem({ kind: 'task', title: 'n', now: NOW - DAY });
    store.insert(n);
    store.acceptProposed([n.id], NOW);
    expect(store.item(n.id)).toMatchObject({ updatedAt: NOW - DAY });
  });

  it('dismissProposed drops, clears the flag, logs the event, and only touches proposals', () => {
    const p = proposed('owe', 'dismiss me', 'sara', { externalId: 'x:1' });
    const n = newItem({ kind: 'task', title: 'normal', now: NOW - DAY });
    store.insert(p); store.insert(n);
    store.dismissProposed([p.id, n.id], NOW);
    expect(store.item(p.id)).toMatchObject({ status: 'dropped', proposed: false, inbox: false, updatedAt: NOW });
    expect(store.item(n.id)).toMatchObject({ status: 'open' });
    expect(store.proposedItems(NOW)).toHaveLength(0);
    expect(store.history(null).map((i) => i.id)).toEqual([p.id]);
    expect(store.activity(NOW - DAY, 10, NOW).map((e) => [e.event, e.item.id])).toContainEqual(['dropped', p.id]);
  });

  it('a dismissed item keeps its external id, so the next sweep skips it', () => {
    review();
    const first = call('add_item', { kind: 'owe', title: 'from mail', person: 'sara', external_id: 'outlook:1' }).json;
    expect(first.proposed).toBe(true);
    store.dismissProposed([first.id], NOW);
    const again = call('add_item', { kind: 'owe', title: 'from mail', person: 'sara', external_id: 'outlook:1' }).json;
    expect(again).toMatchObject({ duplicate: true, id: first.id });
    expect(store.proposedItems(NOW)).toHaveLength(0);
    expect(call('add_items', { items: [{ kind: 'owe', title: 'from mail', external_id: 'outlook:1' }] }).json).toMatchObject({ created: 0, duplicates: 1 });
    expect(call('capture', { text: 'owe @sara from mail', external_id: 'outlook:1' }).json.duplicate).toBe(true);
    expect(store.items({ status: null }, NOW).map((i) => i.status)).toEqual(['dropped']); // still only the one dropped item
  });

  it('a pending proposal also blocks a repeat, and accepting it keeps the item', () => {
    review();
    const first = call('add_item', { kind: 'owe', title: 't', person: 'sara', external_id: 'x:2' }).json;
    expect(call('add_item', { kind: 'owe', title: 't', external_id: 'x:2' }).json.duplicate).toBe(true);
    store.acceptProposed([first.id], NOW);
    expect(call('list_items', { external_id: 'x:2' }).json.items[0]).toMatchObject({ id: first.id });
    expect('proposed' in call('list_items', { external_id: 'x:2' }).json.items[0]).toBe(false);
    expect(store.items({}, NOW)).toHaveLength(1);
  });
});

describe('export and restore', () => {
  it('exportJSON carries the flag as a boolean; restore writes it back (undo)', () => {
    const p = proposed('task', 'p', null, { inbox: true });
    store.insert(p);
    expect(JSON.parse(store.exportJSON()).items[0]).toMatchObject({ proposed: true });
    store.dismissProposed([p.id], NOW);
    store.restore(p);
    expect(store.item(p.id)).toMatchObject({ status: 'open', proposed: true });
    expect(store.proposedItems(NOW)).toHaveLength(1);
  });
});
