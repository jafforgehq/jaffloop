import { describe, expect, it } from 'vitest';
import { openMemoryDatabase } from '../src/core/db';
import { Store } from '../src/core/store';
import { MCPServer } from '../src/mcp/server';
import { TOOL_INFO } from '../src/shared/tool-info';

const tools = (): Array<{ name: string }> => {
  const server = new MCPServer(new Store(openMemoryDatabase()), { now: () => Date.UTC(2026, 9, 15, 9) });
  return (server.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) as any).result.tools;
};

describe('TOOL_INFO', () => {
  it('has exactly the tools the MCP server lists', () => {
    expect(Object.keys(TOOL_INFO).sort()).toEqual(tools().map((t) => t.name).sort());
    expect(Object.keys(TOOL_INFO)).toHaveLength(16);
  });
  it('marks the write tools the same way the server does', () => {
    const writes = Object.entries(TOOL_INFO).filter(([, t]) => t.writes).map(([n]) => n).sort();
    expect(writes).toEqual(['add_item', 'add_items', 'capture', 'complete_item', 'log_interaction', 'save_person', 'save_prompt', 'snooze_item', 'update_item']);
  });
  it('has a title and a plain explanation for each', () => {
    for (const [name, t] of Object.entries(TOOL_INFO)) {
      expect(t.title.length, name).toBeGreaterThan(2);
      expect(t.what.length, name).toBeGreaterThan(20);
      expect(t.what.length, name).toBeLessThanOrEqual(260);
      expect(t.what.toLowerCase(), name).not.toBe(t.title.toLowerCase());
    }
  });
});
