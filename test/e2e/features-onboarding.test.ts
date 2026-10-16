// 0.4.0: "Add your team" wizard, the People page dialog, position (title) everywhere. Runs on an EMPTY database first.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import { cleanup, launchApp, type Launched } from './helpers';

const OUT = process.env.JAFFLOOP_UI_SHOTS ?? fs.mkdtempSync(path.join(os.tmpdir(), 'jaffloop-onboarding-'));
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let l: Launched;
let w: Page;
const people = () => w.evaluate(async () => (await window.jaffloop.snapshot()).summaries.map((s) => s.person));
const dialog = () => w.getByRole('dialog', { name: 'Add your team' });
const go = async (nav: string) => { await w.evaluate((n) => window.jaffloop.openMain(n), nav); await sleep(350); };

beforeAll(async () => {
  l = await launchApp({ seed: false, env: { JAFFLOOP_SNAPSHOT: '1' } });
  w = l.window;
  await l.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('view=main'))!.setContentSize(1080, 800));
});
afterAll(async () => { await l.close(); cleanup(l); });

describe('welcome to wizard on an empty database', () => {
  it('the welcome screen offers "Add your team" and opens the wizard', async () => {
    await w.getByRole('dialog', { name: 'Welcome to Jaffloop' }).waitFor();
    await w.screenshot({ path: path.join(OUT, 'welcome-add-team.png') });
    await w.getByRole('dialog', { name: 'Welcome to Jaffloop' }).getByRole('button', { name: 'Add your team' }).click();
    await dialog().waitFor();
    expect(await w.getByRole('dialog', { name: 'Welcome to Jaffloop' }).count()).toBe(0);
    expect(await people()).toHaveLength(0);
  });

  it('adds two people with position, cadence, birthday and emails, and lists them as it goes', async () => {
    const d = dialog();
    await d.getByLabel('Name', { exact: true }).fill('Sara Lindqvist');
    await d.getByLabel('Position').fill('Staff engineer');
    await d.getByRole('button', { name: 'Every 7 days' }).click();
    await d.getByLabel('Birthday month').selectOption({ label: 'March' });
    await d.getByLabel('Birthday day').selectOption('14');
    await d.getByLabel('Work emails').fill('sara@example.com');
    await w.screenshot({ path: path.join(OUT, 'wizard-form.png') });
    await d.getByRole('button', { name: 'Save and add another' }).click();
    await d.getByTestId('added-person').first().waitFor();
    expect(await d.getByLabel('Name', { exact: true }).inputValue()).toBe('');
    expect(await d.getByTestId('added-person').first().textContent()).toContain('Staff engineer');

    // second person: custom cadence with the stepper, saved with Cmd+Enter
    await d.getByLabel('Name', { exact: true }).fill('Amir Haddad');
    await d.getByLabel('Position').fill('Senior engineer');
    await d.getByRole('button', { name: 'More days' }).click();
    expect(await d.getByTestId('cadence-text').textContent()).toBe('every 15 days');
    await w.keyboard.press('Meta+Enter');
    await w.waitForFunction(() => document.querySelectorAll('[data-testid=added-person]').length === 2);
    await w.screenshot({ path: path.join(OUT, 'wizard-two-added.png') });

    const list = await people();
    const sara = list.find((p) => p.handle === 'sara.lindqvist')!;
    const amir = list.find((p) => p.handle === 'amir.haddad')!;
    expect(sara).toMatchObject({ name: 'Sara Lindqvist', title: 'Staff engineer', relation: 'report', cadenceDays: 7, birthday: '03-14', matchEmails: 'sara@example.com' });
    expect(amir).toMatchObject({ name: 'Amir Haddad', title: 'Senior engineer', cadenceDays: 15, birthday: null });
  });

  it('reports a person who is already in the list and overwrites nothing', async () => {
    const d = dialog();
    await d.getByLabel('Name', { exact: true }).fill('sara lindqvist');
    await d.getByLabel('Position').fill('Intern');
    await d.getByRole('button', { name: 'Save and add another' }).click();
    await d.getByRole('alert').waitFor();
    expect(await d.getByRole('alert').textContent()).toBe('Sara Lindqvist is already in your list');
    expect((await people()).find((p) => p.handle === 'sara.lindqvist')!.title).toBe('Staff engineer');
    expect(await d.getByTestId('added-person').count()).toBe(2);
  });

  it('Done with an empty form closes the wizard and opens People with both of them', async () => {
    const d = dialog();
    await d.getByLabel('Name', { exact: true }).fill('');
    await d.getByRole('button', { name: 'Done' }).click();
    await d.waitFor({ state: 'detached' });
    await w.getByText('Added 2 people').waitFor();
    const rows = await w.locator('.people-list .prow').allTextContents();
    expect(rows).toHaveLength(2);
    expect(rows.join('|')).toContain('Staff engineer · report');
    expect(rows.join('|')).toContain('Senior engineer · report');
    await w.screenshot({ path: path.join(OUT, 'people-with-titles.png') });
  });

  it('Escape closes the wizard without saving the typed person', async () => {
    await w.evaluate(() => window.jaffloop.openMain('add-people'));
    await dialog().waitFor();
    await dialog().getByLabel('Name', { exact: true }).fill('Nobody Saved');
    await w.keyboard.press('Escape');
    await dialog().waitFor({ state: 'detached' });
    expect((await people()).some((p) => p.name === 'Nobody Saved')).toBe(false);
  });
});

