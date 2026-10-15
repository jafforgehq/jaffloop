// Pure helpers behind the main window views (no DOM, no signals) so they can be unit tested.
// Written by ui-shell; ported from AppModel.snoozePresets, TodayView.blocks, LedgerView, InboxView.triage and ItemKeys.neighbour.
import type { Item, TodaySections } from '../shared/types';
import { ITEM_KINDS } from '../shared/types';
import type { TodayGroup } from '../shared/api';

export interface SnoozePreset { label: string; date: number }
export interface Block { id: string; title: string; tint: string; items: Item[] }

export const startOfDay = (ms: number): number => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
export const addDays = (ms: number, n: number): number => { const d = new Date(ms); d.setDate(d.getDate() + n); return d.getTime(); };
const at = (ms: number, h: number, m = 0): number => { const d = new Date(ms); d.setHours(h, m, 0, 0); return d.getTime(); };

/** The next Monday strictly after `now`, at `hour`:00 (Swift: nextDate(after:matching: hour, weekday 2)). */
export function nextMonday(now: number, hour = 0): number {
  for (let i = 0; i <= 7; i++) {
    const c = at(addDays(now, i), hour);
    if (new Date(c).getDay() === 1 && c > now) return c;
  }
  return at(addDays(now, 7), hour);
}

/** 1 hour, This afternoon (only before 14:00), Tomorrow 09:00, Next Monday. `clock` formats a time like "09:00". */
export function snoozePresets(now: number, clock: (ms: number) => string): SnoozePreset[] {
  const out: SnoozePreset[] = [{ label: '1 hour', date: now + 3_600_000 }];
  if (new Date(now).getHours() < 14) out.push({ label: 'This afternoon', date: at(now, 15) });
  const tomorrow = at(addDays(now, 1), 9);
  out.push({ label: `Tomorrow ${clock(tomorrow)}`, date: tomorrow });
  out.push({ label: 'Next Monday', date: nextMonday(now, 9) });
  return out;
}

/** Due date for the inbox triage keys: d today, t tomorrow, w next Monday. */
export function triageDue(key: string, now: number): number | undefined {
  if (key === 'd') return startOfDay(now);
  if (key === 't') return addDays(startOfDay(now), 1);
  if (key === 'w') return nextMonday(now);
  return undefined;
}

export const todayTotal = (t: TodaySections): number => t.slipping.length + t.overdue.length + t.today.length + t.waitingStale.length + t.inbox.length;

export function todayBlocks(
  t: TodaySections,
  o: { group: TodayGroup; focus: boolean; personName: (id: string) => string | undefined; order: (items: Item[]) => Item[] },
): Block[] {
  const all = [...t.slipping, ...t.overdue, ...t.today, ...t.waitingStale, ...t.inbox];
  if (o.focus) {
    const top = [...t.slipping, ...t.overdue, ...t.today.filter((i) => i.pinned), ...t.today.filter((i) => !i.pinned)];
    return [{ id: 'focus', title: 'Focus', tint: 'var(--text2)', items: top.slice(0, 3) }];
  }
  if (o.group === 'person') {
    const by = new Map<string, Item[]>();
    for (const i of all) { const k = i.personId ?? ''; by.set(k, [...(by.get(k) ?? []), i]); }
    const keys = [...by.keys()].sort((a, b) => {
      if ((a === '') !== (b === '')) return a === '' ? 1 : -1;
      return (o.personName(a) ?? '').localeCompare(o.personName(b) ?? '', undefined, { sensitivity: 'accent' });
    });
    return keys.map((k) => ({ id: `p.${k}`, title: o.personName(k) ?? 'No person', tint: 'var(--text2)', items: by.get(k)! }));
  }
  if (o.group === 'kind') {
    return ITEM_KINDS.flatMap((k) => {
      const items = all.filter((i) => i.kind === k);
      return items.length ? [{ id: `k.${k}`, title: k, tint: `var(--k-${k})`, items }] : [];
    });
  }
  return ([
    { id: 'slipping', title: 'Slipping', tint: 'var(--clay)', items: o.order(t.slipping) },
    { id: 'overdue', title: 'Overdue', tint: 'var(--clay)', items: o.order(t.overdue) },
    { id: 'today', title: 'Today', tint: 'var(--text2)', items: o.order(t.today) },
    { id: 'waiting', title: 'Waiting on', tint: 'var(--text2)', items: o.order(t.waitingStale) },
    { id: 'inbox', title: 'Inbox', tint: 'var(--text2)', items: o.order(t.inbox) },
  ] as Block[]).filter((b) => b.items.length > 0);
}

const dueKey = (i: Item): number => i.dueAt ?? Infinity;

/** Ledger: items grouped by person, groups ordered by their earliest due date, items by due date. */
export function ledgerGroups(items: Item[], overdueOnly: boolean, isOverdue: (i: Item) => boolean) {
  const kept = items.filter((i) => !overdueOnly || isOverdue(i));
  const groups = new Map<string, Item[]>();
  for (const i of kept) { const k = i.personId ?? ''; groups.set(k, [...(groups.get(k) ?? []), i]); }
  for (const [k, v] of groups) groups.set(k, [...v].sort((a, b) => dueKey(a) - dueKey(b)));
  const order = [...groups.keys()].sort((a, b) => Math.min(...groups.get(a)!.map(dueKey)) - Math.min(...groups.get(b)!.map(dueKey)) || 0);
  return { items: kept, order, groups, flat: order.flatMap((k) => groups.get(k)!) };
}

/** The id to select after `id` leaves the list: the next one, else the previous one. */
export function neighbour(id: string, ids: string[]): string | null {
  const i = ids.indexOf(id);
  if (i < 0) return null;
  return i + 1 < ids.length ? ids[i + 1]! : i > 0 ? ids[i - 1]! : null;
}

/** j/k/arrow movement: from the current id by `d`, clamped; with no selection d>0 picks the first, d<0 the last. */
export function moveSelection(cur: string | null, ids: string[], d: number): string | null {
  if (!ids.length) return cur;
  const i = cur ? ids.indexOf(cur) : -1;
  if (i >= 0) return ids[Math.max(0, Math.min(ids.length - 1, i + d))]!;
  return d > 0 ? ids[0]! : ids[ids.length - 1]!;
}
