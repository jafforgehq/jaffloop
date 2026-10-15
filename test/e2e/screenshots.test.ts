// Drives the real app against the demo data and writes the README screenshots (JAFFLOOP_SCREENSHOTS=dir) or
// just checks that every screen renders (no directory: screenshots go to a temp folder).
import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Page } from 'playwright-core';
import { cleanup, launchApp, type Launched } from './helpers';

const OUT = process.env.JAFFLOOP_SCREENSHOTS ?? fs.mkdtempSync(path.join(os.tmpdir(), 'jaffloop-shots-'));
fs.mkdirSync(OUT, { recursive: true });
const shot = (p: Page, name: string) => p.screenshot({ path: path.join(OUT, `${name}.png`) });

let l: Launched | undefined;
afterAll(async () => { if (l) { await l.close(); cleanup(l); } });

async function resize(app: Launched['app'], view: string, width: number, height: number) {
  await app.evaluate(({ BrowserWindow }, a) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes(`view=${a.view}`));
    w?.setContentSize(a.width, a.height);
  }, { view, width, height });
  await new Promise((r) => setTimeout(r, 400));
}

describe('screens', () => {
  it('renders every screen with the demo data', async () => {
    l = await launchApp({ env: { JAFFLOOP_SNAPSHOT: '1' } });
    const w = l.window;
    await resize(l.app, 'main', 1080, 800);
    const go = async (nav: string) => { await w.evaluate((n) => window.jaffloop.openMain(n), nav); await new Promise((r) => setTimeout(r, 450)); };
    // the demo data is "an update from the Swift app" for the first-run logic: start from Today and mark the release seen
    await w.evaluate(() => window.jaffloop.setUiState({ lastSeenVersion: '0.1.0', welcomeSeen: true, appearance: 'dark' }));
    await go('today');
    await shot(w, 'today-dark');
    expect(await w.locator('.row').count()).toBeGreaterThan(5);

    await w.keyboard.press('j'); await w.keyboard.press('Space');
    await new Promise((r) => setTimeout(r, 450));
    await resize(l.app, 'main', 1180, 800);
    await shot(w, 'drawer');
    await w.keyboard.press('Escape'); await w.keyboard.press('Escape');
    await resize(l.app, 'main', 1080, 800);

    const people = await w.evaluate(async () => (await window.jaffloop.snapshot()).summaries.map((s) => ({ id: s.person.id, handle: s.person.handle })));
    const sara = people.find((p) => p.handle === 'sara')!;
    for (const [nav, name] of [['ledger', 'ledger'], ['inbox', 'inbox'], ['done', 'done'], ['snoozed', 'snoozed'], [`person:${sara.id}`, 'person'], ['releases', 'whats-new']] as const) {
      await go(nav);
      await shot(w, name);
    }
    await w.evaluate(() => window.jaffloop.setUiState({ peopleLayout: 'grid' }));
    await go('people'); await shot(w, 'people-grid');
    await w.evaluate(() => window.jaffloop.setUiState({ peopleLayout: 'list' }));

    await w.evaluate(() => window.jaffloop.setUiState({ appearance: 'light' }));
    await go('today'); await shot(w, 'today-light');
    await w.evaluate(() => window.jaffloop.setUiState({ appearance: 'dark' }));

    // 1:1 mode, shortcuts sheet
    await go(`person:${sara.id}`);
    await w.getByText('Start 1:1', { exact: true }).first().click();
    await new Promise((r) => setTimeout(r, 500));
    await shot(w, 'one-on-one');
    await w.getByText('Cancel', { exact: true }).click();
    await go('today');
    await w.keyboard.press('?');
    await new Promise((r) => setTimeout(r, 400));
    await shot(w, 'shortcuts');
    await w.keyboard.press('Escape');

    // other windows
    await w.evaluate(() => window.jaffloop.openSettings('general'));
    const settings = await l.waitView('settings'); await shot(settings, 'settings-general');
    await w.evaluate(() => window.jaffloop.openSettings('mcp'));
    await new Promise((r) => setTimeout(r, 400)); await shot(settings, 'settings-mcp');
    await w.evaluate(() => window.jaffloop.openMorningBrief());
    const morning = await l.waitView('morning'); await shot(morning, 'morning-brief');
    await w.evaluate((id) => window.jaffloop.openPersonBrief(id), sara.id);
    const brief = await l.waitView('brief'); await shot(brief, 'person-brief');
    await w.evaluate(() => window.jaffloop.openCapture());
    const cap = await l.waitView('capture');
    await cap.locator('input').first().fill('owe @sara review RFC fri #rfc !');
    await new Promise((r) => setTimeout(r, 400)); await shot(cap, 'capture');
    await cap.keyboard.press('Escape');
    await l.app.evaluate(() => (globalThis as unknown as { __jaffloop: { windows: { togglePopover(): void } } }).__jaffloop.windows.togglePopover());
    const pop = await l.waitView('popover'); await new Promise((r) => setTimeout(r, 400)); await shot(pop, 'menubar-popover');
    expect(fs.readdirSync(OUT).filter((f) => f.endsWith('.png')).length).toBeGreaterThanOrEqual(18);
  });

  it('shows the welcome screen on an empty database', async () => {
    const e = await launchApp({ seed: false, env: { JAFFLOOP_SNAPSHOT: '1' } });
    try {
      await new Promise((r) => setTimeout(r, 600));
      await shot(e.window, 'welcome');
      expect(await e.window.getByText('Welcome to Jaffloop').count()).toBeGreaterThan(0);
    } finally { await e.close(); cleanup(e); }
  });
});
