// 0.5.2: Settings -> Data -> Reset everything: backup first, then a clean slate that opens "Add your team".
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import { cleanup, launchApp, type Launched } from './helpers';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const backups = fs.mkdtempSync(path.join(os.tmpdir(), 'jaffloop-backups-'));
let l: Launched;
let w: Page;

beforeAll(async () => {
  l = await launchApp({ env: { JAFFLOOP_SNAPSHOT: '1', JAFFLOOP_BACKUP_DIR: backups } });
  w = l.window;
  await w.evaluate(() => window.jaffloop.setUiState({ lastSeenVersion: '0.5.2', welcomeSeen: true, pinnedPeople: ['x'] }));
});
afterAll(async () => { await l.close(); cleanup(l); fs.rmSync(backups, { recursive: true, force: true }); });

describe('reset everything', () => {
  it('needs the word RESET, backs up, wipes data and preferences, and opens the wizard', async () => {
    expect((await w.evaluate(() => window.jaffloop.snapshot())).summaries.length).toBeGreaterThan(0);
    await w.evaluate(() => window.jaffloop.openSettings('data'));
    const s = await l.waitView('settings');
    await s.getByRole('button', { name: 'Reset everything…', exact: true }).click();
    const confirm = s.getByRole('button', { name: 'Back up and reset', exact: true });
    expect(await confirm.isDisabled()).toBe(true);
    await s.getByLabel('Type RESET to confirm', { exact: true }).fill('reset');
    expect(await confirm.isDisabled()).toBe(true);
    await s.getByLabel('Type RESET to confirm', { exact: true }).fill('RESET');
    await confirm.click();
    await s.getByText(/Reset done\. Backup saved to/).waitFor();
    await sleep(500);

    const files = fs.readdirSync(backups);
    expect(files).toHaveLength(1);
    const backup = JSON.parse(fs.readFileSync(path.join(backups, files[0]!), 'utf8')) as { people: unknown[]; items: unknown[] };
    expect(backup.people.length).toBeGreaterThan(0);
    expect(backup.items.length).toBeGreaterThan(0);

    const snap = await w.evaluate(() => window.jaffloop.snapshot());
    expect(snap.summaries).toHaveLength(0);
    expect(snap.openItems).toHaveLength(0);
    expect(snap.archivedPeople).toHaveLength(0);
    const ui = await w.evaluate(() => window.jaffloop.uiState());
    expect(ui.pinnedPeople).toEqual([]);
    await w.getByRole('dialog', { name: 'Add your team' }).waitFor();
  });
});
