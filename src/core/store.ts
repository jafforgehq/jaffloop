// All reads and writes go through here, for both the app and the MCP server. Synchronous (node:sqlite).
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type {
  ActivityEntry, ActivityEvent, AuditEntry, CaptureTemplate, HeatRow, Interaction, InteractionKind, Item, ItemFilter, ItemKind, ItemSource,
  ItemStatus, KeptRate, ParsedCapture, Person, PersonSummary, Relation, ReviewData, Settings, Snapshot, TodaySections, UpcomingDate, WeekSummary,
} from '../shared/types';
import { DAY_MS, addDays, dayDiff, startOfDay, startOfWeek } from './calendar';
import { all, dateOrNull, dbDateOrNull, get, run, toDbDate, write, type Row } from './db';
import { expandTemplate } from './features';
import { CadenceStrip } from './helpers';
import { nameFromHandle, newInteraction, newItem, newPerson } from './models';
import { parseCapture } from './parser';
import { nextFutureOccurrence } from './recurrence';
import { cadenceOverdue, daysSince, isOverdue, isSlipping, isStaleWait } from './rules';
import { DEFAULT_SETTINGS, hm, hotkeyToAccelerator } from './settings';

export interface StoreOptions {
  /** Accepted for API parity with the Swift Store; ignored (the local time zone is always used). */
  calendar?: unknown;
}

const str = (v: unknown): string => String(v);
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const bool = (v: unknown): boolean => Number(v) !== 0;
const int = (v: unknown): number => Number(v);
const intOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

function itemFromRow(r: Row): Item {
  return {
    id: str(r.id), kind: str(r.kind) as ItemKind, title: str(r.title), body: strOrNull(r.body), quote: strOrNull(r.quote),
    personId: strOrNull(r.person_id), status: str(r.status) as ItemStatus, dueAt: dateOrNull(r.due_at), dueHasTime: bool(r.due_has_time),
    remindAt: dateOrNull(r.remind_at), snoozedUntil: dateOrNull(r.snoozed_until), snoozeCount: int(r.snooze_count),
    recurRule: strOrNull(r.recur_rule), pinned: bool(r.pinned), inbox: bool(r.inbox), source: str(r.source) as ItemSource,
    createdAt: dateOrNull(r.created_at)!, updatedAt: dateOrNull(r.updated_at)!, completedAt: dateOrNull(r.completed_at),
    lastTouchedAt: dateOrNull(r.last_touched_at)!,
  };
}

function personFromRow(r: Row): Person {
  return {
    id: str(r.id), handle: str(r.handle), name: str(r.name), relation: str(r.relation) as Relation, cadenceDays: intOrNull(r.cadence_days),
    matchEmails: str(r.match_emails), hiddenFromClaude: bool(r.hidden_from_claude), archived: bool(r.archived), notes: str(r.notes ?? ''),
    startDate: strOrNull(r.start_date), birthday: strOrNull(r.birthday),
  };
}

function interactionFromRow(r: Row): Interaction {
  return {
    id: str(r.id), personId: str(r.person_id), occurredAt: dateOrNull(r.occurred_at)!, kind: str(r.kind) as InteractionKind,
    calendarEventId: strOrNull(r.calendar_event_id), notes: strOrNull(r.notes),
  };
}

const auditFromRow = (r: Row): AuditEntry => ({ id: int(r.id), at: dateOrNull(r.at)!, tool: str(r.tool), summary: str(r.summary), wrote: bool(r.wrote) });

const ITEM_COLS = ['id', 'kind', 'title', 'body', 'quote', 'person_id', 'status', 'due_at', 'due_has_time', 'remind_at', 'snoozed_until',
  'snooze_count', 'recur_rule', 'pinned', 'inbox', 'source', 'created_at', 'updated_at', 'completed_at', 'last_touched_at'];

function itemParams(i: Item): SQLInputValue[] {
  return [i.id, i.kind, i.title, i.body, i.quote, i.personId, i.status, dbDateOrNull(i.dueAt), i.dueHasTime ? 1 : 0, dbDateOrNull(i.remindAt),
    dbDateOrNull(i.snoozedUntil), i.snoozeCount, i.recurRule, i.pinned ? 1 : 0, i.inbox ? 1 : 0, i.source, toDbDate(i.createdAt),
    toDbDate(i.updatedAt), dbDateOrNull(i.completedAt), toDbDate(i.lastTouchedAt)];
}

