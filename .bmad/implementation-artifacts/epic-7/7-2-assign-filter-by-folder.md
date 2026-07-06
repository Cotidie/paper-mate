---
baseline_commit: 9c91dc20be466699ad9ac247f86dbdf3d20bbf0d
---

# Story 7.2: Assign and filter by folder

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a reader,
I want to put a paper in a folder and click a folder to see only its papers,
so that I can narrow the collection to what I am working on.

## Acceptance Criteria

**Given** a folder in the panel
**When** I select it
**Then** the table filters to that folder's papers as VIEW-STATE inside the Library route (not a route change) (LFR-14, AL-3)

**Given** All
**When** selected
**Then** every non-trashed paper shows; **Given** Uncategorized selected **Then** only papers with no folder show (LFR-13, L-UX-DR4)

**Given** a paper
**When** I move it to a folder (move action or drag)
**Then** its membership updates via `POST /api/library/move` and it belongs to at most one folder (a move replaces any prior folder) (LFR-13, LFR-15, AL-5, AL-6)

**Given** the move persists
**Then** `library.json` membership updates under the serialized write path (AL-7)

**Given** the selected folder
**Then** it is highlighted `{colors.surface-strong}` in the panel (L-UX-DR4)

## Scope boundary (read first, prevents scope creep)

This story builds **the `POST /api/library/move` endpoint, single-paper move, and folder-selection filtering (view-state)**. It does NOT build:

- **Multi-select checkboxes + batch move** → Story 7.3. BUT the move endpoint you build here MUST be the set-based `{doc_ids}` shape (AD-L6) so 7.3 reuses it with no contract change. In 7.2 you call it with a one-element `doc_ids`. Do not build a single-id-only endpoint.
- **Display / Sort / Filter-by-column controls** → Story 7.4. The folder-selection filter here is a folder lens, not the column filter/sort UI.
- **Trash lens + soft-delete** → Story 7.5. `Trash` and `Recent` stay inert placeholders (as they already are). Do NOT wire them. You DO exclude `trashed` papers from the All / Uncategorized / folder views (the base filter), because 7.5's Trash lens is the only place trashed papers show; the exclusion is a one-liner now that prevents a retrofit later.
- **Re-parenting folders, folder-into-folder drag** → out (nesting is set at CREATE, Story 7.1).

Keep `All` the resting default selection.

## Tasks / Subtasks

- [x] **Task 1 - Backend: `move_papers` in `storage/library_index.py` (AC: 3, 4)** - set-based, through the single serialized `mutate_index` writer (AL-7).
  - [x] `move_papers(doc_ids: list[str], folder_id: str | None) -> Library`: inside ONE `mutate_index` mutator (atomic under `_index_lock`): (a) if `folder_id is not None` and `_find_folder(index["folders"], folder_id) is None` → raise `FolderNotFoundError`; (b) validate EVERY id in `doc_ids` exists among `index["papers"]` (build a `{doc_id}` set once) → any miss raises `DocumentNotFoundError` BEFORE any mutation, so the move is all-or-nothing (no partial write); (c) for each paper whose `doc_id` is in the set, set `paper["folder_id"] = folder_id`. Never touch `trashed`, `order`, or any other paper. Return `read_library()` (mirrors `delete_folder` returning the whole updated `Library` so the client reconciles membership in one round-trip). A move to `folder_id=None` clears membership (assign to Uncategorized). Moving into the same folder is an idempotent no-op write.
  - [x] Re-export `move_papers` through `storage/__init__.py` and its `__all__` (sibling of `create_folder`/`rename_folder`/`delete_folder`). No new error class is needed: `FolderNotFoundError` and `DocumentNotFoundError` already exist in the taxonomy.

- [x] **Task 2 - Backend: `POST /api/library/move` in `routes/library.py` (AC: 3, 4)** - thin controller, mirror the folder handlers.
  - [x] Add `MoveRequest` to `models.py`: `doc_ids: list[str]`, `folder_id: str | None = None`, `model_config = ConfigDict(extra="forbid")`. Reject an empty `doc_ids` (a move of nothing is a client bug) - use `Field(min_length=1)` (or a `field_validator`) so it 422s. Generates a TS type (AD-3); do not hand-author.
  - [x] `POST /api/library/move` (body `MoveRequest`) → `Library`. The route has TWO distinct 404s: a bad `folder_id` (`FolderNotFoundError` → `"Folder not found"`) AND an unknown `doc_id` (`DocumentNotFoundError` → `"Document not found"`). The current `storage_errors` seam maps only ONE `not_found` type. Handle both - do NOT let a `FolderNotFoundError` fall through to a 500. **Preferred:** generalize `storage_errors` once more (it already grew `not_found`/`not_found_detail` in 7.1) with an additive, backward-compatible param, e.g. `extra_not_found: Sequence[tuple[type[StorageError], str]] = ()`, checked before the default; the move route passes `extra_not_found=[(storage.FolderNotFoundError, _FOLDER_NOT_FOUND)]` and keeps the default `DocumentNotFoundError → "Document not found"`. Existing callers (docs.py, the three folder routes) stay untouched. **Alternative (also acceptable):** catch `FolderNotFoundError` explicitly in the handler, delegate the rest to the default `storage_errors(...)`. Use `error_response(...)` in the `responses=` block (404 folder, 404 doc, 422 empty/malformed body, 500 storage) so the contract stays consistent.

- [x] **Task 3 - Contract regen (AC: 3)** - `cd server && PYTHONPATH= uv run python -m app.export_openapi`, then `cd client && npm run gen:api`. Confirm `MoveRequest` and the `POST /api/library/move` path appear in `client/src/api/schema.d.ts` (committed). Update `docs/API.md`: a new `### POST /api/library/move` resource entry (set-based `{doc_ids, folder_id}`, returns the updated `Library`, at-most-one-folder / move-replaces-prior semantics, the two 404s + 422) placed with the other `/api/library` resources, and a changelog line dated 2026-07-06 (Story 7.2).

- [x] **Task 4 - Client: `movePapers` in `api/client.ts` (AC: 3)** - mirror the folder api idiom exactly (fetch, `if (!res.ok) throw await envelopeError(res)`, typed return).
  - [x] `movePapers(docIds: string[], folderId: string | null): Promise<Library>` → `POST /api/library/move` with body `{ doc_ids: docIds, folder_id: folderId }`. Export `MoveRequest` from the generated-type block (sibling of `FolderCreate`/`FolderRename`). Import `Library` from the existing block.

