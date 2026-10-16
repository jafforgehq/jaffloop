// The contract between the renderer (every window) and the main process.
// Renderer: `window.jaffloop.<method>(...)` (promises) and `window.jaffloop.on(event, cb)` (returns an unsubscribe fn).
// Main: `ipcMain.handle('api:<method>')` for each name in API_METHODS (src/main/ipc.ts); events go out on 'evt:<name>'.
// The preload script builds window.jaffloop from API_METHODS, so adding a method means: add it to the interface AND the list.

import type { ThemeName } from './themes-meta';
import type { ActivityEntry, HeatRow, Interaction, InteractionWithItems, InteractionKind, Item, ItemFilter, ItemSource, KeptRate, ParsedCapture, Person, ReviewData, Snapshot, UpcomingDate } from './types';

export type Density = 'compact' | 'comfortable' | 'spacious';
export type AppearanceChoice = 'system' | 'light' | 'dark';
export type AccentChoice = 'graphite' | 'blue' | 'green' | 'violet' | 'amber';
export type TodayGroup = 'section' | 'person' | 'kind';
export type PeopleLayout = 'list' | 'grid';
export type PeopleSort = 'name' | 'urgency' | 'last';

/**
 * Where you are in the main window. Stored as a string:
 * 'today' | 'ledger' | 'inbox' | 'people' | 'releases' | 'done' | 'snoozed' | 'person:<id>' | 'tag:<tag>' | 'filter:<query>'
 */
export type Nav = string;

/** Per-user interface preferences. Owned by the main process (ui-state.json), broadcast to every window on change. */
export interface UiState {
  density: Density;
  appearance: AppearanceChoice;
  accent: AccentChoice;
  pinnedPeople: string[];
  collapsed: string[];
  pinOrder: string[];
  savedFilters: string[];
  lastNav: Nav;
  sidebarHidden: boolean;
  todayGroup: TodayGroup;
  todayFocus: boolean;
  peopleLayout: PeopleLayout;
  peopleSort: PeopleSort;
  /** names of macOS system sounds ("Tink", "Glass", "Pop", ...) or "None" */
  soundSave: string;
  soundComplete: string;
  soundUndo: string;
  welcomeSeen: boolean;
  /** version whose What's new page has been seen; null until the first run records it */
  lastSeenVersion: string | null;
  /** background update checks (default on, like Jaffer); installing always asks or waits for quit */
  autoUpdateCheck: boolean;
  dismissedCheckIns: { day: string; ids: string[] };
  /** what the menu bar shows next to the icon: the overdue count, or the next item due */
  trayText: 'count' | 'next';
  /** notifications are paused until this time (epoch ms), null = not paused */
  pauseUntil: number | null;
  /** local day ('YYYY-MM-DD') the end-of-day wrap-up card was last shown or dismissed */
  wrapupDay: string;
  /** local day the ring-burst celebration last played */
  burstDay: string;
  /** show a work-anniversary / birthday reminder chip under Check in */
  showDates: boolean;
  /** colour theme; Classic follows `appearance`, the others fix light or dark (see src/shared/themes-meta.ts) */
  theme: ThemeName;
}

export type UpdateStatus = 'unavailable' | 'idle' | 'checking' | 'downloading' | 'ready' | 'uptodate' | 'error';
export interface UpdateState {
  status: UpdateStatus;
  current: string;
  version?: string;
  /** 0..100 while downloading */
  progress?: number;
  error?: string;
  /** release notes text of the available version, when known */
  notes?: string;
  lastChecked?: number;
}

export interface AppInfo {
  version: string;
  packaged: boolean;
  platform: string;
  dbPath: string;
  /** the command to paste into `claude mcp add`, ready to run */
  mcpCommand: string;
  mcpBinary: string;
  /** true when running with a throw-away database (screenshots, tests) */
  snapshotMode: boolean;
}

export type SettingsTab = 'general' | 'notifications' | 'mcp' | 'data' | 'about';
export type WindowKind = 'main' | 'capture' | 'popover' | 'settings' | 'brief' | 'morning';

