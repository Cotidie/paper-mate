---
baseline_commit: 689e68a4a38007e2df7559767998a1192ade7f6d
---

# Story 7.3: Multi-select and batch move

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a reader,
I want to select several papers at once and move them together,
so that I can organize in bulk instead of one by one.

## ⚠️ Read this first: most of 7.3 already shipped in Story 7.2

Story 7.2's same-session follow-up rounds (commits `8ebf6a4`/`3dbcf17`/`885c6c3`/`2290ef8`, all in `baseline_commit`) already built the multi-select + batch-move core this story was scoped for, via a design the user chose interactively during 7.2:

- **Multi-select** = Ctrl/Cmd+click toggles a row into one lifted `selectedIds: Set<string>` (NOT per-row checkboxes: a checkbox column was built in 7.2 then explicitly reverted by the user as "wastes space").
- **Batch move** = a toolbar **Move** button (moves the whole `selectedIds` set) AND native drag-a-selected-row-onto-a-folder-panel-entry, both calling the set-based `POST /api/library/move` from 7.2.
- **Selection reset** = cleared on folder switch (`handleSelect`) and after a move completes (`handleMoveRequest`).
- **Backend** = the set-based `{doc_ids}` move endpoint, `move_papers` through the serialized `mutate_index` writer (AL-7), is done and shipped in 7.2.

**So this story's ONLY net-new deliverable is Shift+click contiguous range selection** (the user's explicit request). Everything else in the epic-7.3 AC list is either already satisfied (verify + reference, do not rebuild) or a recorded, user-approved design divergence (checkboxes/select-all → Ctrl/Cmd+click). Do NOT re-introduce checkboxes or a select-all header, and do NOT rebuild the move endpoint, toolbar Move, or drag-to-folder. This is a small, client-only story.

## Acceptance Criteria

Reframed against what shipped in 7.2. The epics.md 7.3 ACs are mapped so nothing is silently dropped.

1. **(NET-NEW) Shift+click selects a contiguous range.** Given a prior selection anchor (the row last plain-clicked or Ctrl/Cmd+clicked), when I Shift+click another row, then every row between the anchor and the clicked row inclusive (in the currently rendered order) enters the selection, replacing the prior set. (extends LFR-3 multi-select)

2. **(NET-NEW) The anchor is stable across successive Shift+clicks.** Given I Shift+click to make a range, when I Shift+click a different row, then the range re-computes from the SAME anchor (the range grows/shrinks around the original pivot); the anchor only moves on a plain click or a Ctrl/Cmd+click. (Finder/Explorer/Gmail semantics)

3. **(NET-NEW) Shift+click never arms, edits, opens, or text-selects.** Given a Shift+click on any row (including on a Title/Authors cell), then it only changes the selection: it does not enter inline edit, does not open the reader, and does not start a native browser text selection sweep across the table. (same click-suppression discipline as the existing Ctrl/Cmd+click capture-phase path)

4. **(NET-NEW) Range selection feeds the existing batch move unchanged.** Given a Shift+click range selection, when I use the toolbar Move button or drag one selected row onto a folder, then all range-selected papers move in one set-based `POST /api/library/move` (LFR-3, LFR-15, AL-6). No endpoint, contract, or move-path change; range simply produces a larger `selectedIds`.

5. **(VERIFY, already shipped in 7.2) Selection resets on clear or after a batch action.** Clearing (folder switch) or completing a move empties `selectedIds`; the anchor must reset too so a stale pivot can't leak a range across views. (LFR-3, L-UX-DR2)

6. **(VERIFY, already shipped in 7.2) Batch op goes through the serialized `library.json` write path** so a concurrent background extraction refresh cannot drop it (AL-7). No change; the range reuses 7.2's `move_papers`/`mutate_index`.

7. **(RECORD divergence) Per-row checkboxes + a select-all are NOT built.** The epic-7.3 AC "per-row checkboxes (and a select-all)" was superseded in 7.2 by Ctrl/Cmd+click + Shift+click into one `selectedIds` set, per an explicit user decision recorded in 7.2's Dev Agent Record. This story keeps that model; it does not add a checkbox column.

8. **(RECORD gap) Keyboard-operability of row selection.** L-UX-DR12 asks selectable controls to be keyboard-operable with visible focus rings. The toolbar Move button, AddMenu, and FolderPanel entries ARE keyboard-operable (shipped 7.1/7.2). Table ROWS are pointer-only for selection (a pre-existing state from 7.2; rows are non-focusable `<tr>`). Shift+click is inherently a pointer gesture. A keyboard range-select (Shift+Arrow to extend, roving-tabindex rows) is OUT of this story and flagged for the human at review; see Dev Notes "Scope boundary".

