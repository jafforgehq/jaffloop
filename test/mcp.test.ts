// MCP server tests: the Swift MCPTests plus read-only, hidden people, notes, audit log, dates, framing over a real process.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openMemoryDatabase } from '../src/core/db';
import { Store } from '../src/core/store';
import { MCPServer, mcpServerVersion } from '../src/mcp/server';

const NOW = Date.UTC(2026, 9, 15, 9, 0, 0); // Thursday 15 October 2026, 09:00 UTC
const WRITE_TOOLS = ['capture', 'add_item', 'complete_item', 'snooze_item', 'update_item', 'log_interaction'];

let store: Store;
let server: MCPServer;
let rpcId = 0;

beforeEach(() => {
  store = new Store(openMemoryDatabase());
  server = new MCPServer(store, { now: () => NOW });
});

const rpc = (method: string, params?: object) => server.handle({ jsonrpc: '2.0', id: ++rpcId, method, ...(params ? { params } : {}) }) as Record<string, any>;

function call(tool: string, args: object = {}): { text: string; isError: boolean; json: any } {
  const res = rpc('tools/call', { name: tool, arguments: args }).result;
  const text: string = res.content[0].text;
  let json: unknown;
  try { json = JSON.parse(text); } catch { json = undefined; }
  return { text, isError: res.isError === true, json };
}

const read = (uri: string) => rpc('resources/read', { uri });
const hide = (handle: string): void => { const p = store.person(handle)!; p.hiddenFromClaude = true; store.savePerson(p); };
const localDay = (ms: number): string => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

