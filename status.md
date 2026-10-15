# Jaffloop status

Last updated: 2026-10-14

## Where we are

Version 0.0.3 is built, tested (39 tests), signed, notarized, and published. It is a UI release plus an in-app update check and What's new page.

- Repo (public): https://github.com/jafforgehq/jaffloop
- Release: https://github.com/jafforgehq/jaffloop/releases/tag/v0.0.3
- Release assets: `Jaffloop-0.0.3.zip` and `Jaffloop-0.0.3.zip.sha256`
- Older releases (0.0.1, 0.0.2) stay published.

## What changed in 0.0.3

See `docs/CHANGELOG.md`. In short: keyboard selection, undo toast, details drawer, inline edit, multi-select, drag to assign, Today grouping/collapse/focus, age badges, locale clock, 12-week 1:1 strip, pinned people, capture preview, menu bar count and quick add, appearance/accent/density settings, calendar removed.

## Updates and release notes

- Settings, About, and the What's new page have a **Check for updates** button. It calls the GitHub releases API once, only when pressed (or daily if the user opts in). It never downloads or installs; it links to the zip and release page.
- First launch of a newer version opens What's new with a banner. Version tracking started in 0.0.3, so an existing install with data is treated as updated from "an earlier version".
- Release notes and roadmap live in `Sources/Jaffloop/Releases.swift` (in app) and `docs/CHANGELOG.md`, `docs/ROADMAP.md`. Release checklist is at the bottom of `docs/ROADMAP.md`.

## What is built

A SwiftPM package (tools 5.9, macOS 14+, GRDB 6.29) with three targets:

- `JaffloopCore`: models, GRDB database (WAL, FTS5), settings, the deterministic capture parser and recurrence, the derived rules (slipping, stale wait, overdue, cadence), the store, and a hand-written stdio MCP server (12 tools, 3 resources, read-only mode, per-person hiding, audit log).
- `Jaffloop`: the SwiftUI and AppKit app. It has the main window (Today, Ledger, Inbox, People, Person, Tag, command palette), the global capture bar, pre-meeting card, person and morning briefs, the menu bar popover, Settings, read-only calendar access, and notifications.
- `jaffloop-mcp`: the stdio entry point. It supports `--db <path>` and `--version`.

Packaging and docs: `scripts/build-app.sh`, `scripts/Info.plist`, `scripts/Jaffloop.entitlements`, `scripts/make-icon.swift`, `README.md` with screenshots in `docs/screenshots/`, and the spec with its decisions log in `docs/jaffloop-spec.md`.

## Verified

- `swift test`: 33 tests, 0 failures (parser, rules, store, MCP).
- The signed `.app` launches and stays running.
- `jaffloop-mcp` answered initialize, capture, and list_items over stdio.
- Code signing: Developer ID Application, Feda Hadziselimovic (R9QFVTDHY5), hardened runtime. `codesign --verify --deep --strict` passes.
- A date-only due date bug (off by one day in non-UTC timezones) was found in the smoke test, fixed, and covered by a test.

## Open items

1. **No LICENSE file.** The spec says the app stays paid and only the MCP server and data format might be open. Decision needed from the owner.

## Known gaps and shortcuts

- The database is not encrypted (relies on FileVault).
- Builds are arm64 only.
- Notifications only work from the bundled `.app`.
- Not exercised by hand (only screenshots, 39 unit tests and a launch smoke test): every keyboard shortcut, drag-to-assign, the bulk bar, the undo toast and ⌘Z, inline edit, the flying dot, the hotkey recorder, appearance switching, the menu bar count, the update check against a newer release, the What's new auto-open after an update, VoiceOver, and the focus ring.
- Update check was verified only against the GitHub API shape (curl), not through the app.

## Next steps

1. Use 0.0.3 for a few days and fix what breaks (see the "not exercised by hand" list).
2. Monday and Friday reviews over MCP (see `docs/ROADMAP.md`).
3. Choose and add a license.
