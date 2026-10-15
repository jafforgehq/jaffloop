// 0.2.0 reports screens against the real app and the demo data: weekly review, Done extras, wrap-up card, People rhythm, person editor.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from 'playwright-core';
import { cleanup, launchApp, type Launched } from './helpers';

let l: Launched;
let w: Page;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const go = async (nav: string) => { await w.evaluate((n) => window.jaffloop.openMain(n), nav); await sleep(500); };
const clipboard = () => l.app.evaluate(({ clipboard }) => clipboard.readText());
const SHOTS = process.env.JAFFLOOP_REPORT_SHOTS; // optional folder for screenshots (dark and light)
const shot = async (name: string) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await w.screenshot({ path: path.join(SHOTS, `${name}.png`) }); } };
const bothThemes = async (name: string) => {
  for (const appearance of ['dark', 'light'] as const) {
    await w.evaluate((a) => window.jaffloop.setUiState({ appearance: a }), appearance);
    await sleep(300);
    await shot(`${name}-${appearance}`);
  }
  await w.evaluate(() => window.jaffloop.setUiState({ appearance: 'dark' }));
};

beforeAll(async () => {
  l = await launchApp({ env: { JAFFLOOP_SNAPSHOT: '1' } });
  w = l.window;
  await l.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('view=main'))?.setContentSize(1100, 820));
  await w.evaluate(() => window.jaffloop.setUiState({ lastSeenVersion: '9.9.9', welcomeSeen: true, appearance: 'dark', wrapupDay: '2099-01-01' }));
  await sleep(300);
  // the card may already have fired at launch (before wrapupDay was set): close it so it does not hide other screens
  const early = w.getByTestId('wrapup');
  if (await early.count()) await early.getByRole('button', { name: 'Dismiss' }).click();
});
afterAll(async () => { await l.close(); cleanup(l); });

describe('weekly review', () => {
  it('shows the stats and sections, switches weeks and copies Markdown', async () => {
    await w.getByRole('button', { name: /^Review/ }).click();
    await w.getByRole('heading', { name: 'Weekly review' }).waitFor();
    expect(await w.getByTestId('stat-closed').count()).toBe(1);
    expect(await w.getByTestId('kept-rate').first().innerText()).toMatch(/promises? kept on time, \d+%/);
    expect(await w.getByText('Overdue promises', { exact: true }).count()).toBeGreaterThan(0);
    expect(await w.getByText('People off cadence', { exact: true }).count()).toBeGreaterThan(0);
    await shot('review-dark');
    await bothThemes('review');

    await w.getByRole('button', { name: 'Copy as Markdown' }).click();
    await sleep(400);
    const md = await clipboard();
    expect(md).toContain('## Week of');
    expect(md).toContain('### Done');
    expect(md).toContain('### Still open');
    expect(md).toContain('### Needs attention');
    expect(await w.getByText('Copied the week as Markdown').count()).toBeGreaterThan(0);

    await w.getByRole('button', { name: 'Previous week', exact: true }).click();
    await sleep(400);
    expect(await w.locator('.subtitle').innerText()).toMatch(/ to \d+ \w+/);
    await w.getByRole('button', { name: 'This week', exact: true }).click();
  });

  it('Log 1:1 on an off-cadence person clears them from the section', async () => {
    const before = await w.locator('.row.offcad').count();
    expect(before).toBeGreaterThan(0);
    await w.locator('.row.offcad').first().getByRole('button', { name: /^Log 1:1/ }).click();
    await sleep(600);
    expect(await w.locator('.row.offcad').count()).toBe(before - 1);
  });
});

describe('done page', () => {
  it('has the kept-rate line, copies the week and expands Today in review', async () => {
    await go('done');
    expect(await w.getByTestId('kept-rate').innerText()).toMatch(/kept on time/);
    await w.getByRole('button', { name: 'Copy week as Markdown' }).click();
    await sleep(300);
    expect(await clipboard()).toContain('## Week of');

    const panel = w.getByRole('button', { name: /Today in review/ });
    expect(await panel.getAttribute('aria-expanded')).toBe('false');
    await panel.click();
    expect(await panel.getAttribute('aria-expanded')).toBe('true');
    expect(await w.locator('.tl-row').count()).toBeGreaterThan(0); // the demo data completes items today
    expect(await w.locator('.tl-row').first().innerText()).toMatch(/\d{1,2}:\d{2}/);
    await bothThemes('done');
  });
});

