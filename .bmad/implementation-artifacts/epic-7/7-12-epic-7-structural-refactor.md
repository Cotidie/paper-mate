---
baseline_commit: 35cd6e5710d19d8c2c55b87a2ecc5632041ea75c
---

# Story 7.12: Epic 7 structural refactor (modularize the whole organize/curate surface)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want the full Epic 7 code (client `library/` plus backend `storage`/`routes`), including the 7.9 metadata columns, the 7.10 persisted table-layout store, and the 7.11 cell-type/tag seam, decomposed into cohesive single-responsibility modules with dependencies audited, duplication removed, and conditional sprawl simplified,
so that Epic 7 closes on legible modular seams instead of a 950-line table component, a 466-line composition root, near-twin optimistic op hooks, and an ad-hoc cell-type dispatch.

**This is a pure refactor thread, same footing as Stories 5.0 / 5.3 / 5.4 / 6.8.** No behavior change, no contract change, no schema change, no version-format change. Its own PR(s); client and server MAY split into separate PRs. Never folded into a feature story. The success gate is BYTE-IDENTICAL contract (`openapi.json` + `schema.d.ts`) plus green suites plus a live re-smoke, not a new feature.

## Acceptance Criteria

Restated from `epics.md` Story 7.12 (lines 1871-1908). Fidelity preserved; wording adjusted only to drop em-dashes and to correct two stale facts the epic text was written against (see "Reality corrections" below): the tag COLUMN ships, but the click-a-chip **author filter was removed in Story 7.11** (do not resurrect it), and the actual current line counts are larger than the epic's 2026-07-07 baseline (CollectionTable is 950, `library_index.py` 478, not 629/453).

1. **`CollectionTable` decomposed into cohesive units (AD-9).** `client/src/library/CollectionTable/CollectionTable.tsx` (950 lines, fusing: the pure header helpers `ariaSortValue`/`sumColumnWidths`/`columnClassSuffix`, the row + column drag-preview builders, `ColumnGroup`, a ~220-line `ColumnHeaderCell` menu-plus-resize-plus-reorder, `TableHead`, `TableSkeleton`, the selection + Shift-range model, the frozen-geometry column-drag machinery, and the row-move drag) is decomposed into cohesive units under `CollectionTable/`, each colocated with its `.css` + `.test.tsx` per the Story 5.4 `<Name>/` convention, so no single file owns more than one concern. The table's public props (`CollectionTableProps`) stay unchanged so `LibraryPage` is unaffected.

2. **`LibraryPage` reduced to a thin composition root.** `LibraryPage.tsx` (466 lines: fetch/health wiring + the pure per-lens `emptySelectionMessage`/`selectionLabel`/`purgeDialogTitle` helpers + the folder-hides-Location `visibleColumns` derivation + a two-branch trash-vs-non-trash toolbar + move/trash/restore/star/purge/selection handlers) has the per-lens view-state derivations and the toolbar extracted into cohesive units (a lens-copy/columns helper module and a `LibraryToolbar` component owning the trash-vs-non-trash branch), leaving `LibraryPage` a thin composition root. Behavior (which button shows in which lens, the counts, the empty copy) is byte-identical.

3. **The near-twin optimistic org-op hooks collapse onto ONE reusable seam.** The set-based paper-org hooks `useMovePapers` / `useTrashPapers` (trash/restore/purge) / `useStarPapers` (star/unstar) are the same skeleton (optimistic field patch over a `doc_id` set → API call → reconcile from the returned `Library` → revert a captured `prior` map + error toast, all under one `mountedRef` + monotonic `opSeqRef` guard). The shared machinery is abstracted into ONE reusable seam (e.g. a `useOptimisticLibraryOp` the verbs configure with an optimistic patch + API fn + error copy + optional success toast), so adding the next org op is registering one descriptor, not copying another near-twin hook; the StrictMode `mountedRef` reset and stale-response `opSeqRef` guard live in one place. (The per-doc field-edit hooks `useInlineEdit`/`useAuthorsEdit` are a *related but distinct* family: see the Design decisions call on whether they fold in.)

4. **The column model reads as one coherent set of leaves; the cell-type registry is the canonical descriptor/renderer seam.** The client column + table-layout model spread across `tableView.ts` (descriptor `COLUMNS` + `sortKey`/`sortRows` + `moveColumn`/`reorderColumns` + width-clamp constants), `useTableView`, `useColumnWidths`/`useDragResize`, and the Story 7.10 `tableViewPrefs` store is reorganized so the table-view-preferences persistence (its degrade-safe `reconcile` load/parse/versioned-schema + unknown-column-key skip) lives in ONE cohesive client-only leaf, and the column model (descriptor + `cellType` + sort-key + reorder transforms) reads as one coherent set of leaves rather than one file fusing three concerns. The Story 7.11 cell-type registry is consolidated as the canonical column-descriptor/renderer seam (7.11 introduced `cellType` under feature pressure; `PaperRow.renderCell` still dispatches `cellType === "tag"` as a guard *before* a per-key `switch`), so `PaperRow` dispatches through a descriptor/renderer registry, not an ad-hoc branch-plus-switch.

5. **`library_index.py` folder-tree ops and set-based paper-org mutators separated behind the stable facade (AL-7, AL-9, AD-9).** `server/app/storage/library_index.py` (478 lines: folder create/rename/delete + subtree re-home, the near-identical set-based `move`/`trash`/`restore`/`star`/`unstar` mutators, the `_cache_from_meta` projection grown by 7.9's doi/venue/year and 7.11's author-list, `read_library`/`reconcile_library`, and the `update_meta_and_reindex` write core, each a `mutate_index` closure) has the folder-tree operations and the set-based paper-org mutators separated into cohesive modules behind the stable `storage` facade (every `storage.<fn>` call site stays byte-identical), and the repeated build-`papers_by_id` → validate-unknown-ids → apply-field pattern is consolidated to ONE helper the flag-flip mutators share. Storage stays the ONLY code touching `~/.paper-mate` (AD-9) and the single `_index_lock`/`mutate_index` stays the sole `library.json` writer (AL-7).

