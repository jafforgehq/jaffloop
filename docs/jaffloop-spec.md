# Jaffloop: v1 Specification

> Name: **Jaffloop** (ties to the jafforge brand and Jaffer; domain and trademark check still to do).
> Target: macOS 14+, native SwiftUI, local-first, with a local MCP server for Claude.
> Visual reference: `jaffloop-mocks.html` (interactive mocks of Capture, Today, Person and Brief screens).

This document is the source of truth for the first build. Start with "Build order" and work top-down. When a decision is not covered here, choose the simplest option that fits the principles, and note it in the "Decisions log" at the end.

---

## 1. Product

Jaffloop is a macOS menu bar app for a busy engineering manager. It tracks **what you owe people, what they owe you, what to bring up with them, and what you told them**, so nothing from a fast-moving week gets lost. It captures in one line, stores everything locally, and exposes the data to Claude through an MCP server.

**Core idea:** organize around **people and commitments**, not note types. A personal work todo is the same item with no person attached, so there are no separate modes.

**User:** Feda, engineering manager leading a team of 10, working in a fast-paced company. The pains: *who did I say what to, what did I promise, what do I need to bring up.*

### Principles

1. Capture in under two seconds, with nothing in the way.
2. People and commitments are the organizing structure.
3. Local-first and private. Notes about people are sensitive.
4. Claude does the thinking (briefs, summaries, patterns) through MCP. The app has no AI inside it and makes no network calls.
5. Motion confirms an action. It never decorates (one exception: the empty state).
6. Restrained visual design. Color is used for state, not decoration.

### In v1

- Global-hotkey capture bar with one-line syntax and live parsing
- Six item kinds: owe, wait, bring, task, said, note
- Today view, Person page, Promise ledger, search (⌘K)
- Pre-meeting brief from the calendar, and a morning brief
- Local notifications with snooze
- MCP server (stdio) over the same SQLite file

### Not in v1 (explicit non-goals)

- Career, review, wellbeing or sentiment tracking
- Sync, iOS app, sharing with other people
- Any AI inside the app (Claude does that through MCP)
- A planning, roadmap, sprint or whiteboard tool (considered and **deliberately postponed**)
- Mac App Store distribution (the MCP server needs unsandboxed file access)

---

## 2. Data model

SQLite in WAL mode, accessed with GRDB. One `items` table holds everything and `kind` decides behavior.

### Item kinds

| Kind | Meaning | Due date | Example |
| --- | --- | --- | --- |
| owe | You promised someone | Usually | Review Sara's RFC by Fri |
| wait | Someone promised you | Usually | Amir sends API spec Mon |
| bring | Talking point for the next conversation | No | Workload, promotion timeline |
| task | Your own work todo | Optional | Prepare Q4 plan |
| said | Log of what you told someone | No | "We'll revisit headcount in Nov" |
| note | Fact worth keeping | No | Sara prefers async updates |

### `items`

| Column | Type | Notes |
| --- | --- | --- |
| id | UUID | Primary key |
| kind | enum | owe, wait, bring, task, said, note |
| title | text | Required |
| body | text | Optional detail |
| quote | text | Exact words, used by `said` |
| person_id | FK | Nullable; null means a personal item |
| status | enum | open, done, dropped |
| due_at | datetime | Nullable |
| due_has_time | bool | False means all-day |
| remind_at | datetime | Nullable; fires a notification |
| snoozed_until | datetime | Hides the item until then |
| snooze_count | int | 3 or more marks the item as slipping |
| recur_rule | text | RRULE string, nullable |
| pinned | bool | Floats to the top of Today |
| inbox | bool | True until a person or date is assigned |
| source | enum | hotkey, mcp, meeting, import |
| created_at, updated_at, completed_at, last_touched_at | datetime | `last_touched_at` drives stale detection |

### `people`

| Column | Type | Notes |
| --- | --- | --- |
| id | UUID | Primary key |
| handle | text | Unique, lowercase, used after `@` |
| name | text | Display name |
| relation | enum | report, peer, manager, stakeholder, other |
| cadence_days | int | Nullable; expected days between 1:1s |
| match_emails | text | Comma-separated; links calendar events to the person |
| hidden_from_claude | bool | Excluded from every MCP tool and resource |
| archived | bool | Hides without deleting |

