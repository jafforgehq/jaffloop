// 0.4.0: person title (migration v5, round trip, MCP output) and the save_person MCP tool.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { MIGRATIONS, Store, newPerson, openDatabase, openMemoryDatabase } from '../src/core';
import { seed } from '../src/core/seed';
import { MCPServer } from '../src/mcp/server';

const NOW = Date.UTC(2026, 9, 15, 9, 0, 0);
const dir = mkdtempSync(join(tmpdir(), 'jaffloop-title-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

let store: Store;
let server: MCPServer;
let rpcId = 0;
beforeEach(() => {
  store = new Store(openMemoryDatabase());
  server = new MCPServer(store, { now: () => NOW });
});

function call(tool: string, args: object = {}): { text: string; isError: boolean; json: any } {
  const res = (server.handle({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name: tool, arguments: args } }) as any).result;
  const text: string = res.content[0].text;
  let json: unknown;
  try { json = JSON.parse(text); } catch { json = undefined; }
  return { text, isError: res.isError === true, json };
}
const lastAudit = () => store.auditLog(1)[0]!;

describe('migration v5-people-title-proposed', () => {
  it('moves a v4 database to v5 keeping people and items; title is empty, items are not proposed', () => {
    const path = join(dir, 'v4-to-v5.sqlite');
    const db = new DatabaseSync(path);
    for (const m of MIGRATIONS.slice(0, 4)) db.exec(m.sql);
    db.exec('CREATE TABLE grdb_migrations (identifier TEXT NOT NULL PRIMARY KEY)');
    db.exec("INSERT INTO grdb_migrations VALUES ('v1'), ('v2-person-notes'), ('v3-person-dates'), ('v4-external-ids')");
    db.exec("INSERT INTO people(id, handle, name, notes, birthday) VALUES ('P1', 'sara', 'Sara', 'keep me', '03-04')");
    db.exec(`INSERT INTO items(id, kind, title, person_id, external_id, created_at, updated_at, last_touched_at) VALUES ('I1', 'owe', 'keep me', 'P1', 'x:1', '2026-10-01 09:00:00.000', '2026-10-01 09:00:00.000', '2026-10-01 09:00:00.000')`);
    db.close();

    const migrated = openDatabase(path);
    const ids = (migrated.prepare('SELECT identifier FROM grdb_migrations ORDER BY identifier').all() as Array<{ identifier: string }>).map((r) => r.identifier);
    expect(ids).toContain('v5-people-title-proposed');
    const s = new Store(migrated);
    expect(s.person('sara', false)).toMatchObject({ name: 'Sara', notes: 'keep me', birthday: '03-04', title: '' });
    expect(s.item('I1')).toMatchObject({ title: 'keep me', externalId: 'x:1', proposed: false });
    expect(s.items({}, NOW)).toHaveLength(1);
    migrated.close();
  });
});

describe('person title', () => {
  it('newPerson defaults to an empty title and a title survives save, read and export', () => {
    expect(newPerson({ handle: 'a', name: 'A' }).title).toBe('');
    const p = store.person('sara')!;
    expect(p.title).toBe('');
    store.savePerson({ ...p, title: 'Staff engineer' });
    expect(store.person('sara', false)!.title).toBe('Staff engineer');
    expect(store.people()[0]!.title).toBe('Staff engineer');
    expect(store.personSummaries(NOW)[0]!.person.title).toBe('Staff engineer');
    expect(JSON.parse(store.exportJSON()).people[0]).toMatchObject({ handle: 'sara', title: 'Staff engineer' });
  });

  it('the seed gives the demo people titles', () => {
    seed(store, NOW);
    const t = Object.fromEntries(store.people().map((p) => [p.handle, p.title]));
    expect(t).toMatchObject({ sara: 'Staff engineer', amir: 'Senior engineer', maya: 'Product manager', jonas: 'Engineering manager', priya: 'Junior engineer' });
  });

  it('MCP shows title only when it is not empty (list_people, get_person, prep_brief)', () => {
    store.person('sara'); store.person('amir');
    store.savePerson({ ...store.person('sara')!, title: 'Staff engineer' });
    const list = call('list_people').json.people as any[];
    expect(list.find((p) => p.handle === 'sara').title).toBe('Staff engineer');
    expect('title' in list.find((p) => p.handle === 'amir')).toBe(false);
    expect(call('get_person', { handle: 'sara' }).json.title).toBe('Staff engineer');
    expect('title' in call('get_person', { handle: 'amir' }).json).toBe(false);
    expect(call('prep_brief', { person: 'sara' }).json.title).toBe('Staff engineer');
    expect('title' in call('prep_brief', { person: 'amir' }).json).toBe(false);
  });
});

describe('save_person', () => {
  it('creates a person from a handle alone with a name made from it', () => {
    const r = call('save_person', { handle: 'sara.lee' });
    expect(r.isError).toBe(false);
    expect(r.json).toEqual({ handle: 'sara.lee', name: 'Sara Lee', relation: 'other', open_i_owe: 0, open_they_owe: 0, cadence_overdue: false, archived: false, created: true });
    expect(store.person('sara.lee', false)).toMatchObject({ name: 'Sara Lee', relation: 'other', title: '', cadenceDays: null });
    expect(lastAudit()).toMatchObject({ tool: 'save_person', summary: 'save_person: sara.lee', wrote: true });
  });

  it('creates with every field; the result is the list_people shape plus created, and never echoes birthday or start date', () => {
    const r = call('save_person', {
      handle: '@Sara', name: ' Sara Lindqvist ', title: 'Staff engineer', relation: 'report', cadence_days: 14,
      match_emails: 'sara@acme.com, Sara.L@acme.com ,', start_date: '2023-04-17', birthday: '1990-11-09',
    });
    expect(r.json).toEqual({
      handle: 'sara', name: 'Sara Lindqvist', title: 'Staff engineer', relation: 'report', cadence_days: 14, open_i_owe: 0, open_they_owe: 0,
      cadence_overdue: false, archived: false, created: true,
    });
    expect(r.text).not.toMatch(/1990|11-09|2023|start_date|birthday/);
    expect(store.person('sara', false)).toMatchObject({
      name: 'Sara Lindqvist', title: 'Staff engineer', relation: 'report', cadenceDays: 14, matchEmails: 'sara@acme.com, Sara.L@acme.com', startDate: '2023-04-17', birthday: '11-09',
    });
    const listed = (call('list_people').json.people as any[]).find((p) => p.handle === 'sara');
    expect({ ...r.json, created: undefined }).toEqual({ ...listed, created: undefined });
  });

  it('updates only the fields that are present and returns created false', () => {
    call('save_person', { handle: 'sara', name: 'Sara L', title: 'Engineer', relation: 'report', cadence_days: 7, birthday: '03-04' });
    store.savePerson({ ...store.person('sara', false)!, notes: 'private notes' });
    const r = call('save_person', { handle: 'SARA', title: 'Staff engineer' });
    expect(r.json).toMatchObject({ handle: 'sara', name: 'Sara L', title: 'Staff engineer', relation: 'report', cadence_days: 7, created: false });
    expect(store.person('sara', false)).toMatchObject({ notes: 'private notes', birthday: '03-04' });
    // empty title clears; cadence null and 0 clear; archived toggles
    expect('title' in call('save_person', { handle: 'sara', title: '' }).json).toBe(false);
    expect('cadence_days' in call('save_person', { handle: 'sara', cadence_days: null }).json).toBe(false);
    call('save_person', { handle: 'sara', cadence_days: 30 });
    expect('cadence_days' in call('save_person', { handle: 'sara', cadence_days: 0 }).json).toBe(false);
    expect(call('save_person', { handle: 'sara', archived: true }).json.archived).toBe(true);
    expect(store.person('sara', false)!.archived).toBe(true);
    expect(call('save_person', { handle: 'sara', archived: false, birthday: null, start_date: '' }).json.archived).toBe(false);
    expect(store.person('sara', false)).toMatchObject({ birthday: null, startDate: null });
  });

  it('cannot write notes or hidden_from_claude', () => {
    call('save_person', { handle: 'sara', notes: 'x', hidden_from_claude: true, hiddenFromClaude: true });
    expect(store.person('sara', false)).toMatchObject({ notes: '', hiddenFromClaude: false });
  });

  it('refuses a person hidden from Claude like everywhere else', () => {
    store.savePerson({ ...store.person('boss')!, hiddenFromClaude: true });
    const r = call('save_person', { handle: 'boss', title: 'CEO' });
    expect(r).toMatchObject({ isError: true, text: "No person with handle 'boss'." });
    expect(store.person('boss', false)!.title).toBe('');
    expect(lastAudit()).toMatchObject({ tool: 'save_person', wrote: false });
  });

  it('is blocked in read-only mode', () => {
    store.saveSettings({ ...store.settings(), mcpReadOnly: true });
    const r = call('save_person', { handle: 'sara' });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('read-only');
    expect(store.person('sara', false)).toBeNull();
    expect(lastAudit()).toMatchObject({ tool: 'save_person', summary: 'blocked: read-only mode', wrote: false });
  });

  it.each([
    [{}, 'handle is required'],
    [{ handle: '  ' }, 'handle is required'],
    [{ handle: 'sara lee' }, 'handle may only contain'],
    [{ handle: 'sara', name: '  ' }, 'name must not be empty'],
    [{ handle: 'sara', title: 5 }, 'title must be a string'],
    [{ handle: 'sara', relation: 'boss' }, 'relation must be one of report, peer, manager, stakeholder, other'],
    [{ handle: 'sara', cadence_days: 91 }, 'cadence_days must be an integer from 1 to 90'],
    [{ handle: 'sara', cadence_days: -1 }, 'cadence_days must be an integer from 1 to 90'],
    [{ handle: 'sara', cadence_days: 1.5 }, 'cadence_days must be an integer from 1 to 90'],
    [{ handle: 'sara', cadence_days: '14' }, 'cadence_days must be an integer from 1 to 90'],
    [{ handle: 'sara', start_date: '2023-02-30' }, 'start_date must be'],
    [{ handle: 'sara', start_date: '17.04.2023' }, 'start_date must be'],
    [{ handle: 'sara', birthday: '13-01' }, 'birthday must be'],
    [{ handle: 'sara', birthday: '02-30' }, 'birthday must be'],
    [{ handle: 'sara', birthday: 'Nov 9' }, 'birthday must be'],
    [{ handle: 'sara', archived: 'yes' }, 'archived must be true or false'],
  ])('rejects %j and writes nothing', (args, msg) => {
    const r = call('save_person', args);
    expect(r.isError).toBe(true);
    expect(r.text).toContain(msg);
    expect(store.people(true)).toHaveLength(0);
    expect(lastAudit()).toMatchObject({ tool: 'save_person', wrote: false });
  });

  it('an invalid field does not change the others on an existing person', () => {
    call('save_person', { handle: 'sara', title: 'Engineer' });
    expect(call('save_person', { handle: 'sara', title: 'Staff', relation: 'nope' }).isError).toBe(true);
    expect(store.person('sara', false)!.title).toBe('Engineer');
  });

  it('accepts a leap-day birthday and keeps MM-DD', () => {
    call('save_person', { handle: 'sara', birthday: '02-29' });
    expect(store.person('sara', false)!.birthday).toBe('02-29');
  });

  it('the tool is listed with handle required and a description that says what to do first', () => {
    const tools = (server.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) as any).result.tools as any[];
    const t = tools.find((x) => x.name === 'save_person');
    expect(t.inputSchema.required).toEqual(['handle']);
    expect(Object.keys(t.inputSchema.properties)).toEqual(['handle', 'name', 'title', 'relation', 'cadence_days', 'match_emails', 'start_date', 'birthday', 'archived']);
    expect(t.description).toMatch(/list_people first/);
    expect(t.description).toMatch(/never invent birthdays/);
  });
});
