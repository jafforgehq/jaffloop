import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_UI, legacyToUi, sanitizeUi, UiStateStore } from '../src/main/ui-state';

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jaffloop-ui-')), 'ui-state.json');

describe('sanitizeUi', () => {
  it('keeps valid values and drops unknown keys and wrong types', () => {
    expect(sanitizeUi({ density: 'spacious', accent: 'pink', sidebarHidden: 'yes', pinnedPeople: ['a', 'b'], collapsed: [1], extra: 1, lastSeenVersion: null, dismissedCheckIns: { day: '2026-10-14', ids: ['x'] } }))
      .toEqual({ density: 'spacious', pinnedPeople: ['a', 'b'], lastSeenVersion: null, dismissedCheckIns: { day: '2026-10-14', ids: ['x'] } });
    expect(sanitizeUi(null)).toEqual({});
    expect(sanitizeUi('x')).toEqual({});
  });
});

describe('0.2.0 fields', () => {
  it('has the defaults', () => {
    expect(DEFAULT_UI).toMatchObject({ trayText: 'count', pauseUntil: null, wrapupDay: '', burstDay: '', showDates: true });
  });
  it('accepts valid values', () => {
    const v = { trayText: 'next', pauseUntil: 1_800_000_000_000, wrapupDay: '2026-10-14', burstDay: '2026-10-13', showDates: false };
    expect(sanitizeUi(v)).toEqual(v);
    expect(sanitizeUi({ pauseUntil: null })).toEqual({ pauseUntil: null });
  });
  it('drops values of the wrong shape', () => {
    expect(sanitizeUi({ trayText: 'both', pauseUntil: '1', wrapupDay: 5, burstDay: null, showDates: 'yes' })).toEqual({});
    expect(sanitizeUi({ pauseUntil: Infinity })).toEqual({});
    expect(sanitizeUi({ pauseUntil: NaN })).toEqual({});
  });
});

describe('legacyToUi', () => {
  it('maps the Swift preferences and never imports autoUpdateCheck', () => {
    const u = legacyToUi({
      density: 'compact', appearance: 'dark', accent: 'violet', pinnedPeople: ['p1'], collapsedSections: ['today'], pinOrder: ['i1'], savedFilters: ['@sara'],
      sidebarHidden: true, lastNav: 'person:abc', autoUpdateCheck: false, soundSave: 'Pop', burstDay: '2026-10-14', 'NSWindow Frame JaffloopMain': '1 2 3 4',
    });
    expect(u).toEqual({ density: 'compact', appearance: 'dark', accent: 'violet', pinnedPeople: ['p1'], collapsed: ['today'], pinOrder: ['i1'], savedFilters: ['@sara'], sidebarHidden: true, lastNav: 'person:abc', soundSave: 'Pop' });
    expect('autoUpdateCheck' in u).toBe(false);
  });
  it('turns 0/1 booleans into booleans', () => {
    expect(legacyToUi({ sidebarHidden: 1, welcomeSeen: 0 })).toEqual({ sidebarHidden: true, welcomeSeen: false });
  });
});

describe('UiStateStore', () => {
  it('starts with the defaults (auto update on, welcome not seen)', async () => {
    const s = new UiStateStore(tmp());
    const u = await s.load();
    expect(u).toEqual(DEFAULT_UI);
    expect(u.autoUpdateCheck).toBe(true);
    expect(u.welcomeSeen).toBe(false);
  });

  it('merges patches, persists them and reports the change', async () => {
    const file = tmp();
    const s = new UiStateStore(file);
    await s.load();
    const seen: unknown[] = [];
    s.onChange = (_u, patch) => void seen.push(patch);
    const r = s.set({ density: 'compact', bogus: 1 } as never);
    expect(r.density).toBe('compact');
    expect(seen).toEqual([{ density: 'compact' }]);
    const again = new UiStateStore(file);
    expect((await again.load()).density).toBe('compact');
  });

  it('imports the Swift preferences once, on the first run only', async () => {
    const file = tmp();
    const legacy = async () => ({ density: 'spacious', autoUpdateCheck: false });
    const first = await new UiStateStore(file).load(legacy);
    expect(first.density).toBe('spacious');
    expect(first.autoUpdateCheck).toBe(true);
    const second = new UiStateStore(file);
    await second.load(async () => { throw new Error('must not be called'); });
    expect(second.get().density).toBe('spacious');
  });

  it('survives a corrupt file and a failing import', async () => {
    const file = tmp();
    fs.writeFileSync(file, '{not json');
    expect((await new UiStateStore(file).load()).density).toBe('comfortable');
    const file2 = tmp();
    expect((await new UiStateStore(file2).load(async () => { throw new Error('plutil missing'); })).density).toBe('comfortable');
  });
});