## Scope boundary (read first, prevents scope creep)

**In scope (all client-only, no backend/contract change):**

- Shift+click contiguous range selection in `CollectionTable`, hooked into the existing capture-phase gesture handler and the one `selectedIds` set.
- A table-local selection anchor (the pivot), set on plain/Ctrl/Cmd click, held stable across Shift+clicks, reset when the selection empties.
- Suppressing the native text-selection sweep a Shift+click otherwise triggers.
- Unit tests for the range logic + a live smoke that a range moves via toolbar Move and drag-to-folder.
- Version PATCH bump `0.5.2` → `0.5.3` at story done.

**Out of scope (do NOT build):**

- **Per-row checkboxes / select-all header** → deliberately superseded in 7.2 (AC-7). Not this story, not any story unless the user reverses the 7.2 decision.
- **Any backend / `POST /api/library/move` / `move_papers` / contract (`schema.d.ts`, `docs/API.md`) change** → the set-based move is done. If you touch a `.py` file or regenerate the contract for this story, you are off track.
- **Toolbar Move button, drag-to-folder, custom drag image, selection highlight CSS** → all shipped in 7.2; reuse as-is. Range selection just makes `selectedIds` bigger; those consumers already read the whole set.
- **Keyboard row-selection (Shift+Arrow / roving tabindex)** → deferred (AC-8), flag for the human.
- **Batch delete / Trash** → Story 7.5 (it reuses this same multi-select).
- **Sort / filter / column controls** → Story 7.4. Note the range is computed against the currently rendered `rows` array, so it will automatically follow 7.4's client sort order once that lands.

## Tasks / Subtasks

- [x] **Task 1 - Add a selection anchor to `CollectionTable` (AC: 2, 5)**
  - [x] Add a table-local `const anchorRef = useRef<string | null>(null)` (the pivot docId). It is UI-mechanic state local to the ordered rows the table renders, same footing as the local `editing` cursor; do NOT lift it to `LibraryPage`.
  - [x] Set `anchorRef.current = docId` in the two gestures that "focus a fresh row": the plain-click path (`handleRowClick`, on the branch that selects a single row) and the Ctrl/Cmd+click path (`handleRowClickCapture`). Set it to the clicked row in both toggle-on and toggle-off? No: set it to the clicked `docId` on a plain single-select and on a Ctrl/Cmd toggle-on; on a plain toggle-off (clicking the sole selection to clear) set it to `null`. A Ctrl/Cmd toggle-off may leave the anchor as-is (simplest correct behavior).
  - [x] Reset the anchor whenever the selection empties from outside (folder switch / post-move clear). Add `useEffect(() => { if (selectedIds.size === 0) anchorRef.current = null; }, [selectedIds])`. This closes AC-5's "anchor must reset too".

- [x] **Task 2 - Handle Shift+click as a range in the capture phase (AC: 1, 2, 3)**
  - [x] Extend `handleRowClickCapture(e, docId)`: it already returns early unless `e.ctrlKey || e.metaKey`. Add a `e.shiftKey` branch. Order the branches so a Ctrl/Cmd+click keeps its existing toggle behavior; a plain Shift+click (no ctrl/meta) does the range.
  - [x] In the Shift branch: `e.stopPropagation()` (so it never bubbles to arm/edit/open, exactly like the Ctrl/Cmd branch) AND `e.preventDefault()` (so the browser does not run its native shift-extends-text-selection sweep across the table cells).
  - [x] Range computation, by INDEX into the currently rendered `rows` prop (not `doc_id` order, not the store order): `const anchorIdx = rows.findIndex(r => r.doc_id === anchorRef.current)`; `const targetIdx = rows.findIndex(r => r.doc_id === docId)`.
    - If `anchorRef.current === null` OR `anchorIdx === -1` (no pivot, or the pivot was filtered out of the current view): treat the Shift+click as a plain single-select of `docId` and set `anchorRef.current = docId` (graceful fallback, not a no-op).
    - Otherwise: build the inclusive range `[min(anchorIdx,targetIdx) .. max(...)]`, map to `doc_id`s, and `commitSelected(new Set(rangeIds))`. This REPLACES the set (plain Shift = range-replace).
  - [x] Do NOT move the anchor in the Shift branch (AC-2): successive Shift+clicks must re-range from the same pivot.
  - [x] Optional nicety (only if trivial, else skip): Ctrl/Cmd+Shift+click = additive range (union the range into the existing set instead of replacing). Not required by the user's ask; if it complicates the branch ordering, leave it out and note it. (Skipped: kept the branch ordering simple, Ctrl/Cmd+Shift is not required by the ask.)

