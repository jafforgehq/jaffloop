// 0.3.0 dedup: external ids in the Store and through the MCP tools (add_item, capture, add_items, list_items, log_interaction).
import { beforeEach, describe, expect, it } from 'vitest';
import { newItem, openMemoryDatabase, Store } from '../src/core';
import { parseCapture } from '../src/core/parser';
import { MCPServer } from '../src/mcp/server';

const NOW = Date.UTC(2026, 9, 15, 9, 0, 0);

let store: Store;
let server: MCPServer;
let rpcId = 0;

beforeEach(() => {
  store = new Store(openMemoryDatabase());
  store.saveSettings({ ...store.settings(), reviewClaudeItems: false }); // the default is on since 0.5.0; these tests are about plain adds
  server = new MCPServer(store, { now: () => NOW });
});

function call(tool: string, args: object = {}): { text: string; isError: boolean; json: any } {
  const res = (server.handle({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name: tool, arguments: args } }) as any).result;
  const text: string = res.content[0].text;
  let json: unknown;
  try { json = JSON.parse(text); } catch { json = undefined; }
  return { text, isError: res.isError === true, json };
}
const people = (...handles: string[]): void => { for (const h of handles) store.person(h); };
const hide = (handle: string): void => { const p = store.person(handle)!; p.hiddenFromClaude = true; store.savePerson(p); };
const lastAudit = () => store.auditLog(1)[0]!;

describe('Store: external ids', () => {
  it('insert keeps the four fields; findByExternalId finds them in any status', () => {
    const a = newItem({ kind: 'owe', title: 'a', externalId: 'outlook:1', sourceLabel: 'outlook', sourceUrl: 'https://x/1', interactionId: 'I', now: NOW });
    store.insert(a);
    expect(store.item(a.id)).toMatchObject({ externalId: 'outlook:1', sourceLabel: 'outlook', sourceUrl: 'https://x/1', interactionId: 'I' });
    expect(store.findByExternalId('outlook:1')!.id).toBe(a.id);
    expect(store.findByExternalId('outlook:2')).toBeNull();
    store.complete(a.id, NOW);
    expect(store.findByExternalId('outlook:1')!.status).toBe('done');
    store.update(a.id, { status: 'dropped' }, NOW);
    expect(store.findByExternalId('outlook:1')!.status).toBe('dropped');
  });

  it('an item without them reads back null, and several items may have no external id', () => {
    store.insert(newItem({ kind: 'task', title: 'a', now: NOW }));
    store.insert(newItem({ kind: 'task', title: 'b', now: NOW }));
    expect(store.items({}, NOW).map((i) => [i.externalId, i.sourceLabel, i.sourceUrl, i.interactionId])).toEqual([[null, null, null, null], [null, null, null, null]]);
  });

  it('plain insert of a taken external id still throws (the unique index), insertOnce does not', () => {
    store.insert(newItem({ kind: 'task', title: 'a', externalId: 'k', now: NOW }));
    expect(() => store.insert(newItem({ kind: 'task', title: 'b', externalId: 'k', now: NOW }))).toThrow(/UNIQUE/);
    const r = store.insertOnce(newItem({ kind: 'task', title: 'b', externalId: 'k', now: NOW }), ['x']);
    expect(r.duplicate).toBe(true);
    expect(r.item.title).toBe('a');
    expect(store.items({ status: null }, NOW)).toHaveLength(1);
    expect(store.allTags()).toEqual([]); // the duplicate's tags were not written
  });

  it('insertOnce creates when new; done and dropped duplicates are not reopened', () => {
    const first = store.insertOnce(newItem({ kind: 'owe', title: 'a', externalId: 'k', now: NOW }));
    expect(first.duplicate).toBe(false);
    store.complete(first.item.id, NOW);
    const again = store.insertOnce(newItem({ kind: 'owe', title: 'a again', externalId: 'k', now: NOW }));
    expect(again).toMatchObject({ duplicate: true, item: { id: first.item.id, status: 'done', title: 'a' } });
    store.update(first.item.id, { status: 'dropped' }, NOW);
    expect(store.insertOnce(newItem({ kind: 'owe', title: 'x', externalId: 'k', now: NOW })).item.status).toBe('dropped');
    expect(store.items({ status: 'open' }, NOW)).toHaveLength(0);
  });

  it('items without an external id are never duplicates of each other', () => {
    expect(store.insertOnce(newItem({ kind: 'task', title: 'a', now: NOW })).duplicate).toBe(false);
    expect(store.insertOnce(newItem({ kind: 'task', title: 'a', now: NOW })).duplicate).toBe(false);
  });

  it('createOnce: a duplicate writes nothing and does not create the person', () => {
    const origin = { externalId: 'jira:P-1:9', sourceLabel: 'jira' };
    expect(store.createOnce(parseCapture('owe @zed review', { now: NOW }), 'mcp', NOW, origin).duplicate).toBe(false);
    expect(store.createOnce(parseCapture('owe @newbie review', { now: NOW }), 'mcp', NOW, origin).duplicate).toBe(true);
    expect(store.person('newbie', false)).toBeNull();
    expect(store.items({ status: null }, NOW)).toHaveLength(1);
  });

  it('items() filters by externalId', () => {
    store.insert(newItem({ kind: 'task', title: 'a', externalId: 'k1', now: NOW }));
    store.insert(newItem({ kind: 'task', title: 'b', externalId: 'k2', now: NOW }));
    expect(store.items({ externalId: 'k2' }, NOW).map((i) => i.title)).toEqual(['b']);
  });

  it('restore (undo) and update keep the fields; a recurrence copy does not copy the external id', () => {
    const a = newItem({ kind: 'owe', title: 'a', externalId: 'k', sourceLabel: 'outlook', recurRule: 'FREQ=DAILY', dueAt: NOW, now: NOW });
    store.insert(a);
    const before = store.item(a.id)!;
    store.update(a.id, { title: 'changed' }, NOW);
    expect(store.item(a.id)).toMatchObject({ title: 'changed', externalId: 'k', sourceLabel: 'outlook' });
    store.restore(before);
    expect(store.item(a.id)).toMatchObject({ title: 'a', externalId: 'k' });
    const next = store.complete(a.id, NOW)!;
    expect(next.externalId).toBeNull();
    expect(store.findByExternalId('k')!.id).toBe(a.id);
  });
});

