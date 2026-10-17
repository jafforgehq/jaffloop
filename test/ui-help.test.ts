// The help registry (src/renderer/help.ts): every entry is usable as a tooltip and every entry is wired to a screen.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { HELP, HELP_NAME, tip } from '../src/renderer/help';

const ROOT = path.resolve(__dirname, '..', 'src', 'renderer');
const sources = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  return e.isDirectory() ? sources(p) : /\.tsx?$/.test(e.name) && e.name !== 'help.ts' ? [fs.readFileSync(p, 'utf8')] : [];
});

describe('help registry', () => {
  const ids = Object.keys(HELP);

  it('has a name and a text for every id', () => {
    expect(ids.length).toBeGreaterThan(100);
    expect(Object.keys(HELP_NAME).sort()).toEqual([...ids].sort());
  });

  it('keeps every text non-empty and at most 220 characters', () => {
    for (const id of ids) {
      expect(HELP[id]!.trim(), id).not.toBe('');
      expect(HELP[id]!.length, `${id} is ${HELP[id]!.length} characters`).toBeLessThanOrEqual(220);
      expect(HELP_NAME[id]!.trim(), id).not.toBe('');
    }
  });

  it('never repeats its label and never repeats another text', () => {
    const seen = new Map<string, string>();
    for (const id of ids) {
      const text = HELP[id]!.toLowerCase().replace(/[.!\s]+$/, '');
      expect(text, `${id} only repeats its label`).not.toBe(HELP_NAME[id]!.toLowerCase());
      expect(seen.get(text), `${id} has the same text as ${seen.get(text)}`).toBeUndefined();
      seen.set(text, id);
    }
  });

  it('writes plain sentences: ends with a full stop, no markup', () => {
    for (const id of ids) {
      expect(HELP[id], id).toMatch(/[.?]$/);
      expect(HELP[id], id).not.toMatch(/[<>]/);
    }
  });

  it('tip() returns the text', () => {
    expect(tip('today.focus')).toBe(HELP['today.focus']);
  });

  it('is used: every id is referenced by a component', () => {
    const code = sources(ROOT).join('\n');
    const unused = ids.filter((id) => !code.includes(`'${id}'`) && !code.includes(`"${id}"`));
    expect(unused).toEqual([]);
  });
});
