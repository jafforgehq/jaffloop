// The menu bar text for trayText 'next': a short line about the next due open item (pure).
import type { Item } from '../shared/types';
import { dayDiff, isHidden, isOverdue, TimeFormat, fmtDue } from '../core/pure';

const MAX = 24;

/** `owe Sara · Fri`, or `owe <title>` without a person; at most 24 characters. null when nothing open has a due date. */
export function nextTrayText(items: Item[], people: ReadonlyMap<string, string>, now: number, locale?: string): string | null {
  const due = items.filter((i) => i.status === 'open' && i.dueAt !== null && !isHidden(i, now));
  if (!due.length) return null;
  const rank = (i: Item): number => (isOverdue(i, now) ? 0 : 1);
  due.sort((a, b) => rank(a) - rank(b) || a.dueAt! - b.dueAt!);
  const i = due[0]!;
  const name = i.personId ? people.get(i.personId) : undefined;
  let text: string;
  if (name) {
    // a time of day only reads well for today; otherwise the day name
    const when = i.dueHasTime && dayDiff(now, i.dueAt!) === 0 ? TimeFormat.clock(i.dueAt!, locale) : fmtDue({ dueAt: i.dueAt, dueHasTime: false }, now, locale);
    text = `${i.kind} ${name.split(/\s+/)[0]} · ${when}`;
  } else text = `${i.kind} ${i.title}`;
  return text.length > MAX ? `${text.slice(0, MAX - 1).trimEnd()}…` : text;
}
