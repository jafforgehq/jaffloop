// 0.5.0 custom prompts: validation, store round trip and approval, MCP list_prompts / save_prompt / prompts list+get.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, openMemoryDatabase, Store } from '../src/core';
import { MCPServer, promptSetWatcher } from '../src/mcp/server';
import { PROMPTS } from '../src/shared/prompts';
import { validateCustomPrompt } from '../src/shared/prompt-validate';
import type { CustomPromptInput } from '../src/shared/types';

const NOW = Date.UTC(2026, 9, 15, 9, 0, 0);
const IDS = PROMPTS.map((p) => p.id);
const good = (o: Partial<CustomPromptInput> = {}): CustomPromptInput => ({
  id: 'teams-digest', title: 'Teams digest', description: 'Reads Teams.', needs: ['Teams'],
  arguments: [{ name: 'since', description: 'Start', required: false, default: 'yesterday' }],
  text: 'Read my Teams chats since {{since}} and add what I promised.', ...o,
});
const err = (o: Partial<CustomPromptInput>): string | null => validateCustomPrompt(good(o), IDS);

describe('validateCustomPrompt', () => {
  it('accepts a good prompt', () => expect(validateCustomPrompt(good(), IDS)).toBeNull());
  it('id: slug, 2-40 chars, not a built-in', () => {
    for (const id of ['', 'a', 'A-b', '-ab', 'a b', 'a_b', 'x'.repeat(41), 'é1']) expect(err({ id }), id).not.toBeNull();
    for (const id of ['ab', '1a', 'x'.repeat(40), 'a-b-1']) expect(err({ id }), id).toBeNull();
    expect(err({ id: 'monday-sweep' })).toMatch(/built-in/);
    for (const id of IDS) expect(err({ id }), id).not.toBeNull();
  });
  it('title 1-80, description <= 300, text 20-8000', () => {
    expect(err({ title: '' })).not.toBeNull();
    expect(err({ title: 'x'.repeat(81) })).not.toBeNull();
    expect(err({ title: 'x'.repeat(80) })).toBeNull();
    expect(err({ description: 'x'.repeat(301) })).not.toBeNull();
    expect(err({ description: 'x'.repeat(300) })).toBeNull();
    expect(err({ text: 'x'.repeat(19), arguments: [] })).not.toBeNull();
    expect(err({ text: 'x'.repeat(20), arguments: [] })).toBeNull();
    expect(err({ text: 'x'.repeat(8001), arguments: [] })).not.toBeNull();
    expect(err({ text: 'x'.repeat(8000), arguments: [] })).toBeNull();
  });
  it('needs: at most 8 of at most 40 chars', () => {
    expect(err({ needs: Array(8).fill('a') })).toBeNull();
    expect(err({ needs: Array(9).fill('a') })).not.toBeNull();
    expect(err({ needs: ['x'.repeat(41)] })).not.toBeNull();
    expect(err({ needs: ['x'.repeat(40)] })).toBeNull();
  });
  it('arguments: at most 8, valid unique names, short description and default', () => {
    const arg = (name: string) => ({ name, description: '', required: false });
    const eight = Array.from({ length: 8 }, (_, i) => arg(`a${i}`));
    expect(err({ arguments: eight, text: 'x'.repeat(30) })).toBeNull();
    expect(err({ arguments: [...eight, arg('z')], text: 'x'.repeat(30) })).not.toBeNull();
    for (const name of ['', 'A', '1a', 'a-b', 'a b', 'x'.repeat(31)]) expect(err({ arguments: [arg(name)], text: 'x'.repeat(30) }), name).not.toBeNull();
    expect(err({ arguments: [arg('a_1'), arg('x'.repeat(30))], text: 'x'.repeat(30) })).toBeNull();
    expect(err({ arguments: [arg('a'), arg('a')], text: 'x'.repeat(30) })).toMatch(/twice/);
    expect(err({ arguments: [{ ...arg('a'), description: 'x'.repeat(201) }], text: 'x'.repeat(30) })).not.toBeNull();
    expect(err({ arguments: [{ ...arg('a'), default: 'x'.repeat(201) }], text: 'x'.repeat(30) })).not.toBeNull();
    expect(err({ arguments: [{ ...arg('a'), description: 'x'.repeat(200), default: 'x'.repeat(200) }], text: 'x'.repeat(30) })).toBeNull();
  });
  it('every {{placeholder}} must be a declared argument; declared ones need not appear', () => {
    expect(err({ text: 'Read {{since}} and {{other}} please, thank you.' })).toMatch(/other/);
    expect(err({ text: 'Read nothing in particular, no placeholders at all.' })).toBeNull();
    expect(err({ text: 'Read {{since}} and {{since}} twice, thank you.' })).toBeNull();
  });
});

