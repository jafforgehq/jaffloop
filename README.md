# Jaffloop

A macOS menu bar app for engineering managers. It tracks **what you owe people, what they owe you, what to bring up with them, and what you told them**, so nothing from a fast-moving week gets lost.

Capture in one line. Everything stays on your Mac. Claude can read and write your data through a local MCP server, and the app itself has no AI. Its only network use is checking GitHub for new versions.

![Today](docs/screenshots/today-dark.png)

## Features

- **One-line capture** with a global hotkey (default `⌥Space`, or record your own in Settings). Parsed locally and live, shown as chips.
- **Six item kinds**: `owe`, `wait`, `bring`, `task`, `said`, `note`.
- **Today** with sections for Slipping, Overdue, Today, Waiting on (stale), Check in (people past their 1:1 cadence) and Inbox.
- **Person pages** with a cadence ring, last 1:1, and four sections: I owe them, They owe me, Bring up, Said log.
- **Promise ledger**, **Inbox triage by keyboard**, **⌘K search** (FTS5, with `@person`, `kind:`, `before:` filters).
- **Person brief** (prep before you talk) and a **morning brief** on weekdays. No calendar access: your calendar app already reminds you of meetings.
- **Keyboard-first lists**, **undo** (⌘Z toast), an editable details drawer, inline title and date editing, multi-select with bulk actions, and drag-to-assign.
- **Done** and **Snoozed** views, saved search filters, back and forward, and a hideable sidebar.
- **1:1 mode** for the meeting itself, private notes per person, and people as a list or grid.
- **Weekly review** with your kept-promise rate and a one-click Markdown status update, a rhythm grid of 1:1s, workload bars, anniversaries and birthdays, capture templates, Jira links, and a Dock badge.
- **Local notifications** with Done / Snooze actions, quiet hours, and batching.
- **What's new and roadmap** inside the app, shown once after you update. See also [`docs/CHANGELOG.md`](docs/CHANGELOG.md) and [`docs/ROADMAP.md`](docs/ROADMAP.md).
- **MCP server** (`jaffloop-mcp`) with 14 tools, 11 prompts and 3 resources, a read-only mode, per-person hiding, and an audit log.

| Capture | Inbox |
| --- | --- |
| ![Capture bar](docs/screenshots/capture.png) | ![Inbox](docs/screenshots/inbox.png) |

| Person page | Promise ledger |
| --- | --- |
| ![Person](docs/screenshots/person.png) | ![Ledger](docs/screenshots/ledger.png) |

| Menu bar popover | Morning brief |
| --- | --- |
| ![Popover](docs/screenshots/menubar-popover.png) | ![Morning brief](docs/screenshots/morning-brief.png) |

| Light mode | Claude (MCP) settings |
| --- | --- |
| ![Light](docs/screenshots/today-light.png) | ![MCP settings](docs/screenshots/settings-mcp.png) |

