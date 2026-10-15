// Minimal MCP server over newline-delimited JSON-RPC (stdio). No network. Port of Sources/JaffloopCore/MCPServer.swift:
// same tools, same JSON shapes (snake_case keys, ISO 8601 UTC timestamps, date-only dues as local yyyy-MM-dd), same error text.
// Person `notes` are never read here, so they can never leave the process.
import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Interaction, InteractionKind, Item, ItemFilter, ItemKind, ItemStatus, Person, PersonSummary } from '../shared/types';
import { ITEM_KINDS } from '../shared/types';
import { addDays } from '../core/calendar';
import { openDatabase } from '../core/db';
import { newItem } from '../core/models';
import { parseCapture } from '../core/parser';
import { isOverdue, isSlipping, isStaleWait } from '../core/rules';
import { hm } from '../core/settings';
import { Store } from '../core/store';

// Replaced by esbuild's `define` (scripts/build.mjs); undefined under vitest and plain tsc.
declare const __JAFFLOOP_VERSION__: string | undefined;
export const mcpServerVersion: string = typeof __JAFFLOOP_VERSION__ === 'string' ? __JAFFLOOP_VERSION__ : '0.0.0-dev';

type J = Record<string, unknown>;

const WRITE_TOOLS = new Set(['capture', 'add_item', 'complete_item', 'snooze_item', 'update_item', 'log_interaction']);
const INTERACTION_KINDS: InteractionKind[] = ['1on1', 'meeting', 'chat', 'other'];
const STATUSES: ItemStatus[] = ['open', 'done', 'dropped'];

class MCPError extends Error {
  // The Swift server printed these with "\(error)" in resources/read errors (Swift's debug text also escapes '); keep that text.
  override toString(): string { return `MCPError(message: ${JSON.stringify(this.message).replaceAll("'", "\\'")})`; }
}

const isObj = (v: unknown): v is J => typeof v === 'object' && v !== null && !Array.isArray(v);
const asStr = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
// Swift's `as? Bool` / `as? Int` on JSON numbers and booleans: 0 and 1 read as booleans, true and false read as 1 and 0.
const asBool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : v === 0 ? false : v === 1 ? true : undefined);
const asInt = (v: unknown): number | undefined => (typeof v === 'number' && Number.isInteger(v) ? v : typeof v === 'boolean' ? Number(v) : undefined);
const asStrings = (v: unknown): string[] | undefined => (Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : undefined);
const isoString = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const inList = <T extends string>(list: readonly T[], v: unknown): T | undefined => (typeof v === 'string' ? list.find((x) => x === v) : undefined);
const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// ---- JSON text like Foundation's [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes] ----

// Foundation sorts keys with a localized, number-aware compare ("a_b" < "a-b" < "a.b" < "a1" < "a2" < "a10" < "ab").
const keyOrder = new Intl.Collator('en', { numeric: true });

function jsonString(s: string): string {
  let out = '"';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (ch === '"') out += '\\"';
    else if (ch === '\\') out += '\\\\';
    else if (c === 8) out += '\\b';
    else if (c === 12) out += '\\f';
    else if (c === 10) out += '\\n';
    else if (c === 13) out += '\\r';
    else if (c === 9) out += '\\t';
    else if (c < 32) out += '\\u' + c.toString(16).padStart(4, '0');
    else out += ch;
  }
  return out + '"';
}

/** Empty containers print as "[\n\n<indent>]" exactly like Foundation. */
function prettyJson(v: unknown, indent = ''): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'string') return jsonString(v);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  const inner = indent + '  ';
  if (Array.isArray(v)) {
    if (v.length === 0) return `[\n\n${indent}]`;
    return `[\n${v.map((x) => inner + prettyJson(x, inner)).join(',\n')}\n${indent}]`;
  }
  const entries = Object.entries(v as J).filter(([, x]) => x !== undefined).sort(([a], [b]) => keyOrder.compare(a, b));
  if (entries.length === 0) return `{\n\n${indent}}`;
  return `{\n${entries.map(([k, x]) => `${inner}${jsonString(k)} : ${prettyJson(x, inner)}`).join(',\n')}\n${indent}}`;
}

// ---- date arguments ----