- [x] **Task 5 - Client: folder-filter view-state + `useMovePapers` (AC: 1, 2, 3, 4)** - the selection is SHARED between the panel (highlight) and the table (which rows show), so it is lifted to `LibraryPage` (the composition root), not kept inside `FolderPanel` or `CollectionTable`.
  - [x] New small pure module `client/src/library/folderFilter.ts` (own unit test): a `FolderSelection` type - a discriminated union `{ kind: "all" } | { kind: "uncategorized" } | { kind: "folder"; id: string }` - plus `filterPapers(papers: CollectionRow[], selection: FolderSelection): CollectionRow[]`. Rule: exclude `trashed` in every case (base filter), then: `all` → all non-trashed; `uncategorized` → non-trashed with `folder_id == null`; `folder` → non-trashed with `folder_id == id`. Add a tiny `isSelected(selection, entry)` helper (or compare a stable key) for the panel's active-class.
  - [x] `useMovePapers({ setLibrary, onToast })` hook (mirror `useFolders`): `movePapers(docIds, folderId)` does an OPTIMISTIC membership set (immediately set `folder_id = folderId` on the matching rows via `setLibrary`, so the moved paper visibly leaves the current folder view), then replaces with the returned `Library` on resolve, and reverts (or re-fetches) on failure with a `"Couldn't move that paper."` error toast. Guard with a monotonic `moveSeqRef` (mirror `useFolders`'s `opSeqRef` / `useCollection`'s `fetchSeqRef`) and the StrictMode `mountedRef` latch (set `mountedRef.current = true` INSIDE the effect body - Epic 6 lesson, see Previous-story intelligence).

- [x] **Task 6 - Client: selection + filter wiring in `LibraryPage.tsx` (AC: 1, 2, 5)**
  - [x] Own `const [selection, setSelection] = useState<FolderSelection>({ kind: "all" })`; instantiate `useMovePapers`. Pass `selection` + `onSelect={setSelection}` to `FolderPanel`, and `folders` + `onMovePaper` to `CollectionTable`.
  - [x] Compute `const visiblePapers = filterPapers(papers, selection)` and pass `rows={visiblePapers}` to the populated `<CollectionTable>`. **Keep the layout gate `isTableLayout` on the TOTAL `papers.length` / `pending.length`, NOT the filtered set** - otherwise entering an empty folder in a non-empty library would collapse the table to the `EmptyDropzone` (a regression). Only the `rows` prop is filtered.
  - [x] Pending upload rows: pass `pendingRows={pending}` ONLY when `selection.kind` is `"all"` or `"uncategorized"` (a just-uploaded paper lands Uncategorized; it should not appear under an unrelated selected folder). Under a `folder` selection, pass no pending rows.
  - [x] Empty filtered view: when `visiblePapers.length === 0` (and no pending rows show) but the library is non-empty, render a quiet token-driven empty line (e.g. `No papers in this folder.` / `No uncategorized papers.`) instead of a header-only empty table. No em-dash. This is a small SHOULD; the `EmptyDropzone` stays reserved for the zero-library state only.
  - [x] The toolbar count (`{papers.length} files in library`) stays the TOTAL library size for this story (a per-folder count/label is 7.4 polish). Do not change it.

- [x] **Task 7 - Client: make `FolderPanel` entries selectable + highlighted (AC: 1, 2, 5)** - the panel becomes the filter's control surface.
  - [x] `FolderPanel` takes `selection: FolderSelection` + `onSelect: (s: FolderSelection) => void`. Make `All`, `Uncategorized`, and each folder row selectable; `Recent` and `Trash` stay inert (unchanged). `All` → `onSelect({ kind: "all" })`, `Uncategorized` → `onSelect({ kind: "uncategorized" })`, a folder → `onSelect({ kind: "folder", id })`.
  - [x] Drive `library-folder-panel__item--active` from `selection` instead of the current hard-coded `All`. Add the equivalent selected/active treatment to a selected `FolderRow` (a `folder-panel__row--active` or reuse the item-active token; `{colors.surface-strong}` per L-UX-DR4). **Correction to this task's own note:** `item--active` was NOT already surface-strong on disk (it was `--color-ink`/`--color-canvas`, a 7.1 placeholder for the always-active `All`); retargeted it to `--color-surface-strong`/`--color-ink` to actually match AC-5 and 7.1's own story file (which explicitly deferred the surface-strong highlight to 7.2).
  - [x] The pseudo-entries are currently non-focusable `<li>`. Make selectable entries keyboard-operable with a visible focus ring (L-UX-DR12): give them button semantics (a `<button>` inside the `<li>`, or `role="button"` + `tabIndex={0}` + Enter/Space handler) matching the a11y `FolderPanel` shipped in 7.1.
  - [x] `FolderRow`: the name label already stays a plain, non-interactive span "so Story 7.2's click-to-select can be added later without colliding with rename" (its own doc comment). Wire the name (or the row) to `onSelect`; the rename / add-subfolder / delete icon buttons MUST `stopPropagation` (or the handler must ignore clicks that originate on an action button) so an action click never also fires a select. Guard against the SVG-icon-child pitfall (`[[icon-button-swallowed-by-exempt-check]]`): test that clicking each action button does NOT change the selection.

- [x] **Task 8 - Client: single-paper move affordance in the table (AC: 3)** - REQUIRED path: a per-row "Move to folder" menu.
  - [x] Add a "Move to folder" control to a settled `PaperRow` (hover/focus-revealed, like the Open button), opening a small menu listing `Uncategorized` (clears membership) + each folder, each calling `onMovePaper(row.doc_id, targetFolderIdOrNull)`. **Reuse the `AddMenu` popover pattern** (`client/src/library/AddMenu/AddMenu.tsx`): a button with `aria-haspopup="menu"`/`aria-expanded`, a `role="menu"` popover of `role="menuitem"` buttons, document-level `pointerdown`/`Escape` dismiss (CLAUDE.md: document-level handlers), focus returns to the button on close. Do NOT reinvent a menu (`[[prefer-stable-solutions]]`). Thread `folders` + `onMovePaper` from `CollectionTable` down to `PaperRow`. Keep `CollectionTable` presentational; `LibraryPage` owns `movePapers`. **Live-smoke-caught fix:** the popover is portaled to `document.body` (React `createPortal`), not rendered inline in the table `<td>` - see Dev Agent Record / Completion Notes for the two-layer stacking bug this fixes.
  - [x] The move menu button must `stopPropagation` so opening it does not arm/select/open the row (same discipline as the Open button).
  - [x] **OPTIONAL enhancement:** native HTML5 drag-a-row-onto-a-folder. Deferred at initial dev-story completion, then built in a same-session follow-up fix round (see Completion Notes: the per-row move menu was superseded by toolbar bulk Move + drag-to-folder per direct user request) - `draggable` rows carry a custom compact drag image via `dataTransfer.setDragImage`, dropped onto `FolderPanel`'s Uncategorized/folder rows.

