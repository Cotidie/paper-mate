---
baseline_commit: 2855a3c
---

# Story 7.4: Display, Sort, and Filter controls

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a reader,
I want to hide columns, sort by any column, and filter rows,
so that I can find a paper in a large collection in seconds.

## ⚠️ Read this first: this is a CLIENT-ONLY view-state story

Sort, filter, and column visibility are **client view-state, never persisted and never a route** (AD-L3: "Folder selection, sort/filter, and Trash are view-state filters inside the Library route, not routes"). The whole story lives in `client/src/library/`. There is **no backend, no `/api` surface, and no contract change**: if you touch a `.py` file, regenerate `server/openapi.json`, or regenerate `client/src/api/schema.d.ts` for this story, you are off track.

The one thing already built that you MUST NOT regress: **Story 7.3's Shift+click range selection is index-based over the currently-rendered `rows` array**, so it already "follows the client sort order once 7.4 lands" (7.3 Dev Notes said so explicitly). Sorting/filtering must happen by transforming the `rows` array *upstream in `LibraryPage`* so the SAME array the table paints is the one 7.3's range math indexes. Do not sort inside `CollectionTable`.

## Acceptance Criteria

1. **(Display) Toggle column visibility, no frame reflow.** Given the table-header area, when I open the Display control and toggle a column, then that column's `<col>` / `<th>` / `<td>` are omitted (or restored) and the surrounding FRAME (toolbar, folder panel, main scroll region, page floor) does not reflow. The **Title column is not hideable** (it carries the row's Open button + inline-edit affordance; hiding it would strand the only way to open/edit a paper) — the Display control offers Authors, Added, and File type. (LFR-4, L-UX-DR3)

2. **(Sort) Order by any column, asc/desc, with an active-column indicator.** Given the Sort control, when I choose a column and direction, then rows reorder by that column ascending or descending and a visible asc/desc indicator (caret) shows on the active column's header. Sort is **client view-state, not persisted** (reloading returns to the backend response `order`). Default (no sort chosen) renders the response `order` unchanged. (LFR-5, AL-3/AD-L3, L-UX-DR3)

3. **(Sort) Sort by the underlying value, not the formatted label.** Given a sort on Added, then rows order chronologically by the ISO `added` timestamp, NOT lexically by the "Jul 5, 2026" display string. Given a sort on Title or Authors, then rows order case-insensitively by the DISPLAYED value (Title uses its filename fallback when `title` is null); a null/empty value sorts last in ascending order. Given File type, then rows order by the type value. (LFR-5)

4. **(Filter) Narrow rows by a column value.** Given the Filter control, when I set a column and a value, then only rows whose that-column value matches (case-insensitive substring on the displayed text) remain; clearing the value removes the filter and all rows return. The count line reflects the filtered set ("N files in ..."). One active column filter at a time is sufficient (the AC is "a column value," singular). (LFR-6, L-UX-DR3)

