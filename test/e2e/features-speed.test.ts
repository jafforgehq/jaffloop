// 0.2.0 speed features in the real app: people palette, Today person filter, nudge, links, templates, ambient capture context,
// snooze until the next 1:1, pause notifications, ring burst. Screenshots go to JAFFLOOP_SHOTS (default: a temp folder).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Page } from 'playwright-core';
import { cleanup, launchApp, type Launched } from './helpers';

const OUT = process.env.JAFFLOOP_SHOTS ?? fs.mkdtempSync(path.join(os.tmpdir(), 'jaffloop-speed-'));
fs.mkdirSync(OUT, { recursive: true });
const shot = (p: Page, name: string) => p.screenshot({ path: path.join(OUT, `${name}.png`) });

let l: Launched;
let w: Page;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const api = <T>(fn: (a: Window['jaffloop']) => Promise<T>) => w.evaluate(`(${fn.toString()})(window.jaffloop)`) as Promise<T>;
const go = async (nav: string) => { await w.evaluate((n) => window.jaffloop.openMain(n), nav); await sleep(350); };
const rowOf = (text: string) => w.locator('.row', { hasText: text }).first();

beforeAll(async () => {
  l = await launchApp({ env: { JAFFLOOP_SNAPSHOT: '1' } });
  w = l.window;
  await l.app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('view=main'))?.setContentSize(1080, 800); });
  await w.evaluate(() => window.jaffloop.setUiState({ lastSeenVersion: '0.1.0', welcomeSeen: true, appearance: 'dark' }));
  await go('today');
});
afterAll(async () => { await l.close(); cleanup(l); });

describe('people palette', () => {
  it('Cmd+P opens it, typing filters, Enter goes to the person, Esc closes', async () => {
    await w.keyboard.press('Meta+p');
    const pal = w.locator('[aria-label="Jump to a person"]');
    await pal.waitFor();
    expect(await pal.locator('.people-row').count()).toBe(5);
    expect(await pal.textContent()).toContain('last 1:1');
    await shot(w, 'people-palette');
    await pal.locator('input').fill('lind');
    expect(await pal.locator('.people-row').count()).toBe(1);
    await w.keyboard.press('Enter');
    await w.waitForFunction(() => document.title === 'Sara Lindqvist');
    await w.keyboard.press('Control+p');
    await pal.waitFor();
    await w.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Person'); // effects have run
    await w.keyboard.press('Escape');
    await pal.waitFor({ state: 'detached' });
  });
});

describe('click a person to filter Today', () => {
  it('the avatar cell filters, the chip and Esc clear it', async () => {
    await go('today');
    const all = await w.locator('.row').count();
    await w.locator('.row .person-hit', { hasText: 'Amir' }).first().click();
    await w.locator('.filter-chip').waitFor();
    expect(await w.locator('.filter-chip').textContent()).toContain('Showing Amir');
    const people = await w.locator('.row .c-person').allTextContents();
    expect(people.length).toBeGreaterThan(0);
    expect(people.length).toBeLessThan(all);
    expect(people.every((t) => t.includes('Amir'))).toBe(true);
    await shot(w, 'today-filtered');
    await w.locator('.filter-chip button').click();
    await w.locator('.filter-chip').waitFor({ state: 'detached' });
    expect(await w.locator('.row').count()).toBe(all);
    // clicking the cell does not select the row, so Esc clears the filter directly
    await w.locator('.row .person-hit', { hasText: 'Amir' }).first().click();
    await w.locator('.filter-chip').waitFor();
    await w.keyboard.press('Escape');
    await w.locator('.filter-chip').waitFor({ state: 'detached' });
  });

  it('from another page it goes to Today', async () => {
    await go('tag:rfc');
    await w.locator('.row .person-hit', { hasText: 'Sara' }).first().click();
    await w.locator('.filter-chip').waitFor();
    expect(await w.locator('.page-title').textContent()).toBe('Today');
    await w.locator('.filter-chip button').click();
  });
});

describe('nudge', () => {
  it('Copy nudge message puts the text on the clipboard', async () => {
    await go('today');
    const row = rowOf('API spec for the billing service');
    await row.hover();
    await row.getByRole('button', { name: 'More actions' }).click();
    await w.getByRole('menuitem', { name: 'Copy nudge message' }).click();
    const text = await l.app.evaluate(({ clipboard }) => clipboard.readText());
    expect(text).toBe('Hi Amir, quick check-in on API spec for the billing service. Any update?');
    expect(await w.locator('.toast').textContent()).toContain('Nudge copied');
  });

  it('is not offered for a promise', async () => {
    const row = rowOf('Approve headcount request');
    await row.hover();
    await row.getByRole('button', { name: 'More actions' }).click();
    expect(await w.getByRole('menuitem', { name: 'Copy nudge message' }).count()).toBe(0);
    await w.keyboard.press('Escape');
  });
});

