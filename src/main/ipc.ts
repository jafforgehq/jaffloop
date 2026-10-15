// ipcMain.handle('api:<name>') for every method of the Api contract (src/shared/api.ts).
import { app, BrowserWindow, clipboard, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { Api, AppInfo } from '../shared/api';
import { API_METHODS } from '../shared/api';
import type { Interaction, Person, Settings } from '../shared/types';
import { hm, parseCapture, type Store } from '../core';
import type { Hotkey } from './hotkey';
import { playSound } from './sounds';
import type { UiStateStore } from './ui-state';
import type { UpdateService } from './update-service';
import type { Windows } from './windows';

export interface IpcCtx {
  store: Store;
  dbPath: string;
  windows: Windows;
  ui: UiStateStore;
  hotkey: Hotkey;
  updates(): UpdateService | null;
  /** an own write happened: notify windows, refresh the tray, reschedule notifications */
  changed(): void;
  /** settings changed (notifications use them) */
  settingsChanged(): void;
  openMain(nav?: string): void;
  /** the dot flies from the window that saved to the tray icon */
  flyDot(from?: BrowserWindow | null): void;
  rendererOrigin: string;
  mcp: { command: string; binary: string };
  snapshotMode: boolean;
}

type Handlers = { [K in keyof Api]: (e: IpcMainInvokeEvent, ...a: Parameters<Api[K]>) => Awaited<ReturnType<Api[K]>> | Promise<Awaited<ReturnType<Api[K]>>> };

const personHandle = (name: string): string => name.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).join('.');

