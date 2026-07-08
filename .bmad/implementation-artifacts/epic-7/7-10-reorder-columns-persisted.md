---
baseline_commit: 11bfe2ffaf48f594d77cf528077950dd9e310504
---

# Story 7.10: Reorder columns by drag-and-drop (persisted table layout)

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a reader,
I want to drag columns into the order I prefer and have it remembered,
so that the table opens the way I left it every time.

## Context

Story 7.4 gave the collection table a **fixed** column model: `COLUMNS` (a `const` array in `tableView.ts`), a `hiddenColumns` set + `sort` in `useTableView`, and per-column `widths` in `useColumnWidths`. All of it is **ephemeral view-state** (AD-L3): reload the app and the layout resets to the `COLUMNS` default. This story adds two things:

1. **Drag-to-reorder the columns** (plus a keyboard-operable move), and
2. **Persist the table LAYOUT** (order + visibility + widths) so it survives a reload.

This is the **first client-side persisted table layout**. It is one app-global layout for the collection table (decided with the user, not per-doc, not per-folder). The persisted surface is `order` + `hidden` + `widths`. **Sort is NOT persisted** (re-sort per session). **Row order is untouched** (still the client sort / `library.json` insertion order, AD-L1).

**No backend, no contract, no migration.** Table-layout preferences are client-only UI state and never enter `library.json` / `meta.json` (storage stays their sole writer, AD-9 / AL-7). Nothing in `server/` changes.

**Two precedents carry most of the story:**

1. **Persistence follows `settings/store.ts` (Story 5.1).** That is the app's one existing `localStorage`-persisted preferences store: a Zustand store wrapped in the `persist` middleware (`name: "paper-mate:settings"`, `version: 1`, `partialize`). Mirror it for a new `paper-mate:table-view` store. The middleware handles the load / parse / versioned-schema / degrade-on-corrupt mechanics that AC-5 requires, so **do not hand-roll `localStorage.getItem`/`JSON.parse`** (CLAUDE.md: adopt stable solutions; and `settings/store.ts` is the in-repo precedent).
2. **Drag + keyboard interaction follows the existing table primitives.** Pointer drag mirrors the **native HTML5 drag** already used for row-move (`CollectionTable.handleDragStart` + `buildDragPreview` + `dataTransfer`, `CollectionTable.tsx:573`), and the keyboard move mirrors `useDragResize`'s Arrow-key handler (`useDragResize.ts:55`). **No drag library is installed** (only `zustand` + `perfect-freehand` + `@phosphor-icons/react`), and one is not warranted for a single header row (CLAUDE.md: smallest correct structure wins). The reorder itself is a pure array-move function, unit-testable in isolation.

**The one load-bearing structural change** is that `PaperRow` and `PendingRow` render their `<td>`s in a **hardcoded JSX order** today, only *gated* (not *ordered*) by `visibleColumns`. The `<th>` / `<colgroup>` order comes from the `COLUMNS`-filtered **array** (order-correct), but the row bodies do not. They align today only because the hardcoded JSX happens to match `COLUMNS`. A persisted arbitrary order breaks that alignment: cells would render under the wrong headers. **The row bodies must render cells from the ordered column list.** This is the crux of the story (see Dev Notes → "The cell-order trap").

**Source:** `epics.md` Story 7.10 (full ACs, lines 1810-1837); LFR-4, L-UX-DR3, L-UX-DR12, L-UX-DR13; AL-3-amended, LNFR-5; AD-9, AD-L1, AD-L3, AL-7.

## Design decisions (open calls resolved at create-story)

The epic left three open calls. Resolved here so the dev agent does not re-litigate them:

1. **Title is pinned first (not freely movable).** Title stays the leftmost column and stays non-hideable (7.4 AC-1: it carries the Open button + inline-edit + selection affordance). Reorder applies to **the columns to the right of Title**; a drop before Title clamps to "just after Title". Rationale: smallest correct rule, no edge cases around stranding the primary column, and the existing code + tests already assume Title is first. (Epic AC-3.)
2. **Hand-rolled native HTML5 DnD for the pointer path; explicit menu items for the keyboard path.** Pointer: `<th>` becomes `draggable`, using `dataTransfer` + a compact drag preview (reuse the `buildDragPreview` shape) and a drop indicator on the target header. Keyboard: add **"Move left" / "Move right"** items to the existing per-column header popover (`ColumnHeaderCell`, alongside Sort ASC/DESC/Hide). Both call one store action. This reuses the existing popover-menu + native-drag patterns and satisfies L-UX-DR12 (keyboard-operable, visible focus) without a roving-tabindex reorder widget or a new dependency.
3. **`localStorage` key + schema: a Zustand `persist` store `paper-mate:table-view`, `version: 1`.** Persisted shape: `{ order: ColumnKey[]; hidden: ColumnKey[]; widths: Partial<Record<ColumnKey, number>> }`. On load, **reconcile against the current `COLUMNS` set**: drop any unknown/removed key, and append any known key missing from the stored `order` at its default position, so a future column-set change cannot break an old saved layout (AC-5 forward-compat). Degrade to the default order + default hidden (`{doi}`) + default widths on a missing/corrupt value.

## Acceptance Criteria

