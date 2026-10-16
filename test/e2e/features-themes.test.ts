// 0.3.0 themes against the built app: the picker in Settings changes every window, persists, Classic follows the system, nativeTheme follows the mode.
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import { THEMES } from '../../src/shared/themes-meta';
import { resolveTokens } from '../../src/renderer/themes';
import { cleanup, launchApp, type Launched } from './helpers';

let l: Launched;
let w: Page;
let settings: Page;
const diskUi = () => JSON.parse(fs.readFileSync(path.join(l.userData, 'ui-state.json'), 'utf8')) as Record<string, unknown>;
const themeSource = () => l.app.evaluate(({ nativeTheme }) => nativeTheme.themeSource);
const bodyBg = (p: Page) => p.evaluate(() => getComputedStyle(document.body).backgroundColor);
const rgb = (hex: string) => { const n = parseInt(hex.slice(1), 16); return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`; };
const settle = () => new Promise((r) => setTimeout(r, 250));

beforeAll(async () => {
  l = await launchApp({ env: { JAFFLOOP_SNAPSHOT: '1' } });
  w = l.window;
  await w.evaluate(() => window.jaffloop.setUiState({ lastSeenVersion: '0.3.0', welcomeSeen: true, appearance: 'system' }));
  await w.evaluate(() => window.jaffloop.openSettings('general'));
  settings = await l.waitView('settings');
});
afterAll(async () => { await l.close(); cleanup(l); });

describe('theme picker', () => {
  it('starts on Classic with a card per theme and the Appearance select enabled', async () => {
    expect(await w.locator('html').getAttribute('data-theme')).toBe('classic');
    expect(await settings.locator('[data-theme-id]').count()).toBe(THEMES.length);
    expect(await settings.locator('[data-theme-id="classic"]').getAttribute('aria-checked')).toBe('true');
    expect(await settings.getByLabel('Appearance', { exact: true }).isDisabled()).toBe(false);
  });

  it('picking each theme in Settings restyles the main window, sets nativeTheme and persists', async () => {
    const seen = new Set<string>();
    for (const m of THEMES.filter((t) => t.id !== 'classic')) {
      await settings.locator(`[data-theme-id="${m.id}"]`).click();
      await settle();
      expect(await w.locator('html').getAttribute('data-theme')).toBe(m.id);
      expect(await settings.locator('html').getAttribute('data-theme')).toBe(m.id);
      const bg = await bodyBg(w);
      expect(bg).toBe(rgb(resolveTokens(m.id, true).bg));
      expect(seen.has(bg)).toBe(false);
      seen.add(bg);
      expect(await w.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe(m.mode);
      expect(await themeSource()).toBe(m.mode);
      expect(diskUi().theme).toBe(m.id);
      expect((await w.evaluate(() => window.jaffloop.uiState())).theme).toBe(m.id);
      expect(await settings.locator(`[data-theme-id="${m.id}"]`).getAttribute('aria-checked')).toBe('true');
      expect(await settings.getByLabel('Appearance', { exact: true }).isDisabled()).toBe(true);
      expect(await settings.getByText('Classic follows macOS; other themes are always light or dark').count()).toBe(1);
    }
  });

  it('a fixed theme ignores the saved appearance and the system scheme', async () => {
    await settings.locator('[data-theme-id="paper"]').click();
    await settle();
    await w.evaluate(() => window.jaffloop.setUiState({ appearance: 'dark' }));
    await settle();
    expect(await themeSource()).toBe('light');
    await w.emulateMedia({ colorScheme: 'dark' });
    await settle();
    expect(await bodyBg(w)).toBe(rgb(resolveTokens('paper', true).bg));
  });

  it('Classic follows the system colour scheme and the Appearance choice', async () => {
    await settings.locator('[data-theme-id="classic"]').click();
    await settle();
    expect(await w.locator('html').getAttribute('data-theme')).toBe('classic');
    expect(await settings.getByLabel('Appearance', { exact: true }).isDisabled()).toBe(false);
    expect(await themeSource()).toBe('dark'); // the appearance saved a step ago
    await w.evaluate(() => window.jaffloop.setUiState({ appearance: 'system' }));
    expect(await themeSource()).toBe('system');
    await w.emulateMedia({ colorScheme: 'dark' }); await settle();
    expect(await bodyBg(w)).toBe(rgb(resolveTokens('classic', true).bg));
    await w.emulateMedia({ colorScheme: 'light' }); await settle();
    expect(await bodyBg(w)).toBe(rgb(resolveTokens('classic', false).bg));
    expect(await w.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('light');
    await w.emulateMedia({ colorScheme: 'dark' }); await settle();
    expect(await bodyBg(w)).toBe(rgb(resolveTokens('classic', true).bg));
  });

  it('accent swatches keep working on a theme (graphite = the theme default)', async () => {
    await settings.locator('[data-theme-id="midnight"]').click();
    await settle();
    const accent = () => w.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
    const def = await accent();
    expect(def).toBe(resolveTokens('midnight', true).accent);
    await settings.getByLabel('Amber accent').click();
    await settle();
    const amber = await accent();
    expect(amber).not.toBe(def);
    await settings.getByLabel('Graphite accent').click();
    await settle();
    expect(await accent()).toBe(def);
  });

  it('every window gets the theme: capture, popover and brief too', async () => {
    await settings.locator('[data-theme-id="forest"]').click();
    await settle();
    await w.evaluate(() => window.jaffloop.openMorningBrief());
    const brief = await l.waitView('morning');
    await settle();
    expect(await brief.locator('html').getAttribute('data-theme')).toBe('forest');
    expect(await bodyBg(brief)).toBe(rgb(resolveTokens('forest', true).bg));
    await w.evaluate(() => window.jaffloop.openCapture());
    const cap = await l.waitView('capture');
    expect(await cap.locator('html').getAttribute('data-theme')).toBe('forest');
  });

  it('keeps the theme after a restart', async () => {
    const dir = l.dir;
    await l.close();
    l = await launchApp({ dir, env: { JAFFLOOP_SNAPSHOT: '1' } });
    w = l.window;
    expect(await w.locator('html').getAttribute('data-theme')).toBe('forest');
    expect(await bodyBg(w)).toBe(rgb(resolveTokens('forest', true).bg));
    expect(await themeSource()).toBe('dark');
  });
});