5. **(Filter clears selection; sort does not.** Given a multi/range selection, when I change the column filter, then the selection resets (same rule as a folder switch — a selection from a prior view must not silently ride into a Move the user can no longer see, since a filtered-out row keeps its `doc_id` in `selectedIds` but is no longer rendered). Given a sort change, then the selection is PRESERVED (every row is still visible, only reordered) and 7.3's anchor re-ranges over the new order from the same pivot doc. (L-UX-DR2 reset, protects AL-7 batch-move correctness)

6. **(No reflow on open.** Given any of the three controls, when I open it, then its popover overlays (portaled, `position: fixed`, like `MoveMenu`) and does NOT push the table or the page floor down. (L-UX-DR3 "opening any of them never reflows the table or the page floor")

7. **(Scale) No visible stall.** Given hundreds of papers, when I sort or filter, then the result appears without a visible multi-second freeze (LNFR-4). Plain array `sort`/`filter` over the display-cache rows is comfortably within this; do not add virtualization for it.

8. **(A11y) Controls are keyboard-operable with visible focus.** Given the three controls and their menu items, then each is a real focusable `<button>`/`<input>`, keyboard-operable, with a visible 2px `{colors.ink}` focus ring, and each popover is Esc-dismissable returning focus to its trigger (mirror `MoveMenu`). (L-UX-DR12)

9. **(Style + copy.** Given the controls, then they are `{component.button-secondary}`-styled (reuse the shipped `.toolbar-button` chrome — the Library's de-facto button-secondary, a bordered `{colors.surface-card}` chip), token-driven (no inline hex/px; `src/no-raw-values.test.ts` stays green), and no UI string (labels, column names, placeholders, aria-labels) contains an em-dash. (L-UX-DR3, L-UX-DR13, CLAUDE.md)

## Scope boundary (read first, prevents scope creep)

**In scope (all client-only, `client/src/library/`, no backend/contract change):**

- Three toolbar controls: **Display** (column-visibility checklist), **Sort** (column + direction, with a header caret indicator), **Filter** (column + value).
- Promoting the flat `COLUMNS = string[]` into a small column-descriptor model (`{ key, label, hideable, sortable }`) so `ColumnGroup` / `TableHead` / `PaperRow` derive from the visible columns and the header can paint a sort caret.
- Pure, unit-tested transform functions for sort + column-filter (a new `tableView.ts` leaf, mirroring the existing `folderFilter.ts`).
- The client-only view-state (`hiddenColumns`, `sort`, `filter`) and its wiring into `LibraryPage`'s existing `papers → filterPapers → rows` pipeline, plus the filter-clears-selection rule (AC-5).
- Unit tests + a live smoke (own fresh servers). Version PATCH bump `0.5.3` → `0.5.4` at story done.

**Out of scope (do NOT build):**

- **Any backend / `.py` / `/api` / contract (`schema.d.ts`, `docs/API.md`) change.** Sort/filter/display are client view-state, NOT persisted (AD-L3). This is the #1 way to go off track.
- **Persisting sort/filter/hidden-columns** across reload (explicitly not persisted — AC-2, AD-L3). No `localStorage`, no `library.json` write.
- **Per-row checkboxes / a select-all header** — superseded in 7.2/7.3 by Ctrl/Cmd+click + Shift+click; do not reintroduce.
- **Keyboard row-selection (Shift+Arrow / roving tabindex rows)** — still deferred (7.3 AC-8), flag for the human if it comes up.
- **Trash lens / batch delete** → Story 7.5.
- **Note authoring / a new file type** → Story 7.6 (the File type column already renders the PDF/Note badge from `file_type`; you may sort/filter on it, but do not add note creation).
- **Multi-column simultaneous sort, or stacked multi-column filters.** One active sort + one active column filter is the smallest correct structure that satisfies the ACs; note any richer model as a future, do not build it.
- **Column reordering / resizing / a header-drag** — not asked; out.
- **Virtualization / windowing** for the table — LNFR-4 is met by plain array ops on the display cache; do not add it.

## Tasks / Subtasks

- [x] **Task 1 — Column-descriptor model + pure transforms in a new `tableView.ts` leaf (AC: 1, 2, 3, 4)**
  - [x] Create `client/src/library/tableView.ts` (mirror `folderFilter.ts`: a pure, dependency-light leaf module with its own `.test.ts`). Export:
    - `type ColumnKey = "title" | "authors" | "added" | "file_type"`.
    - `interface ColumnDef { key: ColumnKey; label: string; hideable: boolean; sortable: boolean }` and `const COLUMNS: ColumnDef[]` = Title (`hideable:false`), Authors, Added, File type (each `hideable:true, sortable:true`). This REPLACES the `COLUMNS` string array currently in `CollectionTable.tsx` (move it here; `CollectionTable` imports it).
    - `type SortDirection = "asc" | "desc"`, `interface SortState { column: ColumnKey; direction: SortDirection }`, `interface ColumnFilter { column: ColumnKey; query: string }`.
    - `sortRows(rows: CollectionRow[], sort: SortState | null): CollectionRow[]` — returns rows unchanged when `sort` is null; otherwise a stable copy sorted by the column's UNDERLYING value: `added` by `Date(added).getTime()` (chronological, NOT the formatted string — AC-3), `title` by the displayed value (`row.title ?? stripPdfExtension(row.filename) ?? ""`, from `row.ts`), `authors` by `row.authors ?? ""`, `file_type` by the enum value; string compares case-insensitive via `localeCompare(..., undefined, { sensitivity: "base" })`; null/empty sorts last in `asc`. Do NOT mutate the input (`[...rows].sort`).
    - `applyColumnFilter(rows: CollectionRow[], filter: ColumnFilter | null): CollectionRow[]` — returns rows unchanged when `filter` is null or `filter.query.trim()` is empty; otherwise keeps rows whose displayed column text (Title→display fallback, Authors→`?? ""`, Added→`formatAdded(added)`, File type→`"PDF"`/`"Note"`) contains the query case-insensitively.
  - [x] Reuse `formatAdded`, `stripPdfExtension`, `seedFieldValue`/`currentFieldValue` from `client/src/library/row.ts` for the displayed-value derivations — do NOT re-implement the fallback logic (single source; `row.ts` already owns "displayed title/authors/date").

- [x] **Task 2 — View-state owner: a `useTableView` hook (AC: 2, 4, 5)**
  - [x] Add `client/src/library/useTableView.ts` (matches the `useFolders`/`useInlineEdit`/`useMovePapers` hook pattern already in the dir). It owns three pieces of client-only state — `hiddenColumns: Set<ColumnKey>` (Title can never enter it), `sort: SortState | null`, `filter: ColumnFilter | null` — and exposes setters plus a `visibleColumns` derivation. Keep it presentational/pure state; it does NOT fetch or persist.
  - [x] Expose the composed transform so `LibraryPage` applies it in one place: given the already-folder-filtered array, produce `applyColumnFilter` → `sortRows`. (Column visibility does NOT change the row array, only which cells render — pass `visibleColumns`/`hiddenColumns` + `sort` down to `CollectionTable`.)

- [x] **Task 3 — Wire the pipeline + count + selection-clear in `LibraryPage` (AC: 4, 5, 7)**
  - [x] In `LibraryPage.tsx`, extend the existing derivation. Today: `const visiblePapers = filterPapers(papers, selection)`. New: fold in the column filter + sort from `useTableView` so `visiblePapers` is the FINAL array handed to `CollectionTable` as `rows` (memoize with `useMemo` keyed on `papers`, `selection`, `filter`, `sort` for AC-7). The count line already reads `visiblePapers.length` — it will correctly reflect the filtered set with no extra change (sort does not change length).
  - [x] **Filter change clears the selection (AC-5):** when the column filter changes, call `setSelectedIds(new Set())` (same as `handleSelect` does on a folder switch). A `useEffect` keyed on the filter, or clearing inside the filter setter, are both fine — pick the one that keeps `LibraryPage` legible. Do NOT clear on a sort change or a column-hide (rows stay visible). 7.3's `anchorRef` reset already keys off `selectedIds` emptying, so clearing the set also drops the stale pivot for free.
  - [x] Place the three controls in the existing `library-toolbar__actions` div, reusing `.toolbar-button` chrome. Suggested order: `Display  Sort  Filter | Move  Add`. Do not restructure the toolbar row.

- [x] **Task 4 — Column-visibility + sort-indicator rendering in `CollectionTable` (AC: 1, 2, 6)**
  - [x] Accept new props on the non-loading branch: `visibleColumns` (or `hiddenColumns`) and `sort: SortState | null`. Drive `ColumnGroup` and `TableHead` from `COLUMNS.filter(c => visible)`; render each header's `<th>` with an asc/desc caret when it is the active `sort.column`. `TableSkeleton` should honor the same visible-column set so a load into a hidden-column view doesn't flash the hidden column.
  - [x] In `PaperRow`, gate each of the four `<td>`s (Title/Authors/Added/File type) on its column being visible. Keep each cell's existing semantics (Title = `EditableCell` + Open button; Authors = `EditableCell`; Added = `formatAdded`; File type = badge). Do NOT data-drive the cell bodies through a renderer map — 4 fixed semantic cells gated by a `visible` check is the smallest correct structure; a generic cell renderer is over-engineering here.
  - [x] **Guard the 7.3 selection interplay:** `rows` arrives already sorted/filtered from `LibraryPage`, so `handleRowClickCapture`'s `rows.findIndex(...)` range math is unchanged and automatically follows the visual order. Do not sort/filter inside `CollectionTable`. Verify the existing capture-phase Ctrl/Cmd/Shift branches still compile against the (unchanged) `rows` shape.

- [x] **Task 5 — The three control components (AC: 1, 2, 4, 6, 8, 9)**
  - [x] Build under `client/src/library/TableControls/` (scaffold-react colocation, as Stories 5.4/6.8 established): `DisplayMenu.tsx`, `SortMenu.tsx`, `FilterMenu.tsx`, a shared `TableControls.css`, and colocated `.test.tsx` files. Each is a `.toolbar-button` trigger + a portaled `position: fixed` popover.
  - [x] **Do not reinvent the popover dismiss/positioning** — `MoveMenu`/`AddMenu` already encode it (document-level `pointerdown` + `Escape` close, focus returns to the trigger, portal to `document.body`, `position: fixed` anchored off the trigger's `getBoundingClientRect()`, `aria-haspopup="menu"`/`aria-expanded`, the Escape-must-reach-document keydown carve-out). Factor that shared behavior into ONE small `usePopover` hook (or a `Popover` shell) used by the three new controls; homing `AddMenu`/`MoveMenu` on it too is a welcome dedupe but keep it bounded — the three controls are the deliverable, not a toolbar-wide rewrite.
  - [x] `DisplayMenu`: a checklist of the `hideable` columns (Title omitted or shown-locked), each a labelled checkbox toggling `hiddenColumns`.
  - [x] `SortMenu`: a list of the `sortable` columns; picking one sets `asc`; picking the active one toggles `desc`; a "Default order" item clears sort (`null`). Reflect the active column+direction in the menu.
  - [x] `FilterMenu`: a column picker + a `{component.text-input}` value field (reuse the `.collection-table__edit-input`-style token treatment or the DESIGN.md `text-input`); typing sets `{ column, query }`; empty/cleared query → `null`. Debounce is optional; a plain controlled input re-filtering per keystroke is within LNFR-4.
  - [x] Every label/placeholder/aria-label plain and em-dash-free (grep the new strings for `—` before committing).

- [x] **Task 6 — Tests (AC: 1, 2, 3, 4, 5, 6, 8)**
  - [x] `tableView.test.ts` (mirror `folderFilter.test.ts`): `sortRows` asc/desc per column incl. the Added-is-chronological-not-lexical case, null-title uses filename fallback, null/empty sorts last, input not mutated; `applyColumnFilter` case-insensitive substring per column, empty/whitespace query = passthrough, File type matches "PDF"/"Note".
  - [x] `CollectionTable.test.tsx` (extend): a hidden column omits its `<th>` and each row's `<td>`; the active sort column's `<th>` shows the asc vs desc indicator; the existing Ctrl/Cmd+click and Shift+click range tests STILL pass against a table that now also receives `visibleColumns`/`sort` (render them with defaults so old cases are unaffected).
  - [x] `LibraryPage.test.tsx` (extend, mirror the existing folder-filter + Move regressions): choosing a sort reorders the rendered rows; setting a filter narrows the rows and updates the "N files in ..." count; changing the filter clears a prior selection (AC-5); a Shift+click range AFTER a sort selects the visually-contiguous run and toolbar Move moves that set (guards the 7.3-follows-sort contract). Keep `getLibrary`/`movePapers` mocked; touch no `render/` mock barrel (this is Library, not Reader).
  - [x] `no-raw-values.test.ts` must stay green after any new CSS. No backend test (no `.py` touched).

- [x] **Task 7 — Live smoke (own fresh servers) (AC: 1, 2, 4, 5, 6, 8)**
  - [x] Launch your OWN fresh `uvicorn` + `vite dev` on alternate ports against an isolated scratch `PAPER_MATE_DATA` (do NOT reuse a user-running server — CLAUDE.md). Seed several real sample PDFs from `fixtures/sample-pdfs/` (there are 8+: `0616.pdf`, `1903.03295v2.pdf`, `DeepAnT_...pdf`, `Microsoft COCO...pdf`, etc.) via the real `POST /api/docs` import path so Title/Authors/Added vary enough to sort and filter meaningfully. Tear both servers down after.
  - [x] Verify live: (a) hiding Authors/Added/File type omits the column and the folder panel + toolbar + page floor do NOT jump; (b) sort asc then desc on each sortable column reorders rows with the correct caret, and reload returns to response order (not persisted); (c) a filter narrows rows and the count updates, clearing it restores all; (d) opening each control's popover does not push the table/floor (portaled); (e) each control is keyboard-reachable (Tab) and Esc-dismissable; (f) **7.3 interplay:** after sorting, a plain-click + Shift+click selects the visually-contiguous run and toolbar Move moves the whole set (confirm via `GET /api/library`); changing the filter clears a live selection. Normal DPR is fine — this story adds no coordinate/anchor geometry, so no DPR>1 gate (unlike selection-geometry stories).

- [x] **Task 8 — Version + housekeeping**
  - [x] Bump `server/pyproject.toml` `[project].version` `0.5.3` → `0.5.4`. Check whether `server/uv.lock` records the project version and sync if so (7.3 found no field to sync — re-verify).
  - [x] No `docs/API.md` change (no `/api` surface change). No `schema.d.ts` regen.
  - [x] After dev-story, run the cross-model Codex `bmad-code-review` (AE-6) on the diff.

## Dev Notes

### The exact hook points (read the current code, do not re-architect)

The whole pipeline already exists; you are inserting two transforms and three controls, not rebuilding the table.

- **Row pipeline lives in `LibraryPage`.** `const visiblePapers = filterPapers(papers, selection)` then `<CollectionTable rows={visiblePapers} .../>`. Insert the column-filter + sort here so the FINAL array is what the table renders (and what 7.3 indexes). [Source: client/src/library/LibraryPage.tsx:116-129, 216-223]
- **The count line** already reads `{visiblePapers.length} files in {selectionLabel(...)}` — filtering narrows it for free; sort does not change length. [Source: client/src/library/LibraryPage.tsx:166-168]
- **The toolbar actions slot** is `<div className="library-toolbar__actions">` holding `MoveMenu` + `AddMenu`. Add the three controls here. [Source: client/src/library/LibraryPage.tsx:170-181]
- **Selection is lifted in `LibraryPage`** as `selectedIds` + `setSelectedIds`, already cleared to `new Set()` on a folder switch (`handleSelect`) and after a move (`handleMoveRequest`). Clear it the same way on a filter change (AC-5). [Source: client/src/library/LibraryPage.tsx:81-97]
- **`COLUMNS` is a flat `string[]`** in `CollectionTable.tsx` consumed by `ColumnGroup` (a `<col>` per column with a `col-*` width class), `TableHead` (a `<th>` per label), and `TableSkeleton`. Promote it to the `ColumnDef[]` model in `tableView.ts` and drive all three off the visible subset. The per-column CSS width classes (`collection-table__col-title|authors|added|file-type`) already exist. [Source: client/src/library/CollectionTable/CollectionTable.tsx:10, 45-90]
- **`PaperRow` renders 4 fixed semantic cells** (Title `EditableCell` + Open button; Authors `EditableCell`; Added `formatAdded`; File type badge). Gate each `<td>` on visibility; keep the bodies. [Source: client/src/library/CollectionTable/PaperRow.tsx:76-132]
- **7.3's range math** is `handleRowClickCapture`'s Shift branch: `rows.findIndex(r => r.doc_id === anchorRef.current)` … `rows.slice(start, end+1)`. It indexes the `rows` prop, so pre-sorting `rows` upstream makes the range follow visual order with zero change here. [Source: client/src/library/CollectionTable/CollectionTable.tsx:228-278]
- **Displayed-value helpers already exist** in `row.ts`: `formatAdded`, `stripPdfExtension`, `seedFieldValue`, `currentFieldValue`. Reuse them for sort/filter key derivation — do not duplicate the "null title → filename" fallback. [Source: client/src/library/row.ts:19-42]

### Reuse the shipped popover, don't reinvent it (CLAUDE.md: adopt stable solutions)

`MoveMenu.tsx` is the reference popover and encodes hard-won live-smoke fixes you must inherit, not rediscover:
- **Portal + `position: fixed` anchored off the trigger's `getBoundingClientRect()`** — a `position: absolute` popover inside a table cell got clicks routed to a sibling cell underneath (Chromium table stacking), and a `transform` on any ancestor re-bases `position: fixed`. A toolbar trigger avoids both, but the portal is the robust default. [Source: client/src/library/MoveMenu.tsx:7-82]
- **Document-level `pointerdown` + `Escape` dismiss, focus returns to the trigger on close**, `aria-haspopup="menu"` / `aria-expanded`, and the **Escape keydown carve-out** (`if (e.key !== "Escape") e.stopPropagation()`) so Escape reaches the document listener instead of being eaten on the button (a code-review fix). [Source: client/src/library/MoveMenu.tsx:64-107]
- `AddMenu` is the simpler inline-popover variant (no portal). [Source: client/src/library/AddMenu/AddMenu.tsx:30-88]

Factor this into one `usePopover` used by the three controls; do not paste it three more times.

### No-reflow discipline (AC-1, AC-6)

- **Opening a control** must not push layout: portal the popover to `document.body`, `position: fixed` (like `MoveMenu`), so the toolbar/table/floor stay put. An inline `{open && <div>...}` that expands in-flow (like `AddMenu`) would violate AC-6 for the wider Sort/Filter panels — prefer the portal.
- **Hiding a column** re-lays-out the table internally (it is `table-layout: fixed`, `width: 100%`, so remaining fixed-width `<col>`s keep their widths and the free space redistributes). That internal change is expected and fine; what must NOT move is the surrounding frame — and it won't, because the table sits in the stable `.library-main--table` scroll region. [Source: client/src/library/CollectionTable/CollectionTable.css:10-30, client/src/library/LibraryPage.css:101-110]

### Why the transforms are a pure leaf + a hook (structure)

- `tableView.ts` (pure functions, no React) mirrors `folderFilter.ts` and is trivially unit-testable and shared. Row order/visibility logic must not live inside a component. [Source: client/src/library/folderFilter.ts + folderFilter.test.ts]
- `useTableView` (state + setters) matches the dir's hook convention (`useFolders`, `useInlineEdit`, `useMovePapers`, `useCollection`) and keeps `LibraryPage` a thin composition root (its own doc comment says "Composition only"). [Source: client/src/library/LibraryPage.tsx:45-53]
- Sort/filter/hidden state is **client-only, ephemeral** (AD-L3) — three `useState` in a hook, never written to `library.json` or `localStorage`.

### Sort correctness traps (AC-3)

- **Added:** sort by `new Date(row.added).getTime()`, never by `formatAdded(row.added)` (the "Jul 5, 2026" string sorts lexically = wrong month order). This is the single most likely bug.
- **Title:** sort by the DISPLAYED title (`row.title ?? stripPdfExtension(row.filename ?? "")`), so an untitled/parse-failed row sorts by what the user sees, not by a raw null.
- **Stability + immutability:** `[...rows].sort(...)`; `Array.prototype.sort` is stable in modern engines, so equal keys keep response order. Never sort the prop in place.

### Divergence to record (don't silently drop an epic AC clause)

The epics.md Story 7.4 AC says "toggle the visibility of **any** column." This story makes **Title non-hideable** (AC-1) because Title is the only cell carrying the Open button and the inline-edit affordance; a hidden Title would leave no way to open or rename a paper without first un-hiding it. This is the smallest correct structure. If the human wants Title hideable, that needs a companion decision (e.g., move Open to a row-level affordance) and should be its own change — flag it in the PR description, same as 7.3 flagged its checkbox divergence.

### Testing standards

- Client only: `cd client && npm test` (Vitest) + `npm run typecheck`. Mirror `folderFilter.test.ts` for the pure transforms and the existing `CollectionTable.test.tsx` / `LibraryPage.test.tsx` selection + folder-filter cases for the integration.
- `no-raw-values.test.ts` (raw hex/px only allowed in `src/theme/**`) must stay green — new control CSS uses tokens only.
- No backend suite change (no `.py` touched). Do not regenerate the contract (`schema.d.ts`) or `docs/API.md`.
- Live smoke per Task 7 (own fresh servers, real sample PDFs, normal DPR — no DPR>1 gate, no coordinate geometry in this story).
- After dev-story, run the cross-model Codex `bmad-code-review` (AE-6) on the diff.

### Project Structure Notes

- **New (client):** `client/src/library/tableView.ts` (+ `tableView.test.ts`); `client/src/library/useTableView.ts`; `client/src/library/TableControls/` (`DisplayMenu.tsx`, `SortMenu.tsx`, `FilterMenu.tsx`, `TableControls.css`, colocated `.test.tsx`); optionally a shared `usePopover.ts`.
- **Modified (client):** `LibraryPage.tsx` (pipeline + controls + filter-clears-selection), `CollectionTable/CollectionTable.tsx` (column model from `tableView`, `visibleColumns`/`sort` props, header caret), `CollectionTable/PaperRow.tsx` (gate cells on visibility), `CollectionTable/CollectionTable.css` (caret indicator; any hidden-column tweak), their `.test.tsx` files.
- **Modified (version):** `server/pyproject.toml` (`0.5.3` → `0.5.4`); `server/uv.lock` only if it records the version.
- This story file lives in `.bmad/implementation-artifacts/epic-7/` (per-epic convention, same as 7.1/7.2/7.3).
- **Branch per story:** cut `story-7-4-display-sort-filter-controls` off `main` before implementing (CLAUDE.md). Update `sprint-status.yaml` to `done` at PR-merge time (AE3-1); fill the Dev Agent Record before flipping to `done` (AE3-2).

### References

- [Source: .bmad/planning-artifacts/epics.md#Story-7.4] — the epic ACs (LFR-4 Display, LFR-5 Sort asc/desc + active indicator, LFR-6 Filter, LNFR-4 no stall, L-UX-DR3, L-UX-DR12).
- [Source: .bmad/planning-artifacts/epics.md#Library-UX-Design-Requirements] — L-UX-DR3 (controls in the header area, button-secondary-styled, no reflow on open), L-UX-DR2, L-UX-DR12 (keyboard + 2px ink focus), L-UX-DR13 (no em-dash).
- [Source: .bmad/planning-artifacts/architecture/architecture-paper-mate-library-2026-07-04/ARCHITECTURE-SPINE.md#AD-L3] — sort/filter/Trash are Library **view-state, not routes**; paper table ordering is the client sort, **not persisted** (also AD-L1 line 70).
- [Source: .bmad/implementation-artifacts/epic-7/7-3-multi-select-batch-move.md] — the shipped selection mechanic: 7.3's range is **index-based over the rendered `rows`** and was explicitly designed to follow this story's sort; read its Dev Notes "Range must be index-based over `rows` (order-following, 7.4-safe)".
- [Source: client/src/library/LibraryPage.tsx:81-97,116-129,166-181,216-223] — selection state + clears, the `filterPapers` pipeline, the count line, the toolbar actions slot, the `CollectionTable` wiring.
- [Source: client/src/library/CollectionTable/CollectionTable.tsx:10,45-90,228-278,316-345] — `COLUMNS`, `ColumnGroup`/`TableHead`/`TableSkeleton`, the 7.3 capture-phase range math, the render.
- [Source: client/src/library/CollectionTable/PaperRow.tsx:66-133] — the 4 semantic cells to gate on visibility.
- [Source: client/src/library/row.ts:19-42] — `formatAdded`, `stripPdfExtension`, displayed-value helpers to reuse for sort/filter keys.
- [Source: client/src/library/MoveMenu.tsx + AddMenu/AddMenu.tsx] — the popover pattern to reuse (portal, document-level dismiss, Escape carve-out, focus return).
- [Source: client/src/library/folderFilter.ts + folderFilter.test.ts] — the pure-leaf-transform pattern to mirror for `tableView.ts`.
- [Source: DESIGN.md:298-305,533] — `button-secondary` token spec (the `.toolbar-button` chip is its Library realization).
- [Source: CLAUDE.md] — no em-dash in UI strings; adopt stable solutions (reuse the popover); smallest correct structure; document-level/capture-phase handler discipline; launch your OWN dev servers for smoke; versioning (PATCH +1 → 0.5.4); branch-per-story.
- Memory: [[no-emdash-user-facing]], [[prefer-stable-solutions]], [[use-codegraph-navigation]].

## Dev Agent Record

### Agent Model Used

Sonnet 5 (bmad-dev-story), per CLAUDE.md model-per-job.

### Debug Log References

- `cd client && npx vitest run` - 1107 passed (56 files), no regressions. Re-ran the full suite 6x to rule out flake; a pre-existing, unrelated `Reader.test.tsx` Space-pan test flaked intermittently under full-suite parallel load on BOTH the pre-story baseline and this branch (confirmed via repeated `git stash` A/B runs) - not caused by this story.
- `cd client && npm run typecheck` - clean.
- `cd client && npx vitest run src/no-raw-values.test.ts` - 104 passed (new `TableControls.css` + `components.css` tokens stay token-only).
- `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q` - 195 passed (no `.py` touched; only the version bump).
- `cd server && uv lock --check` - lock file consistent after the `uv.lock` version sync.
- Live smoke: own `uvicorn` (port 8010, scratch `PAPER_MATE_DATA`) + `vite dev` (port 5183), 9 real sample PDFs from `fixtures/sample-pdfs/` imported via `POST /api/docs`, driven with Playwright MCP. Both servers torn down after.
- Cross-model review: `codex exec` running the `bmad-code-review` skill non-interactively against the working-tree diff (baseline `2855a3c`). Findings: 0 High, 4 Medium, 3 Low. Fixed 2 Medium (pending-row filter leak, File-type filter vs. status chip) + 2 Low (missing colocated `TableControls/` tests, `tableView.ts` duplicating `row.ts`'s title fallback instead of reusing `seedFieldValue`). The remaining 2 Medium findings were verified and rejected as false positives / accepted design: see Completion Notes.
- `cd client && npx vitest run` (post-fix) - 1134 passed (59 files), typecheck clean.

### Completion Notes List

- Implemented per the Dev Notes hook points exactly: `tableView.ts` (pure `ColumnDef`/`sortRows`/`applyColumnFilter`, mirroring `folderFilter.ts`), `useTableView.ts` (client-only `hiddenColumns`/`sort`/`filter` state + a `useCallback`-memoized `applyTableView` composing filter→sort), and a shared `usePopover.ts` hook factored out of `MoveMenu`'s portal/dismiss/focus-return pattern for the three new `TableControls/` components (`DisplayMenu`, `SortMenu`, `FilterMenu`). `MoveMenu`/`AddMenu` themselves were left untouched (the story's "keep it bounded" note) - only the three new controls consume `usePopover`.
- `sortRows` uses a single stable comparator with a direction sign-flip (never sort-then-`.reverse()`), so equal keys keep response order in BOTH asc and desc (verified by a dedicated stability test) - a sort-then-reverse would have silently broken tie-order symmetry in descending sorts.
- Null/empty sort keys (untitled rows, no authors) sort last in BOTH directions (not just ascending), so an untitled row never jumps to the top of a descending sort - a deliberate, documented superset of the AC-3 "sorts last in ascending order" text.
- `CollectionTable`'s `visibleColumns`/`sort` props are optional with in-function defaults (all `COLUMNS`, `null`), so every pre-existing isolated test (arm/edit, drag, multi-select, Shift-range) needed zero changes - confirmed by re-running the full pre-existing `CollectionTable.test.tsx` suite unmodified alongside the new Story 7.4 cases.
- `PendingRow` also gates its four cells on `visibleColumns` (not called out by name in the story's Task 4, but required: `<colgroup>`/`<tr>` cell counts must stay in sync or a hidden-column view with an in-flight upload would desync the table).
- Filter-clears-selection (AC-5) is wired as a `handleFilterChange` wrapper in `LibraryPage` around `tableView.setFilter`, mirroring `handleSelect`'s folder-switch clear; `SortMenu`/`DisplayMenu` call the hook's setters directly (no selection clear), per AC-5's explicit sort/hide exemption.
- Live smoke (own fresh servers, 9 real sample PDFs) confirmed every Task 7 checklist item: Display hides a column with zero frame reflow (popover portaled to `document.body`, verified via matching bounding boxes before/after); Sort asc/desc reorders rows with the correct header caret and a reload returns to backend response order (view-state not persisted); Filter narrows rows, updates the count line, and clearing restores all; Tab reaches Display -> Sort -> Filter -> Move -> Add in order, Enter opens a control, Escape closes it and returns focus to the trigger; and the 7.3 interplay - sorting by Title then a plain-click + Shift+click selecting the visually-contiguous run, toolbar Move to a new folder - moved exactly that visual range (confirmed via `GET /api/library`), not the pre-sort response-order neighbors.
- Live smoke needed a browser-automation workaround: the claude-in-chrome extension was not connected in this environment and Playwright's shared Chrome profile was briefly held by a concurrent session; waited (user's explicit choice) for the lock to clear rather than skipping the live-smoke gate.
- Divergence already recorded in the story's own "Divergence to record" section (Title non-hideable) - no new divergence introduced.
- **Codex review fixes applied:** (1) a pending (in-flight) upload row ignored the active column filter, so it kept rendering under a narrowed result set with no data to have matched against - fixed by hiding pending rows entirely while any column filter is active (`LibraryPage.tsx`). (2) the File-type filter always matched against "PDF"/"Note", but `PaperRow` shows a status chip ("Extracting", "No metadata") over that cell for `extracting`/`parse-failed` rows - fixed `tableView.ts`'s `displayFileType` to check `statusLabel` first, mirroring `PaperRow`'s own `label ? ... : PDF/Note` branch. (3) `tableView.ts` hand-rolled the title fallback instead of calling `row.ts`'s `seedFieldValue`, violating this story's own Dev Notes instruction to reuse it - swapped to `seedFieldValue(row, "title")` (behaviorally identical, now single-sourced). (4) added the three colocated `TableControls/*.test.tsx` files Task 5 asked for (was covered only indirectly via `LibraryPage.test.tsx`/`CollectionTable.test.tsx` integration tests).
- **Codex review findings verified and NOT fixed:** (a) "2px ink focus ring missing on `.toolbar-button`/`.table-control__item`" - false positive: `index.css`'s global `:focus-visible { outline: ... }` rule already applies to every native `<button>` with no per-component override (the SAME pattern `MoveMenu`/`AddMenu` already rely on); verified no competing `outline: none` rule exists for these classes. (b) "hiding the active sort column removes its header caret while the sort stays applied" - accepted as-is: Display and Sort are two independent, orthogonal view-state controls per the story's own scope; a caret can only render on a header that exists, and rows remain correctly sorted (satisfying AC-2's "rows reorder" clause) even when the sorted column's header isn't visible to show it. Not treated as a defect since neither AC nor the Dev Notes specify cross-control coupling here, and inventing one would be scope creep beyond the story's "smallest correct structure" mandate. Also declined: matching the literal "Untitled" placeholder text in Title filter/sort (the placeholder is a render-time-only fallback in `PaperRow`, not a stored value - `seedFieldValue`, the story's own designated reuse target, has this identical property, so it isn't a regression introduced by this story) and the untracked `fixtures/sample-pdfs/` PDFs (pre-existing in the working tree before this story started, used per Task 7's own instruction to seed live smoke from that directory, not part of this story's diff).

### File List

**New (client):**
- `client/src/library/tableView.ts` - `ColumnKey`/`ColumnDef`/`COLUMNS`, `SortState`/`ColumnFilter`, `sortRows`, `applyColumnFilter`.
- `client/src/library/tableView.test.ts` - unit tests for the pure transforms (extended post-review with a File-type-vs-status-chip regression).
- `client/src/library/useTableView.ts` - the view-state hook (`hiddenColumns`, `sort`, `filter`, `visibleColumns`, `applyTableView`).
- `client/src/library/usePopover.ts` - the shared popover hook (portal anchor, document-level dismiss, focus return) factored out of `MoveMenu`'s pattern.
- `client/src/library/TableControls/DisplayMenu.tsx`, `SortMenu.tsx`, `FilterMenu.tsx`, `TableControls.css` - the three toolbar controls.
- `client/src/library/TableControls/DisplayMenu.test.tsx`, `SortMenu.test.tsx`, `FilterMenu.test.tsx` - colocated unit tests (code-review fix: Task 5 asked for these; added post-review).

**Modified (client):**
- `client/src/library/CollectionTable/CollectionTable.tsx` - `COLUMNS` moved to `tableView.ts`; `ColumnGroup`/`TableHead`/`TableSkeleton` driven by `visibleColumns`; sort caret rendering; optional `visibleColumns`/`sort` props with backward-compatible defaults.
- `client/src/library/CollectionTable/PaperRow.tsx` - the four cells gated on `visibleColumns`.
- `client/src/library/CollectionTable/PendingRow.tsx` - same cell-visibility gating (colgroup/row cell-count parity).
- `client/src/library/CollectionTable/CollectionTable.css` - `.collection-table__sort-caret`.
- `client/src/library/CollectionTable/CollectionTable.test.tsx` - column-visibility + sort-indicator test cases.
- `client/src/library/LibraryPage.tsx` - `useTableView` wiring, `applyTableView` folded into the `visiblePapers` pipeline, filter-clears-selection handler, the three controls added to the toolbar; code-review fix hiding pending rows while a column filter is active.
- `client/src/library/LibraryPage.test.tsx` - Display/Sort/Filter integration tests incl. the 7.3-follows-sort Shift+click + Move regression, plus a pending-row-hidden-under-filter regression (code-review fix).
- `client/src/theme/components.css` - `--table-control-popover-width`, `--table-control-sort-caret-size`, `--table-control-checkbox-size` tokens.

**Modified (version):**
- `server/pyproject.toml` - version `0.5.3` -> `0.5.4`.
- `server/uv.lock` - `paper-mate-server` package version synced to `0.5.4`.

**Modified (tracking, not code):**
- `.bmad/implementation-artifacts/sprint-status.yaml` - story status `ready-for-dev` -> `in-progress` -> `review`.

### Change Log

- 2026-07-06: Implemented the column-descriptor model + pure sort/filter transforms in `tableView.ts` (Task 1), the `useTableView` view-state hook (Task 2), and wired the pipeline + filter-clears-selection into `LibraryPage` (Task 3).
- 2026-07-06: Added column-visibility + sort-caret rendering to `CollectionTable`/`PaperRow`/`PendingRow` (Task 4), and built the Display/Sort/Filter toolbar controls behind a shared `usePopover` hook (Task 5).
- 2026-07-06: Added `tableView.test.ts` (16 cases), extended `CollectionTable.test.tsx` (+7 cases) and `LibraryPage.test.tsx` (+7 cases, incl. the 7.3-follows-sort Move regression); full suite green (1107 tests), typecheck clean (Task 6).
- 2026-07-06: Live-smoked on own fresh servers with 9 real sample PDFs; verified Display no-reflow, Sort asc/desc + caret + non-persistence on reload, Filter narrow/restore + selection-clear, keyboard reachability + Esc-dismiss + focus return, and the sort-then-Shift-click-range-then-Move interplay with Story 7.3 (Task 7).
- 2026-07-06: Bumped `server/pyproject.toml` version `0.5.3` -> `0.5.4` and synced `server/uv.lock` (Task 8).
- 2026-07-06: Cross-model Codex `bmad-code-review` (AE-6): fixed 2 Medium (pending-row filter leak, File-type filter vs. status chip) + 2 Low (colocated `TableControls/` tests, `tableView.ts` reusing `seedFieldValue` instead of duplicating the title fallback) findings; verified and rejected 2 Medium findings as a false positive (focus ring already covered by the global `:focus-visible` rule) and accepted independent-view-state behavior (hiding the active sort column's header also hides its caret). Full suite re-verified green (1134 tests), typecheck clean.
