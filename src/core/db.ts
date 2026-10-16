// SQLite access via node:sqlite, compatible with the files the Swift app made with GRDB.
// Only this module converts between epoch milliseconds and GRDB's text dates.
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

export type { DatabaseSync };
export type Row = Record<string, unknown>;

/** GRDB's storage format: "yyyy-MM-dd HH:mm:ss.SSS" in UTC. */
export function toDbDate(ms: number): string {
  const d = new Date(ms);
  const p = (n: number, w = 2): string => String(n).padStart(w, '0');
  return `${p(d.getUTCFullYear(), 4)}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}.${p(d.getUTCMilliseconds(), 3)}`;
}

/** Reads what GRDB can read: "yyyy-MM-dd[ T]HH:mm[:ss[.SSS]]" (+ optional Z / offset), a bare date, or unix seconds. */
export function fromDbDate(v: unknown): number {
  if (typeof v === 'number') return Math.round(v * 1000);
  if (typeof v === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/.exec(v.trim());
    if (m) {
      const ms = m[7] ? parseInt((m[7] + '00').slice(0, 3), 10) : 0;
      let t = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0), ms);
      const z = m[8];
      if (z && z !== 'Z') t -= (z[0] === '-' ? -1 : 1) * (+z.slice(1, 3) * 60 + +z.slice(-2)) * 60_000;
      return t;
    }
  }
  throw new Error(`Unreadable date in database: ${String(v)}`);
}
export const dateOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : fromDbDate(v));
export const dbDateOrNull = (ms: number | null | undefined): string | null => (ms === null || ms === undefined ? null : toDbDate(ms));

// ---- schema (copied from a database made by the Swift build; GRDB migrations "v1" and "v2-person-notes", then our "v3-person-dates" and "v4-external-ids") ----

const V1 = `
CREATE TABLE "people" ("id" TEXT PRIMARY KEY NOT NULL, "handle" TEXT NOT NULL UNIQUE, "name" TEXT NOT NULL, "relation" TEXT NOT NULL DEFAULT 'other', "cadence_days" INTEGER, "match_emails" TEXT NOT NULL DEFAULT '', "hidden_from_claude" BOOLEAN NOT NULL DEFAULT 0, "archived" BOOLEAN NOT NULL DEFAULT 0);
CREATE TABLE "items" ("id" TEXT PRIMARY KEY NOT NULL, "kind" TEXT NOT NULL, "title" TEXT NOT NULL, "body" TEXT, "quote" TEXT, "person_id" TEXT REFERENCES "people"("id") ON DELETE SET NULL, "status" TEXT NOT NULL DEFAULT 'open', "due_at" DATETIME, "due_has_time" BOOLEAN NOT NULL DEFAULT 0, "remind_at" DATETIME, "snoozed_until" DATETIME, "snooze_count" INTEGER NOT NULL DEFAULT 0, "recur_rule" TEXT, "pinned" BOOLEAN NOT NULL DEFAULT 0, "inbox" BOOLEAN NOT NULL DEFAULT 0, "source" TEXT NOT NULL DEFAULT 'hotkey', "created_at" DATETIME NOT NULL, "updated_at" DATETIME NOT NULL, "completed_at" DATETIME, "last_touched_at" DATETIME NOT NULL);
CREATE INDEX "items_person" ON "items"("person_id");
CREATE INDEX "items_status_due" ON "items"("status", "due_at");
CREATE TABLE "interactions" ("id" TEXT PRIMARY KEY NOT NULL, "person_id" TEXT NOT NULL REFERENCES "people"("id") ON DELETE CASCADE, "occurred_at" DATETIME NOT NULL, "kind" TEXT NOT NULL, "calendar_event_id" TEXT, "notes" TEXT);
CREATE TABLE "item_tags" ("item_id" TEXT NOT NULL REFERENCES "items"("id") ON DELETE CASCADE, "tag" TEXT NOT NULL, PRIMARY KEY ("item_id", "tag"));
CREATE TABLE "item_events" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "item_id" TEXT NOT NULL REFERENCES "items"("id") ON DELETE CASCADE, "at" DATETIME NOT NULL, "event" TEXT NOT NULL, "detail" TEXT);
CREATE TABLE "settings" ("key" TEXT PRIMARY KEY NOT NULL, "value" TEXT NOT NULL);
CREATE TABLE "mcp_audit" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "at" DATETIME NOT NULL, "tool" TEXT NOT NULL, "summary" TEXT NOT NULL, "wrote" BOOLEAN NOT NULL DEFAULT 0);
CREATE VIRTUAL TABLE "items_fts" USING fts5(title, body, quote, tokenize='''unicode61''', content='items');
CREATE TRIGGER "__items_fts_ai" AFTER INSERT ON "items" BEGIN
    INSERT INTO "items_fts"("rowid", "title", "body", "quote") VALUES (new."rowid", new."title", new."body", new."quote");
END;
CREATE TRIGGER "__items_fts_ad" AFTER DELETE ON "items" BEGIN
    INSERT INTO "items_fts"("items_fts", "rowid", "title", "body", "quote") VALUES('delete', old."rowid", old."title", old."body", old."quote");
END;
CREATE TRIGGER "__items_fts_au" AFTER UPDATE ON "items" BEGIN
    INSERT INTO "items_fts"("items_fts", "rowid", "title", "body", "quote") VALUES('delete', old."rowid", old."title", old."body", old."quote");
    INSERT INTO "items_fts"("rowid", "title", "body", "quote") VALUES (new."rowid", new."title", new."body", new."quote");
END;
`;
const V2 = `ALTER TABLE "people" ADD COLUMN "notes" TEXT NOT NULL DEFAULT ''`;
// 0.2.0 (not a GRDB migration: the Swift build predates it). Both columns are private and never exposed over MCP.
const V3 = `ALTER TABLE "people" ADD COLUMN "start_date" TEXT;
ALTER TABLE "people" ADD COLUMN "birthday" TEXT;`;

