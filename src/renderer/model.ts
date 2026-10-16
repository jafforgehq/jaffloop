// The app's brain in the renderer: shared signals and every action (ported from AppModel.swift).
// Views read signals and call these functions; nothing in a view talks to window.jaffloop for data except through here.
import { batch, computed, signal } from '@preact/signals';
import type { AppInfo, Nav, UiState, UpdateState } from '../shared/api';
import type { Item, Person, PersonSummary, Snapshot } from '../shared/types';
import { Fmt, NavHistory, PinOrder, nextOneOnOneAt, parseCapture, sortPeople } from './core';
import { captureLine, loggedToast } from './oneonone-logic';
import { proposedToast } from './onboarding-logic';
import { nextOneOnOnePreset, nudgeText } from './speed-logic';
import { applyUiTheme } from './themes';
import { type SnoozePreset, snoozePresets as presetsAt } from './ui-logic';

export const api = window.jaffloop;
export const view = api.view;

// ---------------------------------------------------------------- state

const emptySnapshot: Snapshot = {
  settings: { eodTime: '17:30', workStart: '09:00', workEnd: '18:00', morningBrief: '08:30', staleDaysAfterDue: 3, staleDaysNoDue: 5, mcpReadOnly: false, compact: false, sound: false, haptics: true, hotkey: 'Alt+Space', jiraBaseUrl: '', captureTemplates: [], reviewClaudeItems: false },
  today: { slipping: [], overdue: [], today: [], waitingStale: [], inbox: [], checkIn: [] },
  openItems: [], summaries: [], tags: [], auditLog: [], snoozedCount: 0, proposed: [], now: Date.now(),
};
const defaultUi: UiState = {
  density: 'comfortable', appearance: 'system', accent: 'graphite', pinnedPeople: [], collapsed: [], pinOrder: [], savedFilters: [], lastNav: 'today',
  sidebarHidden: false, todayGroup: 'section', todayFocus: false, peopleLayout: 'list', peopleSort: 'name', soundSave: 'Tink', soundComplete: 'Glass',
  soundUndo: 'Pop', welcomeSeen: true, lastSeenVersion: null, autoUpdateCheck: true, dismissedCheckIns: { day: '', ids: [] },
  trayText: 'count', pauseUntil: null, wrapupDay: '', burstDay: '', showDates: true, theme: 'classic',
};

export const snapshot = signal<Snapshot>(emptySnapshot);
export const ui = signal<UiState>(defaultUi);
export const updateState = signal<UpdateState>({ status: 'idle', current: '' });
export const info = signal<AppInfo>({ version: 'dev', packaged: false, platform: 'darwin', dbPath: '', mcpCommand: '', mcpBinary: '', snapshotMode: false });
export const ready = signal(false);

export const nav = signal<Nav>('today');
export const showSearch = signal(false);
export const showShortcuts = signal(false);
export const showWelcome = signal(false);
/** the "Add your team" wizard (main window only) */
export const showOnboarding = signal(false);
export const selectedItemId = signal<string | null>(null);
export const multi = signal<ReadonlySet<string>>(new Set());
export const drawerItemId = signal<string | null>(null);
export const triggerComplete = signal<string | null>(null);
export const triggerEdit = signal<string | null>(null);
export const pulsePersonId = signal<string | null>(null);
/** set for the session when the app has just been updated: the version it came from */
export const updatedFrom = signal<string | null>(null);

export interface Toast { id: number; message: string; undo?: () => void }
export const toast = signal<Toast | null>(null);

/** the item shown in the drawer (may be done/dropped, so it is fetched when it is not open) */
export const drawerItem = signal<Item | null>(null);

