// 0.3.0: 1:1 notes, captured items, 1:1 history on the person page, source chip in the drawer, ready-made prompts in Settings.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import { PROMPTS } from '../../src/shared/prompts';
import { cleanup, launchApp, type Launched } from './helpers';

const OUT = process.env.JAFFLOOP_UI_SHOTS ?? fs.mkdtempSync(path.join(os.tmpdir(), 'jaffloop-1on1-'));
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const shot = (p: Page, name: string) => p.screenshot({ path: path.join(OUT, `${name}.png`) });

let l: Launched;
let w: Page;
let sara: { id: string; handle: string };
const NOTES = 'Talked about the promotion path and the on-call rotation.\nSara wants a stretch project.';

const go = async (nav: string) => { await w.evaluate((n) => window.jaffloop.openMain(n), nav); await sleep(450); };
const scheme = async (appearance: 'light' | 'dark') => { await w.evaluate((a) => window.jaffloop.setUiState({ appearance: a }), appearance); await sleep(400); };
const resize = async (view: string, width: number, height: number) => {
  await l.app.evaluate(({ BrowserWindow }, a) => {
    BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes(`view=${a.view}`))?.setContentSize(a.width, a.height);
  }, { view, width, height });
  await sleep(400);
};
const history = (id: string) => w.evaluate((p) => window.jaffloop.interactionHistory(p, 10), id);

beforeAll(async () => {
  l = await launchApp({ env: { JAFFLOOP_SNAPSHOT: '1' } });
  w = l.window;
  await resize('main', 1080, 800);
  await w.evaluate(() => window.jaffloop.setUiState({ lastSeenVersion: '0.3.0', welcomeSeen: true, appearance: 'dark' }));
  const people = await w.evaluate(async () => (await window.jaffloop.snapshot()).summaries.map((s) => ({ id: s.person.id, handle: s.person.handle })));
  sara = people.find((p) => p.handle === 'sara')!;
  await go(`person:${sara.id}`);
});
afterAll(async () => { await l.close(); cleanup(l); });

describe('1:1 mode and history', () => {
  let before = 0;
  let ids: string[] = [];

  it('takes notes, captures two items, ends and logs the 1:1', async () => {
    before = (await history(sara.id)).length;
    await w.getByText('Start 1:1', { exact: true }).first().click();
    await w.getByLabel('Meeting notes', { exact: true }).fill(NOTES);
    const capture = w.getByLabel('Capture', { exact: true });
    await capture.fill('owe send the promotion doc fri');
    await capture.press('Enter');
    await w.locator('[data-testid=captured] .mini-item').first().waitFor();
    await capture.fill('wait Sara draft of the stretch project');
    await capture.press('Enter');
    await w.waitForFunction(() => document.querySelectorAll('[data-testid=captured] .mini-item').length === 2);
    await w.getByLabel('What you said', { exact: true }).fill('I will sponsor the stretch project');
    await w.getByLabel('What you said', { exact: true }).press('Enter');
    await w.waitForFunction(() => document.querySelectorAll('[data-testid=captured] .mini-item').length === 3);
    const kinds = await w.locator('[data-testid=captured] .mini-kind').allTextContents();
    expect(kinds).toEqual(['owe', 'wait', 'said']);
    await sleep(300);
    await shot(w, '1on1-mode-dark');
    await scheme('light');
    await shot(w, '1on1-mode-light');
    await scheme('dark');

    await w.getByRole('button', { name: 'End 1:1 and log it', exact: true }).click();
    await w.getByText('1:1 logged with 3 action items').waitFor();
    await w.locator('[data-testid=history]').waitFor();
    const h = await history(sara.id);
    expect(h.length).toBe(before + 1);
    expect(h[0]!.interaction.notes).toBe(NOTES);
    expect(h[0]!.items.map((i) => i.title)).toHaveLength(3);
    ids = h[0]!.items.map((i) => i.id);
  });

  it('shows the notes and the items in the history, with their status', async () => {
    const entry = w.locator('[data-testid=history-entry]').first();
    await entry.waitFor();
    expect(await entry.locator('.hist-notes').textContent()).toContain('promotion path');
    expect(await entry.locator('.mini-item').count()).toBe(3);
    expect(await entry.locator('.mini-item[data-status=open]').count()).toBe(3);
    expect(await entry.locator('.mini-title').allTextContents()).toContain('send the promotion doc');
    await w.locator('[data-testid=history]').scrollIntoViewIfNeeded();
    await sleep(200);
    await shot(w, 'history-dark');
    await scheme('light');
    await shot(w, 'history-light');
    await scheme('dark');
  });

  it('expands long notes on click and keeps three lines otherwise', async () => {
    const notes = w.locator('[data-testid=history-entry]').first().locator('.hist-notes');
    expect(await notes.getAttribute('aria-expanded')).toBe('false');
    await notes.click();
    expect(await notes.getAttribute('aria-expanded')).toBe('true');
    await notes.click();
    expect(await notes.getAttribute('aria-expanded')).toBe('false');
  });

  it('follows a completed item and opens the drawer from a history row', async () => {
    await w.evaluate((id) => window.jaffloop.complete(id), ids[0]!);
    await w.waitForFunction(() => document.querySelectorAll('[data-testid=history-entry]:first-child .mini-item[data-status=done]').length === 1);
    const row = w.locator('[data-testid=history-entry]').first().locator('.mini-item[data-status=done]');
    await row.click();
    await w.getByLabel('Item details').waitFor();
    await w.keyboard.press('Escape');
  });

  it('collapses the section and remembers it', async () => {
    await w.getByRole('button', { name: /^1:1 history/ }).click();
    await sleep(300);
    expect(await w.locator('[data-testid=history-entry]').count()).toBe(0);
    const key = `person.${sara.id}.history`;
    expect((await w.evaluate(() => window.jaffloop.uiState())).collapsed).toContain(key);
    await w.getByRole('button', { name: /^1:1 history/ }).click();
    await sleep(300);
    expect(await w.locator('[data-testid=history-entry]').count()).toBeGreaterThan(0);
  });

  it('Cancel asks first when there is something to lose, and does not log', async () => {
    const count = (await history(sara.id)).length;
    await w.getByText('Start 1:1', { exact: true }).first().click();
    // nothing typed: leaves at once
    await w.getByText('Cancel', { exact: true }).click();
    await w.getByText('Start 1:1', { exact: true }).first().waitFor();
    await w.getByText('Start 1:1', { exact: true }).first().click();
    await w.getByLabel('Meeting notes', { exact: true }).fill('scratch');
    w.once('dialog', (d) => { void d.dismiss(); });
    await w.getByText('Cancel', { exact: true }).click();
    await sleep(200);
    expect(await w.getByLabel('Meeting notes', { exact: true }).count()).toBe(1); // still in the mode
    w.once('dialog', (d) => { void d.accept(); });
    await w.getByText('Cancel', { exact: true }).click();
    await w.getByText('Start 1:1', { exact: true }).first().waitFor();
    expect((await history(sara.id)).length).toBe(count);
  });

  it('shows the empty state for a person without 1:1s', async () => {
    const all = await w.evaluate(async () => (await window.jaffloop.snapshot()).summaries.map((s) => s.person.id));
    let empty: string | undefined;
    for (const id of all) if ((await history(id)).length === 0) { empty = id; break; }
    if (!empty) { await w.evaluate(async () => { await window.jaffloop.addPerson('Newcomer Nobody'); }); await sleep(300); empty = (await w.evaluate(async () => (await window.jaffloop.snapshot()).summaries.find((s) => s.person.handle === 'newcomer.nobody')!.person.id)); }
    await go(`person:${empty}`);
    await w.getByText('No 1:1s logged yet. Use Start 1:1 to take notes and capture action items.').waitFor();
    await go(`person:${sara.id}`);
  });
});

