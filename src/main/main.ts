// Jaffloop main process: stores, windows, tray, hotkey, notifications, updates.
import { app, BrowserWindow, clipboard, dialog, nativeImage, nativeTheme, type Rectangle } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isOverdue, isSlipping, openStore, type Store } from '../core';
import { seed } from '../core/seed';
import type { UiState } from '../shared/api';
import { flyDot } from './flydot';
import { Hotkey } from './hotkey';
import { registerIpc } from './ipc';
import { installMenu } from './menu';
import { Notifier } from './notifications';
import { builtinSchedulable, createScheduleService, defaultScheduleDeps } from './schedule';
import { nextTrayText } from './tray-text';
import { TrayController } from './tray';
import { resolveTokens } from '../renderer/themes';
import { readLegacyPrefs, themeSource, UiStateStore } from './ui-state';
import { UpdateService } from './update-service';
import { Windows } from './windows';

const argv = process.argv.slice(1);
const argAfter = (flag: string): string | undefined => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined; };
const env = process.env;

// ---- paths (before app is ready)
const appSupport = app.getPath('appData');
const dbPath = env.JAFFLOOP_DB || argAfter('--db') || path.join(appSupport, 'Jaffloop', 'jaffloop.sqlite');
const userData = env.JAFFLOOP_USERDATA || path.join(appSupport, 'Jaffloop', 'app-data');
app.setName('Jaffloop');
app.setPath('userData', userData);
// the old Swift app's preferences are only imported for the real install, never for tests and screenshots
const isolated = !!(env.JAFFLOOP_DB || env.JAFFLOOP_USERDATA || argAfter('--db'));
const smoke = !!env.JAFFLOOP_SMOKE && env.JAFFLOOP_SMOKE !== '0';
const appRoot = app.getAppPath();

let store!: Store;
let ui!: UiStateStore;
let windows!: Windows;
let tray!: TrayController;
let hotkey!: Hotkey;
let notifier!: Notifier;
let updates: UpdateService | null = null;
let lastDataVersion = 0;
let quitting = false;
/** the last Dock badge string (the e2e hook reads it: a Dock cannot be inspected) */
let lastBadge = '';

const log = (m: string): void => { try { fs.appendFileSync(path.join(userData, 'main.log'), `${new Date().toISOString()} ${m.replace(/\s+/g, ' ').slice(0, 500)}\n`); } catch { /* logging never breaks the app */ } };

function fail(message: string, detail: string): never {
  if (smoke) { process.stderr.write(`SMOKE FAIL: ${message}: ${detail}\n`); app.exit(1); }
  dialog.showErrorBox(message, detail);
  app.exit(1);
  throw new Error(message);
}

// ---------------------------------------------------------------- single instance

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (windows) openMain(); });
  void app.whenReady().then(start).catch((e) => fail('Jaffloop could not start', String(e instanceof Error ? e.stack ?? e.message : e)));
}

// ---------------------------------------------------------------- start

const applyNativeTheme = (u: UiState): void => { nativeTheme.themeSource = themeSource(u); };

