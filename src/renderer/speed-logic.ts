// Pure logic behind the 0.2.0 speed features (ambient capture context, people palette, Today filter, templates, nudge, burst).
// No DOM, no signals, no core imports: everything the views need is passed in, so it is unit tested in test/ui-speed.test.ts.
import type { CaptureTemplate, Item, Person, PersonSummary, TodaySections } from '../shared/types';

export interface PresetLike { label: string; date: number }

export const localDay = (ms: number): string => {
  const d = new Date(ms), p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const at9 = (ms: number, addDays = 0): number => { const d = new Date(ms); d.setDate(d.getDate() + addDays); d.setHours(9, 0, 0, 0); return d.getTime(); };
export const tomorrowAt9 = (now: number): number => at9(now, 1);

/** "last 1:1 3 days ago", "last 1:1 today", "last 1:1 never" */
export function lastOneOnOne(days: number | null): string {
  if (days == null) return 'last 1:1 never';
  if (days <= 0) return 'last 1:1 today';
  return days === 1 ? 'last 1:1 yesterday' : `last 1:1 ${days} days ago`;
}

export const firstName = (name: string): string => name.trim().split(/\s+/)[0] ?? name;

// ---------------------------------------------------------------- 10 ambient context

export interface Ambient { notes: string; owes: Item[]; last: string }

/** The one-line context under the capture field: notes snippet (80 chars), up to 2 open owes by due date, last 1:1. Null when the person is unknown (the last 1:1 line is always there, "never" included). */
export function ambientContext(s: PersonSummary | undefined, open: Item[]): Ambient | null {
  if (!s) return null;
  const flat = s.person.notes.replace(/\s+/g, ' ').trim();
  const notes = flat.length > 80 ? `${flat.slice(0, 79)}…` : flat;
  const owes = open.filter((i) => i.personId === s.person.id && i.kind === 'owe' && i.status === 'open')
    .sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity)).slice(0, 2);
  return { notes, owes, last: lastOneOnOne(s.daysSinceLast) };
}

// ---------------------------------------------------------------- 11 snooze until the next 1:1

/** "Until next 1:1 with Sara (Fri 23 Oct)" at 09:00 on the day `next` gives; null without a cadence or when that moment has passed. */
export function nextOneOnOnePreset(
  p: Pick<Person, 'name' | 'cadenceDays'> | undefined, lastInteraction: number | null, now: number,
  next: (cadenceDays: number | null, last: number | null, now: number) => number | null, dayLabel: (ms: number) => string,
): PresetLike | null {
  if (!p || p.cadenceDays == null) return null;
  const day = next(p.cadenceDays, lastInteraction, now);
  if (day == null) return null;
  const date = at9(day);
  if (date <= now) return null;
  return { label: `Until next 1:1 with ${firstName(p.name)} (${dayLabel(date)})`, date };
}

// ---------------------------------------------------------------- 12 people palette

/** Active people matching `query` (contains, on name or handle), most recently captured-for first. */
export function matchPeople(summaries: PersonSummary[], recent: Person[], query: string): PersonSummary[] {
  const q = query.trim().toLowerCase().replace(/@/g, '');
  const rank = new Map(recent.map((p, i) => [p.id, i]));
  return summaries
    .filter((s) => !s.person.archived && (!q || s.person.name.toLowerCase().includes(q) || s.person.handle.toLowerCase().includes(q) || s.person.title.toLowerCase().includes(q)))
    .sort((a, b) => (rank.get(a.person.id) ?? 1e9) - (rank.get(b.person.id) ?? 1e9));
}

// ---------------------------------------------------------------- 13 Today person filter

/** Keeps only one person's items (and check-in) in every Today section. */
export function filterToday(t: TodaySections, personId: string | null): TodaySections {
  if (!personId) return t;
  const keep = (xs: Item[]) => xs.filter((i) => i.personId === personId);
  return {
    slipping: keep(t.slipping), overdue: keep(t.overdue), today: keep(t.today), waitingStale: keep(t.waitingStale), inbox: keep(t.inbox),
    checkIn: t.checkIn.filter((s) => s.person.id === personId),
  };
}

// ---------------------------------------------------------------- 14 capture templates

export interface TemplateDraft { name: string; text: string }

/** An error message, or null when `name` is a usable trigger word. `others` are the other templates' names; `isPrefix` says whether a word is a built-in kind prefix. */
export function validateTemplateName(name: string, others: string[], isPrefix: (w: string) => boolean): string | null {
  if (!name) return 'Give the template a name.';
  if (/\s/.test(name)) return 'No spaces in the name.';
  if (name !== name.toLowerCase()) return 'Use lower case.';
  if (isPrefix(name)) return `"${name}" is already a capture keyword.`;
  if (others.includes(name)) return 'Another template already has this name.';
  return null;
}

export const templateLines = (text: string): string[] => text.split('\n').map((l) => l.trim()).filter(Boolean);
export const toDraft = (t: CaptureTemplate): TemplateDraft => ({ name: t.name, text: t.lines.join('\n') });

/** The templates that can be saved: valid name and at least one line. */
export function savableTemplates(drafts: TemplateDraft[], isPrefix: (w: string) => boolean): CaptureTemplate[] {
  return drafts.flatMap((d, i) => {
    const others = drafts.filter((_, j) => j !== i).map((x) => x.name);
    const lines = templateLines(d.text);
    return validateTemplateName(d.name, others, isPrefix) == null && lines.length ? [{ name: d.name, lines }] : [];
  });
}

// ---------------------------------------------------------------- 15 nudge

export const nudgeText = (name: string, title: string): string => `Hi ${firstName(name)}, quick check-in on ${title}. Any update?`;

// ---------------------------------------------------------------- 16 Jira base

/** Trimmed base URL with a trailing slash, '' to clear, null when it is not an http(s) URL. */
export function normalizeJiraBase(v: string): string | null {
  const t = v.trim();
  if (!t) return '';
  if (!/^https?:\/\/[^\s/]+/i.test(t)) return null;
  return /[/=]$/.test(t) ? t : `${t}/`;
}

// ---------------------------------------------------------------- 18 pause

/** "14:30", or "Fri 09:00" when it is not today. `fmt` is Fmt.short. */
export function pausedUntilLabel(until: number, now: number, fmt: (ms: number, pattern: string) => string): string {
  return localDay(until) === localDay(now) ? fmt(until, 'HH:mm') : fmt(until, 'EEE HH:mm');
}

// ---------------------------------------------------------------- 20 burst

/** The ring burst plays when the urgent sections go from non-empty to empty, once a day. `prev` is null before anything was seen. */
export const shouldBurst = (prev: number | null, count: number, burstDay: string, today: string): boolean =>
  prev != null && prev > 0 && count === 0 && burstDay !== today;

export const urgentCount = (t: TodaySections): number => t.overdue.length + t.slipping.length + t.inbox.length;

/** Offsets (px) of the dots flying out of the ring: evenly spaced, with a little variation in distance. */
export function burstDots(n = 14, base = 74): Array<{ dx: number; dy: number; delay: number }> {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 + 0.2, r = base + (i % 3) * 14;
    return { dx: Math.round(Math.cos(a) * r), dy: Math.round(Math.sin(a) * r), delay: (i % 4) * 25 };
  });
}
