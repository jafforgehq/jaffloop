// GRDB compatibility: databases made by the Swift build open and migrate, and what we write reads back through sqlite3 and the Swift binary.
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, describe, expect, it } from 'vitest';
import { MIGRATIONS, Store, fromDbDate, newItem, openDatabase, toDbDate } from '../src/core';

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

const ALL_MIGRATIONS = ['v1', 'v2-person-notes', 'v3-person-dates', 'v4-external-ids', 'v5-people-title-proposed'];
const hasSqlite3 = spawnSync('sqlite3', ['--version']).status === 0;
// the sqlite3 CLI on some machines (GitHub's macOS runners) is built without FTS5
const cliHasFts5 = hasSqlite3 && spawnSync('sqlite3', [':memory:', 'create virtual table t using fts5(a)']).status === 0;
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

const V4_ALTERS = `ALTER TABLE "items" ADD COLUMN "external_id" TEXT; ALTER TABLE "items" ADD COLUMN "source_label" TEXT; ALTER TABLE "items" ADD COLUMN "source_url" TEXT;
  ALTER TABLE "items" ADD COLUMN "interaction_id" TEXT; CREATE UNIQUE INDEX "items_external_id" ON "items"("external_id") WHERE "external_id" IS NOT NULL`;

/** The Swift v2 fixture plus the 0.2.0, 0.3.0 and 0.4.0 columns, as ALTER TABLE leaves them: what every database must look like now. */
function currentSchema(): ReturnType<typeof schema> {
  const db = new DatabaseSync(':memory:');
  const fixture = new DatabaseSync(join(FIX, 'swift-v2.sqlite'), { readOnly: true });
  for (const r of fixture.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'items_fts_%' ORDER BY rowid").all() as Array<{ sql: string }>) db.exec(r.sql);
  fixture.close();
  db.exec('ALTER TABLE "people" ADD COLUMN "start_date" TEXT; ALTER TABLE "people" ADD COLUMN "birthday" TEXT');
  db.exec(V4_ALTERS);
  db.exec(`ALTER TABLE "people" ADD COLUMN "title" TEXT NOT NULL DEFAULT ''; ALTER TABLE "items" ADD COLUMN "proposed" BOOLEAN NOT NULL DEFAULT 0`);
  const out = schema(db);
  db.close();
  return out;
}

describe('opening a database made by the Swift app (v2)', () => {
  it('reads people, items, tags, interactions and settings', () => {
    const db = openDatabase(copyFixture('swift-v2.sqlite'));
    const store = new Store(db);
    expect(migrations(db)).toEqual(ALL_MIGRATIONS);
    expect(store.people().map((p) => p.handle)).toEqual(['amir', 'sara']);
    const sara = store.person('sara', false)!;
    expect(sara).toMatchObject({ name: 'Sara', notes: 'Prefers async. Staff promo 2027.', cadenceDays: 14, relation: 'report', hiddenFromClaude: false, archived: false, startDate: null, birthday: null });
    expect(store.settings()).toMatchObject({ jiraBaseUrl: '', captureTemplates: [] });
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
  it('only adds the v3 to v5 columns to the schema, and keeps all data', () => {
    const fixture = new DatabaseSync(join(FIX, 'swift-v2.sqlite'), { readOnly: true });
    const before = fixture.prepare('SELECT * FROM people ORDER BY id').all() as Array<Record<string, unknown>>;
    const nItems = (fixture.prepare('SELECT COUNT(*) c FROM items').get() as { c: number }).c;
    fixture.close();
    const db = openDatabase(copyFixture('swift-v2.sqlite'));
    expect(schema(db)).toEqual(currentSchema());
    expect(db.prepare('SELECT * FROM people ORDER BY id').all()).toEqual(before.map((p) => ({ ...p, start_date: null, birthday: null, title: '' })));
    expect(db.prepare('SELECT COUNT(*) c FROM items').get()).toEqual({ c: nItems });
    expect(db.prepare('SELECT COUNT(*) c FROM items WHERE external_id IS NOT NULL OR source_label IS NOT NULL OR source_url IS NOT NULL OR interaction_id IS NOT NULL').get()).toEqual({ c: 0 });
    db.close();
  });
  it('person dates, Jira base and capture templates survive a round trip', () => {
    const db = openDatabase(copyFixture('swift-v2.sqlite'));
    const store = new Store(db);
    const p = store.person('sara', false)!;
    store.savePerson({ ...p, startDate: '2024-03-04', birthday: '11-09' });
    expect(store.person('sara', false)).toMatchObject({ startDate: '2024-03-04', birthday: '11-09' });
    expect(store.personSummaries(Date.UTC(2026, 9, 15)).find((x) => x.person.handle === 'sara')!.person).toMatchObject({ startDate: '2024-03-04', birthday: '11-09' });
    const s = store.settings();
    store.saveSettings({ ...s, jiraBaseUrl: 'https://x.atlassian.net/browse/', captureTemplates: [{ name: 'prep', lines: ['bring @{person} a'] }] });
    expect(store.settings()).toMatchObject({ jiraBaseUrl: 'https://x.atlassian.net/browse/', captureTemplates: [{ name: 'prep', lines: ['bring @{person} a'] }] });
    expect(JSON.parse(store.exportJSON()).people.find((x: { handle: string }) => x.handle === 'sara')).toMatchObject({ start_date: '2024-03-04', birthday: '11-09' });
    db.close();
  });
});

describe('migrating a v1 database', () => {
  it('adds people.notes and the v3 dates, keeps all data and records both migrations', () => {
    const path = copyFixture('swift-v1.sqlite');
    const raw = new DatabaseSync(path);
    expect(migrations(raw)).toEqual(['v1']);
    expect((raw.prepare('PRAGMA table_info(people)').all() as Array<{ name: string }>).map((c) => c.name)).not.toContain('notes');
    raw.close();

    const db = openDatabase(path);
    const store = new Store(db);
    expect(migrations(db)).toEqual(ALL_MIGRATIONS);
    expect(store.people().map((p) => ({ h: p.handle, n: p.notes, c: p.cadenceDays, s: p.startDate, b: p.birthday })))
      .toEqual([{ h: 'amir', n: '', c: null, s: null, b: null }, { h: 'sara', n: '', c: 14, s: null, b: null }]);
    expect(store.items({ status: null, includeSnoozed: true })).toHaveLength(8);
    expect(store.search('RFC')).toHaveLength(1);
    const p = store.person('sara')!; p.notes = 'hello'; store.savePerson(p);
    expect(store.person('sara')!.notes).toBe('hello');
    // the ALTERs we run produce exactly the DDL GRDB produced, plus our columns
    expect(schema(db)).toEqual(currentSchema());
    db.close();
  });
  it('a v2 database (as the 0.1.0 app left it) moves to v3 with its people intact', () => {
    const path = join(dir, 'v2-to-v3.sqlite');
    const db = new DatabaseSync(path);
    for (const m of MIGRATIONS.slice(0, 2)) { db.exec(m.sql); }
    db.exec('CREATE TABLE grdb_migrations (identifier TEXT NOT NULL PRIMARY KEY)');
    db.exec("INSERT INTO grdb_migrations VALUES ('v1'), ('v2-person-notes')");
    db.exec("INSERT INTO people(id, handle, name, notes) VALUES ('P1', 'sara', 'Sara', 'keep me')");
    db.close();
    const migrated = openDatabase(path);
    expect(migrations(migrated)).toEqual(ALL_MIGRATIONS);
    expect(new Store(migrated).person('sara', false)).toMatchObject({ notes: 'keep me', startDate: null, birthday: null });
    migrated.close();
  });
});

describe('migrating to v4 (0.3.0)', () => {
  it('a v3 database (as 0.2.0 left it) moves to v4 keeping every item, and external ids become unique', () => {
    const path = join(dir, 'v3-to-v4.sqlite');
    const db = new DatabaseSync(path);
    for (const m of MIGRATIONS.slice(0, 3)) db.exec(m.sql);
    db.exec('CREATE TABLE grdb_migrations (identifier TEXT NOT NULL PRIMARY KEY)');
    db.exec("INSERT INTO grdb_migrations VALUES ('v1'), ('v2-person-notes'), ('v3-person-dates')");
    db.exec("INSERT INTO people(id, handle, name, start_date) VALUES ('P1', 'sara', 'Sara', '2024-03-04')");
    db.exec(`INSERT INTO items(id, kind, title, person_id, created_at, updated_at, last_touched_at) VALUES ('I1', 'owe', 'keep me', 'P1', '2026-10-01 09:00:00.000', '2026-10-01 09:00:00.000', '2026-10-01 09:00:00.000')`);
    db.close();
    const migrated = openDatabase(path);
    expect(migrations(migrated)).toEqual(ALL_MIGRATIONS);
    const store = new Store(migrated);
    expect(store.item('I1')).toMatchObject({ title: 'keep me', personId: 'P1', externalId: null, sourceLabel: null, sourceUrl: null, interactionId: null });
    expect(store.person('sara', false)).toMatchObject({ startDate: '2024-03-04' });
    expect(schema(migrated)).toEqual(currentSchema());
    migrated.close();
  });
  it('the same database opened by two processes at once migrates once', () => {
    const path = copyFixture('swift-v1.sqlite');
    const a = openDatabase(path), b = openDatabase(path);
    expect(migrations(a)).toEqual(ALL_MIGRATIONS);
    expect(new Store(b).items({ status: null, includeSnoozed: true })).toHaveLength(8);
    a.close(); b.close();
  });
  it('exportJSON carries the new fields only when set', () => {
    const db = openDatabase(join(dir, 'export.sqlite'));
    const store = new Store(db);
    const plain = store.capture('todo plain');
    const { item } = store.insertOnce(newItem({ kind: 'owe', title: 'from mail', externalId: 'outlook:1', sourceLabel: 'outlook', sourceUrl: 'https://x/1' }));
    const items = JSON.parse(store.exportJSON()).items as Array<Record<string, unknown>>;
    expect(items.find((i) => i.id === plain.id)).not.toHaveProperty('external_id');
    expect(items.find((i) => i.id === item.id)).toMatchObject({ external_id: 'outlook:1', source_label: 'outlook', source_url: 'https://x/1' });
    db.close();
  });
});

describe('a new database', () => {
  it('has the same schema as a migrated Swift database, with every migration recorded', () => {
    const db = openDatabase(join(dir, 'sub', 'dir', 'new.sqlite'));    // creates the directories
    const fixture = new DatabaseSync(join(FIX, 'swift-v2.sqlite'), { readOnly: true });
    expect(schema(db)).toEqual(currentSchema());
    expect(migrations(db)).toEqual(ALL_MIGRATIONS);
    expect(MIGRATIONS.map((m) => m.id).sort()).toEqual(ALL_MIGRATIONS);
    expect(db.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' });
    expect(db.prepare('PRAGMA busy_timeout').get()).toEqual({ timeout: 5000 });
    expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
    fixture.close(); db.close();
  });
  it('opening twice is harmless', () => {
    const path = join(dir, 'twice.sqlite');
    openDatabase(path).close();
    const db = openDatabase(path);
    expect(migrations(db)).toEqual(ALL_MIGRATIONS);
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
    expect(q('SELECT handle, name, relation, cadence_days, match_emails, hidden_from_claude, archived, quote(notes), quote(start_date), quote(birthday) FROM people')).toBe("sara|Sara|other|||0|0|''|NULL|NULL");
    expect(q('SELECT occurred_at, kind, notes FROM interactions')).toBe('2026-10-14 10:00:00.123|1on1|hi');
    expect(q('SELECT at, tool, wrote FROM mcp_audit')).toBe('2026-10-14 10:00:00.123|capture|1');
    expect(q('SELECT event, detail, at FROM item_events ORDER BY id')).toBe('created|mcp|2026-10-14 10:00:00.123\nsnoozed|2026-10-20T09:00:00Z|2026-10-14 10:00:00.123');
    expect(q("SELECT key, value FROM settings WHERE key IN ('eodTime','hotkey') ORDER BY key")).toBe('eodTime|16:00\nhotkey|Alt+Space');
    expect(q('SELECT tag FROM item_tags')).toBe('rfc');
    expect(q('SELECT identifier FROM grdb_migrations ORDER BY identifier')).toBe('v1\nv2-person-notes\nv3-person-dates\nv4-external-ids\nv5-people-title-proposed');
    expect(q('PRAGMA integrity_check')).toBe('ok');
    if (cliHasFts5) expect(q("SELECT COUNT(*) FROM items WHERE rowid IN (SELECT rowid FROM items_fts WHERE items_fts MATCH '\"rev\"*')")).toBe('1');
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
