# 0.2.0: twenty small features, contract and ownership

Shared types are in `src/shared/types.ts` (Person.startDate/birthday, Settings.jiraBaseUrl/captureTemplates, KeptRate, ReviewData,
ActivityEntry, HeatRow, UpcomingDate, LinkSegment, CaptureTemplate) and the renderer-to-main API in `src/shared/api.ts`
(captureMany, review, keptRate, activity, heatGrid, onTimeStreak, upcomingDates, pauseNotifications; UiState trayText, pauseUntil,
wrapupDay, burstDay, showDates). Those two files are the contract: read them first. Everything stays local: no AI, no network, no calendar.

## The twenty

1 weekly review screen (`pages/review.tsx`, nav `review`) · 2 copy the week as Markdown (Done page) · 3 kept-promise rate stat ·
4 "Today in review" activity log · 5 end-of-day wrap-up card · 6 meeting heat grid (People) · 7 1:1 on-time streak (person page) ·
8 team load bars (People) · 9 work anniversaries and birthdays (person editor + chips under Check in) · 10 ambient context in the
capture bar · 11 snooze until the next 1:1 with a person · 12 ⌘P jump to a person · 13 click a person to filter Today ·
14 capture templates · 15 copy a nudge for a stale wait · 16 Jira keys and URLs as links · 17 Dock badge · 18 pause notifications
(tray) · 19 menu bar can show the next item · 20 ring burst when Overdue and Inbox reach zero.

## Pure logic (src/core, exported from src/core/pure.ts, re-exported by src/renderer/core.ts)

```ts
linkify(text: string, jiraBase: string): LinkSegment[]            // Jira keys (ABC-123) become links only when jiraBase is set; http(s) URLs always; trailing .,;:)!? stay outside the link
expandTemplate(line: string, templates: CaptureTemplate[]): string[] | null   // first word == template name (case-insensitive) AND an @handle present -> lines with {person} = handle (no @), {rest} = text after the @handle; else null
nextOneOnOneAt(cadenceDays: number | null, lastInteraction: number | null, now: number): number | null  // start of day of last + cadence; if that is in the past (or never met) -> start of today; null without a cadence
reviewMarkdown(r: ReviewData, names: Record<string, string>, opts?: { title?: string }): string          // "## Week of ..." Done / Still open / Waiting on others / Needs attention, grouped, no AI
upcomingLabel(u: UpcomingDate, name: string): string             // "Sara's 2-year work anniversary is in 3 days", "Amir's birthday is tomorrow", "... is today"
```

## Store (src/core/store.ts), all synchronous, `now` last and optional

`review(from, to?, now?)`, `keptRate(periodDays, now?)`, `activity(from, limit?, now?)` (from `item_events`, newest first, one entry per
event, joined with the current item), `heatGrid(weeks = 12, now?)` (active people only), `onTimeStreak(personId, now?)` (weeks back from the
current week in which the gap since the previous 1:1 stayed within the cadence; the current week counts only if met; 0 without cadence),
`upcomingDates(withinDays = 14, now?)` (anniversary uses startDate month-day with years since; birthday month-day; sorted by date),
`captureMany(line, now?)` (uses `settings().captureTemplates`; otherwise like `capture`, returns Item[]). Database: migration `v3-person-dates`
adds `people.start_date TEXT` and `people.birthday TEXT` (both NULL); register it in `grdb_migrations` like the others. Settings keys
`jiraBaseUrl` (string) and `captureTemplates` (JSON string) in the `settings` table; defaults '' and []. Neither dates, notes nor templates are exposed over MCP.

## Ownership (parallel workers; do not edit another worker's files)

* **core**: `src/core/*`, `test/*.test.ts` for core, MCP unchanged except that `src/mcp/server.ts` must keep working (person JSON must NOT gain the new fields).
* **main**: `src/main/*`: ipc handlers for every new Api method (call the Store), `ui-state.ts` defaults and validation for the new UiState fields, Dock badge (`app.dock.setBadge(String(n))`, empty when 0; n = overdue + slipping, same as the tray), pause notifications (`pauseNotifications(until)` stores `pauseUntil` in ui-state; the notifier skips firing while paused and resumes after; tray menu items "Pause notifications ▸ 1 hour / Until tomorrow 09:00 / Resume" and a "Paused until HH:MM" label), tray text option (`trayText: 'next'` shows a short title of the next due open item, like `owe Sara · Fri`, max ~24 characters, falls back to the count), `captureSubmit` and the capture-bar save path use `captureMany` so templates work everywhere, tests.
* **ui-reports (C1)**: `pages/review.tsx` (new), `pages/done.tsx`, `pages/people.tsx`, `pages/person.tsx` and its components (`cadence-strip.tsx`, a new `components/streak.tsx`), `components/wrapup.tsx` (new, end-of-day card mounted by you in `windows/main.tsx`), person editor fields for start date and birthday, the dates chips under Check in (in `pages/today.tsx`, only that block), nav entry `review` (sidebar item "Review" with the `scroll`/`check` icon below Done, routing in `windows/main.tsx`, title in `navTitle`).
* **ui-speed (C2)**: `components/item-row.tsx` (nudge copy action in the row menu for waits, linkified titles via `linkify` + `settings.jiraBaseUrl`, avatar click filters Today), `model.ts` additions at the end only (snooze-until-next-1:1 helper, `todayPersonFilter` signal, `snoozePresets` extension), `pages/today.tsx` (filter chip row; ring burst when Overdue and Inbox are empty, once a day via `ui.burstDay`), `overlays/people-palette.tsx` (new, ⌘P: opens on the 'command' event value `people` which main must send; since the menu is main's file, C2 instead listens for ⌘P keydown in the renderer window, OK because the menu has no ⌘P), `windows/capture.tsx` (ambient context under the field when an @person is typed: notes snippet and up to 2 open owes; templates are expanded by main, show a chip "template: prep (3 items)"), `windows/settings.tsx` (Jira base URL field, capture templates editor (name + lines textarea), tray text select, notifications pause info, show-dates toggle), the snooze menu entry "Until next 1:1 with <name>".
