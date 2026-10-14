# Jaffloop status

Last updated: 2026-10-14

## Where we are

Version 0.0.2 is built, tested, signed, notarized (Apple status Accepted, ticket stapled), and published. It is a UI-only release: no new features.

- Repo (public): https://github.com/jafforgehq/jaffloop
- Release: https://github.com/jafforgehq/jaffloop/releases/tag/v0.0.2
- Release assets: `Jaffloop-0.0.2.zip` and `Jaffloop-0.0.2.zip.sha256`
- v0.0.1 was signed but not notarized. It stays published for history.

## What changed in 0.0.2 (UI only)

- Rows use fixed kind, person and date columns, so they line up on every screen.
- Today shows "N open · M need you today" above the kind strip; the sidebar badge has a tooltip.
- Empty sections on a person page collapse to one dim line. Content is capped at 880 pt and centred.
- Larger small type (11.5 pt for section headers, kind labels and key hints). Light-mode colours darkened to pass 4.5:1 contrast.
- Quiet Schedule and Dismiss buttons on check-ins. "Log 1:1" is the primary action on a person page; Edit moved to a menu.
- Capture bar shows key hints (save, save and keep open, cancel, repeat last) and a syntax line.
- Visible keyboard-focus ring, tooltips, and VoiceOver labels on rows, buttons and sidebar items.
- Free hotkey recorder in Settings (needs ⌃, ⌥ or ⌘, or an F-key), with a "shortcut taken" message and Reset.
- The save animation is now a dot that flies from the capture card to the menu bar icon, then blips. Reduce Motion falls back to the blip.
- Screenshot generator keeps "today" times in the future and hides the hover highlight; the MCP settings shot no longer shows a dev path.

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

1. **No LICENSE file.** The spec says the app stays paid and only the MCP server and data format might be open. Until a license is added, all rights are reserved. Decision needed from the owner.

## Known gaps and shortcuts

- The database is not encrypted (relies on FileVault).
- Builds are arm64 only. The x86_64 universal build failed because the SDK deprecates it.
- Notifications only work from the bundled `.app`.
- Not exercised by hand: the global hotkey and the new recorder, the flying-dot animation, the keyboard focus ring (it depends on the system's keyboard navigation setting), VoiceOver, capture panel key handling (including ⌘Enter), calendar permission and the pre-meeting flow, notification actions, and the live app refresh when the MCP server writes. The UI was verified through rendered screenshots, `swift test` (33 tests) and a launch smoke test only.
- The hotkey key table has no unit test because it lives in the executable target.

## Next steps

1. Hands-on test of the hotkey recorder, flying dot, focus ring, VoiceOver, capture panel, calendar, and notification flows.
2. Choose and add a license.
3. Decide whether to build a universal binary or keep arm64 only.