- [x] **Task 3 - Update the component doc comments (no behavior beyond Tasks 1-2)**
  - [x] Update `CollectionTable`'s header doc comment (the "Selection is ONE set" block) to describe the three gestures now: plain click = replace-with-one (toggle-off if sole), Ctrl/Cmd+click = toggle one, Shift+click = replace-with-range-from-anchor. Note the anchor rule and the capture-phase suppression.
  - [x] Update `PaperRow`'s header doc comment's selection paragraph to mention Shift+click alongside Ctrl/Cmd+click (it already documents the capture-phase interception; extend it).

- [x] **Task 4 - Tests (AC: 1, 2, 3, 4, 5)**
  - [x] `CollectionTable.test.tsx` (mirror the existing `fireEvent.click(row, { ctrlKey: true })` / `{ metaKey: true }` cases around lines 486-577; the file already renders with `selectedIds`/`onSelectionChange`). Since the table is controlled by `selectedIds` in these tests, drive the anchor by first issuing the plain/Ctrl click that sets it, then the Shift+click, asserting the final `onSelectionChange` argument. Added the range/anchor-stability/fallback/suppression cases, plus (bug fix, see Completion Notes) two focus-blur regression tests.
  - [x] `LibraryPage.test.tsx` (regression, mirror the existing Ctrl+click + toolbar-Move cases): a Shift+click range then clicking toolbar **Move → a folder** calls the mocked `movePapers` with the FULL range's `doc_ids`; after the move, `selectedIds` clears (AC-4/AC-5). Kept `getLibrary`/`movePapers` mocked. No `render/` mock barrel touched.
  - [x] No backend test added or changed (no `.py` touched this story).

- [x] **Task 5 - Live smoke (own fresh servers) (AC: 1, 3, 4)**
  - [x] Table/selection/membership feature, no DPR>1 gate needed (same call as 7.1/7.2); one normal-DPR real-data pass.
  - [x] Launched own fresh `uvicorn` (port 8010) + `vite dev` (port 5183) against an isolated scratch `PAPER_MATE_DATA`, seeded real sample PDFs from `fixtures/sample-pdfs/` + a real folder via the actual import/`POST /api/library/folders` paths.
  - [x] Drove with Playwright's real click (`modifiers: ["Shift"|"Control"]`), not `dispatchEvent`. Verified: plain-click + Shift+click 2 rows away selects the contiguous run; anchor stability re-ranges from the same pivot on a second Shift+click; `window.getSelection()` stays empty (no native text-selection sweep); toolbar Move moves the whole range into Folder A (confirmed via `GET /api/library`) and clears the selection; dragging one selected row onto the Folder A panel entry (Playwright real drag) moves the whole range. Both servers torn down after.

- [x] **Task 6 - Version + housekeeping**
  - [x] Bumped `server/pyproject.toml` `[project].version` `0.5.2` → `0.5.3`. No `uv.lock` version field to sync (checked). No contract change, so `schema.d.ts`/`docs/API.md` untouched.
  - [x] No `docs/API.md` changelog entry (no `/api` change).

- [x] **Task 7 - Fix request (user-reported, discovered live during Task 5/6): stray focus ring on the Title/Authors cell after a modifier-click**
  - [x] Root cause: `EditableCell`'s `<td>` is `tabIndex={0}` unconditionally (for the Enter-to-edit keyboard path). The browser's native `mousedown` default focuses it before React's click-phase handlers ever run, so a Ctrl/Cmd or Shift click landing on that cell left a stray focus ring behind - and, since `armed` is false during a multi/range selection, a later bare Enter on that stray-focused cell would fire `onArm()` and silently collapse the whole selection back to one row.
  - [x] Fix: `handleRowClickCapture` now blurs `document.activeElement` at the top of any modifier-click branch, scoped to `e.currentTarget.contains(active)` so it never touches focus outside the clicked row.
  - [x] Regression tests added to both the Ctrl/Cmd and Shift/click describe blocks in `CollectionTable.test.tsx` (focus a cell to simulate the native mousedown-focus, fire the modifier click, assert focus moved off it).
  - [x] Re-verified live (Playwright, own fresh servers): clicking directly on the Title cell text, then Shift+clicking another row's Title text, leaves `document.activeElement === document.body` - no stray focus, no visual ring.

