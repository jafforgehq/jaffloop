import type { PromptArgument } from '../shared/prompts';

// Pure helpers for 1:1 mode and the 1:1 history (no DOM, no model): kept apart so vitest can import them.

/** "owe review RFC fri" typed on someone's page becomes "owe @handle review RFC fri"; plain text becomes "@handle text". */
export function captureLine(handle: string, text: string, isPrefix: (word: string) => boolean): string | null {
  const t = text.trim();
  if (!t) return null;
  const first = t.split(/\s+/)[0]!.toLowerCase();
  return isPrefix(first) && t.includes(' ') ? `${first} @${handle} ${t.slice(first.length).trim()}` : `@${handle} ${t}`;
}

const DAY = 86_400_000;

/** "today", "yesterday", "5 days ago", "3 weeks ago", "2 months ago", "1 year ago" (calendar days between the two local dates). */
export function agoLabel(ms: number, now: number = Date.now()): string {
  const day = (t: number) => { const d = new Date(t); return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()); };
  const days = Math.round((day(now) - day(ms)) / DAY);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  const y = Math.floor(days / 365);
  return `${y} year${y === 1 ? '' : 's'} ago`;
}

/** The toast after "End 1:1 and log it". */
export const loggedToast = (n: number): string => `1:1 logged with ${n} action item${n === 1 ? '' : 's'}`;

/** Cancelling asks first only when something would be lost. */
export const needsConfirm = (notes: string, capturedCount: number): boolean => notes.trim() !== '' || capturedCount > 0;

export type ItemStatusLabel = 'Open' | 'Done' | 'Dropped';
export const statusLabel = (s: 'open' | 'done' | 'dropped'): ItemStatusLabel => (s === 'done' ? 'Done' : s === 'dropped' ? 'Dropped' : 'Open');

/** "since: last Friday (optional)" / "notes: Paste the meeting notes (required)" */
export const argumentHint = (a: PromptArgument): string =>
  a.required ? `${a.name}: ${a.description} (required)` : `${a.name}: ${a.default ?? a.description} (optional)`;