describe('ported from the Swift MCPTests', () => {
  it('capture, list and source', () => {
    expect(call('capture', { text: 'owe @sara review RFC fri' }).isError).toBe(false);
    expect(call('list_items', { person: 'sara' }).text).toContain('review RFC');
    expect(store.items({}, NOW)[0]!.source).toBe('mcp');
    expect(store.auditLog()).toHaveLength(2);
  });

  it('a date-only due is the local calendar day', () => {
    const i = store.capture('owe @sara x fri', 'hotkey', NOW);
    expect(call('list_items').text).toContain(`"due" : "${localDay(i.dueAt!)}"`);
  });

  it('read-only mode blocks writes', () => {
    store.saveSettings({ ...store.settings(), mcpReadOnly: true });
    expect(call('capture', { text: 'todo x' }).isError).toBe(true);
    expect(store.items({}, NOW)).toHaveLength(0);
    expect(call('list_items').isError).toBe(false); // reads still work
  });

  it('a hidden person is invisible', () => {
    store.capture('owe @sara secret', 'hotkey', NOW);
    store.capture('owe @amir visible', 'hotkey', NOW);
    hide('sara');
    const t = call('list_items').text;
    expect(t).not.toContain('secret');
    expect(t).toContain('visible');
    expect(call('search', { query: 'secret' }).text).not.toContain('secret');
    expect(call('get_person', { handle: 'sara' }).isError).toBe(true);
    expect(call('list_people').text).not.toContain('sara');
    expect(call('capture', { text: 'owe @sara x' }).isError).toBe(true);
  });

  it('complete and prep brief', () => {
    const i = store.capture('owe @sara thing fri', 'hotkey', NOW);
    expect(call('complete_item', { id: i.id }).isError).toBe(false);
    expect(store.item(i.id)!.status).toBe('done');
    store.capture('bring @sara workload', 'hotkey', NOW);
    expect(call('prep_brief', { person: 'sara' }).text).toContain('workload');
  });

  it('initialize and tools/list', () => {
    const r = rpc('initialize', {});
    expect(r.result.serverInfo).toEqual({ name: 'jaffloop', version: mcpServerVersion });
    expect(rpc('tools/list').result.tools).toHaveLength(12);
    expect(server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull();
  });
});

describe('protocol', () => {
  it('tool names, required lists and schemas match the Swift server', () => {
    const tools = rpc('tools/list').result.tools as Array<{ name: string; description: string; inputSchema: any }>;
    expect(tools.map((t) => t.name)).toEqual(['capture', 'add_item', 'list_items', 'get_person', 'list_people', 'complete_item', 'snooze_item',
      'update_item', 'log_interaction', 'search', 'prep_brief', 'week_summary']);
    for (const t of tools) expect(t.inputSchema).toMatchObject({ type: 'object', properties: expect.any(Object), required: expect.any(Array) });
    const add = tools.find((t) => t.name === 'add_item')!;
    expect(add.inputSchema.required).toEqual(['kind', 'title']);
    expect(add.inputSchema.properties.kind.enum).toEqual(['owe', 'wait', 'bring', 'task', 'said', 'note']);
    expect(tools.find((t) => t.name === 'list_items')!.inputSchema.required).toEqual([]);
  });

  it('echoes the client protocol version, defaults to 2025-03-26, advertises tools and resources', () => {
    expect(rpc('initialize', {}).result.protocolVersion).toBe('2025-03-26');
    expect(rpc('initialize', { protocolVersion: '2024-11-05' }).result.protocolVersion).toBe('2024-11-05');
    expect(rpc('initialize', {}).result.capabilities).toEqual({ tools: {}, resources: {} });
  });

  it('ping, unknown method, resources list and templates', () => {
    expect(rpc('ping').result).toEqual({});
    expect(rpc('bogus').error).toEqual({ code: -32601, message: 'method not found: bogus' });
    expect(rpc('resources/list').result.resources.map((r: any) => r.uri)).toEqual(['jaffloop://today', 'jaffloop://ledger']);
    expect(rpc('resources/templates/list').result.resourceTemplates[0].uriTemplate).toBe('jaffloop://person/{handle}');
  });

  it('echoes string and null ids', () => {
    expect(server.handle({ jsonrpc: '2.0', id: 'abc', method: 'ping' })).toEqual({ jsonrpc: '2.0', id: 'abc', result: {} });
    expect(server.handle({ jsonrpc: '2.0', id: null, method: 'ping' })).toEqual({ jsonrpc: '2.0', id: null, result: {} });
  });

  it('resources/read errors', () => {
    expect(rpc('resources/read', {}).error).toEqual({ code: -32602, message: 'uri required' });
    expect(read('jaffloop://nope').error).toEqual({ code: -32002, message: 'MCPError(message: "unknown resource jaffloop://nope")' });
    expect(read('jaffloop://person/nobody').error.message).toBe('MCPError(message: "No person with handle \\\'nobody\\\'.")');
  });

  it('unknown tool is an error result and is audited', () => {
    const r = call('nope');
    expect(r.isError).toBe(true);
    expect(r.text).toBe('unknown tool: nope');
    expect(store.auditLog()[0]).toMatchObject({ tool: 'nope', summary: 'error: unknown tool: nope', wrote: false });
  });

  it('argument errors', () => {
    expect(call('capture', {}).text).toBe('text is required');
    expect(call('capture', { text: '' }).text).toBe('text is required');
    expect(call('add_item', { kind: 'zzz', title: 'x' }).text).toBe('kind must be one of owe, wait, bring, task, said, note');
    expect(call('add_item', { kind: 'owe' }).text).toBe('title is required');
    expect(call('get_person', {}).text).toBe('handle is required');
    expect(call('get_person', { handle: '@Zed' }).text).toBe("No person with handle 'Zed'.");
    expect(call('log_interaction', {}).text).toBe('person is required');
    expect(call('search', {}).text).toBe('query is required');
    expect(call('prep_brief', {}).text).toBe('person is required');
    expect(call('complete_item', { id: 'nope' }).text).toBe('No item with that id.');
    store.capture('owe @sara x', 'hotkey', NOW);
    const id = store.items({}, NOW)[0]!.id;
    expect(call('snooze_item', { id, until: 'nonsense' }).text).toBe("until must be an ISO date/time or phrase like 'tomorrow 9:00'");
  });
});

describe('JSON text', () => {
  it('prints like Foundation: spaced colon, sorted keys, empty containers on two lines, slashes unescaped', () => {
    expect(call('list_items').text).toBe('{\n  "count" : 0,\n  "items" : [\n\n  ]\n}');
    expect(call('list_people').text).toBe('{\n  "people" : [\n\n  ]\n}');
    expect(read('jaffloop://ledger').result.contents[0].text).toBe('{\n\n}');
    const added = call('add_item', { kind: 'note', title: 'a/b "q" \\ \n\t\u0001 é', body: '' });
    expect(added.text).toContain('"body" : ""');
    expect(added.text).toContain('"title" : "a/b \\"q\\" \\\\ \\n\\t\\u0001 é"');
    const keys = [...added.text.matchAll(/^ {2}"(\w+)" :/gm)].map((m) => m[1]);
    expect(keys).toEqual([...keys].sort());
  });

  it('sorts ledger groups the way Foundation does (punctuation, digits, letters; numbers by value)', () => {
    for (const h of ['ab', 'a10', 'a2', 'a1', 'a.b', 'a-b', 'a_b']) store.capture(`owe @${h} x`, 'hotkey', NOW);
    store.capture('owe no person x', 'hotkey', NOW);
    const keys = Object.keys(JSON.parse(read('jaffloop://ledger').result.contents[0].text));
    expect(keys).toEqual(['(no person)', 'a_b', 'a-b', 'a.b', 'a1', 'a2', 'a10', 'ab']);
  });

  it('timestamps are ISO 8601 UTC with Z and no milliseconds', () => {
    const j = call('capture', { text: 'owe @sara x tomorrow 9:00' }).json;
    expect(j.created_at).toBe('2026-10-15T09:00:00Z');
    expect(j.due).toBe('2026-10-16T09:00:00Z');
  });
});

describe('item JSON shape', () => {
  it('has the Swift keys', () => {
    const j = call('add_item', {
      kind: 'wait', title: 'spec', person: 'sara', due: '2026-10-01', tags: ['Q', 'b'], body: 'bb', quote: 'qq', recurrence: 'FREQ=WEEKLY',
      remind_at: '2026-09-30T08:00:00Z',
    });
    expect(j.isError).toBe(true); // sara does not exist yet: add_item never creates people
    store.person('sara');
    const k = call('add_item', {
      kind: 'wait', title: 'spec', person: '@sara', due: '2026-10-01', tags: ['Q', 'b'], body: 'bb', quote: 'qq', recurrence: 'FREQ=WEEKLY',
      remind_at: '2026-09-30T08:00:00Z',
    }).json;
    expect(Object.keys(k).sort()).toEqual(['body', 'created_at', 'due', 'id', 'inbox', 'kind', 'overdue', 'person', 'pinned', 'quote', 'recurrence',
      'remind_at', 'slipping', 'snooze_count', 'stale', 'status', 'tags', 'title']);
    expect(k).toMatchObject({ kind: 'wait', due: '2026-10-01', overdue: true, person: 'sara', tags: ['b', 'q'], remind_at: '2026-09-30T08:00:00Z', stale: false, inbox: false });
  });

  it('inbox flag, snoozed_until only while snoozed, slipping', () => {
    const k = call('add_item', { kind: 'task', title: 'loose' }).json;
    expect(k.inbox).toBe(true);
    expect(k.due).toBeUndefined();
    const sn = call('snooze_item', { id: k.id, until: '2026-10-16T09:00:00Z' }).json;
    expect(sn).toMatchObject({ snooze_count: 1, snoozed_until: '2026-10-16T09:00:00Z', slipping: false });
    call('snooze_item', { id: k.id, until: '2026-10-17T09:00:00Z' });
    expect(call('snooze_item', { id: k.id, until: '2026-10-18T09:00:00Z' }).json.slipping).toBe(true);
    store.snooze(k.id, NOW - 1000, NOW);
    expect(call('list_items').json.items[0].snoozed_until).toBeUndefined(); // already woken up
  });
});

describe('dates', () => {
  const dueOf = (due: string) => {
    const r = call('add_item', { kind: 'task', title: 'd', due }).json;
    const i = store.item(r.id)!;
    return { out: r.due as string, at: i.dueAt, hasTime: i.dueHasTime };
  };

  it('ISO with Z or an offset', () => {
    expect(dueOf('2026-10-20T09:30:00Z')).toEqual({ out: '2026-10-20T09:30:00Z', at: Date.UTC(2026, 9, 20, 9, 30), hasTime: true });
    expect(dueOf('2026-10-20T09:30:00+02:00').at).toBe(Date.UTC(2026, 9, 20, 7, 30));
    expect(dueOf('2026-10-20T09:30:00-05:30').at).toBe(Date.UTC(2026, 9, 20, 15, 0));
  });

  it('local forms: date only, space and T with or without seconds', () => {
    expect(dueOf('2026-10-20')).toEqual({ out: '2026-10-20', at: new Date(2026, 9, 20).getTime(), hasTime: false });
    expect(dueOf('2026-10-20 10:30')).toMatchObject({ at: new Date(2026, 9, 20, 10, 30).getTime(), hasTime: true });
    expect(dueOf('2026-10-20T10:30')).toMatchObject({ at: new Date(2026, 9, 20, 10, 30).getTime(), hasTime: true });
    expect(dueOf('2026-10-20T10:30:15')).toMatchObject({ at: new Date(2026, 9, 20, 10, 30, 15).getTime(), hasTime: true });
  });

  it('phrases go through the capture parser', () => {
    expect(dueOf('fri')).toEqual({ out: '2026-10-16', at: new Date(2026, 9, 16).getTime(), hasTime: false });
    expect(dueOf('tomorrow 9:00')).toEqual({ out: '2026-10-16T09:00:00Z', at: new Date(2026, 9, 16, 9, 0).getTime(), hasTime: true });
    expect(dueOf('mon 10:00').at).toBe(new Date(2026, 9, 19, 10, 0).getTime());
  });

  it('garbage means no due date and the item lands in the inbox', () => {
    const r = call('add_item', { kind: 'task', title: 'd', due: 'garbage' }).json;
    expect(r.due).toBeUndefined();
    expect(r.inbox).toBe(true);
  });

  it('a date-only due is the local day, also far from UTC', () => {
    const tz = process.env.TZ;
    try {
      for (const zone of ['Pacific/Auckland', 'America/Los_Angeles']) {
        process.env.TZ = zone;
        const s = new MCPServer(store, { now: () => NOW });
        const r = (s.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'add_item', arguments: { kind: 'task', title: zone, due: '2026-10-20' } } }) as any).result;
        const j = JSON.parse(r.content[0].text);
        expect(j.due).toBe('2026-10-20');
        expect(store.item(j.id)!.dueAt).toBe(new Date(2026, 9, 20).getTime());
        const listed = JSON.parse((s.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_items', arguments: { limit: 100 } } }) as any).result.content[0].text);
        expect(listed.items.find((i: any) => i.id === j.id).due).toBe('2026-10-20');
      }
    } finally {
      if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz;
    }
  });

  it('snooze, remind_at, occurred_at and week_summary range accept the same forms', () => {
    store.capture('owe @sara x', 'hotkey', NOW);
    const id = store.items({}, NOW)[0]!.id;
    expect(call('snooze_item', { id, until: 'tomorrow 9:00' }).json.snoozed_until).toBe('2026-10-16T09:00:00Z');
    expect(call('log_interaction', { person: 'sara', occurred_at: '2026-10-01T10:00:00+02:00' }).json.occurred_at).toBe('2026-10-01T08:00:00Z');
    expect(call('log_interaction', { person: 'sara', occurred_at: 'garbage' }).json.occurred_at).toBe('2026-10-15T09:00:00Z');
    const w = call('week_summary', { from: '2026-10-01', to: '2026-10-31T00:00:00Z' }).json;
    expect(w.from).toBe(new Date(2026, 9, 1).toISOString().replace('.000Z', 'Z'));
    expect(w.to).toBe('2026-10-31T00:00:00Z');
    expect(call('week_summary').json.from).toBe('2026-10-08T09:00:00Z');
  });
});

