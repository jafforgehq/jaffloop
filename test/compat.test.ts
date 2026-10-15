// GRDB compatibility: databases made by the Swift build open and migrate, and what we write reads back through sqlite3 and the Swift binary.
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, describe, expect, it } from 'vitest';
import { MIGRATIONS, Store, fromDbDate, openDatabase, toDbDate } from '../src/core';

const FIX = join(__dirname, 'fixtures');
const dir = mkdtempSync(join(tmpdir(), 'jaffloop-compat-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function copyFixture(name: string): string {
  const to = join(dir, `${Math.random().toString(36).slice(2)}-${name}`);
  copyFileSync(join(FIX, name), to);
  return to;
}
const schema = (db: DatabaseSync) => (db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all());
const migrations = (db: DatabaseSync) => (db.prepare('SELECT identifier FROM grdb_migrations ORDER BY identifier').all() as Array<{ identifier: string }>).map((r) => r.identifier);

const hasSqlite3 = spawnSync('sqlite3', ['--version']).status === 0;
const swiftMcp = join(__dirname, '..', 'dist/Jaffloop.app/Contents/MacOS/jaffloop-mcp');

describe('GRDB dates', () => {
  it('writes yyyy-MM-dd HH:mm:ss.SSS in UTC and reads what GRDB can read', () => {
    const ms = Date.UTC(2026, 9, 15, 22, 0, 0, 7);
    expect(toDbDate(ms)).toBe('2026-10-15 22:00:00.007');
    expect(fromDbDate('2026-10-15 22:00:00.007')).toBe(ms);
    expect(fromDbDate('2026-10-15 22:00:00')).toBe(ms - 7);
    expect(fromDbDate('2026-10-15 22:00')).toBe(ms - 7);
    expect(fromDbDate('2026-10-15T22:00:00.007Z')).toBe(ms);
    expect(fromDbDate('2026-10-16T00:00:00.007+02:00')).toBe(ms);
    expect(fromDbDate('2026-10-15')).toBe(Date.UTC(2026, 9, 15));
    expect(fromDbDate('2026-10-15 22:00:00.5')).toBe(ms - 7 + 500);
    expect(fromDbDate(1_800_000_000)).toBe(1_800_000_000_000);
    expect(() => fromDbDate('yesterday')).toThrow();
  });
});

describe('opening a database made by the Swift app (v2)', () => {
  it('reads people, items, tags, interactions and settings', () => {
    const db = openDatabase(copyFixture('swift-v2.sqlite'));
    const store = new Store(db);
    expect(migrations(db)).toEqual(['v1', 'v2-person-notes']);
    expect(store.people().map((p) => p.handle)).toEqual(['amir', 'sara']);
    const sara = store.person('sara', false)!;
    expect(sara).toMatchObject({ name: 'Sara', notes: 'Prefers async. Staff promo 2027.', cadenceDays: 14, relation: 'report', hiddenFromClaude: false, archived: false });
    const items = store.items({ status: null, includeSnoozed: true });
    expect(items).toHaveLength(8);
    const rfc = items.find((i) => i.title === 'review RFC')!;
    expect(rfc).toMatchObject({ kind: 'owe', personId: sara.id, status: 'open', dueHasTime: false, source: 'mcp', inbox: false, pinned: false });
    expect(rfc.dueAt).toBe(Date.UTC(2026, 9, 15, 22));   // stored by Swift as "2026-10-15 22:00:00.000"
    expect(store.tags(rfc.id)).toEqual(['rfc']);
    const daily = items.find((i) => i.title === 'standup notes')!;
    expect(daily).toMatchObject({ recurRule: 'FREQ=DAILY', pinned: true, dueHasTime: true });
    const said = items.find((i) => i.kind === 'said')!;
    expect(said.quote).toBe('we will revisit headcount in Nov');
    expect(items.find((i) => i.title === 'send report')).toMatchObject({ status: 'done' });
    expect(items.find((i) => i.title === 'send report')!.completedAt).not.toBeNull();
    expect(store.interactions(sara.id)).toMatchObject([{ kind: '1on1', notes: 'went well', calendarEventId: null }]);
    expect(store.snoozed(Date.UTC(2026, 9, 15))).toHaveLength(1);
    expect(store.snoozed(Date.UTC(2026, 9, 15))[0]!.snoozedUntil).toBe(Date.UTC(2099, 0, 1, 9));
    expect(store.auditLog().length).toBeGreaterThan(5);
    expect(store.settings()).toMatchObject({ hotkey: 'Alt+Command+J', eodTime: '16:00', haptics: false, mcpReadOnly: false, workStart: '09:00' });
    db.close();
  });
  it('FTS index built by GRDB triggers is searchable, and our writes keep it in sync', () => {
    const db = openDatabase(copyFixture('swift-v2.sqlite'));
    const store = new Store(db);
    expect(store.search('RFC')).toHaveLength(1);
    expect(store.search('cafe')).toHaveLength(1);       // unicode61 folds diacritics
    expect(store.search('@amir kind:owe')).toHaveLength(1);
    const i = store.capture('owe @sara zebra crossing');
    expect(store.search('zeb').map((x) => x.id)).toEqual([i.id]);
    db.exec("INSERT INTO items_fts(items_fts) VALUES('integrity-check')");
    expect(db.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
    db.close();
  });
  it('does not touch the schema', () => {
    const fixture = new DatabaseSync(join(FIX, 'swift-v2.sqlite'), { readOnly: true });
    const before = schema(fixture);
    fixture.close();
    const db = openDatabase(copyFixture('swift-v2.sqlite'));
    expect(schema(db)).toEqual(before);
    db.close();
  });
});

describe('migrating a v1 database', () => {
  it('adds people.notes, keeps all data and records v2-person-notes', () => {
    const path = copyFixture('swift-v1.sqlite');
    const raw = new DatabaseSync(path);
    expect(migrations(raw)).toEqual(['v1']);
    expect((raw.prepare('PRAGMA table_info(people)').all() as Array<{ name: string }>).map((c) => c.name)).not.toContain('notes');
    raw.close();

    const db = openDatabase(path);
    const store = new Store(db);
    expect(migrations(db)).toEqual(['v1', 'v2-person-notes']);
    expect(store.people().map((p) => ({ h: p.handle, n: p.notes, c: p.cadenceDays }))).toEqual([{ h: 'amir', n: '', c: null }, { h: 'sara', n: '', c: 14 }]);
    expect(store.items({ status: null, includeSnoozed: true })).toHaveLength(8);
    expect(store.search('RFC')).toHaveLength(1);
    const p = store.person('sara')!; p.notes = 'hello'; store.savePerson(p);
    expect(store.person('sara')!.notes).toBe('hello');
    // the ALTER we run produces exactly the DDL GRDB produced
    const fixture = new DatabaseSync(join(FIX, 'swift-v2.sqlite'), { readOnly: true });
    expect(schema(db)).toEqual(schema(fixture));
    fixture.close();
    db.close();
  });
});

describe('a new database', () => {
  it('has the same schema as one made by Swift, with both migrations recorded', () => {
    const db = openDatabase(join(dir, 'sub', 'dir', 'new.sqlite'));    // creates the directories
    const fixture = new DatabaseSync(join(FIX, 'swift-v2.sqlite'), { readOnly: true });
    expect(schema(db)).toEqual(schema(fixture));
    expect(migrations(db)).toEqual(['v1', 'v2-person-notes']);
    expect(MIGRATIONS.map((m) => m.id)).toEqual(['v1', 'v2-person-notes']);
    expect(db.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' });
    expect(db.prepare('PRAGMA busy_timeout').get()).toEqual({ timeout: 5000 });
    expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
    fixture.close(); db.close();
  });
  it('opening twice is harmless', () => {
    const path = join(dir, 'twice.sqlite');
    openDatabase(path).close();
    const db = openDatabase(path);
    expect(migrations(db)).toEqual(['v1', 'v2-person-notes']);
    db.close();
  });
  it('foreign keys: deleting a person nulls item.person_id and cascades interactions', () => {
    const db = openDatabase(join(dir, 'fk.sqlite'));
    const store = new Store(db);
    const i = store.capture('owe @sara x');
    store.logInteraction(store.person('sara')!.id);
    db.exec("DELETE FROM people WHERE handle='sara'");
    expect(store.item(i.id)!.personId).toBeNull();
    expect(db.prepare('SELECT COUNT(*) c FROM interactions').get()).toEqual({ c: 0 });
    db.close();
  });
  it('data_version changes when another connection commits', () => {
    const path = join(dir, 'dv.sqlite');
    const a = new Store(openDatabase(path)), b = new Store(openDatabase(path));
    const v = a.dataVersion();
    expect(a.dataVersion()).toBe(v);
    b.capture('todo from the other process');
    expect(a.dataVersion()).toBeGreaterThan(v);
    expect(a.search('process')).toHaveLength(1);
    a.db.close(); b.db.close();
  });
});

describe.skipIf(!hasSqlite3)('rows we write, read through the sqlite3 CLI', () => {
  it('use GRDB text dates, 0/1 booleans, uppercase UUIDs and the same enum strings', () => {
    const path = join(dir, 'cli.sqlite');
    const db = openDatabase(path);
    const store = new Store(db);
    const now = Date.UTC(2026, 9, 14, 10, 0, 0, 123);
    const i = store.capture('owe @sara review RFC fri 14:30 #rfc !', 'mcp', now);
    store.logInteraction(store.person('sara')!.id, '1on1', 'hi', now);
    store.audit('capture', 'x', true, now);
    store.snooze(i.id, Date.UTC(2026, 9, 20, 9), now);
    const s = store.settings(); s.eodTime = '16:00'; s.hotkey = 'Alt+Space'; store.saveSettings(s);
    db.close();

    const q = (sql: string) => execFileSync('sqlite3', ['-separator', '|', path, sql], { encoding: 'utf8' }).trim();
    expect(q('SELECT created_at, updated_at, last_touched_at, due_at, snoozed_until FROM items')).toBe(
      '2026-10-14 10:00:00.123|2026-10-14 10:00:00.123|2026-10-14 10:00:00.123|2026-10-16 14:30:00.000|2026-10-20 09:00:00.000');
    expect(q('SELECT kind, status, due_has_time, pinned, inbox, source, snooze_count, typeof(due_has_time), typeof(snooze_count) FROM items')).toBe('owe|open|1|1|0|mcp|1|integer|integer');
    expect(q('SELECT id FROM items')).toMatch(/^[0-9A-F-]{36}$/);
    expect(q('SELECT person_id = (SELECT id FROM people) FROM items')).toBe('1');
    expect(q('SELECT handle, name, relation, cadence_days, match_emails, hidden_from_claude, archived, quote(notes) FROM people')).toBe("sara|Sara|other|||0|0|''");
    expect(q('SELECT occurred_at, kind, notes FROM interactions')).toBe('2026-10-14 10:00:00.123|1on1|hi');
    expect(q('SELECT at, tool, wrote FROM mcp_audit')).toBe('2026-10-14 10:00:00.123|capture|1');
    expect(q('SELECT event, detail, at FROM item_events ORDER BY id')).toBe('created|mcp|2026-10-14 10:00:00.123\nsnoozed|2026-10-20T09:00:00Z|2026-10-14 10:00:00.123');
    expect(q("SELECT key, value FROM settings WHERE key IN ('eodTime','hotkey') ORDER BY key")).toBe('eodTime|16:00\nhotkey|Alt+Space');
    expect(q('SELECT tag FROM item_tags')).toBe('rfc');
    expect(q('SELECT identifier FROM grdb_migrations ORDER BY identifier')).toBe('v1\nv2-person-notes');
    expect(q('PRAGMA integrity_check')).toBe('ok');
    expect(q("SELECT COUNT(*) FROM items WHERE rowid IN (SELECT rowid FROM items_fts WHERE items_fts MATCH '\"rev\"*')")).toBe('1');
  });
});

describe.skipIf(!existsSync(swiftMcp))('the Swift build opens a database made by this code', () => {
  it('lists our items over its MCP server, and its writes are readable by us', () => {
    const path = join(dir, 'swift-reads.sqlite');
    const db = openDatabase(path);
    const store = new Store(db);
    store.capture('owe @sara review RFC fri #rfc', 'hotkey', Date.now());
    store.capture('todo ünïcode café');
    db.close();

    const rpc = (...calls: object[]) => spawnSync(swiftMcp, ['--db', path], {
      input: [{ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, ...calls].map((c) => JSON.stringify(c)).join('\n') + '\n', encoding: 'utf8',
    }).stdout.trim().split('\n').map((l) => JSON.parse(l));
    const tool = (id: number, name: string, args: object) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
    const out = rpc(tool(2, 'list_items', {}), tool(3, 'capture', { text: 'wait @amir swift wrote this' }), tool(4, 'search', { query: 'caf' }));
    const text = (n: number) => (out[n].result.content[0].text as string);
    expect(text(1)).toContain('review RFC');
    expect(text(1)).toContain('ünïcode café');
    expect(out[2].result.isError).not.toBe(true);
    expect(text(3)).toContain('café');

    const db2 = openDatabase(path);
    const mine = new Store(db2);
    const w = mine.search('swift')[0]!;
    expect(w).toMatchObject({ kind: 'wait', title: 'swift wrote this', source: 'mcp' });
    expect(mine.person('amir', false)).not.toBeNull();
    expect(mine.items({}).map((i) => i.title)).toContain('review RFC');
    db2.close();
  });
});
