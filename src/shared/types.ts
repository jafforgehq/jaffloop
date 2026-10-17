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
  /** where it came from, e.g. 'outlook:<message id>', 'jira:PLAT-482:<comment id>'; unique when set, so a repeated import is skipped */
  externalId: string | null;
  /** short source name shown as a chip: 'outlook', 'jira', 'confluence', 'teams', ... */
  sourceLabel: string | null;
  /** link back to the source (opened in the browser) */
  sourceUrl: string | null;
  /** the 1:1 (Interaction id) this item was recorded in, so the 1:1 history can list its action items */
  interactionId: string | null;
  /** added by Claude (MCP) while "Review what Claude adds" is on: waits in the Inbox for Accept or Dismiss, and is left out of Today, counts and notifications until accepted */
  proposed: boolean;
}

export interface Person {
  id: string;
  handle: string;
  name: string;
  /** position / job title, e.g. 'Staff engineer'; empty when unknown (shown with the name, also visible to Claude) */
  title: string;
  relation: Relation;
  cadenceDays: number | null;
  /** comma separated */
  matchEmails: string;
  hiddenFromClaude: boolean;
  archived: boolean;
  /** private notes; never exposed over MCP */
  notes: string;
  /** work anniversary, 'YYYY-MM-DD' (private, not exposed over MCP) */
  startDate: string | null;
  /** birthday, 'MM-DD' (private, not exposed over MCP) */
  birthday: string | null;
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
  /** base for Jira keys, e.g. 'https://acme.atlassian.net/browse/'; empty = keys are not links */
  jiraBaseUrl: string;
  /** capture templates, stored as JSON in the settings table */
  captureTemplates: CaptureTemplate[];
  /** items Claude adds over MCP wait in the Inbox as proposals until you accept them (default off) */
  reviewClaudeItems: boolean;
  /** Claude (MCP) may read the notes of past 1:1s through get_person and prep_brief (default true); when off they are left out */
  shareOneOnOneNotes: boolean;
}

/** `prep @sara` expands to the template's lines with {person} replaced by the handle and {rest} by the text after the person. */
export interface CaptureTemplate {
  /** the trigger word, lower case, no spaces */
  name: string;
  /** capture lines, e.g. ['bring @{person} how are things going', 'bring @{person} career goals'] */
  lines: string[];
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
  /** exact match on Item.externalId */
  externalId?: string;
  includeSnoozed?: boolean;
  /** proposed items are left out unless this is true */
  includeProposed?: boolean;
  /** only proposed items */
  proposedOnly?: boolean;
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
  /** open items Claude proposed, newest first (not part of openItems or today) */
  proposed: Item[];
  /** wall clock of the main process at the time of the snapshot */
  now: number;
}

// ---------------------------------------------------------------- 0.2.0 features

export interface KeptRate {
  /** days looked back */
  periodDays: number;
  /** promises (kind owe) completed on or before their due date, or with no due date */
  onTime: number;
  /** completed after the due date */
  late: number;
  total: number;
  /** onTime / total, null when total is 0 */
  rate: number | null;
}

/** Everything the weekly review screen shows, for the window [from, to). */
export interface ReviewData {
  from: number;
  to: number;
  /** open items snoozed three or more times */
  slipped: Item[];
  /** open waiting-on items past the stale rule */
  staleWaits: Item[];
  /** open promises (owe) past their due date */
  overduePromises: Item[];
  /** people past their 1:1 cadence, most overdue first */
  offCadence: PersonSummary[];
  /** completed in the window */
  closed: Item[];
  /** dropped in the window */
  dropped: Item[];
  /** created in the window */
  created: Item[];
  keptRate: KeptRate;
}

export type ActivityEvent = 'created' | 'completed' | 'dropped' | 'snoozed' | 'reopened' | 'edited';
export interface ActivityEntry {
  at: number;
  event: ActivityEvent;
  /** the item as it is now (may be done or dropped) */
  item: Item;
}

/** One person's last N weeks: was there a 1:1 each week? (oldest first) */
export interface HeatRow {
  personId: string;
  weeks: boolean[];
}

export interface UpcomingDate {
  personId: string;
  kind: 'anniversary' | 'birthday';
  /** midnight of the next occurrence */
  on: number;
  inDays: number;
  /** completed years for an anniversary; null for a birthday */
  years: number | null;
}

/** A run of text in an item title: plain, or a link (Jira key or URL). */
export interface LinkSegment {
  text: string;
  href?: string;
}

// ---------------------------------------------------------------- 0.3.0

/** One past 1:1 with the notes written for it and the action items recorded in it (any status). */
export interface InteractionWithItems {
  interaction: Interaction;
  items: Item[];
}

// ---------------------------------------------------------------- 0.5.0

export interface PromptArg {
  name: string;
  description: string;
  required: boolean;
  default?: string;
}

/** A prompt the user (or Claude, over MCP) wrote. Claude's start unapproved and are not served as MCP prompts until approved in the app. */
export interface CustomPrompt {
  /** slug: lower case letters, digits and '-', not the id of a built-in prompt; becomes /mcp__jaffloop__<id> */
  id: string;
  title: string;
  description: string;
  /** what Claude needs access to besides Jaffloop, e.g. ['Teams', 'Outlook mail'] */
  needs: string[];
  arguments: PromptArg[];
  /** uses {{name}} placeholders for the arguments */
  text: string;
  approved: boolean;
  source: 'app' | 'mcp';
  createdAt: number;
  updatedAt: number;
}

/** What the app can edit; source and timestamps are set by the store. */
export type CustomPromptInput = Pick<CustomPrompt, 'id' | 'title' | 'description' | 'needs' | 'arguments' | 'text'>;

/** Per source_label: how much Claude has imported and when last. */
export interface SyncHealthRow {
  /** the source_label ('outlook', 'jira', ...) */
  source: string;
  total: number;
  last7Days: number;
  lastAt: number | null;
}
export interface SyncHealth {
  sources: SyncHealthRow[];
  /** time of the last write by the MCP server (audit log), null when never */
  lastClaudeWriteAt: number | null;
}

/** A sweep that runs by itself through a launchd job on this Mac (the job file is the source of truth). */
export interface Schedule {
  /** built-in or approved custom prompt id */
  promptId: string;
  /** argument values, only the ones set */
  args: Record<string, string>;
  hour: number;
  minute: number;
  /** 0 = Sunday ... 6 = Saturday; empty = every day */
  weekdays: number[];
  /** extra --allowedTools patterns for the connectors, e.g. 'mcp__outlook__*' */
  extraAllowedTools: string;
  logPath: string;
}