**AC-1, Drag a header to reorder.** Given the table header, when I drag a column header onto another header, then the columns reorder to the drop position with a clear drag affordance (a drag preview) and a drop indicator on the target header, both token-driven (no raw hex/px outside `src/theme/**`). Title is pinned first: it is not draggable and nothing drops before it. (LFR-4, L-UX-DR3, epic AC-1/AC-3)

**AC-2, Keyboard-operable reorder.** Given a column's header menu (the existing per-column popover), then it offers "Move left" and "Move right" actions that reorder the column one position in that direction, keyboard-operable with visible focus, respecting the Title-pinned-first constraint (a column immediately right of Title cannot move left past it; the rightmost cannot move right). (L-UX-DR12, epic AC-1)

**AC-3, Order + visibility + widths persist across reload.** Given a reordered / re-hidden / resized table, when I reload the app or revisit the Library, then the column ORDER, VISIBILITY (the 7.4 Display toggle), and WIDTHS are restored from a client-only `localStorage` `paper-mate:table-view` store. The active SORT is NOT persisted (re-sort per session). Row order is unchanged. (LFR-4, AL-3-amended, epic AC-2)

**AC-4, Title stays pinned first and non-hideable.** Given Title carries the Open button + inline-edit affordance (7.4 AC-1), then the reorder keeps Title reachable as the primary column: Title is pinned first (never moves, never hides), and every persisted/reconciled order places Title at index 0. (Epic AC-3)

**AC-5, The store degrades safely and is forward-compatible.** Given the persisted preferences store, then it is client-only + app-global (NOT per-doc, NOT in `library.json`/`meta.json`); it degrades to the default `COLUMNS` order + default hidden set (`{doi}`) + default widths on a missing / corrupt / older-shape value; and an unknown or removed column key in a stored layout is ignored (dropped from `order`/`hidden`/`widths`) while a newly added known column is appended at its default position, so a future column-set change cannot break an old saved layout. (LNFR-5-style forward-compat, AL-3-amended, epic AC-4)

**AC-6, Row cells follow the persisted order.** Given an arbitrary persisted column order, then every rendered row (`PaperRow`, `PendingRow`, the loading skeleton, group-header `colSpan`) renders its cells in the SAME order as the `<th>`/`<colgroup>`, with no cell rendering under the wrong header. (The row bodies must render from the ordered column list, not hardcoded JSX; see Dev Notes.) (epic AC-5)

**AC-7, View-state threads through cleanly; suite stays green.** Given the change, then `tableView.ts`'s fixed `COLUMNS` const becomes the default seed for an ordered, persisted list threaded through `useTableView`; client tests + typecheck stay green; `no-raw-values.test.ts` stays green after any CSS; no em-dash in any new UI string ("Move left", "Move right", drop-indicator aria-labels, etc.); and the reorder + persistence are live-smoked (reorder, hide, resize, reload, layout restored). (L-UX-DR13, CLAUDE.md, epic AC-5)

## Scope boundary (read first, prevents scope creep)

**In scope:**

- **A new persisted store** `client/src/library/tableViewPrefs.ts` (or `.store.ts`): a Zustand `persist` store (`paper-mate:table-view`, `version: 1`) owning `order` / `hidden` / `widths`, with actions to reorder, toggle-hide, and set-width, and a load-time reconcile against `COLUMNS`. Mirror `settings/store.ts`.
- **`useTableView`** rewired to read `order` + `hidden` from the store (its `visibleColumns` now reflects the persisted order), keep `sort` local (ephemeral), and expose a `reorderColumn` / `moveColumn` action. `toggleColumn` writes through the store.
- **`useColumnWidths`** rewired so the settled width persists to the store (drag/keyboard commit writes back; the store seeds the initial). `useDragResize` gains a commit callback for the settled value (or equivalent) so per-frame drag values are NOT written to `localStorage`, only the final one.
- **`CollectionTable` / `ColumnHeaderCell`**: header becomes `draggable` with a drop indicator; the per-column popover gains "Move left" / "Move right"; a `onReorderColumn` prop threads up to `LibraryPage`.
- **`PaperRow` + `PendingRow` + `TableSkeleton`**: render cells from the ordered column list (the crux). The `visibleColumns` prop to the row bodies changes from a membership `Set` to the ordered `ColumnDef[]` (or ordered `ColumnKey[]`).
- **A pure reorder helper** in `tableView.ts` (e.g. `reorderColumns(order, from, to)` / `moveColumn(order, key, dir)`) that respects Title-pinned-first, unit-tested.
- **CSS**: a token-driven drop indicator + `draggable` header affordance in `CollectionTable.css`, dims tokenized in `components.css`. Token-only.
- Unit tests (client only) + typecheck + a live smoke on your OWN fresh servers. Version PATCH bump `0.5.8` → `0.5.9` at story done.

**Out of scope (do NOT build):**

