# Jaffloop on Electron: port plan and contract

> Status: the port is finished (0.1.0). This is the design record: how the work was split and the contracts between the parts. The Swift reference it mentions lives in git history (tag `v0.0.4`) and is no longer in the tree.

Jaffloop 0.0.x was a native SwiftUI app (see git tag `v0.0.4`). 0.1.0 is the same product rebuilt on Electron so it gets
`electron-updater` auto update, an Intel build and the release pipeline already used by Jaffer. The stack mirrors
`jafforgehq/jaffer`: TypeScript, Preact + @preact/signals, esbuild, vitest, playwright-core for end-to-end tests,
electron-builder, `scripts/release-mac.sh`.

**The product does not change.** Same data, same screens, same keys, same words. The Swift sources stay in the tree
(`Sources/`, `Tests/`, `Package.swift`) until the port is finished; they are the reference for behaviour.
Screenshots in `docs/screenshots/` are the reference for how it looks.

## Rules that hold everywhere

1. **Same database file.** `~/Library/Application Support/Jaffloop/jaffloop.sqlite`, the schema GRDB created (see below).
   An existing user's data must open unchanged. Never open that file in tests or while developing: use a temp path.
2. **Dates** are epoch milliseconds (`number`) in all TypeScript. Only `src/core/db.ts` converts to and from GRDB's text format.
3. **Pure modules vs node modules.** `src/core/{parser,recurrence,rules,helpers,format}.ts` are pure (no `node:` or `electron`
   imports) because the renderer bundles them for instant live parsing and formatting. `src/core/{db,store}.ts` use
   `node:sqlite` and run only in main and the MCP process.
4. **No network** except `electron-updater` talking to GitHub releases (main process only).
5. **Time zone.** Everything uses the machine's local time zone. Tests run with `TZ=UTC` (set in `vitest.config.ts`).
   Weeks start on Monday (the Swift code used `firstWeekday = 2`).
6. **No native modules.** SQLite is `node:sqlite` (Electron 44 ships Node 24). The MCP server runs as
   `ELECTRON_RUN_AS_NODE=1 Jaffloop.app/Contents/MacOS/Jaffloop server.cjs`, so the user needs no Node install.

## Layout

```
src/shared/types.ts      data types (done)          src/shared/api.ts   renderer <-> main contract (done)
src/core/                parser, recurrence, rules, helpers, format (pure) + db, store, settings (node:sqlite)
src/mcp/server.ts        stdio MCP server -> dist/mcp/server.cjs
src/main/                Electron main process, preload, windows, tray, hotkey, notifications, updates, menu, ui-state
src/renderer/            one bundle, every window; `?view=main|capture|popover|settings|brief|morning`
test/                    vitest unit tests (ported from Tests/JaffloopCoreTests) ; test/e2e/ Playwright-driven app tests
scripts/build.mjs        esbuild: main, preload, mcp, renderer          scripts/release-mac.sh  sign, notarize, publish
build/                   icon, tray icons, entitlements, bin/jaffloop-mcp (shell wrapper)
```

## Database compatibility (GRDB)

* Text dates: `yyyy-MM-dd HH:mm:ss.SSS`, UTC. Booleans 0/1. IDs are uppercase UUID strings (Swift `UUID().uuidString`).
* Table `grdb_migrations(identifier TEXT PRIMARY KEY)` holds applied migration names: `v1`, `v2-person-notes`. For a **new**
  database create the full v2 schema and insert both names, so the old Swift build could still open it. For an **existing**
  database that lacks `v2-person-notes`, run the migration (`ALTER TABLE people ADD COLUMN notes TEXT NOT NULL DEFAULT ''`)
  and insert the name.
* `items_fts` is an FTS5 external-content table synchronized with `items` by triggers. Copy the exact DDL from a database made
  by the Swift build: `dist/Jaffloop.app/Contents/MacOS/jaffloop-mcp --db /tmp/x.sqlite` (send one `initialize` and one `capture`
  JSON-RPC line on stdin), then `sqlite3 /tmp/x.sqlite .schema`.
* WAL mode, `busy_timeout` 5000 ms. The app and the MCP process both write; `PRAGMA data_version` changes when another
  connection commits, which is how the app notices MCP writes (poll once a second).