### Other tables

- **interactions**: id, person_id, occurred_at, kind (1on1 / meeting / chat / other), calendar_event_id, notes. Drives "last 1:1" and cadence alerts.
- **item_tags**: item_id, tag.
- **item_events**: item_id, at, event (created / snoozed / completed / dropped), detail. Slipping and weekly summaries are computed from this, not guessed.
- **items_fts**: FTS5 index over title, body and quote.

### Derived rules (implement in JaffloopCore, unit-tested)

- **Slipping:** `snooze_count >= 3` and status open.
- **Stale wait:** kind = wait, open, and no `last_touched_at` for 3 days past due, or 5 days since creation if no due date (both configurable).
- **Cadence overdue:** days since the person's latest `interactions` row is greater than `cadence_days`.
- **Inbox:** an item with no date and no person stays `inbox = true` until one is assigned or the item is dropped.
- **Recurring:** completing a recurring item creates the next occurrence from `recur_rule`.

---

## 3. Capture syntax and parsing

One line, typed fast, parsed **locally and deterministically** (no network, no AI). The same parser is used by the app and by the MCP `capture` tool. It lives in `JaffloopCore` as a pure Swift module with a table-driven test suite.

**Grammar:** `[prefix] [@person] text [date] [recurrence] [#tag] [!]`

### Prefixes

| Prefix | Short | Kind |
| --- | --- | --- |
| owe | o | owe |
| wait | w | wait |
| bring | b | bring |
| todo | t | task |
| said | s | said |
| note | n | note |

Short prefixes only count when followed by a space.

### Examples (each one must be a unit test)

| You type | Result |
| --- | --- |
| `owe @sara review RFC fri` | owe, Sara, due Friday (all-day) |
| `wait @amir API spec mon 10:00` | wait, Amir, due Monday 10:00 |
| `bring @sara workload, promotion timeline` | bring, Sara, no date |
| `said @sara "we'll revisit headcount in Nov"` | said, Sara, quote stored verbatim |
| `todo prepare Q4 plan thu #planning !` | task, due Thursday, tag planning, pinned |
| `todo 1:1 prep every mon 09:00` | task, recurring weekly |
| `@sara ask about on-call rotation` | no prefix with a person defaults to `bring` |
| `buy usb-c cable` | no prefix and no person defaults to `task` |

### Rules

- **Dates:** `today`, `tomorrow`, weekday names, `next mon`, `15 nov`, `in 2h`, `eod`, `eow`. Date-only means all-day. `eod` is 17:30 by default (configurable). A time with no date means the next occurrence of that time.
- **Reminders:** a due item with a time gets a notification at that time. `remind 1h` or `remind fri 9:00` sets a separate reminder.
- **Recurrence:** `every mon`, `every 2 weeks`, `monthly`, `weekdays`.
- **People:** `@` opens autocomplete. If nothing matches, a "create Sara" chip appears and Enter creates the person.
- **Several people:** the first `@person` is the owner. Later mentions stay in the text and remain searchable.
- **Quotes:** text in double quotes after `said` goes to the `quote` field, and the rest becomes the title.
- **Ambiguity:** the parser never guesses silently. Anything it cannot parse stays in the title and shows as plain text, never as a chip.

### Live preview

As you type, parsed tokens appear as chips under the input (kind, person, date, recurrence, tags, pinned). Enter saves. Tab moves into a chip to edit it, or completes an `@person` suggestion. The interactive mock implements a simplified version of this parser in JavaScript; use it as a behavioral reference, not as code to port.

---

## 4. Screens and flows

