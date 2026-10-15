// Which notifications to show and when (pure; ported from NotificationService.schedule in Services.swift).
import type { Item, Settings } from '../shared/types';
import { addDays, atTime, fmtShort, hm, isOverdue, isStaleWait, startOfDay, weekday } from '../core/pure';

export type NotifyKind = 'reminder' | 'batch' | 'due' | 'morning' | 'stale';

export interface Planned {
  at: number;
  /** stable, so a re-plan of the same notification is recognised: item.<id>, batch.<id>, due.<n>, morning.<n>, stale.<id> */
  id: string;
  title: string;
  body: string;
  kind: NotifyKind;
  /** reminder and stale: the item it is about */
  itemId?: string;
}

export interface PlanInput {
  items: Item[];
  /** person id -> display name */
  people: ReadonlyMap<string, string>;
  settings: Settings;
  now: number;
  /** stale waiting-on items that already had their one notice */
  notified: ReadonlySet<string>;
  /** notifications are paused until this time (epoch ms); anything planned earlier is dropped */
  pausedUntil?: number | null;
}

const BATCH_MS = 10 * 60_000;
const MAX_GROUPS = 30;
const MIN_LEAD_MS = 2000;
const isWeekend = (ms: number): boolean => [1, 7].includes(weekday(ms));

/** Weekends, and outside work hours. */
export function isQuiet(ms: number, s: Pick<Settings, 'workStart' | 'workEnd'>): boolean {
  if (isWeekend(ms)) return true;
  const [sh, sm] = hm(s.workStart);
  const [eh, em] = hm(s.workEnd);
  const d = new Date(ms);
  const mins = d.getHours() * 60 + d.getMinutes();
  return mins < sh * 60 + sm || mins > eh * 60 + em;
}

/** The next weekday work start strictly after `ms` (an hour later when none is found in 8 days). */
export function nextWorkStart(ms: number, s: Pick<Settings, 'workStart'>): number {
  const [h, m] = hm(s.workStart);
  let day = startOfDay(ms);
  for (let i = 0; i < 8; i++) {
    const t = atTime(day, h, m);
    if (t > ms && !isWeekend(t)) return t;
    day = addDays(day, 1);
  }
  return ms + 3600_000;
}

const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? '' : 's'}`;

export function planNotifications(input: PlanInput): Planned[] {
  const { items, people, settings: s, now, notified } = input;
  const out: Planned[] = [];
  // never earlier than 2 s from now, like the Swift service
  const when = (at: number): number => Math.max(at, now + MIN_LEAD_MS);

  // 1. reminders and due times, batched into 10-minute windows
  const dues: Array<{ item: Item; at: number }> = [];
  for (const i of items) {
    if (i.status !== 'open') continue;
    if (i.remindAt !== null && i.remindAt > now) dues.push({ item: i, at: i.remindAt });
    else if (i.dueHasTime && i.dueAt !== null && i.dueAt > now && !isQuiet(i.dueAt, s)) dues.push({ item: i, at: i.dueAt });
  }
  dues.sort((a, b) => a.at - b.at);
  const groups: Array<typeof dues> = [];
  for (const d of dues) {
    const g = groups[groups.length - 1];
    if (g && d.at - g[0]!.at < BATCH_MS) g.push(d);
    else groups.push([d]);
  }
  for (const g of groups.slice(0, MAX_GROUPS)) {
    const first = g[0]!;
    if (g.length === 1) {
      const who = first.item.personId ? people.get(first.item.personId) : undefined;
      out.push({ at: when(first.at), id: `item.${first.item.id}`, title: first.item.title, body: who ?? '', kind: 'reminder', itemId: first.item.id });
    } else {
      out.push({ at: when(first.at), id: `batch.${first.item.id}`, title: `${g.length} things due`, body: g.slice(0, 3).map((d) => d.item.title).join(' · '), kind: 'batch' });
    }
  }

  // 2. promises due today, 16:30 on weekdays (next 7 days)
  const today = startOfDay(now);
  for (let off = 0; off < 7; off++) {
    const day = addDays(today, off);
    if (isQuiet(atTime(day, 12, 0), s)) continue;
    const at = atTime(day, 16, 30);
    if (at <= now) continue;
    const next = addDays(day, 1);
    const n = items.filter((i) => i.status === 'open' && i.kind === 'owe' && i.dueAt !== null && i.dueAt >= day && i.dueAt < next).length;
    if (n > 0) out.push({ at: when(at), id: `due.${off}`, title: `${plural(n, 'promise')} due today`, body: 'Still open.', kind: 'due' });
  }

  // 3. morning brief on weekdays
  const [mh, mm] = hm(s.morningBrief);
  const owed = items.filter((i) => i.kind === 'owe' && isOverdue(i, now)).length;
  const waits = items.filter((i) => isStaleWait(i, now, s)).length;
  for (let off = 0; off < 7; off++) {
    const day = addDays(today, off);
    if (isWeekend(day)) continue;
    const at = atTime(day, mh, mm);
    if (at <= now) continue;
    out.push({ at: when(at), id: `morning.${off}`, title: 'Morning brief', body: `${plural(owed, 'overdue promise')}, ${plural(waits, 'stale wait')}.`, kind: 'morning' });
  }

  // 4. stale waiting-on: once per item
  for (const i of items) {
    if (i.kind !== 'wait' || !isStaleWait(i, now, s) || notified.has(i.id)) continue;
    const who = (i.personId ? people.get(i.personId) : undefined)?.split(' ')[0] || 'Someone';
    let at = now + 30_000;
    if (isQuiet(at, s)) at = nextWorkStart(now, s);
    out.push({ at, id: `stale.${i.id}`, title: `${who} hasn't sent ${i.title}`, body: `Waiting since ${fmtShort(i.createdAt, 'd MMM')}.`, kind: 'stale', itemId: i.id });
  }

  const sorted = out.sort((a, b) => a.at - b.at);
  return input.pausedUntil && now < input.pausedUntil ? sorted.filter((p) => p.at >= input.pausedUntil!) : sorted;
}

/** The "Until tomorrow 09:00" choice of the tray's pause menu. */
export const tomorrowNine = (now: number): number => atTime(addDays(startOfDay(now), 1), 9, 0);