async function start(): Promise<void> {
  fs.mkdirSync(userData, { recursive: true });
  try {
    store = openStore(dbPath);
    if (env.JAFFLOOP_SEED === '1' && store.people(true).length === 0 && store.items({ status: null }).length === 0) seed(store);
  } catch (e) {
    fail('Jaffloop could not open its database', `${dbPath}\n\n${e instanceof Error ? e.message : e}`);
  }
  lastDataVersion = store.dataVersion();

  ui = new UiStateStore(path.join(userData, 'ui-state.json'));
  ui.onChange = (s: UiState, patch) => {
    if (patch.appearance || patch.theme) applyNativeTheme(s);
    if (patch.trayText !== undefined) refreshTray();
    if (patch.pauseUntil !== undefined) notifier?.reschedule();
    windows?.broadcast('ui-state', s);
  };
  await ui.load(isolated ? undefined : () => readLegacyPrefs());
  applyNativeTheme(ui.get());
  { const p = ui.get().pauseUntil; if (p !== null && p <= Date.now()) ui.set({ pauseUntil: null }); } // a pause that ran out while the app was closed

  if (!app.isPackaged) {
    const icon = nativeImage.createFromPath(path.join(appRoot, 'build', 'icon.png'));
    if (!icon.isEmpty()) app.dock?.setIcon(icon);
  }

  const distMain = __dirname;
  const rendererDir = path.join(appRoot, 'dist', 'renderer');
  tray = new TrayController({
    onToggle: () => windows.togglePopover(),
    onCapture: () => windows.showCapture(),
    onOpen: () => openMain(),
    onSettings: () => windows.openSettings(),
    pausedUntil: () => ui.get().pauseUntil,
    onPause: (until) => { ui.set({ pauseUntil: until }); },
  });
  windows = new Windows({
    preload: path.join(distMain, 'preload.cjs'),
    rendererDir,
    boundsFile: path.join(userData, 'main-window.json'),
    trayBounds: () => tray.bounds(),
    windowBackground: () => resolveTokens(ui.get().theme, nativeTheme.shouldUseDarkColors).bg,
    onPopoverBlurHide: () => { tray.lastBlurHide = Date.now(); },
  });
  hotkey = new Hotkey(() => windows.toggleCapture());
  const accelerator = store.settings().hotkey;
  if (!hotkey.register(accelerator)) log(`could not register the global shortcut ${accelerator}`);

  const exe = app.getPath('exe');
  const mcp = app.isPackaged
    ? { binary: path.join(path.dirname(exe), 'jaffloop-mcp'), command: `claude mcp add --scope user jaffloop -- "${path.join(path.dirname(exe), 'jaffloop-mcp')}"` }
    : { binary: path.join(appRoot, 'dist', 'mcp', 'server.cjs'), command: `claude mcp add --scope user jaffloop -e ELECTRON_RUN_AS_NODE=1 -- "${exe}" "${path.join(appRoot, 'dist', 'mcp', 'server.cjs')}"` };

  notifier = new Notifier({
    items: () => store.items({}, Date.now()),
    item: (id) => store.item(id),
    people: () => new Map(store.people(true).map((p) => [p.id, p.name])),
    settings: () => store.settings(),
    pausedUntil: () => ui.get().pauseUntil,
    resumed: () => { if (ui.get().pauseUntil !== null) ui.set({ pauseUntil: null }); },
    stateFile: path.join(userData, 'stale-notified.json'),
    done: (id) => { store.complete(id); changed(); },
    snooze: (ids, until) => { for (const id of ids) store.snooze(id, until); changed(); },
    nudge: (text) => clipboard.writeText(text),
    openLedger: () => openMain('ledger'),
    openMorning: () => windows.openMorning(),
    openItem: (item) => {
      openMain(item?.personId ? `person:${item.personId}` : 'today');
      if (item) { const w = windows.mainWindow(); if (w) windows.sendWhenReady(w, 'select-item', item.id); }
    },
  });

  const schedule = createScheduleService(defaultScheduleDeps((id) => {
    const b = builtinSchedulable(id);
    if (b) return b;
    const cp = store.customPrompts().find((x) => x.id === id && x.approved);
    return cp ? { id: cp.id, title: cp.title, description: cp.description, needs: cp.needs, arguments: cp.arguments, text: cp.text } : null;
  }));
  registerIpc({
    schedule, store, dbPath, windows, ui, hotkey, updates: () => updates, changed, settingsChanged: () => notifier.reschedule(), openMain,
    flyDot: (from) => flyFrom(from), rendererOrigin: pathToFileURL(rendererDir).href, mcp, snapshotMode: env.JAFFLOOP_SEED === '1' || env.JAFFLOOP_SNAPSHOT === '1',
  });

  installMenu({
    newCapture: () => windows.showCapture(),
    openSettings: () => windows.openSettings(),
    checkForUpdates: () => void (updates ? updates.check(true) : Promise.resolve()),
    openMorningBrief: () => windows.openMorning(),
    openMain: () => openMain(),
    navigate: (nav) => openMain(nav),
    command: (c) => { const w = openMain(); windows.sendWhenReady(w, 'command', c); },
  });

  tray.create();
  refreshTray();
  notifier.start();
  setInterval(pollData, 1000).unref();
  setInterval(refreshTray, 60_000).unref();

  app.on('activate', () => { if (windows.visibleAppWindows().length === 0) openMain(); });
  app.on('window-all-closed', () => undefined); // stay in the menu bar
  app.on('before-quit', () => { quitting = true; notifier.stop(); updates?.dispose(); });
  app.on('will-quit', () => hotkey.dispose());

  // updates: created after the windows so the first dialog has a parent
  void UpdateService.create({
    dataDir: userData,
    auto: () => ui.get().autoUpdateCheck,
    onState: (s) => windows.broadcast('update-state', s),
    log,
    appFocused: () => windows.visibleAppWindows().some((w) => w.isFocused()),
    showWindow: () => openMain(),
    parent: () => { const w = windows.mainWindow(); return w && w.isVisible() ? w : null; },
  }).then((u) => { updates = u; windows.broadcast('update-state', u.state()); }).catch((e) => log(`updates: ${e}`));

  // test hook: lets Playwright's app.evaluate reach the pieces that have no window (tray, notifier, popover)
  if (env.JAFFLOOP_E2E === '1') (globalThis as Record<string, unknown>).__jaffloop = { windows, tray, notifier, hotkey, ui, store, get updates() { return updates; }, get badge() { return lastBadge; }, refreshTray };

  const background = argv.includes('--background') && !smoke;
  if (!background) openMain();
  if (!smoke) setTimeout(() => { if (!quitting) windows.warmCapture(); }, 1500).unref();
  if (smoke) void runSmoke();
}