const PERSON_COLS = ['id', 'handle', 'name', 'relation', 'cadence_days', 'match_emails', 'hidden_from_claude', 'archived', 'notes', 'start_date', 'birthday'];
function personParams(p: Person): SQLInputValue[] {
  return [p.id, p.handle, p.name, p.relation, p.cadenceDays, p.matchEmails, p.hiddenFromClaude ? 1 : 0, p.archived ? 1 : 0, p.notes, p.startDate, p.birthday];
}

/** Reads the JSON stored under `captureTemplates`; anything malformed becomes [] (or drops the bad entries). */
function parseTemplates(raw: string | undefined): CaptureTemplate[] {
  try {
    const v: unknown = JSON.parse(raw ?? '[]');
    if (!Array.isArray(v)) return [];
    return v.flatMap((t: unknown) => {
      const o = t as { name?: unknown; lines?: unknown };
      if (typeof o?.name !== 'string' || !Array.isArray(o.lines)) return [];
      return [{ name: o.name, lines: o.lines.filter((l): l is string => typeof l === 'string') }];
    });
  } catch { return []; }
}

const placeholders = (n: number): string => Array(n).fill('?').join(',');
const iso = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** "yyyy-MM-dd" as local midnight; null when it is not a real date. */
function parseDay(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(+m[1]!, +m[2]! - 1, +m[3]!);
  return d.getFullYear() === +m[1]! && d.getMonth() === +m[2]! - 1 && d.getDate() === +m[3]! ? d.getTime() : null;
}

export type ItemChange = Partial<Omit<Item, 'id'>> | ((item: Item) => void);

export class Store {
  constructor(readonly db: DatabaseSync, _opts: StoreOptions = {}) {}

  // ---- settings ----

  settings(): Settings {
    try {
      const d = new Map(all(this.db, 'SELECT key, value FROM settings').map((r) => [str(r.key), str(r.value)]));
      const s = DEFAULT_SETTINGS;
      const n = (k: string, dflt: number): number => (/^[+-]?\d+$/.test(d.get(k) ?? '') ? parseInt(d.get(k)!, 10) : dflt);
      return {
        eodTime: d.get('eodTime') ?? s.eodTime, workStart: d.get('workStart') ?? s.workStart, workEnd: d.get('workEnd') ?? s.workEnd,
        morningBrief: d.get('morningBrief') ?? s.morningBrief, staleDaysAfterDue: n('staleDaysAfterDue', s.staleDaysAfterDue),
        staleDaysNoDue: n('staleDaysNoDue', s.staleDaysNoDue), mcpReadOnly: d.get('mcpReadOnly') === '1', compact: d.get('compact') === '1',
        sound: d.get('sound') === '1', haptics: d.has('haptics') ? d.get('haptics') === '1' : true,
        hotkey: hotkeyToAccelerator(d.get('hotkey') ?? s.hotkey),
        jiraBaseUrl: d.get('jiraBaseUrl') ?? s.jiraBaseUrl, captureTemplates: parseTemplates(d.get('captureTemplates')),
      };
    } catch {
      return { ...DEFAULT_SETTINGS, captureTemplates: [] };
    }
  }