// derived
export const settings = computed(() => snapshot.value.settings);
export const openItems = computed(() => snapshot.value.openItems);
export const summaries = computed(() => snapshot.value.summaries);
export const orderedPeople = computed(() => sortPeople(summaries.value, new Set(ui.value.pinnedPeople)));
export const overdueCount = computed(() => openItems.value.filter((i) => Fmt.isOverdue(i, snapshot.value.now) || Fmt.isSlipping(i)).length);
export const inboxItems = computed(() => openItems.value.filter((i) => i.inbox));
/** items Claude added that wait for Accept or Dismiss (not part of openItems) */
export const proposedItems = computed(() => snapshot.value.proposed);
export const ledgerItems = computed(() => openItems.value.filter((i) => i.kind === 'owe'));
export const recentPeople = computed(() => {
  const last = new Map<string, number>();
  for (const i of openItems.value) if (i.personId) last.set(i.personId, Math.max(last.get(i.personId) ?? 0, i.createdAt));
  return summaries.value.map((s) => s.person).sort((a, b) => (last.get(b.id) ?? 0) - (last.get(a.id) ?? 0));
});

export const person = (id: string | null | undefined): Person | undefined => (id ? summaries.value.find((s) => s.person.id === id)?.person : undefined);
export const summary = (id: string): PersonSummary | undefined => summaries.value.find((s) => s.person.id === id);
export const itemsFor = (personId: string, kind: Item['kind']) => openItems.value.filter((i) => i.personId === personId && i.kind === kind);
export const orderedItems = (items: Item[]): Item[] => PinOrder.apply(items, ui.value.pinOrder);

export function navTitle(n: Nav): string {
  if (n === 'today') return 'Today';
  if (n === 'ledger') return 'Promise ledger';
  if (n === 'inbox') return 'Inbox';
  if (n === 'people') return 'People';
  if (n === 'releases') return "What's new";
  if (n === 'done') return 'Done';
  if (n === 'review') return 'Weekly review';
  if (n === 'snoozed') return 'Snoozed';
  if (n.startsWith('filter:')) return n.slice(7);
  if (n.startsWith('tag:')) return `#${n.slice(4)}`;
  if (n.startsWith('person:')) return summary(n.slice(7))?.person.name ?? 'Person';
  return n;
}

// ---------------------------------------------------------------- loading

let reloading: Promise<void> | null = null;
let again = false;
export function reload(): Promise<void> {
  if (reloading) { again = true; return reloading; }
  reloading = (async () => {
    do {
      again = false;
      const s = await api.snapshot();
      batch(() => {
        snapshot.value = s;
        // a person that no longer exists cannot stay selected
        if (nav.value.startsWith('person:') && !s.summaries.some((x) => x.person.id === nav.value.slice(7))) nav.value = 'today';
      });
    } while (again);
    reloading = null;
  })();
  return reloading;
}

const history = new NavHistory<Nav>();
let travelling = false;

export function go(n: Nav) {
  if (n === nav.value) return;
  if (!travelling) history.visit(nav.value, n);
  nav.value = n;
  if (view === 'main') void api.setUiState({ lastNav: n });
}
export function goBack() { const n = history.goBack(nav.value); if (n) { travelling = true; go(n); travelling = false; } }
export function goForward() { const n = history.goForward(nav.value); if (n) { travelling = true; go(n); travelling = false; } }

/** Pseudo screen the Settings window asks the main window for: People page with the wizard open. */
const ADD_PEOPLE = 'add-people';
function enter(n: Nav) {
  if (n === ADD_PEOPLE) { go('people'); openOnboarding(); }
  else go(n);
}

