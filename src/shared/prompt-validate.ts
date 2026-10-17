// Validation of a custom prompt (pure: used by the store, the MCP server and the renderer's edit form).
import type { CustomPromptInput } from './types';

/** Error text, or null when the prompt is fine. `builtinIds` are the ids a custom prompt may not take. */
export function validateCustomPrompt(input: CustomPromptInput, builtinIds: string[]): string | null {
  const { id, title, description, text, needs, arguments: args } = input;
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{1,39}$/.test(id)) return 'id must be 2-40 characters: lower case letters, digits and dashes, starting with a letter or digit';
  if (builtinIds.includes(id)) return `id '${id}' is already a built-in prompt`;
  if (typeof title !== 'string' || title.trim().length < 1 || title.length > 80) return 'title must be 1-80 characters';
  if (typeof description !== 'string' || description.length > 300) return 'description must be at most 300 characters';
  if (typeof text !== 'string' || text.length < 20 || text.length > 8000) return 'text must be 20-8000 characters';
  if (!Array.isArray(needs) || needs.length > 8 || needs.some((n) => typeof n !== 'string' || n.length > 40)) return 'needs: at most 8 entries of at most 40 characters';
  if (!Array.isArray(args) || args.length > 8) return 'at most 8 arguments';
  const names = new Set<string>();
  for (const a of args) {
    if (typeof a?.name !== 'string' || !/^[a-z][a-z0-9_]{0,29}$/.test(a.name)) return `argument name '${String(a?.name)}' must be lower case letters, digits and underscores, starting with a letter (max 30)`;
    if (names.has(a.name)) return `argument '${a.name}' is declared twice`;
    names.add(a.name);
    if (typeof a.description !== 'string' || a.description.length > 200) return `argument '${a.name}': description must be at most 200 characters`;
    if (a.default !== undefined && (typeof a.default !== 'string' || a.default.length > 200)) return `argument '${a.name}': default must be at most 200 characters`;
  }
  for (const m of text.matchAll(/\{\{(\w+)\}\}/g)) {
    if (!names.has(m[1]!)) return `text uses {{${m[1]}}} but no argument named '${m[1]}' is declared`;
  }
  return null;
}