| Screen | Purpose | Key behavior |
| --- | --- | --- |
| Capture bar | Save anything in under two seconds | Global hotkey (default ⌥Space). Enter saves, ⌘Enter saves and stays open, Esc closes, ↑ recalls the last entry. Non-activating floating panel, 640 pt wide, centered on the active screen. |
| Menu bar popover | Glance without opening the app | Loop icon with a dot when something is overdue. Compact Today list with inline complete and snooze. |
| Today | The daily working list | Sections: Slipping, Overdue, Today, Waiting on (stale), Check in (people past cadence), Inbox. |
| Person page | Everything about one person | Header with last 1:1, next meeting, cadence ring. Sections: I owe them, They owe me, Bring up, Said log. Scoped quick-add field at the bottom. |
| Promise ledger | What you have promised across everyone | All open `owe` items grouped by person, sorted by due date, with an overdue filter. |
| Pre-meeting brief | Prepared before a conversation | Card 10 minutes before a matched calendar event, with open items and talking points. Items can be completed inline. |
| Morning brief | Start the day with the right picture | Weekday notification at 08:30 (configurable) opening a panel: today's meetings, what you owe, who owes you. |
| Search (⌘K) | Find anything or run any action | Command palette over items, people and actions, backed by FTS5. Filters: `@person`, `kind:`, `before:`. |
| Settings | Configuration | Hotkey, calendars, working hours, brief times, eod time, stale thresholds, MCP privacy and audit log, density, sound, export. |

**Main window:** a sidebar (Today, Ledger, Inbox, People, tags) with a content pane. The menu bar app and the main window share one process.

### Core flows

1. **Capture a promise:** hotkey, type `owe @sara review RFC fri`, Enter. It appears on Sara's page and in the ledger, due Friday.
2. **Prepare for a 1:1:** the pre-meeting card appears; scan open items and talking points; complete or snooze inline.
3. **Capture during a meeting:** hotkey, `said @amir "ship date is firm for Nov 20"`, Enter. The quote is stored with a timestamp.
4. **Close the day:** the Inbox shows unassigned captures. Assign a person or date with one keystroke each, or drop the item.
5. **Ask Claude:** "What did I promise Sara this month?" is answered by the MCP server without opening the app.

**Keyboard first:** every action has a shortcut, shown in tooltips. The mouse is optional.

---

## 5. Design direction

Visual reference: `jaffloop-mocks.html`. The look is **calm, dense and fast**: a dark-first native Mac app with one signature idea, the **loop**. Every open item carries a small ring, and finishing something closes the ring. The name, icon, checkbox and empty state all come from that motif.

### Design rules (these came out of review; do not drift from them)

- **Restrained color.** Neutral warm graphite and paper. The only strong color is one clay red, used for overdue, slipping and cadence-overdue. Everything else is neutral.
- **No purple, no gradients, no glows, no neon, no sparkle emoji, no gradient avatars.** These read as generic AI design.
- **Item kinds** are marked by a small muted dot plus a monospace label, never by bright tinted pills.
- **Rings are neutral** until overdue. Hover previews a partial fill. Completion draws the ring closed.
- **Avatars** are flat initials in a neutral circle.
- **Primary buttons and the active tab are inverted** (light on dark, dark on light), not colored.
- **Page titles** use the system serif (New York) for a Mac-native editorial feel.

### Palette

| Role | Dark | Light |
| --- | --- | --- |
| Background | #121211 | #F5F3EF |
| Surface | #191918 | #FBFAF8 |
| Elevated | #232322 | #FFFFFF |
| Text | #EDEBE6 | #1C1B19 |
| Secondary text | #8F8C85 | #6B6860 |
| Hairline | white at 7.5% | black at 9% |
| Overdue / accent (clay) | #E5654A | #C94A2E |
| Owe (dot) | #C9A46A | #A9803F |
| Wait (dot) | #7E9DB5 | #4F7391 |
| Bring (dot) | #A294B8 | #7C6B96 |
| Task (dot) | #8A877F | #77746C |
| Said (dot) | #8DAE98 | #5E8A6F |

### Type and layout

- SF Pro Text 13/18 for rows. Page titles in New York semibold 30. SF Mono for syntax tokens, kind labels and shortcuts. Tabular numerals for dates.
- 8-pt grid. 10-pt corner radius on cards, 16 on panels. 0.5-pt hairline borders.
- Native materials: HUD vibrancy behind the capture bar, sidebar material on the main window, soft layered shadows on floating panels.
- Density setting: Comfortable (default) and Compact.

### Signature surfaces

- **Capture bar:** syntax-highlighted input (kind token in its muted hue, `@person` underlined, dates and tags in muted hues) with neutral chips below.
- **Person page:** initials inside a **cadence ring** that fills as days since the last 1:1 approach the target and turns clay red when overdue.
- **Today:** thin uppercase section headers, quiet rows, a small kind-mix bar and counts at the top.
- **Menu bar icon:** a loop glyph, with a red dot when something is overdue.