export async function initModel(): Promise<void> {
  const [s, u, i, up] = await Promise.all([api.snapshot(), api.uiState(), api.appInfo(), api.updateState()]);
  batch(() => { snapshot.value = s; ui.value = u; info.value = i; updateState.value = up; });
  applyUi(u);
  if (i.snapshotMode) document.body.classList.add('snapshot');
  api.on('data-changed', () => { void reload(); });
  api.on('ui-state', (v) => { ui.value = v; applyUi(v); });
  api.on('update-state', (v) => { updateState.value = v; });
  api.on('navigate', (n) => { enter(n); });
  api.on('select-item', (id) => { selectedItemId.value = id; });
  api.on('command', (c) => {
    if (c === 'back') goBack();
    else if (c === 'forward') goForward();
    else if (c === 'toggle-sidebar') void api.setUiState({ sidebarHidden: !ui.value.sidebarHidden });
    else if (c === 'shortcuts') showShortcuts.value = !showShortcuts.value;
    else if (c === 'undo') { if (toast.value?.undo) undoLast(); else document.execCommand('undo'); }
    else if (c === 'search') showSearch.value = !showSearch.value;
    else if (c === 'new-capture') void api.openCapture();
  });
  if (view === 'main') {
    if (u.lastNav === ADD_PEOPLE) { nav.value = 'people'; void api.setUiState({ lastNav: 'people' }); openOnboarding(); }
    else if (u.lastNav) nav.value = u.lastNav;
    if (!summaries.value.some((x) => nav.value === `person:${x.person.id}`) && nav.value.startsWith('person:')) nav.value = 'today';
    checkWhatsNew();
    if (!u.welcomeSeen) {
      if (s.openItems.length === 0 && s.summaries.length === 0 && !updatedFrom.value) showWelcome.value = true;
      else void api.setUiState({ welcomeSeen: true });
    }
  }
  ready.value = true;
}

function applyUi(u: UiState) {
  const h = document.documentElement;
  applyUiTheme(u.theme, u.accent);
  h.dataset.accent = u.accent;
  h.dataset.density = u.density;
  document.body.classList.toggle('solid', matchMedia('(prefers-reduced-transparency: reduce)').matches);
}

// ---------------------------------------------------------------- what's new

function cmpVersion(a: string, b: string): number {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] ?? 0) - (pb[i] ?? 0); if (d) return d; }
  return 0;
}
const validVersion = (v: string) => /^\d+\.\d+\.\d+$/.test(v);

/** First launch after an update: remember the old version and open What's new once. */
function checkWhatsNew() {
  const cur = info.value.version;
  if (!validVersion(cur)) return;
  const last = ui.value.lastSeenVersion;
  if (last == null) {
    void api.setUiState({ lastSeenVersion: cur });
    // 0.0.x (the Swift app) never recorded a version: existing data means this is an update, not a fresh install
    if (snapshot.value.openItems.length || snapshot.value.summaries.length) { updatedFrom.value = 'the Swift version'; nav.value = 'releases'; }
    return;
  }
  if (last !== cur && validVersion(last) && cmpVersion(cur, last) > 0) { updatedFrom.value = last; nav.value = 'releases'; }
}
export const hasUnseenRelease = () => validVersion(info.value.version) && ui.value.lastSeenVersion !== info.value.version;
export function markVersionSeen() { if (validVersion(info.value.version) && ui.value.lastSeenVersion !== info.value.version) void api.setUiState({ lastSeenVersion: info.value.version }); }

// ---------------------------------------------------------------- toast and undo

let toastId = 0;
export function showToast(message: string, undo?: () => void) {
  const t: Toast = { id: ++toastId, message, undo };
  toast.value = t;
  setTimeout(() => { if (toast.value?.id === t.id) toast.value = null; }, 7000);
}
export function undoLast() {
  const t = toast.value;
  if (!t) return;
  toast.value = null;
  play(ui.value.soundUndo);
  t.undo?.();
}
const short = (s: string) => (s.length > 34 ? `${s.slice(0, 33)}…` : s);

export function play(name: string) {
  if (!settings.value.sound || name === 'None') return;
  void api.playSound(name);
}