* The Swift `Settings.hotkey` was stored as `opt+space`; store Electron accelerators (`Alt+Space`) and convert the old form on read.

## `Store` (src/core/store.ts), same names as the Swift `Store`

`class Store { constructor(db: DatabaseSync, opts?: { calendar? }) }` plus `openDatabase(path)` and `openMemoryDatabase()` in `db.ts`.
Methods (all synchronous): `settings()`, `saveSettings(s)`, `person(handle, create=true)`, `people(includeArchived)`,
`savePerson(p)`, `personSummaries(now, includeArchived)`, `hiddenPersonIds()`, `create(parsed, source, now)`,
`capture(line, source, now)`, `insert(item, tags)`, `item(id)`, `tags(of)`, `allTags()`, `items(filter, now)`,
`update(id, change, now)`, `complete(id, now)`, `drop(id, now)`, `restore(item)`, `reopen(id, now)`, `snooze(id, until, now)`,
`assign(id, handle, due, hasTime)`, `setTags(id, tags)`, `logInteraction(personId, kind, notes, at)`, `interactions(personId, limit)`,
`search(query, limit, now)` (filters `@person kind:owe before:2026-11-01 status:done`), `today(now)`, `overdueCount(now)`,
`weekSummary(from, to, now)`, `audit(tool, summary, wrote, at)`, `auditLog(limit)`, `exportJSON()`, `dataVersion()`,
`history(since, limit)`, `snoozed(now)`, `snapshot(now)` (builds the `Snapshot` type).

## Renderer windows

One HTML file, one bundle. `window.jaffloop.view` says which window it is; `window.jaffloop.params` carries e.g. `{ personId }`.

* `main`: sidebar + pages + drawer + overlays (search, shortcuts, welcome) + toast and bulk bar.
* `capture`: frameless transparent always-on-top panel (`type: 'panel'` so it does not steal focus from the app below).
* `popover`: tray popover (today list + quick add), `settings`, `brief` (person brief), `morning` (morning brief).

## Auto update

`electron-updater` with the GitHub provider (`publish` block in `electron-builder.yml`); releases carry `.dmg` (first install),
`.zip` and `latest-mac.yml` for arm64 and x64. Policy copied from Jaffer: check ~15 s after launch and every 6 h
(Settings → About → "Check automatically", default on), download in the background, show **Update ready, Restart** in the
sidebar footer and a dialog on manual checks, install on restart or when the app quits. Only Developer ID signed builds can
update themselves. Update flow tests use a local feed (see `test/e2e/update.test.ts`), never the real releases.

## Environment variables and flags (for tests and screenshots)

`JAFFLOOP_DB=<path>` database path, `JAFFLOOP_USERDATA=<dir>` Electron user-data dir, `JAFFLOOP_SMOKE=1` open the main window,
print `SMOKE OK` and quit, `JAFFLOOP_NO_UPDATER=1`, `JAFFLOOP_BACKUP_DIR=<dir>` (where the backup before "Reset everything" goes; default Documents), `JAFFLOOP_E2E=1` (test hooks; windows are transparent, click-through and inactive, with no sounds, notifications, Dock icon or flying dot so tests never pop up over your work; add `JAFFLOOP_E2E_VISIBLE=1` to watch a run), `JAFFLOOP_SEED=1` fill an empty database with the demo data used for
screenshots, `--db <path>`, `--background` (no main window at launch).

## Who owns which files (the port is split between parallel workers)

Written already, treat as stable (ask before changing; additions are fine): `src/shared/*`, `src/renderer/styles.css`,
`src/renderer/components/{icons,ui}.tsx` (Icon, Kbd, Chip, Dot, KindLabel, Avatar, Primary/Ghost/Quiet/IconButton, Segmented,
LoopRing, CadenceRing, SectionHeader, EmptySection, Popover, MenuButton, openContextMenu), `src/renderer/model.ts` (every signal and
action: read this before writing any view; views must not duplicate its logic), `src/renderer/index.tsx`, `scripts/build.mjs`,
`electron-builder*.yml`, `scripts/release-mac.sh`. `src/renderer/core.ts` is the facade over `src/core/pure` that model.ts imports.