describe('links', () => {
  it('Jira keys (with a base URL) and URLs are anchors and clicking opens them externally', async () => {
    await w.evaluate(() => window.jaffloop.saveSettings({ jiraBaseUrl: 'https://acme.atlassian.net/browse/' }));
    await w.evaluate(() => window.jaffloop.capture('todo fix PLAT-482 and read https://example.com/doc today'));
    await go('today');
    await l.app.evaluate(({ shell }) => { (globalThis as { __opened?: string[] }).__opened = []; (shell as { openExternal: unknown }).openExternal = async (u: string) => { (globalThis as { __opened?: string[] }).__opened!.push(u); }; });
    const row = rowOf('fix PLAT-482');
    const links = row.locator('a.tlink');
    expect(await links.count()).toBe(2);
    expect(await links.nth(0).getAttribute('href')).toBe('https://acme.atlassian.net/browse/PLAT-482');
    expect(await links.nth(1).getAttribute('href')).toBe('https://example.com/doc');
    await shot(w, 'today-links');
    await links.nth(0).click();
    await links.nth(1).click();
    await sleep(200);
    expect(await l.app.evaluate(() => (globalThis as { __opened?: string[] }).__opened)).toEqual(['https://acme.atlassian.net/browse/PLAT-482', 'https://example.com/doc']);
    // a click on a link neither selects the row nor starts editing
    expect(await w.locator('.row-edit').count()).toBe(0);
    // double-click elsewhere on the title still edits
    await row.locator('.row-title').dblclick({ position: { x: 4, y: 6 } });
    await w.locator('.row-edit').waitFor();
    await w.keyboard.press('Escape');
  });

  it('without a Jira base URL keys stay plain text, URLs stay links', async () => {
    await w.evaluate(() => window.jaffloop.saveSettings({ jiraBaseUrl: '' }));
    await sleep(400);
    expect(await rowOf('fix PLAT-482').locator('a.tlink').count()).toBe(1);
  });
});

describe('snooze until the next 1:1', () => {
  it('is offered for a person with a cadence and snoozes to 09:00 that day', async () => {
    await go('today');
    const row = rowOf('Approve headcount request'); // Amir: cadence 7, last 1:1 five days ago
    await row.hover();
    await row.getByRole('button', { name: 'Snooze' }).click();
    const entry = w.getByRole('menuitem', { name: /Until next 1:1 with Amir/ });
    await entry.waitFor();
    await shot(w, 'snooze-menu');
    await entry.click();
    await sleep(900);
    const [it] = await api((a) => a.search('Approve headcount request'));
    expect(it!.snoozedUntil).not.toBeNull();
    expect(new Date(it!.snoozedUntil!).getHours()).toBe(9);
    expect(it!.snoozedUntil!).toBeGreaterThan(Date.now());
  });

  it('is not offered for someone who is already past their cadence (Sara)', async () => {
    await go('today');
    const row = rowOf('Review RFC for the on-call rotation');
    await row.hover();
    await row.getByRole('button', { name: 'Snooze' }).click();
    await w.getByRole('menuitem', { name: 'Tomorrow' }).first().waitFor();
    expect(await w.getByRole('menuitem', { name: /Until next 1:1/ }).count()).toBe(0);
    await w.keyboard.press('Escape');
  });
});

