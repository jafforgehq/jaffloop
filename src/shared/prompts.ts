// Ready-made prompts for Claude with the Jaffloop MCP server connected. One list, used twice:
// the MCP server serves it as MCP prompts (prompts/list, prompts/get: they show up as slash commands in Claude),
// and Settings → Claude (MCP) shows it with Copy buttons. Text uses {{name}} placeholders for arguments.
// Tool names: capture, add_item, add_items, list_items, get_person, list_people, complete_item, snooze_item, update_item,
// log_interaction, save_person, search, prep_brief, week_summary. Duplicates are skipped by the server when an external_id repeats.

export interface PromptArgument {
  name: string;
  description: string;
  required: boolean;
  /** used when the caller leaves a non-required argument empty */
  default?: string;
}

export interface JaffloopPrompt {
  id: string;
  title: string;
  /** one sentence: what it does and which connectors it needs */
  description: string;
  /** what Claude needs access to besides Jaffloop */
  needs: string[];
  arguments: PromptArgument[];
  text: string;
}

const DEDUP =
  'Give every item an external_id so running this again never creates copies (for example outlook:<message id>, jira:<KEY-123>:<comment id>, confluence:<page id>, teams:<message id>), ' +
  'a source_label (outlook, jira, confluence, teams) and a source_url when you have a link. Send them in one add_items call; the server skips ids it already has and tells you which were duplicates.';