| Owner | Files |
|---|---|
| core | `src/core/*`, `test/*.test.ts` (not e2e, not mcp, not main) |
| mcp | `src/mcp/*`, `test/mcp.test.ts` |
| main | `src/main/*`, `src/core/seed.ts`, `test/main-*.test.ts`, `test/e2e/*` harness helpers |
| ui-shell (D1a) | `windows/main.tsx`, `components/{page,item-row,drawer,toast,due-editor,person-picker,sidebar}.tsx`, `hooks/use-item-keys.ts`, `pages/{today,ledger,inbox,tag,filter,done,snoozed}.tsx` |
| ui-people (D1b) | `pages/{people,person,releases}.tsx`, `overlays/{search,shortcuts,welcome}.tsx`, `components/{notes-field,cadence-strip,one-on-one,update-panel}.tsx`, `src/renderer/releases-data.ts` |
| ui-windows (D2) | `windows/{capture,popover,settings,briefs}.tsx` and what they need privately (`windows/*.tsx` helpers) |

Cross-file contracts (exact names; the owner of the file implements, others import):

* `components/page.tsx`: `Page({ title, subtitle?, header?, children })`. A scrolling `.page > .page-inner`; scrolls the element with
  `data-item-id = selectedItemId` into view when the selection changes.
* `components/item-row.tsx`: `ItemRow({ item, index?, showPerson?=true, showKind?=true, compact?=false, densityOverride? })` and
  `ItemList({ items, showPerson?, showKind? })`. Every row root has `data-item-id`.
* `hooks/use-item-keys.ts`: `useItemKeys(items: Item[], opts?: { triage?: (key: string, item: Item, items: Item[]) => boolean })`.
* `components/due-editor.tsx`: `DueEditor({ current: number | null, hasTime: boolean, onApply: (due: number | null, hasTime: boolean) => void })`
  (rendered inside a `Popover`). `components/person-picker.tsx`: `PersonPicker({ onPick: (handle: string) => void })`.
* `components/toast.tsx`: `ToastBar()`, `BulkBar()`. `components/drawer.tsx`: `ItemDrawer({ item })`.
* `pages/*.tsx` export one page component each, no props except where the page needs a param (`PersonPage({ personId })`,
  `TagPage({ tag })`, `FilterPage({ query })`). `windows/main.tsx` routes `nav.value` to them.
* `components/one-on-one.tsx`: `OneOnOne({ person, onEnd })` (used by PersonPage). `components/update-panel.tsx`: `UpdatePanel()` (used by
  ReleasesPage and the Settings About tab).

## Renderer facade (`src/renderer/core.ts`, written by the integrator)

The renderer imports pure core logic only through this file. Exact shape:

```ts
export const Fmt: {
  isOverdue(i: Item, now?: number): boolean;  isSlipping(i: Item): boolean;  isStaleWait(i: Item, now: number | undefined, s: Settings): boolean;
  due(i: Item, now?: number): string | null;          // "Today", "Fri 10:00", "Oct 15" (locale clock)
  exact(i: Item): string | null;                       // "Friday 16 October 2026, 10:00"
  short(ms: number, pattern: string): string;          // pattern letters as the Swift code used: 'EEE d MMM HH:mm', 'd MMM'. HH:mm follows the locale clock
  backLabel(ms: number, now?: number): string;         // "back Mon", "back tomorrow 09:00"
  isPrefix(word: string): boolean;                     // owe/wait/bring/todo/said/note prefixes (CaptureParser prefixes)
  hotkeyLabel(accelerator: string): string;            // "Alt+Space" -> "⌥Space"
  ageBadge(i: Item, now?: number): number | null;  ageLevel(days: number): 0 | 1 | 2;
  recurrenceText(rule: string): string;  queryWords(q: string): string[];
  cadenceWeeks(dates: number[], now?: number, count?: number): boolean[];
};
export const PinOrder: { apply(items: Item[], order: string[]): Item[]; move(id: string, onto: string, order: string[]): string[] };
export class NavHistory<T> { visit(from: T, to: T): void; goBack(current: T): T | undefined; goForward(current: T): T | undefined; canGoBack: boolean; canGoForward: boolean }
export function sortPeople(s: PersonSummary[], pinned: Set<string>): PersonSummary[];
export function parseCapture(line: string, opts?: { now?: number; eod?: [number, number] }): ParsedCapture;
```