## Dev Notes

### The exact hook point (read the current code, do not re-architect)

`CollectionTable` (`client/src/library/CollectionTable/CollectionTable.tsx`) already owns the whole selection mechanic. The relevant symbols as they stand in `baseline_commit`:

- `selectedIds` — one `Set<string>`, controlled-or-uncontrolled: `const selectedIds = props.selectedIds ?? internalSelected`. `commitSelected(next)` writes it (updates local state when uncontrolled AND always calls `props.onSelectionChange?.(next)`). Use `commitSelected` for the range; never set state two ways. [Source: CollectionTable.tsx:146-158]
- `handleRowClick(docId)` — plain click. Replaces the set with `new Set([docId])`, or clears if that row was the sole selection (toggle-off). This is where you set the anchor to `docId` (or `null` on the toggle-off branch). [Source: CollectionTable.tsx:185-193]
- `handleRowClickCapture(e, docId)` — CAPTURE-phase handler on the `<tr>` (`onClickCapture` in `PaperRow`), currently `if (!e.ctrlKey && !e.metaKey) return;` then toggles one row and `stopPropagation`s. **This is where Shift+click goes** (add a `shiftKey` branch), because capture fires before the Title/Authors cells' bubble-phase click handlers, so `stopPropagation` here is what keeps a modifier-click from also arming/editing/opening. [Source: CollectionTable.tsx:195-206]
- Row wiring: `armed={selectedIds.size === 1 && selectedIds.has(row.doc_id)}`, `checked={selectedIds.has(row.doc_id)}`, `onRowClickCapture={(e) => handleRowClickCapture(e, row.doc_id)}`. A range just grows `selectedIds`; `checked` (highlight + drag payload) and the toolbar Move already read the whole set, so they Just Work. `armed` is `size === 1` only, so a range (size ≥ 2) correctly shows NO inline-edit affordance. [Source: CollectionTable.tsx:253-269]

### Why the anchor is a `useRef`, table-local, and reset on empty

- **Ref, not state:** it is read synchronously inside the click handler and never needs to trigger a re-render on its own, so `useRef` avoids a spurious render (the visible selection re-renders via `selectedIds`).
- **Table-local, not lifted:** the range is defined over the CURRENTLY RENDERED `rows` order, which only the table has; `LibraryPage` owns membership (`selectedIds`) but not row order. Keeping the anchor next to `rows` mirrors how `editing` is local. Do not add an anchor prop.
- **Reset on `selectedIds.size === 0`:** `LibraryPage` clears the selection on a folder switch (`handleSelect`, line 85-88) and after a move (`handleMoveRequest`, line 90-97). Those are external to the table, so the table can't know to drop its pivot except by observing the emptied set. The `useEffect` keyed on `selectedIds` is the clean seam (AC-5). Without it, after a move you could Shift+click and range from a paper that is no longer where you think it is.

### Range must be index-based over `rows` (order-following, 7.4-safe)

Compute the range as inclusive indices into the `rows` prop array (`findIndex` on both ends, `min`/`max`), NOT by `doc_id` sort or store `order`. `rows` is whatever the table currently paints - today the response `order`, and once Story 7.4 lands client-side sort, the SORTED order. Index-based range then automatically means "everything visually between these two rows," which is what a user expects from Shift+click regardless of sort. [Source: CollectionTable.tsx:253 renders `rows.map(...)` in array order]

### `preventDefault` on the Shift+click (native text-selection)

