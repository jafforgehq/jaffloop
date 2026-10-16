import { describe, expect, it } from 'vitest';
import { agoLabel, argumentHint, captureLine, loggedToast, needsConfirm, statusLabel } from '../src/renderer/oneonone-logic';
import { PROMPTS, renderPrompt } from '../src/shared/prompts';

const isPrefix = (w: string) => ['owe', 'wait', 'bring', 'said', 'todo'].includes(w);

describe('captureLine', () => {
  it('puts the handle after a kind prefix', () => {
    expect(captureLine('sara', 'owe review RFC fri', isPrefix)).toBe('owe @sara review RFC fri');
    expect(captureLine('sara', 'WAIT the doc', isPrefix)).toBe('wait @sara the doc');
  });
  it('prefixes plain text and ignores a lone prefix word or empty text', () => {
    expect(captureLine('sara', 'career goals', isPrefix)).toBe('@sara career goals');
    expect(captureLine('sara', 'owe', isPrefix)).toBe('@sara owe');
    expect(captureLine('sara', '   ', isPrefix)).toBeNull();
  });
});

describe('agoLabel', () => {
  const now = new Date(2026, 9, 16, 15, 0).getTime();
  const ago = (d: number) => new Date(2026, 9, 16 - d, 9, 0).getTime();
  it('counts calendar days, then weeks, months and years', () => {
    expect(agoLabel(ago(0), now)).toBe('today');
    expect(agoLabel(now + 3_600_000, now)).toBe('today');
    expect(agoLabel(ago(1), now)).toBe('yesterday');
    expect(agoLabel(ago(5), now)).toBe('5 days ago');
    expect(agoLabel(ago(21), now)).toBe('3 weeks ago');
    expect(agoLabel(ago(75), now)).toBe('2 months ago');
    expect(agoLabel(ago(400), now)).toBe('1 year ago');
  });
});

describe('toast and cancel', () => {
  it('pluralises', () => {
    expect(loggedToast(0)).toBe('1:1 logged with 0 action items');
    expect(loggedToast(1)).toBe('1:1 logged with 1 action item');
    expect(loggedToast(2)).toBe('1:1 logged with 2 action items');
  });
  it('confirms a cancel only when something would be lost', () => {
    expect(needsConfirm('', 0)).toBe(false);
    expect(needsConfirm('  \n', 0)).toBe(false);
    expect(needsConfirm('talked about goals', 0)).toBe(true);
    expect(needsConfirm('', 2)).toBe(true);
  });
  it('labels statuses', () => { expect(['open', 'done', 'dropped'].map((s) => statusLabel(s as 'open'))).toEqual(['Open', 'Done', 'Dropped']); });
});

describe('prompt cards', () => {
  it('has ten prompts and shows argument hints', () => {
    expect(PROMPTS).toHaveLength(10);
    const sweep = PROMPTS.find((p) => p.id === 'monday-sweep')!;
    expect(argumentHint(sweep.arguments[0]!)).toBe('since: last Friday (optional)');
    const notes = PROMPTS.find((p) => p.id === 'meeting-notes')!;
    expect(argumentHint(notes.arguments[0]!)).toContain('(required)');
    expect(renderPrompt(sweep, {})).toContain('from last Friday until now');
    expect(renderPrompt(notes, {})).toContain('{{notes}}');
  });
});
