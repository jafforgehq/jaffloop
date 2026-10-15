import { describe, expect, it } from 'vitest';
import { atQuery, completeAt, highlightSegments, hm, suggestionsFor } from '../src/renderer/windows/capture-logic';
import type { Person } from '../src/shared/types';

const P = (handle: string, name: string): Person => ({ id: handle, handle, name, relation: 'report', cadenceDays: null, matchEmails: '', hiddenFromClaude: false, archived: false, notes: '', startDate: null, birthday: null });
const people = [P('sara', 'Sara Lindqvist'), P('amir', 'Amir Haddad'), P('jonas', 'Jonas Weber'), P('maya', 'Maya Chen'), P('priya', 'Priya Nair')];

describe('highlightSegments', () => {
  it('splits around tokens and keeps every character', () => {
    const text = 'owe @sara review fri';
    const segs = highlightSegments(text, [
      { role: 'date', start: 17, end: 20, text: 'fri' },
      { role: 'kind', start: 0, end: 3, text: 'owe' },
      { role: 'person', start: 4, end: 9, text: '@sara' },
    ]);
    expect(segs.map((s) => s.text).join('')).toBe(text);
    expect(segs.filter((s) => s.role).map((s) => s.role)).toEqual(['kind', 'person', 'date']);
  });
  it('ignores bad ranges', () => expect(highlightSegments('ab', [{ role: 'tag', start: 1, end: 9, text: '' }])).toEqual([{ text: 'ab' }]));
});

describe('@ suggestions', () => {
  it('detects the token at the end only', () => {
    expect(atQuery('owe @Sa')).toBe('sa');
    expect(atQuery('owe @sa ')).toBeNull();
    expect(atQuery('owe sara')).toBeNull();
    expect(atQuery('@')).toBe('');
  });
  it('filters by handle, name prefix or second word', () => {
    expect(suggestionsFor('sa', people).map((p) => p.handle)).toEqual(['sara']);
    expect(suggestionsFor('lind', people).map((p) => p.handle)).toEqual(['sara']);
    expect(suggestionsFor('zzz', people)).toEqual([]);
    expect(suggestionsFor(null, people)).toEqual([]);
  });
  it('caps at four, empty query = recent', () => expect(suggestionsFor('', people)).toHaveLength(4));
  it('completes', () => expect(completeAt('owe @sa', people[0]!)).toBe('owe @sara '));
});

it('hm parses', () => { expect(hm('08:05')).toEqual([8, 5]); expect(hm('x')).toEqual([17, 30]); });