describe('tools', () => {
  it('list_items filters: kind, person, status, due_before, overdue, stale_days, limit', () => {
    store.capture('owe @sara a fri', 'hotkey', NOW);
    store.capture('wait @amir b mon', 'hotkey', NOW);
    call('add_item', { kind: 'owe', title: 'late', person: 'sara', due: '2026-10-14' });
    const done = store.capture('todo done thing', 'hotkey', NOW);
    store.complete(done.id, NOW);
    const titles = (args: object) => (call('list_items', args).json.items as any[]).map((i) => i.title);
    expect(titles({}).sort()).toEqual(['a', 'b', 'late']);
    expect(titles({ kind: 'wait' })).toEqual(['b']);
    expect(titles({ kind: 'bogus' })).toEqual([]);
    expect(titles({ person: '@sara' }).sort()).toEqual(['a', 'late']);
    expect(titles({ status: 'done' })).toEqual(['done thing']);
    expect(titles({ status: 'any' })).toHaveLength(4);
    expect(titles({ status: 'bogus' })).toHaveLength(4); // unknown status means any
    expect(titles({ due_before: '2026-10-16' })).toEqual(['late']);
    expect(titles({ overdue: true })).toEqual(['late']);
    expect(titles({ stale_days: 1 })).toEqual([]);
    expect(titles({ limit: 2 })).toHaveLength(2);
    expect(call('list_items', { person: 'zed' }).text).toBe("No person with handle 'zed'.");
    expect(call('list_items').json.count).toBe(3);
  });

  it('get_person has every section and no notes key', () => {
    store.capture('owe @sara a fri', 'hotkey', NOW);
    store.capture('wait @sara b mon', 'hotkey', NOW);
    store.capture('bring @sara c', 'hotkey', NOW);
    store.capture('todo @sara d', 'hotkey', NOW);
    store.capture('said @sara "quote"', 'hotkey', NOW);
    call('log_interaction', { person: 'sara', notes: 'chat' });
    const p = call('get_person', { handle: 'SARA' }).json;
    expect(Object.keys(p).sort()).toEqual(['archived', 'bring_up', 'cadence_overdue', 'days_since_last_interaction', 'handle', 'i_owe_them',
      'last_interaction', 'name', 'open_i_owe', 'open_they_owe', 'other_open', 'recent_interactions', 'relation', 'said_log', 'they_owe_me']);
    expect(p).toMatchObject({ handle: 'sara', name: 'Sara', open_i_owe: 1, open_they_owe: 1, days_since_last_interaction: 0 });
    expect(p.i_owe_them).toHaveLength(1);
    expect(p.they_owe_me).toHaveLength(1);
    expect(p.bring_up).toHaveLength(1);
    expect(p.other_open).toHaveLength(1);
    expect(p.said_log).toHaveLength(1);
    expect(p.recent_interactions).toEqual([{ at: '2026-10-15T09:00:00Z', kind: '1on1', notes: 'chat' }]);
  });

  it('prep_brief keeps a fixed key set and the last five said entries', () => {
    for (let n = 0; n < 7; n++) store.capture(`said @sara "line ${n}"`, 'hotkey', NOW + n);
    store.capture('owe @sara a fri', 'hotkey', NOW);
    const b = call('prep_brief', { person: 'sara' }).json;
    expect(Object.keys(b).sort()).toEqual(['bring_up', 'cadence_overdue', 'handle', 'i_owe_them', 'name', 'recent_interactions', 'relation', 'said_log', 'they_owe_me']);
    expect(b.said_log).toHaveLength(5);
  });

  it('list_people hides archived people unless asked', () => {
    store.capture('owe @sara a', 'hotkey', NOW);
    store.capture('owe @amir a', 'hotkey', NOW);
    const p = store.person('amir')!; p.archived = true; p.cadenceDays = 7; store.savePerson(p);
    expect(call('list_people').json.people.map((x: any) => x.handle)).toEqual(['sara']);
    const all = call('list_people', { include_archived: true }).json.people;
    expect(all.map((x: any) => x.handle)).toEqual(['amir', 'sara']);
    expect(all[0]).toMatchObject({ archived: true, cadence_days: 7, cadence_overdue: false });
  });

  it('complete_item on a recurring item returns the next occurrence, otherwise null', () => {
    store.person('sara');
    const r = call('add_item', { kind: 'owe', title: 'weekly', person: 'sara', due: '2026-10-19', recurrence: 'FREQ=WEEKLY' }).json;
    const c = call('complete_item', { id: r.id }).json;
    expect(c.completed.status).toBe('done');
    expect(c.next_occurrence).toMatchObject({ title: 'weekly', due: '2026-10-26', recurrence: 'FREQ=WEEKLY', status: 'open' });
    const plain = call('add_item', { kind: 'task', title: 'once' }).json;
    expect(call('complete_item', { id: plain.id }).json.next_occurrence).toBeNull();
  });

  it('update_item changes fields and replaces tags; bad values are ignored', () => {
    store.person('sara');
    store.person('amir');
    const id = call('add_item', { kind: 'task', title: 'old', tags: ['x'] }).json.id;
    const u = call('update_item', { id, fields: {
      title: 'new', body: 'b', quote: 'q', kind: 'owe', pinned: true, person: '@amir', due: '2026-11-02 10:00', remind_at: '2026-11-02T08:00:00Z', tags: ['A', 'B'],
    } }).json;
    expect(u).toMatchObject({ title: 'new', body: 'b', quote: 'q', kind: 'owe', pinned: true, person: 'amir', due: '2026-11-02T10:00:00Z', remind_at: '2026-11-02T08:00:00Z', tags: ['a', 'b'], inbox: false });
    const v = call('update_item', { id, fields: { status: 'bogus', kind: 'bogus', pinned: 'x', tags: [1, 2] } }).json;
    expect(v).toMatchObject({ kind: 'owe', pinned: true, status: 'open', tags: ['a', 'b'] });
    const d = call('update_item', { id, fields: { status: 'done' } }).json;
    expect(d.status).toBe('done');
    expect(store.item(id)!.completedAt).toBe(NOW);
    expect(call('update_item', { id, fields: { person: 'zed' } }).text).toBe("No person with handle 'zed'.");
  });

  it('search supports filters and never returns hidden people', () => {
    store.capture('owe @sara review RFC fri', 'hotkey', NOW);
    store.capture('wait @amir review spec mon', 'hotkey', NOW);
    const titles = (args: object) => (call('search', args).json.items as any[]).map((i) => i.title).sort();
    expect(titles({ query: 'review' })).toEqual(['review RFC', 'review spec']);
    expect(titles({ query: 'review', filters: { kind: 'wait' } })).toEqual(['review spec']);
    expect(titles({ query: 'review', filters: { person: '@sara' } })).toEqual(['review RFC']);
    expect(titles({ query: 'review', filters: { before: '2026-10-17', status: 'open' } })).toEqual(['review RFC']);
    expect(call('search', { query: 'review' }).json.count).toBe(2);
  });

  it('week_summary lists created, completed, slipped, stale_waits', () => {
    const a = store.capture('owe @sara a fri', 'hotkey', NOW - 86_400_000);
    store.capture('wait @amir old', 'hotkey', NOW - 30 * 86_400_000);
    store.complete(a.id, NOW - 1000);
    const w = call('week_summary').json;
    expect(Object.keys(w).sort()).toEqual(['completed', 'created', 'from', 'slipped', 'stale_waits', 'to']);
    expect(w.created.map((i: any) => i.title)).toEqual(['a']);
    expect(w.completed.map((i: any) => i.title)).toEqual(['a']);
    expect(w.stale_waits.map((i: any) => i.title)).toEqual(['old']);
  });
});