describe('MCP add_item and capture with external_id', () => {
  it('stores external_id, source_label, source_url and shows them in the item JSON', () => {
    people('sara');
    const r = call('add_item', { kind: 'owe', title: 'Reply', person: 'sara', external_id: 'outlook:AAA', source_label: 'outlook', source_url: 'https://o/AAA' });
    expect(r.json).toMatchObject({ external_id: 'outlook:AAA', source_label: 'outlook', source_url: 'https://o/AAA' });
    expect(store.findByExternalId('outlook:AAA')).toMatchObject({ source: 'mcp', sourceLabel: 'outlook', sourceUrl: 'https://o/AAA' });
    expect(lastAudit()).toMatchObject({ tool: 'add_item', wrote: true });
  });

  it('a repeat is a duplicate: no write, id and item returned, audit says wrote=false', () => {
    const first = call('add_item', { kind: 'owe', title: 'Reply', external_id: 'outlook:AAA' }).json;
    const n = store.auditLog().length;
    const r = call('add_item', { kind: 'owe', title: 'Different title', external_id: 'outlook:AAA' });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ duplicate: true, id: first.id, item: { title: 'Reply' } });
    expect(store.items({ status: null }, NOW)).toHaveLength(1);
    expect(store.auditLog()).toHaveLength(n + 1);
    expect(lastAudit()).toMatchObject({ tool: 'add_item', wrote: false });
    expect(lastAudit().summary).toContain('duplicate');
  });

  it('a done or dropped item is a duplicate too and stays as it is', () => {
    const id = call('add_item', { kind: 'owe', title: 'Reply', external_id: 'k' }).json.id;
    store.complete(id, NOW);
    expect(call('add_item', { kind: 'owe', title: 'Reply', external_id: 'k' }).json).toMatchObject({ duplicate: true, id, item: { status: 'done' } });
    expect(store.item(id)!.status).toBe('done');
    store.update(id, { status: 'dropped' }, NOW);
    expect(call('add_item', { kind: 'owe', title: 'Reply', external_id: 'k' }).json).toMatchObject({ duplicate: true, item: { status: 'dropped' } });
    expect(store.items({ status: 'open' }, NOW)).toHaveLength(0);
  });

  it('blank external_id, label and url count as not given (no unique key, no fields)', () => {
    const a = call('add_item', { kind: 'task', title: 'a', external_id: '  ', source_label: '', source_url: ' ' }).json;
    const b = call('add_item', { kind: 'task', title: 'a', external_id: '' }).json;
    expect(a.duplicate).toBeUndefined();
    expect(b.duplicate).toBeUndefined();
    expect(a).not.toHaveProperty('external_id');
    expect(a).not.toHaveProperty('source_label');
    expect(store.items({}, NOW)).toHaveLength(2);
  });

  it('a hidden person is still refused, and a duplicate of a hidden person item leaks nothing', () => {
    store.capture('owe @sara secret', 'hotkey', NOW);
    const secret = store.items({}, NOW)[0]!;
    store.update(secret.id, { externalId: 'k' }, NOW);
    hide('sara');
    expect(call('add_item', { kind: 'owe', title: 'x', person: 'sara', external_id: 'new' }).isError).toBe(true);
    const r = call('add_item', { kind: 'task', title: 'probe', external_id: 'k' });
    expect(r.json).toEqual({ duplicate: true });
    expect(r.text).not.toContain('secret');
    expect(call('list_items', { external_id: 'k', status: 'any' }).json.count).toBe(0);
  });

  it('capture accepts the fields and dedups; a duplicate does not create the person', () => {
    const a = call('capture', { text: 'owe @sara review RFC fri', external_id: 'jira:PLAT-1:1', source_label: 'jira', source_url: 'https://j/PLAT-1' });
    expect(a.json).toMatchObject({ kind: 'owe', person: 'sara', external_id: 'jira:PLAT-1:1', source_label: 'jira', source_url: 'https://j/PLAT-1' });
    const b = call('capture', { text: 'owe @newbie something else', external_id: 'jira:PLAT-1:1' });
    expect(b.json).toMatchObject({ duplicate: true, id: a.json.id, item: { title: 'review RFC' } });
    expect(store.person('newbie', false)).toBeNull();
    expect(lastAudit()).toMatchObject({ tool: 'capture', wrote: false });
  });

  it('capture without the new fields is unchanged', () => {
    const r = call('capture', { text: 'todo plain' });
    expect(Object.keys(r.json).sort()).toEqual(['created_at', 'id', 'inbox', 'kind', 'pinned', 'slipping', 'snooze_count', 'status', 'title']);
  });

  it('list_items shows the source fields only when set and filters by external_id (any status by default)', () => {
    call('add_item', { kind: 'owe', title: 'from mail', external_id: 'outlook:1', source_label: 'outlook' });
    call('add_item', { kind: 'owe', title: 'plain' });
    const all = call('list_items').json.items as any[];
    expect(all.find((i) => i.title === 'plain')).not.toHaveProperty('external_id');
    expect(all.find((i) => i.title === 'plain')).not.toHaveProperty('source_label');
    expect(all.find((i) => i.title === 'plain')).not.toHaveProperty('source_url');
    expect(all.find((i) => i.title === 'from mail')).toMatchObject({ external_id: 'outlook:1', source_label: 'outlook' });
    expect(all.find((i) => i.title === 'from mail')).not.toHaveProperty('source_url');
    const id = store.findByExternalId('outlook:1')!.id;
    store.complete(id, NOW);
    expect(call('list_items', { external_id: 'outlook:1' }).json.items.map((i: any) => i.title)).toEqual(['from mail']);
    expect(call('list_items', { external_id: 'outlook:1', status: 'open' }).json.count).toBe(0);
    expect(call('list_items', { external_id: 'nope' }).json.count).toBe(0);
  });

  it('tool descriptions teach external_id', () => {
    const tools = (server.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) as any).result.tools as any[];
    for (const name of ['capture', 'add_item', 'add_items']) {
      const t = tools.find((x) => x.name === name)!;
      const text = JSON.stringify(t);
      expect(text, name).toContain('external_id');
      expect(text, name).toContain('outlook:<message id>');
    }
    const add = tools.find((x) => x.name === 'add_item')!;
    expect(add.inputSchema.properties.external_id.description).toContain('jira:PLAT-482:<comment id>');
    expect(Object.keys(add.inputSchema.properties)).toEqual(expect.arrayContaining(['external_id', 'source_label', 'source_url']));
    expect(add.inputSchema.required).toEqual(['kind', 'title']);
    const bulk = tools.find((x) => x.name === 'add_items')!;
    expect(bulk.inputSchema.required).toEqual(['items']);
    expect(bulk.inputSchema.properties.items.maxItems).toBe(100);
    expect(bulk.inputSchema.properties.items.items.required).toEqual(['kind', 'title']);
    expect(tools.find((x) => x.name === 'list_items')!.inputSchema.properties.external_id).toBeDefined();
  });
});

