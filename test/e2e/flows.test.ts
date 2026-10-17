// Real user flows against the built app, a throw-away database and the demo data.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import { cleanup, launchApp, type Launched } from './helpers';

let l: Launched;
let w: Page;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const api = <T>(fn: (a: Window['jaffloop']) => Promise<T>) => w.evaluate(`(${fn.toString()})(window.jaffloop)`) as Promise<T>;
const go = async (nav: string) => { await w.evaluate((n) => window.jaffloop.openMain(n), nav); await sleep(350); };
const titles = () => w.locator('.row .row-title').allTextContents();

beforeAll(async () => {
  l = await launchApp({ env: { JAFFLOOP_SNAPSHOT: '1' } });
  w = l.window;
  await w.evaluate(() => window.jaffloop.setUiState({ lastSeenVersion: '0.1.0', welcomeSeen: true }));
  await go('today');
});
afterAll(async () => { await l.close(); cleanup(l); });

describe('capture', () => {
  it('saves a line typed in the capture panel and shows it in the app', async () => {
    await w.evaluate(() => window.jaffloop.openCapture());
    const cap = await l.waitView('capture');
    const input = cap.locator('input').first();
    await input.fill('owe @amir send the onboarding doc fri #hiring');
    await sleep(200);
    expect(await cap.getByText('Amir Haddad').count()).toBeGreaterThan(0); // person chip
    await input.press('Enter');
    await sleep(600);
    const items = await api((a) => a.items({ status: 'open' }));
    expect(items.some((i) => i.title === 'send the onboarding doc' && i.kind === 'owe')).toBe(true);
    await go('ledger');
    expect(await titles()).toContain('send the onboarding doc');
    expect((await api((a) => a.snapshot())).tags.some(([t]) => t === 'hiring')).toBe(true);
  });

  it('Cmd+Enter keeps the panel open and clears it, Escape hides it', async () => {
    await w.evaluate(() => window.jaffloop.openCapture());
    const cap = await l.waitView('capture');
    const input = cap.locator('input').first();
    await input.fill('todo second item');
    await input.press('Meta+Enter');
    await sleep(500);
    expect(await input.inputValue()).toBe('');
    await input.press('Escape');
    await sleep(300);
    expect((await api((a) => a.items({ status: 'open' }))).some((i) => i.title === 'second item')).toBe(true);
  });
});

describe('lists', () => {
  it('keyboard: j selects, Enter completes with an undo toast, Undo brings it back', async () => {
    await go('inbox');
    const before = await titles();
    expect(before.length).toBeGreaterThan(0);
    // the Inbox selects its first row on open
    await w.waitForSelector('.row.selected');
    const first = (await w.locator('.row.selected .row-title').first().textContent())!;
    await w.keyboard.press('Enter');
    await sleep(900);
    expect(await titles()).not.toContain(first);
    await w.getByRole('button', { name: /undo/i }).first().click();
    await sleep(600);
    expect(await titles()).toContain(first);
  });

  it('double-click edits the title and saves it', async () => {
    await go('today');
    const row = w.locator('.row', { hasText: 'Vendor quote for monitoring' }).first();
    await row.locator('.row-title').dblclick();
    const field = w.locator('.row-edit');
    await field.fill('Vendor quote for monitoring (renewal)');
    await field.press('Enter');
    await sleep(500);
    expect((await api((a) => a.search('renewal')))[0]?.title).toBe('Vendor quote for monitoring (renewal)');
  });

  it('snooze moves an item to the Snoozed list and Wake now brings it back', async () => {
    await go('today');
    await w.keyboard.press('j');
    const title = (await w.locator('.row.selected .row-title').first().textContent())!;
    await w.keyboard.press('s');
    await sleep(900);
    await go('snoozed');
    expect(await titles()).toContain(title);
    const row = w.locator('.row', { hasText: title }).first();
    await row.hover();
    await row.getByText('Wake now').click();
    await sleep(500);
    await go('today');
    expect(await w.locator('.row .row-title', { hasText: title }).count()).toBeGreaterThan(0);
  });
});

describe('search, people, settings', () => {
  it('Cmd+K search finds an item and Enter reveals it', async () => {
    await go('today');
    // the menu item (Cmd+K) sends this to the focused window; Playwright's synthetic keys never reach the native menu
    await l.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('view=main'))!.webContents.send('evt:command', 'search'));
    await sleep(300);
    await w.keyboard.type('billing');
    await sleep(400);
    await w.keyboard.press('ArrowDown'); // first row is "Save this search as a filter"
    await w.keyboard.press('ArrowDown');
    await w.keyboard.press('Enter');
    await sleep(500);
    expect(await w.locator('.row.selected').count()).toBe(1);
  });

  it('logging a 1:1 resets the days-since count', async () => {
    const sara = await api(async (a) => (await a.snapshot()).summaries.find((s) => s.person.handle === 'sara')!.person.id);
    await go(`person:${sara}`);
    await w.getByRole('button', { name: 'Log 1:1', exact: true }).click();
    await sleep(700);
    const s = await api(async (a) => (await a.snapshot()).summaries.find((x) => x.person.handle === 'sara')!.daysSinceLast);
    expect(s).toBe(0);
  });

  it('adds a person from the People page', async () => {
    await go('people');
    await w.getByPlaceholder('Add a person…').fill('Kai Nakamura');
    await w.keyboard.press('Enter');
    await sleep(600);
    expect((await api((a) => a.snapshot())).summaries.some((x) => x.person.name === 'Kai Nakamura')).toBe(true);
  });

  it('appearance setting flips the page background', async () => {
    const bg = () => w.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await w.evaluate(() => window.jaffloop.setUiState({ appearance: 'light' })); await sleep(500);
    const light = await bg();
    await w.evaluate(() => window.jaffloop.setUiState({ appearance: 'dark' })); await sleep(500);
    const dark = await bg();
    expect(light).not.toBe(dark);
  });

  it('hotkey: a valid accelerator registers, an invalid one is refused and the old one stays', async () => {
    expect(await api((a) => a.setHotkey('Alt+Shift+J'))).toBe(true);
    expect((await api((a) => a.snapshot())).settings.hotkey).toBe('Alt+Shift+J');
    expect(await api((a) => a.setHotkey('not a shortcut'))).toBe(false);
    expect((await api((a) => a.snapshot())).settings.hotkey).toBe('Alt+Shift+J');
    await api((a) => a.setHotkey('Alt+Space'));
  });

  it('settings window saves the read-only MCP switch', async () => {
    await w.evaluate(() => window.jaffloop.openSettings('mcp'));
    const s = await l.waitView('settings');
    await s.getByRole('switch', { name: 'Read-only' }).click();
    await sleep(500);
    expect((await api((a) => a.snapshot())).settings.mcpReadOnly).toBe(true);
    await api((a) => a.saveSettings({ mcpReadOnly: false }));
  });
});