6. **`routes/library.py` set-op handler shape + `responses=` map each consolidated to one definition.** `routes/library.py` (197 lines) repeats a near-identical handler body for `trash`/`restore`/`star`/`unstar` (a `DocIdSet` body → `storage_errors("Could not update the collection")` → `storage.X_papers(body.doc_ids)`, plus a byte-identical 404/422/500 `responses=` map). The duplicated `responses=` map and the set-based-op handler shape are each consolidated to one definition (a shared responses constant + a thin dispatch), leaving each route a thin controller. The distinct-404 `move` route (its `FolderNotFoundError` branch) and the folder CRUD routes stay explicit where their error surface differs.

7. **Duplication and dead code removed across the Epic 7 surface (client + server).** Logic duplicated across these files (or vs. the Epic 6 `library/` units and the `storage` server layer) is consolidated to one definition, and dead code (unreferenced exports, stale branches, superseded comments) is deleted, not left "just in case."

8. **BEHAVIOR- and CONTRACT-identical gate.** Client + server suites stay green, `server/openapi.json` / `client/src/api/schema.d.ts` regenerate byte-identical, `no-raw-values.test.ts` re-runs green after any CSS move, no em-dash is introduced in any UI string, both `vi.mock(...)` barrels stay in sync if any mocked import path moves, and the folder-filter / batch-move / Trash / Starred / sort / reorder / tag paths are re-smoked live (the folder-view Location-hide, the never-clip star, the toolbar lens branches, a reload-restores-layout check, a tag add/remove). Its own PR(s), never folded into a feature story.

9. **AD-9 downward layering + the client view-state leaf rule respected.** The new module boundaries respect AD-9 (client `render/` → `anchor/` → `annotations/` → `App`; server `routes/` → `domain`/`storage`) and the domain's no-storage-import rule (AD-L2): no upward imports, routes stay thin, storage stays the sole data-root writer, and the client `library/` view-state leaves (`folderFilter`, the column model, the prefs `reconcile`) stay pure, React-free leaves (AD-L3).

## Design decisions (open calls resolved at create-story)

The epic left four open calls (`epics.md:1908`). Resolved here so the dev agent does not re-litigate them mid-refactor. These are recommendations for the *smallest correct structure*; deviate only with a stated reason.

### 1. The shared optimistic-op seam: a hook factory over the SET-based org trio only. Keep the field-edit hooks a separate (or folded-only-if-smaller) family.

There are **two** near-twin families, not one, and they reconcile from different sources:

- **Set-based org ops** (`useMovePapers`, `useTrashPapers`, `useStarPapers`): optimistic patch over a `doc_id` **Set** → API returns the **whole `Library`** → `setLibrary(library)` reconcile → revert a captured `prior` map → `mountedRef` + a single monotonic `opSeqRef`. This is the AC-3 target: five verbs (move/trash/restore/star/unstar) plus `purge` (a row-remove variant that shares the same guards).
- **Per-doc field-edit ops** (`useInlineEdit`, `useAuthorsEdit`): optimistic patch on **one** doc → `PATCH /api/docs/{id}` returns a single **`Doc`** → reconcile that one row → revert a prior *value* → a **keyed `editSeqRef` Map** (per `docId:field`), not a single `opSeqRef`.

**Recommendation:** build ONE `useOptimisticLibraryOp` seam for the set-based trio (a hook factory / config object: `{ apiFn, optimisticPatch(prev, ids) → {next, revert}, errorCopy, successToast? }` returning the verb; `mountedRef` + `opSeqRef` inside). `purge` fits as a row-remove-shaped descriptor. **Do NOT force the field-edit hooks into the same seam** unless it genuinely comes out smaller: their reconcile source (`Doc` not `Library`), their revert unit (a value not a set), and their guard (keyed `editSeqRef`) differ enough that one seam risks a leaky union type. If `useInlineEdit`/`useAuthorsEdit` share enough to collapse into a second small `useOptimisticFieldEdit`, do it; otherwise leave them as the two focused siblings they already are and just note the shared shape in a comment. A hook factory beats a runtime descriptor **map** here because each verb wants its own stable identity for `useCallback` deps in `LibraryPage`.

### 2. Split `CollectionTable` far enough to end the one-concern-per-file violation, not into confetti.

The 950 lines are five separable concerns. Recommended target (see Project Structure Notes for the tree):

- **`ColumnHeader.tsx`** (or `ColumnControls/`): `ColumnHeaderCell` + `TableHead` + the header dropdown menu (Sort/Move/Hide) + the resize handle. This is the largest single lump (~250 lines) and the clearest cut.
- **`useColumnDrag.ts`**: the lifted column-drag state + the frozen-geometry resolver (`resolveColumnKeyAtClientX`, `captureColumnRects`, `handleColumnDrag*`, `commitColumnDrop`, the `dropIndicator` memo, `displayColumns`/`livePreviewColumns`). This is a self-contained interaction machine with a documented oscillation fix; keep that doc comment.
- **`useRowSelection.ts`** (or keep inside the shell if it stays small): the plain/Ctrl/Shift click model + `anchorRef` + the empty-set anchor reset + `suppressClickRef`/`consumeSuppressedClick`. Preserve the capture-phase discipline and the suppress-click doc comment EXACTLY (they fix real shipped bugs).
- **`dragPreview.ts`** (leaf): `buildDragPreview` (rows) + `buildColumnDragPreview` + the two `*_DRAG_MIME` constants (or leave the MIME with `moveDrag.ts`).
- **`TableSkeleton.tsx`**, **`ColumnGroup`** (tiny, may stay), and the Recent group-header `<tr>` (a small `GroupHeaderRow` or left inline).

The shell (`CollectionTable.tsx`) then composes: props → `useRowSelection` + `useColumnDrag` → `<TableHead>` + `<PaperRow>`/`<PendingRow>` map. **Do not** split `PaperRow` further than the cell-renderer registry (decision 4); do not extract a component that is used once and is under ~15 lines just to hit a file-count target.

### 3. Backend: separate folder ops from paper-org ops behind a shared index-core, NOT a lighter dedupe-in-place.

Split `library_index.py` so:

- **an index-core** (keep it in `library_index.py`, or a new `index_core.py` both import) owns the primitives shared by everything: `_index_lock`, `mutate_index`, `_read_index_unlocked`/`_write_index`/`_default_index`, `read_library`, `_cache_from_meta`, `upsert_paper_entry`, `_next_order`, `reconcile_library`, and `update_meta_and_reindex` (the meta-write/reindex core). **`mutate_index` and `_index_lock` MUST stay reachable as `library_index.mutate_index` / `library_index._index_lock`** because two test files call `library_index.mutate_index(...)` directly (landmine below).
- **`folders.py`**: `create_folder`, `rename_folder`, `delete_folder`, `_find_folder`, `_subtree_ids`.
- **`paper_org.py`**: `move_papers`, `trash_papers`, `restore_papers`, `star_papers`, `unstar_papers`, `purge_entry`, and the ONE shared `_apply_to_papers(index, doc_ids, apply)` helper (build `papers_by_id`, validate-missing → `DocumentNotFoundError`, then `apply(paper)` per id). The four bool-flippers become one-liners over that helper; `move_papers` uses it after its extra `folder_id` validation.

The facade (`storage/__init__.py`) re-exports the public names from wherever they land, so **every `storage.<fn>` call site stays byte-identical**. A "lighter dedupe-in-place" (just add `_apply_to_papers`, no module split) is rejected: the file already mixes two authorities (folder tree vs paper membership) and this is the last chance to separate them on a settled surface. But keep the shared index-core together (do not scatter the lock/`mutate_index` across modules — AL-7 wants one obvious serialized writer).

### 4. The cell-type registry IS the right seam; finish it so `PaperRow`'s per-key `switch` dies.