| Details drawer | What's new and roadmap |
| --- | --- |
| ![Drawer](docs/screenshots/drawer.png) | ![What's new](docs/screenshots/whats-new.png) |

| Appearance, accent, density |
| --- |
| ![General settings](docs/screenshots/settings-general.png) |

| 1:1 mode | People as a grid |
| --- | --- |
| ![1:1 mode](docs/screenshots/one-on-one.png) | ![People grid](docs/screenshots/people-grid.png) |

| Done | Snoozed |
| --- | --- |
| ![Done](docs/screenshots/done.png) | ![Snoozed](docs/screenshots/snoozed.png) |

| Weekly review | Capture with context |
| --- | --- |
| ![Weekly review](docs/screenshots/review.png) | ![Capture context](docs/screenshots/capture-context.png) |

| 1:1 history with notes and action items | Claude prompts (Copy) |
| --- | --- |
| ![1:1 history](docs/screenshots/person-history.png) | ![Claude prompts](docs/screenshots/settings-prompts.png) |

| Add your team (onboarding) | Review what Claude adds |
| --- | --- |
| ![Add your team](docs/screenshots/wizard-two-added.png) | ![Inbox proposals](docs/screenshots/inbox-proposals.png) |

| Jump to a person (⌘P) | Seven themes |
| --- | --- |
| ![People palette](docs/screenshots/people-palette.png) | ![Midnight](docs/screenshots/theme-midnight-today.png) |

| Keyboard shortcuts (press ?) | First run |
| --- | --- |
| ![Shortcuts](docs/screenshots/shortcuts.png) | ![Welcome](docs/screenshots/welcome.png) |

## Keyboard

In any list (Today, Ledger, person pages, tags):

| Key | Does |
| --- | --- |
| `j` `k` or `↓` `↑` | Move the selection |
| `⏎` | Complete (all marked items if you used `x`) |
| `s` | Snooze to tomorrow 09:00 |
| `e` | Edit the title (or double-click it) |
| `space` | Open or close the details drawer |
| `x` | Mark for bulk actions (or shift-click) |
| `p` | Pin or unpin |
| `⌫` | Drop |
| `esc` | Clear marks, close the drawer, clear the selection |
| `⌘Z` | Undo, while the toast is showing |
| `⌘K` | Search (and save a search as a sidebar filter) |
| `?` | Show every shortcut |
| `⌘P` | Jump to a person |
| `⌘[` `⌘]` | Back and forward |
| `⌘\` | Hide or show the sidebar |

## Capture syntax

`[prefix] [@person] text [date] [recurrence] [#tag] [!]`

| You type | Result |
| --- | --- |
| `owe @sara review RFC fri` | owe, Sara, due Friday (all-day) |
| `wait @amir API spec mon 10:00` | wait, Amir, due Monday 10:00 |
| `bring @sara workload, promotion timeline` | bring, Sara, no date |
| `said @sara "we'll revisit headcount in Nov"` | said, Sara, quote stored verbatim |
| `todo prepare Q4 plan thu #planning !` | task, due Thursday, tag, pinned |
| `todo 1:1 prep every mon 09:00` | recurring weekly task |
| `@sara ask about on-call rotation` | no prefix with a person defaults to `bring` |
| `buy usb-c cable` | no prefix and no person defaults to `task` (goes to the Inbox) |

Dates: `today`, `tomorrow`, weekdays, `next mon`, `15 nov`, `in 2h`, `eod`, `eow`, `10:00`, `3pm`. Reminders: `remind 1h`, `remind fri 9:00`. Recurrence: `every mon`, `every 2 weeks`, `monthly`, `weekdays`. Anything the parser cannot read stays in the title.

## Install

Requires macOS 12 or later on an Apple Silicon Mac (M1 and later). There is no Intel build yet.

1. Download `Jaffloop-<version>-arm64.dmg` from [Releases](../../releases).
2. Open it and drag Jaffloop to Applications. Releases are signed with a Developer ID and notarized by Apple, so it opens without warnings.
3. Press `⌥Space` anywhere to capture.

Verify a download with `SHA256SUMS.txt` from the same release (`shasum -a 256 -c SHA256SUMS.txt`).

Coming from the 0.0.x Swift app? Replace it with this one. Your database, notes and settings are used as they are, the interface
preferences are imported once, and the MCP command is unchanged.

## Updating

Jaffloop updates itself. About 15 seconds after launch and every 6 hours it checks GitHub for a newer release (only signed
releases can update in place), downloads it in the background and tells you: **Update ready, restart** in the sidebar and a dialog
asking *Update and restart* or *Later*. Nothing is installed without your yes, and a downloaded update also installs when you quit.
Turn the background check off in Settings → About; **Check for updates** still works by hand. The first launch of a new
version opens **What's new**. The only network use is this check against GitHub releases; your data never leaves the Mac.

## Use it with Claude

The app bundles `jaffloop-mcp`, a stdio MCP server over the same SQLite file (`~/Library/Application Support/Jaffloop/jaffloop.sqlite`). Settings, then Claude (MCP), shows a ready-made command. For Claude Code:

```sh
claude mcp add jaffloop -- /Applications/Jaffloop.app/Contents/MacOS/jaffloop-mcp
```

For Claude Desktop, add the same binary as a stdio server in its MCP config. Then ask things like "Prep me for my 1:1 with Amir" or "What did I promise Sara this month?".

Tools: `capture`, `add_item`, `add_items`, `list_items`, `get_person`, `list_people`, `complete_item`, `snooze_item`, `update_item`, `log_interaction`, `search`, `prep_brief`, `week_summary`. Resources: `jaffloop://today`, `jaffloop://ledger`, `jaffloop://person/{handle}`.

Adding people: the first-run welcome, the People page and Settings all open "Add your team" (name, position, relation, 1:1 cadence, birthday, start date, work email). Claude can do the same with the `save_person` tool, and the "Set up my team" prompt builds the list from your calendar and org chart. Turn on Settings, then Claude (MCP), then "Review what Claude adds first" and everything Claude adds waits in the Inbox for Accept or Dismiss.

Ready-made prompts: the server also offers eleven prompts (a Monday sweep of what you promised, Jira mentions, meeting notes to items, a 1:1 prep, a Friday status and more). In Claude Code they appear as slash commands named `/mcp__jaffloop__<id>`, in Claude Desktop under the + menu. Settings, then Claude (MCP), lists them with a Copy button for any other chat.

Imports never duplicate: `add_item`, `add_items` (up to 100 items in one call) and `capture` take an optional `external_id` (for example `outlook:<message id>` or `jira:PLAT-482:<comment id>`), plus `source_label` and `source_url`. An item whose `external_id` already exists, open, done or dropped, is skipped and reported as a duplicate, so running a sweep twice creates no copies. The item drawer shows the source as a chip that opens the link. `log_interaction` also takes `action_items`, which are created and linked to that 1:1.

Privacy: people marked hidden are excluded from every tool and resource. Read-only mode blocks every write tool. There is no delete tool. Writes are tagged `source = mcp` and listed in the audit log. The app refreshes within a second when the server writes.

## Build from source

Node 22 or later.

```sh
npm install
npm run dev            # build and run (uses your real database; set JAFFLOOP_DB=/tmp/test.sqlite to experiment)
npm test               # unit tests (parser, rules, store, MCP server, UI logic, main process)
npm run test:e2e       # drives the built app with Playwright against a throw-away database
npm run typecheck
scripts/release-mac.sh # signed, notarized dmg and zip (Apple Silicon) in ./release
```

Layout: `src/core` (parser, rules, SQLite store on `node:sqlite`, pure logic shared with the interface), `src/mcp` (the stdio
MCP server), `src/main` (windows, tray, hotkey, notifications, updates), `src/renderer` (Preact interface, one bundle for every
window), `src/shared` (types and the interface to the main process). The design notes are in
[`docs/ELECTRON.md`](docs/ELECTRON.md) and the original spec in [`docs/jaffloop-spec.md`](docs/jaffloop-spec.md).
Environment variables for tests and screenshots: `JAFFLOOP_DB`, `JAFFLOOP_USERDATA`, `JAFFLOOP_SEED=1`, `JAFFLOOP_NO_UPDATER=1`,
`JAFFLOOP_SMOKE=1`. Regenerate the README screenshots with `npm run screenshots`.

## Signing and releasing

Builds are signed with a **Developer ID Application** certificate (hardened runtime) and notarized by Apple.
`scripts/release-mac.sh` does everything from your own Mac with the certificate in your keychain and a notarytool profile:

```sh
xcrun notarytool store-credentials jaffloop --apple-id you@example.com --team-id TEAMID   # once; app-specific password
scripts/release-mac.sh              # build, sign, notarize, verify, self-test, write the update manifest
scripts/release-mac.sh --publish    # ...and upload to the GitHub release for the version in package.json
```

It checks `codesign`, `spctl` and `stapler`, launches the signed app once and calls the MCP wrapper, and validates
`latest-mac.yml` (the manifest installed apps read) before anything is uploaded; the manifest goes up last. Release checklist:
update `docs/CHANGELOG.md` and `src/renderer/releases-data.ts`, bump `version` in `package.json`, run the script.

## Not in this version

No sync, iOS app, sharing, AI inside the app, planning tools, or Mac App Store build. See the spec and
[`docs/ROADMAP.md`](docs/ROADMAP.md).