export function createHandlers(c: IpcCtx): Handlers {
  const now = (): number => Date.now();
  const write = <T>(fn: () => T): T => { const r = fn(); c.changed(); return r; };
  const win = (e: IpcMainInvokeEvent): BrowserWindow | null => BrowserWindow.fromWebContents(e.sender);

  return {
    // ---- data
    snapshot: () => c.store.snapshot(now()),
    item: (_e, id) => c.store.item(id),
    items: (_e, filter) => c.store.items(filter ?? {}, now()),
    search: (_e, q, limit) => c.store.search(q, limit ?? 50, now()),
    history: (_e, since, limit) => c.store.history(since, limit),
    snoozed: () => c.store.snoozed(now()),
    tagsOf: (_e, id) => c.store.tags(id),
    setTags: (_e, id, tags) => write(() => c.store.setTags(id, tags)),
    saidLog: (_e, personId) => c.store.items({ personId, kinds: ['said'], status: null }, now()),
    interactions: (_e, personId, limit) => c.store.interactions(personId, limit ?? 80),
    capture: (e, line, source) => {
      const item = write(() => c.store.capture(line, source ?? 'hotkey', now()));
      c.flyDot(win(e));
      return item;
    },
    parse: (_e, line) => parseCapture(line, { now: now(), eod: hm(c.store.settings().eodTime) }),
    update: (_e, id, patch) => write(() => c.store.update(id, patch, now())),
    restore: (_e, item) => write(() => c.store.restore(item)),
    complete: (_e, id) => write(() => c.store.complete(id, now())),
    drop: (_e, id) => write(() => c.store.drop(id, now())),
    reopen: (_e, id) => write(() => c.store.reopen(id, now())),
    snooze: (_e, id, until) => write(() => c.store.snooze(id, until, now())),
    assign: (_e, id, handle, due, hasTime) => write(() => c.store.assign(id, handle, due, hasTime ?? false, now())),
    savePerson: (_e, p: Person) => write(() => c.store.savePerson(p)),
    addPerson: (_e, name) => {
      const handle = personHandle(name);
      if (!handle) return null;
      return write(() => {
        const p = c.store.person(handle)!;
        // a person created from the handle gets the typed name ("Sara Lee", not "Sara.lee")
        if (p.name.toLowerCase() === handle.replace(/\./g, ' ') && p.name !== name.trim()) { const named = { ...p, name: name.trim() }; c.store.savePerson(named); return named; }
        return p;
      });
    },
    logInteraction: (_e, personId, kind, notes): Interaction => write(() => c.store.logInteraction(personId, kind ?? '1on1', notes ?? null, now())),

    // ---- interface state
    uiState: () => c.ui.get(),
    setUiState: (_e, patch) => c.ui.set(patch),
    appInfo: (): AppInfo => ({
      version: app.getVersion(), packaged: app.isPackaged, platform: process.platform, dbPath: c.dbPath,
      mcpCommand: c.mcp.command, mcpBinary: c.mcp.binary, snapshotMode: c.snapshotMode,
    }),
    saveSettings: (_e, patch) => {
      const before = c.store.settings();
      const next: Settings = { ...before, ...patch };
      if (patch.hotkey !== undefined && patch.hotkey !== before.hotkey) {
        // a shortcut that cannot be registered is not saved
        if (c.hotkey.register(patch.hotkey)) next.hotkey = c.hotkey.accelerator() ?? patch.hotkey;
        else next.hotkey = before.hotkey;
      }
      c.store.saveSettings(next);
      c.settingsChanged();
      c.changed();
      return c.store.settings();
    },

    // ---- windows and system
    openMain: (_e, nav) => { c.openMain(nav); },
    openCapture: () => c.windows.showCapture(),
    captureSubmit: (e, line, keepOpen) => {
      const w = win(e);
      const text = line.trim();
      if (text) {
        write(() => c.store.capture(text, 'hotkey', now()));
        const s = c.store.settings();
        const sound = c.ui.get().soundSave;
        if (s.sound && sound !== 'None') playSound(sound);
        c.flyDot(w);
      }
      if (!keepOpen) c.windows.hideCapture();
    },
    captureHide: () => c.windows.hideCapture(),
    openSettings: (_e, tab) => c.windows.openSettings(tab),
    openPersonBrief: (_e, personId) => c.windows.openPersonBrief(personId, c.store.personById(personId)?.name),
    openMorningBrief: () => c.windows.openMorning(),
    closeWindow: (e) => {
      const w = win(e);
      if (!w) return;
      if (w === c.windows.captureWindow() || w === c.windows.popoverWindow()) w.hide(); else w.close();
    },
    setHotkey: (_e, accelerator) => {
      if (!c.hotkey.register(accelerator)) return false;
      const s = c.store.settings();
      const acc = c.hotkey.accelerator() ?? accelerator;
      if (s.hotkey !== acc) { c.store.saveSettings({ ...s, hotkey: acc }); c.changed(); }
      return true;
    },
    playSound: (_e, name) => playSound(name),
    copyText: (_e, text) => clipboard.writeText(String(text)),
    openExternal: (_e, url) => { if (/^(https?:|mailto:)/i.test(url)) return shell.openExternal(url); },
    revealDatabase: () => { shell.showItemInFolder(c.dbPath); },
    exportData: async (e) => {
      const parent = win(e);
      const d = new Date();
      const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const opts = { title: 'Export Jaffloop data', defaultPath: path.join(app.getPath('documents'), `jaffloop-export-${stamp}.json`), filters: [{ name: 'JSON', extensions: ['json'] }] };
      const r = parent ? await dialog.showSaveDialog(parent, opts) : await dialog.showSaveDialog(opts);
      if (r.canceled || !r.filePath) return null;
      fs.writeFileSync(r.filePath, c.store.exportJSON());
      return r.filePath;
    },
    quit: () => { app.quit(); },

    // ---- updates
    updateState: () => c.updates()?.state() ?? { status: 'unavailable', current: app.getVersion(), error: 'Updates are not ready yet.' },
    checkForUpdates: async (_e, manual) => {
      const u = c.updates();
      return u ? u.check(!!manual) : { status: 'unavailable', current: app.getVersion(), error: 'Updates are not ready yet.' };
    },
    installUpdate: async () => { await c.updates()?.install(); },
  };
}

/** Only our own renderer pages may call the API. */
export function registerIpc(c: IpcCtx): void {
  const handlers = createHandlers(c) as unknown as Record<string, (e: IpcMainInvokeEvent, ...a: unknown[]) => unknown>;
  for (const name of API_METHODS) {
    ipcMain.handle(`api:${name}`, async (e, ...args) => {
      const url = e.senderFrame?.url ?? '';
      if (!url.startsWith(c.rendererOrigin)) throw new Error(`api:${name} refused for ${url.slice(0, 60)}`);
      return handlers[name]!(e, ...args);
    });
  }
}