describe('Store custom prompts', () => {
  let store: Store;
  beforeEach(() => { store = new Store(openMemoryDatabase()); });

  it('starts empty; an app save is approved and round trips every field', () => {
    expect(store.customPrompts()).toEqual([]);
    expect(store.customPrompt('teams-digest')).toBeNull();
    const r = store.saveCustomPrompt(good(), 'app', NOW);
    expect(r.error).toBeUndefined();
    expect(r.prompt).toEqual({ ...good(), approved: true, source: 'app', createdAt: NOW, updatedAt: NOW });
    expect(store.customPrompt('teams-digest')).toEqual(r.prompt);
  });
  it('sorts by title', () => {
    store.saveCustomPrompt(good({ id: 'b-one', title: 'Zeta' }), 'app', NOW);
    store.saveCustomPrompt(good({ id: 'a-one', title: 'alpha' }), 'app', NOW);
    store.saveCustomPrompt(good({ id: 'c-one', title: 'Beta' }), 'app', NOW);
    expect(store.customPrompts().map((p) => p.title)).toEqual(['alpha', 'Beta', 'Zeta']);
  });
  it('an invalid prompt is refused with the error text and nothing is stored', () => {
    expect(store.saveCustomPrompt(good({ id: 'friday-status' }), 'app', NOW)).toEqual({ error: expect.stringMatching(/built-in/) });
    expect(store.saveCustomPrompt(good({ title: '' }), 'mcp', NOW).error).toMatch(/title/);
    expect(store.customPrompts()).toEqual([]);
  });
  it('an mcp save is unapproved; editing it through mcp keeps it unapproved; createdAt survives edits', () => {
    const a = store.saveCustomPrompt(good(), 'mcp', NOW).prompt!;
    expect(a).toMatchObject({ approved: false, source: 'mcp' });
    expect(store.approveCustomPrompt('teams-digest', NOW + 1)).toBe(true);
    expect(store.customPrompt('teams-digest')).toMatchObject({ approved: true, createdAt: NOW, updatedAt: NOW + 1 });
    const b = store.saveCustomPrompt(good({ title: 'Edited by Claude' }), 'mcp', NOW + 5).prompt!;
    expect(b).toMatchObject({ title: 'Edited by Claude', approved: false, createdAt: NOW, updatedAt: NOW + 5 });
  });
  it('an app edit approves and keeps createdAt', () => {
    store.saveCustomPrompt(good(), 'mcp', NOW);
    const b = store.saveCustomPrompt(good({ title: 'Mine now' }), 'app', NOW + 9).prompt!;
    expect(b).toMatchObject({ approved: true, source: 'app', createdAt: NOW, updatedAt: NOW + 9 });
  });
  it('approve and delete report whether the id existed', () => {
    expect(store.approveCustomPrompt('nope', NOW)).toBe(false);
    expect(store.deleteCustomPrompt('nope')).toBe(false);
    store.saveCustomPrompt(good(), 'mcp', NOW);
    expect(store.deleteCustomPrompt('teams-digest')).toBe(true);
    expect(store.customPrompts()).toEqual([]);
  });
  it('empty argument defaults are dropped, required is a boolean', () => {
    const p = store.saveCustomPrompt(good({ arguments: [{ name: 'since', description: 'd', required: true, default: '' }], text: 'Read {{since}} now, please and thanks.' }), 'app', NOW).prompt!;
    expect(p.arguments).toEqual([{ name: 'since', description: 'd', required: true }]);
  });
  it('exportJSON includes custom_prompts with ISO dates and a boolean approved', () => {
    store.saveCustomPrompt(good(), 'mcp', NOW);
    const d = JSON.parse(store.exportJSON());
    expect(d.custom_prompts).toEqual([expect.objectContaining({ id: 'teams-digest', approved: false, source: 'mcp', created_at: '2026-10-15T09:00:00Z', updated_at: '2026-10-15T09:00:00Z' })]);
  });
});

