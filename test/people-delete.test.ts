import { describe, expect, it } from 'vitest';
import { openMemoryDatabase } from '../src/core/db';
import { Store } from '../src/core/store';

const NOW = Date.UTC(2026, 9, 21, 9);

describe('deletePerson', () => {
  it('removes the person and their 1:1s, keeps their items unassigned, sends dateless open ones to the Inbox', () => {
    const s = new Store(openMemoryDatabase());
    const sara = s.person('sara')!, amir = s.person('amir')!;
    s.logInteraction(sara.id, '1on1', 'notes', NOW);
    s.logInteraction(amir.id, '1on1', 'other notes', NOW);
    const dateless = s.capture('owe @sara review RFC', 'hotkey', NOW);
    const dated = s.capture('owe @sara send draft fri', 'hotkey', NOW);
    const done = s.capture('owe @sara old thing', 'hotkey', NOW);
    s.complete(done.id, NOW);
    const other = s.capture('owe @amir keep me', 'hotkey', NOW);

    expect(s.deletePerson(sara.id)).toBe(true);

    expect(s.personById(sara.id)).toBeNull();
    expect(s.interactions(sara.id, 10)).toHaveLength(0);
    expect(s.interactions(amir.id, 10)).toHaveLength(1);
    expect(s.item(dateless.id)).toMatchObject({ personId: null, inbox: true, status: 'open' });
    expect(s.item(dated.id)).toMatchObject({ personId: null, inbox: false, status: 'open' });
    expect(s.item(done.id)).toMatchObject({ personId: null, status: 'done' });
    expect(s.item(other.id)!.personId).toBe(amir.id);
    expect(s.deletePerson(sara.id)).toBe(false);
  });

  it('shows archived people in the snapshot, not in the summaries', () => {
    const s = new Store(openMemoryDatabase());
    const p = s.person('maya')!;
    s.savePerson({ ...p, archived: true });
    const snap = s.snapshot(NOW);
    expect(snap.summaries.map((x) => x.person.id)).not.toContain(p.id);
    expect(snap.archivedPeople.map((x) => x.id)).toEqual([p.id]);
  });
});
