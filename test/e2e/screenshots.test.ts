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
    await w.evaluate(() => window.jaffloop.setUiState({ lastSeenVersion: '0.2.0', welcomeSeen: true, appearance: 'dark', wrapupDay: new Date().toLocaleDateString('sv-SE') }));
    // the end-of-day card may already be showing (it appears at once after the end-of-day time): dismiss it for the screenshots
    const wrap = w.getByTestId('wrapup');
    if (await wrap.count()) await wrap.getByRole('button', { name: 'Dismiss' }).click();
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
    for (const [nav, name] of [['ledger', 'ledger'], ['inbox', 'inbox'], ['review', 'review'], ['done', 'done'], ['snoozed', 'snoozed'], [`person:${sara.id}`, 'person'], ['releases', 'whats-new']] as const) {
      await go(nav);
      await shot(w, name);
    }
    // the 1:1 history, scrolled into view
    await go(`person:${sara.id}`);
    await w.getByText('1:1 history', { exact: false }).first().scrollIntoViewIfNeeded();
    await w.evaluate(() => document.querySelector('.page')?.scrollBy(0, 600));
    await new Promise((r) => setTimeout(r, 300));
    await shot(w, 'person-history');
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

    await w.keyboard.press('Meta+p');
    await new Promise((r) => setTimeout(r, 400));
    await shot(w, 'people-palette');
    await w.keyboard.press('Escape');

    // other windows
    await w.evaluate(() => window.jaffloop.openSettings('general'));
    const settings = await l.waitView('settings'); await shot(settings, 'settings-general');
    await w.evaluate(() => window.jaffloop.openSettings('mcp'));
    await new Promise((r) => setTimeout(r, 400)); await shot(settings, 'settings-mcp');
    await settings.evaluate(() => document.querySelector('[data-testid="prompt-card"]')?.scrollIntoView());
    await new Promise((r) => setTimeout(r, 300)); await shot(settings, 'settings-prompts');
    await w.evaluate(() => window.jaffloop.openMorningBrief());
    const morning = await l.waitView('morning'); await shot(morning, 'morning-brief');
    await w.evaluate((id) => window.jaffloop.openPersonBrief(id), sara.id);
    const brief = await l.waitView('brief'); await shot(brief, 'person-brief');
    await w.evaluate(() => window.jaffloop.openCapture());
    const cap = await l.waitView('capture');
    await cap.locator('input').first().fill('owe @sara review RFC fri #rfc !');
    await new Promise((r) => setTimeout(r, 400)); await shot(cap, 'capture');
    await cap.locator('input').first().fill('owe @sara ');
    await new Promise((r) => setTimeout(r, 500)); await shot(cap, 'capture-context');
    await cap.keyboard.press('Escape');
    await l.app.evaluate(() => (globalThis as unknown as { __jaffloop: { windows: { togglePopover(): void } } }).__jaffloop.windows.togglePopover());
    const pop = await l.waitView('popover'); await new Promise((r) => setTimeout(r, 400)); await shot(pop, 'menubar-popover');
    expect(fs.readdirSync(OUT).filter((f) => f.endsWith('.png')).length).toBeGreaterThanOrEqual(23);
  });

  it('renders the main screens, settings, capture and popover in every theme', async () => {
    const t = await launchApp({ env: { JAFFLOOP_SNAPSHOT: '1' } });
    try {
      const w = t.window;
      await resize(t.app, 'main', 1080, 800);
      await w.evaluate(() => window.jaffloop.setUiState({ lastSeenVersion: '0.3.0', welcomeSeen: true, wrapupDay: new Date().toLocaleDateString('sv-SE') }));
      const wrap = w.getByTestId('wrapup');
      if (await wrap.count()) await wrap.getByRole('button', { name: 'Dismiss' }).click();
      const people = await w.evaluate(async () => (await window.jaffloop.snapshot()).summaries.map((s) => ({ id: s.person.id, handle: s.person.handle })));
      const sara = people.find((p) => p.handle === 'sara')!;
      const go = async (nav: string) => { await w.evaluate((n) => window.jaffloop.openMain(n), nav); await new Promise((r) => setTimeout(r, 450)); };
      await w.evaluate(() => window.jaffloop.openSettings('general'));
      const settings = await t.waitView('settings');
      await w.evaluate(() => window.jaffloop.openCapture());
      const cap = await t.waitView('capture');
      await cap.locator('input').first().fill('owe @sara review RFC fri #rfc !');
      await t.app.evaluate(() => (globalThis as unknown as { __jaffloop: { windows: { togglePopover(): void } } }).__jaffloop.windows.togglePopover());
      const pop = await t.waitView('popover');
      const variants: Array<[string, string, 'dark' | 'light']> = [['classic-dark', 'classic', 'dark'], ['classic-light', 'classic', 'light'], ['graphite', 'graphite', 'dark'], ['midnight', 'midnight', 'dark'], ['forest', 'forest', 'dark'], ['daylight', 'daylight', 'light'], ['paper', 'paper', 'light'], ['contrast', 'contrast', 'dark']];
      // only Today and Settings per theme go to the docs folder; the other screens are for checking by eye (JAFFLOOP_THEME_SHOTS=all keeps them too)
      const extra = process.env.JAFFLOOP_THEME_SHOTS === 'all' ? OUT : fs.mkdtempSync(path.join(os.tmpdir(), 'jaffloop-theme-shots-'));
      const shotTo = (p: Page, name: string) => p.screenshot({ path: path.join(extra, `${name}.png`) });
      for (const [name, theme, scheme] of variants) {
        await w.evaluate((a) => window.jaffloop.setUiState({ theme: a.theme as never, appearance: a.scheme }), { theme, scheme });
        await new Promise((r) => setTimeout(r, 400));
        await go('today'); await shot(w, `theme-${name}-today`);
        await go(`person:${sara.id}`); await shotTo(w, `theme-${name}-person`);
        await go('today'); await w.keyboard.press('j'); await w.keyboard.press('Space');
        await new Promise((r) => setTimeout(r, 400)); await shotTo(w, `theme-${name}-drawer`);
        await w.keyboard.press('Escape'); await w.keyboard.press('Escape');
        await shot(settings, `theme-${name}-settings`);
        await shotTo(cap, `theme-${name}-capture`);
        await shotTo(pop, `theme-${name}-popover`);
      }
      expect(fs.readdirSync(extra).filter((f) => f.startsWith('theme-')).length).toBeGreaterThanOrEqual(variants.length * 2);
      if (extra !== OUT) fs.rmSync(extra, { recursive: true, force: true });
    } finally { await t.close(); cleanup(t); }
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
