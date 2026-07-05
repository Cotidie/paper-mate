# Story 7.1: Folders (create, rename, delete, nest)

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a reader,
I want nested custom folders in the left panel,
so that I can group my papers however I think about them.

## Acceptance Criteria

**Given** the folder panel
**When** I create a folder
**Then** it appears in the left-panel tree with a UUIDv4 id and a mutable name, and can be nested under another folder (LFR-12, AL-5)

**Given** a folder
**When** I rename it
**Then** only its name changes; membership is keyed by id so a rename never orphans papers (LFR-12, AL-5)

**Given** a folder with a subtree and papers
**When** I delete it
**Then** the whole subtree is deleted and every paper anywhere in that subtree moves to Uncategorized; NO paper is deleted (LFR-16, AL-5, ratifies PRD A1)

**Given** the panel
**Then** the All and Uncategorized pseudo-entries always render, and empty folders still show (LFR-13, L-UX-DR4)

**Given** folder state
**Then** it persists in `library.json` through the storage-only serialized write path and survives restart (AL-1, AL-7, LFR-21)

**Given** the folders CRUD
**Then** it goes through `/api/library/folders` (subtree delete server-side) with generated types (AL-6, AL-8)

**Given** a folder delete
**When** triggered
**Then** a confirm states it re-homes papers and never deletes them, and the confirm is Esc-dismissable (L-UX-DR4, L-UX-DR12)

## Scope boundary (read first, prevents scope creep)

This story builds the **folder tree + CRUD + persistence + delete-subtree re-home**. It does NOT build:

- **Selecting a folder to filter the table** → Story 7.2 (LFR-14; the `{colors.surface-strong}` selected-highlight is a 7.2 AC).
- **Assigning / moving a paper into a folder** (`POST /api/library/move`) → Story 7.2.
- **Multi-select batch move** → Story 7.3.
- **Re-parenting an existing folder** (dragging folder-into-folder). Nesting is set at CREATE time via `parent_id`; no AC here requires moving an existing folder to a new parent. Leave it out.

The panel renders selectable-looking entries (All, Uncategorized, the tree), but wiring a selection to a table filter is 7.2. Keep `All` the resting default. Do not add table-filtering logic in this story.

## Tasks / Subtasks

- [ ] **Task 1 — Backend: folder CRUD storage in `library_index.py` (AC: 1, 2, 3, 5)** — the folder tree lives in `library.json`'s `folders` list; every write goes through the single serialized `mutate_index` path (AL-7).
  - [ ] `create_folder(name: str, parent_id: str | None) -> Folder`: append `{id: uuid4-hex-or-str, name: name.strip(), parent_id}` via `mutate_index`. Validate `parent_id` is `None` or references an existing folder (else raise `FolderNotFoundError`). Reject an empty/whitespace `name` at the storage boundary (raise a `StorageError` subclass or let the route 400 it — see Task 2). Return the new `Folder`.
  - [ ] `rename_folder(folder_id: str, name: str) -> Folder`: find by id, set `name = name.strip()`, leave `parent_id` and all paper membership untouched (membership is keyed by folder id, so a rename cannot orphan papers). Missing id → `FolderNotFoundError`. Return the updated `Folder`.
  - [ ] `delete_folder(folder_id: str) -> Library`: **subtree delete**. Compute the target id plus ALL transitive descendants (walk `parent_id` edges); remove every one of those folder entries; then for every paper whose `folder_id` is in that removed set, set `folder_id = None` (re-home to Uncategorized). NEVER remove a paper entry. All in one `mutate_index` mutator so it is atomic under `_index_lock`. Missing id → `FolderNotFoundError`. Return the updated `Library` (re-homed papers + surviving folders) so the route can hand the client both in one response.
  - [ ] Add `FolderNotFoundError(StorageError)` to `storage/errors.py` (sibling of `DocumentNotFoundError`). Re-export the three new functions + the new error through the `storage/__init__.py` facade and its `__all__`, matching how `read_library`/`reconcile_library`/`DocumentNotFoundError` are surfaced today.
  - [ ] Guard `_default_index()` already seeds `folders: []`, and `read_library()` already validates `Folder.model_validate` per entry — no change needed there; confirm a folder round-trips through read after each op.

