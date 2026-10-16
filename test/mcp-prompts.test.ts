// 0.3.0 MCP prompts: prompts/list and prompts/get over the shared PROMPTS list.
import { beforeEach, describe, expect, it } from 'vitest';
import { openMemoryDatabase, Store } from '../src/core';
import { MCPServer } from '../src/mcp/server';
import { PROMPTS } from '../src/shared/prompts';

let server: MCPServer;
let rpcId = 0;
beforeEach(() => { server = new MCPServer(new Store(openMemoryDatabase())); });

const rpc = (method: string, params?: object) => server.handle({ jsonrpc: '2.0', id: ++rpcId, method, ...(params ? { params } : {}) }) as Record<string, any>;

describe('prompts/list', () => {
  it('is advertised in initialize', () => {
    expect(rpc('initialize', {}).result.capabilities.prompts).toEqual({});
  });

  it('returns every prompt with name, title, description and arguments', () => {
    const list = rpc('prompts/list').result.prompts as any[];
    expect(list).toHaveLength(10);
    expect(list.map((p) => p.name)).toEqual(PROMPTS.map((p) => p.id));
    for (const [i, p] of PROMPTS.entries()) {
      expect(list[i]).toEqual({
        name: p.id, title: p.title, description: p.description,
        arguments: p.arguments.map((a) => ({ name: a.name, description: a.description, required: a.required })),
      });
    }
    expect(list.find((p) => p.name === 'meeting-notes').arguments).toEqual([
      { name: 'notes', description: expect.any(String), required: true },
      { name: 'person', description: expect.any(String), required: false },
    ]);
    expect(list.find((p) => p.name === 'friday-status').arguments).toEqual([]);
  });

  it('works without params', () => {
    expect(rpc('prompts/list', {}).result.prompts).toHaveLength(10);
  });
});

describe('prompts/get', () => {
  it('returns a user message with the rendered text and the description', () => {
    const r = rpc('prompts/get', { name: 'monday-sweep', arguments: { since: 'Monday 5 October' } }).result;
    expect(r.description).toBe(PROMPTS.find((p) => p.id === 'monday-sweep')!.description);
    expect(r.messages).toHaveLength(1);
    expect(r.messages[0]).toMatchObject({ role: 'user', content: { type: 'text' } });
    expect(r.messages[0].content.text).toContain('from Monday 5 October until now');
    expect(r.messages[0].content.text).toContain('add_items');
    expect(r.messages[0].content.text).toContain('external_id');
  });

  it('fills defaults for optional arguments that are missing, empty or blank', () => {
    for (const args of [undefined, {}, { since: '' }, { since: '   ' }]) {
      const text = rpc('prompts/get', { name: 'monday-sweep', ...(args ? { arguments: args } : {}) }).result.messages[0].content.text as string;
      expect(text).toContain('from last Friday until now');
    }
    expect(rpc('prompts/get', { name: 'waiting-sweep' }).result.messages[0].content.text).toContain('last 14 days');
    expect(rpc('prompts/get', { name: 'review-evidence', arguments: { person: 'sara' } }).result.messages[0].content.text).toContain('last 6 months');
  });

  it('numbers given as arguments are accepted as text', () => {
    expect(rpc('prompts/get', { name: 'waiting-sweep', arguments: { days: 30 } }).result.messages[0].content.text).toContain('last 30 days');
  });

  it('a missing required argument is a JSON-RPC error -32602 naming it', () => {
    for (const params of [{ name: 'prep-1on1' }, { name: 'prep-1on1', arguments: {} }, { name: 'prep-1on1', arguments: { person: '  ' } }]) {
      const r = rpc('prompts/get', params);
      expect(r.result).toBeUndefined();
      expect(r.error).toEqual({ code: -32602, message: 'Missing required argument: person' });
    }
    expect(rpc('prompts/get', { name: 'meeting-notes', arguments: { person: 'sara' } }).error.message).toBe('Missing required argument: notes');
  });

  it('an unknown or absent prompt name is -32602', () => {
    expect(rpc('prompts/get', { name: 'nope' }).error).toEqual({ code: -32602, message: 'Unknown prompt: nope' });
    expect(rpc('prompts/get', {}).error.code).toBe(-32602);
  });

  it('every prompt renders with no leftover placeholder except missing required arguments, which are refused', () => {
    expect(PROMPTS).toHaveLength(10);
    for (const p of PROMPTS) {
      const required = p.arguments.filter((a) => a.required);
      const bare = rpc('prompts/get', { name: p.id, arguments: {} });
      if (required.length > 0) {
        expect(bare.error.code, p.id).toBe(-32602);
      } else {
        expect(bare.result.messages[0].content.text, p.id).not.toMatch(/\{\{/);
      }
      const full = Object.fromEntries(required.map((a) => [a.name, `value-of-${a.name}`]));
      const text = rpc('prompts/get', { name: p.id, arguments: full }).result.messages[0].content.text as string;
      // an optional argument without a default stays as {{name}} (renderPrompt's rule): meeting-notes {{person}} today, see the report
      const noDefault = p.arguments.filter((a) => !a.required && a.default === undefined).map((a) => a.name);
      expect([...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).filter((n) => !noDefault.includes(n!)), p.id).toEqual([]);
      for (const a of required) expect(text, p.id).toContain(`value-of-${a.name}`);
    }
  });

  it('every tool a prompt mentions exists', () => {
    const tools = (rpc('tools/list').result.tools as Array<{ name: string }>).map((t) => t.name);
    for (const p of PROMPTS) {
      const mentioned = p.text.match(/\b(?:capture|add_items?|list_items|get_person|list_people|complete_item|snooze_item|update_item|log_interaction|search|prep_brief|week_summary)\b/g) ?? [];
      for (const m of mentioned) expect(tools, `${p.id} mentions ${m}`).toContain(m);
    }
  });
});