// ---------------------------------------------------------------- shared actions

function openMain(nav?: string): BrowserWindow {
  // a window that does not exist yet starts on `nav`; one that does gets a 'navigate' event
  if (nav && !windows.mainWindow()) ui.set({ lastNav: nav });
  return windows.openMain(nav);
}

/** After an own write (or a change by the MCP server): tell every window, refresh the tray, replan notifications. */
function changed(): void {
  refreshTray();
  windows.broadcast('data-changed');
  notifier.reschedule();
}

function pollData(): void {
  try {
    const v = store.dataVersion();
    if (v !== lastDataVersion) { lastDataVersion = v; changed(); }
  } catch (e) { log(`poll: ${e}`); }
}

function refreshTray(): void {
  try {
    const now = Date.now();
    const open = store.items({}, now);
    const n = open.filter((i) => isOverdue(i, now) || isSlipping(i)).length;
    const next = ui.get().trayText === 'next' ? nextTrayText(open, new Map(store.people(true).map((p) => [p.id, p.name])), now) : null;
    tray.setCount(n, next);
    lastBadge = n > 0 ? String(n) : '';
    app.dock?.setBadge(lastBadge);
  } catch (e) { log(`tray: ${e}`); }
}

function flyFrom(from?: BrowserWindow | null): void {
  const target = tray.bounds();
  if (!target || windows.reducedMotion()) return;
  const cap = windows.captureWindow();
  let start: { x: number; y: number } | null = null;
  if (cap?.isVisible()) { const b = cap.getBounds(); start = { x: b.x + 58, y: b.y + 50 }; }
  else {
    const w = from && !from.isDestroyed() && from !== cap && from !== windows.popoverWindow() ? from : BrowserWindow.getFocusedWindow();
    if (w && !w.isDestroyed()) { const b: Rectangle = w.getBounds(); start = { x: b.x + b.width / 2, y: b.y + b.height - 40 }; }
  }
  if (!start) return;
  void flyDot(start, target).catch(() => undefined);
}

// ---------------------------------------------------------------- smoke test

async function runSmoke(): Promise<void> {
  const timeout = setTimeout(() => fail('smoke test timed out after 20 s', 'the renderer never reported ready'), 20_000);
  const errors: string[] = [];
  const w = windows.mainWindow()!;
  w.webContents.on('console-message', (e) => { if (e.level === 'error') errors.push(e.message); });
  w.webContents.on('render-process-gone', (_e, d) => fail('renderer crashed', d.reason));
  w.webContents.on('did-fail-load', (_e, code, desc) => fail('renderer failed to load', `${code} ${desc}`));
  const poll = async (): Promise<void> => {
    try {
      // the renderer sets body[data-ready] when initModel is done; an app that has rendered something counts too
      const ok = await w.webContents.executeJavaScript(`document.body && (document.body.dataset.ready === '1' || (document.getElementById('root') && document.getElementById('root').childElementCount > 0))`);
      if (ok) {
        clearTimeout(timeout);
        if (errors.length) process.stderr.write(`renderer console errors:\n${errors.join('\n')}\n`);
        process.stdout.write('SMOKE OK\n');
        app.exit(0);
        return;
      }
    } catch { /* still loading */ }
    setTimeout(() => void poll(), 100);
  };
  void poll();
}