describe('MCP prompts', () => {
  let store: Store;
  let server: MCPServer;
  let rpcId = 0;
  beforeEach(() => {
    store = new Store(openMemoryDatabase());
    server = new MCPServer(store, { now: () => NOW });
  });
  const rpc = (method: string, params?: object) => server.handle({ jsonrpc: '2.0', id: ++rpcId, method, ...(params ? { params } : {}) }) as Record<string, any>;
  function call(tool: string, args: object = {}): { text: string; isError: boolean; json: any } {
    const res = rpc('tools/call', { name: tool, arguments: args }).result;
    const text: string = res.content[0].text;
    let json: unknown;
    try { json = JSON.parse(text); } catch { json = undefined; }
    return { text, isError: res.isError === true, json };
  }
  const input = (o: Record<string, unknown> = {}) => ({ id: 'teams-digest', title: 'Teams digest', description: 'Reads Teams.', needs: ['Teams'],
    arguments: [{ name: 'since', description: 'Start', required: false, default: 'yesterday' }], text: 'Read my Teams chats since {{since}} and add what I promised.', ...o });

  it('list_prompts: built-in and custom ids, with approval state; not a write', () => {
    const empty = call('list_prompts');
    expect(empty.json.builtin).toEqual(PROMPTS.map((p) => ({ id: p.id, title: p.title })));
    expect(empty.json.custom).toEqual([]);
    store.saveCustomPrompt(input(), 'mcp', NOW);
    expect(call('list_prompts').json.custom).toEqual([{ id: 'teams-digest', title: 'Teams digest', approved: false }]);
    expect(store.auditLog()[0]).toMatchObject({ tool: 'list_prompts', wrote: false });
  });

  it('save_prompt: needs_approval result, stored unapproved, audited as a write', () => {
    const r = call('save_prompt', input());
    expect(r.isError).toBe(false);
    expect(r.json).toEqual({ id: 'teams-digest', status: 'needs_approval', message: 'Open Jaffloop, Settings, Claude (MCP) and approve it.' });
    expect(store.customPrompt('teams-digest')).toMatchObject({ approved: false, source: 'mcp', needs: ['Teams'] });
    expect(store.auditLog()[0]).toMatchObject({ tool: 'save_prompt', summary: 'save_prompt: teams-digest', wrote: true });
  });
  it('save_prompt cannot approve: saving over an approved prompt resets approval; unknown fields are ignored', () => {
    store.saveCustomPrompt(input(), 'app', NOW);
    call('save_prompt', input({ approved: true, title: 'New title' }));
    expect(store.customPrompt('teams-digest')).toMatchObject({ title: 'New title', approved: false });
  });
  it('save_prompt validation errors are tool errors and write nothing', () => {
    for (const [args, re] of [
      [input({ id: 'monday-sweep' }), /built-in/], [input({ id: 'Bad Id' }), /id/], [input({ title: '' }), /title/], [input({ text: 'short' }), /text/],
      [input({ text: 'Read {{nope}} please, thank you.' }), /nope/], [{ title: 'x' }, /id is required/], [input({ needs: 'Teams' }), /needs/],
      [input({ arguments: ['x'] }), /arguments/], [input({ title: 7 }), /title must be a string/],
    ] as const) {
      const r = call('save_prompt', args);
      expect(r.isError, JSON.stringify(args)).toBe(true);
      expect(r.text).toMatch(re);
    }
    expect(store.customPrompts()).toEqual([]);
    expect(store.auditLog()[0]).toMatchObject({ tool: 'save_prompt', wrote: false });
    expect(store.auditLog()[0]!.summary).toMatch(/^error: /);
  });
  it('save_prompt is blocked in read-only mode; list_prompts is not', () => {
    store.saveSettings({ ...store.settings(), mcpReadOnly: true });
    const r = call('save_prompt', input());
    expect(r).toMatchObject({ isError: true, text: 'Jaffloop is in read-only mode for Claude. Change this in Settings > MCP.' });
    expect(store.customPrompts()).toEqual([]);
    expect(store.auditLog()[0]).toMatchObject({ tool: 'save_prompt', summary: 'blocked: read-only mode', wrote: false });
    expect(call('list_prompts').isError).toBe(false);
  });
  it('there is no tool to approve or delete', () => {
    const names = (rpc('tools/list').result.tools as Array<{ name: string }>).map((t) => t.name);
    expect(names.filter((n) => /prompt/.test(n))).toEqual(['list_prompts', 'save_prompt']);
  });

  it('prompts/list hides unapproved custom prompts and shows approved ones in the built-in shape', () => {
    store.saveCustomPrompt(input(), 'mcp', NOW);
    expect(rpc('prompts/list').result.prompts).toHaveLength(PROMPTS.length);
    store.approveCustomPrompt('teams-digest', NOW);
    const list = rpc('prompts/list').result.prompts as any[];
    expect(list).toHaveLength(PROMPTS.length + 1);
    expect(list.at(-1)).toEqual({ name: 'teams-digest', title: 'Teams digest', description: 'Reads Teams.', arguments: [{ name: 'since', description: 'Start', required: false }] });
  });
  it('prompts/get serves approved prompts with renderPrompt semantics; unapproved and unknown are -32602', () => {
    store.saveCustomPrompt(input({ arguments: [{ name: 'since', description: 'd', required: false, default: 'yesterday' }, { name: 'who', description: 'd', required: true }], text: 'Read {{since}} for {{who}} now, please.' }), 'mcp', NOW);
    expect(rpc('prompts/get', { name: 'teams-digest' }).error).toEqual({ code: -32602, message: 'Unknown prompt: teams-digest' });
    store.approveCustomPrompt('teams-digest', NOW);
    expect(rpc('prompts/get', { name: 'teams-digest', arguments: {} }).error).toEqual({ code: -32602, message: 'Missing required argument: who' });
    const r = rpc('prompts/get', { name: 'teams-digest', arguments: { who: 'Sara' } }).result;
    expect(r.description).toBe('Reads Teams.');
    expect(r.messages).toEqual([{ role: 'user', content: { type: 'text', text: 'Read yesterday for Sara now, please.' } }]);
    expect(rpc('prompts/get', { name: 'teams-digest', arguments: { who: 'Sara', since: 'Monday' } }).result.messages[0].content.text).toBe('Read Monday for Sara now, please.');
    store.deleteCustomPrompt('teams-digest');
    expect(rpc('prompts/get', { name: 'teams-digest' }).error.code).toBe(-32602);
  });
  it('a new prompt cannot shadow a built-in over MCP prompts/get', () => {
    expect(call('save_prompt', input({ id: 'friday-status' })).isError).toBe(true);
    expect(rpc('prompts/get', { name: 'friday-status' }).result.messages[0].content.text).toBe(PROMPTS.find((p) => p.id === 'friday-status')!.text);
  });
});

describe('promptSetWatcher (list_changed detection)', () => {
  it('is true only when the approved set changed after another connection committed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jaffloop-watch-'));
    const mcp = new Store(openDatabase(join(dir, 'w.sqlite'))), app = new Store(openDatabase(join(dir, 'w.sqlite')));
    try {
      const changed = promptSetWatcher(mcp);
      expect(changed()).toBe(false);
      app.saveCustomPrompt(good(), 'mcp', NOW);              // unapproved: not part of the set
      expect(changed()).toBe(false);
      app.approveCustomPrompt('teams-digest', NOW + 1);
      expect(changed()).toBe(true);
      expect(changed()).toBe(false);                         // nothing new since
      app.capture('todo unrelated write');
      expect(changed()).toBe(false);
      app.saveCustomPrompt(good({ title: 'Renamed' }), 'app', NOW + 2);   // edited and approved again: updatedAt moved
      expect(changed()).toBe(true);
      app.deleteCustomPrompt('teams-digest');
      expect(changed()).toBe(true);
    } finally { mcp.db.close(); app.db.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});