const ISO_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})T(\d{1,2}):(\d{2}):(\d{2})(Z|z|[+-]\d{2}(?::?\d{2})?)$/;
const LOCAL_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:T(\d{1,2}):(\d{2})(?::(\d{2}))?| (\d{1,2}):(\d{2}))?$/;
const validDay = (mo: number, d: number): boolean => mo >= 1 && mo <= 12 && d >= 1 && d <= 31;

export interface MCPServerOptions {
  /** Clock in epoch ms (tests). */
  now?: () => number;
}

export class MCPServer {
  now: () => number;

  constructor(readonly store: Store, opts: MCPServerOptions = {}) {
    this.now = opts.now ?? Date.now;
  }

  // ---- transport ----

  /** Reads newline-delimited JSON-RPC from stdin until EOF; replies on stdout. Nothing else is ever written to stdout. */
  runStdio(): Promise<void> {
    process.stdout.on('error', () => process.exit(0)); // client went away
    const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
    rl.on('line', (line) => {
      if (line.trim() === '') return;
      let msg: unknown;
      try { msg = JSON.parse(line); } catch { return; }
      if (!isObj(msg)) return;
      let resp: J | null;
      try {
        resp = this.handle(msg);
      } catch (e) {
        resp = msg.id === undefined ? null : { jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: errText(e) } };
      }
      if (resp) process.stdout.write(JSON.stringify(resp) + '\n');
    });
    return new Promise((resolve) => rl.on('close', resolve));
  }

  handle(msg: object): J | null {
    const m = msg as J;
    const method = asStr(m.method) ?? '';
    const id = m.id;
    const params = isObj(m.params) ? m.params : {};
    if (id === undefined) return null; // notification
    const ok = (result: unknown): J => ({ jsonrpc: '2.0', id, result });
    const err = (code: number, message: string): J => ({ jsonrpc: '2.0', id, error: { code, message } });
    switch (method) {
      case 'initialize':
        return ok({
          protocolVersion: asStr(params.protocolVersion) ?? '2025-03-26',
          capabilities: { tools: {}, resources: {} },
          serverInfo: { name: 'jaffloop', version: mcpServerVersion },
        });
      case 'ping': return ok({});
      case 'tools/list': return ok({ tools: TOOL_DEFS });
      case 'tools/call': return ok(this.callTool(asStr(params.name) ?? '', isObj(params.arguments) ? params.arguments : {}));
      case 'resources/list':
        return ok({
          resources: [
            { uri: 'jaffloop://today', name: 'Today', mimeType: 'application/json', description: 'Slipping, overdue, due today, stale waits, inbox' },
            { uri: 'jaffloop://ledger', name: 'Promise ledger', mimeType: 'application/json', description: 'All open promises grouped by person' },
          ],
        });
      case 'resources/templates/list':
        return ok({ resourceTemplates: [{ uriTemplate: 'jaffloop://person/{handle}', name: 'Person', mimeType: 'application/json' }] });
      case 'resources/read': {
        const uri = asStr(params.uri);
        if (uri === undefined) return err(-32602, 'uri required');
        try {
          return ok({ contents: [{ uri, mimeType: 'application/json', text: prettyJson(this.readResource(uri)) }] });
        } catch (e) {
          return err(-32002, e instanceof MCPError ? e.toString() : errText(e));
        }
      }
      default: return err(-32601, `method not found: ${method}`);
    }
  }

  // ---- tools ----

  callTool(name: string, a: J): J {
    const wrote = WRITE_TOOLS.has(name);
    if (wrote && this.store.settings().mcpReadOnly) {
      this.store.audit(name, 'blocked: read-only mode', false, this.now());
      return result('Jaffloop is in read-only mode for Claude. Change this in Settings > MCP.', true);
    }
    try {
      const [value, summary] = this.run(name, a);
      this.store.audit(name, summary, wrote, this.now());
      return result(prettyJson(value));
    } catch (e) {
      this.store.audit(name, `error: ${errText(e)}`, false, this.now());
      return result(errText(e), true);
    }
  }

  /** Accepts ISO 8601 ("2026-10-15T09:00:00Z"), local "yyyy-MM-dd[ HH:mm]" / "yyyy-MM-dd'T'HH:mm[:ss]", or a capture phrase ("fri", "tomorrow 9:00"). */
  date(v: unknown): number | null {
    if (typeof v !== 'string') return null;
    const s = v.trim();
    const iso = ISO_RE.exec(s);
    if (iso) {
      const [y, mo, d, h, mi, sec] = iso.slice(1, 7).map(Number) as [number, number, number, number, number, number];
      const tz = iso[7]!;
      if (validDay(mo, d) && h <= 24 && mi < 60 && sec < 60) {
        const off = /^[zZ]$/.test(tz) ? 0 : (tz[0] === '-' ? -1 : 1) * (Number(tz.slice(1, 3)) * 60 + Number(tz.replace(':', '').slice(3) || 0));
        return Date.UTC(y, mo - 1, d, h, mi, sec) - off * 60_000;
      }
    }
    const loc = LOCAL_RE.exec(s);
    if (loc) {
      const y = +loc[1]!, mo = +loc[2]!, d = +loc[3]!;
      const h = +(loc[4] ?? loc[7] ?? 0), mi = +(loc[5] ?? loc[8] ?? 0), sec = +(loc[6] ?? 0);
      if (validDay(mo, d) && h <= 24 && mi < 60 && sec < 60) return new Date(y, mo - 1, d, h, mi, sec).getTime();
    }
    return parseCapture('todo x ' + v, { now: this.now() }).dueAt;
  }

  private personFor(handle: unknown): Person | null {
    if (typeof handle !== 'string') return null;
    const h = handle.startsWith('@') ? handle.slice(1) : handle;
    const p = this.store.person(h, false);
    if (!p || p.hiddenFromClaude) throw new MCPError(`No person with handle '${h}'.`);
    return p;
  }

  private visible(items: Item[]): Item[] {
    const hidden = this.store.hiddenPersonIds();
    return items.filter((i) => i.personId === null || !hidden.has(i.personId));
  }

  private itemFor(v: unknown): Item {
    const i = typeof v === 'string' ? this.store.item(v) : null;
    if (!i) throw new MCPError('No item with that id.');
    if (i.personId !== null && this.store.hiddenPersonIds().has(i.personId)) throw new MCPError('No item with that id.');
    return i;
  }

  private dayString(ms: number): string {
    const d = new Date(ms);
    const p = (n: number, w = 2): string => String(n).padStart(w, '0');
    return `${p(d.getFullYear(), 4)}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  itemJSON(i: Item): J {
    const now = this.now();
    const d: J = {
      id: i.id, kind: i.kind, title: i.title, status: i.status, pinned: i.pinned, inbox: i.inbox, snooze_count: i.snoozeCount,
      slipping: isSlipping(i), created_at: isoString(i.createdAt),
    };
    if (i.body !== null) d.body = i.body;
    if (i.quote !== null) d.quote = i.quote;
    if (i.dueAt !== null) { d.due = i.dueHasTime ? isoString(i.dueAt) : this.dayString(i.dueAt); d.overdue = isOverdue(i, now); }
    if (i.remindAt !== null) d.remind_at = isoString(i.remindAt);
    if (i.snoozedUntil !== null && i.snoozedUntil > now) d.snoozed_until = isoString(i.snoozedUntil);
    if (i.recurRule !== null) d.recurrence = i.recurRule;
    const person = i.personId !== null ? this.store.personById(i.personId) : null;
    if (person) d.person = person.handle;
    const tags = this.store.tags(i.id);
    if (tags.length > 0) d.tags = tags;
    if (i.kind === 'wait') d.stale = isStaleWait(i, now, this.store.settings());
    return d;
  }

  private personJSON(s: PersonSummary): J {
    const d: J = {
      handle: s.person.handle, name: s.person.name, relation: s.person.relation, open_i_owe: s.openOwe, open_they_owe: s.openWait,
      cadence_overdue: s.cadenceOverdue, archived: s.person.archived,
    };
    if (s.person.cadenceDays !== null) d.cadence_days = s.person.cadenceDays;
    if (s.lastInteraction !== null) d.last_interaction = isoString(s.lastInteraction);
    if (s.daysSinceLast !== null) d.days_since_last_interaction = s.daysSinceLast;
    return d;
  }

  private run(name: string, a: J): [unknown, string] {
    const t = this.now();
    const store = this.store;
    switch (name) {
      case 'capture': {
        const text = asStr(a.text);
        if (!text) throw new MCPError('text is required');
        const parsed = parseCapture(text, { now: t, eod: hm(store.settings().eodTime) });
        if (parsed.personHandle !== null && store.person(parsed.personHandle, false)?.hiddenFromClaude) {
          throw new MCPError(`No person with handle '${parsed.personHandle}'.`);
        }
        const i = store.create(parsed, 'mcp', t);
        return [this.itemJSON(i), `capture: ${i.kind} "${i.title}"`];
      }
      case 'add_item': {
        const kind = inList(ITEM_KINDS, a.kind);
        if (!kind) throw new MCPError('kind must be one of owe, wait, bring, task, said, note');
        const title = asStr(a.title);
        if (!title) throw new MCPError('title is required');
        const p = this.personFor(a.person);
        const due = this.date(a.due);
        const item = newItem({
          kind, title, body: asStr(a.body) ?? null, quote: asStr(a.quote) ?? null, personId: p?.id ?? null, dueAt: due,
          dueHasTime: asStr(a.due)?.includes(':') ?? false, remindAt: this.date(a.remind_at),
          inbox: due === null && p === null && (['task', 'owe', 'wait', 'bring'] as ItemKind[]).includes(kind), source: 'mcp', now: t,
          recurRule: asStr(a.recurrence) ?? null,
        });
        store.insert(item, asStrings(a.tags) ?? []);
        return [this.itemJSON(item), `add_item: ${kind} "${title}"`];
      }
      case 'list_items': {
        const f: ItemFilter = { includeSnoozed: true, limit: asInt(a.limit) ?? 50 };
        const k = asStr(a.kind);
        if (k !== undefined) f.kinds = inList(ITEM_KINDS, k) ? [k as ItemKind] : [];
        const p = this.personFor(a.person);
        if (p) f.personId = p.id;
        const st = asStr(a.status);
        f.status = st === undefined ? 'open' : (inList(STATUSES, st) ?? null); // "any" and unknown values mean any status
        const before = this.date(a.due_before);
        if (before !== null) f.dueBefore = before;
        f.overdueOnly = asBool(a.overdue) ?? false;
        const sd = asInt(a.stale_days);
        if (sd !== undefined) f.staleDays = sd;
        const items = this.visible(store.items(f, t));
        return [{ count: items.length, items: items.map((i) => this.itemJSON(i)) }, `list_items: ${items.length} result(s)`];
      }
      case 'get_person': {
        const p = this.personFor(a.handle);
        if (!p) throw new MCPError('handle is required');
        return [this.personDetail(p), `get_person: ${p.handle}`];
      }
      case 'list_people': {
        const hidden = store.hiddenPersonIds();
        const rows = store.personSummaries(t, asBool(a.include_archived) ?? false).filter((x) => !hidden.has(x.person.id));
        return [{ people: rows.map((x) => this.personJSON(x)) }, `list_people: ${rows.length}`];
      }
      case 'complete_item': {
        const i = this.itemFor(a.id);
        const next = store.complete(i.id, t);
        return [{ completed: this.itemJSON(store.item(i.id)!), next_occurrence: next ? this.itemJSON(next) : null }, `complete_item: "${i.title}"`];
      }
      case 'snooze_item': {
        const i = this.itemFor(a.id);
        const until = this.date(a.until);
        if (until === null) throw new MCPError("until must be an ISO date/time or phrase like 'tomorrow 9:00'");
        store.snooze(i.id, until, t);
        return [this.itemJSON(store.item(i.id)!), `snooze_item: "${i.title}"`];
      }
      case 'update_item': {
        const i = this.itemFor(a.id);
        const f = isObj(a.fields) ? a.fields : {};
        const pid = this.personFor(f.person)?.id;
        const due = this.date(f.due);
        const remind = this.date(f.remind_at);
        store.update(i.id, (it) => {
          const title = asStr(f.title), body = asStr(f.body), quote = asStr(f.quote);
          if (title !== undefined) it.title = title;
          if (body !== undefined) it.body = body;
          if (quote !== undefined) it.quote = quote;
          const kind = inList(ITEM_KINDS, f.kind);
          if (kind) it.kind = kind;
          const status = inList(STATUSES, f.status);
          if (status) { it.status = status; if (status === 'done') it.completedAt = t; }
          const pinned = asBool(f.pinned);
          if (pinned !== undefined) it.pinned = pinned;
          if (pid !== undefined) it.personId = pid;
          if (due !== null) { it.dueAt = due; it.dueHasTime = asStr(f.due)?.includes(':') ?? false; }
          if (remind !== null) it.remindAt = remind;
        }, t);
        const tags = asStrings(f.tags);
        if (tags) store.setTags(i.id, tags);
        return [this.itemJSON(store.item(i.id)!), `update_item: "${i.title}"`];
      }
      case 'log_interaction': {
        const p = this.personFor(a.person);
        if (!p) throw new MCPError('person is required');
        const kind = inList(INTERACTION_KINDS, a.kind) ?? '1on1';
        const x = store.logInteraction(p.id, kind, asStr(a.notes) ?? null, this.date(a.occurred_at) ?? t);
        return [{ id: x.id, person: p.handle, occurred_at: isoString(x.occurredAt) }, `log_interaction: ${p.handle}`];
      }
      case 'search': {
        const q = asStr(a.query);
        if (q === undefined) throw new MCPError('query is required');
        let query = q;
        if (isObj(a.filters)) {
          const f = a.filters;
          const kind = asStr(f.kind), person = asStr(f.person), before = asStr(f.before), status = asStr(f.status);
          if (kind !== undefined) query += ` kind:${kind}`;
          if (person !== undefined) query += ` @${person.startsWith('@') ? person.slice(1) : person}`;
          if (before !== undefined) query += ` before:${before}`;
          if (status !== undefined) query += ` status:${status}`;
        }
        const items = this.visible(store.search(query, 50, t));
        return [{ count: items.length, items: items.map((i) => this.itemJSON(i)) }, `search: "${q}" -> ${items.length}`];
      }
      case 'prep_brief': {
        const p = this.personFor(a.person);
        if (!p) throw new MCPError('person is required');
        return [this.prepBrief(p), `prep_brief: ${p.handle}`];
      }
      case 'week_summary': {
        const to = this.date(a.to) ?? t;
        const from = this.date(a.from) ?? addDays(to, -7);
        const w = store.weekSummary(from, to, t);
        const list = (items: Item[]): J[] => this.visible(items).map((i) => this.itemJSON(i));
        return [{
          from: isoString(from), to: isoString(to), created: list(w.created), completed: list(w.completed), slipped: list(w.slipped),
          stale_waits: list(w.stale),
        }, 'week_summary'];
      }
      default: throw new MCPError(`unknown tool: ${name}`);
    }
  }

  private personDetail(p: Person): J {
    const t = this.now();
    const store = this.store;
    const summary = store.personSummaries(t, true).find((s) => s.person.id === p.id)!;
    const open = store.items({ personId: p.id, includeSnoozed: true }, t);
    const said = store.items({ personId: p.id, kinds: ['said'], status: null, limit: 20 }, t);
    const inter = store.interactions(p.id);
    const of = (...kinds: ItemKind[]): J[] => open.filter((i) => kinds.includes(i.kind)).map((i) => this.itemJSON(i));
    return {
      ...this.personJSON(summary),
      i_owe_them: of('owe'), they_owe_me: of('wait'), bring_up: of('bring'), other_open: of('task', 'note'),
      said_log: said.map((i) => this.itemJSON(i)),
      recent_interactions: inter.map((x: Interaction) => ({ at: isoString(x.occurredAt), kind: x.kind, notes: x.notes })),
    };
  }

  private prepBrief(p: Person): J {
    const full = this.personDetail(p);
    const d: J = {};
    for (const k of ['handle', 'name', 'relation', 'last_interaction', 'days_since_last_interaction', 'cadence_days', 'cadence_overdue',
      'i_owe_them', 'they_owe_me', 'bring_up', 'said_log', 'recent_interactions']) {
      if (full[k] !== undefined) d[k] = full[k];
    }
    d.said_log = (full.said_log as J[]).slice(0, 5);
    return d;
  }

  private readResource(uri: string): unknown {
    const t = this.now();
    switch (uri) {
      case 'jaffloop://today': {
        const s = this.store.today(t);
        const list = (items: Item[]): J[] => this.visible(items).map((i) => this.itemJSON(i));
        return { slipping: list(s.slipping), overdue: list(s.overdue), today: list(s.today), waiting_stale: list(s.waitingStale), inbox: list(s.inbox) };
      }
      case 'jaffloop://ledger': {
        const by: Record<string, J[]> = Object.create(null) as Record<string, J[]>;
        for (const i of this.visible(this.store.items({ kinds: ['owe'], includeSnoozed: true }, t))) {
          const j = this.itemJSON(i);
          (by[asStr(j.person) ?? '(no person)'] ??= []).push(j);
        }
        return by;
      }
      default: {
        const prefix = 'jaffloop://person/';
        if (uri.startsWith(prefix)) {
          const p = this.personFor(uri.slice(prefix.length));
          if (p) return this.personDetail(p);
        }
        throw new MCPError(`unknown resource ${uri}`);
      }
    }
  }
}

function result(text: string, error = false): J {
  const r: J = { content: [{ type: 'text', text }] };
  if (error) r.isError = true;
  return r;
}

// ---- tool definitions (verbatim from the Swift server) ----

const str: J = { type: 'string' };
const s = (description: string): J => ({ type: 'string', description });
const tool = (name: string, description: string, properties: J, required: string[] = []): J => ({
  name, description, inputSchema: { type: 'object', properties, required },
});

const TOOL_DEFS: J[] = [
  tool('capture', 'Add an item from one line using Jaffloop capture syntax, e.g. `owe @sara review RFC fri`, `wait @amir API spec mon 10:00`, `said @sara "quote"`, `todo prepare plan thu #planning !`.', { text: s('The capture line') }, ['text']),
  tool('add_item', 'Add an item with explicit fields.', { kind: { type: 'string', enum: ['owe', 'wait', 'bring', 'task', 'said', 'note'] }, title: str, person: s('Person handle'), due: s("ISO date/time, or a phrase like 'fri' or 'tomorrow 9:00'"), remind_at: s('ISO date/time'), tags: { type: 'array', items: str }, quote: s('Exact words (for said)'), body: str }, ['kind', 'title']),
  tool('list_items', 'Query items. Defaults to open items.', { kind: str, person: s('Person handle'), status: s('open | done | dropped | any'), due_before: s('ISO date/time'), overdue: { type: 'boolean' }, stale_days: { type: 'integer', description: 'Not touched for N days' }, limit: { type: 'integer' } }),
  tool('get_person', "One person's profile, open items both ways, said log and recent interactions.", { handle: s('Person handle') }, ['handle']),
  tool('list_people', 'All people with cadence status.', { include_archived: { type: 'boolean' } }),
  tool('complete_item', 'Mark an item done. Recurring items create their next occurrence.', { id: str }, ['id']),
  tool('snooze_item', 'Hide an item until a time.', { id: str, until: s("ISO date/time or phrase like 'tomorrow 9:00'") }, ['id', 'until']),
  tool('update_item', 'Change fields on an item (title, body, quote, kind, status, pinned, person, due, remind_at, tags).', { id: str, fields: { type: 'object' } }, ['id', 'fields']),
  tool('log_interaction', 'Record a 1:1 or meeting with a person.', { person: s('Person handle'), kind: { type: 'string', enum: ['1on1', 'meeting', 'chat', 'other'] }, notes: str, occurred_at: s('ISO date/time, defaults to now') }, ['person']),
  tool('search', 'Full-text search over titles, bodies and quotes.', { query: str, filters: { type: 'object', properties: { kind: str, person: str, before: str, status: str } } }, ['query']),
  tool('prep_brief', 'Structured data to prepare a conversation: open items both ways, talking points, recent said entries, cadence.', { person: s('Person handle') }, ['person']),
  tool('week_summary', 'Created, completed, slipped and stale items for a range (defaults to the last 7 days).', { from: s('ISO date'), to: s('ISO date') }),
];

// ---- entry point: jaffloop-mcp [--db <path>] [--version] ----

export const defaultDatabasePath = (): string => join(homedir(), 'Library', 'Application Support', 'Jaffloop', 'jaffloop.sqlite');

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  if (argv.includes('--version')) { process.stdout.write(`jaffloop-mcp ${mcpServerVersion}\n`); return; }
  const i = argv.indexOf('--db');
  const path = i >= 0 && i + 1 < argv.length ? argv[i + 1]! : defaultDatabasePath();
  let server: MCPServer;
  try {
    server = new MCPServer(new Store(openDatabase(path)));
  } catch (e) {
    process.stderr.write(`jaffloop-mcp: ${errText(e)}\n`);
    process.exit(1);
  }
  await server.runStdio();
}

// Start only when this file is the script being run (the bundled dist/mcp/server.cjs), never when imported by tests or the app.
// `process.type` is set inside Electron's own processes (main, renderer) but not under ELECTRON_RUN_AS_NODE.
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module && !(process as unknown as { type?: string }).type) {
  void main();
}