7.11 shipped `cellType` on `ColumnDef` plus a `cellType === "tag"` guard *before* a `switch (col.key)` in `PaperRow.renderCell`. Consolidate to the canonical descriptor/renderer seam: a registry keyed by column key (or a `render` on the descriptor) that maps each column to its cell renderer, so `PaperRow` becomes `visibleColumns.map(col => <Cell col={col} row={row} ... />)` with no `switch`. The bespoke columns (Title's Open+Star, DOI's link, Location's folder icon, File type's badge, Author's `TagCell`) each become a named renderer in the registry. Keep `cellType` for the coarse dispatch class where it earns its keep (tag vs text vs badge vs number for shared styling/sort), but the per-COLUMN markup lives in the registry, not an `if/switch` chain. Do not over-generalize into a data-driven column config DSL; a plain map from key → renderer component is the smallest correct structure.

## Reality corrections (the epic AC text was written against a stale snapshot)

Read these before starting; they prevent chasing ghosts.

- **The click-a-chip author FILTER was removed in Story 7.11** (user fix request, 2026-07-11: "it makes it hard to edit Authors"). `onFilterByAuthor` / `authorFilter` / `applyTagFilter` and the toolbar filter pill are **gone** (grep confirms none remain). `TagCell` renders authors as plain non-interactive `AuthorChips` that measure one line + a trailing "et al." overflow. **Do NOT resurrect the filter.** The tag COLUMN (chips + add/remove editor via `useAuthorsEdit`) is what ships and what AC-8's re-smoke covers ("a tag add/remove"), NOT a chip-click filter.
- **Line counts are larger than the epic's 2026-07-07 baseline:** `CollectionTable.tsx` is **950** (epic said 629), `LibraryPage.tsx` **466**, `library_index.py` **478** (epic said 453). The story ACs above use the true current numbers.
- The generic 7.4 `FilterMenu`/`ColumnFilter` was already removed in 7.4 (grep: none). Only **Display** (hide columns) + **Sort** + the persisted **layout** (order/visibility/widths) exist. No filter surface to refactor.

## Tasks / Subtasks

> Server and client are independent; either can be done and PR'd first. On the server side, regenerate the contract and confirm `schema.d.ts` is byte-identical after any model-adjacent touch (there should be none this story).

- [x] **Task 1: Split `library_index.py` into an index-core + `folders.py` + `paper_org.py` behind the byte-identical facade (AC: 5, 7, 9)**
  - [x] Create `server/app/storage/paper_org.py` for the set-based mutators (`move_papers`, `trash_papers`, `restore_papers`, `star_papers`, `unstar_papers`, `purge_entry`) and `server/app/storage/folders.py` for the folder-tree ops (`create_folder`, `rename_folder`, `delete_folder`, `_find_folder`, `_subtree_ids`). Keep the index-core (`_index_lock`, `mutate_index`, `_read_index_unlocked`, `_write_index`, `_default_index`, `read_library`, `_cache_from_meta`, `upsert_paper_entry`, `_next_order`, `reconcile_library`, `update_meta_and_reindex`) in `library_index.py` (both new modules import from it).
  - [x] Consolidate the four bool-flip mutators' repeated shape into ONE `_apply_to_papers(index, doc_ids, apply)` helper (build `papers_by_id` → validate-missing raises `DocumentNotFoundError(first)` → `apply(paper)` per id). `trash`/`restore`/`star`/`unstar` become one-line `apply` lambdas over it; `move_papers` calls it after the `folder_id` `FolderNotFoundError` check. Preserve the exact all-or-nothing validate-before-mutate semantics and the "first missing id" detail string.
  - [x] Update `storage/__init__.py` to re-export the moved names from their new homes (`from app.storage.folders import ...`, `from app.storage.paper_org import ...`). The public `__all__` and every `storage.<name>` call site stay byte-identical.
  - [x] **Landmine (see Dev Notes):** `test_library.py` (`from app.storage import library_index; library_index.mutate_index(...)`, line 118) and `test_storage.py` (lines 953/997/1135) call `library_index.mutate_index` DIRECTLY, and `test_storage.py` monkeypatches `meta_store.read` (module-qualified). Keep `mutate_index`/`_index_lock` in `library_index` (reachable as `library_index.mutate_index`) and keep `update_meta_and_reindex` calling `meta_store.read` module-qualified, or repoint those test imports. Do not let a mover silently break the TOCTOU guard tests. **Done: both stayed in `library_index`; also repointed `documents.py`'s `purge_entry` call (the one non-test caller) to `paper_org`.**
  - [x] Run `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q` (host); `test_library.py`, `test_storage.py`, `test_docs.py`, `test_models.py` all green. **290 passed.**

- [x] **Task 2: Dedup `routes/library.py` set-op handlers + `responses=` map (AC: 6, 7, 9)**
  - [x] Consolidate the byte-identical `responses={404,422,500}` map shared by `trash`/`restore`/`star`/`unstar` into one shared constant (a `_SET_OP_RESPONSES` built from the existing `error_response(...)` factory in `_errors.py`; the per-map detail strings "An unknown document id." / "doc_ids must be non-empty." / "Could not update the collection." are the contract, keep them byte-identical).
  - [x] Consolidate the four identical handler bodies (`with storage_errors("Could not update the collection"): return storage.X_papers(body.doc_ids)`) to one thin dispatch shape (a `_set_op(mutate, doc_ids)` helper). Keep each as its own decorated route (FastAPI needs the distinct path + `operationId`), but the body is one shared call. The `move` route stays explicit (its `extra_not_found=[(FolderNotFoundError, ...)]` differs); folder CRUD routes stay explicit. `get_library` unchanged.
  - [x] Regenerate the contract (Task 6) and assert `openapi.json` diff is EMPTY except `info.version`. **Verified byte-identical except `info.version`.**

- [x] **Task 3: Collapse the near-twin org-op hooks onto `useOptimisticLibraryOp` (AC: 3, 7, 9)**
  - [x] Create `client/src/library/useOptimisticLibraryOp.ts`: the shared machinery for the set-based ops (`mountedRef` StrictMode-safe reset + a monotonic `opSeqRef` + the optimistic-patch → `apiFn` → `setLibrary(returnedLibrary)` reconcile → revert-`prior` + `onToast(errorCopy)` skeleton, plus an optional success toast). A hook returning a stable `run(op, arg)` the verbs configure with an `OptimisticOp` descriptor, plus `patchField`/`removeRow` patch builders (decision 1).
  - [x] Re-express `useMovePapers`, `useTrashPapers` (trash/restore + `purge` as the row-remove variant), `useStarPapers` (star/unstar) as thin configurations of the seam. Preserved exactly: the per-verb error copy, the `restore` success toast ("restored from Trash", "info"), the star's silent success, and `purge`'s splice-back-at-index revert. Each still returns the same named callbacks so `LibraryPage` and the existing tests are unaffected.
  - [x] Field-edit hooks (`useInlineEdit`/`useAuthorsEdit`): left as the two focused siblings (decision 1 - they reconcile from a single `Doc`, revert a value, guard with a keyed `editSeqRef` Map); added a cross-ref comment in `useInlineEdit` explaining why they stay separate.
  - [x] Their colocated `.test.ts` files import the hooks directly; kept green (no import moved - the hooks kept their filenames + exports). No `vi.mock` barrel involved. **25 org-hook tests pass.**

- [x] **Task 4: Decompose `CollectionTable` (AC: 1, 4, 7, 8, 9)**
  - [x] Extracted `ColumnHeader.tsx` (`ColumnGroup`+`ColumnHeaderCell`+`TableHead`+header helpers+`sumColumnWidths`), `useColumnDrag.ts` (frozen-geometry machinery + `dropIndicator` + `livePreviewColumns`/`displayColumns`), `useRowSelection.ts` (plain/Ctrl/Shift model + `anchorRef` + `suppressClickRef`), `dragPreview.ts` leaf, and `TableSkeleton.tsx` into their own files under `CollectionTable/`. `CollectionTableProps` and the public surface stay unchanged.
  - [x] Preserved EXACTLY (documented shipped-bug fixes): the capture-phase selection interception + Shift `preventDefault`, the `suppressClickRef` blur-vs-click discipline, the frozen-geometry column-drag oscillation fix, the `data-checked`/`aria-selected` derivation, and the `handleDragStart` input/button/anchor bail-out. Doc comments moved with the code verbatim.
  - [x] Consolidated the cell-type dispatch (AC-4): `PaperRow.renderCell`'s `cellType==="tag"` guard + `switch(col.key)` became `CELL_RENDERERS` (a `cells.tsx` registry, key → renderer), so `PaperRow` maps columns to renderers with no `switch`. `TagCell`/`EditableCell` stay the leaf renderers. `PendingRow` keeps its own per-column empty-cell logic (smaller than sharing the registry with a pending flag).
  - [x] CSS stayed in `CollectionTable.css` (imported by the extracted files); `no-raw-values.test.ts` green (111→122 tests, +11 = the new modules, all pass). No em-dash introduced (verified by grep).
  - [x] `cd client && npm run typecheck && npm test` green.

- [x] **Task 5: Reduce `LibraryPage` to a composition root + column model tidy (AC: 2, 4, 7, 9)**
  - [x] Extracted the pure per-lens helpers (`emptySelectionMessage`, `selectionLabel`, `purgeDialogTitle`, `isPdfFile`) and the folder-hides-Location `visibleColumnsForSelection` derivation into `libraryLens.ts` (pure, React-free, AD-L3). Extracted the toolbar (count line + `DisplayMenu` + the trash-vs-non-trash button branch + `AddMenu`) into a `LibraryToolbar` component. `LibraryPage` keeps the hook wiring + drop target + table render; behavior byte-identical.
  - [x] Column model (AC-4): the persisted `reconcile` already lives in ONE leaf (`tableViewPrefs.ts`). Split `tableView.ts`'s three fused concerns into coherent leaves: descriptor stays in `tableView.ts`, sort transform → `columnSort.ts` (`sortRows`/`sortKey`/`compareForSort`), reorder transform → `columnReorder.ts` (`moveColumn`/`reorderColumns`/`pinTitleFirst`). `MIN/MAX_COLUMN_WIDTH` stay in `tableView.ts` (no cycle). No transform behavior changed.
  - [x] Selection/handler shape: left the "run op, then clear selection" handlers as-is (a shared helper wasn't clearer - optional per the task).
  - [x] `cd client && npm run typecheck && npm test` green.

- [x] **Task 6: Contract-identical + suites-green verification (AC: 8)**
  - [x] Server: `PYTHONPATH= uv run python -m app.export_openapi`; `openapi.json` diff vs baseline is ONLY `info.version` (0.5.10 → 0.5.11), no schema/path/response change.
  - [x] Client: `npm run gen:api` regenerated `client/src/api/schema.d.ts`; `git diff --stat` is EMPTY (byte-identical, committed).
  - [x] Full suites: backend 290 passed (host); client 1376 passed (baseline was 1365, not the story's estimated 1377; the +11 is `no-raw-values.test.ts`'s per-file generation over the 11 new modules) + `npm run typecheck` clean; `no-raw-values.test.ts` green.
  - [x] `docs/API.md`: NO change (contract-identical, confirmed).

- [x] **Task 7: Live re-smoke (AC: 8)**
  - [x] Launched OWN fresh servers (isolated scratch `PAPER_MATE_DATA`, uvicorn:8123 + vite:5199), never a user/Docker one. Confirmed `/api/health` reported the fresh `0.5.11`. Torn down after.
  - [x] Re-smoked the Epic 7 surface end-to-end (via Playwright): imported 2 multi-author PDFs (Crossref-enriched); selected + batch-moved into folder "Anomaly" (row left Recent, appeared in folder); opened the folder (Location column hidden, headers still interactive); starred a row (marker rendered fully, no clip - screenshot verified) and Starred lens showed it; Trashed a row, Trash lens showed the Restore/Purge toolbar branch, restored it ("restored from Trash" toast + "Trash is empty." empty-copy); reordered a column (Year before Venue via header menu) + RELOADED → layout persisted; added ("Test Author") + removed ("Vuong Le") an author chip → persisted across reload AND server-side (verified via `/api/library`); toolbar showed the trash-vs-non-trash branch correctly. One dev-only console warning ("Expected static flag was missing" @ `@vite/client`) is a known React-19+Vite HMR artifact, absent from prod, unrelated to the refactor.

- [x] **Task 8: Version + status (AC: 8)**
  - [x] Bumped PATCH in `server/pyproject.toml` (`0.5.10` → `0.5.11`); re-ran `uv lock`. Only version touch; no MAJOR/MINOR, no schema-version change.
  - [ ] **Cross-model Codex `bmad-code-review` (AE-6)** on the diff; resolve High/Med before done. (Runs after dev-story per the workflow.)
  - [x] Branch `story-7-12-epic-7-structural-refactor` off `main` (cut at create-story). Flipped `sprint-status.yaml` `7-12-epic-7-structural-refactor` → `done` (AE3-1: normally at PR merge; flipped early on user request). This is the LAST Epic 7 story: Epic 7 can now close.

## Dev Notes

### What this story is (and is not)

- **Is:** a structure-only refactor of the settled Epic 7 surface. Split the 950-line table into cohesive units, collapse the near-twin org-op hooks onto one seam, finish the cell-type registry, separate the backend folder vs paper-org modules, dedup the route handlers, delete dead code.
- **Is not:** any behavior, API, schema, or UX change. The gate is BYTE-IDENTICAL contract (`openapi.json` sans `info.version` + `schema.d.ts`) and green suites. If either regenerated file differs beyond the version bump, you changed behavior: that is a bug in the refactor, not an expected diff.
- Precedent to imitate: Stories 5.0, 5.3, 5.4 (client structural refactors), 6.8 (the Epic 6 twin of this story: storage package split behind a byte-identical facade + client `library/` decomposition). Read 6.8's Dev Agent Record: it is the closest template, down to the `meta_store.read` monkeypatch landmine.

### Current state of the files being refactored (read these before touching)

**`server/app/storage/library_index.py` (478 lines) — the sole `library.json` writer (AL-7).** Concerns fused in one file:
1. **Index core:** `_index_lock` (RLock), `mutate_index` (the ONE serialized read-modify-write), `_read_index_unlocked`/`_write_index`/`_default_index`, `read_library`, `_cache_from_meta` (projects DocMeta → the cached row incl. 7.9 doi/venue/year + 7.11 `authors_list`), `upsert_paper_entry`, `_next_order`.
2. **Folder tree:** `create_folder`, `rename_folder`, `delete_folder` (subtree re-home via `_subtree_ids`), `_find_folder`.
3. **Set-based paper-org mutators:** `move_papers`, `trash_papers`, `restore_papers`, `star_papers`, `unstar_papers`, `purge_entry` — the four bool-flippers are byte-for-byte the same shape (build `papers_by_id` → `missing` check → `DocumentNotFoundError(missing[0])` → flip one field per id inside a `mutate_index` closure). `move_papers` adds a `folder_id` `FolderNotFoundError` check and sets `folder_id` instead of a bool.
4. **Meta-write core + reconcile:** `update_meta_and_reindex` (re-read `meta.json` module-qualified via `meta_store.read` → re-validate DocMeta → TOCTOU purge-guard → `meta_store.write(create_parents=False)` → `mutate_index(upsert_paper_entry)`, all under `_index_lock`), `reconcile_library`.

The one hard invariant: `_index_lock`/`mutate_index` stay the single serialized `library.json` writer (AL-7); a background extraction cache-refresh must never interleave with a user move/trash/restore. Keep them together in the index-core.

**`server/app/routes/library.py` (197 lines) — thin controllers.** `get_library` (distinct 500) + folder CRUD (`create`/`rename`/`delete`, each with its own `responses=`) + `move` (two distinct 404s via `extra_not_found`) + the four set-op routes (`trash`/`restore`/`star`/`unstar`) whose `responses=` maps and handler bodies are byte-identical. The `_errors.py` helpers (`error_response(description)`, `storage_errors(server_error, *, not_found=..., not_found_detail=..., extra_not_found=...)`) already exist from 6.8; reuse them, do not re-invent an error seam.

**`client/src/library/CollectionTable/CollectionTable.tsx` (950) — rows in, DOM out.** Module-level: pure helpers (`columnClassSuffix`, `ariaSortValue`, `sumColumnWidths`), drag-preview builders (`buildDragPreview`, `buildColumnDragPreview`, `COLUMN_DRAG_MIME`), the pure `livePreviewColumns`, `ColumnGroup`, the ~220-line `ColumnHeaderCell` (dropdown menu + drag-reorder + resize handle), `TableHead`, `TableSkeleton`, `CollectionTableProps` (a discriminated union). The `CollectionTable` fn: controlled-or-uncontrolled selection, `anchorRef` + the three-gesture click model (capture-phase), the column-drag lifted state + frozen-geometry resolver, `suppressClickRef`/`consumeSuppressedClick`, `commitEdit`/`commitAuthors`, `handleDragStart`, and the render. Every `useRef`/`useEffect` here has a load-bearing doc comment tied to a shipped bug — carry them verbatim.

**`client/src/library/LibraryPage.tsx` (466) — composition + toolbar.** Pure helpers (`emptySelectionMessage`, `selectionLabel`, `isPdfFile`, `purgeDialogTitle`); the hook wiring (`useCollection`/`useInlineEdit`/`useAuthorsEdit`/`useMovePapers`/`useTrashPapers`/`useStarPapers`/`useColumnWidths`/`useResizablePanel`/`useTableView`); selection state + the "run op, clear selection" handlers; derived view-state (`visiblePapers` = `applyTableView(filterPapers(...))`, the folder-hides-Location `visibleColumns`, `selectedRows`/`allStarred`, `recentGroups`, `visiblePending`); the two-branch toolbar JSX; the file inputs + dropzone + table render + toast + confirm dialog.

**`client/src/library/tableView.ts` (189) + `tableViewPrefs.ts` (135) + `useTableView.ts` (59) + `useColumnWidths.ts` (127) + `useDragResize.ts` (120) — the column model.** `tableView.ts` fuses three pure concerns (descriptor + sort transform + reorder transform) plus the width-clamp constants. `tableViewPrefs.ts` is already a cohesive persisted-store leaf (the degrade-safe `reconcile` + the Zustand `persist` store). `useTableView` binds prefs + local `sort` + `folderNameById` → `visibleColumns`/`applyTableView`. `useColumnWidths`/`useDragResize` own the resize interaction. The cell-type RENDERER dispatch is NOT here — it is in `PaperRow.renderCell` (a `cellType==="tag"` guard before a per-key `switch`), which AC-4 wants consolidated.

### The near-twin analysis (AC-3, the sharpest duplication)

Five hook methods are one skeleton. `movePapers` (`useMovePapers`), `trashPapers`/`restorePapers` (`useTrashPapers`), `starPapers`/`unstarPapers` (`useStarPapers`) each do:
```
const seq = ++opSeqRef.current;
const prior = new Map<string, T>();               // capture per-row prior value
setLibrary(prev => patch matching rows, recording prior);
apiFn(...).then(library => { if (stale) return; setLibrary(library); [successToast?] })
          .catch(() => { if (stale) return; setLibrary(revert from prior); onToast(errorCopy) });
```
Only the patched field (`folder_id`/`trashed`/`starred`), the new value, `apiFn`, the error copy, and an optional success toast differ. `mountedRef` + `opSeqRef` + the StrictMode reset effect are copy-pasted in all three files. `purge` (in `useTrashPapers`) is the row-REMOVE variant: it captures `removedRow`+`removedIndex` and splices back on revert, but shares `mountedRef`/`opSeqRef`/the stale guard. One `useOptimisticLibraryOp` seam ends this (decision 1).

### TWO backend test landmines (will silently break or no-op the refactor)

1. **`test_library.py` + `test_storage.py` call `library_index.mutate_index(...)` DIRECTLY** (`test_library.py:118`, `test_storage.py:953/997/1135`, via `from app.storage import library_index`). If `mutate_index` moves to a new module, these break. Keep `mutate_index` (and `_index_lock`) in `library_index` (the index-core), or repoint those imports in the same change.
2. **`test_storage.py` monkeypatches `meta_store.read`** (lines ~671/776/862: `monkeypatch.setattr(meta_store, "read", read_then_purge)`) to simulate a purge in the TOCTOU window, expecting `update_meta_and_reindex` to call the patched name. Because the production code calls `meta_store.read(doc_dir)` module-qualified, the patch bites regardless of where `update_meta_and_reindex` lives — but do NOT change it to a direct `from .meta_store import read` import, or the patch stops biting and the guard test false-greens.

### Standing conventions that gate this story (CLAUDE.md)

- **Contract types are generated, never hand-authored.** After any server touch: `uv run python -m app.export_openapi` → `openapi.json`, then client `npm run gen:api` → `schema.d.ts`. For THIS story both must come out byte-identical (only `info.version` moves in `openapi.json`). `schema.d.ts` is committed; `openapi.json` is a gitignored build artifact.
- **`vi.mock` barrels stay in sync.** Any moved module referenced by a `vi.mock(...)` factory must update every barrel in the same change (the `render/` barrels in `App.test.tsx`/`Reader.test.tsx` are the canonical case). Audit: the library tests currently mock `@/api/client` only (no intra-library barrel), so a client move just needs the test's direct import repointed — but verify before committing.
- **Tokens only in UI; no raw hex/px outside `src/theme/**`.** Moving any CSS must keep `no-raw-values.test.ts` green.
- **No em-dash in any user-facing string** (tooltips/labels/aria/copy/toasts). Comments are exempt. Grep touched UI strings for the em-dash character before committing.
- **Document-level, phase-gated interaction handlers** (not canvas-bound). Not central here, but do not "fix" any handler binding while moving code; preserve the existing binding sites and the capture-phase selection discipline.
- **Backend suite is run-it-yourself under the Codex review sandbox** (AE-7/AE3-4): `export UV_CACHE_DIR=/tmp/uv-cache`; `TestClient`-backed tests can hang in the sandbox. A reviewer verifies backend findings by reading; the human runs pytest on the host. This story DOES change backend structure (not behavior), so run the backend suite yourself on the host.
- **Launch your OWN dev servers for smoke** (AE-5 / the "found-running server is stale" rule): a user/Docker server predates your edits. Fresh `uvicorn` + `vite dev` on alternate ports against a scratch `PAPER_MATE_DATA`, torn down after.

### Commands (copy-paste)

- Backend tests: `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q`
- Regen contract: `cd server && PYTHONPATH= uv run python -m app.export_openapi` then `cd client && npm run gen:api`; `schema.d.ts` git diff must be EMPTY, `openapi.json` diff must be ONLY `info.version`.
- Frontend tests: `cd client && npm test` | Typecheck: `cd client && npm run typecheck`
- Dev servers (own, for smoke): `cd server && uv run uvicorn app.main:app --reload --port <alt>` and `cd client && npm run dev` (set `PAPER_MATE_API_TARGET` + an isolated scratch `PAPER_MATE_DATA`; alt ports).

### Testing standards

- Backend: pytest (no plugins). Keep every existing test green; move-follow a test where a module split relocates the symbol under test. The two landmines above are mandatory to resolve.
- Client: Vitest + Testing Library. Colocated `.test.tsx` moves with its component; the op-hook `.test.ts` files import the hooks directly (repoint on move). Keep coverage; do not delete a test to make a move easier.
- The refactor's own success test is the byte-identical contract + green suites + the live re-smoke. There is no new feature to test; there is existing behavior to prove unbroken.

### Project Structure Notes

- **Server target (suggested, not mandated verbatim):** `server/app/storage/{library_index (index-core: lock/mutate_index/read_library/_cache_from_meta/upsert/update_meta_and_reindex/reconcile), folders, paper_org}.py`; `routes/library.py` slimmed with a shared `_SET_OP_RESPONSES` + a one-body set-op dispatch, reusing `_errors.py`'s `error_response`/`storage_errors`.
- **Client target (suggested):** `client/src/library/CollectionTable/{CollectionTable (shell), ColumnHeader, TableHead, TableSkeleton, useColumnDrag, useRowSelection, dragPreview, cells registry, PaperRow, PendingRow, EditableCell, TagCell, TagEditor}`; `client/src/library/{LibraryPage, LibraryToolbar/, libraryLens.ts (pure per-lens copy + columns), useOptimisticLibraryOp, tableView (descriptor + sort + reorder leaves), tableViewPrefs (persisted store), useTableView, useColumnWidths, useDragResize}`. Follow the `reader/` feature-dir precedent (Story 5.4): a route feature keeps its page-specific hooks/leaves/subcomponents colocated, not scattered to the shared `components/`/`hooks/`/`lib/` homes.
- No new source dirs beyond the module splits; no new dependency; no schema/version-format change. Downward-layering (AD-9) must hold: `routes/` → `storage`; storage is the sole `~/.paper-mate` writer; the client view-state leaves (`folderFilter`, the column model, `reconcile`) stay pure/React-free (AD-L3).
- Only external importer of the client `library/` page: `client/src/routes/router.tsx` (`@/library/LibraryPage`). Everything else is intra-`library/`. Use `git mv` to preserve blame.

### References

- [Source: .bmad/planning-artifacts/epics.md#Story 7.12] (lines 1871-1908) — story statement + the 9 Given/Then ACs + the out-of-scope + open-design-calls list.
- [Source: .bmad/planning-artifacts/sprint-change-proposals/sprint-change-proposal-2026-07-08-refactor-resequence.md] — the correct-course that made this the LAST Epic 7 story and widened its scope to the 7.9/7.10/7.11 debt.
- [Source: .bmad/implementation-artifacts/epic-6/6-8-epic-6-structural-refactor.md] — the closest precedent (storage package split behind a byte-identical facade + client decomposition); its Dev Agent Record documents the `meta_store.read` monkeypatch landmine and the byte-identical-contract discipline.
- [Source: .bmad/implementation-artifacts/epic-7/7-11-author-tag-column.md] — the immediate predecessor; its Dev Agent Record records the author-FILTER reversal (AC-5 removed) and the `AuthorChips` one-line + "et al." overflow that ships now.
- [Source: server/app/storage/library_index.py] — the 478-line module to split; the `_index_lock`/`mutate_index`/`update_meta_and_reindex` invariants + the four near-twin bool-flip mutators.
- [Source: server/app/storage/__init__.py] — the facade whose `__all__` must keep re-exporting every moved name unchanged.
- [Source: server/app/routes/library.py] — the four byte-identical set-op handlers + `responses=` maps to dedup; [Source: server/app/routes/_errors.py] — the existing `error_response`/`storage_errors` seam to reuse.
- [Source: server/tests/test_library.py, test_storage.py] — the two landmines (`library_index.mutate_index` direct calls + the `meta_store.read` monkeypatch).
- [Source: client/src/library/CollectionTable/CollectionTable.tsx] — the 950-line component to decompose; [Source: .../PaperRow.tsx] — the `cellType==="tag"` guard + per-key `switch` to consolidate into a renderer registry.
- [Source: client/src/library/LibraryPage.tsx] — the 466-line composition root; the pure lens helpers + two-branch toolbar to extract.
- [Source: client/src/library/useMovePapers.ts, useTrashPapers.ts, useStarPapers.ts] — the near-twin optimistic org-op hooks; [Source: .../useInlineEdit.ts, useAuthorsEdit.ts] — the related-but-distinct field-edit family.
- [Source: client/src/library/tableView.ts, tableViewPrefs.ts, useTableView.ts, useColumnWidths.ts, useDragResize.ts] — the column model to make coherent.
- [Source: .bmad/planning-artifacts/architecture/architecture-paper-mate-library-2026-07-04/ARCHITECTURE-SPINE.md] — AD-9 downward layering, AD-L2 (domain no-storage-import), AD-L3 (client view-state lenses, React Router library mode), AD-L6 (docs vs library API boundary), AD-L7/AL-7 (single serialized `library.json` writer).
- [Source: CLAUDE.md] — contract-gen, `vi.mock` barrels, `no-raw-values`, no em-dash, own-dev-server smoke, backend-sandbox caveat, versioning (PATCH +1 at story done → 0.5.11), branch-per-story, flip `sprint-status.yaml` at merge, fill the Dev Agent Record before done. Memory: `prefer-stable-solutions`, `no-emdash-user-facing`, `icon-button-swallowed-by-exempt-check` (click-propagation in cells — relevant to the selection model move).

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Opus 4.8), bmad-dev-story workflow.

### Debug Log References

- Backend suite (host): `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q` → 290 passed (baseline 290, unchanged), after the storage split and after the version bump.
- Contract: `PYTHONPATH= uv run python -m app.export_openapi` then `diff` vs a pre-refactor `openapi.json` snapshot → identical except `info.version` (0.5.10 → 0.5.11). `npm run gen:api` → `git diff --stat client/src/api/schema.d.ts` EMPTY (byte-identical).
- Client: `npm run typecheck` clean; `npm test` → 1376 passed / 67 files (baseline 1365; the +11 is `no-raw-values.test.ts` generating one test per source file over the 11 new modules, each green). Verified the delta is exactly `no-raw-values` via a stash-and-recount and a per-file JSON-reporter diff.
- Live smoke: own uvicorn:8123 (scratch `PAPER_MATE_DATA`) + vite:5199, `/api/health` = `{"status":"ok","version":"0.5.11"}` (confirms fresh server). Driven via Playwright; all Epic 7 paths green (see Task 7). Servers torn down.

### Completion Notes List

Pure structure-only refactor of the settled Epic 7 surface. No behavior/API/schema/UX change; the success gate (byte-identical `openapi.json` sans `info.version` + byte-identical `schema.d.ts` + green suites + a live re-smoke) is met.

- **Server (Tasks 1-2):** `library_index.py` split into an index-core (kept the sole `_index_lock`/`mutate_index` serialized `library.json` writer, `read_library`, `_cache_from_meta`, `upsert_paper_entry`, `reconcile_library`, `update_meta_and_reindex`, AL-7) + `folders.py` (folder-tree ops) + `paper_org.py` (set-based mutators). The four bool-flip mutators collapsed onto ONE `_apply_to_papers(index, doc_ids, apply)` helper preserving the all-or-nothing validate-before-mutate + "first missing id" detail. Facade `storage/__init__.py` re-exports from the new homes so every `storage.<fn>` call site stayed byte-identical. Landmines held: `mutate_index`/`_index_lock` stayed in `library_index` (tests call them directly), `update_meta_and_reindex` still calls `meta_store.read` module-qualified (the TOCTOU monkeypatch still bites); also repointed `documents.py`'s single `purge_entry` call to `paper_org` (it holds `library_index._index_lock`, an RLock, so still reentrant). `routes/library.py` deduped: one `_SET_OP_RESPONSES` constant + a `_set_op(mutate, doc_ids)` dispatch for trash/restore/star/unstar; move + folder CRUD stayed explicit.
- **Client hooks (Task 3):** one `useOptimisticLibraryOp` seam (hook returning a stable `run(op, arg)` bound to one `mountedRef` + monotonic `opSeqRef`), plus `patchField`/`removeRow` patch builders. `useMovePapers`/`useTrashPapers`(+purge)/`useStarPapers` are now thin descriptors over it; verbs that must not clobber each other share ONE `run`. Field-edit hooks (`useInlineEdit`/`useAuthorsEdit`) left separate (distinct `Doc`-reconcile + keyed `editSeqRef`), with a cross-ref comment (decision 1).
- **Client table (Task 4):** `CollectionTable/` decomposed into `ColumnHeader`, `TableSkeleton`, `useColumnDrag`, `useRowSelection`, `dragPreview`, and a `cells.tsx` `CELL_RENDERERS` registry that kills `PaperRow`'s `cellType`-guard-plus-`switch` (AC-4). Every load-bearing doc comment (oscillation fix, suppress-click discipline, capture-phase selection) carried verbatim. Public `CollectionTableProps` unchanged.
- **Client page + column model (Task 5):** `libraryLens.ts` (pure per-lens copy + `visibleColumnsForSelection`) and `LibraryToolbar` (the trash-vs-non-trash branch) extracted from `LibraryPage`. `tableView.ts`'s three fused concerns split into descriptor (`tableView.ts`) + `columnSort.ts` + `columnReorder.ts`; `MIN/MAX_COLUMN_WIDTH` stay in the descriptor (no cycle).
- **AD-9 layering respected:** no upward imports; storage stays the sole data-root writer with one serialized `library.json` writer; the new client leaves (`libraryLens`, `columnSort`, `columnReorder`) are pure/React-free (AD-L3). Only external importer of the page (`router.tsx`) is unaffected.
- **Observed (not a regression):** a dev-only React warning ("Expected static flag was missing" @ `@vite/client`) appears under Vite HMR; it is a known React-19/Vite dev artifact, absent from prod builds, unrelated to this refactor.

### File List

**Server (modified):**
- `server/app/storage/library_index.py` (trimmed to the index-core)
- `server/app/storage/__init__.py` (facade re-exports from new homes)
- `server/app/storage/documents.py` (repointed `purge_entry` → `paper_org`)
- `server/app/routes/library.py` (`_SET_OP_RESPONSES` + `_set_op` dispatch)
- `server/pyproject.toml` (version 0.5.10 → 0.5.11)
- `server/uv.lock` (re-locked)

**Server (new):**
- `server/app/storage/folders.py`
- `server/app/storage/paper_org.py`

**Client (modified):**
- `client/src/library/CollectionTable/CollectionTable.tsx` (shell, composes the extracted pieces)
- `client/src/library/CollectionTable/PaperRow.tsx` (maps through `CELL_RENDERERS`, no switch)
- `client/src/library/LibraryPage.tsx` (thin composition root)
- `client/src/library/useMovePapers.ts`, `useTrashPapers.ts`, `useStarPapers.ts` (thin configs of the seam)
- `client/src/library/useInlineEdit.ts` (cross-ref comment)
- `client/src/library/useTableView.ts`, `tableViewPrefs.ts` (repointed to the transform leaves)
- `client/src/library/tableView.ts` (trimmed to the column descriptor)
- `client/src/library/tableView.test.ts` (repointed transform imports)

**Client (new):**
- `client/src/library/useOptimisticLibraryOp.ts`
- `client/src/library/CollectionTable/ColumnHeader.tsx`
- `client/src/library/CollectionTable/TableSkeleton.tsx`
- `client/src/library/CollectionTable/useColumnDrag.ts`
- `client/src/library/CollectionTable/useRowSelection.ts`
- `client/src/library/CollectionTable/dragPreview.ts`
- `client/src/library/CollectionTable/cells.tsx`
- `client/src/library/LibraryToolbar.tsx`
- `client/src/library/libraryLens.ts`
- `client/src/library/columnSort.ts`
- `client/src/library/columnReorder.ts`

**Planning (modified):**
- `.bmad/implementation-artifacts/sprint-status.yaml` (7-12 → in-progress → review)

### Change Log

- 2026-07-11: Epic 7 structural refactor implemented (Stories 5.0/5.3/5.4/6.8 precedent). Server: `library_index.py` → index-core + `folders.py` + `paper_org.py` behind the byte-identical `storage` facade, four bool-flip mutators onto one `_apply_to_papers` helper, `routes/library.py` set-op handlers/`responses=` deduped. Client: near-twin org-op hooks → one `useOptimisticLibraryOp` seam; `CollectionTable` decomposed (`ColumnHeader`/`TableSkeleton`/`useColumnDrag`/`useRowSelection`/`dragPreview`/`cells` registry) with `PaperRow`'s `switch` retired for AC-4; `LibraryPage` reduced to a composition root (`libraryLens`/`LibraryToolbar`); `tableView.ts` split into descriptor + `columnSort` + `columnReorder`. Contract byte-identical (openapi diff = `info.version` only; `schema.d.ts` unchanged). Suites green (backend 290, client 1376, typecheck, no-raw-values). Live re-smoke passed. Version 0.5.10 → 0.5.11. Status → review.