### Motion

| Moment | Animation | Duration |
| --- | --- | --- |
| Open capture bar | Scale 0.96 to 1 with fade, spring | 140 ms |
| Token recognized | Chip pops in (scale 0.9 to 1) | 120 to 220 ms |
| Save | Text collapses and a dot flies to the menu bar icon, which blips once | 300 to 550 ms |
| Complete an item | Ring stroke draws closed, a check appears, the row collapses | 350 ms |
| First load of a list | Rows stagger in, 20 to 28 ms apart | about 400 ms |
| Reorder or filter | Rows glide to new positions (matched geometry) | 220 ms |
| Snooze | Row slides right and fades, leaving a ghost label like "back Fri" | 250 ms |
| Overdue ring | Slow opacity breathing, only while the window is visible | 2.6 s loop |
| Cadence ring | Fills smoothly when a person page opens | 500 to 900 ms |
| Pre-meeting card | Slides up from the bottom right with a soft spring | 280 to 550 ms |
| Empty state | "All loops closed": ring completes with a brief burst of muted dots, at most once per day | 900 ms |

**Sound and haptics:** trackpad haptic on completing an item (on by default). Soft click on save and a rising tone on completion (off by default, one toggle).

**Motion rules:** respect Reduce Motion by replacing movement with fades. Keep animations under 350 ms except the empty state and cadence ring. Skip animations on key-repeat and bulk actions. Hold 60 fps.

**Build notes:** SwiftUI with `matchedGeometryEffect` and `PhaseAnimator`; the empty-state burst via `Canvas` in a `TimelineView`; the capture bar as a non-activating `NSPanel`; the menu bar through `MenuBarExtra`; completion haptics through `NSHapticFeedbackManager`.

---

## 6. Notifications and reminders

All notifications are local (`UNUserNotificationCenter`), grouped by thread, and every one has actions so the app rarely needs opening.

| Trigger | When | Content | Actions |
| --- | --- | --- | --- |
| Reminder | At `remind_at`, or at the due time if set | Item title and person | Done, Snooze, Open |
| Due today, still open | 16:30 on days with open owe items due | "2 promises due today" | Open ledger, Snooze all |
| Waiting on, stale | See "Stale wait" rule | "Amir hasn't sent the API spec" | Mark received, Nudge, Snooze |
| Pre-meeting | 10 minutes before a matched event | Counts plus top 3 open items for that person | Open brief, Dismiss |
| Morning brief | 08:30 on weekdays | Meetings today, promises due, waits overdue | Open brief |
| Cadence | Once a day, shown in Today only, never pushed | "Sara: 23 days since your last 1:1" | Schedule, Dismiss |

### Rules

- **Matching meetings to people:** by attendee email in `match_emails`, falling back to the person's name in the event title. Pre-meeting briefs fire only for events with three attendees or fewer (configurable).
- **Slipping:** an item snoozed three times gets a clay-red badge and is pinned to the top of Today. Snoozing is never hidden from you.
- **Notification budget:** at most one notification every 10 minutes. Items due in the same window are batched.
- **Quiet time:** no notifications outside working hours or on weekends, except reminders you set explicitly.
- **Snooze presets:** 1 hour, this afternoon, tomorrow 09:00, next Monday, custom.
- **Permissions:** calendar access is read-only (EventKit) and optional. Without it, everything works except the pre-meeting brief and the meetings list in the morning brief.

---

## 7. MCP server

A small stdio server, `jaffloop-mcp`, bundled with the app, reading the same SQLite file. It works in Claude Desktop and Claude Code. Claude does the thinking; the server only returns structured data and applies simple writes. The server never makes network calls.

### Tools

| Tool | Purpose | Main arguments |
| --- | --- | --- |
| capture | Add an item from one line, using the same parser as the app | text |
| add_item | Add an item with explicit fields | kind, title, person, due, remind_at, tags, quote |
| list_items | Query items | kind, person, status, due_before, overdue, stale_days, limit |
| get_person | One person's profile, open items, said log and recent interactions | handle |
| list_people | All people with cadence status | include_archived |
| complete_item | Mark done (creates the next one if recurring) | id |
| snooze_item | Hide until a time | id, until |
| update_item | Change fields | id, fields |
| log_interaction | Record a 1:1 or meeting | person, kind, notes, occurred_at |
| search | Full-text search | query, filters |
| prep_brief | Structured data for a conversation: open items both ways, talking points, recent said entries, cadence | person |
| week_summary | Created, completed, slipped and stale items for a range | from, to |