async function priors(ids: string[]): Promise<Item[]> {
  const out: Item[] = [];
  for (const id of ids) { const i = await api.item(id); if (i) out.push(i); }
  return out;
}
async function restore(items: Item[], spawned: Item[] = []) {
  for (const i of items) await api.restore(i);
  for (const s of spawned) await api.drop(s.id);
  await reload();
}
function clearMulti(ids: string[]) {
  if (!multi.value.size) return;
  const next = new Set(multi.value);
  ids.forEach((i) => next.delete(i));
  multi.value = next;
}

// ---------------------------------------------------------------- item actions

export async function save(line: string) {
  if (!line.trim()) return;
  await api.capture(line);
  play(ui.value.soundSave);
  await reload();
}

export async function completeMany(ids: string[], label?: string) {
  const before = await priors(ids);
  const spawned: Item[] = [];
  for (const id of ids) { const n = await api.complete(id); if (n) spawned.push(n); }
  play(ui.value.soundComplete);
  clearMulti(ids);
  await reload();
  showToast(`Done · ${label ?? `${ids.length} items`}`, () => { void restore(before, spawned); });
}
export const complete = (i: Item) => completeMany([i.id], short(i.title));

export async function dropMany(ids: string[], label?: string) {
  const before = await priors(ids);
  for (const id of ids) await api.drop(id);
  clearMulti(ids);
  await reload();
  showToast(`Dropped · ${label ?? `${ids.length} items`}`, () => { void restore(before); });
}
export const drop = (i: Item) => dropMany([i.id], short(i.title));

export async function snoozeMany(ids: string[], until: number, label?: string) {
  const before = await priors(ids);
  for (const id of ids) await api.snooze(id, until);
  clearMulti(ids);
  await reload();
  showToast(`Snoozed · ${label ?? `${ids.length} items`} until ${Fmt.backLabel(until).replace('back ', '')}`, () => { void restore(before); });
}
export const snooze = (i: Item, until: number) => snoozeMany([i.id], until, short(i.title));

export async function assignMany(ids: string[], handle: string | null, due: number | null = null, label?: string) {
  const before = await priors(ids);
  for (const id of ids) await api.assign(id, handle, due);
  clearMulti(ids);
  await reload();
  const who = handle ? summaries.value.find((s) => s.person.handle === handle)?.person.name : undefined;
  showToast(`${who ? `Assigned to ${who}` : 'Updated'} · ${label ?? `${ids.length} items`}`, () => { void restore(before); });
}
export const assign = (i: Item, handle: string | null, due: number | null) => assignMany([i.id], handle, due, short(i.title));

/** Generic edit with an undo toast (drawer fields, inline dates, kind, person, title). */
export async function updateItem(i: Item, message: string, patch: Partial<Omit<Item, 'id'>>) {
  const before = await priors([i.id]);
  await api.update(i.id, patch);
  await reload();
  showToast(message, () => { void restore(before); });
}
export const rename = (i: Item, title: string) => updateItem(i, 'Renamed', { title });

