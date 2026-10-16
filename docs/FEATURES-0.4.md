# 0.4.0: onboarding, people details, save_person over MCP, review what Claude adds

Contract for the parallel workers. Shared files already updated (do not change their meaning): `src/shared/types.ts` (Person.title, Item.proposed,
Settings.reviewClaudeItems, ItemFilter.includeProposed/proposedOnly, Snapshot.proposed), `src/shared/api.ts` (acceptProposed, dismissProposed),
`src/shared/prompts.ts` (new 11th prompt `build-my-team`). Local-first, no network, no AI inside the app. Do not edit another worker's files.

## 1. Position (title) on people (core + MCP + renderer)

* Migration `v5-people-title-proposed` (registered in `grdb_migrations`; fresh schema == migrated schema), one migration for both features:
  `people.title TEXT NOT NULL DEFAULT ''`, `items.proposed BOOLEAN NOT NULL DEFAULT 0`.
* Person read/write/exportJSON carry `title` (`newPerson` default ''). Seed gives the demo people titles (Sara: Staff engineer, Amir: Senior engineer, Jonas: Engineering manager (peer),
  Maya: Product manager, Priya: Junior engineer; adjust to the real demo people).
* MCP: `personJSON` / `get_person` / `list_people` / `prep_brief` show `title` only when non-empty. It is not private (unlike notes, birthday, start date).
* Renderer: Title field in the person edit sheet; shown under the name on the person page (`Staff engineer · report`), in the People list and grid rows (replacing the lone relation when a title exists:
  `Staff engineer · report`), in the ⌘P people palette and the person brief window.

## 2. `save_person` MCP tool (core + MCP)

`save_person` { handle (required), name, title, relation (report|peer|manager|stakeholder|other), cadence_days (integer 1-90, or null/0 to clear), match_emails (string, comma separated),
start_date ('YYYY-MM-DD'), birthday ('MM-DD' or 'YYYY-MM-DD'; stored as MM-DD), archived (boolean) }. Upsert by handle (same normalisation as `Store.person`); only fields that are present are changed;
a new person without a name gets `nameFromHandle`. NOT writable: notes, hidden_from_claude. A person with `hiddenFromClaude` is refused like everywhere else ("No person with handle ..."). Read-only mode blocks it.
Returns the same JSON as `list_people` for that person plus `created: true|false`. Audit entry `save_person: <handle>` with wrote = true. Birthday and start date are accepted but never echoed back (they stay private).
Tool description must say: use it to set up or correct people (e.g. from the org chart), call list_people first, never invent birthdays.

## 3. Review what Claude adds: proposed items (core + MCP + main + renderer)

* Setting `reviewClaudeItems` (default false, stored in the `settings` table like the others, `Settings.reviewClaudeItems`). When true, every item created over MCP (`capture`, `add_item`, `add_items`,
  `log_interaction` action_items) is stored with `proposed = 1`. The dedup rules do not change: a proposed item still owns its external_id, so a dismissed one is never re-imported.
* A proposed item is left out of: `Store.items` (unless `includeProposed` or `proposedOnly`), `today()`, `snapshot().openItems`, person summary counts (openOwe/openWait), the heat/load numbers, the review, FTS `search`,
  notifications (the notifier reads `store.items`), the tray/Dock badge counts and `weekSummary`. The MCP `list_items` DOES return proposed items (so Claude can see what it already added) with `"proposed": true` (only when true);
  `get_person` does not list them. `complete_item` / `update_item` on a proposed item work.
* Store: `proposedItems(now)` (open + proposed, newest first), `acceptProposed(ids, now)` (clears the flag, bumps updatedAt/lastTouchedAt, applies the usual `inbox` rule: stays inbox if it has no person and no due date),
  `dismissProposed(ids, now)` (status dropped, proposed cleared, event logged like `drop`). `Snapshot.proposed = proposedItems`.
* Main: ipc `acceptProposed(ids)` and `dismissProposed(ids)` (data-changed broadcast, same pattern as `drop`). The Dock badge and tray count do not include proposed items.
* Renderer: Inbox page gets a section "Claude added these" ABOVE the normal inbox list (only when there are proposals): per row the title, person chip, due, source chip, `Accept` and `Dismiss` buttons, and header buttons
  "Accept all" / "Dismiss all"; keyboard `a` accepts and `x` dismisses the selected proposal. The sidebar Inbox badge counts proposals plus the normal inbox. Today shows a one-line card
  "Claude added N items for you to review" with a button to the Inbox (only when N > 0). Settings → Claude (MCP) gets a switch "Review what Claude adds first" with one line of explanation (saved through `saveSettings`).
  Undo for accept/dismiss uses the existing toast pattern.

## 4. Onboarding and adding people (renderer)

* New `components/person-form.tsx`: one form used by the wizard and the People page. Fields: name (required), position, relation (default report), 1:1 cadence (segmented 7 / 14 / 30 / none plus a custom
  stepper like the edit sheet), birthday (month + day, optional), start date (optional), work emails (optional, "used to match meeting invites"). Creating: `api.addPerson(name)` then `api.savePerson({...p, ...fields})`.
  A handle that already exists is reported inline ("Sara Lindqvist is already in your list") and nothing is overwritten.
* New `overlays/onboarding.tsx` (route/overlay state in `model.ts`: `showOnboarding` signal + `openOnboarding()`): "Add your team", one person per step, on the right the list of people added so far (tick, name, title),
  buttons `Save and add another` (⌘⏎ also), `Done`, `Skip`. It opens from the welcome screen (new primary action "Add your team", "Start" stays), from the People page ("Add your team" in the empty state and an "Add person…"
  button next to the quick name field that opens the same form in a dialog) and from Settings → General ("Add people…", small button in a new "People" row). It never opens by itself on a database that already has people.
* Welcome screen text: step 1 becomes "Add your team" (name, position, birthday, 1:1 cadence; you can change everything later). Keep the other steps.
* The person page edit sheet gets the Title field (see 1) so everything can be changed any time.

## Tests

Core/MCP: new `test/people-title.test.ts` (migration v4 -> v5 keeps data, title round trip, MCP save_person create/update/hidden/read-only/validation, birthday not echoed), `test/proposed.test.ts` (all the exclusions
above, accept, dismiss, dedup of a dismissed item, setting off = no proposals, MCP flow), extend `test/compat.test.ts` (fresh schema equals migrated schema incl. v5), `test/mcp-prompts.test.ts` (11 prompts incl. build-my-team).
UI: `test/ui-onboarding.test.ts` (logic/units), `test/e2e/features-onboarding.test.ts` (wizard adds two people with title/cadence on an empty database, shows them in People; welcome -> wizard; People "Add person…" dialog),
`test/e2e/features-proposed.test.ts` (set the setting, add an item through MCP (spawn the server or call the store from the test), see it in Inbox, accept, dismiss, badge counts). All existing tests keep passing.
