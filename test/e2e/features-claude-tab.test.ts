// 0.5.0: Settings → Claude (MCP): tools list, switches, make a prompt, approve/edit/delete prompts, schedule preview, sync health.
// Never installs a launchd job: everything stops at the command preview.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import { ROOT, cleanup, launchApp, type Launched } from './helpers';

const OUT = process.env.JAFFLOOP_UI_SHOTS ?? fs.mkdtempSync(path.join(os.tmpdir(), 'jaffloop-claude-tab-'));
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let l: Launched;
let w: Page;
let s: Page;
const shot = (p: Locator | Page, name: string) => p.screenshot({ path: path.join(OUT, `${name}.png`) });
type Locator = ReturnType<Page['locator']>;
const clip = () => l.app.evaluate(({ clipboard }) => clipboard.readText());

/** One stdio session of the real MCP server against the app's database. */
function mcp(calls: Array<{ name: string; arguments: Record<string, unknown> }>): Promise<Array<Record<string, any>>> {
  const bundle = path.join(ROOT, 'dist', 'mcp', 'server.cjs');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bundle, '--db', l.dbPath], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.on('error', reject);
    child.on('close', () => {
      const replies = out.split('\n').filter(Boolean).map((x) => JSON.parse(x) as { id: number; result?: { content: Array<{ text: string }> } });
      resolve(replies.filter((r) => r.id >= 10).map((r) => JSON.parse(r.result!.content[0]!.text) as Record<string, any>));
    });
    child.stdin.end([JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      ...calls.map((c, i) => JSON.stringify({ jsonrpc: '2.0', id: 10 + i, method: 'tools/call', params: c }))].join('\n') + '\n');
  });
}

beforeAll(async () => {
  l = await launchApp({ seed: false, env: { JAFFLOOP_SNAPSHOT: '1' } });
  w = l.window;
  await w.evaluate(() => window.jaffloop.setUiState({ lastSeenVersion: '0.5.0', welcomeSeen: true, appearance: 'dark' }));
  await w.evaluate(() => window.jaffloop.openSettings('mcp'));
  s = await l.waitView('settings');
  await l.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('view=settings'))!.setContentSize(760, 900));
  await s.waitForSelector('[data-testid=tool-row]');
});
afterAll(async () => { await l.close(); cleanup(l); });

describe('what Claude may do', () => {
  it('lists the 16 tools with read/write badges and an explanation on hover', async () => {
    expect(await s.locator('[data-testid=tool-row]').count()).toBe(16);
    expect(await s.locator('[data-testid=tool-row] .ct-badge.write').count()).toBe(9);
    const row = s.locator('[data-tool=save_prompt]');
    expect(await row.textContent()).toContain('writes');
    await row.scrollIntoViewIfNeeded();
    await sleep(500); // let the scroll settle
    await row.locator('[data-testid=info]').evaluate((e) => (e as HTMLElement).focus({ preventScroll: true })); // keyboard path (a scroll closes the tip, so do not scroll)
    await s.locator('.info-tip').waitFor({ state: 'attached' });
    expect(await s.locator('.info-tip').textContent()).toContain('approve');
    await s.keyboard.press('Escape');
    await s.locator('.info-tip').waitFor({ state: 'detached' });
  });

  it('has an (i) next to every switch and toggles sharing 1:1 notes', async () => {
    expect(await s.locator('.form-row:has([role=switch]) [data-testid=info]').count()).toBeGreaterThanOrEqual(3);
    const sw = s.getByRole('switch', { name: 'Share 1:1 notes with Claude' });
    expect(await sw.getAttribute('aria-checked')).toBe('true');
    await sw.click();
    await s.waitForFunction(() => document.querySelector('[aria-label="Share 1:1 notes with Claude"]')?.getAttribute('aria-checked') === 'false');
    expect((await w.evaluate(() => window.jaffloop.snapshot())).settings.shareOneOnOneNotes).toBe(false);
    await sw.click();
    expect((await w.evaluate(() => window.jaffloop.snapshot())).settings.shareOneOnOneNotes).toBe(true);
  });

  it('shows no move-to-Applications warning for a normal install', async () => {
    expect(await s.locator('[data-testid=mcp-warn]').count()).toBe(0);
    expect(await s.locator('[data-testid=mcp-command]').textContent()).toContain('claude mcp add');
  });
});