**Resources:** `jaffloop://today`, `jaffloop://ledger`, `jaffloop://person/{handle}`.

**Example prompts it must handle:** "Prep me for my 1:1 with Amir." "What did I promise Sara this month?" "What am I waiting on that's gone stale?" "Add a todo to call the vendor Friday." "Summarize my week."

### Privacy and safety

- **Per-person opt-out:** people with `hidden_from_claude` are excluded from every tool and resource. Their items never appear in results.
- **Read-only mode:** one setting turns off all write tools.
- **No delete tool in v1.** Items can be dropped (status change), never erased through MCP.
- **Audit log:** the app shows recent MCP calls (tool, time, what changed).
- **Source tagging:** writes from MCP set `source = mcp`.

### Sync between app and server

The app watches the database with a cheap `PRAGMA data_version` check about once a second and refreshes when the MCP server writes.

---

## 8. Architecture

Three Swift targets sharing one core package.

| Target | Role |
| --- | --- |
| JaffloopCore | Models, SQLite access (GRDB, WAL, FTS5), the parser, business rules (stale, slipping, cadence). No UI. |
| Jaffloop (app) | SwiftUI plus AppKit: `NSPanel` capture bar, `MenuBarExtra`, main window, notifications, EventKit calendar, global hotkey. |
| jaffloop-mcp | Command-line stdio server that imports JaffloopCore, so the app and Claude share identical logic. |

**Storage:** `~/Library/Application Support/Jaffloop/jaffloop.sqlite`. Distributed outside the Mac App Store so the MCP server can read the file without sandbox limits. Encryption at rest (SQLCipher with the key in Keychain) is a v1.1 candidate; FileVault covers the baseline.

**Dependencies (suggested):** GRDB.swift, a global-hotkey package (such as KeyboardShortcuts), Sparkle for updates (later), an MCP Swift SDK or a minimal hand-written stdio JSON-RPC implementation.

**Testing:** the parser and the derived rules are pure functions in JaffloopCore with table-driven tests. Write the parser tests first from the examples table in section 3.

---

## 9. Build order

Rough solo estimates, working with Claude Code. Steps 1 to 5 are a usable app; everything after that is polish and leverage.

1. **Core package** (2 days): schema, migrations, parser with its test table.
   *Done when:* every example in section 3 passes as a test, and the derived rules (stale, slipping, cadence) have tests.
2. **Capture bar** (2 days): hotkey, non-activating panel, live chips, save.
   *Done when:* ⌥Space opens the bar from any app, typing shows chips, Enter saves an item to SQLite.
3. **Today view** (3 days): complete, snooze, slipping, local notifications.
   *Done when:* the ring-closing animation works, snoozing three times flags an item as slipping, a reminder fires a notification with actions.
4. **People** (2 days): `@` autocomplete, Person page, cadence ring.
   *Done when:* creating a person from the bar works and the Person page shows the four sections.
5. **MCP server** (2 days): `capture`, `list_items`, `get_person`, `complete_item` first.
   *Done when:* Claude Desktop or Claude Code can add and list items, and the app refreshes when the server writes.
6. **Calendar** (2 days): pre-meeting brief and morning brief.
7. **Ledger and search** (2 days): promise ledger, ⌘K palette.
8. **Design pass** (3 days): ring animation, motion moments, empty state, icon.
9. **Use it yourself for two weeks**, then decide on distribution.

---

## 10. After v1: feature ideas (not in v1)

Ordered by how directly they attack "what did I promise, what am I waiting on".