  saveSettings(s: Settings): void {
    const pairs: Array<[string, string]> = [
      ['eodTime', s.eodTime], ['workStart', s.workStart], ['workEnd', s.workEnd], ['morningBrief', s.morningBrief],
      ['staleDaysAfterDue', String(s.staleDaysAfterDue)], ['staleDaysNoDue', String(s.staleDaysNoDue)],
      ['mcpReadOnly', s.mcpReadOnly ? '1' : '0'], ['compact', s.compact ? '1' : '0'], ['sound', s.sound ? '1' : '0'],
      ['haptics', s.haptics ? '1' : '0'], ['hotkey', s.hotkey],
      ['jiraBaseUrl', s.jiraBaseUrl ?? ''], ['captureTemplates', JSON.stringify(s.captureTemplates ?? [])],
    ];
    write(this.db, () => {
      for (const [k, v] of pairs) run(this.db, 'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, v);
    });
  }

  // ---- people ----

  /** Looks a person up by handle (case-insensitive); creates them with a name made from the handle unless `create` is false. */
  person(handle: string, create = true): Person | null {
    const h = handle.toLowerCase();
    const find = (): Person | null => { const r = get(this.db, 'SELECT * FROM people WHERE handle = ?', h); return r ? personFromRow(r) : null; };
    const found = find();
    if (found || !create) return found;
    return write(this.db, () => {
      const again = find();
      if (again) return again;
      const p = newPerson({ handle: h, name: nameFromHandle(h) });
      this.insertPerson(p);
      return p;
    });
  }

  personById(id: string): Person | null {
    const r = get(this.db, 'SELECT * FROM people WHERE id = ?', id);
    return r ? personFromRow(r) : null;
  }

  private insertPerson(p: Person): void {
    run(this.db, `INSERT INTO people(${PERSON_COLS.join(',')}) VALUES(${placeholders(PERSON_COLS.length)})`, ...personParams(p));
  }

  people(includeArchived = false): Person[] {
    const where = includeArchived ? '' : 'WHERE archived = 0';
    return all(this.db, `SELECT * FROM people ${where} ORDER BY name COLLATE NOCASE`).map(personFromRow);
  }

  /** Insert or update by id. */
  savePerson(p: Person): void {
    const sets = PERSON_COLS.slice(1).map((c) => `${c}=excluded.${c}`).join(',');
    write(this.db, () => run(this.db, `INSERT INTO people(${PERSON_COLS.join(',')}) VALUES(${placeholders(PERSON_COLS.length)}) ON CONFLICT(id) DO UPDATE SET ${sets}`, ...personParams(p)));
  }

  personSummaries(now: number = Date.now(), includeArchived = false): PersonSummary[] {
    const where = includeArchived ? '' : 'WHERE p.archived = 0';
    const rows = all(this.db, `SELECT p.*,
        (SELECT MAX(occurred_at) FROM interactions WHERE person_id = p.id) AS last_at,
        (SELECT COUNT(*) FROM items WHERE person_id = p.id AND kind = 'owe' AND status = 'open') AS open_owe,
        (SELECT COUNT(*) FROM items WHERE person_id = p.id AND kind = 'wait' AND status = 'open') AS open_wait
      FROM people p ${where} ORDER BY p.name COLLATE NOCASE`);
    return rows.map((r) => {
      const person = personFromRow(r);
      const last = dateOrNull(r.last_at);
      return {
        person, lastInteraction: last, openOwe: int(r.open_owe), openWait: int(r.open_wait),
        daysSinceLast: daysSince(last, now), cadenceOverdue: cadenceOverdue(person.cadenceDays, last, now),
      };
    });
  }

  hiddenPersonIds(): Set<string> {
    try { return new Set(all(this.db, 'SELECT id FROM people WHERE hidden_from_claude = 1').map((r) => str(r.id))); } catch { return new Set(); }
  }

  // ---- items ----

  create(p: ParsedCapture, source: ItemSource = 'hotkey', now: number = Date.now()): Item {
    const person = p.personHandle !== null ? this.person(p.personHandle) : null;
    const item = newItem({
      kind: p.kind, title: p.title === '' ? 'Untitled' : p.title, quote: p.quote, personId: person?.id ?? null, dueAt: p.dueAt,
      dueHasTime: p.dueHasTime, remindAt: p.remindAt, recurRule: p.recurRule, pinned: p.pinned, inbox: p.inbox, source, now,
    });
    if (item.kind === 'said' || item.kind === 'note') item.inbox = false;
    write(this.db, () => {
      this.insertItem(item);
      for (const t of p.tags) this.addTag(item.id, t);
      this.event(item.id, now, 'created', source);
    });
    return item;
  }

  /** Parse one line and save it. Used by the app, the MCP `capture` tool and tests. */
  capture(line: string, source: ItemSource = 'hotkey', now: number = Date.now()): Item {
    return this.create(parseCapture(line, { now, eod: hm(this.settings().eodTime) }), source, now);
  }

  insert(item: Item, tags: string[] = []): void {
    write(this.db, () => {
      this.insertItem(item);
      for (const t of tags) this.addTag(item.id, t.toLowerCase());
      this.event(item.id, item.createdAt, 'created', item.source);
    });
  }

  private insertItem(i: Item): void {
    run(this.db, `INSERT INTO items(${ITEM_COLS.join(',')}) VALUES(${placeholders(ITEM_COLS.length)})`, ...itemParams(i));
  }
  private updateItem(i: Item): void {
    const r = run(this.db, `UPDATE items SET ${ITEM_COLS.slice(1).map((c) => `${c}=?`).join(',')} WHERE id=?`, ...itemParams(i).slice(1), i.id);
    if (Number(r.changes) === 0) throw new Error(`No item with id ${i.id}`);
  }
  private addTag(itemId: string, tag: string): void {
    run(this.db, 'INSERT OR IGNORE INTO item_tags(item_id, tag) VALUES(?,?)', itemId, tag);
  }
  private event(itemId: string, at: number, event: string, detail: string | null): void {
    run(this.db, 'INSERT INTO item_events(item_id, at, event, detail) VALUES(?,?,?,?)', itemId, toDbDate(at), event, detail);
  }
  private fetchItem(id: string): Item | null {
    const r = get(this.db, 'SELECT * FROM items WHERE id = ?', id);
    return r ? itemFromRow(r) : null;
  }

  item(id: string): Item | null { return this.fetchItem(id); }

  tags(of: string): string[] {
    return all(this.db, 'SELECT tag FROM item_tags WHERE item_id = ? ORDER BY tag', of).map((r) => str(r.tag));
  }

  /** Tags of open items with their counts. */
  allTags(): Array<[string, number]> {
    return all(this.db, "SELECT tag, COUNT(*) c FROM item_tags JOIN items ON items.id = item_id WHERE status = 'open' GROUP BY tag ORDER BY tag")
      .map((r) => [str(r.tag), int(r.c)]);
  }

  items(f: ItemFilter = {}, now: number = Date.now()): Item[] {
    const where: string[] = [];
    const params: SQLInputValue[] = [];
    if (f.kinds) { where.push(`kind IN (${placeholders(f.kinds.length)})`); params.push(...f.kinds); }
    if (f.personId !== undefined) { where.push('person_id = ?'); params.push(f.personId); }
    const status = f.status === undefined ? 'open' : f.status;
    if (status !== null) { where.push('status = ?'); params.push(status); }
    if (f.dueBefore !== undefined) { where.push('due_at IS NOT NULL AND due_at < ?'); params.push(toDbDate(f.dueBefore)); }
    if (f.inboxOnly) where.push('inbox = 1');
    if (f.tag !== undefined) { where.push('id IN (SELECT item_id FROM item_tags WHERE tag = ?)'); params.push(f.tag); }
    if (!f.includeSnoozed) { where.push('(snoozed_until IS NULL OR snoozed_until <= ?)'); params.push(toDbDate(now)); }
    const sql = `SELECT * FROM items ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY pinned DESC, due_at IS NULL, due_at ASC, created_at DESC`;
    let out = all(this.db, sql, ...params).map(itemFromRow);
    if (f.overdueOnly) out = out.filter((i) => isOverdue(i, now));
    if (f.staleDays !== undefined) {
      const cutoff = addDays(now, -f.staleDays);
      out = out.filter((i) => i.lastTouchedAt < cutoff);
    }
    if (f.limit !== undefined) out = out.slice(0, Math.max(0, f.limit));
    return out;
  }

  /**
   * Edits an item (a patch object or a mutating function), bumps updatedAt and lastTouchedAt, and clears `inbox`
   * when the item has a due date or a person. Does nothing when the id is unknown.
   */
  update(id: string, change: ItemChange, now: number = Date.now()): void {
    write(this.db, () => {
      const i = this.fetchItem(id);
      if (!i) return;
      if (typeof change === 'function') change(i); else Object.assign(i, change);
      i.id = id;
      i.updatedAt = now; i.lastTouchedAt = now;
      if (i.dueAt !== null || i.personId !== null) i.inbox = false;
      this.updateItem(i);
    });
  }

  /** Completes an item. A recurring item spawns its next occurrence, which is returned. */
  complete(id: string, now: number = Date.now()): Item | null {
    return write(this.db, () => {
      const i = this.fetchItem(id);
      if (!i || i.status !== 'open') return null;
      i.status = 'done'; i.completedAt = now; i.updatedAt = now; i.lastTouchedAt = now;
      this.updateItem(i);
      this.event(id, now, 'completed', null);
      const rule = i.recurRule;
      if (!rule) return null;
      const nextDue = nextFutureOccurrence(i.dueAt ?? now, rule, now);
      if (nextDue === null) return null;
      const n = newItem({
        kind: i.kind, title: i.title, body: i.body, quote: null, personId: i.personId, dueAt: nextDue, dueHasTime: i.dueHasTime,
        recurRule: rule, pinned: i.pinned, inbox: false, source: i.source, now,
      });
      if (i.remindAt !== null && i.dueAt !== null) n.remindAt = nextDue + (i.remindAt - i.dueAt);
      this.insertItem(n);
      run(this.db, 'INSERT INTO item_tags(item_id, tag) SELECT ?, tag FROM item_tags WHERE item_id = ?', n.id, id);
      this.event(n.id, now, 'created', 'recurrence');
      return n;
    });
  }

  drop(id: string, now: number = Date.now()): void {
    write(this.db, () => {
      const i = this.fetchItem(id);
      if (!i) return;
      i.status = 'dropped'; i.updatedAt = now; i.lastTouchedAt = now; i.inbox = false;
      this.updateItem(i);
      this.event(id, now, 'dropped', null);
    });
  }

  /** Finished or dropped items, newest first. */
  history(since: number | null = null, limit = 500): Item[] {
    const where = since === null ? '' : 'AND updated_at >= ?';
    return all(this.db, `SELECT * FROM items WHERE status != 'open' ${where} ORDER BY updated_at DESC LIMIT ?`,
      ...(since === null ? [] : [toDbDate(since)]), limit).map(itemFromRow);
  }

  /** Open items hidden until a later time, soonest wake-up first. */
  snoozed(now: number = Date.now()): Item[] {
    return all(this.db, "SELECT * FROM items WHERE status = 'open' AND snoozed_until IS NOT NULL AND snoozed_until > ? ORDER BY snoozed_until ASC",
      toDbDate(now)).map(itemFromRow);
  }

  /** Writes an earlier copy of an item back unchanged (undo). Keeps its original timestamps. */
  restore(item: Item): void {
    write(this.db, () => this.updateItem(item));
  }

  reopen(id: string, now: number = Date.now()): void {
    this.update(id, (i) => { i.status = 'open'; i.completedAt = null; }, now);
  }

  snooze(id: string, until: number, now: number = Date.now()): void {
    write(this.db, () => {
      const i = this.fetchItem(id);
      if (!i) return;
      i.snoozedUntil = until; i.snoozeCount += 1; i.updatedAt = now; i.lastTouchedAt = now;
      this.updateItem(i);
      this.event(id, now, 'snoozed', iso(until));
    });
  }

  assign(id: string, personHandle: string | null, due: number | null, hasTime = false, now: number = Date.now()): void {
    const pid = personHandle !== null ? this.person(personHandle)?.id ?? null : null;
    this.update(id, (i) => {
      if (pid !== null) i.personId = pid;
      if (due !== null) { i.dueAt = due; i.dueHasTime = hasTime; }
    }, now);
  }

  setTags(id: string, tags: string[]): void {
    write(this.db, () => {
      run(this.db, 'DELETE FROM item_tags WHERE item_id = ?', id);
      for (const t of tags) this.addTag(id, t.toLowerCase());
    });
  }

  // ---- interactions ----

  logInteraction(personId: string, kind: InteractionKind = '1on1', notes: string | null = null, at: number = Date.now(), eventId: string | null = null): Interaction {
    const x = newInteraction({ personId, occurredAt: at, kind, calendarEventId: eventId, notes });
    write(this.db, () => run(this.db, 'INSERT INTO interactions(id, person_id, occurred_at, kind, calendar_event_id, notes) VALUES(?,?,?,?,?,?)',
      x.id, x.personId, toDbDate(x.occurredAt), x.kind, x.calendarEventId, x.notes));
    return x;
  }

  interactions(personId: string, limit = 10): Interaction[] {
    return all(this.db, 'SELECT * FROM interactions WHERE person_id = ? ORDER BY occurred_at DESC LIMIT ?', personId, limit).map(interactionFromRow);
  }

  // ---- search ----

  /** FTS5 search. Filters: `@person`, `kind:owe`, `before:2026-11-01`, `status:done`. Words match as prefixes. */
  search(query: string, limit = 50, _now: number = Date.now()): Item[] {
    const words: string[] = [];
    let kinds: ItemKind[] | undefined;
    let personId: string | undefined;
    let status: ItemStatus | null = null;
    let dueBefore: number | undefined;
    for (const tok of query.split(' ').filter((t) => t !== '')) {
      const low = tok.toLowerCase();
      if (tok.startsWith('@') && [...tok].length > 1) {
        const p = this.person(tok.slice(1), false);
        if (!p) return [];
        personId = p.id;
      } else if (low.startsWith('kind:') && ['owe', 'wait', 'bring', 'task', 'said', 'note'].includes(low.slice(5))) kinds = [low.slice(5) as ItemKind];
      else if (low.startsWith('status:') && ['open', 'done', 'dropped'].includes(low.slice(7))) status = low.slice(7) as ItemStatus;
      else if (low.startsWith('before:')) dueBefore = parseDay(tok.slice(7)) ?? undefined;
      else words.push(tok);
    }
    const fts = words.map((w) => w.replaceAll('"', '')).filter((w) => w !== '').map((w) => `"${w}"*`).join(' ');
    const where: string[] = [];
    const params: SQLInputValue[] = [];
    if (fts !== '') { where.push('rowid IN (SELECT rowid FROM items_fts WHERE items_fts MATCH ?)'); params.push(fts); }
    if (kinds) { where.push(`kind IN (${placeholders(kinds.length)})`); params.push(...kinds); }
    if (personId !== undefined) { where.push('person_id = ?'); params.push(personId); }
    if (status !== null) { where.push('status = ?'); params.push(status); }
    if (dueBefore !== undefined) { where.push('due_at IS NOT NULL AND due_at < ?'); params.push(toDbDate(dueBefore)); }
    return all(this.db, `SELECT * FROM items ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY updated_at DESC LIMIT ?`, ...params, limit).map(itemFromRow);
  }

  // ---- today ----

  today(now: number = Date.now()): TodaySections {
    const s = this.settings();
    const t: TodaySections = { slipping: [], overdue: [], today: [], waitingStale: [], inbox: [], checkIn: [] };
    const endOfToday = addDays(startOfDay(now), 1);
    for (const i of this.items({}, now)) {
      if (isSlipping(i)) { t.slipping.push(i); continue; }
      if (isOverdue(i, now)) { t.overdue.push(i); continue; }
      if (i.kind === 'wait' && isStaleWait(i, now, s)) { t.waitingStale.push(i); continue; }
      if (i.inbox) { t.inbox.push(i); continue; }
      if (i.dueAt !== null && i.dueAt < endOfToday && (i.kind === 'owe' || i.kind === 'task' || i.kind === 'wait')) { t.today.push(i); continue; }
      if (i.pinned) t.today.push(i);
    }
    t.checkIn = this.personSummaries(now).filter((x) => x.cadenceOverdue);
    return t;
  }

  overdueCount(now: number = Date.now()): number {
    try { return this.items({}, now).filter((i) => isOverdue(i, now) || isSlipping(i)).length; } catch { return 0; }
  }

  // ---- week summary ----

  weekSummary(from: number, to: number, now: number = Date.now()): WeekSummary {
    const s = this.settings();
    const f = toDbDate(from), t = toDbDate(to);
    const created = all(this.db, 'SELECT * FROM items WHERE created_at >= ? AND created_at < ? ORDER BY rowid', f, t).map(itemFromRow);
    const completed = all(this.db, 'SELECT * FROM items WHERE completed_at >= ? AND completed_at < ? ORDER BY rowid', f, t).map(itemFromRow);
    const ids = all(this.db, "SELECT item_id FROM item_events WHERE event = 'snoozed' AND at >= ? AND at < ? GROUP BY item_id", f, t).map((r) => str(r.item_id));
    const slipped = ids.length === 0 ? [] : all(this.db, `SELECT * FROM items WHERE id IN (${placeholders(ids.length)}) ORDER BY rowid`, ...ids)
      .map(itemFromRow).filter((i) => i.snoozeCount >= 3 && i.status === 'open');
    const stale = all(this.db, "SELECT * FROM items WHERE kind = 'wait' AND status = 'open' ORDER BY rowid").map(itemFromRow).filter((i) => isStaleWait(i, now, s));
    return { created, completed, slipped, stale };
  }

  // ---- 0.2.0: review, kept promises, activity, heat grid, streak, dates ----

  /** Completed promises (owe) with `completedAt` in [from, to), split into on time and late. */
  private kept(from: number, to: number, periodDays: number): KeptRate {
    const rows = all(this.db, "SELECT due_at, due_has_time, completed_at FROM items WHERE kind = 'owe' AND status = 'done' AND completed_at >= ? AND completed_at < ?",
      toDbDate(from), toDbDate(to));
    let onTime = 0;
    for (const r of rows) {
      const due = dateOrNull(r.due_at), done = dateOrNull(r.completed_at)!;
      // a date-only due date is good until the end of that day
      if (due === null || done < (bool(r.due_has_time) ? due + 1 : addDays(startOfDay(due), 1))) onTime++;
    }
    const total = rows.length;
    return { periodDays, onTime, late: total - onTime, total, rate: total === 0 ? null : onTime / total };
  }

  /** Promises (owe) completed in the last `periodDays` days: how many were on time. */
  keptRate(periodDays: number, now: number = Date.now()): KeptRate {
    return this.kept(addDays(now, -periodDays), now + 1, periodDays);
  }

  /** What the weekly review screen shows for [from, to). Open-item lists are as of `to` (default now). */
  review(from: number, to?: number, now: number = Date.now()): ReviewData {
    const end = to ?? now;
    const s = this.settings();
    const f = toDbDate(from), t = toDbDate(end);
    const open = this.items({ includeSnoozed: true }, end);
    const inWindow = (where: string): Item[] => all(this.db, `SELECT * FROM items WHERE ${where} ORDER BY rowid`, f, t).map(itemFromRow);
    const overBy = (x: PersonSummary): number => (x.daysSinceLast ?? 0) - (x.person.cadenceDays ?? 0);
    return {
      from, to: end,
      slipped: open.filter(isSlipping),
      staleWaits: open.filter((i) => isStaleWait(i, end, s)),
      overduePromises: open.filter((i) => i.kind === 'owe' && isOverdue(i, end)),
      offCadence: this.personSummaries(end).filter((x) => x.cadenceOverdue).sort((a, b) => overBy(b) - overBy(a)),
      closed: all(this.db, 'SELECT * FROM items WHERE completed_at >= ? AND completed_at < ? ORDER BY completed_at, rowid', f, t).map(itemFromRow),
      dropped: inWindow("status = 'dropped' AND updated_at >= ? AND updated_at < ?"),
      created: inWindow('created_at >= ? AND created_at < ?'),
      keptRate: this.kept(from, end, Math.max(1, Math.round((end - from) / DAY_MS))),
    };
  }

  /** Item events since `from`, newest first, one entry per event, with the item as it is now. */
  activity(from: number, limit = 100, now: number = Date.now()): ActivityEntry[] {
    const known = new Set<string>(['created', 'completed', 'dropped', 'snoozed', 'reopened']);
    return all(this.db, `SELECT e.at AS event_at, e.event AS event_name, i.* FROM item_events e JOIN items i ON i.id = e.item_id
      WHERE e.at >= ? AND e.at <= ? ORDER BY e.at DESC, e.id DESC LIMIT ?`, toDbDate(from), toDbDate(now), limit)
      .map((r) => ({ at: dateOrNull(r.event_at)!, event: (known.has(str(r.event_name)) ? str(r.event_name) : 'edited') as ActivityEvent, item: itemFromRow(r) }));
  }

  /** One row per active person (by name): was there an interaction in each of the last `weeks` weeks (oldest first)? */
  heatGrid(weeks = 12, now: number = Date.now()): HeatRow[] {
    const since = addDays(startOfWeek(now), -7 * (weeks - 1));
    const dates = new Map<string, number[]>();
    for (const r of all(this.db, 'SELECT person_id, occurred_at FROM interactions WHERE occurred_at >= ?', toDbDate(since))) {
      const k = str(r.person_id);
      (dates.get(k) ?? dates.set(k, []).get(k)!).push(dateOrNull(r.occurred_at)!);
    }
    return this.people().map((p) => ({ personId: p.id, weeks: CadenceStrip.weeks(dates.get(p.id) ?? [], now, weeks) }));
  }

  /**
   * Weeks in a row (counting back from this one) in which the 1:1 cadence held: the gap since the previous interaction never
   * exceeded `cadenceDays` during the week. A week before the first interaction fails. The current week adds one only when
   * there was a 1:1 in it; while it is merely not over yet it adds nothing and does not break the run; once overdue it breaks it.
   * 0 without a cadence.
   */
  onTimeStreak(personId: string, now: number = Date.now()): number {
    const cadence = this.personById(personId)?.cadenceDays ?? null;
    if (cadence === null) return 0;
    const dates = all(this.db, 'SELECT occurred_at FROM interactions WHERE person_id = ? ORDER BY occurred_at', personId)
      .map((r) => dateOrNull(r.occurred_at)!).filter((d) => d <= now);
    if (dates.length === 0) return 0;
    const held = (weekStart: number): { ok: boolean; met: boolean } => {
      const end = addDays(weekStart, 7);
      let prev: number | undefined = [...dates].reverse().find((d) => d < weekStart);
      const inWeek = dates.filter((d) => d >= weekStart && d < end);
      for (const m of inWeek) {
        if (prev !== undefined && dayDiff(prev, m) > cadence) return { ok: false, met: true };
        prev = m;
      }
      if (prev === undefined) return { ok: false, met: false };
      return { ok: dayDiff(prev, Math.min(end - 1, now)) <= cadence, met: inWeek.length > 0 };
    };
    let week = startOfWeek(now);
    let n = 0;
    const cur = held(week);
    if (!cur.ok) return 0;
    if (cur.met) n++;
    // weeks before the first interaction fail, so this ends
    for (week = addDays(week, -7); held(week).ok; week = addDays(week, -7)) n++;
    return n;
  }

  /** Work anniversaries (at least one year) and birthdays of active people within `withinDays`, soonest first. */
  upcomingDates(withinDays = 14, now: number = Date.now()): UpcomingDate[] {
    const today = startOfDay(now);
    const year = new Date(today).getFullYear();
    // the next day on or after today with this month and day; Feb 29 is Feb 28 in years without one
    const next = (month: number, dayOfMonth: number): { on: number; year: number } | null => {
      if (new Date(2000, month - 1, dayOfMonth).getMonth() !== month - 1) return null; // not a real calendar day (2000 is a leap year)
      for (let y = year; ; y++) {
        const on = new Date(y, month - 1, dayOfMonth).getMonth() === month - 1 ? new Date(y, month - 1, dayOfMonth).getTime() : new Date(y, month - 1, dayOfMonth - 1).getTime();
        if (on >= today) return { on, year: y };
      }
    };
    const out: UpcomingDate[] = [];
    for (const p of this.people()) {
      const start = p.startDate === null ? null : /^(\d{4})-(\d{2})-(\d{2})$/.exec(p.startDate);
      if (start) {
        const o = next(+start[2]!, +start[3]!), years = o ? o.year - +start[1]! : 0;
        if (o && years >= 1 && dayDiff(today, o.on) <= withinDays) out.push({ personId: p.id, kind: 'anniversary', on: o.on, inDays: dayDiff(today, o.on), years });
      }
      const bday = p.birthday === null ? null : /(\d{2})-(\d{2})$/.exec(p.birthday);
      if (bday) {
        const o = next(+bday[1]!, +bday[2]!);
        if (o && dayDiff(today, o.on) <= withinDays) out.push({ personId: p.id, kind: 'birthday', on: o.on, inDays: dayDiff(today, o.on), years: null });
      }
    }
    return out.sort((a, b) => a.on - b.on);
  }

  /** Like `capture`, but a line that starts with a capture-template name and has an @person creates every line of the template. */
  captureMany(line: string, now: number = Date.now(), source: ItemSource = 'hotkey'): Item[] {
    const lines = expandTemplate(line, this.settings().captureTemplates);
    if (lines === null || lines.length === 0) return [this.capture(line, source, now)];
    return write(this.db, () => lines.map((l) => this.capture(l, source, now)));
  }

  // ---- audit log (MCP) ----

  audit(tool: string, summary: string, wrote: boolean, at: number = Date.now()): void {
    try {
      write(this.db, () => {
        run(this.db, 'INSERT INTO mcp_audit(at, tool, summary, wrote) VALUES(?,?,?,?)', toDbDate(at), tool, summary, wrote ? 1 : 0);
        run(this.db, 'DELETE FROM mcp_audit WHERE id NOT IN (SELECT id FROM mcp_audit ORDER BY id DESC LIMIT 500)');
      });
    } catch { /* the audit log must never break a tool call */ }
  }

  auditLog(limit = 50): AuditEntry[] {
    try { return all(this.db, 'SELECT * FROM mcp_audit ORDER BY id DESC LIMIT ?', limit).map(auditFromRow); } catch { return []; }
  }

  // ---- export, change detection, snapshot ----

  /** Pretty JSON of people, items and interactions: snake_case keys, ISO-8601 dates, keys sorted, nulls omitted (like the Swift export). */
  exportJSON(): string {
    const dates = new Set(['due_at', 'remind_at', 'snoozed_until', 'created_at', 'updated_at', 'completed_at', 'last_touched_at', 'occurred_at']);
    const dump = (table: string, bools: string[]): Array<Record<string, unknown>> => all(this.db, `SELECT * FROM ${table} ORDER BY rowid`).map((r) => {
      const o: Record<string, unknown> = {};
      for (const k of Object.keys(r).sort()) {
        const v = r[k];
        if (v === null || v === undefined) continue;
        o[k] = dates.has(k) ? iso(dateOrNull(v)!) : bools.includes(k) ? bool(v) : v;
      }
      return o;
    });
    return JSON.stringify({
      interactions: dump('interactions', []),
      items: dump('items', ['due_has_time', 'pinned', 'inbox']),
      people: dump('people', ['hidden_from_claude', 'archived']),
    }, null, 2);
  }

  /** Changes when another connection commits (the app polls this to notice MCP writes). */
  dataVersion(): number {
    try { return int(get(this.db, 'PRAGMA data_version')?.data_version); } catch { return 0; }
  }

  /** Everything the renderer needs to draw the main screens. */
  snapshot(now: number = Date.now()): Snapshot {
    const snoozedCount = int(get(this.db, "SELECT COUNT(*) c FROM items WHERE status = 'open' AND snoozed_until IS NOT NULL AND snoozed_until > ?", toDbDate(now))?.c);
    return {
      settings: this.settings(), today: this.today(now), openItems: this.items({ includeSnoozed: false }, now),
      summaries: this.personSummaries(now), tags: this.allTags(), auditLog: this.auditLog(), snoozedCount, now,
    };
  }
}
