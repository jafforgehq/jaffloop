# 0.3.0: dedup, MCP prompts, 1:1 notes and history, better colours and themes

Contract for the parallel workers. Shared files already updated: `src/shared/types.ts` (Item.externalId/sourceLabel/sourceUrl/interactionId,
InteractionWithItems), `src/shared/api.ts` (UiState.theme, Api.interactionHistory, Api.logOneOnOne), `src/shared/prompts.ts` (the ten prompts, `renderPrompt`),
`src/shared/themes-meta.ts` (theme ids, labels, mode). Local-first, no network, no AI inside the app. Do not edit another worker's files.

## 1. Dedup (core + MCP)

* Migration `v4-external-ids` (register in `grdb_migrations` like v1 to v3, fresh schema == migrated schema): `items.external_id TEXT`, `items.source_label TEXT`,
  `items.source_url TEXT`, `items.interaction_id TEXT`, and `CREATE UNIQUE INDEX items_external_id ON items(external_id) WHERE external_id IS NOT NULL`.
  Item read/write/exportJSON carry the four fields (null when unset). `insert()` with an existing external_id must not throw an SQL error to callers that can handle it:
  add `Store.findByExternalId(externalId): Item | null` and make a duplicate insert a clean, typed signal (return the existing item, never a second row).
* A duplicate is any item (open, done or dropped) with the same external_id. Done and dropped duplicates are NOT reopened.
* MCP: `add_item` and `capture` accept optional `external_id`, `source_label`, `source_url`; a duplicate returns `{ "duplicate": true, "id": ..., "item": ... }` (no write, no audit "wrote").
  New tool `add_items` { items: [ same fields as add_item ] } up to 100 items: returns `{ "created": n, "duplicates": n, "errors": n, "results": [ { "index", "status": "created"|"duplicate"|"error", "id"?, "error"? } ] }`;
  one bad item does not stop the others; read-only mode blocks it; hidden people are refused per item. `list_items` item JSON includes `external_id`, `source_label`, `source_url` ONLY when set, and accepts an `external_id` filter.
  Tool list descriptions must say what external_id is for (so Claude uses it). Existing outputs for items without these fields must stay byte-identical.
* Duplicate detection also applies inside one `add_items` call (two items with the same id: second is a duplicate).

## 2. MCP prompts (core + MCP)

Add the `prompts` capability to `initialize`; `prompts/list` returns every entry of `PROMPTS` (`name` = id, `title`, `description`, `arguments` [{name, description, required}]);
`prompts/get` {name, arguments} returns `{ description, messages: [ { role: 'user', content: { type: 'text', text: renderPrompt(p, args) } } ] }`;
unknown prompt or missing required argument is a JSON-RPC error (-32602). Import from `src/shared/prompts.ts` (bundled by esbuild, no filesystem reads).

## 3. 1:1 notes and history (core + MCP + main + renderer)

* Store: `interactionHistory(personId, limit = 10, now?)` (newest first, each with its items: items whose `interaction_id` = the interaction, any status, ordered by creation),
  `logOneOnOne(personId, notes, itemIds, startedAt?, now?)` (creates an Interaction kind '1on1', `occurredAt` = now, notes saved; links itemIds via `interaction_id`; returns the Interaction),
  `linkItemsToInteraction(interactionId, itemIds)`. MCP `log_interaction` gets optional `action_items` (same item fields as add_item, dedup applies): they are created and linked to the logged interaction.
* Main: ipc handlers `interactionHistory` and `logOneOnOne` (data-changed broadcast, same pattern as the other handlers).
* Renderer (`components/one-on-one.tsx`, `pages/person.tsx`): in 1:1 mode a "Meeting notes" textarea (kept while the mode is open) and a "Captured in this 1:1" list (items created through the page's quick capture, the said field and bring-up additions; keep their ids);
  "End 1:1 and log it" calls `api.logOneOnOne(person.id, notes, ids, startedAt)`. The person page gets a collapsible "1:1 history" section (last 10): date and weekday, the notes (3 lines, click to expand), and the action items as small rows/chips (kind dot, title, status: open / done / dropped) that open the item drawer on click. Empty state text. The plain "Log 1:1" button keeps logging an interaction without notes.

## 4. Prompts in the app (renderer)

Settings → Claude (MCP) tab (`windows/settings.tsx`, add a block; new component in `windows/claude-prompts.tsx`): "Ready-made prompts" listing `PROMPTS`: title, description, "needs" chips, argument hints, a Copy button that copies `renderPrompt(p, {})` (defaults filled, required arguments left as {{name}}), plus a note that in Claude Code they appear as slash commands (`/mcp__jaffloop__<id>`) and in Claude Desktop under the + menu. Mention dedup in one line.

## 5. Colours and themes (renderer + main)

* `src/renderer/themes.ts` (pure data + `applyTheme`): a full token set (bg, surface, elevated, text, text2, hairline, hover, selected, clay, avatar, six kind colours, accent default, shadow, scrim, sidebar-bg) per theme in `src/shared/themes-meta.ts` (Classic has a dark and a light set and follows macOS; the other six are fixed). `applyTheme(name, prefersDark)` writes the CSS variables on `document.documentElement` and sets `data-theme`; re-applied when `ui.theme` changes or the system scheme changes.
* Contrast: every text colour meets WCAG AA (4.5:1) on bg, surface and elevated; secondary text (`text2`) at least 6:1; kind colours, clay and accent at least 4.5:1 on bg and elevated; High contrast at least 7:1 for text and text2. Unit test (`test/themes.test.ts`) computes this for every theme. Also audit `styles.css` and the components for low-contrast text (opacity-reduced text, hard-coded greys, placeholder and disabled colours, the mono labels) and fix them to use tokens.
* Settings → General → Appearance: a theme picker (cards with a small live preview), the existing Appearance select applies only to Classic (disabled otherwise with a hint). Main: choosing a theme sets `nativeTheme.themeSource` from the theme's mode (Classic uses the saved appearance); `ui-state.ts` default `theme: 'classic'` and validation (only known ids).

## Ownership

* **core**: `src/core/*`, `src/mcp/*`, `test/*.test.ts` for core and MCP, seed data (items with external ids and sources, a 1:1 with notes and linked items for Sara).
* **ui-1on1**: `src/renderer/components/one-on-one.tsx`, `pages/person.tsx`, a new `components/interaction-history.tsx`, `windows/claude-prompts.tsx`, the prompts block in `windows/settings.tsx`, `src/main/ipc.ts` (the two new handlers only), model.ts additions at the end, tests and e2e (`test/e2e/features-oneonone.test.ts`).
* **ui-themes**: `src/renderer/themes.ts`, `styles.css`, the Appearance block of `windows/settings.tsx`, theme-related parts of `src/main/ui-state.ts` and `main.ts`, `test/themes.test.ts`, e2e (`test/e2e/features-themes.test.ts`), screenshots per theme.