1. **Transcript triage:** paste meeting notes or a transcript and Claude proposes owe, wait and said items into a review queue. Nothing is added until approved; runs only when you paste something.
2. **Event-based snooze:** until "Sara's next 1:1", "Amir replies" or "after the Q4 review".
3. **Nudge drafts:** on a stale waiting-on item, one click copies a polite follow-up to the clipboard.
4. **At-risk flag:** mark an owe as at risk; it shows in the morning brief with a "renegotiate" action that drafts a heads-up.
5. **Capture from Slack and Teams:** share action that saves a message and keeps the link back.
6. **Source breadcrumbs:** each capture remembers its app, window title or URL, with one-click jump back.
7. **Meeting-attached capture:** during a calendar event, captures auto-link to the attendees and meeting.
8. **Topic threads:** tag said entries and decisions with a topic to see how what you told people evolved, plus a consistency check for conflicting dates.
9. **Delegation follow-ups:** pick a rhythm when delegating and the waiting-on items are created.
10. **Surfaces everywhere:** desktop widget, Shortcuts actions, Raycast command.

Other earlier ideas, parked: 1:1 templates, decision log, wins log, weekly review and team digest through Claude, recurring items beyond basics, Markdown import and export, optional iCloud sync, concerns flag and career notes (a different product; revisit only if missed).

---

## 11. Business and distribution (context, not v1 work)

- **Distribution:** direct download, notarized (Developer ID), sold through a merchant of record (Lemon Squeezy or Paddle), updates via Sparkle. Not the Mac App Store.
- **Licensing:** Lemon Squeezy's built-in license API is the simplest start. Keygen only if machine limits, proper trials or offline license files are needed. Use a 7 to 14 day offline grace period and store the key in Keychain.
- **Price:** not $2 to 3. A niche tool for engineering managers and Claude users fits $9 to 15 one-time, with a trial.
- **Open source:** open the MCP server and data format, keep the app itself paid. Host under the `jafforgehq` GitHub org.
- **Bosnia:** confirm payout support and whether a registered business entity (obrt) is needed before choosing a provider.
- **Plan:** build it for yourself first, use it for a month as an EM, then decide.

---

## 12. Open questions

- Does a line with `@person` and no prefix default to `bring` (as specced), or land in the Inbox for triage?
- Encrypt the database in v1 (SQLCipher) or rely on FileVault at first?
- Domain and trademark check for Jaffloop (Openloop was dropped because it is taken).
- Main window plus menu bar (as specced) or menu bar only?

## 13. Decisions log

Add entries here as you make choices during the build (date, decision, reason).

- 2026-10-14: Name changed from Openloop (taken) to Jaffloop, to tie into the jafforge brand.
- 2026-10-14: Planning, roadmap and whiteboard tooling postponed; out of scope for v1.
- 2026-10-14: Visual direction changed to a restrained warm-neutral palette after the first mock looked generic. See section 5 rules.
- 2026-10-14: v0.0.1 built. `@person` with no prefix defaults to `bring` (as specced); open question 1 closed.
- 2026-10-14: Database not encrypted in v1 (FileVault baseline). Main window plus menu bar kept, as specced.
- 2026-10-14: Global hotkey uses Carbon `RegisterEventHotKey` (no dependency); hotkey is chosen from presets in Settings, not recorded freely.
- 2026-10-14: Menu bar uses `NSStatusItem` plus `NSPopover` instead of `MenuBarExtra`, to control the icon (red dot) and the save blip.
- 2026-10-14: The "dot flies to the menu bar icon" save animation is simplified to a collapse of the bar plus a blip of the icon.
- 2026-10-14: MCP server is a hand-written stdio JSON-RPC implementation (no SDK dependency). App and server share the SQLite file; settings (read-only mode) live in the DB.
- 2026-10-14: Release builds are arm64 only, signed with Developer ID and hardened runtime.
- 2026-10-14: v0.0.2 notarized. UI-only pass: fixed column grid, collapsed empty sections, larger small type, light-mode contrast, focus ring and VoiceOver labels, capture key hints, hotkey recorder, flying-dot save animation.
- 2026-10-15: Calendar integration removed (EventKit, pre-meeting card and notification, calendar settings, "next meeting" on person pages, meetings in the morning brief, calendar entitlement and usage strings). Reason: meetings are already covered by Outlook reminders. The person brief stays and opens from the person page menu. The `calendar_event_id` column stays in the schema (unused, nullable) to avoid a migration.
- 2026-10-15: v0.0.3 UI pass (keyboard selection, undo, drawer, bulk actions, grouping and focus on Today, appearance and accent, densities). Added an update check that only runs when the user asks (or opts in daily) and an in-app What's new and roadmap. The "no network calls" rule now reads "none except the update check". The app still never downloads or installs anything itself.
