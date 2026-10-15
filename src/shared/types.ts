// Shared data types: the contract between core, main process, MCP server and renderer.
// Dates cross every boundary as epoch milliseconds (number). The SQLite file keeps GRDB's text format
// ("yyyy-MM-dd HH:mm:ss.SSS" in UTC); only src/core/db.ts converts between the two.

export type ItemKind = 'owe' | 'wait' | 'bring' | 'task' | 'said' | 'note';
export const ITEM_KINDS: ItemKind[] = ['owe', 'wait', 'bring', 'task', 'said', 'note'];
export type ItemStatus = 'open' | 'done' | 'dropped';
export type ItemSource = 'hotkey' | 'mcp' | 'meeting' | 'import';
export type Relation = 'report' | 'peer' | 'manager' | 'stakeholder' | 'other';
export const RELATIONS: Relation[] = ['report', 'peer', 'manager', 'stakeholder', 'other'];
export type InteractionKind = '1on1' | 'meeting' | 'chat' | 'other';

export interface Item {
  id: string;
  kind: ItemKind;
  title: string;
  body: string | null;
  quote: string | null;
  personId: string | null;
  status: ItemStatus;
  dueAt: number | null;
  dueHasTime: boolean;
  remindAt: number | null;
  snoozedUntil: number | null;
  snoozeCount: number;
  recurRule: string | null;
  pinned: boolean;
  inbox: boolean;
  source: ItemSource;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  lastTouchedAt: number;
}

export interface Person {
  id: string;
  handle: string;
  name: string;
  relation: Relation;
  cadenceDays: number | null;
  /** comma separated */
  matchEmails: string;
  hiddenFromClaude: boolean;
  archived: boolean;
  /** private notes; never exposed over MCP */
  notes: string;
}

export interface Interaction {
  id: string;
  personId: string;
  occurredAt: number;
  kind: InteractionKind;
  calendarEventId: string | null;
  notes: string | null;
}

export interface PersonSummary {
  person: Person;
  lastInteraction: number | null;
  openOwe: number;
  openWait: number;
  daysSinceLast: number | null;
  cadenceOverdue: boolean;
}

export interface TodaySections {
  slipping: Item[];
  overdue: Item[];
  today: Item[];
  waitingStale: Item[];
  inbox: Item[];
  checkIn: PersonSummary[];
}

export interface AuditEntry {
  id: number;
  at: number;
  tool: string;
  summary: string;
  wrote: boolean;
}

/** Stored in the `settings` table so the MCP process sees them too. */
export interface Settings {
  eodTime: string; // "17:30"
  workStart: string;
  workEnd: string;
  morningBrief: string;
  staleDaysAfterDue: number;
  staleDaysNoDue: number;
  mcpReadOnly: boolean;
  compact: boolean;
  sound: boolean;
  haptics: boolean;
  /** Electron accelerator, e.g. "Alt+Space". (The Swift app stored "opt+space"; core converts on read.) */
  hotkey: string;
}

export interface ItemFilter {
  kinds?: ItemKind[];
  personId?: string;
  /** default 'open'; null = any */
  status?: ItemStatus | null;
  dueBefore?: number;
  overdueOnly?: boolean;
  staleDays?: number;
  tag?: string;
  inboxOnly?: boolean;
  includeSnoozed?: boolean;
  limit?: number;
}

export type TokenRole = 'kind' | 'person' | 'date' | 'recurrence' | 'tag' | 'pin' | 'remind' | 'quote';
export interface ParsedToken {
  role: TokenRole;
  /** UTF-16 offsets into the input string */
  start: number;
  end: number;
  text: string;
}

export interface ParsedCapture {
  kind: ItemKind;
  kindExplicit: boolean;
  personHandle: string | null;
  title: string;
  quote: string | null;
  dueAt: number | null;
  dueHasTime: boolean;
  remindAt: number | null;
  recurRule: string | null;
  tags: string[];
  pinned: boolean;
  tokens: ParsedToken[];
  /** neither a date nor a person (task/owe/wait/bring only) */
  inbox: boolean;
}

export interface WeekSummary {
  created: Item[];
  completed: Item[];
  slipped: Item[];
  stale: Item[];
}

/** Everything the renderer needs to draw the main screens; re-fetched whenever data changes. */
export interface Snapshot {
  settings: Settings;
  today: TodaySections;
  openItems: Item[];
  summaries: PersonSummary[];
  tags: Array<[string, number]>;
  auditLog: AuditEntry[];
  /** number of snoozed open items (sidebar badge) */
  snoozedCount: number;
  /** wall clock of the main process at the time of the snapshot */
  now: number;
}
