# Jaffloop status

Last updated: 2026-10-15

Shipped for Apple Silicon only. Releases: only v0.1.0 (the Swift 0.0.x releases and the `electron` branch were removed; the Swift code is in the git history before commit `fa6e3c5`).

## Where we are

Version 0.2.0 (twenty small features on top of 0.1.0, see `docs/CHANGELOG.md` and `docs/FEATURES-0.2.md`): Jaffloop rebuilt on Electron (TypeScript, Preact, `node:sqlite`) with `electron-updater` auto update. It is the
same product as the Swift 0.0.4 (same database, screens, shortcuts, MCP command). The Swift sources are in git history (tag `v0.0.4`).

- Repo (public): https://github.com/jafforgehq/jaffloop
- Plan and contracts: `docs/ELECTRON.md`. Changes: `docs/CHANGELOG.md`. Plans: `docs/ROADMAP.md`.

## What is built

- `src/core`: capture parser, recurrence, rules, SQLite store (GRDB-compatible schema, FTS5), settings, demo seed. 170 unit tests incl. compatibility tests against databases made by the Swift app.
- `src/mcp`: stdio MCP server (12 tools, resources, read-only mode, per-person hiding, audit log), output diffed against the Swift server.
- `src/main`: windows (main, capture panel, tray popover, settings, briefs), tray, global hotkey, menu, notifications, UI state, update controller around `electron-updater`.
- `src/renderer`: every screen (Today, Ledger, Inbox, People, Person with 1:1 mode and notes, Done, Snoozed, filters, What's new, search, shortcuts, welcome, drawer, bulk actions, undo).
- `scripts/release-mac.sh`: build, sign (Developer ID), notarize, verify, self-test, write the update manifest, optionally publish.

## Verified

- `npm run typecheck`, `npm test` (337 unit tests), `npm run test:e2e` (the built app driven by Playwright against a temp database: capture, keyboard, undo, edit, snooze, search, 1:1, people, appearance, hotkey, settings, MCP write detection, update flow against a local feed) all pass.
- Screenshots in `docs/screenshots` are produced by `npm run screenshots` from the real app.

## Open items

00. **Auto update from a real release is not fully proven.** The published 0.1.0 (notarized) found 0.2.0 on GitHub, downloaded it, and handed it to Squirrel.Mac, which then asked macOS for authorization ("Jaffloop is trying to add a new helper tool") on this Mac (macOS 27) in every test copy outside /Applications, so the install never finished unattended. The same flow with locally built, unnotarized copies (0.1.0 to 0.1.1, `scripts/test-update.sh`) installed and relaunched with no prompt. Not yet known: whether a copy in /Applications prompts. To check: install `Jaffloop-0.1.0-arm64.dmg` into /Applications, open it, wait for the update dialog.

1. **No LICENSE file.** Decision needed from the owner.
2. Not exercised by hand: notification delivery and action buttons, the native menu and tray clicks, the global hotkey firing, the fly-to-menu-bar dot, sounds, an in-place update from a real published release (the update flow is tested against a local feed and, for the signed build, see the release notes in the PR/commit).
3. Existing 0.0.x installs cannot update themselves into 0.1.0 (the Swift app only links to downloads): install it once by hand, then it updates itself.

## Next steps

Monday and Friday reviews over MCP (see `docs/ROADMAP.md`).