export const PROMPTS: JaffloopPrompt[] = [
  {
    id: 'monday-sweep',
    title: 'Monday sweep: what I promised',
    description: 'Reads your sent mail and calendar since a date and adds the commitments you made as promises.',
    needs: ['Outlook mail', 'Outlook calendar'],
    arguments: [{ name: 'since', description: 'Start of the period', required: false, default: 'last Friday' }],
    text:
      'Read my Outlook sent mail and calendar from {{since}} until now. Find commitments I made to people: things I said I would do, send, decide or follow up on. ' +
      'First call Jaffloop list_people and list_items so you know the people (use their handles) and what is already tracked. ' +
      'Add each new commitment as kind "owe" with the person\'s handle and a due date only when one was stated. ' + DEDUP + ' ' +
      'Then show me a short list: what you added, what you skipped as already tracked, and anything you were unsure about (do not add the unsure ones).',
  },
  {
    id: 'waiting-sweep',
    title: 'Waiting on others',
    description: 'Finds requests you sent that got no reply and tracks them as things you are waiting on.',
    needs: ['Outlook mail'],
    arguments: [{ name: 'days', description: 'How many days back to look', required: false, default: '14' }],
    text:
      'Look at my Outlook sent mail from the last {{days}} days. Find messages where I asked someone for something (an answer, a document, a decision) and there is no reply yet. ' +
      'Call Jaffloop list_people and list_items first and skip anything already tracked. Add each as kind "wait" for that person, with the date I asked in the body and a due date only if I gave one. ' + DEDUP + ' ' +
      'Show me what you added and who has been silent longest.',
  },
  {
    id: 'jira-mentions',
    title: 'Jira mentions and reviews',
    description: 'Turns Jira mentions, review requests and assigned tickets into promises with the ticket key in the title.',
    needs: ['Jira'],
    arguments: [{ name: 'days', description: 'How many days back to look', required: false, default: '3' }],
    text:
      'Find Jira comments that mention me, review requests and tickets assigned to me in the last {{days}} days. For each one that needs something from me, add a Jaffloop item of kind "owe" ' +
      'with the ticket key at the start of the title (for example "PLAT-482 review the rollout plan"), the person who asked as the person (use list_people to match by name or email), and a due date only if the ticket has one. ' +
      DEDUP + ' Skip tickets that are only informational. Show me what you added.',
  },
  {
    id: 'meeting-notes',
    title: 'Meeting notes to items',
    description: 'Extracts promises, things you wait for and things you said from pasted notes or a transcript.',
    needs: [],
    arguments: [
      { name: 'notes', description: 'Paste the meeting notes or transcript', required: true },
      { name: 'person', description: 'Handle of the person if it was a 1:1', required: false, default: 'none (not a 1:1)' },
    ],
    text:
      'Here are my meeting notes:\n\n{{notes}}\n\n' +
      'Extract (1) what I promised to do (kind "owe"), (2) what other people promised me (kind "wait"), (3) things I told someone that I should remember (kind "said", quote my words exactly) and (4) topics to bring up next time (kind "bring"). ' +
      'Use list_people to match names to handles. 1:1 with: {{person}}. If a person is named there, also call log_interaction for them with a short summary as the notes and the action items you extracted as action_items. ' +
      'Show me the list before you save anything, then save with add_items after I say yes. Use external_id "notes:" plus a short slug of the meeting title and date so a repeat does not duplicate.',
  },
  {
    id: 'prep-1on1',
    title: 'Prepare a 1:1',
    description: 'Builds an agenda from what is open between you, plus their recent Jira and Confluence work.',
    needs: ['Jira', 'Confluence'],
    arguments: [{ name: 'person', description: 'Handle or name of the person', required: true }],
    text:
      'Prepare my 1:1 with {{person}}. Call Jaffloop prep_brief for them. Then look at what they worked on in the last month in Jira and Confluence (tickets closed, pages written or edited). ' +
      'Give me: a three-line agenda, what I owe them and what they owe me, anything that has been open for more than a week, two specific questions based on their recent work, and one thing worth praising. Keep it under 200 words.',
  },
  {
    id: 'friday-status',
    title: 'Friday status for my manager',
    description: 'Writes a short factual status update from your week.',
    needs: [],
    arguments: [],
    text:
      'Call Jaffloop week_summary for this week. Write a five-line status update for my manager: what I closed, what slipped and why, what I am waiting on from others, and one risk. ' +
      'Be factual, no filler, name people only where it helps. If a number is missing, say so rather than guessing.',
  },
  {
    id: 'chase-stale-waits',
    title: 'Chase stale waits',
    description: 'Drafts polite nudges for everything you have been waiting on too long. Nothing is sent.',
    needs: [],
    arguments: [],
    text:
      'Call Jaffloop list_items for kind "wait" and keep the ones that are stale (overdue or more than five days old). For each, draft a two-sentence polite nudge to that person that names the thing and asks for a date. ' +
      'Group the drafts by person. Do not send anything and do not change any items.',
  },
  {
    id: 'slipping-triage',
    title: 'Triage what keeps slipping',
    description: 'Goes through items you keep snoozing and recommends do, delegate or drop.',
    needs: [],
    arguments: [],
    text:
      'Call Jaffloop list_items and find open items I have snoozed three or more times. For each, recommend one of: do it now, delegate (to whom), or drop, with one reason. ' +
      'Show me the table first. Apply only the ones I approve: complete_item, update_item or snooze_item as needed, and say what you changed.',
  },
  {
    id: 'who-am-i-neglecting',
    title: 'Who am I neglecting',
    description: 'Compares each person\'s 1:1 cadence with their last 1:1 and says what to raise first.',
    needs: [],
    arguments: [],
    text:
      'Call Jaffloop list_people, then get_person for anyone past their 1:1 cadence. Tell me who is overdue and by how many days, what is open between us (what I owe them, what they owe me, what is on the bring-up list) ' +
      'and what I should raise first with each. Order by how overdue they are. End with the one person I should talk to today.',
  },
  {
    id: 'review-evidence',
    title: 'Evidence for a review',
    description: 'Collects wins and growth areas for one person over several months.',
    needs: [],
    arguments: [
      { name: 'person', description: 'Handle or name of the person', required: true },
      { name: 'months', description: 'How many months back', required: false, default: '6' },
    ],
    text:
      'For {{person}}, call Jaffloop get_person and search their items and said-log from the last {{months}} months. Summarise wins and growth areas as dated bullet points, quoting what was said where it exists. ' +
      'Mark anything you are unsure about, and do not invent anything that is not in the data. This is raw material for a performance review draft.',
  },
  {
    id: 'build-my-team',
    title: 'Set up my team',
    description: 'Finds the people you manage from your calendar and org chart and saves each with position, relation and 1:1 cadence.',
    needs: ['Outlook calendar', 'Outlook people / org chart'],
    arguments: [{ name: 'months', description: 'How far back to look for recurring 1:1s', required: false, default: '3' }],
    text:
      'Help me set up Jaffloop with the people I work with. Look at my Outlook calendar for the last {{months}} months for recurring 1:1 meetings and at my org chart for my direct reports, my manager and close peers. ' +
      'First call Jaffloop list_people so you do not touch people who are already there. For each new person call save_person with their handle (first name, or first.last when two people share a first name), full name, position (title), ' +
      'relation (report, peer, manager or stakeholder), cadence_days from how often the 1:1 recurs (weekly 7, every two weeks 14, monthly 30) and their work email in match_emails. ' +
      'Do not guess a birthday or start date. Show me the list you saved and mark anything you were unsure about.',
  },
];

/** Fills {{name}} placeholders; missing optional arguments use their default, missing required ones stay visible as {{name}}. */
export function renderPrompt(p: JaffloopPrompt, args: Record<string, string | undefined> = {}): string {
  return p.text.replace(/\{\{(\w+)\}\}/g, (whole, name: string) => {
    const a = p.arguments.find((x) => x.name === name);
    const v = args[name]?.trim();
    if (v) return v;
    return a?.default ?? whole;
  });
}