- [ ] **Task 2 — Backend: `/api/library/folders` endpoints in `routes/library.py` (AC: 6, 7)** — thin controllers, no filesystem access, reuse the shared error seam.
  - [ ] Add request models to `models.py`: `FolderCreate(name: str, parent_id: str | None = None)` and `FolderRename(name: str)` (both `extra="forbid"` like `DocPatch`). These generate TS types (AD-3); do not hand-author client types.
  - [ ] `POST /api/library/folders` (body `FolderCreate`) → `Folder`. `PATCH /api/library/folders/{folder_id}` (body `FolderRename`) → `Folder`. `DELETE /api/library/folders/{folder_id}` → `Library` (the re-homed collection + surviving folders).
  - [ ] Map faults to the single `{ detail }` envelope: a missing folder is a 404, but do NOT reuse the `"Document not found"` literal from `storage_errors` (that constant is doc-specific). Either extend the seam or catch `FolderNotFoundError` in the handler → `HTTPException(404, "Folder not found")`. Empty `name` → 400 `"Folder name required"` (or let a Pydantic constraint 422 it — dev's call, but a blank/whitespace name must never persist). Other `StorageError` → 500 via `storage_errors("Could not update folders")` (or an equivalent per-route message). Use `error_response(...)` for each endpoint's `responses=` block so the contract stays consistent.

- [ ] **Task 3 — Contract regen (AC: 6)** — `cd server && PYTHONPATH= uv run python -m app.export_openapi`, then `cd client && npm run gen:api`. Confirm `FolderCreate`/`FolderRename` and the three `/api/library/folders` paths appear in `client/src/api/schema.d.ts` (committed). `Folder`/`Library` already exist and stay unchanged (additive). Update `docs/API.md`: new `/api/library/folders` resource entries (POST/PATCH/DELETE shapes + subtree-delete-re-homes semantics) and a changelog line.

- [ ] **Task 4 — Client: folder api functions in `api/client.ts` (AC: 1, 2, 3)** — mirror the `patchDoc` idiom exactly (fetch, `if (!res.ok) throw await envelopeError(res)`, typed return).
  - [ ] `createFolder(name: string, parentId: string | null): Promise<Folder>` → `POST /api/library/folders`. `renameFolder(id: string, name: string): Promise<Folder>` → `PATCH /api/library/folders/${encodeURIComponent(id)}`. `deleteFolder(id: string): Promise<Library>` → `DELETE /api/library/folders/${encodeURIComponent(id)}`. Import `Folder`/`Library` from the existing type block; do not re-add them.

- [ ] **Task 5 — Client: `FolderPanel/` component (AC: 1, 2, 4, 8)** — new folder under `client/src/library/`, following the `CollectionTable/` layout convention (shell `.tsx` + `.css` + `.test.tsx`, plus small sub-units if it reads cleaner). Replaces the static panel markup now inlined in `LibraryPage.tsx` (lines 80-88).
  - [ ] Render the tree: a `LIBRARY` caption label, the **All** and **Uncategorized** pseudo-entries (always present, never CRUD-able), then the nested user folders built from the flat `Folder[]` (`parent_id` → children). Empty folders still render. The app version stays pinned to the bottom (keep the `data-testid="library-version"` element and its behavior from the current panel).
  - [ ] Affordances: a root-level "new folder" control (creates with `parent_id: null`); a per-folder action to add a subfolder (creates with that folder as `parent_id`) so nesting is reachable; rename via an inline `{component.text-input}` (Enter/blur commit, Esc cancel) reusing the `committedRef` double-fire guard pattern from `CollectionTable/EditableCell` (do not re-invent it); a per-folder delete that opens an Esc-dismissable confirm stating it re-homes papers to Uncategorized and never deletes them.
  - [ ] For the delete confirm, reuse the existing confirm/dialog affordance if one exists from Story 5.6 (interaction-polish esc-confirm); only build a minimal token-driven confirm if nothing reusable is present (CLAUDE.md: don't reinvent wheels). Confirm must trap Esc, manage focus, and respect `prefers-reduced-motion` (L-UX-DR12).
  - [ ] Optimistic CRUD lifecycle: consider a `useFolders` hook (mirroring `useInlineEdit`/`useCollection`) that owns create/rename/delete and applies results via the `setLibrary` from `useCollection`. A create/rename returns a `Folder` → insert/replace in `library.folders`; a delete returns a `Library` → replace `papers` + `folders` in one `setLibrary` (this is how the re-homed papers land). If the hook keeps a `mountedRef`, set `mountedRef.current = true` inside the effect body (StrictMode double-invoke latch — see Previous-story intelligence). If it does optimistic-then-reconcile with a sequence race, guard it with a monotonic ref like `editSeqRef`.

- [ ] **Task 6 — Client: wire `LibraryPage.tsx` (AC: 4, 5)** — replace the static `<aside className="library-folder-panel">` block (lines 80-88) with `<FolderPanel folders={library?.folders ?? []} setLibrary={setLibrary} onToast={onToast} version={version} />` (exact prop surface is dev's call). `setLibrary` already comes from `useCollection`. Do NOT add table-filtering or a selected-folder view-state here (that is 7.2).

- [ ] **Task 7 — Tests (all ACs)**
  - [ ] Backend `test_storage.py`: create appends a folder (uuid id, name, parent_id); create-under-parent nests; create-under-missing-parent raises `FolderNotFoundError`; rename changes only the name and keeps every paper's `folder_id`; delete removes the folder AND all transitive descendants; delete re-homes every paper in the subtree to `folder_id = None` and deletes NO paper; delete of a folder with a nested subtree + papers at multiple depths re-homes all of them; delete-missing raises `FolderNotFoundError`; folders survive a `read_library` round-trip and a `reconcile_library` (reconcile touches papers, must leave `folders` intact); a threaded concurrent create+delete proves the `_index_lock` serialization (no lost folder).
  - [ ] Backend `test_library.py`: `POST` returns the folder; `PATCH` renames; `DELETE` returns the re-homed `Library`; 404 on missing folder for PATCH/DELETE; 400/422 on empty name. (TestClient pattern per the file; note the sandbox caveat below.)
  - [ ] Backend `test_openapi.py`: `FolderCreate`/`FolderRename` in `components.schemas` and the three `/api/library/folders` paths present.
  - [ ] Client `FolderPanel.test.tsx`: renders All + Uncategorized + a nested tree from a flat `Folder[]`; empty folder still renders; create/rename/delete affordances present and call the mocked api fns; delete opens the confirm and only deletes on accept (Esc dismisses without a call); optimistic update reflects a returned `Folder`/`Library`; keyboard operability + focus ring.
  - [ ] Client `LibraryPage.test.tsx`: **REGRESSION FIRST** — the current tests assert the static panel (the `library-folder-panel` "All" item and the `library-version` testid). Replacing the aside will break them; update those assertions to the new `FolderPanel` output and keep the version assertion working. Mock `createFolder`/`renameFolder`/`deleteFolder` only in cases that trigger them ("mock everything the mount/interaction calls" rule); `getLibrary` is already mocked. No `render/` mock barrel touched (FolderPanel is not a `render/` export).

- [ ] **Task 8 — Live smoke (own fresh servers) (AC: 1, 2, 3, 5)**
  - [ ] This is a **panel/CRUD feature, NOT a geometry/placement/anchor feature** (no PDF coordinates, no canvas, no DPR-sensitive rects) — the AE-5 DPR>1 gate does **not** apply (same call as 6.2/6.3). One normal-DPR real-data pass suffices.
  - [ ] Launch YOUR OWN `uvicorn` + `vite dev` (alternate ports, isolated `PAPER_MATE_DATA` scratch dir); tear down after. Do NOT reuse a user-launched server (CLAUDE.md). Seed a couple of papers. Then: create a folder, create a subfolder under it (nesting shows), rename a folder (use TRUSTED input for the focus-sensitive rename — real click/`press_key`, not `dispatchEvent`/`.click()`, per `[[use-trusted-input-for-focus-sensitive-smoke]]`), move a paper into the subtree if a quick path exists (else set `folder_id` via seed), delete the top folder → confirm dialog states re-home → accept → the whole subtree disappears and its papers show as Uncategorized (no paper lost), Esc dismisses the confirm without deleting. Restart the server on the same data root → folders persist (AL-1/LFR-21). Verify All + Uncategorized always render and an empty folder still shows.

## Dev Notes

### The folder data model already exists — do NOT re-create it

`server/app/models.py` already defines `Folder` (`id: str` UUIDv4, `name: str`, `parent_id: str | None = None`), `CollectionRow` (carries `folder_id: str | None`), and `Library` (`papers`, `folders`). These were generated in Story 6.2 ahead of this epic so the contract existed early. `library.json`'s `_default_index()` already seeds `folders: []`, and `read_library()` already validates each folder. This story adds **operations and endpoints**, not the model. [Source: server/app/models.py:107-143; server/app/storage/library_index.py:34-135]

### Storage: everything through `mutate_index` (AL-7, the one serialized writer)

`mutate_index(mutator)` is the single read-modify-write path under a process-level `RLock` (`_index_lock`). All three folder ops MUST go through it — a folder create/rename/delete must never interleave with a background extraction cache-refresh or a same-batch import. `delete_folder`'s re-home (papers' `folder_id` → `None`) happens inside the same mutator as the folder removals, so it is atomic. `read_library()` is a separate lock-free read. Do not add a second lock or a second writer. [Source: server/app/storage/library_index.py:64-78, 122-135, 190-227]

### Error taxonomy: a folder 404 is NOT a document 404

`routes/_errors.py::storage_errors` maps `DocumentNotFoundError → 404 "Document not found"` and any other `StorageError → 500`. A missing folder needs a 404 with a folder-appropriate detail (`"Folder not found"`), so add `FolderNotFoundError(StorageError)` and either extend the seam to map it, or catch it in the handler. Do NOT surface a folder miss with the doc literal, and do NOT let a raw `KeyError`/`ValueError` escape the `{ detail }` envelope (this exact class of leak was a Story 6.2 Codex-Medium fix). [Source: server/app/routes/_errors.py:42-56; server/app/storage/errors.py:10-27]

### Route shape: mirror the shipped idioms

`routes/docs.py`'s `patch_doc` is the template: `APIRouter`, `response_model=`, an `error_response(...)` entry in `responses=`, a `with storage_errors(...)` body around the storage call, return the model. `routes/library.py` is currently one thin `GET`; extend it with the three folder handlers the same way. Returning the full updated entity (a `Folder` from create/rename, a `Library` from delete) mirrors `patch_doc` returning the full `Doc` so the client reconciles in one round-trip. [Source: server/app/routes/docs.py:76-103; server/app/routes/library.py:17-30]

### Client: LibraryPage already has the panel shell — replace it

`LibraryPage.tsx` lines 80-88 render a **static** `<aside className="library-folder-panel">` with a hard-coded `All` item and the version pinned bottom (built as the Epic 6 layout shell, L-UX-DR1). Story 7.1 swaps that for a real `<FolderPanel>` fed by `library.folders`. Keep the version element (`data-testid="library-version"`) and the `~280px` `{component.toc-panel}`-width `{colors.surface-card}` column look. `useCollection` already exposes `setLibrary`; folder CRUD results flow back through it. Mirror `patchDoc` for the api fns and `useInlineEdit`/`CollectionTable/EditableCell` for the inline rename (the `committedRef` Esc/Enter-then-blur guard). [Source: client/src/library/LibraryPage.tsx:32-165; client/src/api/client.ts:71-84; client/src/library/CollectionTable/ (EditableCell inline-edit pattern)]

### UX tokens & voice (no raw values, no em-dash)

- Panel: hairline-bounded `{colors.surface-card}` column, `~280px`, `{component.toc-panel}` width class; `LIBRARY` caption; version pinned bottom (L-UX-DR1).
- Folder tree: All + Uncategorized pseudo-entries always; create/rename/delete affordances; rename via `{component.text-input}`; delete confirm states re-home-not-delete; empty folders render (L-UX-DR4).
- Selected-folder highlight (`{colors.surface-strong}`) and filter-on-select are **7.2**, not here.
- A11y (L-UX-DR12): keyboard-operable, visible 2px `{colors.ink}` focus rings, Esc-dismissable confirm with focus management, `prefers-reduced-motion`.
- Voice (L-UX-DR13): Obsidian-quiet, plain, lowercase-leaning; no exclamation, no emoji, **no em-dash** in any folder name UI, confirm copy, or toast. Raw hex/px only allowed under `src/theme/**` (`src/no-raw-values.test.ts` enforces).

### Previous-story intelligence (Epic 6, apply these)

- **StrictMode `mountedRef` latch:** any hook with a `useRef(true)` mount guard must set `mountedRef.current = true` inside the effect body, not rely on the initializer — StrictMode's mount→cleanup→remount permanently latches it `false` otherwise, silently dropping updates. jsdom's `render()` is not StrictMode-wrapped, so unit tests pass while the dev app breaks. This bit Story 6.4. [Source: epic-6/6-4-bulk-upload-optimistic-rows.md Completion Notes]
- **Monotonic sequence guards:** optimistic-then-reconcile flows need a `fetchSeqRef`/`editSeqRef`-style guard so a slow response can't clobber a newer one (Story 6.4/6.6). [Source: epic-6/6-6, 6-4]
- **"Mock everything the mount/interaction calls":** a test that mounts `LibraryPage` must mock every api fn it can trigger, or an un-mocked `fetch` rejects in jsdom. The analog of the render/-mock-barrel rule. Bit Stories 6.3/6.4. [Source: epic-6/6-3-collection-table-view.md regression note]
- **Trusted input for focus-sensitive smoke:** the rename input is focus/blur-sensitive; smoke it with real click/`press_key`, never `dispatchEvent`/`.click()` (`[[use-trusted-input-for-focus-sensitive-smoke]]`).
- **Cross-model Codex review after dev-story (AE-6):** run `bmad-code-review` via Codex; it caught real HIGH/Med bugs in most Epic 6 stories.
- **Model-per-job (AE6-3):** run this story on **Sonnet 5 xHigh** per CLAUDE.md (the Epic 6 retro flagged silent drift to Opus on 6.5/6.8 — follow the convention here).

### Testing standards

- Backend: `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q` (154+ baseline; no pytest plugins). **Sandbox caveat (CLAUDE.md):** the FastAPI `TestClient` tests can hang under the Codex review sandbox; backend pytest is run-it-yourself on the host (`export UV_CACHE_DIR=/tmp/uv-cache`), and a reviewer verifies backend findings by reading. Prefer exercising the storage folder ops directly (temp `PAPER_MATE_DATA`) for the core lifecycle coverage; keep TestClient cases lean.
- Client: `cd client && npm test` (Vitest) + `npm run typecheck`. `no-raw-values.test.ts` must stay green after any CSS.
- Contract: regen openapi + `schema.d.ts` (committed), and keep `docs/API.md` current in the same change.
- No DPR>1 live smoke required (not a placement feature); one normal-DPR own-server pass per Task 8.

### Project Structure Notes

- New: `server/app/storage/library_index.py` gains `create_folder`/`rename_folder`/`delete_folder`; `storage/errors.py` gains `FolderNotFoundError`; `storage/__init__.py` re-exports them; `models.py` gains `FolderCreate`/`FolderRename`; `routes/library.py` gains three handlers; `client/src/api/client.ts` gains three fns; new `client/src/library/FolderPanel/` (`.tsx`/`.css`/`.test.tsx`, optional `useFolders.ts` + sub-units).
- Modified: `LibraryPage.tsx` (static aside → `<FolderPanel>`), `LibraryPage.test.tsx` (panel-shell regression), `docs/API.md`, `client/src/api/schema.d.ts` (regenerated).
- Aligns with the per-epic folder convention: this story file lives in `.bmad/implementation-artifacts/epic-7/`.

### References

- [Source: .bmad/planning-artifacts/epics.md#Story-7.1] — the 7 ACs, LFR-12/13/16, AL-5.
- [Source: .bmad/planning-artifacts/epics.md#Library-Requirements] — LFR-12..16 (F3 Folders), AL-1/AL-5/AL-6/AL-7/AL-8, L-UX-DR1/DR4/DR12/DR13.
- [Source: .bmad/planning-artifacts/architecture/architecture-paper-mate-library-2026-07-04/ARCHITECTURE-SPINE.md] — AL-5 (trash & folder lifecycle: delete-folder = subtree, papers → Uncategorized, never delete), AL-6 (`/api/library/folders` CRUD with subtree delete), AL-7 (serialized index writes).
- [Source: server/app/storage/library_index.py] — `mutate_index`, `_read_index_unlocked`, `read_library`, `reconcile_library`, `_default_index` (folders seed).
- [Source: server/app/models.py:107-143] — `Folder`, `CollectionRow.folder_id`, `Library`.
- [Source: server/app/routes/_errors.py, routes/docs.py:76-103, routes/library.py] — the route error seam + `patch_doc` idiom to mirror.
- [Source: client/src/library/LibraryPage.tsx:80-88, client/src/api/client.ts:71-84] — the static panel to replace + the `patchDoc` client idiom.
- [Source: .bmad/implementation-artifacts/epic-6/epic-6-retro-2026-07-05.md] — AE6-3 (model-per-job), the StrictMode/mock-on-mount/trusted-input Epic 6 lessons.
- [Source: CLAUDE.md] — tokens never inline hex/px; no em-dash in UI strings; don't reinvent wheels; OOP decomposition + refactor in the same change; document-level handlers (N/A here); launch your OWN dev servers for smoke; trusted input for focus-sensitive smoke; versioning (PATCH +1 at story done → 0.5.1); branch-per-story; backend-tests sandbox note; contract-types regen flow; maintain `docs/API.md` with any `/api` change.

## Dev Agent Record

### Agent Model Used

Recommended: Sonnet 5 xHigh (bmad-dev-story), per CLAUDE.md model-per-job and Epic 6 retro AE6-3.

### Debug Log References

### Completion Notes List

### File List