A browser Shift+click extends the existing text selection to the click point. Across table cells that paints an ugly blue sweep and can leave a lingering DOM Selection. `stopPropagation` alone does not stop it (it is the browser default action, not a React handler). Add `e.preventDefault()` in the Shift branch. (Ctrl/Cmd+click doesn't need it; only Shift extends a text selection.) jsdom won't show this - it's a live-smoke check (Task 5).

### Divergence from the epics.md 7.3 AC text (record, don't silently drop)

The epics.md Story 7.3 AC block says "per-row checkboxes (and a select-all)." That was written before 7.2's follow-up rounds. During 7.2 the user interactively chose Ctrl/Cmd+click over a checkbox column ("bad idea, wastes space" - 7.2 Dev Agent Record / Change Log round 1). This story honors that shipped decision and adds Shift+click, the standard companion gesture. If the human wants checkboxes back, that reverses a prior user decision and should be its own correct-course, not silently folded in here. Flag AC-7 and AC-8 (keyboard gap) explicitly in the PR description so the reviewer accepts the divergence knowingly. [Source: 7-2-assign-filter-by-folder.md Dev Agent Record + Change Log rounds 1-3]

### Testing standards

- Client only: `cd client && npm test` (Vitest) + `npm run typecheck`. Mirror the existing modifier-click tests in `CollectionTable.test.tsx` (lines ~486-577) for style (`fireEvent.click(row, { shiftKey: true })`, assert on `onSelectionChange`'s last-call argument). `no-raw-values.test.ts` must stay green (this story likely adds NO CSS - the checked/armed highlight already covers a ranged row).
- No backend suite change (no `.py` touched). Do not regenerate the contract (`schema.d.ts`) or `docs/API.md` - no `/api` surface changes.
- Live smoke per Task 5 (one normal-DPR own-server pass; no DPR>1 gate).
- After dev-story, run the cross-model Codex `bmad-code-review` (AE-6) on the diff.

### Project Structure Notes

- **Modified (client only):** `client/src/library/CollectionTable/CollectionTable.tsx` (anchor ref + Shift branch in the capture handler + doc comment), `client/src/library/CollectionTable/PaperRow.tsx` (doc comment only), their `.test.tsx` files, and `client/src/library/LibraryPage.test.tsx` (range→Move regression). Possibly no `.css` change at all.
- **Modified (version):** `server/pyproject.toml` (`0.5.2` → `0.5.3`), `server/uv.lock` only if it records the version.
- This story file lives in `.bmad/implementation-artifacts/epic-7/` (per-epic convention, same as 7.1/7.2).
- Branch per story: cut `story-7-3-multi-select-batch-move` off `main` before implementing (CLAUDE.md). Update `sprint-status.yaml` to `done` at PR-merge time (AE3-1); fill the Dev Agent Record before flipping to `done` (AE3-2).

### References

- [Source: .bmad/planning-artifacts/epics.md#Story-7.3] - the epic ACs (LFR-3 multi-select, LFR-15 set-based move, L-UX-DR2 reset, L-UX-DR12 keyboard/focus); batch delete reuses this multi-select in 7.5.
- [Source: .bmad/implementation-artifacts/epic-7/7-2-assign-filter-by-folder.md] - **the story that already shipped multi-select + batch move**: `selectedIds` unification, toolbar Move, drag-to-folder, the checkbox→Ctrl/Cmd+click reversal, selection reset. Read its Dev Agent Record + Change Log before starting.
- [Source: client/src/library/CollectionTable/CollectionTable.tsx:146-274] - `selectedIds`, `commitSelected`, `handleRowClick`, `handleRowClickCapture` (the exact hook point), the row wiring.
- [Source: client/src/library/CollectionTable/PaperRow.tsx:31-72] - `onClickCapture={onRowClickCapture}`, `aria-selected`/`data-checked`, `draggable` row.
- [Source: client/src/library/LibraryPage.tsx:72-97,170-176,216-223] - lifted `selectedIds`, `handleSelect`/`handleMoveRequest` clears, the toolbar `MoveMenu`, the `CollectionTable` wiring.
- [Source: client/src/library/CollectionTable/CollectionTable.test.tsx:486-577] - existing Ctrl/Cmd+click selection tests to mirror.
- [Source: .bmad/planning-artifacts/architecture/architecture-paper-mate-library-2026-07-04/ARCHITECTURE-SPINE.md] - AD-L3 (selection = Library view-state, never a route), AD-L6 (set-based `{doc_ids}` move - unchanged here), AD-L7 (serialized `library.json` writes - unchanged here).
- [Source: CLAUDE.md] - no em-dash in UI strings (this story adds none); don't reinvent wheels; smallest correct structure; document-level/capture-phase handler discipline; launch your OWN dev servers + trusted input for focus-sensitive smoke; versioning (PATCH +1 → 0.5.3); branch-per-story.
- Memory: [[use-trusted-input-for-focus-sensitive-smoke]], [[drag-tools-dont-create-text-selection]], [[prefer-stable-solutions]], [[no-emdash-user-facing]].

## Dev Agent Record

### Agent Model Used

Recommended: Sonnet 5 xHigh (bmad-dev-story), per CLAUDE.md model-per-job.

### Debug Log References

- `cd client && npm test -- --run` - 1070 passed (55 files), no regressions.
- `cd client && npm run typecheck` - clean.
- Live smoke: own `uvicorn` (port 8010, scratch `PAPER_MATE_DATA`) + `vite dev` (port 5183), real sample PDFs from `fixtures/sample-pdfs/`, driven with Playwright MCP (trusted `modifiers: ["Shift"]`/`["Control"]` clicks and real drag). Both servers torn down after each pass.

### Completion Notes List

- Implemented Shift+click contiguous range selection exactly per the Dev Notes hook point: a table-local `anchorRef` (`useRef`), reset via `useEffect` when `selectedIds` empties, and a `shiftKey` branch in `handleRowClickCapture` computing an inclusive index range over the rendered `rows` array. Anchor only moves on a plain click or a Ctrl/Cmd toggle-ON, never in the Shift branch (AC-2). No backend, contract, checkbox column, or select-all was touched (AC-7 divergence honored as recorded).
- Live smoke (own fresh servers, real sample PDFs + a real folder) confirmed: contiguous range selection, anchor stability across successive Shift+clicks, no native text-selection sweep (`window.getSelection()` empty), toolbar Move moving the whole range (verified via `GET /api/library`), drag-to-folder moving the whole range, and selection clearing after a move.
- **Mid-story fix request (user-reported via screenshot after Task 5/6 completed):** a modifier-click (Ctrl/Cmd or Shift) landing on the Title/Authors `<td>` left a stray browser focus ring, because that cell is `tabIndex={0}` for the Enter-to-edit keyboard path and the browser's native `mousedown` default focuses it before our click-phase handlers run - `preventDefault`/`stopPropagation` on `click` can't retroactively undo a `mousedown`-time focus change. Beyond the cosmetic ring, this was a latent correctness bug: with the stray focus left in place, a later bare Enter keypress on that cell would fire `EditableCell`'s `onKeyDown` → `onArm()` (since `armed` is false during a multi/range selection), silently collapsing the whole selection back to one row. Fixed by blurring `document.activeElement` at the top of `handleRowClickCapture`'s modifier-click path, scoped to `e.currentTarget.contains(active)` so only focus left inside the clicked row is touched. Added two regression tests (Ctrl+click and Shift+click describe blocks) that focus the Title cell to simulate the native mousedown-focus, then assert the modifier click blurs it back off. Re-verified live: clicking directly on Title cell text then Shift+clicking another row's Title text leaves `document.activeElement === document.body`, no stray ring.
- Story marked `done` directly (not staged through `review`) per explicit user instruction in this session ("mark the story done and push"), bypassing the standing cross-model Codex `bmad-code-review` gate (CLAUDE.md's "Auto code-review after dev-story") for this story. Flagging this divergence here since it departs from the documented standard flow.

### File List

**Modified (client):**
- `client/src/library/CollectionTable/CollectionTable.tsx` - selection anchor (`anchorRef`, reset effect), Shift+click range branch in `handleRowClickCapture`, modifier-click focus-blur fix, updated header doc comment.
- `client/src/library/CollectionTable/PaperRow.tsx` - header doc comment updated to mention Shift+click.
- `client/src/library/CollectionTable/CollectionTable.test.tsx` - range/anchor-stability/fallback/suppression tests + two focus-blur regression tests.
- `client/src/library/LibraryPage.test.tsx` - Shift+click range → toolbar Move regression test.

**Modified (version):**
- `server/pyproject.toml` - version `0.5.2` → `0.5.3`.

**Modified (tracking, not code):**
- `.bmad/implementation-artifacts/sprint-status.yaml` - story status `ready-for-dev` → `in-progress` → `done`.

### Change Log

- 2026-07-06: Implemented Shift+click contiguous range selection (Tasks 1-3): table-local anchor ref, capture-phase range branch, updated doc comments.
- 2026-07-06: Added range/anchor/fallback/suppression unit tests + a LibraryPage range→Move regression test (Task 4); full suite green (1070 tests), typecheck clean.
- 2026-07-06: Live-smoked on own fresh servers with real sample PDFs (Task 5); verified range select, no native text-selection sweep, toolbar Move + drag-to-folder both moving the whole range, selection clearing after move.
- 2026-07-06: Bumped `server/pyproject.toml` version `0.5.2` → `0.5.3` (Task 6).
- 2026-07-06: Fix request (user-reported): blurred a stray browser focus left on the Title/Authors cell by a modifier-click's native mousedown-focus, which also closes a latent bug where a stray Enter would collapse a multi/range selection via `onArm()`. Added regression tests, re-verified live (Task 7).