describe('read-only mode', () => {
  it('blocks every write tool, audits each as blocked, and still serves reads and resources', () => {
    const i = store.capture('owe @sara x fri', 'hotkey', NOW);
    store.saveSettings({ ...store.settings(), mcpReadOnly: true });
    for (const tool of WRITE_TOOLS) {
      const r = call(tool, { text: 'todo y', kind: 'owe', title: 'y', id: i.id, until: 'fri', person: 'sara', fields: { title: 'z' } });
      expect(r.isError, tool).toBe(true);
      expect(r.text).toBe('Jaffloop is in read-only mode for Claude. Change this in Settings > MCP.');
    }
    expect(store.items({ status: null }, NOW)).toHaveLength(1);
    expect(store.item(i.id)!.title).toBe('x');
    expect(store.interactions(store.person('sara')!.id)).toHaveLength(0);
    expect(store.auditLog().map((e) => [e.tool, e.summary, e.wrote])).toEqual(
      WRITE_TOOLS.map((t) => [t, 'blocked: read-only mode', false]).reverse(),
    );
    for (const [tool, args] of [['list_items', {}], ['get_person', { handle: 'sara' }], ['list_people', {}], ['search', { query: 'x' }], ['prep_brief', { person: 'sara' }], ['week_summary', {}]] as const) {
      expect(call(tool, args).isError, tool).toBe(false);
    }
    expect(read('jaffloop://today').result).toBeDefined();
    store.saveSettings({ ...store.settings(), mcpReadOnly: false });
    expect(call('capture', { text: 'todo y' }).isError).toBe(false);
  });

  it('an unknown tool is not a write tool, so read-only does not hide the unknown-tool error', () => {
    store.saveSettings({ ...store.settings(), mcpReadOnly: true });
    expect(call('nope').text).toBe('unknown tool: nope');
  });
});

