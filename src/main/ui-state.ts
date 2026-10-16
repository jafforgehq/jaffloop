// Persisted interface preferences (<userData>/ui-state.json). Pure helpers first, the store class last.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { THEMES } from '../shared/themes-meta';
import type { AccentChoice, AppearanceChoice, Density, PeopleLayout, PeopleSort, TodayGroup, UiState } from '../shared/api';

export const DEFAULT_UI: UiState = {
  density: 'comfortable', appearance: 'system', accent: 'graphite', pinnedPeople: [], collapsed: [], pinOrder: [], savedFilters: [],
  lastNav: 'today', sidebarHidden: false, todayGroup: 'section', todayFocus: false, peopleLayout: 'list', peopleSort: 'name',
  soundSave: 'Tink', soundComplete: 'Glass', soundUndo: 'Pop', welcomeSeen: false, lastSeenVersion: null, autoUpdateCheck: true,
  dismissedCheckIns: { day: '', ids: [] },
  trayText: 'count', pauseUntil: null, wrapupDay: '', burstDay: '', showDates: true, theme: 'classic',
};

const ENUMS: Partial<Record<keyof UiState, readonly string[]>> = {
  density: ['compact', 'comfortable', 'spacious'] satisfies Density[],
  appearance: ['system', 'light', 'dark'] satisfies AppearanceChoice[],
  accent: ['graphite', 'blue', 'green', 'violet', 'amber'] satisfies AccentChoice[],
  todayGroup: ['section', 'person', 'kind'] satisfies TodayGroup[],
  peopleLayout: ['list', 'grid'] satisfies PeopleLayout[],
  peopleSort: ['name', 'urgency', 'last'] satisfies PeopleSort[],
  trayText: ['count', 'next'] satisfies Array<UiState['trayText']>,
  theme: THEMES.map((t) => t.id),
};

/** nativeTheme.themeSource for the saved preferences: a fixed light or dark theme decides, Classic follows the Appearance choice. */
export function themeSource(u: Pick<UiState, 'theme' | 'appearance'>): AppearanceChoice {
  const mode = THEMES.find((t) => t.id === u.theme)?.mode;
  return mode === 'dark' || mode === 'light' ? mode : u.appearance;
}

const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

/** Keeps only known keys whose value has the right shape; everything else is dropped (a hand-edited or old file must not break the app). */
export function sanitizeUi(raw: unknown): Partial<UiState> {
  const out: Record<string, unknown> = {};
  if (!raw || typeof raw !== 'object') return out as Partial<UiState>;
  const r = raw as Record<string, unknown>;
  for (const k of Object.keys(DEFAULT_UI) as Array<keyof UiState>) {
    const v = r[k];
    const d = DEFAULT_UI[k];
    if (v === undefined) continue;
    const allowed = ENUMS[k];
    if (allowed) { if (typeof v === 'string' && allowed.includes(v)) out[k] = v; continue; }
    if (k === 'pauseUntil') { if (v === null || (typeof v === 'number' && Number.isFinite(v))) out[k] = v; continue; }
    if (k === 'lastSeenVersion') { if (v === null || typeof v === 'string') out[k] = v; continue; }
    if (k === 'dismissedCheckIns') {
      const x = v as { day?: unknown; ids?: unknown };
      if (x && typeof x.day === 'string' && strings(x.ids)) out[k] = { day: x.day, ids: x.ids };
      continue;
    }
    if (Array.isArray(d)) { if (strings(v)) out[k] = v; continue; }
    if (typeof v === typeof d) out[k] = v;
  }
  return out as Partial<UiState>;
}

/** Maps the Swift app's UserDefaults (as JSON) to UiState. autoUpdateCheck is deliberately not imported: it stays on. */
export function legacyToUi(prefs: Record<string, unknown>): Partial<UiState> {
  const m: Record<string, unknown> = {
    density: prefs.density, appearance: prefs.appearance, accent: prefs.accent, pinnedPeople: prefs.pinnedPeople,
    collapsed: prefs.collapsedSections, pinOrder: prefs.pinOrder, savedFilters: prefs.savedFilters, sidebarHidden: prefs.sidebarHidden === 1 ? true : prefs.sidebarHidden,
    lastNav: prefs.lastNav, soundSave: prefs.soundSave, soundComplete: prefs.soundComplete, soundUndo: prefs.soundUndo,
    todayGroup: prefs.todayGroup, todayFocus: prefs.todayFocus, peopleLayout: prefs.peopleLayout, peopleSort: prefs.peopleSort,
    welcomeSeen: prefs.welcomeSeen,
  };
  for (const k of Object.keys(m)) if (m[k] === undefined) delete m[k];
  // plutil prints booleans as true/false; make sure 0/1 from odd writers are booleans too
  for (const k of ['sidebarHidden', 'todayFocus', 'welcomeSeen']) if (m[k] === 0 || m[k] === 1) m[k] = m[k] === 1;
  return sanitizeUi(m);
}

export const LEGACY_PLIST = path.join(os.homedir(), 'Library', 'Preferences', 'com.jafforge.jaffloop.plist');

/** `plutil -convert json -o - <plist>`; resolves to null on any problem. */
export function readLegacyPrefs(plist = LEGACY_PLIST): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    if (!fs.existsSync(plist)) return resolve(null);
    execFile('/usr/bin/plutil', ['-convert', 'json', '-o', '-', plist], { timeout: 5000, maxBuffer: 1 << 20 }, (err, stdout) => {
      if (err) return resolve(null);
      try { const j = JSON.parse(stdout); resolve(j && typeof j === 'object' ? j : null); } catch { resolve(null); }
    });
  });
}

export function writeJsonAtomic(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

export function readJson<T>(file: string, fallback: T): T {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as T; } catch { return fallback; }
}

export class UiStateStore {
  private state: UiState = { ...DEFAULT_UI, dismissedCheckIns: { day: '', ids: [] } };
  /** called after every change (broadcast, appearance) */
  onChange: (s: UiState, patch: Partial<UiState>) => void = () => undefined;

  constructor(private file: string) {}

  /** Loads the file; on the very first run (no file) imports the Swift app's preferences when `legacy` is given. */
  async load(legacy?: () => Promise<Record<string, unknown> | null>): Promise<UiState> {
    const exists = fs.existsSync(this.file);
    if (exists) this.state = { ...this.state, ...sanitizeUi(readJson<unknown>(this.file, null)) };
    else if (legacy) {
      try {
        const prefs = await legacy();
        if (prefs) {
          this.state = { ...this.state, ...legacyToUi(prefs) };
          this.save();
        }
      } catch { /* ignore */ }
    }
    return this.get();
  }

  get(): UiState {
    return { ...this.state, dismissedCheckIns: { ...this.state.dismissedCheckIns, ids: [...this.state.dismissedCheckIns.ids] } };
  }

  set(patch: Partial<UiState>): UiState {
    const clean = sanitizeUi(patch);
    this.state = { ...this.state, ...clean };
    try { this.save(); } catch { /* disk full or read-only: keep running with the in-memory state */ }
    this.onChange(this.get(), clean);
    return this.get();
  }

  private save(): void { writeJsonAtomic(this.file, this.state); }
}
