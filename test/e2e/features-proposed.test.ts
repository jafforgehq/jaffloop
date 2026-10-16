// 0.4.0: "Review what Claude adds first": items added over MCP wait in the Inbox as proposals until you accept or dismiss them.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import { ROOT, cleanup, launchApp, type Launched } from './helpers';

const OUT = process.env.JAFFLOOP_UI_SHOTS ?? fs.mkdtempSync(path.join(os.tmpdir(), 'jaffloop-proposed-'));
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let l: Launched;
let w: Page;
const go = async (nav: string) => { await w.evaluate((n) => window.jaffloop.openMain(n), nav); await sleep(350); };
const snap = () => w.evaluate(() => window.jaffloop.snapshot());
const proposals = () => w.locator('[data-testid=proposal] .row-title').allTextContents();
const inboxLabel = async () => (await w.locator('.navrow[aria-label^="Inbox"]').getAttribute('aria-label'))!;
const inboxCount = async () => Number(/(\d+)$/.exec(await inboxLabel())?.[1] ?? 0);
const waitProposals = (n: number) => w.waitForFunction((x) => document.querySelectorAll('[data-testid=proposal]').length === x, n);

/** One stdio session of the real MCP server (dist/mcp/server.cjs) against the app's database. Returns the parsed tool results in order. */
function mcp(calls: Array<{ name: string; arguments: Record<string, unknown> }>): Promise<Array<Record<string, unknown>>> {
  const bundle = path.join(ROOT, 'dist', 'mcp', 'server.cjs');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bundle, '--db', l.dbPath], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.on('error', reject);
    child.on('close', () => {
      const replies = out.split('\n').filter(Boolean).map((x) => JSON.parse(x) as { id: number; result?: { content: Array<{ text: string }> } });
      resolve(replies.filter((r) => r.id >= 10).map((r) => JSON.parse(r.result!.content[0]!.text) as Record<string, unknown>));
    });
    const lines = [JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      ...calls.map((c, i) => JSON.stringify({ jsonrpc: '2.0', id: 10 + i, method: 'tools/call', params: c }))];
    child.stdin.end(lines.join('\n') + '\n');
  });
}
const add = (title: string, extra: Record<string, unknown> = {}) => ({ name: 'add_item', arguments: { kind: 'task', title, ...extra } });

beforeAll(async () => {
  l = await launchApp({ env: { JAFFLOOP_SNAPSHOT: '1' } });
  w = l.window;
  await l.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('view=main'))!.setContentSize(1080, 800));
  await w.evaluate(() => window.jaffloop.setUiState({ lastSeenVersion: '0.4.0', welcomeSeen: true, appearance: 'dark', wrapupDay: new Date().toLocaleDateString('sv-SE') }));
  await go('today');
});
afterAll(async () => { await l.close(); cleanup(l); });

describe('with the setting off', () => {
  it('Claude\'s items are normal items and nothing is proposed', async () => {
    expect((await snap()).settings.reviewClaudeItems).toBe(false);
    const [r] = await mcp([add('Normal item from Claude', { person: 'sara', due: '2030-01-04' })]);
    expect(r!.proposed).toBeUndefined();
    await sleep(900);
    expect((await snap()).proposed).toHaveLength(0);
    expect((await snap()).openItems.some((i) => i.title === 'Normal item from Claude')).toBe(true);
  });
});