describe('capture window', () => {
  it('shows the person context once the @handle is complete and expands templates end to end', async () => {
    const sara = (await api((a) => a.snapshot())).summaries.find((s) => s.person.handle === 'sara')!.person;
    await w.evaluate((p) => window.jaffloop.savePerson({ ...p, notes: 'Wants to grow into a staff role. Prefers async updates and written feedback before the 1:1.' }), sara);
    await w.evaluate(() => window.jaffloop.saveSettings({ captureTemplates: [{ name: 'prep', lines: ['bring @{person} how are things going', 'bring @{person} career goals {rest}', 'todo prep notes for @{person}'] }] }));
    await sleep(500);
    await w.evaluate(() => window.jaffloop.openCapture());
    const cap = await l.waitView('capture');
    const input = cap.locator('input').first();
    await input.fill('owe @sara ');
    await cap.locator('.cap-ambient').waitFor();
    const ambient = (await cap.locator('.cap-ambient').textContent())!;
    expect(ambient).toContain('Wants to grow into a staff role');
    expect(ambient).toContain('Review RFC for the on-call rotation');
    expect(ambient).toContain('last 1:1 23 days ago');
    await shot(cap, 'capture-ambient');
    // while the handle is still being typed there are suggestions and no ambient line
    await input.fill('owe @sa');
    expect(await cap.locator('.cap-ambient').count()).toBe(0);
    expect(await cap.locator('.cap-sug').count()).toBeGreaterThan(0);

    await input.fill('prep @sara soon');
    await cap.getByText('template: prep, 3 items').waitFor();
    expect(await cap.locator('.cap-prev').count()).toBe(3);
    await shot(cap, 'capture-template');
    const before = (await api((a) => a.items({ status: 'open' }))).length;
    await input.press('Enter');
    await sleep(800);
    const items = await api((a) => a.items({ status: 'open' }));
    expect(items.length).toBe(before + 3);
    const titles = items.map((i) => i.title);
    expect(titles).toContain('how are things going');
    expect(titles).toContain('career goals soon');
    expect(titles).toContain('prep notes for');
  });
});

describe('settings', () => {
  it('pause 1 hour, status line, resume', async () => {
    await w.evaluate(() => window.jaffloop.openSettings('notifications'));
    const s = await l.waitView('settings');
    await s.getByRole('button', { name: 'Pause 1 hour' }).click();
    await s.getByTestId('pause-status').waitFor();
    expect(await s.getByTestId('pause-status').textContent()).toContain('Notifications are paused until');
    const until = (await api((a) => a.uiState())).pauseUntil!;
    expect(until - Date.now()).toBeGreaterThan(3_500_000);
    await shot(s, 'settings-notifications-paused');
    await s.getByRole('button', { name: 'Pause until tomorrow' }).click();
    await sleep(300);
    const tomorrow = (await api((a) => a.uiState())).pauseUntil!;
    expect(new Date(tomorrow).getHours()).toBe(9);
    await s.getByRole('button', { name: 'Resume' }).click();
    await s.getByTestId('pause-status').waitFor({ state: 'detached' });
    expect((await api((a) => a.uiState())).pauseUntil).toBeNull();
  });

  it('tray text, show dates, Jira base URL and templates are saved from General', async () => {
    await w.evaluate(() => window.jaffloop.openSettings('general'));
    const s = await l.waitView('settings');
    await s.getByRole('tab', { name: 'General' }).click();
    await s.getByLabel('Menu bar shows').selectOption('next');
    await s.getByRole('switch', { name: 'Show anniversaries and birthdays' }).click();
    await s.getByLabel('Jira base URL').fill('https://acme.atlassian.net/browse');
    await s.getByLabel('Jira base URL').blur();
    await sleep(500);
    const ui = await api((a) => a.uiState());
    expect(ui.trayText).toBe('next');
    expect(ui.showDates).toBe(false);
    expect((await api((a) => a.snapshot())).settings.jiraBaseUrl).toBe('https://acme.atlassian.net/browse/');
    // templates: a reserved name is refused, a good one is saved
    await s.getByRole('button', { name: 'Add template' }).click();
    await s.getByLabel('Template 2 name').fill('owe');
    await s.getByLabel('Template 2 lines').fill('todo x @{person}');
    await s.getByLabel('Template 2 lines').blur();
    expect(await s.getByText('already a capture keyword').count()).toBe(1);
    await s.getByLabel('Template 2 name').fill('oneone');
    await s.getByLabel('Template 2 lines').blur();
    await sleep(500);
    expect((await api((a) => a.snapshot())).settings.captureTemplates.map((t) => t.name)).toEqual(['prep', 'oneone']);
    await shot(s, 'settings-general');
  });
});

describe('ring burst', () => {
  it('plays once when Overdue, Slipping and Inbox all become empty', async () => {
    await go('today');
    expect(await w.locator('.burst').count()).toBe(0);
    const t = (await api((a) => a.snapshot())).today;
    const ids = [...t.overdue, ...t.slipping, ...t.inbox].map((i) => i.id);
    expect(ids.length).toBeGreaterThan(0);
    await w.evaluate(async (all) => { for (const id of all) await window.jaffloop.complete(id); }, ids);
    await w.locator('.burst').waitFor({ state: 'attached', timeout: 5000 });
    expect(await w.locator('.burst-dot').count()).toBe(14);
    await sleep(900);
    await shot(w, 'burst');
    expect((await api((a) => a.uiState())).burstDay).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await w.locator('.burst').waitFor({ state: 'detached', timeout: 4000 });
  });
});
