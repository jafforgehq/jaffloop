import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openStore } from '../../src/core';
import { cleanup, launchApp, type Launched } from './helpers';

let l: Launched;
beforeAll(async () => { l = await launchApp(); });
afterAll(async () => { await l?.close(); if (l) cleanup(l); });

const api = <T>(fn: string, ...args: unknown[]): Promise<T> => l.window.evaluate(([f, a]) => (window.jaffloop as any)[f as string](...(a as unknown[])), [fn, args] as const) as Promise<T>;

describe('main process', () => {
  it('serves the seeded data to the main window', async () => {
    expect(await l.window.evaluate(() => window.jaffloop.view)).toBe('main');
    const s = await api<{ summaries: unknown[]; openItems: unknown[] }>('snapshot');
    expect(s.summaries.length).toBeGreaterThanOrEqual(5);
    expect(s.openItems.length).toBeGreaterThan(10);
    expect((await api<{ dbPath: string; packaged: boolean }>('appInfo')).dbPath).toBe(l.dbPath);
  });

  it('writes through the Store and tells every window', async () => {
    await l.window.evaluate(() => { (window as any).__changed = 0; window.jaffloop.on('data-changed', () => { (window as any).__changed++; }); });
    const item = await api<{ id: string; title: string }>('capture', 'owe @sara e2e promise fri');
    expect(item.title).toContain('e2e promise');
    expect(await api('item', item.id)).toMatchObject({ id: item.id });
    await l.window.waitForFunction(() => (window as any).__changed > 0);
  });

  it('notices a write by another process (the MCP server) within a couple of seconds', async () => {
    const before = await l.window.evaluate(() => (window as any).__changed as number);
    const other = openStore(l.dbPath);
    other.capture('todo from another process');
    other.db.close();
    await l.window.waitForFunction((n) => (window as any).__changed > n, before, { timeout: 4000 });
    expect((await api<Array<{ title: string }>>('search', 'another process')).length).toBe(1);
  });

  it('keeps the interface state in ui-state.json and applies the appearance', async () => {
    const ui = await api<{ density: string; autoUpdateCheck: boolean; welcomeSeen: boolean }>('uiState');
    expect(ui).toMatchObject({ density: 'comfortable', autoUpdateCheck: true });
    await api('setUiState', { density: 'compact', appearance: 'dark', bogus: 1 });
    expect(JSON.parse(fs.readFileSync(path.join(l.userData, 'ui-state.json'), 'utf8'))).toMatchObject({ density: 'compact', appearance: 'dark' });
    expect(await l.app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('dark');
    await api('setUiState', { appearance: 'system' });
  });

  it('registers a valid hotkey, refuses an invalid one and keeps the old', async () => {
    expect(await api('setHotkey', 'Alt+Shift+J')).toBe(true);
    expect(await l.app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('Alt+Shift+J'))).toBe(true);
    expect(await api('setHotkey', 'NotAKey+++')).toBe(false);
    expect(await l.app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('Alt+Shift+J'))).toBe(true);
    const s = await api<{ hotkey: string }>('saveSettings', { sound: false });
    expect(s.hotkey).toBe('Alt+Shift+J');
    await api('setHotkey', 'Alt+Space');
  });

  it('shows the capture panel, saves a line and hides it', async () => {
    await api('openCapture');
    const cap = await l.waitView('capture');
    const visible = () => l.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w.webContents.getURL().includes('view=capture') && w.isVisible()));
    await expect.poll(visible).toBe(true);
    await cap.evaluate(() => window.jaffloop.captureSubmit('owe @amir panel line', false));
    await expect.poll(visible).toBe(false);
    expect((await api<Array<{ title: string }>>('search', 'panel line')).length).toBe(1);
  });

  it('opens settings once and a person brief', async () => {
    await api('openSettings', 'about');
    await api('openSettings');
    await l.waitView('settings');
    const n = () => l.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => w.webContents.getURL().includes('view=settings')).length);
    expect(await n()).toBe(1);
    const sara = (await api<{ summaries: Array<{ person: { id: string; handle: string } }> }>('snapshot')).summaries.find((s) => s.person.handle === 'sara')!;
    await api('openPersonBrief', sara.person.id);
    const brief = await l.waitView('brief');
    expect(await brief.evaluate(() => window.jaffloop.params.personId)).toBe(sara.person.id);
  });

  it('reports updates as unavailable when switched off', async () => {
    expect(await api('updateState')).toMatchObject({ status: 'unavailable' });
  });
});

describe('tray, popover and notifications (through the JAFFLOOP_E2E hook)', () => {
  const hook = <T>(fn: (j: any) => T) => l.app.evaluate((_e, f) => (new Function('j', `return (${f})(j)`))((globalThis as any).__jaffloop), fn.toString());

  it('shows the overdue and slipping count on the tray item', async () => {
    const t = await hook((j) => j.tray.state());
    expect(t.count).toBeGreaterThan(0);
    expect(t.title).toBe(` ${t.count}`);
    expect(t.tooltip).toBe(`${t.count} overdue or slipping`);
  });

  it('opens the popover under the tray icon and hides it again', async () => {
    await hook((j) => j.windows.togglePopover());
    const pop = await l.waitView('popover');
    expect(pop).toBeTruthy();
    const v = () => hook((j) => j.windows.popoverWindow()?.isVisible());
    await expect.poll(v).toBe(true);
    const b = await hook((j) => j.windows.popoverWindow().getBounds());
    expect(b).toMatchObject({ width: 400, height: 460 });
    await hook((j) => j.windows.togglePopover());
    await expect.poll(v).toBe(false);
  });

  it('plans notifications (morning brief on weekdays at least) as timers', async () => {
    await hook((j) => j.notifier.rebuild());
    const s = await hook((j) => j.notifier.scheduled());
    expect(Array.isArray(s)).toBe(true);
    expect(s.every((x: { at: number }) => x.at > Date.now() - 1000)).toBe(true);
  });
});