describe('People page and person page', () => {
  it('"Add person…" opens the form in a dialog, then the new person\'s page with the position under the name', async () => {
    await go('people');
    await w.getByRole('button', { name: 'Add person…' }).click();
    const d = w.getByRole('dialog', { name: 'Add person' });
    await d.waitFor();
    await d.getByLabel('Name', { exact: true }).fill('Priya Nair');
    await d.getByLabel('Position').fill('Junior engineer');
    await d.getByLabel('Relation').selectOption('peer');
    await d.getByRole('button', { name: 'No cadence' }).click();
    expect(await d.getByTestId('cadence-text').textContent()).toBe('no cadence');
    await d.getByRole('button', { name: 'Add person' }).click();
    await w.locator('.subtitle', { hasText: 'Junior engineer · peer' }).waitFor();
    expect((await people()).find((p) => p.handle === 'priya.nair')).toMatchObject({ title: 'Junior engineer', relation: 'peer', cadenceDays: null });
    expect(await w.locator('h1.page-title').textContent()).toBe('Priya Nair');
  });

  it('the edit sheet changes the position, the grid shows it, and the people palette finds it', async () => {
    await w.getByRole('button', { name: 'Person options' }).click();
    await w.getByRole('menuitem', { name: 'Edit person…' }).click();
    const pos = w.getByRole('dialog').getByLabel('Position');
    await pos.fill('Engineering manager');
    await pos.press('Enter');
    await w.locator('.subtitle', { hasText: 'Engineering manager · peer' }).waitFor();
    expect((await people()).find((p) => p.handle === 'priya.nair')!.title).toBe('Engineering manager');

    await go('people');
    await w.evaluate(() => window.jaffloop.setUiState({ peopleLayout: 'grid' }));
    await w.locator('.pcard', { hasText: 'Engineering manager · peer' }).waitFor();
    await w.evaluate(() => window.jaffloop.setUiState({ peopleLayout: 'list' }));

    await w.keyboard.press('Meta+p');
    const input = w.getByLabel('Person', { exact: true });
    await input.fill('engineering man');
    await w.locator('.palette-row').first().waitFor();
    expect(await w.locator('.palette-row').allTextContents()).toEqual([expect.stringContaining('Priya Nair')]);
    expect(await w.locator('.palette-row').first().textContent()).toContain('Engineering manager');
    await w.keyboard.press('Escape');
  });

  it('the empty People page offers "Add your team", and Settings → General has "Add people…"', async () => {
    // an empty database again: a second app against a fresh directory
    const e = await launchApp({ seed: false, env: { JAFFLOOP_SNAPSHOT: '1' } });
    try {
      await e.window.getByRole('dialog', { name: 'Welcome to Jaffloop' }).getByRole('button', { name: 'Start' }).click();
      await e.window.evaluate(() => window.jaffloop.openMain('people'));
      await e.window.getByRole('main').getByRole('button', { name: 'Add your team' }).click();
      await e.window.getByRole('dialog', { name: 'Add your team' }).waitFor();
      await e.window.keyboard.press('Escape');

      await e.window.evaluate(() => window.jaffloop.openSettings('general'));
      const s = await e.waitView('settings');
      await s.getByRole('button', { name: 'Add people…' }).click();
      await e.window.getByRole('dialog', { name: 'Add your team' }).waitFor();
      expect(await e.window.locator('h1.page-title').textContent()).toBe('People');
    } finally { await e.close(); cleanup(e); }
  });
});