// 0.3.0: where an item came from (dedup key + chip + link) and the 1:1 it was recorded in. external_id is unique when set.
const V4 = `ALTER TABLE "items" ADD COLUMN "external_id" TEXT;
ALTER TABLE "items" ADD COLUMN "source_label" TEXT;
ALTER TABLE "items" ADD COLUMN "source_url" TEXT;
ALTER TABLE "items" ADD COLUMN "interaction_id" TEXT;
CREATE UNIQUE INDEX "items_external_id" ON "items"("external_id") WHERE "external_id" IS NOT NULL;`;

/** In GRDB's order. Exported so tests can build a v1 database. */
export const MIGRATIONS: ReadonlyArray<{ id: string; sql: string }> = [
  { id: 'v1', sql: V1 },
  { id: 'v2-person-notes', sql: V2 },
  { id: 'v3-person-dates', sql: V3 },
  { id: 'v4-external-ids', sql: V4 },
];

/** Runs `fn` in a write transaction (BEGIN IMMEDIATE, like GRDB); joins an open one. */
export function write<T>(db: DatabaseSync, fn: () => T): T {
  if (db.isTransaction) return fn();
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw e;
  }
}

/** Applies the GRDB migrations that are missing, recording them in `grdb_migrations`. */
export function migrate(db: DatabaseSync): void {
  const hasTable = (): boolean => db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='grdb_migrations'").get() !== undefined;
  if (!hasTable()) {
    try { db.exec('CREATE TABLE grdb_migrations (identifier TEXT NOT NULL PRIMARY KEY)'); } catch (e) { if (!hasTable()) throw e; }
  }
  const applied = (): Set<string> => new Set((db.prepare('SELECT identifier FROM grdb_migrations').all() as Row[]).map((r) => String(r.identifier)));
  if (MIGRATIONS.every((m) => applied().has(m.id))) return;
  write(db, () => {
    const done = applied(); // re-read under the write lock: the app and the MCP process may start at the same time
    for (const m of MIGRATIONS) {
      if (done.has(m.id)) continue;
      db.exec(m.sql);
      db.prepare('INSERT INTO grdb_migrations(identifier) VALUES(?)').run(m.id);
    }
  });
}

function configure(db: DatabaseSync, wal: boolean): void {
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA foreign_keys = ON');
  if (wal) db.exec('PRAGMA journal_mode = WAL');
}

/** Opens (creating directories and the schema when needed) the shared SQLite file. WAL so the app and MCP server can co-write. */
export function openDatabase(path: string): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  configure(db, true);
  migrate(db);
  return db;
}

/** In-memory database for tests. */
export function openMemoryDatabase(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  configure(db, false);
  migrate(db);
  return db;
}

/** Helpers that keep call sites short and bind `undefined` as NULL. */
export function all(db: DatabaseSync, sql: string, ...params: Array<SQLInputValue | undefined>): Row[] {
  return db.prepare(sql).all(...params.map((p) => p ?? null)) as Row[];
}
export function get(db: DatabaseSync, sql: string, ...params: Array<SQLInputValue | undefined>): Row | undefined {
  return db.prepare(sql).get(...params.map((p) => p ?? null)) as Row | undefined;
}
export function run(db: DatabaseSync, sql: string, ...params: Array<SQLInputValue | undefined>): { changes: number | bigint; lastInsertRowid: number | bigint } {
  return db.prepare(sql).run(...params.map((p) => p ?? null));
}