describe('hidden people', () => {
  beforeEach(() => {
    store.capture('owe @sara secret thing fri', 'hotkey', NOW);
    store.capture('wait @sara secret wait mon', 'hotkey', NOW);
    store.capture('said @sara "secret quote"', 'hotkey', NOW);
    store.capture('todo @sara secret todo', 'hotkey', NOW);
    store.logInteraction(store.person('sara')!.id, '1on1', 'secret notes', NOW);
    store.capture('owe @amir visible thing fri', 'hotkey', NOW);
    store.capture('wait @amir old visible wait yesterday', 'hotkey', NOW - 40 * 86_400_000);
    store.capture('todo inbox thing', 'hotkey', NOW);
    hide('sara');
  });

  it('is absent from every tool', () => {
    const outputs = [
      call('list_items', { status: 'any' }).text, call('list_items', { person: 'amir' }).text, call('search', { query: 'secret' }).text,
      call('search', { query: 'thing' }).text, call('search', { query: 'x', filters: { person: 'sara' } }).text, call('list_people', { include_archived: true }).text,
      call('week_summary', { from: '2020-01-01', to: '2030-01-01' }).text, call('get_person', { handle: 'amir' }).text, call('prep_brief', { person: 'amir' }).text,
    ];
    for (const o of outputs) { expect(o).not.toMatch(/secret|sara|Sara/); }
    expect(call('list_items').json.items.map((i: any) => i.title).sort()).toEqual(['inbox thing', 'old visible wait yesterday', 'visible thing']);
  });

  it('is rejected by handle and by item id', () => {
    const ids = store.items({ status: null, includeSnoozed: true }, NOW).filter((i) => store.person('sara')!.id === i.personId).map((i) => i.id);
    expect(ids.length).toBe(4);
    for (const h of ['sara', '@sara', 'SARA']) {
      expect(call('get_person', { handle: h }).text).toBe("No person with handle '" + h.replace(/^@/, '') + "'.");
      expect(call('prep_brief', { person: h }).isError).toBe(true);
      expect(call('list_items', { person: h }).isError).toBe(true);
      expect(call('log_interaction', { person: h }).isError).toBe(true);
      expect(call('add_item', { kind: 'owe', title: 'x', person: h }).isError).toBe(true);
    }
    for (const id of ids) {
      expect(call('complete_item', { id }).text).toBe('No item with that id.');
      expect(call('snooze_item', { id, until: 'fri' }).text).toBe('No item with that id.');
      expect(call('update_item', { id, fields: { title: 'hacked' } }).text).toBe('No item with that id.');
      expect(store.item(id)!.title).not.toBe('hacked');
      expect(store.item(id)!.status).toBe('open');
    }
    expect(call('capture', { text: 'owe @sara x' }).text).toBe("No person with handle 'sara'.");
    expect(call('capture', { text: 'owe @SARA x' }).isError).toBe(true);
    const amirItem = store.items({ personId: store.person('amir')!.id }, NOW)[0]!;
    expect(call('update_item', { id: amirItem.id, fields: { person: 'sara' } }).isError).toBe(true);
    expect(store.item(amirItem.id)!.personId).toBe(store.person('amir')!.id);
  });

  it('is absent from the resources, and its person resource is refused', () => {
    for (const uri of ['jaffloop://today', 'jaffloop://ledger', 'jaffloop://person/amir']) {
      expect(read(uri).result.contents[0].text, uri).not.toMatch(/secret|sara|Sara/);
    }
    expect(read('jaffloop://ledger').result.contents[0].text).toContain('amir');
    expect(read('jaffloop://person/sara').error.code).toBe(-32002);
    expect(read('jaffloop://person/sara').error.message).toContain('No person with handle');
  });

  it('shows again when unhidden', () => {
    const p = store.person('sara')!; p.hiddenFromClaude = false; store.savePerson(p);
    expect(call('list_items').text).toContain('secret thing');
    expect(call('get_person', { handle: 'sara' }).isError).toBe(false);
  });
});

