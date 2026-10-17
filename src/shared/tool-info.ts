// Plain-language descriptions of every MCP tool, shown in Settings → Claude (MCP) → What Claude can do.
// test/tool-info.test.ts keeps the keys equal to the tool names the MCP server lists.

export interface ToolInfo {
  /** short name for people */
  title: string;
  /** what the tool does, in the user's words */
  what: string;
  /** true when it changes data in Jaffloop (blocked by Read-only mode) */
  writes: boolean;
}

export const TOOL_INFO: Record<string, ToolInfo> = {
  capture: { title: 'Capture a line', what: 'Adds one item from a line written the way you type in the capture bar, for example "owe @sara review RFC fri".', writes: true },
  add_item: { title: 'Add an item', what: 'Adds one promise, wait, task or note with a person, due date and source link. Repeats of the same source id are skipped.', writes: true },
  add_items: { title: 'Add many items', what: 'Adds a whole batch in one call, such as the commitments found in a week of mail. Items already imported are skipped, so running it twice never makes copies.', writes: true },
  list_items: { title: 'List items', what: 'Looks up your items by person, kind, status, due date or source id, so Claude can see what is already tracked.', writes: false },
  get_person: { title: 'Read a person', what: 'Reads one person: their open items, last 1:1 and recent interactions. People you hid from Claude are not visible. Notes appear only if sharing 1:1 notes is on.', writes: false },
  list_people: { title: 'List people', what: 'Lists the people you track with their handle, position and 1:1 rhythm, without the ones you hid from Claude.', writes: false },
  save_person: { title: 'Add or update a person', what: 'Creates a person or changes their name, position, relation, 1:1 rhythm or work emails. It cannot write notes or change the hidden flag.', writes: true },
  complete_item: { title: 'Complete an item', what: 'Marks an item done, for example after Claude sees you already sent the reply.', writes: true },
  snooze_item: { title: 'Snooze an item', what: 'Moves an item out of sight until a date you choose.', writes: true },
  update_item: { title: 'Edit an item', what: 'Changes the title, due date, person or kind of an existing item.', writes: true },
  log_interaction: { title: 'Log a 1:1 or chat', what: 'Records that you met or talked to someone, with optional notes, so their 1:1 rhythm stays up to date.', writes: true },
  search: { title: 'Search', what: 'Searches your items and people by text.', writes: false },
  prep_brief: { title: 'Prep a 1:1', what: 'Collects what to bring to a 1:1: open items both ways, what is overdue and the last conversations. Notes appear only if sharing 1:1 notes is on.', writes: false },
  week_summary: { title: 'Week summary', what: 'Returns what you completed, what slipped and what is still waiting this week, for a status update.', writes: false },
  list_prompts: { title: 'List prompts', what: 'Shows the ready-made and custom prompt names so Claude does not reuse one when it writes a new prompt.', writes: false },
  save_prompt: { title: 'Save a prompt', what: 'Lets Claude save a prompt it wrote. The prompt waits in this tab until you read and approve it; Claude cannot approve or delete prompts.', writes: true },
};
