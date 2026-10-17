// Pure helpers for Settings → Claude (MCP): kept out of the components so test/ui-claude-tab.test.ts can run them in Node.
import type { CustomPrompt, CustomPromptInput, PromptArg, Schedule, SyncHealthRow } from '../../../shared/types';
import { PROMPTS, renderPrompt, type JaffloopPrompt } from '../../../shared/prompts';
import { validateCustomPrompt } from '../../../shared/prompt-validate';

/** From a disk image or a quarantined download the app path changes, and Claude loses the connection after a restart. */
export const unstableInstall = (binary: string): boolean => binary.includes('AppTranslocation') || binary.startsWith('/Volumes/');

/** "never", "just now", "12 min ago", "2 h ago", "3 d ago" */
export function ageLabel(at: number | null, now: number): string {
  if (at == null) return 'never';
  const min = Math.max(0, Math.floor((now - at) / 60_000));
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
}

/** A source with nothing imported in the last 7 days. */
export const isQuiet = (r: SyncHealthRow): boolean => r.last7Days === 0;

// ---- prompts

export const builtinIds = (): string[] => PROMPTS.map((p) => p.id);

/** A custom prompt in the shape renderPrompt wants. */
export const asPrompt = (c: CustomPrompt | CustomPromptInput): JaffloopPrompt => ({
  id: c.id, title: c.title, description: c.description, needs: c.needs, arguments: c.arguments, text: c.text,
});

/** The text that goes to the clipboard for "Make a prompt". */
export function makePromptInstruction(request: string): string {
  const p = PROMPTS.find((x) => x.id === 'make-prompt')!;
  return renderPrompt(p, { request: request.trim() });
}

/** The edit form keeps everything as text. */
export interface ArgDraft { name: string; description: string; required: boolean; default: string }
export interface PromptDraft { id: string; title: string; description: string; needs: string; args: ArgDraft[]; text: string }

export const emptyDraft = (): PromptDraft => ({ id: '', title: '', description: '', needs: '', args: [], text: '' });
export const emptyArg = (): ArgDraft => ({ name: '', description: '', required: false, default: '' });

export const toDraft = (c: CustomPrompt): PromptDraft => ({
  id: c.id, title: c.title, description: c.description, needs: c.needs.join(', '), text: c.text,
  args: c.arguments.map((a) => ({ name: a.name, description: a.description, required: a.required, default: a.default ?? '' })),
});

export function toInput(d: PromptDraft): CustomPromptInput {
  const args: PromptArg[] = d.args.map((a) => {
    const out: PromptArg = { name: a.name.trim(), description: a.description.trim(), required: a.required };
    if (a.default.trim()) out.default = a.default.trim();
    return out;
  });
  return { id: d.id.trim(), title: d.title.trim(), description: d.description.trim(), needs: d.needs.split(',').map((n) => n.trim()).filter(Boolean), arguments: args, text: d.text.trim() };
}

/** "Monday sweep" -> "monday-sweep": a starting point for the id of a new prompt. */
export const slugify = (title: string): string => title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

/** Live validation: the shared rules, plus "this id is taken" for a new prompt. null = fine. */
export function draftError(d: PromptDraft, isNew: boolean, existingIds: string[]): string | null {
  const input = toInput(d);
  if (isNew && existingIds.includes(input.id)) return `id '${input.id}' is already used by another prompt`;
  return validateCustomPrompt(input, builtinIds());
}

// ---- schedule

/** Mon-Sun in the order people read them; the value is the launchd weekday (0 = Sunday). */
export const WEEKDAYS: Array<{ value: number; label: string }> = [
  { value: 1, label: 'Mon' }, { value: 2, label: 'Tue' }, { value: 3, label: 'Wed' }, { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' }, { value: 6, label: 'Sat' }, { value: 0, label: 'Sun' },
];
export const DEFAULT_WEEKDAYS = [1, 2, 3, 4, 5];

export interface Schedulable { id: string; title: string; arguments: JaffloopPrompt['arguments']; prompt: JaffloopPrompt }
/** Built-ins marked schedulable and approved custom prompts. */
export function schedulable(custom: CustomPrompt[]): Schedulable[] {
  const all: JaffloopPrompt[] = [...PROMPTS.filter((p) => p.schedulable), ...custom.filter((c) => c.approved).map(asPrompt)];
  return all.map((p) => ({ id: p.id, title: p.title, arguments: p.arguments, prompt: p }));
}

export const hhmm = (h: number, m: number): string => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
/** "08:30" -> [8, 30]; null when it is not a time. */
export function parseTime(v: string): [number, number] | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v);
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  return h <= 23 && min <= 59 ? [h, min] : null;
}

/** "Mon-Fri at 08:30", "Every day at 07:00", "Mon, Wed at 09:15" */
export function whenLabel(s: Pick<Schedule, 'hour' | 'minute' | 'weekdays'>): string {
  const days = [...new Set(s.weekdays)];
  const time = hhmm(s.hour, s.minute);
  if (days.length === 0 || days.length === 7) return `Every day at ${time}`;
  const ordered = WEEKDAYS.filter((d) => days.includes(d.value));
  const weekdays = [1, 2, 3, 4, 5];
  if (ordered.length === 5 && weekdays.every((d) => days.includes(d))) return `Mon-Fri at ${time}`;
  return `${ordered.map((d) => d.label).join(', ')} at ${time}`;
}

/** Required arguments the user left empty. */
export const missingRequired = (args: JaffloopPrompt['arguments'], values: Record<string, string>): string[] =>
  args.filter((a) => a.required && !values[a.name]?.trim()).map((a) => a.name);

/** Only the argument values that were typed. */
export function setArgs(values: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) if (v.trim()) out[k] = v.trim();
  return out;
}
