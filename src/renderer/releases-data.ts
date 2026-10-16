// In-app release notes and roadmap (ported from Releases.swift). Keep in sync with docs/CHANGELOG.md and docs/ROADMAP.md.

export interface ReleaseNote { version: string; date: string; title: string; highlights: string[] }
export interface RoadmapGroup { title: string; blurb: string; items: string[] }

export const releaseNotes: ReleaseNote[] = [
  {
    version: '0.3.0', date: '2026-10-16', title: 'Imports without duplicates, Claude prompts and 1:1 notes', highlights: [
      'No more duplicates when Claude imports: every item can carry an id from its source (Outlook, Jira, Confluence, Teams). A repeated sweep skips what is already there, and a new bulk tool adds many items at once.',
      'Ten ready-made prompts for Claude (Monday sweep, waiting-on sweep, Jira mentions, meeting notes to items, 1:1 prep, Friday status, chase stale waits, slipping triage, who am I neglecting, review evidence). They show up as slash commands in Claude and are listed with Copy buttons in Settings → Claude (MCP).',
      '1:1 mode keeps meeting notes and the action items you capture. When you end the 1:1 it is logged, and each person page has a 1:1 history with the notes and the items from every meeting.',
      'Clearer colours: dim text, labels and meta are brighter on every screen.',
      'Seven themes you can switch in Settings → General: Classic (follows macOS), Graphite, Midnight, Forest, Daylight, Paper and High contrast.',
    ],
  },
  {
    version: '0.2.0', date: '2026-10-15', title: 'Review, rhythm and small time-savers', highlights: [
      'Weekly review: one page with overdue promises, slipped items, stale waits, people past their 1:1 cadence and what you closed, with your kept-promise rate. Copy the week as Markdown for your status update.',
      'Done gets a kept-promise stat and a "Today in review" timeline of what you did.',
      'End-of-day wrap-up card at your end of day: what you closed, what is still overdue.',
      'People: a 12-week rhythm grid of 1:1s, a workload bar per person, and a 1:1 streak on each person page.',
      'Work anniversaries and birthdays (optional dates per person) show as reminders under Check in.',
      'Capture bar shows context while you type @name: notes, open promises and the last 1:1. Capture templates (prep @sara) create a set of items at once.',
      'Snooze until your next 1:1 with that person. Jump to a person with ⌘P. Click a person on any row to filter Today to them.',
      'Copy a nudge message for a stale wait. Jira keys (PLAT-482) and web addresses in titles are clickable links.',
      'Dock badge with your overdue count, pause notifications from the menu bar, and an option to show your next item in the menu bar.',
      'A small ring burst when you clear Overdue and Inbox.',
    ],
  },
  {
    version: '0.1.0', date: '2026-10-15', title: 'Now built on Electron', highlights: [
      'Same app, same data, same shortcuts, rebuilt on Electron.',
      'Updates install themselves: Jaffloop checks GitHub in the background, downloads the update and asks before restarting. Turn it off in Settings → About.',
      'For Apple Silicon Macs (M1 and later). An Intel build is on the roadmap.',
      'Your database, notes and settings carry over untouched. Interface preferences from 0.0.x are imported once.',
      'The MCP command is unchanged: Contents/MacOS/jaffloop-mcp.',
    ],
  },
  {
    version: '0.0.4', date: '2026-10-15', title: 'Find it, fix it, keep it', highlights: [
      'Done view: everything you finished or dropped, with a Reopen button. Snoozed view: what is hidden and when it returns, with Wake now.',
      'The details drawer now edits everything: title, kind, person, due date, details and tags. Click any date in a list to change it.',
      'Inbox uses the same keys as every list (j k ⏎ s e space) plus p d t w x for triage. Press ? for a cheat sheet of every shortcut.',
      'Search shows who and what, highlights your words and jumps straight to the item. Save any search as a filter in the sidebar.',
      'Back and forward (⌘[ ⌘]) and a hideable sidebar (⌘\\\\).',
      '1:1 mode: a calm page for the meeting with your bring-up list, what is owed both ways, and a place to record what you said.',
      'Private notes on each person, shown on their page and in the brief. Copy a brief as text. People can be shown as a grid and sorted.',
      'Repeat icon on recurring items, age badges that turn amber then red, and an underline when a wait is stale. Drag pinned items to reorder them.',
      'Respects Reduce Transparency and Increase Contrast. Separate save, complete and undo sounds with a preview.',
      'First run: a short welcome that you can skip, with a button to add an example item.',
    ],
  },
  {
    version: '0.0.3', date: '2026-10-15', title: 'Faster to drive, calmer to read', highlights: [
      'Keyboard: j/k or arrows move, ⏎ completes, s snoozes to tomorrow, e edits the title, space opens details, x marks for bulk actions, p pins, ⌫ drops.',
      'Undo toast (⌘Z) after complete, drop, snooze, assign and rename.',
      'Details drawer, inline title editing, multi-select with a bulk bar, drag an item onto a person to reassign it.',
      'Today: collapsible sections, group by section, person or kind, and a Focus mode with your top 3.',
      'Age badge on owes and waits ("12d"), exact dates in tooltips, times follow your 12 or 24-hour setting.',
      'Person page: 12-week 1:1 strip, ring refill and pulse when you log a 1:1, Prep brief in the … menu.',
      'Sidebar: pinned people, people past their cadence first, collapsible tags, remembers where you were.',
      'Capture bar: live preview of the finished row, recent people first after @.',
      'Menu bar: overdue count next to the icon and a quick-add field in the popover.',
      'Settings: appearance (system, light, dark), accent colour, three row densities with a live preview.',
      "Check for updates (only when you press it, or if you turn on the daily check) and this What's new page.",
      'Removed calendar access, the pre-meeting card and the calendar permission prompt. Outlook already reminds you of meetings.',
    ],
  },
  {
    version: '0.0.2', date: '2026-10-14', title: 'UI polish, notarized', highlights: [
      'Rows line up in fixed kind, person and date columns.',
      'Larger small type and light-mode contrast fixes.',
      'Capture bar key hints, visible focus ring, VoiceOver labels.',
      'Record any capture hotkey in Settings.',
      'Save animation: a dot flies from the capture card to the menu bar icon.',
      'Notarized by Apple, so it opens on first launch.',
    ],
  },
  {
    version: '0.0.1', date: '2026-10-14', title: 'First release', highlights: [
      'One-line capture with a global hotkey, six item kinds, Today, Ledger, Inbox, People.',
      'Local MCP server so Claude can read and write your data.',
      'Morning brief, notifications with Done and Snooze, menu bar popover.',
    ],
  },
];

export const roadmap: RoadmapGroup[] = [
  {
    title: 'Next', blurb: 'What I intend to build first, in rough order.', items: [
      "Monday and Friday reviews: Jaffloop supplies the facts over MCP, Claude writes the review, optional Jira, Confluence and Outlook context stays on Claude's side.",
      'Alias map per person (email, Jira handle) so reviews match people correctly.',
      'Capture nudges after meetings and at end of day: "what did you promise?" with one-tap people chips. No calendar access.',
      'Said-log check before a 1:1: what you told someone versus what you did.',
    ],
  },
  {
    title: 'Later', blurb: 'Wanted, not scheduled.', items: [
      'Growth and feedback thread per person for review and promotion evidence.',
      'Optional database encryption.',
      'Import and export as Markdown and CSV.',
      'Shortcuts actions and a jaffloop:// URL scheme.',
    ],
  },
  {
    title: 'Open decisions', blurb: 'Need an answer before work starts.', items: [
      'License: which parts are open (MCP server, data format) and which stay paid.',
      'Whether updates should ever install without asking. Today they download in the background and ask before restarting.',
    ],
  },
];
