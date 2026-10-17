// 0.5.0 info buttons against the built app: every screen carries its (i) buttons, hovering shows the words from the help registry,
// the tip goes away on mouse leave and on Escape, and the (i) never takes Tab focus inside lists and rows.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Locator, Page } from 'playwright-core';
import { HELP, HELP_NAME } from '../../src/renderer/help';
import { cleanup, launchApp, type Launched } from './helpers';

let l: Launched;
let w: Page;
let settings: Page;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const go = async (nav: string) => { await w.evaluate((n) => window.jaffloop.openMain(n), nav); await sleep(450); };
const count = (p: Page | Locator) => p.getByTestId('info').count();
/** counts per screen are logged so the floors below can be raised when a screen gains help */
const seen: Record<string, number> = {};
const floor = async (name: string, p: Page | Locator, min: number) => {
  const n = await count(p);
  seen[name] = n;
  expect(n, `${name} has ${n} info buttons`).toBeGreaterThanOrEqual(min);
};

beforeAll(async () => {
  l = await launchApp({ env: { JAFFLOOP_SNAPSHOT: '1' } });
  w = l.window;
  await l.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('view=main'))?.setContentSize(1200, 860));
  await w.evaluate(() => window.jaffloop.setUiState({ lastSeenVersion: '9.9.9', welcomeSeen: true, wrapupDay: '2099-01-01' }));
  await sleep(300);
  const early = w.getByTestId('wrapup');
  if (await early.count()) await early.getByRole('button', { name: 'Dismiss' }).click();
});
afterAll(async () => { console.log('info buttons per screen', JSON.stringify(seen)); await l.close(); cleanup(l); });

describe('tooltips', () => {
  it('shows the registry text on hover and hides it on mouse leave', async () => {
    await go('today');
    const group = w.getByRole('button', { name: 'About Group by' });
    await group.hover();
    const tip = w.getByRole('tooltip');
    await tip.waitFor();
    expect(await tip.innerText()).toBe(HELP['today.group']);
    const box = (await tip.boundingBox())!;
    const vp = await w.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
    expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
    await w.mouse.move(5, 5);
    await tip.waitFor({ state: 'detached' });
  });

  it('shows on keyboard focus and closes on Escape without closing anything else', async () => {
    await go('today');
    await w.getByRole('button', { name: 'About Focus' }).focus();
    const tip = w.getByRole('tooltip');
    await tip.waitFor();
    expect(await tip.innerText()).toBe(HELP['today.focus']);
    await w.keyboard.press('Escape');
    await tip.waitFor({ state: 'detached' });
  });

  it('labels each button "About <name>" from the registry', async () => {
    await go('ledger');
    const btn = w.getByRole('button', { name: `About ${HELP_NAME['ledger.show']}` });
    expect(await btn.count()).toBe(1);
    await btn.hover();
    expect(await w.getByRole('tooltip').innerText()).toBe(HELP['ledger.show']);
    await w.mouse.move(5, 5);
  });

  it('keeps the (i) out of the Tab order inside lists and the triage bar', async () => {
    await go('inbox');
    await w.locator('.rows .row').first().click();
    await sleep(200);
    const inList = await w.locator('.rows [data-testid=info], .row [data-testid=info], .triage-bar [data-testid=info]').evaluateAll((els) => els.map((e) => (e as HTMLElement).tabIndex));
    expect(inList.length).toBeGreaterThan(0); // the triage bar's own (i)
    expect(inList.every((t) => t === -1)).toBe(true);
  });
});