- [x] **Task 9 - Tests (all ACs)**
  - [x] Backend `test_storage.py`: `move_papers` sets `folder_id` for one id and for many ids; move to `None` clears membership (Uncategorized); a move replaces a prior folder (at most one); move to a nonexistent `folder_id` → `FolderNotFoundError` with NO write applied; move with an unknown `doc_id` in the set → `DocumentNotFoundError` with NO partial write (all-or-nothing); move never touches `trashed`/`order`/other papers/folders; membership survives a `read_library` round-trip.
  - [x] Backend `test_library.py`: `POST /api/library/move` returns the updated `Library` with new membership; 404 `"Folder not found"` on a bad `folder_id`; 404 `"Document not found"` on an unknown `doc_id`; 422 on empty `doc_ids` and on a forbidden extra field.
  - [x] Backend `test_openapi.py`: `MoveRequest` in `components.schemas` and the `POST /api/library/move` path present.
  - [x] Client `folderFilter.test.ts`: `filterPapers` for all/uncategorized/folder; trashed excluded in every case.
  - [x] Client `useMovePapers.test.ts`: optimistic membership set, reconcile from the returned `Library`, revert + error toast on failure, monotonic-seq guard (a stale slow response can't clobber a newer move), mount-guard respected (no apply post-unmount).
  - [x] Client `FolderPanel.test.tsx`: selecting `All`/`Uncategorized`/a folder calls `onSelect` with the right `FolderSelection`; the selected entry gets the `--active` (surface-strong) treatment; clicking a rename/add-subfolder/delete action button does NOT change selection; keyboard-focusable buttons; `Recent`/`Trash` remain inert. 7.1 assertions kept green (default selection is `All`, so `All` is active by default as before).
  - [x] Client `CollectionTable`/`PaperRow` tests: the "Move to folder" menu lists Uncategorized + folders and calls `onMovePaper(docId, target)`; the menu button does not arm/open the row; choosing a folder does not open the row.
  - [x] Client `LibraryPage.test.tsx`: **REGRESSION FIRST** - selecting a folder filters the visible rows (only that folder's papers); `All` shows all non-trashed; `Uncategorized` shows `folder_id == null`; a move via the menu updates membership and the row leaves the current folder view; entering an empty folder in a non-empty library keeps the table layout (does NOT flash `EmptyDropzone`) and shows the empty-folder line; a just-uploaded pending row does not show under an unrelated selected folder. Mocked `movePapers` (and `getLibrary`, already mocked). No `render/` mock barrel touched (none of these are `render/` exports).

- [x] **Task 10 - Live smoke (own fresh servers) (AC: 1, 2, 3, 4, 5)**
  - [x] This is a **panel/table/membership feature, NOT a geometry/placement/anchor feature** (no PDF coordinates, no canvas, no DPR-sensitive rects) - the AE-5 DPR>1 gate does NOT apply (same call as 7.1). One normal-DPR real-data pass sufficed.
  - [x] Launched a fresh `uvicorn` (port 8010) + `vite dev` (port 5183) against an isolated scratch `PAPER_MATE_DATA`, seeded 3 real PDFs + a folder + subfolder via the real import/folder-create paths, drove the UI with Playwright's real click/hover (trusted input, not `dispatchEvent`). Verified: selecting an empty folder shows the empty-folder line (no `EmptyDropzone` flash, toolbar count stays TOTAL); moving a paper via the row's "Move to folder" menu updates membership, the row leaves Uncategorized and appears under the folder; `All` shows every paper; the selected entry is visually highlighted `{colors.surface-strong}` (screenshot-verified); the move persists across a full backend restart on the same data root (`GET /api/library` re-checked post-restart). **Live smoke caught a real bug** (see Completion Notes) that no unit test surfaced - fixed in the same change, then the full smoke sequence was re-run clean. The optional drag enhancement was not built (deferred, see Task 8), so no drag smoke was needed. Both scratch servers were torn down after.

## Dev Notes

### The move contract is set-based FROM THE START (AD-L6) - do not build a single-id endpoint

Architecture AD-L6 defines the organization layer as **set-based** `POST /api/library/move | trash | restore` taking `{doc_ids}` (FR-15 + multi-select FR-3). Story 7.3 (multi-select batch move) explicitly says "all selected papers move in one set-based `POST /api/library/move` taking `{doc_ids}`", and Story 7.5 (Trash) reuses the same set-based org path for batch delete. So build `move` set-based NOW; 7.2's single-paper move is just `doc_ids: [oneId]`. A single-id endpoint would force a contract break at 7.3. [Source: .bmad/planning-artifacts/architecture/architecture-paper-mate-library-2026-07-04/ARCHITECTURE-SPINE.md:107,128; epics.md#Story-7.3, #Story-7.5]

### Filtering is VIEW-STATE inside the Library route, never a route (AD-L3)

AD-L3: `/` and `/reader/:docId` are the ONLY two routes; "folder selection, sort/filter, and Trash are view-state filters inside the Library route, NOT routes." So folder selection is React `useState` in `LibraryPage`, applied to the rows handed to `CollectionTable`. Do NOT add a route, a URL param, or router state for the selected folder. The router owns navigation/history only; collection/domain state stays in the store/backend + this local view-state. [Source: ARCHITECTURE-SPINE.md:80,127; epics.md AD-L3 memlog]

### Storage: everything through `mutate_index` (AL-7, the one serialized writer)

`move_papers` MUST go through `mutate_index(mutator)` - the single read-modify-write path under the process-level `_index_lock` - exactly like `create_folder`/`rename_folder`/`delete_folder`. This is load-bearing per the AD-L7 adversary scenario: "user drops 10 PDFs; while row 3 extracts, user drags row 3 into a folder; extraction finishes a beat later and writes back the pre-move index → the folder move vanishes." Doing the validate-then-mutate inside ONE mutator (not read-then-separately-write) is what makes the move atomic against a concurrent background extraction refresh. `read_library()` is the separate lock-free read; return it (mirrors `delete_folder`). Do NOT add a second lock or writer. [Source: server/app/storage/library_index.py:77-88,205-222 (`delete_folder` is the template); ARCHITECTURE-SPINE.md:112-113; architecture reviews/review-adversary.md:10-12]

### Error taxonomy: TWO 404s on this route, both must stay 404

Unlike the folder routes (one `not_found` type), `move` can 404 for a bad `folder_id` (`FolderNotFoundError` → `"Folder not found"`) OR an unknown `doc_id` (`DocumentNotFoundError` → `"Document not found"`). `FolderNotFoundError` and `DocumentNotFoundError` are SIBLINGS under `StorageError` (neither subclasses the other), so the default `storage_errors` (which only catches `DocumentNotFoundError` as its `not_found`) would map a `FolderNotFoundError` to a 500 - wrong. Extend the seam (`extra_not_found` param, additive) or catch `FolderNotFoundError` explicitly; either way NO folder-404 may leak to 500, and no raw `KeyError`/`ValueError` may escape the `{ detail }` envelope (the Story 6.2 Codex-Medium class of leak). [Source: server/app/routes/_errors.py:42-63; server/app/storage/errors.py; 7.1 generalized this same seam with `not_found`/`not_found_detail`]

### Route + client idioms to mirror (do not invent new ones)

- Route: `routes/library.py`'s folder handlers are the template - `@router.post(..., response_model=Library, responses={...error_response(...)})`, a `with storage_errors(...)` body, return the model. [Source: server/app/routes/library.py:43-98]
- Client api fn: mirror `createFolder`/`deleteFolder` in `api/client.ts` (fetch → `if (!res.ok) throw await envelopeError(res)` → typed return). [Source: client/src/api/client.ts:144-180]
- Move hook: mirror `useFolders` (StrictMode `mountedRef` latch set inside the effect body, monotonic `opSeqRef`, `setLibrary` reconcile). [Source: client/src/library/FolderPanel/useFolders.ts]
- Move menu: mirror `AddMenu` (button + `role="menu"` popover, document-level pointerdown/Escape dismiss, focus-return). [Source: client/src/library/AddMenu/AddMenu.tsx]

### Client wiring: lift the selection, keep the layout gate on the total

`LibraryPage` (lines 47-156) is composition-only: `useCollection` owns `library`/`setLibrary`/`pending`, `FolderPanel` owns folder CRUD. Story 7.2 adds a lifted `selection` view-state (shared by the panel highlight and the table rows) + a `useMovePapers` hook, both owned by `LibraryPage`. **Critical regression guard:** the `isTableLayout` gate and the loading/empty branches key off the TOTAL `papers.length` / `pending.length` (lines 69-70, 145-156). Keep them on the total - filter ONLY the `rows` prop of the populated `<CollectionTable>` (line 148-153). If you gate layout on the filtered set, an empty folder in a non-empty library collapses to the `EmptyDropzone` (a bug). The `main`-level `onDrop` file-upload dropzone (lines 96-101) must keep working; if you add row-drag, it carries `text/plain`, distinct from the upload's `dataTransfer.files`. [Source: client/src/library/LibraryPage.tsx]

### `CollectionRow` already carries `folder_id` and `trashed` - no model change

`server/app/models.py::CollectionRow` already has `folder_id: str | None` and `trashed: bool` (Story 6.2, generated ahead of this epic). `upsert_paper_entry` seeds a new import at `folder_id: None, trashed: False` at the next order. This story adds the move OPERATION + the `MoveRequest` request model + the client filter, not the row model. [Source: server/app/models.py:155-181; server/app/storage/library_index.py:107-128]

### `FolderRow` already reserved the name label for click-to-select

`FolderRow`'s own doc comment: "the name itself stays a plain, non-interactive label so Story 7.2's click-to-select can be added later without colliding with rename." Wire the name/row to `onSelect`; the three action buttons must `stopPropagation`. `library-folder-panel__item--active` (surface-strong) already exists in `FolderPanel.css` (line 96); this story makes it selection-driven and adds the same treatment to a selected folder row. [Source: client/src/library/FolderPanel/FolderRow.tsx; FolderPanel.tsx:96-113; FolderPanel.css:96-101]

### UX tokens & voice (no raw values, no em-dash)

- Selected entry highlight: `{colors.surface-strong}` (`--color-surface-strong`, already the `--active` background). A11y (L-UX-DR12): selectable entries keyboard-operable, visible 2px `{colors.ink}` focus ring, matching the 7.1 panel a11y.
- Move menu: `{component.*}` token-driven, mirror `AddMenu` styling; keyboard-operable menuitems.
- Empty-folder line + any move toast: Obsidian-quiet, plain, lowercase-leaning; no exclamation, no emoji, **no em-dash** (L-UX-DR13). Raw hex/px only under `src/theme/**` (`src/no-raw-values.test.ts` enforces).

### Previous-story intelligence (Epic 6 + 7.1, apply these)

- **StrictMode `mountedRef` latch:** any hook with a `useRef(true)` mount guard MUST set `mountedRef.current = true` inside the effect body, not the initializer - StrictMode's mount→cleanup→remount permanently latches it `false` otherwise, silently dropping updates; jsdom's `render()` is not StrictMode-wrapped so unit tests pass while the dev app breaks (bit Story 6.4). [Source: useCollection.ts:49-57, useFolders.ts:39-46]
- **Monotonic sequence guards:** the optimistic-then-reconcile move needs a `moveSeqRef` so a slow older response can't clobber a newer one (`useFolders.opSeqRef` / `useCollection.fetchSeqRef`).
- **"Mock everything the mount/interaction calls":** a `LibraryPage` test must mock every api fn it can trigger (`getLibrary` + `movePapers` here) or an un-mocked `fetch` rejects in jsdom (bit 6.3/6.4).
- **Trusted input for focus-sensitive smoke** (`[[use-trusted-input-for-focus-sensitive-smoke]]`) and **automated drag is unreliable** (`[[drag-tools-dont-create-text-selection]]`) - relevant to the optional row-drag smoke.
- **Cross-model Codex review after dev-story (AE-6):** run `bmad-code-review` via Codex; caught real HIGH/Med in most Epic 6 stories and 3 Medium in 7.1.
- **Model-per-job (AE6-3):** run this story on **Sonnet 5 xHigh** per CLAUDE.md (the Epic 6 retro flagged silent drift to Opus; follow the convention here).

### Testing standards

- Backend: `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q` (180 baseline after 7.1; no pytest plugins). **Sandbox caveat (CLAUDE.md):** the FastAPI `TestClient` tests can hang under the Codex review sandbox; backend pytest is run-it-yourself on the host (`export UV_CACHE_DIR=/tmp/uv-cache`), and a reviewer verifies backend findings by reading. Prefer exercising `move_papers` directly (temp `PAPER_MATE_DATA`) for core lifecycle coverage; keep TestClient cases lean.
- Client: `cd client && npm test` (Vitest) + `npm run typecheck`. `no-raw-values.test.ts` must stay green after any CSS.
- Contract: regen `openapi.json` + `schema.d.ts` (committed) and update `docs/API.md` in the SAME change.
- No DPR>1 live smoke required (not a placement feature); one normal-DPR own-server pass per Task 10.

### Project Structure Notes

- New: `server/app/storage/library_index.py` gains `move_papers` (+ `storage/__init__.py` re-export); `models.py` gains `MoveRequest`; `routes/library.py` gains `POST /library/move` (and possibly a generalized `routes/_errors.py::storage_errors`); `client/src/api/client.ts` gains `movePapers` + the `MoveRequest` type; new `client/src/library/folderFilter.ts` (+ test) and `client/src/library/useMovePapers.ts` (+ test); a new "Move to folder" menu unit under `CollectionTable/` (mirroring `AddMenu`).
- Modified: `LibraryPage.tsx` (selection view-state + `useMovePapers` + filtered rows + empty-folder line), `LibraryPage.test.tsx` (filter/move regression), `FolderPanel.tsx`/`FolderRow.tsx` (+ their `.test.tsx`) and `FolderPanel.css` (selectable + selected-highlight + a11y), `CollectionTable.tsx`/`PaperRow.tsx` (+ tests) for the move menu, `client/src/theme/components.css` (any new menu/selected tokens), `docs/API.md`, `client/src/api/schema.d.ts` (regenerated), `server/pyproject.toml` (version `0.5.1` → `0.5.2`, PATCH bump at story done).
- This story file lives in `.bmad/implementation-artifacts/epic-7/` (per-epic convention, same as 7.1).
- Branch per story: cut `story-7-2-assign-filter-by-folder` off `main` before implementing (CLAUDE.md). Update `sprint-status.yaml` to `done` at PR-merge time (AE3-1); fill the Dev Agent Record before flipping to `done` (AE3-2).

### References

- [Source: .bmad/planning-artifacts/epics.md#Story-7.2] - the 5 ACs (LFR-13/14/15, AL-3/5/6/7, L-UX-DR4).
- [Source: .bmad/planning-artifacts/epics.md#Story-7.3, #Story-7.5] - the set-based `{doc_ids}` move contract that 7.2 must not break; batch delete reuses it.
- [Source: .bmad/planning-artifacts/architecture/architecture-paper-mate-library-2026-07-04/ARCHITECTURE-SPINE.md:80,107,112-113,127-128] - AD-L3 (folder selection = Library view-state, not a route), AD-L6 (set-based move/trash/restore `{doc_ids}`), AD-L7 (serialized `library.json` writes).
- [Source: .../architecture-paper-mate-library-2026-07-04/reviews/review-adversary.md:10-12] - the concurrent move-vs-extraction race the serialized writer prevents.
- [Source: .bmad/planning-artifacts/prds/prd-paper-mate-library-2026-07-04/prd.md:52-55] - FR-13/14/15 (≤1 folder, All/Uncategorized, select-filters, assign/move).
- [Source: server/app/storage/library_index.py] - `mutate_index`, `_find_folder`, `delete_folder` (the template for `move_papers`), `upsert_paper_entry` (new imports land Uncategorized/untrashed).
- [Source: server/app/routes/library.py, routes/_errors.py] - the folder handlers + the `storage_errors` seam to generalize.
- [Source: server/app/models.py:155-181] - `CollectionRow.folder_id`/`trashed` (already present), `Library`.
- [Source: client/src/library/LibraryPage.tsx, useCollection.ts, FolderPanel/*, CollectionTable/*, AddMenu/AddMenu.tsx, api/client.ts] - the client surfaces to wire + the patterns to mirror.
- [Source: .bmad/implementation-artifacts/epic-7/7-1-folders-crud-nest.md] - the folder panel + `useFolders` + `ConfirmDialog` this builds on; its Dev Agent Record + Change Log.
- [Source: CLAUDE.md] - tokens never inline hex/px; no em-dash in UI strings; don't reinvent wheels (menu = `AddMenu`); OOP decomposition + refactor in the same change; document-level handlers (menu dismiss); launch your OWN dev servers for smoke; trusted input for focus-sensitive smoke; versioning (PATCH +1 → 0.5.2); branch-per-story; backend-tests sandbox note; contract-types regen flow; maintain `docs/API.md` with any `/api` change.

## Dev Agent Record

### Agent Model Used

Recommended: Sonnet 5 xHigh (bmad-dev-story), per CLAUDE.md model-per-job and Epic 6 retro AE6-3.

### Debug Log References

- Backend: `cd server && export UV_CACHE_DIR=/tmp/uv-cache && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q` → 195 passed (180 baseline + 15 new: `move_papers` storage tests, `POST /api/library/move` route tests, an OpenAPI contract test).
- Frontend: `cd client && npm run typecheck` → clean; `npx vitest run` → 1036 passed (1000 baseline + 36 new: `folderFilter.test.ts`, `useMovePapers.test.ts`, `FolderPanel.test.tsx` selection tests, `CollectionTable.test.tsx` move-menu tests, `LibraryPage.test.tsx` folder-filter/move regression tests).
- Contract regen: `uv run python -m app.export_openapi` then `npm run gen:api` → `MoveRequest` + `POST /api/library/move` present in `schema.d.ts`.
- Live smoke: own `uvicorn` (port 8010) + `vite dev` (port 5183) against an isolated scratch `PAPER_MATE_DATA`, seeded 3 real sample PDFs + a folder + subfolder via the real import/create paths, driven with Playwright MCP (real click/hover, not `dispatchEvent`). Verified all 5 ACs end to end, including a full backend restart to confirm persistence. **Live smoke caught a real bug the unit suite could not see** (jsdom's `getBoundingClientRect`/`elementFromPoint` are inert, so this class of bug is structurally invisible to any jsdom-based test): the per-row "Move to folder" popover, originally `position: absolute` nested in the table `<td>`, was visually painted on top of sibling rows but Chromium's table stacking model still routed clicks to a SIBLING row's cell underneath regardless of `z-index` (confirmed via `elementFromPoint` returning the wrong row's cell). Switching to `position: fixed` alone did not fix it either: `.collection-table__row-actions` (the hover-reveal wrapper) sets `transform: translateY(-50%)`, and a `transform` on any ancestor makes IT the containing block for `position: fixed` descendants (CSS spec) instead of the viewport, so the popover was still being mispositioned (measured off-screen via `getBoundingClientRect`). Fixed by portaling the popover to `document.body` via `createPortal`, which fully sidesteps both the table's stacking model and the transformed ancestor's containing-block override. Re-ran the whole smoke sequence clean after the fix, plus the full backend + client regression suites (195 + 1036 passed) and typecheck.
- **Same-session follow-up fix rounds** (user-driven UX iteration on the shipped review-status build, commits `8ebf6a4`/`3dbcf17`/`885c6c3`/`2290ef8`): each round re-ran `npx vitest run` + `npm run typecheck` (final tally: 1060 client tests, 55 files, clean typecheck) and was live-smoked against a freshly launched isolated `uvicorn`+`vite` pair (never a server the user already had running, per CLAUDE.md). Round-by-round: (1) toolbar bulk "Move" button + `FolderPanel` drop targets replaced the per-row move menu; a checkbox-select column was built then explicitly reverted in favor of Ctrl/Cmd+click multi-select per direct user correction; an inert "Starred" mock entry was added to the panel. (2) Ctrl/Cmd-checked rows unified onto the exact same highlight as a single-armed row (left ink bar + `surface-strong`), the separate check-mark icon removed; the native full-row drag snapshot replaced with a compact custom drag image (`setDragImage` on a detached off-screen node) mirroring Google Drive. (3) Add/Move toolbar buttons unified onto one shared `.toolbar-button` class. (4) Root-caused and fixed two selection bugs live-smoke/user-reported: a plain click after a Ctrl/Cmd multi-select didn't clear the stale checked rows, and a single (non-multi) selection never enabled the toolbar Move button - both traced to `selectedId` (table-local single-arm state) and `checkedIds` (lifted multi-select state) being two disjoint pieces of state that never synced; unified into one controlled-or-uncontrolled `selectedIds` set. Also fixed the toolbar count always reading "N files in library" regardless of the selected folder/Uncategorized view.
- **Cross-model Codex review (AE-6, `bmad-code-review` via `codex exec`)**, run against the full `baseline_commit..HEAD` diff (all 4 follow-up commits included, not just the original `772539e`): 0 High, 3 Medium, 3 Low. Fixed 2 of 3 Mediums in the same session (commit `2290ef8`): a drag starting on the Open button or an inline-edit input incorrectly carried a row-move payload (every `<tr>` is `draggable` with no interactive-descendant guard) - fixed with a `closest("input, textarea, button, [contenteditable=true]")` + `preventDefault` guard; `MoveMenu`'s trigger button stopped propagation for every keydown including Escape, so Escape did nothing while focus stayed on the button - fixed to exempt Escape. Deferred 1 Medium (`useMovePapers.ts` overlapping-failed-moves revert-to-intermediate-value race): traced and confirmed as a pre-existing architectural pattern shared with `useFolders.renameFolder` (not introduced this session), needing a consistent fix across both hooks - out of scope for a review fix-up, left for a future story/cleanup. 3 Lows reported, not fixed: `FolderPanel` drop-hover state can stick after a cancelled drag; `_errors.py`'s `storage_errors` docstring claims a check order the code doesn't follow (works today, misleading contract); the `Starred` entry is scope creep beyond the story's own boundary (explicit user request, documented above).

### Completion Notes List

- Storage: `move_papers(doc_ids, folder_id)` added to `library_index.py`, set-based (AD-L6) through the single `mutate_index` serialized writer (AL-7). Validation (bad `folder_id` → `FolderNotFoundError`; any unknown `doc_id` → `DocumentNotFoundError`) runs BEFORE any mutation inside the one mutator, so a bad set is all-or-nothing (no partial write). Re-exported through the `storage/__init__.py` facade; no new error class needed (both error types already existed).
- Routes: `storage_errors` (routes/_errors.py) generalized again with an additive `extra_not_found: Sequence[tuple[type[StorageError], str]] = ()` param (the "preferred" option from Dev Notes), checked before the default 500 fallthrough. `POST /api/library/move` passes `extra_not_found=[(FolderNotFoundError, "Folder not found")]` and keeps the default `DocumentNotFoundError → "Document not found"` - two distinct 404s, neither leaks to 500. Existing callers (docs.py, the three folder routes) untouched.
- Models: `MoveRequest` (`doc_ids: list[str] = Field(min_length=1)`, `folder_id: str | None = None`, `extra="forbid"`) - an empty `doc_ids` 422s before it can reach storage.
- Client: `movePapers` added to `api/client.ts` mirroring `createFolder`/`deleteFolder`. New `client/src/library/folderFilter.ts` (pure `FolderSelection` discriminated union + `filterPapers` + `isSelected`) and `client/src/library/useMovePapers.ts` (optimistic membership set, monotonic `moveSeqRef` guard, StrictMode-safe `mountedRef` latch set inside the effect body) - both mirror `useFolders`'s established pattern.
- `LibraryPage.tsx`: lifted `selection` view-state (shared by the panel highlight and the table filter, per AD-L3 - never a route/URL param). Layout gate (`isTableLayout`) stays keyed on the TOTAL `papers.length`/`pending.length`, never the filtered set, per the Dev Notes regression guard; only the populated `<CollectionTable>`'s `rows`/`pendingRows` are filtered. A quiet `library-empty-line` renders in place of the table when the filtered view is empty but the library isn't.
- `FolderPanel`/`FolderRow`: `All`/`Uncategorized`/each folder row are now real `<button>`s (native focus + Enter/Space, no custom keydown wiring needed - the page already has a global `:focus-visible` ring). `Recent`/`Trash` stay plain, inert `<li>`. `FolderRow`'s name label became a button (previously a non-interactive span reserved for exactly this); the three action buttons `stopPropagation` so a rename/add-subfolder/delete click never also selects the row. **Retargeted `.library-folder-panel__item--active`'s color from `--color-ink`/`--color-canvas` to `--color-surface-strong`/`--color-ink`**: the on-disk CSS did NOT actually match this story's own Dev Notes claim that it was "already" surface-strong (verified by reading the file) - it was a 7.1-era placeholder for the permanently-active `All`, and 7.1's own story file explicitly defers the real surface-strong highlight to 7.2 (AC-5, L-UX-DR4). Added a matching `folder-panel__row--active` for a selected folder row.
- `CollectionTable`/`PaperRow`: added a "Move to folder" control mirroring `AddMenu`'s popover pattern (new `MoveMenu.tsx`/`.css`). `folders`/`onMovePaper` are optional props (default `[]`/no-op) on `CollectionTable` so the ~40 existing call sites in `CollectionTable.test.tsx` didn't need touching, matching the already-optional `pendingRows` precedent.
- **Live-smoke-caught fix (see Debug Log for the full diagnosis):** `MoveMenu`'s popover is portaled to `document.body` via `createPortal`, `position: fixed`, anchored from the trigger button's own `getBoundingClientRect()` at open time. This was a genuine correctness bug (a click on a menu item could land on the wrong row's cell), invisible to jsdom-based unit tests since jsdom's layout geometry (`getBoundingClientRect`, `elementFromPoint`) is inert - only a real browser's layout/hit-testing surfaces it. The outside-click dismiss handler checks both the trigger's root ref AND a second ref on the portaled popover (a plain DOM `.contains()` check on `rootRef` alone would miss clicks landing in the portal, which lives in a different DOM subtree despite being a React child).
- Version bumped `0.5.1 → 0.5.2` (PATCH, story done; not bumped again by the follow-up fix rounds below - same story, one PATCH).

**Follow-up fix rounds (same session, after initial "review" status - the paragraphs above describe the original `772539e` implementation; everything below is what changed on top of it, commits `8ebf6a4`/`3dbcf17`/`885c6c3`/`2290ef8`):**

- **Per-row move menu -> toolbar bulk Move + drag-to-folder (user-requested UX pivot).** The per-row "Move to folder" popover (Task 8's required path) was removed from `PaperRow`/`CollectionTable` entirely; `MoveMenu.tsx`/`.css` moved from `CollectionTable/` up to `client/src/library/` since it is now toolbar-level only, triggered by a new "Move" button next to "+Add". `CollectionTable` gained a lifted, controlled-or-uncontrolled `selectedIds: Set<string>` + `onSelectionChange` (a plain-click replaces the whole set with just that row; Ctrl/Cmd+click toggles one row's membership, intercepted at the row's CAPTURE phase so it never also arms/edits/opens the row). `LibraryPage` mirrors it and passes the set to the toolbar Move button (`disabled` when empty) and to `FolderPanel` (drop targets on Uncategorized + every folder row, gated on a custom `application/x-papermate-move` `dataTransfer` MIME so a folder-drop is never confused with the existing PDF-upload drag). A checkbox-select column was built for this first, then explicitly reverted per direct user correction ("bad idea, wastes space") in favor of the Ctrl/Cmd+click model described above. An inert "Starred" mock entry (`Star` icon + label, unimplemented) was added to `FolderPanel` between Uncategorized and Trash per an explicit user ask.
- **Selection-highlight/drag-image polish.** A Ctrl/Cmd-checked row now renders with the exact same visual treatment as a single-armed row (left ink bar + `--color-surface-strong`, one shared CSS rule keyed on `[aria-selected="true"], [data-checked]`) - the separate check-mark icon was removed per user request ("no check mark, delete it"). Dragging now shows a compact custom drag image (a detached, off-screen DOM node built fresh per `dragstart`, rasterized via `dataTransfer.setDragImage`) instead of the browser's default full-row snapshot - a filename chip, plus a count badge when dragging a multi-selection, mirroring Google Drive's affordance per the user's explicit reference.
- **Toolbar button unification.** Add and Move now share one `.toolbar-button` class (a bordered chip) in `LibraryPage.css`, replacing `AddMenu`'s previously distinct filled-pill style, per direct user request to make the two buttons read as one family.
- **Selection-model bug fix (root cause, not a patch).** Two bugs were reported after the above rounds shipped: (1) a plain click on another row while a Ctrl/Cmd multi-selection was active did not clear the previously-checked rows; (2) a single (non-multi) selection never enabled the toolbar Move button. Root cause: the table had accumulated TWO disjoint pieces of selection state - a local `selectedId` (single-row arm, used for the inline-edit affordance) and a lifted `checkedIds` (Ctrl/Cmd multi-select, used by the toolbar) - that were never synchronized; a plain click only ever touched the former. Fixed by unifying both into one `selectedIds: Set<string>`, controlled-or-uncontrolled like `<input value onChange>` (LibraryPage drives it; isolated component tests that don't care about the toolbar fall back to the table owning it internally). `armed` (inline-edit affordance) now derives as `selectedIds.size === 1 && selectedIds.has(id)`; `checked` (highlight/drag payload) as plain membership; Move is enabled by `selectedIds.size > 0`.
- **Toolbar count is per-view, not whole-library.** The count previously always read "N files in library" regardless of the selected folder/Uncategorized view. Added `selectionLabel(selection, folders)` in `LibraryPage.tsx` and switched the count to `visiblePapers.length` (the already-filtered rows) instead of the unfiltered `papers.length` - now reads e.g. "3 files in Anomaly Detection" or "2 files in Uncategorized".
- **Codex `bmad-code-review` (AE-6) run via `codex exec`** against the full diff spanning all 4 follow-up commits (see Debug Log for the full findings + fix summary). 2 of 3 Medium findings fixed in commit `2290ef8` (drag-from-interactive-descendant guard; Escape-swallowed-by-Move-trigger); 1 Medium deferred (pre-existing optimistic-revert race shared with `useFolders`, needs a consistent cross-hook fix, out of scope here); 3 Lows reported only.
- Every fix round was live-smoked end to end against a freshly launched isolated `uvicorn`+`vite` pair (never a server already running for the user), per CLAUDE.md convention - see Debug Log for specifics.

### File List

State below is the FINAL state after the initial dev-story pass AND the same-session follow-up fix rounds (some files this story originally created were later moved/removed as the per-row move menu was superseded by toolbar bulk Move + drag-to-folder - see Completion Notes).

**New:**
- `client/src/library/folderFilter.ts` / `folderFilter.test.ts`
- `client/src/library/useMovePapers.ts` / `useMovePapers.test.ts`
- `client/src/library/moveDrag.ts` (`MOVE_DRAG_MIME` + drag-payload encode/decode, shared by `CollectionTable`'s `dragstart` and `FolderPanel`'s `drop`)
- `client/src/library/MoveMenu.tsx` / `MoveMenu.css` / `MoveMenu.test.tsx` (moved here from `CollectionTable/` - now toolbar-level only, mirrors `AddMenu`)

**Modified (backend):**
- `server/app/storage/library_index.py` (`move_papers`)
- `server/app/storage/__init__.py` (facade re-export)
- `server/app/models.py` (`MoveRequest`)
- `server/app/routes/_errors.py` (`storage_errors` generalized with `extra_not_found`)
- `server/app/routes/library.py` (`POST /library/move`)
- `server/tests/test_storage.py`, `server/tests/test_library.py`, `server/tests/test_openapi.py`
- `server/pyproject.toml` (version `0.5.1` → `0.5.2`), `server/uv.lock`

**Modified (client, contract + core filter/move):**
- `client/src/api/client.ts` (`movePapers` + `MoveRequest` type), `client/src/api/schema.d.ts` (regenerated)
- `client/src/library/LibraryPage.tsx` (lifted `selection` + unified `selectedIds`, `useMovePapers`, filtered rows via `visiblePapers`, empty-folder line, per-view toolbar count via `selectionLabel`)
- `client/src/library/LibraryPage.css` (`.library-empty-line`, `.toolbar-button` shared chip, `.library-toolbar__actions`)
- `client/src/library/LibraryPage.test.tsx` (folder-filter/move regression, Ctrl+click + toolbar-Move, single-selection-enables-Move, plain-click-clears-multi-select, drag-to-folder, per-view count)

**Modified (client, folder panel):**
- `client/src/library/FolderPanel/FolderPanel.tsx` (selection/`onSelect` wiring; `onDropMove` + drop-target handlers on Uncategorized/each folder row; inert "Starred" mock entry)
- `client/src/library/FolderPanel/FolderPanel.css` (button-reset + active-highlight retarget to surface-strong; drop-hover styling)
- `client/src/library/FolderPanel/FolderPanel.test.tsx` (selection tests; `onDropMove` harness)
- `client/src/library/FolderPanel/FolderRow.tsx` (name button + `isSelected`/`onSelect`; drop-target props)

**Modified (client, collection table - superseded the per-row move menu):**
- `client/src/library/CollectionTable/CollectionTable.tsx` (no more `folders`/`onMovePaper`; unified controlled-or-uncontrolled `selectedIds`/`onSelectionChange`; Ctrl/Cmd+click capture-phase toggle; plain-click replace-selection; drag-start with a custom compact drag image + interactive-descendant guard)
- `client/src/library/CollectionTable/CollectionTable.css` (checked/armed rows share one highlight rule; `.collection-table__drag-preview` + badge; per-row move-menu/checkbox rules removed)
- `client/src/library/CollectionTable/CollectionTable.test.tsx` (Ctrl/Cmd+click, unified-selection, drag-payload/drag-image, drag-guard tests)
- `client/src/library/CollectionTable/PaperRow.tsx` (no per-row move menu, no checkbox, no check-mark icon; `data-checked`/`aria-selected` only)

**Modified (client, toolbar/add menu):**
- `client/src/library/AddMenu/AddMenu.tsx` / `AddMenu.css` (trigger button now uses the shared `.toolbar-button` class)

**Modified (client, tokens):**
- `client/src/theme/components.css` (`--move-menu-popover-max-height`, `--drag-preview-max-width`, `--drag-preview-badge-size`, `--offscreen-distance`)

**Modified (docs / sprint):**
- `docs/API.md` (`POST /api/library/move` resource entry + changelog line)
- `.bmad/implementation-artifacts/sprint-status.yaml` (status transitions)

### Change Log

- **2026-07-06 (Story 7.2):** Assign and filter by folder. New set-based `POST /api/library/move` (`MoveRequest`: `{doc_ids, folder_id}`, all-or-nothing validation, two distinct 404s) backed by `move_papers` in `library_index.py` (through the single serialized `mutate_index` writer, AL-7); the `storage_errors` seam generalized again with an additive `extra_not_found` param. Client: folder selection is a lifted `FolderSelection` view-state in `LibraryPage` (never a route, AD-L3) driving both the `FolderPanel` highlight and the table's filtered rows (`folderFilter.ts`); a new `useMovePapers` hook does the optimistic-then-reconcile move; a per-row "Move to folder" menu (`MoveMenu.tsx`, mirrors `AddMenu`) is the required move affordance (the optional drag enhancement was deferred). `All`/`Uncategorized`/folder rows in `FolderPanel` are now real, keyboard-operable buttons with a `{colors.surface-strong}` selected highlight (retargeted from a 7.1 placeholder color that didn't match the AC). **Live smoke caught and fixed a real correctness bug** invisible to jsdom-based tests: the move menu's popover needed portaling to `document.body` (`position: fixed`, anchored via `getBoundingClientRect`) to escape both the table's own click-stacking model and a transformed ancestor's containing-block override - either alone routed a menu-item click to the wrong row. Contract shape change (one new path + one new schema): `openapi.json`/`schema.d.ts` regenerated, `docs/API.md` updated. Version `0.5.1 -> 0.5.2`.
- **2026-07-06 (Story 7.2, follow-up round 1 - `8ebf6a4`):** Per user request, replaced the per-row "Move to folder" menu with a toolbar bulk "Move" button (next to "+Add") plus native HTML5 drag-a-row-onto-a-folder-panel-entry, built on a lifted `checkedIds` multi-select (Ctrl/Cmd+click; a checkbox-select column was tried first, then explicitly reverted per user correction). Added an inert "Starred" mock entry to `FolderPanel` per explicit user request.
- **2026-07-06 (Story 7.2, follow-up round 2 - `3dbcf17`):** Per user request (with reference screenshots), unified the Ctrl/Cmd-checked-row highlight onto the exact same treatment as a single-armed row (removed the separate check-mark icon), and replaced the browser's default full-row drag snapshot with a compact custom drag image (filename chip + count badge), mirroring Google Drive.
- **2026-07-06 (Story 7.2, follow-up round 3 - `885c6c3`):** Unified the Add and Move toolbar buttons onto one shared `.toolbar-button` class per user request. **Root-caused and fixed two selection bugs**: a plain click after a Ctrl/Cmd multi-select left the previously-checked rows highlighted (the table had two disjoint pieces of selection state that never synced), and a single non-multi selection never enabled the toolbar Move button (same root cause) - unified into one controlled-or-uncontrolled `selectedIds` set. Also fixed the toolbar count always reading "N files in library" regardless of the selected folder/Uncategorized view; it now reports the visible selection's own count and target name.
- **2026-07-06 (Story 7.2, follow-up round 4 - `2290ef8`):** Codex `bmad-code-review` (AE-6) run via `codex exec` against the full diff. Fixed 2 Medium findings: a drag starting on the Open button or an inline-edit input incorrectly carried a row-move payload (added an interactive-descendant guard); `MoveMenu`'s trigger button swallowed Escape via a blanket `stopPropagation`, so the popover couldn't be dismissed by keyboard while focus stayed on the button (now exempts Escape). 1 Medium (an optimistic-revert race in `useMovePapers`, shared with `useFolders`) and 3 Lows deferred - see Completion Notes.
