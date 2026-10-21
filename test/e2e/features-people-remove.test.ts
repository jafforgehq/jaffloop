// 0.5.1: people can be archived (and restored) and deleted for good from the person page and the People page.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import { cleanup, launchApp, type Launched } from './helpers';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let l: Launched;
let w: Page;
const snap = () => w.evaluate(() => window.jaffloop.snapshot());
const go = async (nav: string) => { await w.evaluate((n) => window.jaffloop.openMain(n), nav); await sleep(350); };
const idOf = async (handle: string) => (await snap()).summaries.find((s) => s.person.handle === handle)!.person.id;

beforeAll(async () => {
  l = await launchApp({ env: { JAFFLOOP_SNAPSHOT: '1' } });
  w = l.window;
  await w.evaluate(() => window.jaffloop.setUiState({ lastSeenVersion: '0.5.1', welcomeSeen: true }));
});
afterAll(async () => { await l.close(); cleanup(l); });

describe('removing people', () => {
  it('archives from the person menu, restores from the People page', async () => {
    const id = await idOf('priya');
    await go(`person:${id}`);
    await w.getByRole('button', { name: 'Person options', exact: true }).click();
    await w.getByRole('menuitem', { name: 'Archive' }).click();
    await sleep(400);
    expect((await snap()).summaries.map((s) => s.person.id)).not.toContain(id);
    expect((await snap()).archivedPeople.map((p) => p.id)).toContain(id);

    await go('people');
    await w.getByTestId('archived-people').getByRole('button', { name: /^Archived/ }).click();
    await w.getByTestId('archived-person').filter({ hasText: 'Priya' }).getByRole('button', { name: 'Restore' }).click();
    await sleep(400);
    expect((await snap()).summaries.map((s) => s.person.id)).toContain(id);
  });

  it('deleting asks first and then removes the person, keeping their items', async () => {
    const id = await idOf('maya');
    const before = (await snap()).openItems.filter((i) => i.personId === id).length;
    await go(`person:${id}`);
    await w.getByRole('button', { name: 'Person options', exact: true }).click();
    await w.getByRole('menuitem', { name: 'Delete…' }).click();
    const confirm = w.getByTestId('delete-person');
    await confirm.waitFor();
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    expect((await snap()).summaries.map((s) => s.person.id)).toContain(id);

    await w.getByRole('button', { name: 'Person options', exact: true }).click();
    await w.getByRole('menuitem', { name: 'Delete…' }).click();
    await w.getByTestId('delete-person').getByRole('button', { name: 'Delete', exact: true }).click();
    await sleep(500);
    const after = await snap();
    expect(after.summaries.map((s) => s.person.id)).not.toContain(id);
    expect(after.archivedPeople.map((p) => p.id)).not.toContain(id);
    expect(after.openItems.filter((i) => i.personId === id)).toHaveLength(0);
    expect(after.openItems.length).toBeGreaterThanOrEqual(before);
  });

  it('deletes an archived person from the People page', async () => {
    const id = await idOf('jonas');
    await w.evaluate(async (pid) => { const s = await window.jaffloop.snapshot(); const p = s.summaries.find((x) => x.person.id === pid)!.person; await window.jaffloop.savePerson({ ...p, archived: true }); }, id);
    await go('people');
    await w.getByTestId('archived-people').getByRole('button', { name: /^Archived/ }).click();
    const row = w.getByTestId('archived-person').filter({ hasText: 'Jonas' });
    await row.getByRole('button', { name: 'Delete…' }).click();
    await row.getByRole('button', { name: 'Delete', exact: true }).click();
    await sleep(400);
    expect((await snap()).archivedPeople.map((p) => p.id)).not.toContain(id);
  });
});