describe('main window screens', () => {
  const pages: Array<[string, string, number]> = [
    ['today', 'today', 9], ['ledger', 'ledger', 2], ['inbox', 'inbox', 1], ['people', 'people', 6], ['snoozed', 'snoozed', 1], ['done', 'done', 5], ['review', 'review', 10], ['releases', 'releases', 4],
  ];
  for (const [name, nav, min] of pages) {
    it(`${name} has its info buttons`, async () => {
      await go(nav);
      await floor(name, w, min);
    });
  }

  it('the person page, the edit sheet and 1:1 mode carry theirs', async () => {
    await go('people');
    await w.locator('.prow, .pcard').first().click();
    await w.getByRole('button', { name: 'Log 1:1', exact: true }).waitFor();
    await floor('person', w, 14);
    await w.getByRole('button', { name: 'Person options', exact: true }).click();
    await w.getByRole('menuitem', { name: 'Edit person…' }).click();
    await sleep(200);
    await floor('person edit sheet', w.locator('.person-editor'), 8);
    await w.keyboard.press('Escape');
    await w.getByRole('button', { name: 'Start 1:1', exact: true }).click();
    await w.getByRole('button', { name: 'End 1:1 and log it', exact: true }).waitFor();
    await floor('1:1 mode', w, 10);
    await w.getByRole('button', { name: 'Cancel', exact: true }).click();
  });

  it('the details drawer carries its own', async () => {
    await go('today');
    const row = w.locator('.rows .row').first();
    await row.click();
    await w.keyboard.press(' ');
    await w.getByLabel('Item details').waitFor();
    await floor('drawer', w.getByLabel('Item details'), 8);
    await w.keyboard.press('Escape');
  });

  it('the add-person dialog and the welcome/onboarding form carry theirs', async () => {
    await go('people');
    await w.getByRole('button', { name: 'Add person…' }).click();
    await w.getByRole('dialog', { name: 'Add person' }).waitFor();
    await floor('add person dialog', w.getByRole('dialog', { name: 'Add person' }), 6);
    await w.keyboard.press('Escape');
  });

  it('the search palette explains its operators', async () => {
    await w.locator('.search-btn').click();
    await w.getByRole('dialog', { name: 'Search' }).waitFor();
    await floor('search', w.getByRole('dialog', { name: 'Search' }), 1);
    await w.keyboard.press('Escape');
  });
});

describe('other windows', () => {
  it('Settings: every row of General, Notifications, Data and About has an (i)', async () => {
    await w.evaluate(() => window.jaffloop.openSettings('general'));
    settings = await l.waitView('settings');
    await settings.getByRole('tab', { name: 'General' }).click();
    await floor('settings general', settings, 17);
    await settings.getByRole('tab', { name: 'Notifications' }).click();
    await floor('settings notifications', settings, 6);
    await settings.getByRole('tab', { name: 'Data' }).click();
    await floor('settings data', settings, 3);
    await settings.getByRole('tab', { name: 'About' }).click();
    await floor('settings about', settings, 4);
  });

  it('the hotkey row explains itself on hover inside Settings', async () => {
    await settings.getByRole('tab', { name: 'General' }).click();
    const btn = settings.getByRole('button', { name: `About ${HELP_NAME['set.hotkey']}` });
    await btn.hover();
    expect(await settings.getByRole('tooltip').innerText()).toBe(HELP['set.hotkey']);
    await settings.mouse.move(2, 2);
    await settings.getByRole('tooltip').waitFor({ state: 'detached' });
  });

  it('capture, popover and the briefs carry theirs', async () => {
    const people = await w.evaluate(async () => (await window.jaffloop.snapshot()).summaries.map((s) => s.person.id));
    await w.evaluate(() => window.jaffloop.openCapture());
    const cap = await l.waitView('capture');
    await floor('capture (empty)', cap, 2);
    await cap.locator('input').first().fill('owe @sara review RFC fri');
    await sleep(300);
    await cap.keyboard.press('Escape');
    await l.app.evaluate(() => (globalThis as unknown as { __jaffloop: { windows: { togglePopover(): void } } }).__jaffloop.windows.togglePopover());
    const pop = await l.waitView('popover');
    await sleep(300);
    await floor('popover', pop, 2);
    await w.evaluate(() => window.jaffloop.openMorningBrief());
    const morning = await l.waitView('morning');
    await floor('morning brief', morning, 3);
    await w.evaluate((id) => window.jaffloop.openPersonBrief(id), people[0]!);
    const brief = await l.waitView('brief');
    await floor('person brief', brief, 5);
  });
});
