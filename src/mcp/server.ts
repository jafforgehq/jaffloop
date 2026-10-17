// Minimal MCP server over newline-delimited JSON-RPC (stdio). No network. Port of Sources/JaffloopCore/MCPServer.swift:
// same tools, same JSON shapes (snake_case keys, ISO 8601 UTC timestamps, date-only dues as local yyyy-MM-dd), same error text.
// Person `notes` are never read here, so they can never leave the process.
import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { CustomPrompt, Interaction, InteractionKind, Item, ItemFilter, ItemKind, ItemStatus, Person, PersonSummary } from '../shared/types';
import { ITEM_KINDS, RELATIONS } from '../shared/types';
import { addDays } from '../core/calendar';
import { openDatabase } from '../core/db';
import { nameFromHandle, newItem, newPerson } from '../core/models';
import { parseCapture } from '../core/parser';
import { isOverdue, isSlipping, isStaleWait } from '../core/rules';
import { hm } from '../core/settings';
import { Store, type InsertResult, type ItemOrigin } from '../core/store';
import { PROMPTS, renderPrompt, type JaffloopPrompt } from '../shared/prompts';

// Replaced by esbuild's `define` (scripts/build.mjs); undefined under vitest and plain tsc.
declare const __JAFFLOOP_VERSION__: string | undefined;
export const mcpServerVersion: string = typeof __JAFFLOOP_VERSION__ === 'string' ? __JAFFLOOP_VERSION__ : '0.0.0-dev';

type J = Record<string, unknown>;

const WRITE_TOOLS = new Set(['capture', 'add_item', 'add_items', 'complete_item', 'snooze_item', 'update_item', 'log_interaction', 'save_person', 'save_prompt']);
const INTERACTION_KINDS: InteractionKind[] = ['1on1', 'meeting', 'chat', 'other'];
const STATUSES: ItemStatus[] = ['open', 'done', 'dropped'];
const MAX_BULK_ITEMS = 100;

/** A stored custom prompt as the built-in shape, so list, get and renderPrompt treat both alike. */
const toPrompt = (c: CustomPrompt): JaffloopPrompt => ({ id: c.id, title: c.title, description: c.description, needs: c.needs, arguments: c.arguments, text: c.text });
const promptListItem = (p: JaffloopPrompt): J => ({
  name: p.id, title: p.title, description: p.description,
  arguments: p.arguments.map((x) => ({ name: x.name, description: x.description, required: x.required })),
});