describe('MCP add_items', () => {
  const item = (title: string, extra: object = {}) => ({ kind: 'owe', title, ...extra });

  it('creates, skips duplicates and reports each entry', () => {
    const batch = { items: [item('one', { external_id: 'a', source_label: 'outlook' }), item('two', { external_id: 'b' }), item('three')] };
    const r = call('add_items', batch);
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ created: 3, duplicates: 0, errors: 0 });
    expect(r.json.results.map((x: any) => [x.index, x.status])).toEqual([[0, 'created'], [1, 'created'], [2, 'created']]);
    expect(r.json.results.every((x: any) => typeof x.id === 'string')).toBe(true);
    expect(store.items({}, NOW)).toHaveLength(3);
    expect(lastAudit()).toMatchObject({ tool: 'add_items', wrote: true });

    const again = call('add_items', { items: [item('one', { external_id: 'a' }), item('two', { external_id: 'b' }), item('four')] });
    expect(again.json).toMatchObject({ created: 1, duplicates: 2, errors: 0 });
    expect(again.json.results.map((x: any) => x.status)).toEqual(['duplicate', 'duplicate', 'created']);
    expect(again.json.results[0].id).toBe(r.json.results[0].id);
    expect(store.items({}, NOW)).toHaveLength(4);
  });

  it('a run of only duplicates writes nothing and audits wrote=false', () => {
    call('add_items', { items: [item('one', { external_id: 'a' })] });
    const r = call('add_items', { items: [item('one', { external_id: 'a' }), item('one', { external_id: 'a' })] });
    expect(r.json).toMatchObject({ created: 0, duplicates: 2, errors: 0 });
    expect(lastAudit()).toMatchObject({ tool: 'add_items', wrote: false });
    expect(lastAudit().summary).toBe('add_items: 0 created, 2 duplicate, 0 error');
  });

  it('detects duplicates inside one call: the second is the duplicate', () => {
    const r = call('add_items', { items: [item('first', { external_id: 'same' }), item('second', { external_id: 'same' })] });
    expect(r.json).toMatchObject({ created: 1, duplicates: 1 });
    expect(r.json.results[1]).toMatchObject({ index: 1, status: 'duplicate', id: r.json.results[0].id });
    expect(store.items({}, NOW).map((i) => i.title)).toEqual(['first']);
  });

  it('a bad entry does not stop the others', () => {
    const r = call('add_items', { items: [item('ok'), { kind: 'bogus', title: 'x' }, { kind: 'owe' }, 'string', null, item('also ok')] });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ created: 2, duplicates: 0, errors: 4 });
    expect(r.json.results.map((x: any) => x.status)).toEqual(['created', 'error', 'error', 'error', 'error', 'created']);
    expect(r.json.results[1].error).toBe('kind must be one of owe, wait, bring, task, said, note');
    expect(r.json.results[2].error).toBe('title is required');
    expect(r.json.results[3].error).toBe('item must be an object');
    expect(r.json.results[1]).not.toHaveProperty('id');
    expect(store.items({}, NOW).map((i) => i.title).sort()).toEqual(['also ok', 'ok']);
  });

  it('hidden people are refused per item, others still go in; an unknown person is an error too', () => {
    store.capture('owe @sara x', 'hotkey', NOW);
    store.capture('owe @amir y', 'hotkey', NOW);
    hide('sara');
    const r = call('add_items', { items: [item('for sara', { person: 'sara', external_id: 's' }), item('for amir', { person: 'amir', external_id: 'a' }), item('for nobody', { person: 'nobody' })] });
    expect(r.json.results.map((x: any) => x.status)).toEqual(['error', 'created', 'error']);
    expect(r.json.results[0].error).toBe("No person with handle 'sara'.");
    expect(store.findByExternalId('s')).toBeNull();
    expect(store.findByExternalId('a')!.personId).toBe(store.person('amir')!.id);
  });

  it('read-only mode blocks it, writes nothing and audits the block', () => {
    store.saveSettings({ ...store.settings(), mcpReadOnly: true });
    const r = call('add_items', { items: [item('a')] });
    expect(r.isError).toBe(true);
    expect(r.text).toBe('Jaffloop is in read-only mode for Claude. Change this in Settings > MCP.');
    expect(store.items({ status: null }, NOW)).toHaveLength(0);
    expect(lastAudit()).toMatchObject({ tool: 'add_items', summary: 'blocked: read-only mode', wrote: false });
  });

  it('items must be a non-empty array of at most 100', () => {
    expect(call('add_items', {}).isError).toBe(true);
    expect(call('add_items', { items: [] }).isError).toBe(true);
    expect(call('add_items', { items: 'x' }).isError).toBe(true);
    const many = Array.from({ length: 101 }, (_, i) => item(`n${i}`));
    const r = call('add_items', { items: many });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('at most 100');
    expect(store.items({ status: null }, NOW)).toHaveLength(0);
    const hundred = call('add_items', { items: many.slice(0, 100) });
    expect(hundred.json).toMatchObject({ created: 100, duplicates: 0, errors: 0 });
  });

  it('supports the add_item fields: person, due, tags, quote, recurrence', () => {
    store.capture('owe @sara x', 'hotkey', NOW);
    const r = call('add_items', { items: [{ kind: 'said', title: 'told', quote: 'we ship Friday', person: 'sara', tags: ['Release'], due: '2026-10-20', external_id: 'teams:1', source_label: 'teams', source_url: 'https://t/1' }] });
    const i = store.findByExternalId('teams:1')!;
    expect(r.json.results[0].id).toBe(i.id);
    expect(i).toMatchObject({ kind: 'said', quote: 'we ship Friday', source: 'mcp', sourceLabel: 'teams', sourceUrl: 'https://t/1' });
    expect(i.personId).toBe(store.person('sara')!.id);
    expect(store.tags(i.id)).toEqual(['release']);
    expect(i.dueAt).not.toBeNull();
  });
});