export async function setTags(i: Item, tags: string[]) {
  const clean = tags.map((t) => t.trim().replace(/^#/, '').toLowerCase()).filter(Boolean);
  const old = await api.tagsOf(i.id);
  if (clean.join(',') === old.join(',')) return;
  await api.setTags(i.id, clean);
  await reload();
  showToast('Tags updated', () => { void api.setTags(i.id, old).then(reload); });
}

export async function reopen(i: Item) {
  const before = await priors([i.id]);
  await api.reopen(i.id);
  await reload();
  showToast(`Reopened · ${short(i.title)}`, () => { void restore(before); });
}
/** Bring a snoozed item back now. */
export async function wake(i: Item) {
  const before = await priors([i.id]);
  await api.update(i.id, { snoozedUntil: null });
  await reload();
  showToast(`Back on your list · ${short(i.title)}`, () => { void restore(before); });
}
export async function togglePin(i: Item) { await api.update(i.id, { pinned: !i.pinned }); await reload(); }

/** "owe review RFC fri" typed on someone's page becomes "owe @handle review RFC fri". */
export async function captureFor(p: Person, text: string) {
  const t = text.trim();
  if (!t) return;
  const first = t.split(/\s+/)[0]!.toLowerCase();
  const line = Fmt.isPrefix(first) && t.includes(' ') ? `${first} @${p.handle} ${t.slice(first.length).trim()}` : `@${p.handle} ${t}`;
  await save(line);
}

export async function logInteraction(p: Person) {
  await api.logInteraction(p.id, '1on1');
  pulsePersonId.value = p.id;
  await reload();
  setTimeout(() => { if (pulsePersonId.value === p.id) pulsePersonId.value = null; }, 1000);
}
export async function savePerson(p: Person) { await api.savePerson(p); await reload(); }
export async function addPerson(name: string): Promise<Person | null> { const p = await api.addPerson(name); await reload(); return p; }
export async function saveSettings(patch: Partial<Snapshot['settings']>) { await api.saveSettings(patch); await reload(); }

export function dismissCheckIn(id: string) {
  const day = new Date().toISOString().slice(0, 10);
  const cur = ui.value.dismissedCheckIns.day === day ? ui.value.dismissedCheckIns.ids : [];
  void api.setUiState({ dismissedCheckIns: { day, ids: [...cur, id] } });
}
export const dismissedCheckIns = computed(() => {
  const day = new Date().toISOString().slice(0, 10);
  return new Set(ui.value.dismissedCheckIns.day === day ? ui.value.dismissedCheckIns.ids : []);
});

// ---------------------------------------------------------------- selection and layout

export const toggleMulti = (id: string) => { const n = new Set(multi.value); n.has(id) ? n.delete(id) : n.add(id); multi.value = n; };
export const toggleCollapsed = (key: string) => {
  const c = ui.value.collapsed;
  void api.setUiState({ collapsed: c.includes(key) ? c.filter((k) => k !== key) : [...c, key] });
};
export const isCollapsed = (key: string) => ui.value.collapsed.includes(key);
export const togglePinnedPerson = (id: string) => {
  const c = ui.value.pinnedPeople;
  void api.setUiState({ pinnedPeople: c.includes(id) ? c.filter((k) => k !== id) : [...c, id] });
};
export const toggleDrawer = () => { drawerItemId.value = drawerItemId.value ? null : selectedItemId.value; };
export const dragPayload = (id: string) => (multi.value.has(id) ? [...multi.value].sort().join(',') : id);

export function movePin(id: string, onto: string) {
  const base = PinOrder.apply(openItems.value.filter((i) => i.pinned), ui.value.pinOrder).map((i) => i.id);
  void api.setUiState({ pinOrder: PinOrder.move(id, onto, base) });
}

export function addFilter(q: string) {
  const t = q.trim();
  if (!t || ui.value.savedFilters.includes(t)) return;
  void api.setUiState({ savedFilters: [...ui.value.savedFilters, t] });
  showToast(`Saved filter · ${t}`);
}
export function removeFilter(q: string) {
  void api.setUiState({ savedFilters: ui.value.savedFilters.filter((f) => f !== q) });
  if (nav.value === `filter:${q}`) go('today');
}

/** Jump from search to an item: open the list it lives in and select it. */
export function reveal(i: Item) {
  go(i.status !== 'open' ? 'done' : i.personId ? `person:${i.personId}` : i.inbox ? 'inbox' : 'today');
  selectedItemId.value = i.id;
}

export function openOnboarding() {
  if (showWelcome.value) dismissWelcome();
  showOnboarding.value = true;
}
export const closeOnboarding = () => { showOnboarding.value = false; };

export function dismissWelcome(addExample = false) {
  if (addExample) void save(`todo Try Jaffloop: press ${Fmt.hotkeyLabel(settings.value.hotkey)} and capture something fri`);
  void api.setUiState({ welcomeSeen: true });
  showWelcome.value = false;
}

// keep the drawer item fresh
export async function refreshDrawerItem() {
  const id = drawerItemId.value;
  drawerItem.value = id ? (openItems.value.find((i) => i.id === id) ?? (await api.item(id))) : null;
}

export { parseCapture };

// ---- added by ui-shell
/** Snooze choices for the item menus and the `s` key (1 hour, This afternoon, Tomorrow 09:00, Next Monday). */
export const snoozePresets = (now = Date.now()): SnoozePreset[] => presetsAt(now, (ms) => Fmt.short(ms, 'HH:mm'));
export type { SnoozePreset };


// ---- added by ui-speed (0.2.0)
/** Today is filtered to one person (click an avatar in a row); null = everyone. Not persisted. */
export const todayPersonFilter = signal<string | null>(null);
/** the ⌘P "Jump to a person" palette */
export const showPeoplePalette = signal(false);

export function filterTodayBy(personId: string) { todayPersonFilter.value = personId; go('today'); }

/** snoozePresets plus "Until next 1:1 with Sara (Fri 23 Oct)" when the item's person has a cadence and that day is still ahead. */
export function snoozePresetsFor(item?: Pick<Item, 'personId'> | null, now = Date.now()): SnoozePreset[] {
  const base = snoozePresets(now);
  const s = item?.personId ? summary(item.personId) : undefined;
  const extra = nextOneOnOnePreset(s?.person, s?.lastInteraction ?? null, now, nextOneOnOneAt, (ms) => Fmt.short(ms, 'EEE d MMM'));
  return extra ? [...base, extra] : base;
}

/** "Hi Sara, quick check-in on <title>. Any update?" to the clipboard. */
export function copyNudge(i: Item) {
  const p = person(i.personId);
  if (!p) return;
  void api.copyText(nudgeText(p.name, i.title));
  showToast(`Nudge copied · ${p.name.split(/\s+/)[0]}`);
}

export const pauseNotifications = (until: number | null) => api.pauseNotifications(until);


// ---- added by ui-1on1 (0.3.0)
/** Like save(), but returns the created item (null for an empty line) so 1:1 mode can list what it captured. */
export async function saveReturning(line: string): Promise<Item | null> {
  if (!line.trim()) return null;
  const item = await api.capture(line);
  play(ui.value.soundSave);
  await reload();
  return item;
}

/** captureFor() that returns the created item. */
export async function captureForReturning(p: Person, text: string): Promise<Item | null> {
  const line = captureLine(p.handle, text, Fmt.isPrefix);
  return line ? saveReturning(line) : null;
}

/** End a 1:1: log it with its notes, link the items captured during it, pulse the ring and toast. Returns the number of linked items. */
export async function endOneOnOne(p: Person, notes: string, itemIds: string[], startedAt: number): Promise<number> {
  await api.logOneOnOne(p.id, notes.trim(), itemIds, startedAt);
  pulsePersonId.value = p.id;
  await reload();
  showToast(loggedToast(itemIds.length));
  setTimeout(() => { if (pulsePersonId.value === p.id) pulsePersonId.value = null; }, 1000);
  return itemIds.length;
}


// ---- added by ui-onboarding (0.4.0)
/** Accept Claude's proposals: they become normal items. */
export async function acceptProposed(ids: string[], label?: string) {
  const before = await priors(ids);
  await api.acceptProposed(ids);
  clearMulti(ids);
  await reload();
  showToast(proposedToast('Accepted', ids.length, label), () => { void restore(before); });
}

/** Dismiss Claude's proposals: dropped, and never re-imported (their external id stays known). */
export async function dismissProposed(ids: string[], label?: string) {
  const before = await priors(ids);
  await api.dismissProposed(ids);
  clearMulti(ids);
  await reload();
  showToast(proposedToast('Dismissed', ids.length, label), () => { void restore(before); });
}
export const acceptOne = (i: Item) => acceptProposed([i.id], short(i.title));
export const dismissOne = (i: Item) => dismissProposed([i.id], short(i.title));