export interface Api {
  // ---- data (backed by src/core Store) ----
  snapshot(): Promise<Snapshot>;
  item(id: string): Promise<Item | null>;
  items(filter?: ItemFilter): Promise<Item[]>;
  search(query: string, limit?: number): Promise<Item[]>;
  /** done or dropped, newest first */
  history(sinceMs: number | null, limit?: number): Promise<Item[]>;
  snoozed(): Promise<Item[]>;
  tagsOf(id: string): Promise<string[]>;
  setTags(id: string, tags: string[]): Promise<void>;
  saidLog(personId: string): Promise<Item[]>;
  interactions(personId: string, limit?: number): Promise<Interaction[]>;
  capture(line: string, source?: ItemSource): Promise<Item>;
  /** parse without saving, for tests and places that cannot import the pure parser */
  parse(line: string): Promise<ParsedCapture>;
  /** Store.update: only plain fields; inbox is cleared when a due date or person is set */
  update(id: string, patch: Partial<Omit<Item, 'id'>>): Promise<void>;
  /** write an earlier copy of an item back unchanged (undo) */
  restore(item: Item): Promise<void>;
  /** returns the next occurrence when the item recurs */
  complete(id: string): Promise<Item | null>;
  drop(id: string): Promise<void>;
  reopen(id: string): Promise<void>;
  snooze(id: string, untilMs: number): Promise<void>;
  assign(id: string, personHandle: string | null, dueMs: number | null, hasTime?: boolean): Promise<void>;
  savePerson(person: Person): Promise<void>;
  /** creates the person from a display name when the handle is new; null for an unusable name */
  addPerson(name: string): Promise<Person | null>;
  logInteraction(personId: string, kind?: InteractionKind, notes?: string): Promise<Interaction>;
  /** like capture, but a line that starts with a capture-template name creates all the template's items */
  captureMany(line: string): Promise<Item[]>;
  /** the weekly review for [fromMs, toMs); toMs defaults to now */
  review(fromMs: number, toMs?: number): Promise<ReviewData>;
  keptRate(periodDays: number): Promise<KeptRate>;
  /** item events since fromMs, newest first */
  activity(fromMs: number, limit?: number): Promise<ActivityEntry[]>;
  heatGrid(weeks?: number): Promise<HeatRow[]>;
  /** consecutive weeks (counting back from this one) in which the 1:1 cadence was met */
  onTimeStreak(personId: string): Promise<number>;
  upcomingDates(withinDays?: number): Promise<UpcomingDate[]>;
  /** past 1:1s (newest first) with their notes and the items recorded in them */
  interactionHistory(personId: string, limit?: number): Promise<InteractionWithItems[]>;
  /** end a 1:1: log the interaction with its notes and link the items created during it (itemIds) to it */
  logOneOnOne(personId: string, notes: string, itemIds: string[], startedAt?: number): Promise<Interaction>;
  /** accept proposed items (Claude's, waiting in the Inbox): they become normal items */
  acceptProposed(ids: string[]): Promise<void>;
  /** dismiss proposed items: dropped, and never re-imported because their external id stays known */
  dismissProposed(ids: string[]): Promise<void>;
  /** pause or resume notifications; null resumes */
  pauseNotifications(untilMs: number | null): Promise<void>;

  // ---- interface state ----
  uiState(): Promise<UiState>;
  setUiState(patch: Partial<UiState>): Promise<UiState>;
  appInfo(): Promise<AppInfo>;
  saveSettings(patch: Partial<Snapshot['settings']>): Promise<Snapshot['settings']>;

  // ---- windows and system ----
  openMain(nav?: Nav): Promise<void>;
  openCapture(): Promise<void>;
  /** called by the capture window: save the line, then hide (unless keepOpen) */
  captureSubmit(line: string, keepOpen: boolean): Promise<void>;
  /** hide the capture panel without saving */
  captureHide(): Promise<void>;
  openSettings(tab?: SettingsTab): Promise<void>;
  openPersonBrief(personId: string): Promise<void>;
  openMorningBrief(): Promise<void>;
  closeWindow(): Promise<void>;
  /** try to register a global shortcut (Electron accelerator); false = taken or invalid, nothing changed */
  setHotkey(accelerator: string): Promise<boolean>;
  playSound(name: string): Promise<void>;
  copyText(text: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  revealDatabase(): Promise<void>;
  /** save dialog, then the JSON export; resolves to the saved path or null when cancelled */
  exportData(): Promise<string | null>;
  quit(): Promise<void>;

  // ---- updates ----
  updateState(): Promise<UpdateState>;
  /** manual = the user pressed the button: always answers (and may show a dialog) */
  checkForUpdates(manual?: boolean): Promise<UpdateState>;
  /** quit and install the downloaded update */
  installUpdate(): Promise<void>;
}

export const API_METHODS = [
  'snapshot', 'item', 'items', 'search', 'history', 'snoozed', 'tagsOf', 'setTags', 'saidLog', 'interactions', 'capture', 'parse',
  'update', 'restore', 'complete', 'drop', 'reopen', 'snooze', 'assign', 'savePerson', 'addPerson', 'logInteraction',
  'interactionHistory', 'logOneOnOne', 'acceptProposed', 'dismissProposed', 'captureMany', 'review', 'keptRate', 'activity', 'heatGrid', 'onTimeStreak', 'upcomingDates', 'pauseNotifications',
  'uiState', 'setUiState', 'appInfo', 'saveSettings',
  'openMain', 'openCapture', 'captureSubmit', 'captureHide', 'openSettings', 'openPersonBrief', 'openMorningBrief', 'closeWindow',
  'setHotkey', 'playSound', 'copyText', 'openExternal', 'revealDatabase', 'exportData', 'quit',
  'updateState', 'checkForUpdates', 'installUpdate',
] as const satisfies ReadonlyArray<keyof Api>;

/** Events pushed from main to the renderer windows. */
export interface ApiEvents {
  /** the database changed (our own write, or the MCP server's): re-fetch what you show */
  'data-changed': undefined;
  'ui-state': UiState;
  'update-state': UpdateState;
  /** menu, tray or notification asked the main window to go somewhere */
  navigate: Nav;
  /** select and reveal an item (search result, notification) */
  'select-item': string;
  /** the capture panel was just shown: clear the field and focus it */
  'capture-shown': undefined;
  /** the user chose Back, Forward, Hide sidebar, Shortcuts, Undo from the menu */
  command: 'back' | 'forward' | 'toggle-sidebar' | 'shortcuts' | 'undo' | 'search' | 'new-capture';
  /** a window should play the "dot flies to the menu bar" blip */
  blip: undefined;
}

export type ApiEventName = keyof ApiEvents;

export interface JaffloopBridge extends Api {
  on<E extends ApiEventName>(event: E, cb: (payload: ApiEvents[E]) => void): () => void;
  /** which window this renderer is: set from the URL (?view=main|capture|popover|settings|brief|morning) */
  view: WindowKind;
  /** for brief windows: the person to show */
  params: Record<string, string>;
}

declare global {
  interface Window {
    jaffloop: JaffloopBridge;
  }
}