describe('make a prompt', () => {
  it('copies the instruction for Claude once there is a request', async () => {
    const btn = s.getByRole('button', { name: 'Copy instruction for Claude' });
    expect(await btn.isDisabled()).toBe(true);
    await s.getByLabel('What should the prompt do?').fill('Read my Teams chats from the weekend and add what I promised');
    expect(await btn.isDisabled()).toBe(false);
    await btn.click();
    await s.getByText('Copied').first().waitFor();
    const c = await clip();
    expect(c).toContain('Read my Teams chats from the weekend and add what I promised');
    expect(c).toContain('save_prompt');
    expect(c).not.toContain('{{request}}');
  });
});

describe('prompts', () => {
  const TEXT = 'Read my Teams chats since {{since}} and add what I promised as owe items.';
  const card = () => s.locator('[data-testid=custom-prompt-card][data-prompt=weekend-teams]');

  it('shows a prompt Claude saved as needing approval, with its text open, then approves it', async () => {
    const [r] = await mcp([{ name: 'save_prompt', arguments: { id: 'weekend-teams', title: 'Weekend Teams', description: 'What I promised on Teams', text: TEXT, needs: ['Teams'], arguments: [{ name: 'since', description: 'from when', required: false, default: 'friday' }] } }]);
    expect(r!.status).toBe('needs_approval');
    await card().waitFor({ timeout: 8000 });
    expect(await card().locator('[data-testid=prompt-status]').textContent()).toBe('Needs approval');
    expect(await card().locator('[data-testid=prompt-text]').textContent()).toContain('since friday');
    expect(await card().getByRole('button', { name: /^Approve prompt/ }).count()).toBe(1);
    expect(await s.evaluate(() => window.jaffloop.customPrompts().then((x) => x[0]!.approved))).toBe(false);
    await card().scrollIntoViewIfNeeded();
    await shot(s, 'claude-tab-prompts');

    await card().getByRole('button', { name: /^Approve prompt/ }).click();
    await s.locator('[data-prompt=weekend-teams][data-approved="1"]').waitFor();
    expect(await card().locator('[data-testid=prompt-status]').textContent()).toBe('Approved');
    expect(await card().getByRole('button', { name: /^Approve prompt/ }).count()).toBe(0);
  });

  it('edits with live validation and saves', async () => {
    await card().getByRole('button', { name: /^Edit prompt/ }).click();
    const form = s.locator('[data-testid=prompt-form]');
    await form.waitFor();
    const save = form.getByRole('button', { name: 'Save prompt' });
    expect(await save.isDisabled()).toBe(false);
    await form.getByLabel('Prompt text').fill('too short');
    expect(await form.locator('[data-testid=prompt-error]').textContent()).toContain('text');
    expect(await save.isDisabled()).toBe(true);
    await form.getByLabel('Prompt text').fill('Read my Teams chats since {{since}} and {{other}} and add the promises.');
    expect(await form.locator('[data-testid=prompt-error]').textContent()).toContain('other');
    await form.getByLabel('Prompt text').fill('Read my Teams chats since {{since}} and add what I promised.');
    await form.getByLabel('Prompt title').fill('Weekend on Teams');
    expect(await form.locator('[data-testid=prompt-error]').count()).toBe(0);
    await save.click();
    await s.locator('[data-testid=prompt-form]').waitFor({ state: 'detached' });
    expect(await card().locator('.pr-title').textContent()).toBe('Weekend on Teams');
    expect((await s.evaluate(() => window.jaffloop.customPrompts()))[0]!.title).toBe('Weekend on Teams');
  });

  it('creates a new prompt, refusing a built-in id', async () => {
    await s.getByRole('button', { name: 'New prompt', exact: true }).click();
    const form = s.locator('[data-testid=prompt-form]');
    await form.getByLabel('Prompt title').fill('Monday sweep');
    expect(await form.getByLabel('Prompt id').inputValue()).toBe('monday-sweep');
    expect(await form.locator('[data-testid=prompt-error]').textContent()).toContain('built-in');
    await form.getByLabel('Prompt title').fill('My quick sweep');
    await form.getByLabel('Prompt text').fill('Read my sent mail from this week and add promises.');
    await form.getByRole('button', { name: 'Create prompt' }).click();
    await s.locator('[data-prompt=my-quick-sweep]').waitFor();
    expect(await s.locator('[data-prompt=my-quick-sweep] [data-testid=prompt-status]').textContent()).toBe('Approved');
  });

  it('deletes only after a confirmation', async () => {
    const c = s.locator('[data-prompt=my-quick-sweep]');
    await c.getByRole('button', { name: /^Delete prompt/ }).click();
    expect(await s.evaluate(() => window.jaffloop.customPrompts().then((x) => x.length))).toBe(2);
    await c.getByRole('button', { name: 'Cancel' }).click();
    await c.getByRole('button', { name: /^Delete prompt/ }).click();
    await c.getByRole('button', { name: /^Confirm delete/ }).click();
    await c.waitFor({ state: 'detached' });
    expect(await s.evaluate(() => window.jaffloop.customPrompts().then((x) => x.map((p) => p.id)))).toEqual(['weekend-teams']);
  });
});

