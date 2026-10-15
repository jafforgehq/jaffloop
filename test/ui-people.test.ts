import { describe, expect, it } from 'vitest';
import { highlightParts, lastOneOnOne, lastStat, saidLine, sortPeopleBy, timer } from '../src/renderer/people-logic';
import { releaseNotes, roadmap } from '../src/renderer/releases-data';
import type { PersonSummary } from '../src/shared/types';

const s = (id: string, days: number | null): PersonSummary => ({
  person: { id, handle: id, name: id, relation: 'report', cadenceDays: 14, matchEmails: '', hiddenFromClaude: false, archived: false, notes: '' },
  lastInteraction: null, openOwe: 0, openWait: 0, daysSinceLast: days, cadenceOverdue: false,
});

describe('highlightParts', () => {
  it('marks case-insensitive matches and merges overlaps', () => {
    expect(highlightParts('Review the RFC', ['rfc', 'review'])).toEqual([
      { text: 'Review', hit: true }, { text: ' the ', hit: false }, { text: 'RFC', hit: true }]);
    expect(highlightParts('abcd', ['ab', 'bc']).map((p) => p.text)).toEqual(['abc', 'd']);
  });
  it('returns the whole text without terms', () => {
    expect(highlightParts('plain', [])).toEqual([{ text: 'plain', hit: false }]);
    expect(highlightParts('', ['x'])).toEqual([{ text: '', hit: false }]);
  });
});

describe('said line', () => {
  it('replaces double quotes and trims', () => {
    expect(saidLine('sara', '  I said "ship it"  ')).toBe(`said @sara "I said 'ship it'"`);
    expect(saidLine('sara', '   ')).toBeNull();
  });
});

describe('people helpers', () => {
  it('sorts by longest since 1:1, never first', () => {
    const list = [s('a', 5), s('b', null), s('c', 20)];
    expect(sortPeopleBy('last', list, []).map((x) => x.person.id)).toEqual(['b', 'c', 'a']);
    expect(sortPeopleBy('name', list, [])).toBe(list);
    expect(list.map((x) => x.person.id)).toEqual(['a', 'b', 'c']);
  });
  it('formats labels and the timer', () => {
    expect(lastOneOnOne(null)).toBe('no 1:1 logged');
    expect(lastOneOnOne(0, true)).toBe('1:1 today');
    expect(lastOneOnOne(0)).toBe('last 1:1 0d ago');
    expect(lastStat(23)).toBe('23 days ago');
    expect(lastStat(0)).toBe('today');
    expect(timer(65)).toBe('1:05');
  });
});

describe('releases data', () => {
  it('leads with 0.1.0 and keeps the Swift history', () => {
    expect(releaseNotes.map((n) => n.version)).toEqual(['0.1.0', '0.0.4', '0.0.3', '0.0.2', '0.0.1']);
    expect(releaseNotes[0]!.title).toBe('Now built on Electron');
    expect(releaseNotes[1]!.highlights).toHaveLength(10);
    expect(roadmap.flatMap((g) => g.items).some((i) => i.includes('Today they never do'))).toBe(false);
  });
});