describe('people page', () => {
  it('shows the rhythm grid and load bars', async () => {
    await go('people');
    await w.getByTestId('rhythm').waitFor();
    const rows = await w.getByTestId('heat-row').count();
    expect(rows).toBe(5);
    expect(await w.locator('.heat-row').first().locator('.heat-cell').count()).toBe(12);
    expect(await w.locator('.heat-row .heat-cell.now').count()).toBe(rows);
    expect(await w.locator('.heat-row .heat-cell.on').count()).toBeGreaterThan(0);
    expect(await w.locator('.prow .loadbar').count()).toBe(5);
    await bothThemes('people-list');
    await w.evaluate(() => window.jaffloop.setUiState({ peopleLayout: 'grid' }));
    await sleep(300);
    expect(await w.locator('.pcard .loadbar').count()).toBe(5);
    await bothThemes('people-grid');
    await w.evaluate(() => window.jaffloop.setUiState({ peopleLayout: 'list' }));
  });
});

describe('person page', () => {
  it('edits the start date and birthday in the editor and saves them', async () => {
    const sara = await w.evaluate(async () => (await window.jaffloop.snapshot()).summaries.find((s) => s.person.handle === 'sara')!.person.id);
    await go(`person:${sara}`);
    await w.getByRole('button', { name: 'Person options' }).click();
    await w.getByRole('menuitem', { name: 'Edit person…' }).click();
    await w.getByLabel('Start date', { exact: true }).fill('2021-03-15');
    await w.getByLabel('Birthday (year is ignored)').fill('1990-07-04');
    await bothThemes('person-editor');
    await w.getByRole('button', { name: 'Save', exact: true }).click();
    await sleep(500);
    const p = await w.evaluate(async (id) => (await window.jaffloop.snapshot()).summaries.find((s) => s.person.id === id)!.person, sara);
    expect(p.startDate).toBe('2021-03-15');
    expect(p.birthday).toBe('07-04');

    await w.getByRole('button', { name: 'Person options' }).click();
    await w.getByRole('menuitem', { name: 'Edit person…' }).click();
    await w.getByRole('button', { name: 'Clear start date' }).click();
    await w.getByRole('button', { name: 'Save', exact: true }).click();
    await sleep(500);
    expect((await w.evaluate(async (id) => (await window.jaffloop.snapshot()).summaries.find((s) => s.person.id === id)!.person, sara)).startDate).toBeNull();
  });

  it('shows the streak chip exactly when the core reports a streak', async () => {
    const amir = await w.evaluate(async () => (await window.jaffloop.snapshot()).summaries.find((s) => s.person.handle === 'amir')!.person.id);
    await w.evaluate((id) => window.jaffloop.logInteraction(id, '1on1'), amir);
    await go(`person:${amir}`);
    await sleep(500);
    const streak = await w.evaluate(async (id) => window.jaffloop.onTimeStreak(id), amir);
    expect(await w.getByTestId('streak').count()).toBe(streak > 0 ? 1 : 0);
    await shot('person-streak-dark');
  });
});

describe('today dates chips and wrap-up card', () => {
  it('shows anniversary and birthday chips under Check in and dismisses one', async () => {
    await go('today');
    await w.getByTestId('date-chips').waitFor();
    await w.getByTestId('date-chips').scrollIntoViewIfNeeded();
    const n = await w.locator('.date-chip').count();
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(3);
    await shot('today-dates-dark');
    await bothThemes('today-dates');
    await w.locator('.date-chip-x').first().click();
    expect(await w.locator('.date-chip').count()).toBe(n - 1);
  });

  it('shows the wrap-up card once after the end-of-day time on a weekday', async () => {
    const weekday = new Date().getDay() % 6 !== 0;
    await w.evaluate(async () => { await window.jaffloop.saveSettings({ eodTime: '00:00' }); await window.jaffloop.setUiState({ wrapupDay: '' }); });
    await w.reload();
    await w.waitForFunction(() => document.body?.dataset.ready === '1');
    await sleep(900);
    if (!weekday) { expect(await w.getByTestId('wrapup').count()).toBe(0); return; }
    const card = w.getByTestId('wrapup');
    await card.waitFor({ timeout: 5000 });
    expect(await card.innerText()).toMatch(/Wrapping up: you closed \d+ today, \d+ still overdue\./);
    await shot('wrapup-dark');
    await card.getByRole('button', { name: 'Open review' }).click();
    await w.getByRole('heading', { name: 'Weekly review' }).waitFor();
    expect(await w.getByTestId('wrapup').count()).toBe(0);
    // never twice in a day
    await w.reload();
    await w.waitForFunction(() => document.body?.dataset.ready === '1');
    await sleep(900);
    expect(await w.getByTestId('wrapup').count()).toBe(0);
  });
});