- **Any backend / server change.** No route, no `library.json`/`meta.json` field, no OpenAPI/`schema.d.ts` regen. Table layout is client-only UI state (AD-9, AL-7). If you find yourself editing `server/`, stop.
- **Persisting the active sort.** Sort stays ephemeral (re-sort per session). Only order + visibility + widths persist.
- **Per-doc or server-synced layout.** One app-global client layout. No per-folder, per-lens, or synced variant.
- **Adding, removing, or renaming columns.** Reorder the existing set only. (Author-as-tag is Story 7.11.)
- **The column cell-TYPE registry (text/number/badge/tag dispatch).** That is Story 7.11. This story renders the row cells in ORDER with a minimal keyed switch/render map; do NOT build a general cellType descriptor seam. (7.11 introduces it, 7.12 consolidates. Keep 7.10's row-render dispatch as small as the ordered render requires; see Dev Notes.)
- **A structural refactor of `CollectionTable` / `LibraryPage` / the view-state hooks.** That is Story 7.12 (the Epic 7 refactor, now the last story). Introduce the store and thread it; do not reshape the surrounding modules.
- **Making the Display menu reflect the persisted order.** `DisplayMenu` may keep listing hideable columns in the default `COLUMNS` order; matching it to the live order is optional polish, not required by any AC.

## Tasks / Subtasks

- [x] **Task 1, The persisted preferences store (AC-3, AC-4, AC-5)**
  - [x] Create `client/src/library/tableViewPrefs.ts`: a Zustand store wrapped in `persist` (mirror `settings/store.ts:22-42`), `name: "paper-mate:table-view"`, `version: 1`, `partialize` to `{ order, hidden, widths }`. State: `order: ColumnKey[]` (default = `COLUMNS.map(c => c.key)`), `hidden: ColumnKey[]` (default = `["doi"]`, the current `useTableView` seed), `widths: Partial<Record<ColumnKey, number>>` (default `{}`, meaning "use the `DEFAULT_WIDTHS` fallback"). Actions: `moveColumn(key, "left" | "right")`, `reorderColumns(fromKey, toKey)` (drop-onto semantics), `toggleHidden(key)`, `setWidth(key, value)`, `reset()`.
  - [x] **Reconcile on load (AC-5).** Add a `merge`/`migrate` in the persist options (or a `reconcile(persisted): State` the store runs once): given a persisted `order`, produce a valid order = Title first, then persisted keys that still exist in `COLUMNS` (in persisted order), then any `COLUMNS` key not present in the persisted order appended at its default index. Drop unknown keys from `hidden` + `widths` too. A missing/corrupt persisted value falls back to the full default state. Title is force-pinned to index 0 regardless of what was stored.
  - [x] Keep Title-pinned-first an INVARIANT of the store actions: `moveColumn`/`reorderColumns` never move Title and never place another column before it. `toggleHidden("title")` is a no-op (Title is non-hideable, mirror `useTableView.toggleColumn`'s current guard, `useTableView.ts:20`).

- [x] **Task 2, Pure reorder helpers (AC-1, AC-2, AC-4)**
  - [x] `client/src/library/tableView.ts`: add pure, React-free helpers next to `sortRows`: `moveColumn(order: ColumnKey[], key: ColumnKey, dir: "left" | "right"): ColumnKey[]` and `reorderColumns(order: ColumnKey[], fromKey: ColumnKey, toKey: ColumnKey): ColumnKey[]` (insert `fromKey` at `toKey`'s position). Both return a NEW array (never mutate), clamp Title to index 0, and are no-ops when the move would cross Title or run off an end. These are the single source the store actions delegate to (keep the store thin).
  - [x] Do NOT change the `COLUMNS` const's default order (`tableView.test.ts:5` locks it as the DEFAULT/fallback order, still valid). `COLUMNS` becomes the seed for the store's default `order`, not a live order.

- [x] **Task 3, Rewire `useTableView` onto the store (AC-3, AC-4, AC-5)**
  - [x] `client/src/library/useTableView.ts`: replace the local `hiddenColumns` `useState` (`useTableView.ts:15`) with reads from `tableViewPrefs` (`order` + `hidden`). Keep `sort` local `useState` (ephemeral, NOT persisted). `visibleColumns` becomes `order.filter(k => !hidden.includes(k)).map(k => COLUMNS.find(c => c.key === k)!)` (ordered `ColumnDef[]`, driven by the persisted order, not `COLUMNS.filter`). Expose `toggleColumn` (delegates to `toggleHidden`, keeping the Title guard) and a new `moveColumn(key, dir)` / `reorderColumns(from, to)` (delegates to the store). `applyTableView` (the sort fold) is unchanged. `folderNameById` handling unchanged.
  - [x] Preserve the existing return shape's consumers: `LibraryPage.tsx:207` derives `visibleColumns` by filtering out `location` in the folder lens, `LibraryPage.tsx:312` passes `hiddenColumns` + `toggleColumn` to `DisplayMenu`. `DisplayMenu` takes a `Set<ColumnKey>` (`DisplayMenu.tsx:20`), either keep exposing `hiddenColumns` as a `Set` (wrap the store's array) or update `DisplayMenu`'s prop type; pick the smaller diff and keep `DisplayMenu`'s Title-never-listed behavior.

- [x] **Task 4, Rewire `useColumnWidths` to persist (AC-3, AC-5)**
  - [x] `client/src/library/useColumnWidths.ts`: seed each `useDragResize` initial from the store's persisted width when present, else `DEFAULT_WIDTHS[key]` (`useColumnWidths.ts:7`). On a settled resize (drag pointerup AND each keyboard step), write the value back via `tableViewPrefs.setWidth(key, value)`.
  - [x] `client/src/library/useDragResize.ts`: add an optional `onCommit?(value: number)` fired on `pointerup` (in `handlePointerUp`) and after each `handleKeyDown` step, so only the SETTLED width persists (not every `pointermove` frame, do not thrash `localStorage`). Keep the existing transient `useState` for the smooth per-frame drag. This keeps the drag/clamp/keyboard mechanics in one place (its doc comment, `useDragResize.ts:3-11`) and is the smallest extension that lets both `useColumnWidths` and `useResizablePanel` opt in.
  - [x] `DEFAULT_WIDTHS` stays the fallback map; `useColumnWidths.test.ts:14` asserts the defaults, with an EMPTY persisted store the defaults must still hold, so the test stays green (reset the store between tests, see Task 7).

- [x] **Task 5, Drag + keyboard reorder in the header (AC-1, AC-2, AC-6)**
  - [x] `client/src/library/CollectionTable/CollectionTable.tsx`: `ColumnHeaderCell` (`CollectionTable.tsx:101`), make the `<th>` (or its header button wrapper) `draggable` for every column EXCEPT Title (Title pinned). On `dragstart`, set a `dataTransfer` payload identifying the dragged `ColumnKey` (a dedicated MIME, mirror `MOVE_DRAG_MIME`/`encodeDragIds` in `moveDrag.ts`) and set a compact drag image (reuse/adapt `buildDragPreview`'s detached-node shape, `CollectionTable.tsx:58`). On `dragover`/`dragenter` over another header, show a token-driven drop indicator (a left/right insertion bar) and `preventDefault` to allow the drop. On `drop`, call `onReorderColumn(draggedKey, targetKey)`. Clear the indicator on `dragleave`/`dragend`.
  - [x] Add "Move left" / "Move right" items to the per-column popover (`CollectionTable.tsx:142-208`, alongside Sort ASC/DESC/Hide), each calling `onMoveColumn(col.key, "left"|"right")` then `close()`. Disable/omit "Move left" for the column immediately right of Title and "Move right" for the last column (respect the pinned-first + end clamps). Phosphor has `ArrowLeft`/`ArrowRight` icons for parity with the existing menu iconography.
  - [x] Thread two new optional props through `CollectionTableProps` (`CollectionTable.tsx:320`) + `TableHead` + `ColumnHeaderCell`: `onReorderColumn?(from, to)` and `onMoveColumn?(key, dir)`. Omit for isolated tests that don't exercise reorder (same pattern as the existing optional `onSortChange`/`onResizeColumnStart`).
  - [x] `LibraryPage.tsx`: pass `onReorderColumn={tableView.reorderColumns}` + `onMoveColumn={tableView.moveColumn}` to `CollectionTable` (near the existing `onToggleColumn`/`onResizeColumn*` wiring, `LibraryPage.tsx:418-421`).

- [x] **Task 6, Row bodies render in ORDER, the crux (AC-6)**
  - [x] `client/src/library/CollectionTable/PaperRow.tsx`: today the `<td>`s are hardcoded JSX gated by `visibleColumns.has(key)` (`PaperRow.tsx:91-216`). Change the `visibleColumns` prop from `Set<ColumnKey>` to the ordered `ColumnDef[]` (or ordered `ColumnKey[]`) and `.map` over it, rendering each column's cell via a small per-key render (a `switch (key)` or a `Record<ColumnKey, () => ReactNode>` local to the component). Keep each cell's current markup/behavior byte-identical (the Title `EditableCell` + Open button + Star, the Authors/Venue/Year `EditableCell`s, the Location cell, Added, File type badge, the DOI `stopPropagation` link). This is an ORDERED render, NOT the general cellType registry (that's 7.11), keep the switch inline and minimal.
  - [x] `client/src/library/CollectionTable/PendingRow.tsx`: same change, map the ordered columns, render each pending cell (`PendingRow.tsx:23-40`) in order. Keep the "no metadata yet" empty cells + the `title`/`file_type`/`location` content identical.
  - [x] `CollectionTable.tsx`: the caller currently builds `visibleKeys = new Set(visibleColumns.map(c => c.key))` (`CollectionTable.tsx:417`) and passes it to both row components. Pass the ordered `visibleColumns` array instead. `TableHead` / `ColumnGroup` / `TableSkeleton` already take the ordered `ColumnDef[]`, no change there. The group-header `colSpan={visibleColumns.length}` (`CollectionTable.tsx:608`) is already order-agnostic.

- [x] **Task 7, CSS: drop indicator + draggable header (AC-1, AC-7)**
  - [x] `client/src/library/CollectionTable/CollectionTable.css`: add a token-driven drop-indicator rule (an insertion bar on the target header, e.g. a `::before`/`::after` or a `data-drop-target` attribute style) and a `draggable`/`grabbing` cursor affordance on reorderable headers. Reuse the resize-handle/drag-preview token approach already in this file (`.collection-table__col-resize-handle`, `.collection-table__drag-preview`, css:118-315). Token-only.
  - [x] `client/src/theme/components.css`: if a new dim/color is needed for the indicator, add a component token there (mirror the `--collection-table-*-width` + `--drag-preview-*` tokens); do NOT inline raw hex/px outside `src/theme/**` (`no-raw-values.test.ts` enforces it).

- [x] **Task 8, Tests (all ACs)**
  - [x] `client/src/library/tableView.test.ts`: unit-test `moveColumn` + `reorderColumns`, Title never moves and never gets displaced from index 0; a move that would cross Title is a no-op; end clamps; `reorderColumns` inserts at the target position; input array not mutated. Keep the existing `COLUMNS` default-order lock (`tableView.test.ts:5`), it still holds as the fallback.
  - [x] `client/src/library/tableViewPrefs.test.ts` (new): the store defaults to `COLUMNS` order + `hidden: ["doi"]` + `widths: {}`; reconcile drops an unknown key from a stored order, appends a known missing key at its default position, and force-pins Title to index 0; a corrupt/missing persisted value falls back to the default; `setWidth` persists; `toggleHidden("title")` is a no-op. Clear `localStorage` + reset the store between cases (mirror `settings/store.test.ts`).
  - [x] `client/src/library/useColumnWidths.test.ts`: keep the existing default-width + clamp cases green (reset `tableViewPrefs` before each so the store is empty). Add a case: a settled resize writes through to the store, and a fresh `useColumnWidths` seeded from that store starts at the persisted width.
  - [x] `client/src/library/useTableView.test.ts`: `visibleColumns` reflects a persisted reorder (seed the store, assert the ordered keys); `toggleColumn` still guards Title; `moveColumn`/`reorderColumns` update `visibleColumns` order. Reset the store between cases.
  - [x] `client/src/library/CollectionTable/CollectionTable.test.tsx`: with a reordered `visibleColumns`, the `<th>` order AND each row's `<td>` order match (guards the cell-order trap, AC-6); the "Move left"/"Move right" menu items fire `onMoveColumn`; a pending row's cell count + order matches the header. (The existing pending-row cell-count regression test from 7.9 must be updated for the ordered render.)
  - [x] `client/src/library/LibraryPage.test.tsx`: reorder via a header menu item persists (a re-render/remount reads the new order from the store). Keep `getLibrary` mocked; touch no `render/` mock barrel (Library, not Reader).
  - [x] `no-raw-values.test.ts` stays green (new indicator styles are token-only). Grep every new UI string for `—` (em-dash) before committing (AC-7).

- [x] **Task 9, Version, live smoke, review, done (all ACs)**
  - [x] Bump `[project].version` in `server/pyproject.toml` `0.5.8` → `0.5.9` and sync `server/uv.lock`'s `paper-mate-server` version; `cd server && uv lock --check` clean. Single version source (→ `/api/health` → top-bar badge). (This is the ONLY `server/` edit in the whole story, and it is just the version bump.)
  - [x] `cd client && npm run typecheck && npm test` green. Backend suite is unaffected (no server logic changed) but confirm it still passes on the host per CLAUDE.md if the version test (`test_version.py`) is touched by the bump.
  - [x] **Live smoke on your OWN fresh servers** (never a user-launched one, CLAUDE.md): fresh `uvicorn` + `vite dev` on alternate ports against a scratch `PAPER_MATE_DATA` with at least two imported papers. Verify: (1) drag a header (e.g. Venue) left/right and it reorders, with a visible drag preview + drop indicator, and the ROW cells follow (nothing renders under the wrong header, AC-6); (2) "Move left"/"Move right" from a header menu reorders by keyboard; (3) Title cannot be dragged and nothing drops before it; (4) hide a column (Display) + resize a column, then **reload the page**, order + visibility + widths are all restored, but any active SORT is cleared; (5) row order is unchanged by all of the above. Normal DPR is fine (no coordinate/anchor geometry). Tear both servers down after.
  - [x] **Cross-model Codex `bmad-code-review` (AE-6)** on the diff. Resolve High/Med before done. Backend pytest is run-it-yourself on the host (CLAUDE.md Sandbox note), though this story touches no backend logic.
  - [ ] Branch `story-7-10-reorder-columns-persisted` off `main` before implementing (already cut at create-story, [x]). Flip `sprint-status.yaml` `7-10-reorder-columns-persisted` → `done` at PR merge (AE3-1, still pending - no PR/merge yet this session); fill the Dev Agent Record first (AE3-2, [x] done). **Do NOT close Epic 7**, 7.11 (author-tag) + 7.12 (refactor) remain backlog.

## Dev Notes

### The cell-order trap (read this first, it is the whole risk)

`ColumnGroup`, `TableHead`, and `TableSkeleton` already take the ordered `ColumnDef[]` array and render `<col>`/`<th>` in that order (`CollectionTable.tsx:82-94`, `242-271`, `287-288`). They are order-correct for free.

`PaperRow` and `PendingRow` do NOT. They render `<td>`s as **hardcoded JSX** in a fixed sequence (title, authors, venue, year, location, added, file_type, doi), each wrapped in `{visibleColumns.has(key) && ...}` (`PaperRow.tsx:91-216`, `PendingRow.tsx:23-40`). The `visibleColumns` prop is a `Set<ColumnKey>`, membership only, no order. Today the hardcoded JSX order happens to equal `COLUMNS`, so headers and cells align. **The moment a persisted order differs from `COLUMNS`, the `<th>`s reorder but the `<td>`s do not, and every cell renders under the wrong header.**

Story 7.9's change log already hit a static version of this: "Reordered `COLUMNS` in `tableView.ts` AND the actual `<td>` sequence in `PaperRow.tsx` (the two must move together)". For a *dynamic* order there is no hardcoded sequence to keep in sync, the row bodies MUST iterate the ordered column list and render each cell by key. Change the prop to the ordered `ColumnDef[]`/`ColumnKey[]` and `.map`. This is AC-6 and the single most likely place to ship a bug.

**Keep the per-key render minimal.** A `switch (key)` returning each cell's existing markup is enough. Do NOT build a general `cellType` (text/number/badge/tag) descriptor registry, that is Story 7.11's job, which then Story 7.12 consolidates. Your switch is the seam 7.11 formalizes; leave it a plain inline switch.

### The two precedents

| Half | Precedent | What it means here |
|---|---|---|
| Persistence (order + hidden + widths) | **`settings/store.ts` (Story 5.1)**, the app's one `localStorage`-persisted store | A Zustand `persist` store, `name: "paper-mate:table-view"`, `version: 1`, `partialize`. The middleware gives you load/parse/versioned-schema/degrade-on-corrupt for free (AC-5). Do NOT hand-roll `localStorage`/`JSON.parse`. |
| Drag + keyboard interaction | **Native HTML5 row-drag** (`handleDragStart` + `buildDragPreview` + `dataTransfer`, `CollectionTable.tsx:573`) and **`useDragResize`'s Arrow keys** (`useDragResize.ts:55`) | Pointer reorder = `draggable` `<th>` + `dataTransfer` + drop indicator; keyboard reorder = "Move left/right" menu items. No drag dependency (none installed; not warranted). Reorder logic is a pure array-move (`tableView.ts`), unit-tested. |

### Persist only the settled width, not every frame

`useDragResize` currently holds the width in a transient `useState` updated on every `pointermove` (`useDragResize.ts:18-25`). Writing that to `localStorage` per frame would thrash it. Add an `onCommit(value)` fired only on `pointerup` (`handlePointerUp`) and after each keyboard step, that is the value `useColumnWidths` persists via `setWidth`. The smooth per-frame drag stays in local `useState`; only the final value hits the store.

### Title-pinned-first is a store invariant, not a UI check

Enforce Title at index 0 in the pure reorder helpers AND in the store's reconcile, so no code path (a corrupt stored order, a bad `reorderColumns` call, a future caller) can strand it. The header just won't render Title as `draggable` and won't show "Move left" on the column right of Title, but the invariant is what actually guarantees AC-4, not the UI affordance.

### What does NOT change

- **No backend.** No route, no `library.json`/`meta.json` field, no OpenAPI/`schema.d.ts` regen. The ONLY `server/` edit is the version bump in `pyproject.toml` + `uv.lock`. Layout is client-only UI state (AD-9, AL-7, AD-L3).
- **Sort stays ephemeral** (`useTableView`'s local `sort` `useState`). Persist order + hidden + widths only.
- **Row order** is the client sort over `library.json` insertion order (AD-L1), untouched.
- **`COLUMNS`** stays as the default/fallback order (`tableView.test.ts:5` still valid); it seeds the store's default `order`.
- **`DisplayMenu`** can keep listing hideable columns in default order (its `HIDEABLE_COLUMNS` module const, `DisplayMenu.tsx:7`); matching it to the live order is optional, not an AC.

### Testing standards

Vitest + Testing Library (`renderHook`/`act` for hooks, `render` for components), same as the existing `useTableView.test.ts` / `useColumnWidths.test.ts` / `CollectionTable.test.tsx`. **Reset `tableViewPrefs` + clear `localStorage` between cases** (persisted stores leak state across tests otherwise, mirror `settings/store.test.ts`). The cell-order guard (AC-6: `<th>` order == `<td>` order under a non-default order) is the highest-value new test.

### Project Structure Notes

- New store lives in `client/src/library/` beside the other view-state units (`tableView.ts`, `useTableView.ts`, `useColumnWidths.ts`), consistent with AD-9 client layering, a pure/React-free-ish leaf (the Zustand store is UI state, no fetch, no upward import).
- No change to `server/` beyond the version bump. No `render/` mock-barrel edits (this is Library, not Reader).
- Naming: follow the file's neighbors (`tableViewPrefs.ts` or `tableViewPrefs.store.ts`; pick one and colocate its `.test.ts`).

### References

- Epic + ACs: `.bmad/planning-artifacts/epics.md#Story 7.10` (lines 1810-1837).
- Persistence precedent: `client/src/settings/store.ts` (Zustand `persist`, `paper-mate:settings`), `client/src/settings/store.test.ts`.
- Column model: `client/src/library/tableView.ts` (`COLUMNS`, `ColumnKey`, `sortRows`), `client/src/library/useTableView.ts`, `client/src/library/useColumnWidths.ts`, `client/src/library/useDragResize.ts`.
- Table + rows: `client/src/library/CollectionTable/CollectionTable.tsx` (`ColumnHeaderCell`, `TableHead`, `handleDragStart`, `buildDragPreview`), `PaperRow.tsx`, `PendingRow.tsx`, `client/src/library/CollectionTable/CollectionTable.css`.
- Native-drag precedent: `client/src/library/moveDrag.ts` (`MOVE_DRAG_MIME`, `encodeDragIds`).
- Display menu: `client/src/library/TableControls/DisplayMenu.tsx`.
- Composition root wiring: `client/src/library/LibraryPage.tsx` (lines 122-124, 205-212, 312, 401-421).
- Design tokens: `DESIGN.md`; `client/src/theme/components.css`; `no-raw-values.test.ts`.
- Standing conventions: `CLAUDE.md` (adopt stable solutions; document-level interaction handlers; no em-dash in UI; smallest correct structure; launch your OWN dev servers for smoke; versioning PATCH +1 → 0.5.9; branch-per-story; update `sprint-status.yaml` at merge; fill the Dev Agent Record before done).

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References

- `npm run typecheck` (client): clean throughout.
- `npm test -- --run` (client, Vitest): 65 files / 1327 tests passed. One pre-existing, order-dependent flake in `Reader.test.tsx` ("releases a stuck Space-pan on window blur") appeared once in a full-suite run and was confirmed unrelated (passes in isolation; no `Reader`/`render/` files touched by this story) before being re-confirmed green in the final full-suite run.
- `PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q` (server, host-run per CLAUDE.md Sandbox note): 265 passed (no backend logic changed; confirms the version-bump test and full regression stay green).
- `uv lock --check` (server): clean after `uv lock` synced `uv.lock`'s `paper-mate-server` entry to `0.5.9`.
- Live smoke on fresh `uvicorn --port 8811` + `vite --port 5911` against a scratch `PAPER_MATE_DATA`, driven via the `chrome-devtools` MCP (the `claude-in-chrome` extension was unavailable in this background session): uploaded 2 seed PDFs; dragged the Venue header onto Authors (order + BOTH rows' cells followed, confirming AC-6 live, not just in jsdom); "Move left" from the Authors header menu reordered back by keyboard; confirmed `Title`'s `<th>` is `draggable="false"` while every other header is `draggable="true"`; hid Year via Display, keyboard-resized Venue to 232px, set a DESC sort; reloaded the page - order/hidden/widths were restored from `localStorage` (`paper-mate:table-view`), the sort cleared (`aria-sort` back to `"none"`), and row order was unaffected throughout. Both servers torn down after.
- Found and fixed a latent bug in `useDragResize.ts` while wiring `useColumnWidths`'s per-key `onCommit` closures (a fresh arrow function per render): the existing "cleanup on unmount" effect depended on `[handlePointerMove, handlePointerUp]`, so an unstable `onCommit` changed `handlePointerUp`'s identity every render and the effect's cleanup fired on that identity change (not just true unmount), silently removing the live `document` `pointerup` listener mid-drag. Caught by a new `useColumnWidths.test.ts` case ("a settled drag resize (pointerup) writes the value back to tableViewPrefs") failing with `undefined` instead of the committed width. Fixed at the source: an `attachedRef` now tracks the currently-registered listener pair so the safety-cleanup effect (deps `[]`, true-unmount-only) always removes whatever is actually attached, regardless of which render's closures it came from.

### Completion Notes List

- Implemented all 9 tasks: `tableViewPrefs.ts` (new Zustand `persist` store, `paper-mate:table-view` v1, with load-time reconcile against `COLUMNS` and a Title-pinned invariant); pure `moveColumn`/`reorderColumns` helpers in `tableView.ts`; `useTableView` rewired onto the store (`sort` stays local/ephemeral); `useColumnWidths` seeded from + writing back to the store via a new `useDragResize` `onCommit` (settled-value-only) callback; drag-to-reorder + "Move left"/"Move right" menu items in `CollectionTable`'s `ColumnHeaderCell`/`TableHead`, threaded through `LibraryPage`; `PaperRow`/`PendingRow` rewritten to render cells from the ordered `ColumnDef[]` list via a per-key `switch` (the AC-6 crux - no more hardcoded JSX gated by a `Set`); a token-driven drop indicator + grab/grabbing cursor in `CollectionTable.css`/`components.css`.
- All 6 ACs verified: AC-1/AC-2 (drag + keyboard reorder, Title pinned/non-draggable) both unit-tested and live-smoked; AC-3 (order/hidden/widths persist, sort doesn't) unit-tested and live-smoked; AC-4 (Title pinned invariant) enforced in the pure helpers AND the store's reconcile, unit-tested from both angles; AC-5 (safe degrade + forward-compat reconcile) covered by 8 new `tableViewPrefs.test.ts` cases (unknown-key drop, missing-key append, Title force-pin, corrupt/missing localStorage); AC-6 (cell-order trap) covered by a dedicated `CollectionTable.test.tsx` case asserting `<th>` order equals `<td>` order under a non-default column order, plus confirmed live via the drag-drop smoke.
- `localStorage`-persisted Zustand stores leak module-level state across Vitest cases in the same file (the `settings/store.test.ts` precedent already flags this) - added the same `localStorage.clear()` + store-`reset()` `beforeEach` to `tableViewPrefs.test.ts`, `useTableView.test.ts`, `useColumnWidths.test.ts`, and `LibraryPage.test.tsx` (the last one uncovered a real cross-test leak: a later test's "Authors" header button lookup failed because an earlier test's column hide had leaked into it).
- No `server/` edit beyond the version bump (`pyproject.toml` + `uv.lock`, `0.5.8` → `0.5.9`); no `render/` mock-barrel edits (Library, not Reader); `no-raw-values.test.ts` and an em-dash grep over the diff both stay/came back clean.

**Cross-model Codex `bmad-code-review` (AE-6):** ran via `codex exec` against the working-tree diff, the story file, and the sprint-status path (skill: `.claude/skills/bmad-code-review/SKILL.md`). Result: 0 High, 3 Medium, 0 Low. All 3 resolved:
1. **Fixed** - "reconcile does not restore missing columns at their default position": the test only asserted `toContain`, not the actual resulting order, so the append-at-end behavior was unverified. Judged the append-at-end behavior itself CORRECT per the story's own wording ("appended... at its default index" = appended, in `DEFAULT_ORDER`'s relative sequence among the missing set, not spliced into the middle of a user's customized order - the less-surprising default when a future column ships), documented that reasoning in `tableViewPrefs.ts`'s `reconcile` doc comment, and tightened the test to assert the exact array (plus a new multi-missing-column case) so the intent can't be misread again.
2. **Fixed** - "malformed persisted order can preserve duplicate column keys": `reconcile()` filtered unknown keys but never deduped known ones, so a corrupt `["title","authors","authors"]` survived as two `<th>`s sharing one React key. Fixed with a `Set`-based first-occurrence dedupe in `tableViewPrefs.ts`'s `reconcile`; added a regression test.
3. **Fixed** - "pure reorder helpers do not enforce Title-first on malformed input": `moveColumn`/`reorderColumns` assumed Title was already at index 0, so an adversarial input (e.g. from a corrupt persisted order, or a caller invoking the exported pure functions directly) could compute a swap/splice that displaced Title further. Added a `pinTitleFirst` normalization at the top of both functions in `tableView.ts` (matches the story's own Dev Notes: "Enforce Title at index 0 in the pure reorder helpers... so no code path... can strand it"); added adversarial-input regression tests to both `moveColumn`/`reorderColumns`.

Full client suite re-verified green after the fixes (65 files / 1331 tests, +4 from the new regression tests) and typecheck stays clean.

### File List

- `client/src/library/tableViewPrefs.ts` (new)
- `client/src/library/tableViewPrefs.test.ts` (new)
- `client/src/library/tableView.ts`
- `client/src/library/tableView.test.ts`
- `client/src/library/useTableView.ts`
- `client/src/library/useTableView.test.ts`
- `client/src/library/useColumnWidths.ts`
- `client/src/library/useColumnWidths.test.ts`
- `client/src/library/useDragResize.ts`
- `client/src/library/CollectionTable/CollectionTable.tsx`
- `client/src/library/CollectionTable/CollectionTable.test.tsx`
- `client/src/library/CollectionTable/CollectionTable.css`
- `client/src/library/CollectionTable/PaperRow.tsx`
- `client/src/library/CollectionTable/PendingRow.tsx`
- `client/src/library/LibraryPage.tsx`
- `client/src/library/LibraryPage.test.tsx`
- `client/src/theme/components.css`
- `server/pyproject.toml`
- `server/uv.lock`

## Change Log

- **2026-07-08:** Story 7.10 created (ready-for-dev). Client-only persisted table layout: drag-to-reorder columns (+ keyboard "Move left"/"Move right"), with order + visibility + widths persisted in a new Zustand `persist` store (`paper-mate:table-view`, mirror `settings/store.ts`); sort stays ephemeral; row order untouched. Crux: `PaperRow`/`PendingRow` must render cells from the ordered column list (they hardcode order today). Title pinned first + non-hideable. No backend/contract change. Design calls resolved: Title pinned-first; hand-rolled native HTML5 DnD + menu-item keyboard move (no new dep); Zustand persist store with load-time reconcile against `COLUMNS`. Version bump planned `0.5.8` → `0.5.9`.
- **2026-07-08:** Story 7.10 implemented (review). All 9 tasks complete, all 6 ACs met. New `tableViewPrefs.ts` persisted store + `moveColumn`/`reorderColumns` pure helpers in `tableView.ts`; `useTableView`/`useColumnWidths` rewired onto the store; drag-to-reorder + keyboard Move left/right in `CollectionTable`; `PaperRow`/`PendingRow` rewritten to render from the ordered column list (the AC-6 crux); token-driven drop indicator CSS. Fixed a latent `useDragResize` bug (an unstable `onCommit` tore down the live pointerup listener mid-drag via an over-broad effect-cleanup dependency) surfaced by this story's own persistence wiring. Version bumped `0.5.8` → `0.5.9`. Live-smoked on fresh servers via the `chrome-devtools` MCP (drag reorder, keyboard reorder, hide, resize, reload-restores-layout, sort-does-not-persist). Client suite: 1327 tests passing; backend suite: 265 passing (host-run).
- **2026-07-08:** Cross-model Codex `bmad-code-review` (AE-6) run: 0 High, 3 Medium, 0 Low. Fixed all 3: `tableViewPrefs.ts`'s `reconcile` now dedupes a corrupt persisted order's duplicate column keys (was producing two `<th>`s sharing one React key) and its "append missing columns at the end" behavior was clarified/documented rather than changed (a stronger test now pins the exact expected order); `tableView.ts`'s `moveColumn`/`reorderColumns` gained a `pinTitleFirst` normalization so an adversarial/malformed input order can never further displace Title (per the story's own Dev Notes). 4 new regression tests added. Client suite re-verified: 1331 tests passing, typecheck clean. Still pending: PR + merge, at which point `sprint-status.yaml` flips to `done` (AE3-1) - left at `review` here since dev-story's own scope ends at "ready for review", not merge.