describe('MCP log_interaction action_items', () => {
  it('creates the items for the person, linked to the interaction, with dedup', () => {
    people('sara');
    const r = call('log_interaction', {
      person: 'sara', notes: 'went well',
      action_items: [
        { kind: 'owe', title: 'Send the doc', external_id: 'notes:1' },
        { kind: 'bring', title: 'Career goals' },
        { kind: 'owe', title: 'again', external_id: 'notes:1' },
        { kind: 'nope', title: 'bad' },
      ],
    });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ person: 'sara', action_items: { created: 2, duplicates: 1, errors: 1 } });
    const sara = store.person('sara', false)!;
    const hist = store.interactionHistory(sara.id);
    expect(hist).toHaveLength(1);
    expect(hist[0]!.interaction).toMatchObject({ id: r.json.id, notes: 'went well' });
    expect(hist[0]!.items.map((i) => [i.title, i.personId, i.interactionId, i.source])).toEqual([
      ['Send the doc', sara.id, r.json.id, 'mcp'], ['Career goals', sara.id, r.json.id, 'mcp']]);
  });

  it('an item that already exists is not relinked, and an explicit person is respected', () => {
    people('sara', 'amir');
    const old = call('add_item', { kind: 'owe', title: 'old', external_id: 'k' }).json.id;
    const r = call('log_interaction', { person: 'sara', action_items: [{ kind: 'owe', title: 'old', external_id: 'k' }, { kind: 'wait', title: 'from amir', person: 'amir' }] });
    expect(store.item(old)!.interactionId).toBeNull();
    const [, b] = r.json.action_items.results;
    expect(store.item(b.id)!.personId).toBe(store.person('amir')!.id);
    expect(store.item(b.id)!.interactionId).toBe(r.json.id);
  });

  it('output without action_items is unchanged, and read-only still blocks it', () => {
    people('sara');
    const r = call('log_interaction', { person: 'sara' });
    expect(Object.keys(r.json).sort()).toEqual(['id', 'occurred_at', 'person']);
    store.saveSettings({ ...store.settings(), mcpReadOnly: true });
    expect(call('log_interaction', { person: 'sara', action_items: [{ kind: 'task', title: 'x' }] }).isError).toBe(true);
    expect(store.items({ status: null }, NOW)).toHaveLength(0);
  });

  it('too many action items is refused before anything is logged', () => {
    const many = Array.from({ length: 101 }, (_, i) => ({ kind: 'task', title: `t${i}` }));
    people('sara');
    expect(call('log_interaction', { person: 'sara', action_items: many }).isError).toBe(true);
    expect(store.interactions(store.person('sara', false)!.id)).toHaveLength(0);
  });
});