/** Returns a function that is true when the set of approved custom prompts changed since its last call (the first call only records it). */
export function promptSetWatcher(store: Store): () => boolean {
  const key = (): string => JSON.stringify(store.customPrompts().filter((c) => c.approved).map((c) => [c.id, c.updatedAt]));
  let last = key(), version = store.dataVersion();
  return () => {
    const v = store.dataVersion();
    if (v === version) return false;
    version = v;
    const now = key();
    if (now === last) return false;
    last = now;
    return true;
  };
}

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
  private initialized = false;

  constructor(readonly store: Store, opts: MCPServerOptions = {}) {
    this.now = opts.now ?? Date.now;
  }

  // ---- transport ----

  /** Reads newline-delimited JSON-RPC from stdin until EOF; replies on stdout. Nothing else is ever written to stdout. */
  runStdio(): Promise<void> {
    process.stdout.on('error', () => process.exit(0)); // client went away
    const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
    // tell the client when the approved custom prompts change (approved in the app, which is another process)
    const changed = promptSetWatcher(this.store);
    const timer = setInterval(() => {
      if (this.initialized && changed()) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/prompts/list_changed' }) + '\n');
    }, 1000);
    timer.unref();
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
    return new Promise((resolve) => rl.on('close', () => { clearInterval(timer); resolve(); }));
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
        this.initialized = true;
        return ok({
          protocolVersion: asStr(params.protocolVersion) ?? '2025-03-26',
          capabilities: { tools: {}, resources: {}, prompts: { listChanged: true } },
          serverInfo: { name: 'jaffloop', version: mcpServerVersion },
        });
      case 'ping': return ok({});
      case 'tools/list': return ok({ tools: TOOL_DEFS });
      case 'tools/call': return ok(this.callTool(asStr(params.name) ?? '', isObj(params.arguments) ? params.arguments : {}));
      case 'prompts/list':
        return ok({ prompts: this.servedPrompts().map(promptListItem) });
      case 'prompts/get': {
        const p = this.servedPrompts().find((x) => x.id === asStr(params.name));
        if (!p) return err(-32602, `Unknown prompt: ${asStr(params.name) ?? ''}`);
        const given: Record<string, string> = {};
        if (isObj(params.arguments)) {
          for (const [k, v] of Object.entries(params.arguments)) if (typeof v === 'string' || typeof v === 'number') given[k] = String(v);
        }
        const missing = p.arguments.filter((x) => x.required && !given[x.name]?.trim()).map((x) => x.name);
        if (missing.length > 0) return err(-32602, `Missing required argument${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`);
        return ok({ description: p.description, messages: [{ role: 'user', content: { type: 'text', text: renderPrompt(p, given) } }] });
      }
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

  /** Built-in prompts plus the custom ones the user approved; unapproved ones are never served. */
  private servedPrompts(): JaffloopPrompt[] {
    return [...PROMPTS, ...this.store.customPrompts().filter((c) => c.approved).map(toPrompt)];
  }

  // ---- tools ----

  callTool(name: string, a: J): J {
    const isWrite = WRITE_TOOLS.has(name);
    if (isWrite && this.store.settings().mcpReadOnly) {
      this.store.audit(name, 'blocked: read-only mode', false, this.now());
      return result('Jaffloop is in read-only mode for Claude. Change this in Settings > MCP.', true);
    }
    try {
      const [value, summary, wrote = isWrite] = this.run(name, a);
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
    if (i.proposed) d.proposed = true;
    if (i.externalId !== null) d.external_id = i.externalId;
    if (i.sourceLabel !== null) d.source_label = i.sourceLabel;
    if (i.sourceUrl !== null) d.source_url = i.sourceUrl;
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
    if (s.person.title !== '') d.title = s.person.title;
    if (s.person.cadenceDays !== null) d.cadence_days = s.person.cadenceDays;
    if (s.lastInteraction !== null) d.last_interaction = isoString(s.lastInteraction);
    if (s.daysSinceLast !== null) d.days_since_last_interaction = s.daysSinceLast;
    return d;
  }

  /** external_id, source_label, source_url from tool arguments; blank strings count as not given. */
  private origin(a: J, interactionId: string | null = null): ItemOrigin {
    const t = (v: unknown): string | null => { const x = asStr(v)?.trim(); return x ? x : null; };
    return { externalId: t(a.external_id), sourceLabel: t(a.source_label), sourceUrl: t(a.source_url), interactionId };
  }

  /** A duplicate never exposes an item of a hidden person (not even its id). */
  private duplicateJSON(r: InsertResult): J {
    const hidden = r.item.personId !== null && this.store.hiddenPersonIds().has(r.item.personId);
    return hidden ? { duplicate: true } : { duplicate: true, id: r.item.id, item: this.itemJSON(r.item) };
  }

  /** Validates add_item style arguments and writes the item unless its external_id already exists. Throws MCPError for bad input. */
  private addOne(a: J, t: number, interactionId: string | null = null): { r: InsertResult; kind: ItemKind; title: string } {
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
      recurRule: asStr(a.recurrence) ?? null, ...this.origin(a, interactionId), proposed: this.store.settings().reviewClaudeItems,
    });
    return { r: this.store.insertOnce(item, asStrings(a.tags) ?? []), kind, title };
  }

  /** Runs addOne over a list; one bad entry never stops the others. */
  private addMany(list: unknown[], t: number, interactionId: string | null = null): J {
    let created = 0, duplicates = 0, errors = 0;
    const results = list.map((x, index): J => {
      try {
        if (!isObj(x)) throw new MCPError('item must be an object');
        const { r } = this.addOne(x, t, interactionId);
        if (r.duplicate) { duplicates++; const d = this.duplicateJSON(r); return { index, status: 'duplicate', ...(d.id === undefined ? {} : { id: d.id }) }; }
        created++;
        return { index, status: 'created', id: r.item.id };
      } catch (e) {
        errors++;
        return { index, status: 'error', error: errText(e) };
      }
    });
    return { created, duplicates, errors, results };
  }

  private run(name: string, a: J): [unknown, string, boolean?] {
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
        const origin = { ...this.origin(a), proposed: store.settings().reviewClaudeItems };
        if (origin.externalId === null && origin.sourceLabel === null && origin.sourceUrl === null) {
          const i = store.create(parsed, 'mcp', t, { proposed: origin.proposed });
          return [this.itemJSON(i), `capture: ${i.kind} "${i.title}"`];
        }
        const r = store.createOnce(parsed, 'mcp', t, origin);
        if (r.duplicate) return [this.duplicateJSON(r), `capture: duplicate ${origin.externalId}`, false];
        return [this.itemJSON(r.item), `capture: ${r.item.kind} "${r.item.title}"`];
      }
      case 'add_item': {
        const { r, kind, title } = this.addOne(a, t);
        if (r.duplicate) return [this.duplicateJSON(r), `add_item: duplicate ${r.item.externalId}`, false];
        return [this.itemJSON(r.item), `add_item: ${kind} "${title}"`];
      }
      case 'add_items': {
        if (!Array.isArray(a.items) || a.items.length === 0) throw new MCPError('items is required: a non-empty array');
        if (a.items.length > MAX_BULK_ITEMS) throw new MCPError(`items: at most ${MAX_BULK_ITEMS} per call, got ${a.items.length}`);
        const out = this.addMany(a.items, t);
        return [out, `add_items: ${out.created} created, ${out.duplicates} duplicate, ${out.errors} error`, (out.created as number) > 0];
      }
      case 'list_items': {
        const f: ItemFilter = { includeSnoozed: true, includeProposed: true, limit: asInt(a.limit) ?? 50 };
        const k = asStr(a.kind);
        if (k !== undefined) f.kinds = inList(ITEM_KINDS, k) ? [k as ItemKind] : [];
        const p = this.personFor(a.person);
        if (p) f.personId = p.id;
        const st = asStr(a.status);
        f.status = st === undefined ? 'open' : (inList(STATUSES, st) ?? null); // "any" and unknown values mean any status
        const ext = asStr(a.external_id)?.trim();
        if (ext) { f.externalId = ext; if (st === undefined) f.status = null; } // looking an id up: find it whatever its status
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
        const actions = Array.isArray(a.action_items) ? a.action_items : [];
        if (actions.length > MAX_BULK_ITEMS) throw new MCPError(`action_items: at most ${MAX_BULK_ITEMS} per call, got ${actions.length}`);
        const x = store.logInteraction(p.id, kind, asStr(a.notes) ?? null, this.date(a.occurred_at) ?? t);
        const out: J = { id: x.id, person: p.handle, occurred_at: isoString(x.occurredAt) };
        if (actions.length > 0) {
          out.action_items = this.addMany(actions.map((x) => (isObj(x) && x.person === undefined ? { ...x, person: p.handle } : x)), t, x.id);
        }
        return [out, `log_interaction: ${p.handle}`];
      }
      case 'save_person': return this.savePerson(a, t);
      case 'list_prompts': {
        const custom = store.customPrompts();
        return [{ builtin: PROMPTS.map((p) => ({ id: p.id, title: p.title })), custom: custom.map((c) => ({ id: c.id, title: c.title, approved: c.approved })) }, `list_prompts: ${PROMPTS.length} built-in, ${custom.length} custom`];
      }
      case 'save_prompt': return this.savePrompt(a, t);
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

  /** Saves a prompt for the user to approve in the app; Claude can neither approve nor delete. Validation problems are tool errors. */
  private savePrompt(a: J, t: number): [unknown, string] {
    const id = asStr(a.id)?.trim();
    if (!id) throw new MCPError('id is required');
    const strOr = (k: string, d: string): string => {
      if (a[k] === undefined) return d;
      const v = asStr(a[k]);
      if (v === undefined) throw new MCPError(`${k} must be a string`);
      return v;
    };
    const needs = a.needs === undefined ? [] : asStrings(a.needs);
    if (!needs) throw new MCPError('needs must be an array of strings');
    if (a.arguments !== undefined && (!Array.isArray(a.arguments) || !a.arguments.every(isObj))) throw new MCPError('arguments must be an array of objects');
    const args = ((a.arguments ?? []) as J[]).map((x) => {
      const dflt = x.default === undefined || x.default === null ? undefined : asStr(x.default);
      if (x.default !== undefined && x.default !== null && dflt === undefined) throw new MCPError(`argument '${asStr(x.name) ?? ''}': default must be a string`);
      return { name: asStr(x.name) ?? '', description: asStr(x.description) ?? '', required: asBool(x.required) ?? false, ...(dflt !== undefined && { default: dflt }) };
    });
    const r = this.store.saveCustomPrompt({ id, title: strOr('title', ''), description: strOr('description', ''), text: strOr('text', ''), needs, arguments: args }, 'mcp', t);
    if (r.error !== undefined) throw new MCPError(r.error);
    return [{ id, status: 'needs_approval', message: 'Open Jaffloop, Settings, Claude (MCP) and approve it.' }, `save_prompt: ${id}`];
  }

  /** Upsert by handle; only the fields that are present change. Validates everything before writing. Notes and hidden_from_claude are not writable here. */
  private savePerson(a: J, t: number): [unknown, string] {
    const raw = asStr(a.handle)?.trim().replace(/^@/, '').toLowerCase();
    if (!raw) throw new MCPError('handle is required');
    if (!/^[\p{L}\p{N}_.-]+$/u.test(raw)) throw new MCPError("handle may only contain letters, digits, '.', '_' and '-'");
    const has = (k: string): boolean => a[k] !== undefined;
    const cleared = (v: unknown): boolean => v === null || v === '';
    const text = (k: string): string | undefined => {
      if (!has(k)) return undefined;
      if (a[k] === null) return '';
      const v = asStr(a[k]);
      if (v === undefined) throw new MCPError(`${k} must be a string`);
      return v.trim();
    };
    const name = text('name');
    if (name === '') throw new MCPError('name must not be empty');
    const title = text('title');
    let relation: Person['relation'] | undefined;
    if (has('relation')) {
      relation = inList(RELATIONS, a.relation);
      if (!relation) throw new MCPError(`relation must be one of ${RELATIONS.join(', ')}`);
    }
    let cadence: number | null | undefined;
    if (has('cadence_days')) {
      const v = a.cadence_days;
      if (v === null || v === 0) cadence = null;
      else if (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 90) cadence = v;
      else throw new MCPError('cadence_days must be an integer from 1 to 90, or null to clear it');
    }
    let emails: string | undefined;
    if (has('match_emails')) {
      const v = text('match_emails')!;
      emails = v.split(',').map((e) => e.trim()).filter((e) => e !== '').join(', ');
    }
    let start: string | null | undefined;
    if (has('start_date')) {
      if (cleared(a.start_date)) start = null;
      else {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(asStr(a.start_date)?.trim() ?? '');
        const d = m ? new Date(+m[1]!, +m[2]! - 1, +m[3]!) : null;
        if (!m || !d || d.getFullYear() !== +m[1]! || d.getMonth() !== +m[2]! - 1 || d.getDate() !== +m[3]!) throw new MCPError("start_date must be a real date as 'YYYY-MM-DD'");
        start = m[0];
      }
    }
    let birthday: string | null | undefined;
    if (has('birthday')) {
      if (cleared(a.birthday)) birthday = null;
      else {
        const m = /^(?:\d{4}-)?(\d{2})-(\d{2})$/.exec(asStr(a.birthday)?.trim() ?? '');
        const ok = m && new Date(2000, +m[1]! - 1, +m[2]!).getMonth() === +m[1]! - 1 && new Date(2000, +m[1]! - 1, +m[2]!).getDate() === +m[2]!; // 2000 is a leap year: 02-29 is valid
        if (!m || !ok) throw new MCPError("birthday must be a real date as 'MM-DD' or 'YYYY-MM-DD'");
        birthday = `${m[1]}-${m[2]}`;
      }
    }
    let archived: boolean | undefined;
    if (has('archived')) {
      archived = typeof a.archived === 'boolean' ? a.archived : undefined;
      if (archived === undefined) throw new MCPError('archived must be true or false');
    }
    const existing = this.store.person(raw, false);
    if (existing?.hiddenFromClaude) throw new MCPError(`No person with handle '${raw}'.`);
    const base = existing ?? newPerson({ handle: raw, name: nameFromHandle(raw) });
    const next: Person = {
      ...base,
      ...(name !== undefined && { name }), ...(title !== undefined && { title }), ...(relation !== undefined && { relation }),
      ...(cadence !== undefined && { cadenceDays: cadence }), ...(emails !== undefined && { matchEmails: emails }),
      ...(start !== undefined && { startDate: start }), ...(birthday !== undefined && { birthday }), ...(archived !== undefined && { archived }),
    };
    this.store.savePerson(next);
    const summary = this.store.personSummaries(t, true).find((s) => s.person.id === next.id)!;
    return [{ ...this.personJSON(summary), created: existing === null }, `save_person: ${raw}`];
  }

  private personDetail(p: Person): J {
    const t = this.now();
    const store = this.store;
    const summary = store.personSummaries(t, true).find((s) => s.person.id === p.id)!;
    const open = store.items({ personId: p.id, includeSnoozed: true }, t);
    const said = store.items({ personId: p.id, kinds: ['said'], status: null, limit: 20 }, t);
    const inter = store.interactions(p.id);
    const share = store.settings().shareOneOnOneNotes; // off: 1:1 notes stay in the app
    const of = (...kinds: ItemKind[]): J[] => open.filter((i) => kinds.includes(i.kind)).map((i) => this.itemJSON(i));
    return {
      ...this.personJSON(summary),
      i_owe_them: of('owe'), they_owe_me: of('wait'), bring_up: of('bring'), other_open: of('task', 'note'),
      said_log: said.map((i) => this.itemJSON(i)),
      recent_interactions: inter.map((x: Interaction) => ({ at: isoString(x.occurredAt), kind: x.kind, ...(share && { notes: x.notes }) })),
    };
  }

  private prepBrief(p: Person): J {
    const full = this.personDetail(p);
    const d: J = {};
    for (const k of ['handle', 'name', 'title', 'relation', 'last_interaction', 'days_since_last_interaction', 'cadence_days', 'cadence_overdue',
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

// Source fields shared by capture, add_item and add_items: they make repeated imports safe.
const EXTERNAL_ID_HELP = 'Stable id of the thing this item came from, e.g. `outlook:<message id>`, `jira:PLAT-482:<comment id>`, `confluence:<page id>`, `teams:<message id>`. ' +
  'Unique across all items (open, done or dropped): when it already exists nothing is written and the existing item is returned with `duplicate: true`, so a repeated sweep never makes copies. Always set it when the item comes from mail, Jira, Confluence or chat.';
const SOURCE_FIELDS: J = {
  external_id: s(EXTERNAL_ID_HELP),
  source_label: s("Short name of where it came from, shown as a chip: 'outlook', 'jira', 'confluence', 'teams'"),
  source_url: s('Link back to the source (message, ticket or page URL)'),
};
const ITEM_FIELDS: J = {
  kind: { type: 'string', enum: ['owe', 'wait', 'bring', 'task', 'said', 'note'] }, title: str, person: s('Person handle'),
  due: s("ISO date/time, or a phrase like 'fri' or 'tomorrow 9:00'"), remind_at: s('ISO date/time'), tags: { type: 'array', items: str },
  quote: s('Exact words (for said)'), body: str,
};

const TOOL_DEFS: J[] = [
  tool('capture', 'Add an item from one line using Jaffloop capture syntax, e.g. `owe @sara review RFC fri`, `wait @amir API spec mon 10:00`, `said @sara "quote"`, `todo prepare plan thu #planning !`. Pass external_id when the line comes from an email, ticket or page so a repeat is skipped.', { text: s('The capture line'), ...SOURCE_FIELDS }, ['text']),
  tool('add_item', 'Add an item with explicit fields. Pass external_id (e.g. `outlook:<message id>`, `jira:PLAT-482:<comment id>`) when it comes from another system: if that id is already in Jaffloop, even on a done or dropped item, nothing is written and the response is `{ "duplicate": true, "id", "item" }`.', { ...ITEM_FIELDS, ...SOURCE_FIELDS }, ['kind', 'title']),
  tool('add_items', `Add up to ${MAX_BULK_ITEMS} items in one call (same fields as add_item per entry). Use it for sweeps of mail, Jira or notes, with an external_id on every entry (e.g. \`outlook:<message id>\`, \`jira:PLAT-482:<comment id>\`): ids that already exist, or repeat inside the call, are skipped, never reopened. Returns { created, duplicates, errors, results: [{ index, status: created | duplicate | error, id?, error? }] }; one bad entry does not stop the others.`, { items: { type: 'array', maxItems: MAX_BULK_ITEMS, items: { type: 'object', properties: { ...ITEM_FIELDS, ...SOURCE_FIELDS }, required: ['kind', 'title'] } } }, ['items']),
  tool('list_items', 'Query items. Defaults to open items. With external_id it finds the item with that source id in any status (unless status is given), to check whether something was already imported.', { kind: str, person: s('Person handle'), status: s('open | done | dropped | any'), due_before: s('ISO date/time'), overdue: { type: 'boolean' }, stale_days: { type: 'integer', description: 'Not touched for N days' }, limit: { type: 'integer' }, external_id: s('Exact source id, e.g. outlook:<message id>') }),
  tool('get_person', "One person's profile, open items both ways, said log and recent interactions.", { handle: s('Person handle') }, ['handle']),
  tool('list_people', 'All people with cadence status.', { include_archived: { type: 'boolean' } }),
  tool('complete_item', 'Mark an item done. Recurring items create their next occurrence.', { id: str }, ['id']),
  tool('snooze_item', 'Hide an item until a time.', { id: str, until: s("ISO date/time or phrase like 'tomorrow 9:00'") }, ['id', 'until']),
  tool('update_item', 'Change fields on an item (title, body, quote, kind, status, pinned, person, due, remind_at, tags).', { id: str, fields: { type: 'object' } }, ['id', 'fields']),
  tool('log_interaction', 'Record a 1:1 or meeting with a person. Optional action_items (up to 100, same fields as add_item incl. external_id) are created and linked to this interaction, so they show in the 1:1 history; person defaults to this person, duplicates by external_id are skipped.', { person: s('Person handle'), kind: { type: 'string', enum: ['1on1', 'meeting', 'chat', 'other'] }, notes: str, occurred_at: s('ISO date/time, defaults to now'), action_items: { type: 'array', maxItems: MAX_BULK_ITEMS, items: { type: 'object', properties: { ...ITEM_FIELDS, ...SOURCE_FIELDS }, required: ['kind', 'title'] } } }, ['person']),
  tool('save_person', 'Create or update a person by handle; only the fields you pass are changed. Use it to set up or correct people (for example from the org chart or your calendar): call list_people first so you do not overwrite what the user already entered, and never invent birthdays or start dates. Notes and the hidden-from-Claude flag cannot be written. Returns the person as list_people shows them plus `created`.', { handle: s("Person handle, e.g. 'sara' or 'sara.lee' (lowercase letters, digits, . _ -)"), name: s('Full name; a new person without one gets a name made from the handle'), title: s("Position, e.g. 'Staff engineer'; empty string clears it"), relation: { type: 'string', enum: ['report', 'peer', 'manager', 'stakeholder', 'other'] }, cadence_days: { type: ['integer', 'null'], minimum: 0, maximum: 90, description: 'Days between 1:1s (1-90); null or 0 clears it' }, match_emails: s('Work email addresses, comma separated; used to match meeting invites'), start_date: s("Start date 'YYYY-MM-DD' (private: never shown back)"), birthday: s("'MM-DD' or 'YYYY-MM-DD' (private: never shown back)"), archived: { type: 'boolean' } }, ['handle']),
  tool('search', 'Full-text search over titles, bodies and quotes.', { query: str, filters: { type: 'object', properties: { kind: str, person: str, before: str, status: str } } }, ['query']),
  tool('prep_brief', 'Structured data to prepare a conversation: open items both ways, talking points, recent said entries, cadence.', { person: s('Person handle') }, ['person']),
  tool('week_summary', 'Created, completed, slipped and stale items for a range (defaults to the last 7 days).', { from: s('ISO date'), to: s('ISO date') }),
  tool('list_prompts', 'List the prompt ids and titles that exist: built-in ones and custom ones (with whether the user approved them). Call it before save_prompt so you do not reuse an id.', {}),
  tool('save_prompt', 'Save a reusable prompt for the user. It is NOT usable until the user approves it in Jaffloop (Settings, Claude (MCP)); you cannot approve or delete prompts. Saving an existing custom id replaces it and needs approval again. Use {{name}} placeholders in text for anything that changes between runs and declare each as an argument.', { id: s('Lower case letters, digits and dashes (2-40 characters); not the id of a built-in prompt'), title: s('1-80 characters'), description: s('One sentence, at most 300 characters'), text: s('The prompt, 20-8000 characters; {{name}} placeholders must be declared in arguments'), needs: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 40 }, description: "Connectors it needs, e.g. 'Outlook mail'" }, arguments: { type: 'array', maxItems: 8, items: { type: 'object', properties: { name: s('lower case letters, digits, _; starts with a letter'), description: str, required: { type: 'boolean' }, default: str }, required: ['name', 'description'] } } }, ['id', 'title', 'description', 'text']),
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