describe('with "Review what Claude adds first" on', () => {
  let before = 0;

  it('the Settings switch turns it on', async () => {
    await w.evaluate(() => window.jaffloop.openSettings('mcp'));
    const s = await l.waitView('settings');
    const sw = s.getByRole('switch', { name: 'Review what Claude adds first' });
    expect(await sw.getAttribute('aria-checked')).toBe('false');
    await sw.click();
    await s.waitForSelector('[role=switch][aria-label="Review what Claude adds first"][aria-checked=true]');
    expect((await snap()).settings.reviewClaudeItems).toBe(true);
  });

  it('items added over MCP are held back: a card on Today, a badge on Inbox, nothing in the lists', async () => {
    await go('today');
    before = await inboxCount();
    const out = await mcp([
      add('Proposal one: schedule the offsite', { external_id: 'e2e:1', source_label: 'outlook' }),
      add('Proposal two: send the budget', { kind: 'owe', person: 'amir', due: '2030-01-04', external_id: 'e2e:2' }),
      add('Proposal three: ask about on-call', { kind: 'bring', person: 'sara', external_id: 'e2e:3' }),
    ]);
    expect(out.map((o) => o.proposed)).toEqual([true, true, true]);
    await w.getByTestId('review-card').waitFor();
    expect(await w.getByTestId('review-card').textContent()).toContain('Claude added 3 items for you to review');
    expect(await inboxCount()).toBe(before + 3);
    expect(await w.locator('.row .row-title', { hasText: 'Proposal' }).count()).toBe(0);
    const s = await snap();
    expect(s.proposed).toHaveLength(3);
    expect(s.openItems.some((i) => i.title.startsWith('Proposal'))).toBe(false);
    expect(s.today.today.concat(s.today.overdue, s.today.inbox).some((i) => i.title.startsWith('Proposal'))).toBe(false);
    await w.screenshot({ path: path.join(OUT, 'today-review-card.png') });
  });

  it('the Inbox lists them above the normal inbox with Accept and Dismiss', async () => {
    await w.getByTestId('review-card').getByRole('button', { name: 'Review in Inbox' }).click();
    await w.getByTestId('proposals').waitFor();
    await waitProposals(3);
    expect(await w.getByTestId('proposals').locator('.section-head').first().textContent()).toContain('Claude added these');
    expect((await proposals()).sort()).toEqual(['Proposal one: schedule the offsite', 'Proposal three: ask about on-call', 'Proposal two: send the budget']);
    const two = w.locator('[data-testid=proposal]', { hasText: 'Proposal two' });
    expect(await two.textContent()).toContain('Amir');
    expect(await w.locator('[data-testid=proposal]', { hasText: 'Proposal one' }).textContent()).toContain('outlook');
    expect(await w.getByRole('button', { name: 'Accept all' }).count()).toBe(1);
    // above the normal inbox rows
    const order = await w.evaluate(() => { const a = document.querySelector('[data-testid=proposals]')!; const b = document.querySelector('.rows[aria-label=Inbox]'); return b ? Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) : true; });
    expect(order).toBe(true);
    await w.screenshot({ path: path.join(OUT, 'inbox-proposals.png') });
  });

  it('key a accepts the selected proposal, Undo puts it back', async () => {
    await w.waitForSelector('[data-testid=proposal].selected');
    const first = (await w.locator('[data-testid=proposal].selected .row-title').textContent())!;
    await w.keyboard.press('a');
    await waitProposals(2);
    expect(await w.getByText(`Accepted · ${first}`).count()).toBe(1);
    const s = await snap();
    expect(s.proposed).toHaveLength(2);
    expect(s.openItems.find((i) => i.title === first)).toMatchObject({ proposed: false });
    await w.getByRole('button', { name: 'Undo' }).click();
    await waitProposals(3);
    expect((await snap()).openItems.some((i) => i.title === first)).toBe(false);
  });

  it('key x dismisses the selected proposal: dropped, and the same external id is never imported again', async () => {
    const sel = (await w.locator('[data-testid=proposal].selected .row-title').textContent())!;
    await w.keyboard.press('x');
    await waitProposals(2);
    expect(await w.getByText(`Dismissed · ${sel}`).count()).toBe(1);
    const dropped = await w.evaluate(() => window.jaffloop.items({ status: 'dropped' }));
    const gone = dropped.find((i) => i.title === sel)!;
    expect(gone).toBeTruthy();
    const [dup] = await mcp([add('Same thing again', { external_id: gone.externalId ?? 'none' })]);
    if (gone.externalId) expect(dup!.duplicate).toBe(true);
    expect((await snap()).proposed).toHaveLength(2);
  });

  it('the sidebar badge counts proposals plus the normal inbox', async () => {
    expect(await inboxCount()).toBe(before + 2);
    await w.locator('[data-testid=proposal]', { hasText: 'Proposal three' }).getByRole('button', { name: /^Accept/ }).click();
    await waitProposals(1);
    // 'three' has a person, so accepted it is a normal item and not an inbox item: only 'one' is left
    expect(await inboxCount()).toBe(before + 1);
  });

  it('Accept all and Dismiss all work on every proposal, with Undo', async () => {
    await mcp([add('Bulk a', { external_id: 'e2e:b1' }), add('Bulk b', { external_id: 'e2e:b2' })]);
    await waitProposals(3);
    await w.getByRole('button', { name: 'Dismiss all' }).click();
    await w.waitForFunction(() => document.querySelectorAll('[data-testid=proposal]').length === 0);
    expect((await snap()).proposed).toHaveLength(0);
    await w.getByRole('button', { name: 'Undo' }).click();
    await waitProposals(3);
    await w.getByRole('button', { name: 'Accept all' }).click();
    await w.waitForFunction(() => document.querySelectorAll('[data-testid=proposal]').length === 0);
    const s = await snap();
    expect(s.proposed).toHaveLength(0);
    expect(s.openItems.filter((i) => /^Bulk /.test(i.title))).toHaveLength(2);
    expect(await w.getByTestId('proposals').count()).toBe(0);
    await go('today');
    expect(await w.getByTestId('review-card').count()).toBe(0);
  });
});