describe('source chip', () => {
  it('shows the label in the drawer, opens the link and keeps the id in the tooltip', async () => {
    const item = await w.evaluate(async () => (await window.jaffloop.items({ status: 'open' }))[0]!);
    await w.evaluate(([id]) => window.jaffloop.update(id!, { sourceLabel: 'jira', sourceUrl: 'https://example.com/PLAT-1', externalId: 'jira:PLAT-1:9' }), [item.id]);
    await go('today');
    // the drawer opens from the keyboard: select the row, then space
    await w.locator(`[data-item-id="${item.id}"]`).first().click({ position: { x: 4, y: 4 } });
    await w.keyboard.press('Space');
    const chip = w.getByRole('button', { name: 'Open in jira' });
    await chip.waitFor();
    expect(await chip.getAttribute('title')).toContain('jira:PLAT-1:9');
    await w.keyboard.press('Escape'); await w.keyboard.press('Escape');
  });
});

describe('ready-made prompts', () => {
  it('lists all built-ins, shows their text and copies the prompt', async () => {
    await w.evaluate(() => window.jaffloop.openSettings('mcp'));
    const s = await l.waitView('settings');
    await s.waitForSelector('[data-testid=prompt-card]');
    expect(await s.locator('[data-testid=prompt-card]').count()).toBe(PROMPTS.length);
    expect(await s.getByText('No other connector needed').count()).toBeGreaterThan(0);
    expect(await s.getByText('since: last Friday (optional)').count()).toBeGreaterThan(0);
    expect(await s.getByText('never creates copies').count()).toBeGreaterThan(0);

    const card = s.locator('[data-prompt=monday-sweep]');
    await card.getByRole('button', { name: /Copy prompt/ }).click();
    await card.getByText('Copied').waitFor();
    const clip = await l.app.evaluate(({ clipboard }) => clipboard.readText());
    expect(clip).toContain('Read my Outlook sent mail and calendar from last Friday until now');
    expect(clip).not.toContain('{{');

    await card.getByText('Show text').click();
    expect(await card.locator('.pr-text').textContent()).toBe(clip);
    await card.scrollIntoViewIfNeeded();
    await sleep(200);
    await shot(s, 'prompts-dark');
    await w.evaluate(() => window.jaffloop.setUiState({ appearance: 'light' }));
    await sleep(500);
    await shot(s, 'prompts-light');
    await w.evaluate(() => window.jaffloop.setUiState({ appearance: 'dark' }));
  });
});
