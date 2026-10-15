# Jaffloop status

Last updated: 2026-10-15

## Where we are

Version 0.1.0: Jaffloop rebuilt on Electron (TypeScript, Preact, `node:sqlite`) with `electron-updater` auto update. It is the
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

- `npm run typecheck`, `npm test` (230 unit tests), `npm run test:e2e` (the built app driven by Playwright against a temp database: capture, keyboard, undo, edit, snooze, search, 1:1, people, appearance, hotkey, settings, MCP write detection, update flow against a local feed) all pass.
- Screenshots in `docs/screenshots` are produced by `npm run screenshots` from the real app.

## Open items

0. **0.1.0 is merged to `main` but not published.** The signed (Developer ID) arm64 and x64 builds pass their checks (codesign, smoke test, MCP launcher, update manifest, in-place update with `scripts/test-update.sh`), but notarization is pending: the notarytool keychain profile `jaffloop` is gone from the login keychain. Recreate it once (`xcrun notarytool store-credentials jaffloop --apple-id <id> --team-id R9QFVTDHY5`, app-specific password), then run `scripts/release-mac.sh --publish`. Until then the latest GitHub release stays v0.0.4.
1. **No LICENSE file.** Decision needed from the owner.
2. Not exercised by hand: notification delivery and action buttons, the native menu and tray clicks, the global hotkey firing, the fly-to-menu-bar dot, sounds, an in-place update from a real published release (the update flow is tested against a local feed and, for the signed build, see the release notes in the PR/commit).
3. Existing 0.0.x installs cannot update themselves into 0.1.0 (the Swift app only links to downloads): install it once by hand, then it updates itself.

## Next steps

Monday and Friday reviews over MCP (see `docs/ROADMAP.md`).