describe('run on a schedule', () => {
  it('previews the exact command and never installs it', async () => {
    const sel = s.getByLabel('Prompt to schedule');
    const options = await sel.locator('option').allTextContents();
    expect(options).toContain('Monday sweep: what I promised');
    expect(options).toContain('Weekend on Teams'); // an approved custom prompt
    expect(options).not.toContain('Make a new prompt');
    await sel.selectOption({ label: 'Monday sweep: what I promised' });
    await s.getByLabel('Argument since').fill('last Monday');
    await s.getByLabel('Extra tools Claude may use').fill('mcp__outlook__*, mcp__teams__*');
    const cmd = s.locator('[data-testid=sweep-cmd]');
    const text = (await cmd.textContent())!;
    expect(text.startsWith("claude -p 'Read my Outlook sent mail and calendar from last Monday until now")).toBe(true);
    expect(text).toContain("--allowedTools 'mcp__jaffloop__*' 'mcp__outlook__*' 'mcp__teams__*'");
    expect(await s.getByText('Run the command once in a terminal first').count()).toBe(1);
    expect(await s.getByText('claude mcp list').count()).toBe(1);
    expect(await s.getByRole('button', { name: 'Install on this Mac' }).isDisabled()).toBe(false);

    await s.getByRole('button', { name: 'Copy command' }).nth(1).click();
    expect(await clip()).toBe(text);
    // weekdays default to Mon-Fri; clearing them all blocks the install
    expect(await s.getByRole('group', { name: 'Weekdays' }).locator('[aria-pressed=true]').count()).toBe(5);
    await s.locator('[data-testid=sweep-cmd]').scrollIntoViewIfNeeded();
    await shot(s, 'claude-tab-schedule');
    for (const d of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']) await s.getByRole('group', { name: 'Weekdays' }).getByRole('button', { name: d }).click();
    expect(await s.getByRole('button', { name: 'Install on this Mac' }).isDisabled()).toBe(true);
    for (const d of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']) await s.getByRole('group', { name: 'Weekdays' }).getByRole('button', { name: d }).click();
    expect(await s.getByRole('button', { name: 'Install on this Mac' }).isDisabled()).toBe(false);
  });
});

describe('sync health', () => {
  it('is empty until Claude imports something, then lists the sources', async () => {
    await s.locator('[data-testid=health-empty]').waitFor();
    expect(await s.locator('[data-testid=health-empty]').textContent()).toContain('Nothing imported by Claude yet');
    await mcp([{ name: 'add_items', arguments: { items: [
      { kind: 'task', title: 'From Outlook 1', external_id: 'outlook:1', source_label: 'outlook' },
      { kind: 'task', title: 'From Outlook 2', external_id: 'outlook:2', source_label: 'outlook' },
      { kind: 'task', title: 'From Jira', external_id: 'jira:PLAT-1', source_label: 'jira' },
    ] } }]);
    await s.locator('[data-testid=health-row][data-source=outlook]').waitFor({ timeout: 8000 });
    const outlook = s.locator('[data-source=outlook]');
    expect((await outlook.locator('td').allTextContents()).slice(1, 4)).toEqual(['2', '2', 'just now']);
    expect(await s.locator('[data-testid=health-row]').count()).toBe(2);
    expect(await s.locator('[data-testid=quiet]').count()).toBe(0); // both imported just now
    expect(await s.locator('[data-testid=last-write]').textContent()).toBe('just now');
    await s.locator('[data-testid=health-table]').scrollIntoViewIfNeeded();
    await sleep(200);
    await shot(s, 'claude-tab-health');
  });
});