describe('person notes never leave the process', () => {
  it('appear in no tool result and no resource', () => {
    const MARK = 'NOTES-MARK-4711';
    for (const h of ['sara', 'amir']) store.capture(`owe @${h} thing fri`, 'hotkey', NOW);
    store.capture('said @sara "hi"', 'hotkey', NOW);
    for (const h of ['sara', 'amir']) { const p = store.person(h)!; p.notes = `${MARK} ${h}`; p.cadenceDays = 7; store.savePerson(p); }
    store.logInteraction(store.person('sara')!.id, '1on1', 'chat', NOW);
    const id = store.items({}, NOW)[0]!.id;
    const outs = [
      rpc('tools/list'), rpc('resources/list'), rpc('resources/templates/list'),
      ...[
        ['list_items', { status: 'any' }], ['get_person', { handle: 'sara' }], ['get_person', { handle: 'amir' }], ['list_people', { include_archived: true }],
        ['prep_brief', { person: 'sara' }], ['search', { query: 'thing' }], ['search', { query: MARK }], ['week_summary', { from: '2020-01-01', to: '2030-01-01' }],
        ['update_item', { id, fields: { title: 'renamed' } }], ['complete_item', { id }], ['capture', { text: 'owe @sara more' }], ['log_interaction', { person: 'sara', notes: 'n' }],
      ].map(([t, a]) => rpc('tools/call', { name: t as string, arguments: a as object })),
      read('jaffloop://today'), read('jaffloop://ledger'), read('jaffloop://person/sara'), read('jaffloop://person/amir'),
    ];
    const blob = JSON.stringify(outs);
    expect(blob).not.toContain(MARK);
    expect(blob).not.toMatch(/"notes"\s*:\s*"NOTES/);
    expect(call('search', { query: MARK }).json.count).toBe(0);
    expect(Object.keys(call('get_person', { handle: 'sara' }).json)).not.toContain('notes');
  });
});

describe('audit log', () => {
  it('records tool, summary and wrote for successes, errors and unknown tools', () => {
    call('capture', { text: 'owe @sara review RFC fri' });
    const id = store.items({}, NOW)[0]!.id;
    call('list_items');
    call('get_person', { handle: 'sara' });
    call('list_people');
    call('search', { query: 'review' });
    call('prep_brief', { person: 'sara' });
    call('week_summary');
    call('add_item', { kind: 'note', title: 'n1' });
    call('update_item', { id, fields: { title: 'RFC2' } });
    call('snooze_item', { id, until: 'fri' });
    call('log_interaction', { person: 'sara' });
    call('complete_item', { id });
    call('get_person', { handle: 'zed' });
    call('complete_item', { id: 'nope' });
    call('capture', {});
    call('whatever');
    const log = store.auditLog(100).reverse().map((e) => [e.tool, e.summary, e.wrote]);
    expect(log).toEqual([
      ['capture', 'capture: owe "review RFC"', true],
      ['list_items', 'list_items: 1 result(s)', false],
      ['get_person', 'get_person: sara', false],
      ['list_people', 'list_people: 1', false],
      ['search', 'search: "review" -> 1', false],
      ['prep_brief', 'prep_brief: sara', false],
      ['week_summary', 'week_summary', false],
      ['add_item', 'add_item: note "n1"', true],
      ['update_item', 'update_item: "review RFC"', true],
      ['snooze_item', 'snooze_item: "RFC2"', true],
      ['log_interaction', 'log_interaction: sara', true],
      ['complete_item', 'complete_item: "RFC2"', true],
      ['get_person', "error: No person with handle 'zed'.", false],
      ['complete_item', 'error: No item with that id.', false],
      ['capture', 'error: text is required', false],
      ['whatever', 'error: unknown tool: whatever', false],
    ]);
    expect(store.auditLog(1)[0]!.at).toBe(NOW);
  });

  it('resources and protocol calls are not audited', () => {
    read('jaffloop://today');
    rpc('tools/list');
    rpc('initialize', {});
    expect(store.auditLog()).toHaveLength(0);
  });
});

describe('stdio framing over a real process', () => {
  const bundle = resolve(__dirname, '../dist/mcp/server.cjs');
  const built = existsSync(bundle);
  if (!built) console.warn('mcp.test: SKIPPING the child-process tests, dist/mcp/server.cjs is missing. Run `node scripts/build.mjs --only=mcp` first.');
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'jaffloop-mcp-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  function converse(lines: string[], args: string[] = []): Promise<{ out: string; err: string; code: number | null }> {
    return new Promise((res, rej) => {
      const child = spawn(process.execPath, [bundle, '--db', join(dir, 'p.sqlite'), ...args], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, TZ: 'UTC' } });
      let out = '', err = '';
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { err += d; });
      child.on('error', rej);
      child.on('close', (code) => res({ out, err, code }));
      child.stdin.end(lines.join('\n') + '\n'); // EOF after the last request: the server must exit by itself
    });
  }

  it.skipIf(!built)('(needs dist/mcp/server.cjs) initialize, tools/list, capture and list_items as newline-delimited JSON-RPC; exits cleanly on EOF', async () => {
    const { out, code } = await converse([
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      '',
      'this is not json',
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
      JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'capture', arguments: { text: 'owe @sara review RFC fri' } } }),
      JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'list_items', arguments: { person: 'sara' } } }),
      JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'bogus' }),
    ]);
    expect(code).toBe(0);
    const lines = out.split('\n').filter(Boolean);
    const replies = lines.map((l) => JSON.parse(l)); // every stdout line is a protocol message
    expect(replies.map((r) => r.id)).toEqual([1, 2, 3, 4, 5]);
    expect(replies[0].result.serverInfo.name).toBe('jaffloop');
    expect(replies[0].result.serverInfo.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(replies[1].result.tools).toHaveLength(12);
    expect(replies[2].result.isError).toBeUndefined();
    expect(JSON.parse(replies[3].result.content[0].text)).toMatchObject({ count: 1, items: [{ title: 'review RFC', kind: 'owe', person: 'sara' }] });
    expect(replies[4].error.code).toBe(-32601);
  }, 20_000);

  it.skipIf(!built)('(needs dist/mcp/server.cjs) handles a last line without a trailing newline and prints --version', async () => {
    const child = spawn(process.execPath, [bundle, '--db', join(dir, 'q.sqlite')], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stdin.end(JSON.stringify({ jsonrpc: '2.0', id: 'a', method: 'ping' }));
    await new Promise((r) => child.on('close', r));
    expect(JSON.parse(out)).toEqual({ jsonrpc: '2.0', id: 'a', result: {} });
    const v = await converse([], ['--version']);
    expect(v.out).toMatch(/^jaffloop-mcp \d+\.\d+\.\d+/);
    expect(v.code).toBe(0);
  }, 20_000);

  it.skipIf(!built)('(needs dist/mcp/server.cjs) shares the database file with the app: a capture over stdio is visible to a Store on the same file', async () => {
    await converse([JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'capture', arguments: { text: 'owe @sara from stdio' } } })]);
    const { openDatabase } = await import('../src/core/db');
    const db = openDatabase(join(dir, 'p.sqlite'));
    try {
      const s = new Store(db);
      expect(s.items({}).map((i) => [i.title, i.source])).toEqual([['from stdio', 'mcp']]);
      expect(s.auditLog()[0]).toMatchObject({ tool: 'capture', wrote: true });
    } finally { db.close(); }
  }, 20_000);

  it.skipIf(!built)('(needs dist/mcp/server.cjs) exits with status 1 and a message on stderr when the database cannot be opened', async () => {
    const child = spawn(process.execPath, [bundle, '--db', dir], { stdio: ['pipe', 'pipe', 'pipe'] }); // a directory, not a file
    let err = '', out = '';
    child.stderr.on('data', (d) => { err += d; });
    child.stdout.on('data', (d) => { out += d; });
    child.stdin.end();
    const code = await new Promise((r) => child.on('close', r));
    expect(code).toBe(1);
    expect(err).toContain('jaffloop-mcp:');
    expect(out).toBe('');
  }, 20_000);

});
