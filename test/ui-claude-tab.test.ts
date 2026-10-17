import { describe, expect, it } from 'vitest';
import { ageLabel, asPrompt, draftError, emptyDraft, isQuiet, makePromptInstruction, missingRequired, parseTime, schedulable, setArgs, slugify, toDraft, toInput, unstableInstall, whenLabel } from '../src/renderer/windows/claude-tab/logic';
import { PROMPTS } from '../src/shared/prompts';
import { sweepCommand } from '../src/shared/schedule';
import type { CustomPrompt } from '../src/shared/types';

const custom = (o: Partial<CustomPrompt> = {}): CustomPrompt => ({
  id: 'teams-weekend', title: 'Teams weekend', description: 'd', needs: ['Teams'], arguments: [{ name: 'since', description: 'from', required: false, default: 'friday' }],
  text: 'Read my Teams chats since {{since}} and add promises.', approved: true, source: 'mcp', createdAt: 1, updatedAt: 1, ...o,
});

describe('unstableInstall', () => {
  it('flags translocated and mounted-image paths only', () => {
    expect(unstableInstall('/private/var/folders/x/AppTranslocation/ABC/d/Jaffloop.app/Contents/MacOS/Jaffloop')).toBe(true);
    expect(unstableInstall('/Volumes/Jaffloop/Jaffloop.app/Contents/MacOS/Jaffloop')).toBe(true);
    expect(unstableInstall('/Applications/Jaffloop.app/Contents/MacOS/Jaffloop')).toBe(false);
    expect(unstableInstall('')).toBe(false);
  });
});

describe('sync health labels', () => {
  const now = 10_000_000_000;
  it('ageLabel', () => {
    expect(ageLabel(null, now)).toBe('never');
    expect(ageLabel(now - 20_000, now)).toBe('just now');
    expect(ageLabel(now - 12 * 60_000, now)).toBe('12 min ago');
    expect(ageLabel(now - 2 * 3_600_000, now)).toBe('2 h ago');
    expect(ageLabel(now - 3 * 86_400_000, now)).toBe('3 d ago');
  });
  it('quiet means nothing in 7 days', () => {
    expect(isQuiet({ source: 'jira', total: 4, last7Days: 0, lastAt: 1 })).toBe(true);
    expect(isQuiet({ source: 'jira', total: 4, last7Days: 1, lastAt: 1 })).toBe(false);
  });
});

describe('prompt form', () => {
  const ids = ['mine'];
  const valid = () => ({ ...emptyDraft(), title: 'Weekend', id: 'weekend', text: 'Read my chats and add what I promised.' });
  it('round-trips a custom prompt through the draft', () => {
    const c = custom();
    expect(toInput(toDraft(c))).toEqual({ id: c.id, title: c.title, description: c.description, needs: c.needs, arguments: c.arguments, text: c.text });
  });
  it('splits needs on commas and drops empty defaults', () => {
    const d = { ...valid(), needs: ' Teams, Outlook mail ,', args: [{ name: 'since', description: 'from', required: true, default: ' ' }] };
    expect(toInput(d).needs).toEqual(['Teams', 'Outlook mail']);
    expect(toInput(d).arguments[0]).toEqual({ name: 'since', description: 'from', required: true });
  });
  it('validates with the shared rules and checks id clashes only for a new prompt', () => {
    expect(draftError(valid(), true, ids)).toBeNull();
    expect(draftError({ ...valid(), id: 'monday-sweep' }, true, ids)).toMatch(/built-in/);
    expect(draftError({ ...valid(), id: 'mine' }, true, ids)).toMatch(/already used/);
    expect(draftError({ ...valid(), id: 'mine' }, false, ids)).toBeNull();
    expect(draftError({ ...valid(), text: 'too short' }, true, ids)).toMatch(/text/);
    expect(draftError({ ...valid(), text: 'Read since {{since}} and add the promises.' }, true, ids)).toMatch(/since/);
  });
  it('slugifies a title for the id', () => {
    expect(slugify('Monday sweep: what I promised!')).toBe('monday-sweep-what-i-promised');
    expect(slugify('  --  ')).toBe('');
  });
});

describe('make a prompt', () => {
  it('puts the request into the make-prompt instruction', () => {
    const t = makePromptInstruction('  read my Teams chats  ');
    expect(t).toContain('What it should do: read my Teams chats');
    expect(t).toContain('save_prompt');
  });
});

describe('schedule form', () => {
  it('offers schedulable built-ins and approved custom prompts only', () => {
    const ids = schedulable([custom(), custom({ id: 'pending-one', approved: false })]).map((o) => o.id);
    expect(ids).toContain('monday-sweep');
    expect(ids).toContain('teams-weekend');
    expect(ids).not.toContain('pending-one');
    expect(ids).not.toContain('make-prompt');
    expect(ids.filter((i) => PROMPTS.some((p) => p.id === i))).toEqual(PROMPTS.filter((p) => p.schedulable).map((p) => p.id));
  });
  it('labels the time and days', () => {
    expect(whenLabel({ hour: 8, minute: 5, weekdays: [1, 2, 3, 4, 5] })).toBe('Mon-Fri at 08:05');
    expect(whenLabel({ hour: 7, minute: 0, weekdays: [] })).toBe('Every day at 07:00');
    expect(whenLabel({ hour: 7, minute: 0, weekdays: [0, 1, 2, 3, 4, 5, 6] })).toBe('Every day at 07:00');
    expect(whenLabel({ hour: 9, minute: 15, weekdays: [3, 1] })).toBe('Mon, Wed at 09:15');
    expect(whenLabel({ hour: 9, minute: 15, weekdays: [0, 6] })).toBe('Sat, Sun at 09:15');
  });
  it('parses times', () => {
    expect(parseTime('08:30')).toEqual([8, 30]);
    expect(parseTime('24:00')).toBeNull();
    expect(parseTime('')).toBeNull();
  });
  it('reports required arguments left empty and keeps typed values only', () => {
    const args = [{ name: 'a', description: '', required: true }, { name: 'b', description: '', required: false }];
    expect(missingRequired(args, { a: ' ', b: 'x' })).toEqual(['a']);
    expect(missingRequired(args, { a: 'v' })).toEqual([]);
    expect(setArgs({ a: ' v ', b: '  ' })).toEqual({ a: 'v' });
  });
  it('builds the command from the rendered prompt and the extra tools', () => {
    const cmd = sweepCommand(asPrompt(custom()).text.replace('{{since}}', 'friday'), 'mcp__teams__*, rm;-rf');
    expect(cmd.startsWith("claude -p 'Read my Teams chats since friday")).toBe(true);
    expect(cmd).toContain("--allowedTools 'mcp__jaffloop__*' 'mcp__teams__*'");
    expect(cmd).not.toContain('rm');
  });
});
