---
baseline_commit: 32a8aa5
---

# Story 7.5: Trash (soft-delete, restore, purge)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a reader,
I want deletes to go to a Trash I can restore from, and a permanent purge when I mean it,
so that I never lose a paper or its annotations by accident.

## ⚠️ Read this first: this is a FULL-STACK story (unlike 7.4)

Stories 7.2–7.4 were client-only view-state. **7.5 is not.** Trash state (`trashed`) is **authoritative in `library.json`** (AD-L1), so soft-delete/restore are real backend org mutations and purge destroys a document dir on disk. You WILL touch `.py` files, regenerate `server/openapi.json` + `client/src/api/schema.d.ts`, and update `docs/API.md`. The client Trash **lens** (which rows show) is view-state (AD-L3), but the trash/restore/purge **operations** are backend.

Three new API surfaces + one changed behavior:
- `POST /api/library/trash` — set-based soft-delete `{doc_ids}` → `Library` (organizational, AD-L6).
- `POST /api/library/restore` — set-based restore `{doc_ids}` → `Library` (organizational, AD-L6).
- `DELETE /api/docs/{doc_id}` — **purge** (destroys the document) → `Library` (document surface, AD-L6).
- **`POST /api/docs` re-import of a trashed paper now RESTORES it** (clears `trashed`), no duplicate (AL-4 point 4 — the edge deferred from Story 6.4, flagged by AE6-5).

**The `trashed` field already exists** on `CollectionRow` (`server/app/models.py:180`) and every stored row (`import`/`reconcile` write `trashed: False`). `filterPapers` already excludes trashed rows in every branch (`client/src/library/folderFilter.ts:16`) and the `FolderPanel` already renders a **disabled** "Trash" pseudo-item (`FolderPanel.tsx:176-179`). You are activating a seam the last four stories deliberately laid, not inventing one.

## Acceptance Criteria

1. **(Soft-delete) Delete goes to Trash, annotations kept.** Given a paper or a multi-selection, when I delete it, then it soft-deletes: `trashed` flips to `true` in `library.json`, its `annotations.json`/`meta.json`/`source.pdf` are **untouched**, it leaves the normal and folder views (still excluded by `filterPapers`), it shows **only** in the Trash lens, and it **retains its `folder_id`** while trashed. (LFR-22, AL-5.1)

2. **(Trash lens) A view-state filter, not a route, with toolbar Restore + Purge.** Given the Trash lens (selecting the folder-panel Trash entry, `{ kind: "trash" }`, **not** a URL route, AD-L3), then it lists only trashed papers (no per-row action button; a row carries no Open either), and the toolbar's **Restore**/**Purge** buttons act on the current selection (post-review fix request, superseding the original per-row design - see Change Log 2026-07-07); empty copy reads exactly "Trash is empty." (AL-3/AD-L3, L-UX-DR8)

3. **(Restore) Returns to remembered folder, else Uncategorized, with a notice.** Given a trashed paper, when I restore it, then `trashed` clears and it returns to its remembered folder (its retained `folder_id`); if that folder no longer exists it lands in Uncategorized (`folder_id = null`); a non-error "restored from Trash" notice shows. (LFR-23, AL-5.2, L-UX-DR9)

4. **(Purge) Confirm, then permanent delete of the whole document.** Given a trashed paper, when I purge it, then a confirm dialog (stating the annotations go with it, **Esc-dismissable**, focus-managed) precedes a `DELETE /api/docs/{id}` that removes the whole `library/{doc_id}/` dir **and** its `library.json` entry permanently; purge is **manual only, no auto-purge**. (LFR-24, AL-5.3, AL-6, L-UX-DR8, L-UX-DR12)

5. **(Re-upload restores a trashed paper) No duplicate.** Given a re-upload of a PDF that is currently trashed (same bytes → same `doc_id`), then the upload **restores** the existing paper (clears `trashed`, keeps its retained `folder_id`) and surfaces "restored from Trash", rather than creating a duplicate row or a second `{doc_id}/` dir; the existing `annotations.json`/`meta.json` are never overwritten. (AL-4 point 4 — the edge deferred from Story 6.4, AE6-5)

6. **(Batch delete) Reuses 7.3 multi-select via the set-based path.** Given a multi-selection in a normal/folder view, when I delete it, then it trashes all selected in one set-based `POST /api/library/trash` taking `{doc_ids}`, applied through the serialized `library.json` write path (AL-7) so a concurrent background extraction refresh cannot drop it; the selection then resets. (LFR-3, LFR-22, AL-6, AL-7)

7. **(Copy) No em-dash anywhere.** Given any Trash label, action label, confirm copy, or notice, then no string contains an em-dash (`—`). (L-UX-DR9, L-UX-DR13, CLAUDE.md)

8. **(A11y) Every control keyboard-operable with visible focus.** Given the Trash lens entry, the toolbar Restore/Purge/Delete buttons, the sidebar Empty Trash icon, and the purge confirm, then each is a real focusable `<button>`, keyboard-operable, with a visible 2px `{colors.ink}` focus ring; the confirm is Esc-dismissable and returns focus to its trigger (reuse `ConfirmDialog`). (L-UX-DR12)

## Scope boundary (read first, prevents scope creep)

**In scope:**

- **Backend org ops:** `POST /api/library/trash`, `POST /api/library/restore` (set-based `{doc_ids}` → `Library`); `storage.trash_papers`/`storage.restore_papers` in `library_index.py` (serialized `mutate_index`, AL-7).
- **Backend purge:** `DELETE /api/docs/{doc_id}` → `Library`; `storage.purge_document(doc_id)` (rmtree the dir + prune the index entry, crash-safe order — see Dev Notes).
- **Backend re-import restore:** `import_pdf`'s idempotent re-import branch clears `trashed` (only that branch — `apply_extraction`/`reconcile` must NOT un-trash).
- **Contract:** a `DocIdSet` request model (`{doc_ids}` non-empty, `extra="forbid"`) that `MoveRequest` now subclasses; regenerate `openapi.json` + `schema.d.ts`; update `docs/API.md` + changelog.
- **Client Trash lens:** `FolderSelection` gains `{ kind: "trash" }`; `filterPapers` gains a trash branch; the disabled `FolderPanel` Trash `<li>` becomes a real selectable button; empty/count copy for the lens.
- **Client ops:** `api/client.ts` `trashPapers`/`restorePapers`/`purgeDoc`; a `useTrashPapers` hook (optimistic, mirrors `useMovePapers`); a toolbar **Delete** action (normal/folder views); per-row **Restore**/**Purge** in the Trash lens; a purge `ConfirmDialog`; the "restored from Trash" notice (delete + re-upload paths).
- Unit tests (backend + client) + a live smoke (own fresh servers). Version PATCH bump `0.5.4` → `0.5.5` at story done.

**Out of scope (do NOT build):**

- **Trash as a route.** It is `{ kind: "trash" }` view-state inside `/`, NOT `/trash` (AD-L3). No router change.
- **Auto-purge / retention timers.** Purge is manual and confirmed (AL-5.3, AC-4). No timer-based auto-purge.
- **A confirm on soft-delete.** Trash is the safety net; delete-to-Trash is immediate and reversible (only PURGE confirms, AC-4).

~~**Batch/toolbar restore or purge in the Trash lens** / **"empty Trash all" bulk purge**~~ (superseded 2026-07-07): both were originally out of scope in favor of per-row Restore/Purge, but a post-review fix request reversed this - see AC-2 and the Change Log. Restore/Purge now live in the toolbar (bulk over the selection) and the sidebar Trash entry reveals an Empty Trash icon (purges every trashed paper, gated behind the same `ConfirmDialog`).
- **Drag-to-Trash.** Delete is a toolbar/row action, not a drop target; the Trash panel entry is NOT a drop target (unlike folders/Uncategorized).
- **Moving a trashed paper into a folder.** Move does not apply in the Trash lens; hide the Move + Delete toolbar actions there.
- **Note authoring / a new file type** → Story 7.6.
- **Undo of a purge.** Purge is permanent by definition (AL-5.3); the confirm IS the guard.

## Tasks / Subtasks

- [x] **Task 1 — Backend request model: extract `DocIdSet`, subclass `MoveRequest` (AC: 1, 3, 6)**
  - [x] In `server/app/models.py`, extract a base `DocIdSet(BaseModel)` — `model_config = ConfigDict(extra="forbid")`, `doc_ids: list[str] = Field(min_length=1)` — carrying the shared "set-based org op" contract (AD-L6). Make `MoveRequest(DocIdSet)` add only `folder_id: str | None = None` (keep its existing docstring; it no longer redeclares `doc_ids`). `trash`/`restore` bodies are a bare `DocIdSet`. This is an OOP dedupe (CLAUDE.md), not a behavior change: FastAPI flattens the subclass, so the emitted `MoveRequest` schema is unchanged; `DocIdSet` is a new schema.

- [x] **Task 2 — Backend storage: trash / restore / purge (AC: 1, 3, 4, 6)**
  - [x] In `server/app/storage/library_index.py`, add `trash_papers(doc_ids: list[str]) -> Library` and `restore_papers(doc_ids: list[str]) -> Library`, each a single `mutate_index` mutator (AL-7 serialized write) mirroring `move_papers`'s validate-before-mutate shape: build `papers_by_id`, raise `DocumentNotFoundError(missing[0])` if any id is unknown (all-or-nothing, no partial write), then flip `trashed` (`True` for trash, `False` for restore). **Trash leaves `folder_id`/`order` untouched** (AC-1). **Restore leaves `folder_id` as-is** (AC-3: it is the remembered folder) — see the Dev Notes "Restore target" note for why no dangling-folder guard is needed. Return `read_library()` like `move_papers`.
  - [x] Add `purge_document(doc_id: str) -> Library` (home it in `documents.py`, since it composes `paths` + the index; re-export from `storage/__init__.py`). Recipe (crash-safe order in Dev Notes): resolve `doc_dir` via `paths.doc_dir` (unresolvable → `DocumentNotFoundError`); if the dir does not exist → `DocumentNotFoundError`; then **under `library_index._index_lock`** (expose it or add a thin `library_index.purge_entry(doc_id)` helper that runs inside `mutate_index`): **`shutil.rmtree(doc_dir)` FIRST, then `mutate_index` to drop the paper entry.** Return `read_library()`.
  - [x] Re-export `trash_papers`, `restore_papers`, `purge_document` from `server/app/storage/__init__.py` `__all__` + imports (they must be reachable as `storage.<name>`; nothing outside the package imports a submodule).

- [x] **Task 3 — Backend re-import restores a trashed paper (AC: 5)**
  - [x] In `server/app/storage/documents.py` `import_pdf`, the **idempotent re-import branch** (`existing is not None`) must clear `trashed` on the paper's index entry. Today it calls `upsert_paper_entry`, which by contract "leaves an existing `folder_id`/`trashed`/`order` untouched" — that is correct for `apply_extraction`/`reconcile` but WRONG for a user re-upload (AC-5 requires restore). Add a parameter or a sibling mutator so ONLY the import path un-trashes: e.g. `upsert_paper_entry(index, doc_id, meta, restore=True)` where `restore=True` also sets `entry["trashed"] = False`. Keep `folder_id`/`order` intact (restore to remembered folder). Do NOT change the new-import branch (a new import already writes `trashed: False`).
  - [x] `apply_extraction` and `reconcile_library` keep calling `upsert_paper_entry` with the default (no restore) — a background extraction settling must never resurrect a paper the user trashed mid-extraction.

- [x] **Task 4 — Backend routes: trash / restore / purge (AC: 1, 3, 4, 6)**
  - [x] In `server/app/routes/library.py`, add `POST /library/trash` and `POST /library/restore`, each taking a `DocIdSet` body, `response_model=Library`, wrapped in `storage_errors("Could not update the collection")` (unknown `doc_id` → 404 `"Document not found"`; empty `doc_ids` → 422 from the model). Mirror `move_papers`'s handler exactly (minus the folder 404 branch — there is no `folder_id`).
  - [x] In `server/app/routes/docs.py`, add `DELETE /docs/{doc_id}`, `response_model=Library`, `storage_errors("Could not purge document")` (unknown/purged id → 404 `"Document not found"`). Docstring: purge destroys the dir + prunes the entry; annotations go with it; manual only.
  - [x] Regenerate the contract: `cd server && PYTHONPATH= uv run python -m app.export_openapi` then `cd client && npm run gen:api`. Commit both `server/openapi.json` and `client/src/api/schema.d.ts` (never hand-author `schema.d.ts`).

- [x] **Task 5 — Client API layer + Trash lens plumbing (AC: 1, 2, 5)**
  - [x] `client/src/api/client.ts`: add `trashPapers(docIds)`, `restorePapers(docIds)` (POST the `DocIdSet` shape → `Library`, mirror `movePapers`) and `purgeDoc(docId)` (`DELETE /api/docs/{id}` → `Library`). Reuse `envelopeError`.
  - [x] `client/src/library/folderFilter.ts`: extend `FolderSelection` with `| { kind: "trash" }` and add the branch to `filterPapers` — `if (selection.kind === "trash") return papers.filter((p) => p.trashed);` BEFORE the existing `const untrashed = ...` (which stays the base for all other kinds). Update the module docstring (it currently says Story 7.5's Trash lens will surface them — now it does).
  - [x] `client/src/library/FolderPanel/FolderPanel.tsx`: turn the disabled Trash `<li>` (currently `aria-disabled="true"`, lines ~176-179) into a real `<button className="library-folder-panel__item ...">` wired to `onSelect({ kind: "trash" })` with the active-highlight class when `isSelected(selection, { kind: "trash" })`, mirroring the Uncategorized entry (but NOT a drop target — no `onDragOver`/`onDrop`). Leave `Recent`/`Starred` disabled.

- [x] **Task 6 — Client operations hook: `useTrashPapers` (AC: 1, 3, 4, 5, 6)**
  - [x] Add `client/src/library/useTrashPapers.ts` mirroring `useMovePapers.ts` (same `mountedRef` StrictMode reset + monotonic `seqRef` stale-response guard). Expose `trashPapers(docIds)`, `restorePapers(docIds)`, `purge(docId)`:
    - `trashPapers`: optimistically set `trashed: true` on the matching rows (they leave the current view), call `apiTrashPapers`, reconcile from the returned `Library`, revert + `onToast("Couldn't delete that paper.", "error")` on failure.
    - `restorePapers`: optimistically set `trashed: false`, call `apiRestorePapers`, reconcile, and on success `onToast("restored from Trash", "info")` (AC-3 notice); revert + `onToast("Couldn't restore that paper.", "error")` on failure.
    - `purge`: optimistically remove the row from `library.papers`, call `apiPurgeDoc`, reconcile from the returned `Library`, revert (re-insert) + `onToast("Couldn't purge that paper.", "error")` on failure.
  - [x] All three go through `setLibrary` (owned by `useCollection`), like `useMovePapers`. No new authoritative state.

- [x] **Task 7 — Wire LibraryPage: toolbar Delete, per-row Restore/Purge, purge confirm, lens copy (AC: 1, 2, 4, 6, 7, 8)**
  - [x] In `LibraryPage.tsx`, instantiate `useTrashPapers({ setLibrary, onToast })`. Add a toolbar **Delete** button (a `.toolbar-button`, next to `Move`) shown ONLY when `selection.kind !== "trash"`, `disabled={selectedIds.size === 0}`, that trashes `Array.from(selectedIds)` then clears the selection (`setSelectedIds(new Set())`) — mirror `handleMoveRequest`. In the Trash lens (`selection.kind === "trash"`), **hide Move + Delete** (Display + Add stay).
  - [x] Pass a lens signal + trash callbacks into `CollectionTable` → `PaperRow` so a trash-lens row renders **Restore** + **Purge** in place of **Open** (see Task 8). Restore calls `trash.restorePapers([docId])`; Purge sets a `purgeTarget` row (opens the confirm).
  - [x] Purge confirm: reuse `ConfirmDialog` (`components/ConfirmDialog`). Own a `const [purgeTarget, setPurgeTarget] = useState<CollectionRow | null>(null)` (mirror `FolderPanel`'s `deleteTarget`). `title={purgeTarget ? \`Purge "${displayTitle}"\` : ""}`, `message="This permanently deletes the paper and its annotations. This cannot be undone."`, `confirmLabel="Purge"`, `onConfirm` → `trash.purge(purgeTarget.doc_id)` + close, `onCancel` → close. (Grep the copy for `—` first — none.)
  - [x] Count line + empty copy: `selectionLabel` returns "Trash" for `{ kind: "trash" }`; `emptySelectionMessage` returns exactly "Trash is empty." for it (AC-2, distinct from the folder-empty copy). The count line "N files in Trash" follows for free (it reads `visiblePapers.length`).
  - [x] Pending/upload rows: `visiblePending` is already `[]` for a folder selection; also make it `[]` in the Trash lens (a just-uploaded paper is never trashed).

- [x] **Task 8 — CollectionTable / PaperRow: trash-lens row actions (AC: 2, 8)**
  - **Superseded 2026-07-07** (see Change Log): the per-row `onRestore`/`onPurge` design below shipped, then a post-review fix request moved Restore/Purge to the toolbar (bulk over the selection). `PaperRow` now takes a single `trashLens?: boolean` that only hides the Open button (and disables drag); it carries no action button of its own. Left here as the historical record of what Task 8 originally built.
  - [x] `PaperRow` takes an optional lens/trash-actions prop (smallest shape: `onRestore?: () => void; onPurge?: () => void`). When present (Trash lens), the Title cell renders **Restore** + **Purge** buttons instead of **Open** (a trashed paper is not opened). Keep the same hover/focus-reveal + `e.stopPropagation()` + `onKeyDown` stop pattern the Open button uses (`PaperRow.tsx:96-106`) so a row click still selects and the buttons stay keyboard-reachable with the 2px focus ring. Title/Authors inline edit is irrelevant here but need not be actively disabled (a trashed row is transient); keep the change minimal.
  - [x] `CollectionTable` threads the lens/trash callbacks from `LibraryPage` down to each `PaperRow` (per `row.doc_id`). Do NOT change the 7.3 selection/range math or the sort/column-visibility props — this is additive.
  - [x] Any new button label/aria-label plain and em-dash-free.

- [x] **Task 9 — Client: "restored from Trash" on re-upload (AC: 5)**
  - [x] In `useCollection.ts` `handleResolved(doc)`, detect the restore: the closure has `prev.papers`; if `prev.papers.find((p) => p.doc_id === doc.doc_id)?.trashed === true`, the re-upload just restored a trashed paper — call `onToast("restored from Trash", "info")`. This needs no contract change (the pre-upload snapshot carries the `trashed` flag). Note: `docToRow` fabricates `folder_id: null`/`trashed: false` for the optimistic row; the authoritative `GET /api/library` reconcile in `handleBatchSettled` restores the true retained `folder_id` a beat later — acceptable (the paper was invisible while trashed; a brief Uncategorized flash before reconcile is fine). Do NOT try to preserve `folder_id` in `docToRow` (it has no folder info; the reconcile owns it).

- [x] **Task 10 — Tests (AC: 1, 2, 3, 4, 5, 6, 7, 8)**
  - [x] **Backend** (`PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q`):
    - `test_library.py`: trash flips `trashed`, leaves `folder_id`/`order`; restore clears `trashed`, keeps `folder_id`; **restore-after-folder-delete lands Uncategorized** (trash a paper in folder F, delete F — assert its `folder_id` is now `null` via `delete_folder`'s re-home — then restore → still `null`; locks the AC-3 "else Uncategorized" invariant); unknown `doc_id` → 404 `"Document not found"`; empty `doc_ids` → 422; extra field → 422. Assert `annotations.json` untouched by a trash (write annotations, trash, read back equal).
    - `test_docs.py`: `DELETE /api/docs/{id}` purges — the dir is gone (`(data_root/"library"/doc_id).exists() is False`) AND `GET /api/library` no longer lists it; purge unknown id → 404; **re-import of a trashed paper restores it** (import; trash; re-import same bytes → `GET /api/library` shows one row, `trashed False`, same `doc_id`, retained `folder_id`; and its stored `annotations.json`/`meta.json` unchanged — the AE6-5 edge); a re-import of a trashed paper that WAS in a folder keeps that `folder_id`.
    - `test_storage.py`: `purge_document` unit (dir removed, entry pruned); the crash-safe order is documented, but a unit asserting a purged-then-reconcile does NOT resurrect (rmtree the dir, run `reconcile_library`, assert the entry is pruned not re-added) guards the ordering rationale.
    - `test_models.py`: `DocIdSet` rejects empty `doc_ids` (422) and an extra field; `MoveRequest` still validates `{doc_ids, folder_id}` (subclass regression).
  - [x] **Client** (`npm test` + `npm run typecheck`):
    - `folderFilter.test.ts`: the `{ kind: "trash" }` branch returns only trashed rows; the other kinds still exclude trashed.
    - `useTrashPapers.test.ts` (mirror `useMovePapers.test.ts`): optimistic trash/restore/purge, reconcile from the returned `Library`, revert + error toast on failure, the "restored from Trash" info toast on a successful restore, stale-response guard.
    - `LibraryPage.test.tsx`: toolbar Delete trashes the selection and clears it; selecting Trash shows the trashed rows with Restore/Purge (not Open); Restore removes a row from the Trash view + fires the notice; Purge opens the confirm, confirming calls `purgeDoc` (mock) and removes the row, Esc cancels; "Trash is empty." copy when the lens is empty. Keep `getLibrary`/`trashPapers`/`restorePapers`/`purgeDoc` mocked; touch no `render/` mock barrel (Library, not Reader).
    - `FolderPanel.test.tsx`: the Trash entry is now a real button, selectable, active-highlighted when selected.
    - `useCollection.test` (if present) or `LibraryPage.test.tsx`: a resolved upload whose `doc_id` was `trashed` in the prior library fires "restored from Trash".
    - `no-raw-values.test.ts` stays green (any new CSS token-only).
  - [x] Grep every new UI string for `—` before committing (AC-7).

- [x] **Task 11 — Live smoke (own fresh servers) (AC: 1, 2, 3, 4, 5, 6)**
  - [x] Launch your OWN fresh `uvicorn` + `vite dev` on alternate ports against an isolated scratch `PAPER_MATE_DATA` (do NOT reuse a user-running server — CLAUDE.md). Seed several real sample PDFs from `fixtures/sample-pdfs/` via the real `POST /api/docs` path; create a folder and move a paper into it. Tear both servers down after.
  - [x] Verify live: (a) select rows + toolbar **Delete** → they leave the current view and appear under **Trash**; confirm via `GET /api/library` that `trashed:true` and `folder_id` is retained. (b) In Trash, **Restore** a paper → it leaves Trash, returns to its folder, and the "restored from Trash" notice shows. (c) **Purge** a paper → the confirm appears (Esc cancels; confirm proceeds), the row disappears, and BOTH `GET /api/library` no longer lists it AND the `library/{doc_id}/` dir is gone on disk. (d) **Re-upload** a PDF you have trashed (same file) → it restores in place (one row, notice), no duplicate row, no second dir; verify the annotations you had are intact. (e) Batch: multi-select several rows, Delete → all trashed in one call. (f) Keyboard: the Trash entry, Restore/Purge buttons, Delete button, and the confirm are all Tab-reachable with a visible focus ring; the confirm is Esc-dismissable and returns focus. Normal DPR is fine — this story adds no coordinate/anchor geometry (no DPR>1 gate).

- [x] **Task 12 — Version + docs + review**
  - [x] Bump `server/pyproject.toml` `[project].version` `0.5.4` → `0.5.5`; sync `server/uv.lock`'s `paper-mate-server` version field (line ~184) to match (7.4 confirmed the lock records it); `cd server && uv lock --check`.
  - [x] Update `docs/API.md`: add the `POST /api/library/trash`, `POST /api/library/restore`, and `DELETE /api/docs/{doc_id}` resource entries + a `DocIdSet` note, and note `POST /api/docs`'s new "re-import restores a trashed paper" behavior; add a `2026-07-07 (Story 7.5)` changelog line (contract shape change: three new paths + one new `DocIdSet` schema).
  - [x] After dev-story, run the cross-model Codex `bmad-code-review` (AE-6) on the diff. Resolve High/Med before done. Backend pytest is run-it-yourself on the host (CLAUDE.md Sandbox note).

- [x] **Task 13 — Post-review fix requests: toolbar Restore/Purge, Delete icon, sidebar Empty Trash (AC: 2, 8)**
  - [x] Reverses Task 8's per-row design (see its supersession note): `PaperRow` drops `onRestore`/`onPurge` for a single `trashLens?: boolean` that hides Open + disables drag; `CollectionTable` threads `trashLens` instead of two per-row callbacks.
  - [x] `LibraryPage`'s toolbar grows **Restore**/**Purge** buttons (icons: `ArrowCounterClockwise`/`Trash`) in the Trash lens, disabled until `selectedIds` is non-empty; Purge opens the existing purge `ConfirmDialog`, now generalized from one `CollectionRow | null` target to a `CollectionRow[]` list (title reads `Purge "X"` for one, `Purge N papers` for many). The normal-lens **Delete** button gets a `TrashSimple` icon to match.
  - [x] `FolderPanel`'s Trash sidebar entry reveals an **Empty Trash** icon on hover/focus (only when the library has any trashed paper), mirroring `FolderRow`'s action-reveal pattern; it funnels into the same toolbar purge `ConfirmDialog` via `onRequestEmptyTrash`, purging every trashed paper.
  - [x] Tests updated: `PaperRow`'s row-overlay tests replaced with `trashLens`-based ones in `CollectionTable.test.tsx`; `LibraryPage.test.tsx`'s Trash describe block rewritten for the toolbar flow, plus new bulk-purge and Empty-Trash tests; `FolderPanel.test.tsx` gained Empty Trash reveal/callback tests. No backend or contract changes (UI only).
  - [x] Grepped every new UI string for `—`: none found.

## Dev Notes

### The exact hook points (read the current code, do not re-architect)

The org-mutation machinery already exists; you are adding two more org verbs (trash/restore) shaped exactly like `move`, one destructive verb (purge), and a client lens that flips one filter branch.

- **`move_papers` is your template for trash/restore.** Validate-before-mutate inside one `mutate_index` mutator, all-or-nothing on an unknown id, return `read_library()`. Copy its shape; flip `trashed` instead of assigning `folder_id`. [Source: server/app/storage/library_index.py:225-248]
- **The purge TOCTOU is already anticipated.** `update_meta_and_reindex` guards against a purge racing a meta-write (`create_parents=False` + a `doc_dir.is_dir()` re-check) — so the codebase already assumes purge can delete a dir mid-flight. Your `purge_document` is the operation that guard was written for. [Source: server/app/storage/library_index.py:303-342]
- **`import_pdf`'s re-import branch is where AC-5 lives.** The `existing is not None` branch already re-writes meta + `upsert_paper_entry`; add the un-trash there (and ONLY there). [Source: server/app/storage/documents.py:81-92]
- **`upsert_paper_entry` explicitly preserves `trashed`.** Its docstring says a re-import "leaves an existing `folder_id`/`trashed`/`order` untouched" — that is the behavior you must make conditional (restore-on-import vs preserve-on-extraction/reconcile). [Source: server/app/storage/library_index.py:107-128]
- **`storage_errors` maps the exception taxonomy to the `{detail}` envelope.** trash/restore/purge reuse it exactly like the folder/move routes; unknown id → `DocumentNotFoundError` → 404 `"Document not found"`. [Source: server/app/routes/_errors.py, server/app/routes/library.py:110-121]
- **The client op hook pattern is `useMovePapers`.** `mountedRef` StrictMode reset, a monotonic `seqRef` so a stale slow response can't clobber a newer op, optimistic `setLibrary` map, reconcile-on-resolve, revert-on-failure. `useTrashPapers` is the same skeleton with three verbs. [Source: client/src/library/useMovePapers.ts]
- **`filterPapers` already has the trash exclusion; add the trash-only branch.** One line before `const untrashed`. [Source: client/src/library/folderFilter.ts:15-20]
- **The `FolderPanel` Trash item is a disabled placeholder waiting for you.** Convert it to a button like Uncategorized (line ~155-171), minus the drop-target handlers. [Source: client/src/library/FolderPanel/FolderPanel.tsx:172-179]
- **`ConfirmDialog` is the purge confirm, already Esc-dismissable + focus-managed.** `FolderPanel` uses it for folder-delete with a `deleteTarget` state; mirror that with a `purgeTarget`. Its cancel-focused-on-open + Escape-cancels-never-confirms behavior satisfies AC-8. [Source: client/src/components/ConfirmDialog/ConfirmDialog.tsx, client/src/library/FolderPanel/FolderPanel.tsx:249-256]
- **The toolbar-action + selection wiring is `MoveMenu` + `selectedIds`.** Delete is simpler than Move (no folder popover): a plain `.toolbar-button` calling `trash.trashPapers(Array.from(selectedIds))` + clear. The Move button is already `disabled={selectedIds.size === 0}`; Delete matches. [Source: client/src/library/LibraryPage.tsx:197-209, client/src/library/MoveMenu.tsx:84-107]

### Purge crash-safety: rmtree FIRST, then prune the index entry (do not invert)

`reconcile_library` **adds** an on-disk `library/{doc_id}/` dir that is absent from the index as a fresh Uncategorized, untrashed row (`library_index.py:282-297`). That reconcile runs on every boot. So the purge order is load-bearing:

- **Correct: rmtree the dir, THEN drop the index entry** (both under `_index_lock`). A crash after rmtree but before the prune leaves an index entry pointing at a vanished dir → the next boot's reconcile **prunes** it (`papers[:] = [entry for entry in papers if entry["doc_id"] in on_disk_ids]`, line 271). Consistent.
- **WRONG: prune the entry, then rmtree.** A crash in between leaves an orphan dir with no index entry → the next boot's reconcile **re-adds** it as a fresh Uncategorized, untrashed paper — **resurrecting the paper the user purged** (and un-trashing it). Never do this.

Add a `test_storage.py` case that rmtrees a dir then runs `reconcile_library` and asserts the entry is pruned (not re-added) so this ordering rationale is locked by a test, not just a comment.

### Restore target: no dangling-folder guard needed (but test it)

AC-3 says restore returns to the remembered folder "or to Uncategorized if that folder no longer exists." You do **not** need a `if folder missing → None` guard in `restore_papers`, because the only way a folder disappears is `delete_folder`, which re-homes **every** paper in the subtree to Uncategorized — **including trashed ones** (`library_index.py:216-218` re-homes any paper whose `folder_id in removed`, with no `trashed` check). So a trashed paper whose folder gets deleted already has `folder_id = null` before restore ever runs. Restoring just clears `trashed`; the retained `folder_id` is guaranteed to reference a live folder or be `null`. **Do not add speculative dangling-folder handling** (CLAUDE.md: less is more). DO add the `test_library.py` case (trash-in-folder → delete-folder → restore → assert `folder_id is None`) so this invariant is a guarantee, not an accident.

### Why `DocIdSet` (contract dedupe, OOP)

`MoveRequest` already IS "a set of doc_ids plus a target." trash/restore are "a set of doc_ids" with no target. Extracting the base `DocIdSet` and subclassing `MoveRequest(DocIdSet)` is the right modular decomposition (CLAUDE.md: refactor structure in the same change; prefer OOP). FastAPI flattens the subclass into OpenAPI, so `MoveRequest`'s emitted schema is byte-identical — the only contract delta is the new `DocIdSet` schema + the three new paths. Confirm the diff of `server/openapi.json` shows exactly that (no unexpected `MoveRequest` churn) before regenerating `schema.d.ts`.

### Optimistic UX + reconcile (AC-1/3/4)

- **Trash:** flip `trashed:true` optimistically so the row leaves the current (non-trash) view instantly; reconcile from the returned `Library`. A paper trashed from a folder view visibly vanishes without waiting on the round-trip (like `move`).
- **Restore:** flip `trashed:false` so it leaves the Trash view instantly; reconcile; fire the "restored from Trash" info toast on success.
- **Purge:** remove the row from `papers` optimistically; reconcile from the returned `Library`; revert (re-insert the row) + error toast on failure.
- All three reuse the `useMovePapers` stale-response `seqRef` guard so a slow trash can't clobber a faster later restore of the same paper (or vice versa).

### No em-dash / voice (AC-7, L-UX-DR9/13)

Every new string plain and em-dash-free: "Trash", "Restore", "Purge", "Delete", "Trash is empty.", "restored from Trash", "Couldn't delete that paper.", "Couldn't restore that paper.", "Couldn't purge that paper.", and the confirm copy ("This permanently deletes the paper and its annotations. This cannot be undone."). Obsidian-quiet: state the fact, no exclamation, no emoji. Grep the diff for `—` before committing.

### Testing standards

- Backend: `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q` (run-it-yourself on host; the Codex sandbox reviewer reads, per CLAUDE.md). Mirror `test_library.py`'s move cases and `test_docs.py`'s import/patch cases; reuse `conftest.py`'s `data_root` + `make_pdf_bytes`.
- Client: `cd client && npm test` (Vitest) + `npm run typecheck`. Mirror `useMovePapers.test.ts` for the op hook, `folderFilter.test.ts` for the lens branch, and the existing `LibraryPage.test.tsx`/`FolderPanel.test.tsx` for the integration.
- `no-raw-values.test.ts` (raw hex/px only in `src/theme/**`) stays green.
- Contract: after any `.py` model/route change, regenerate `openapi.json` + `schema.d.ts` and update `docs/API.md` in the SAME change (CLAUDE.md).
- Live smoke per Task 11 (own fresh servers, real PDFs, normal DPR).
- After dev-story, run the cross-model Codex `bmad-code-review` (AE-6) on the diff.

### Project Structure Notes

- **New (backend):** none (all additions land in existing modules). **Modified (backend):** `server/app/models.py` (`DocIdSet` + `MoveRequest` subclass), `server/app/storage/library_index.py` (`trash_papers`/`restore_papers` + purge-entry helper + conditional `upsert_paper_entry` restore), `server/app/storage/documents.py` (`purge_document` + `import_pdf` re-import un-trash), `server/app/storage/__init__.py` (re-exports), `server/app/routes/library.py` (trash/restore), `server/app/routes/docs.py` (DELETE purge), `server/openapi.json` (regenerated).
- **New (client):** `client/src/library/useTrashPapers.ts` (+ `useTrashPapers.test.ts`). **Modified (client):** `api/client.ts` (three fns) + `api/schema.d.ts` (regenerated), `library/folderFilter.ts` (+ test), `library/FolderPanel/FolderPanel.tsx` (+ test), `library/LibraryPage.tsx` (+ test), `library/CollectionTable/CollectionTable.tsx` + `PaperRow.tsx` (+ tests), any new CSS (token-only) for the trash-row actions / Delete button.
- **Modified (version):** `server/pyproject.toml` (`0.5.4` → `0.5.5`), `server/uv.lock`. **Modified (docs):** `docs/API.md`.
- This story file lives in `.bmad/implementation-artifacts/epic-7/` (per-epic convention, same as 7.1–7.4).
- **Branch per story:** cut `story-7-5-trash-soft-delete-restore-purge` off `main` before implementing (CLAUDE.md). Update `sprint-status.yaml` to `done` at PR-merge time (AE3-1); fill the Dev Agent Record before flipping to `done` (AE3-2).

### References

- [Source: .bmad/planning-artifacts/epics.md#Story-7.5] — the epic ACs (LFR-22 soft-delete, LFR-23 restore, LFR-24 purge, AL-5, L-UX-DR8, batch-delete reuses 7.3, no em-dash).
- [Source: .bmad/planning-artifacts/architecture/architecture-paper-mate-library-2026-07-04/ARCHITECTURE-SPINE.md#AD-L5] — trash/folder lifecycle: soft-delete flips `trashed` + retains membership; restore returns to remembered folder else Uncategorized; purge deletes the whole dir + entry, manual only.
- [Source: .../ARCHITECTURE-SPINE.md#AD-L4] — point 4: a re-upload of a trashed paper restores it, no duplicate (the AE6-5 edge deferred from 6.4).
- [Source: .../ARCHITECTURE-SPINE.md#AD-L6] — API boundary: set-based `POST /api/library/trash | restore` take `{doc_ids}`; purge is `DELETE /api/docs/{id}` (document surface). Trash is organizational (`/api/library`); purge destroys the document (`/api/docs`).
- [Source: .../ARCHITECTURE-SPINE.md#AD-L7] — all `library.json` mutations serialized read-modify-write under one lock (trash/restore/purge included).
- [Source: .../ARCHITECTURE-SPINE.md#AD-L3] — Trash is a Library view-state filter, NOT a route.
- [Source: .bmad/planning-artifacts/epics.md#Library-UX-Design-Requirements] — L-UX-DR8 (Trash lens, per-row Restore/Purge, "Trash is empty.", purge confirm states annotations go with it), L-UX-DR9 (restore notice non-error; purge failure is a toast; no em-dash), L-UX-DR12 (keyboard + 2px ink focus + Esc-dismissable confirm), L-UX-DR13 (voice).
- [Source: .bmad/implementation-artifacts/sprint-status.yaml] — AE6-5: "Story 7.5 (Trash) must honor the AL-4 point-4 re-upload-restores-trashed edge that 6.2/6.4 deferred to it; flag in the 7.5 story spec at create-story time." (Honored: AC-5 + Task 3 + Task 9.)
- [Source: server/app/storage/library_index.py:225-248,303-342,282-297] — the `move_papers` template, the purge TOCTOU guard, the reconcile add/prune that dictates purge order.
- [Source: server/app/storage/documents.py:69-110] — `import_pdf`'s new vs re-import branches (AC-5 lands in re-import).
- [Source: server/app/routes/library.py:101-121, server/app/routes/docs.py:33-54] — the move route + upload route to mirror for trash/restore + purge.
- [Source: client/src/library/useMovePapers.ts] — the optimistic op-hook pattern for `useTrashPapers`.
- [Source: client/src/library/folderFilter.ts, client/src/library/FolderPanel/FolderPanel.tsx:172-179] — the lens filter + the disabled Trash entry to activate.
- [Source: client/src/components/ConfirmDialog/ConfirmDialog.tsx] — the reusable Esc-dismissable purge confirm.
- [Source: CLAUDE.md] — full-stack contract regen discipline; no em-dash in UI strings; adopt stable solutions; smallest correct structure / less is more (no speculative dangling-folder guard); OOP dedupe (`DocIdSet`); launch your OWN dev servers for smoke; versioning (PATCH +1 → 0.5.5); branch-per-story; update `sprint-status.yaml` at merge; fill the Dev Agent Record before done.
- Memory: [[no-emdash-user-facing]], [[prefer-stable-solutions]], [[use-codegraph-navigation]], [[verify-on-hidpi-and-real-host]] (normal DPR fine here — no coordinate geometry).

## Dev Agent Record

### Agent Model Used

Sonnet 5 (xHigh)

### Debug Log References

- Backend: `PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q`: 221 passed (was 207 at story start).
- Client: `npm run typecheck` clean; `npm test`: 1170 passed, 61 files (one Reader hold-Space timing test flaked once in the full-suite run, reproduced green in isolation; pre-existing, unrelated to this story's scope). After Task 13's post-review fix requests: `npm run typecheck` clean; `npm test`: 1176 passed, 61 files.
- Contract: `python -m app.export_openapi` + `npm run gen:api` regenerated `openapi.json`/`schema.d.ts`; diffed to confirm `MoveRequest`'s emitted schema is unchanged (docstring only) and the only delta is the new `DocIdSet` schema + three new paths.
- Live smoke (Task 11): own fresh `uvicorn` (port 8010) + `vite dev` (port 5183) against an isolated scratch data dir, seeded with real `fixtures/sample-pdfs/` PDFs via `POST /api/docs`. Verified via curl (backend) and Playwright (UI, substituting for the unavailable Chrome extension in this session): batch delete → Trash with retained `folder_id`; Restore → returns to folder + "restored from Trash" toast; Purge → Esc cancels + returns focus to trigger, confirm removes row + deletes `library/{doc_id}/` dir + prunes the index entry; re-upload of a trashed paper restores it (one row, no duplicate dir, annotations intact); Tab reaches the Trash entry with a visible focus ring, Enter activates it. Both servers torn down after.

### Completion Notes List

- `DocIdSet` extracted as the base set-based org-op contract; `MoveRequest(DocIdSet)` adds only `folder_id` (OOP dedupe, CLAUDE.md), confirmed FastAPI emits an unchanged `MoveRequest` schema.
- `trash_papers`/`restore_papers` mirror `move_papers`'s validate-before-mutate shape exactly (all-or-nothing on an unknown id); `purge_document` follows the crash-safe rmtree-then-prune order from the Dev Notes, with a `purge_entry` helper in `library_index.py` so the rmtree + index prune share one `_index_lock` critical section.
- `upsert_paper_entry` grew a `restore: bool = False` kwarg; only `import_pdf`'s re-import branch passes `restore=True`. `apply_extraction`/`reconcile_library` are unchanged and were tested to confirm they do NOT resurrect a trashed paper.
- Client: `useTrashPapers` mirrors `useMovePapers`'s `mountedRef`/monotonic-`seqRef` skeleton with all three verbs sharing one sequence counter (a slow trash can't clobber a faster later restore, per Dev Notes). `PaperRow` swaps Open for Restore+Purge only when both callbacks are supplied (Trash lens); `LibraryPage` hides Move/Delete in that lens and reuses `ConfirmDialog` for the purge confirm.
- All new UI strings grepped for em-dash (AC-7): none found in the diff.
- Version bumped `0.5.4` → `0.5.5` (`server/pyproject.toml` + `server/uv.lock`, `uv lock --check` clean).
- **Cross-model Codex `bmad-code-review` (AE-6):** ran `codex exec` non-interactively against the working-tree diff (baseline `32a8aa5` = HEAD), following `.claude/skills/bmad-code-review/SKILL.md`. Found one real Medium and one accepted-design candidate:
  - **Fixed (Medium):** a Trash-lens row was still `draggable`, so dragging a trashed paper onto a `FolderPanel` folder (drop targets stay active regardless of lens) silently moved it via `handleMoveRequest`/`movePapers` while trashed, violating this story's own explicit scope exclusion ("Moving a trashed paper into a folder. Move does not apply in the Trash lens"). Fixed by disabling `draggable`/`onDragStart` at the row source whenever `onRestore`/`onPurge` are present (`PaperRow.tsx`), the same signal already used to detect the lens. Added a regression test (`CollectionTable.test.tsx`).
  - **Verified and NOT changed (accepted design):** `useTrashPapers`'s three verbs share one monotonic `opSeqRef` (not per-doc), so a slow op on paper A can be silently superseded by a faster unrelated op on paper B, skipping A's revert/error-toast on a later failure. This is not a new defect: `useMovePapers` has the IDENTICAL single-global-seq property (unchanged, pre-existing), and this story's own Dev Notes explicitly directed `useTrashPapers` to "reuse the `useMovePapers` stale-response `seqRef` guard" as-is. Making it per-doc would be a scope expansion beyond what the story asked for (CLAUDE.md: smallest correct structure).
  - Client suite re-verified green after the fix: 1171 passed (61 files), typecheck clean.
- **Task 13, post-review fix requests (user-directed, reverses part of the original scope boundary):** the user asked, after seeing the shipped UI, to (1) move Restore/Purge off the per-row hover overlay onto the toolbar as bulk actions over the selection, with icons, (2) add an icon to the normal-lens Delete button, and (3) add a sidebar Empty Trash icon (hover-reveal on the Trash entry) that purges every trashed paper at once. This directly reverses two lines this story's own Scope Boundary had marked out of scope ("batch/toolbar restore or purge" and "empty Trash all bulk purge") and loosens AC-2's "per-row" wording; both were updated in place (with a superseded-note left on Task 8 and the Scope Boundary bullet) rather than silently diverging from the story text. No backend or contract change was needed - this is UI-only, so no version bump.

### File List

**Backend:**
- `server/app/models.py` (modified: `DocIdSet` extracted, `MoveRequest(DocIdSet)`)
- `server/app/storage/library_index.py` (modified: `trash_papers`, `restore_papers`, `purge_entry`, conditional-restore `upsert_paper_entry`)
- `server/app/storage/documents.py` (modified: `purge_document`, `import_pdf` re-import restore)
- `server/app/storage/__init__.py` (modified: re-exports)
- `server/app/routes/library.py` (modified: `POST /library/trash`, `POST /library/restore`)
- `server/app/routes/docs.py` (modified: `DELETE /docs/{doc_id}`)
- `server/pyproject.toml` (modified: version `0.5.4` → `0.5.5`)
- `server/uv.lock` (modified: `paper-mate-server` version synced)
- `server/tests/test_models.py`, `server/tests/test_storage.py`, `server/tests/test_library.py`, `server/tests/test_docs.py` (modified: new tests)

**Contract:**
- `server/openapi.json` (regenerated, gitignored build artifact)
- `client/src/api/schema.d.ts` (regenerated)

**Client:**
- `client/src/api/client.ts` (modified: `trashPapers`, `restorePapers`, `purgeDoc`, `DocIdSet` type)
- `client/src/library/useTrashPapers.ts` (new)
- `client/src/library/useTrashPapers.test.ts` (new)
- `client/src/library/folderFilter.ts` (modified: `{ kind: "trash" }` lens)
- `client/src/library/folderFilter.test.ts` (modified)
- `client/src/library/FolderPanel/FolderPanel.tsx` (modified: real Trash button; Task 13 fix request: `trashCount`/`onRequestEmptyTrash` props + hover-reveal Empty Trash icon on the Trash entry)
- `client/src/library/FolderPanel/FolderPanel.test.tsx` (modified; Task 13: Empty Trash reveal/callback tests)
- `client/src/library/FolderPanel/FolderPanel.css` (Task 13 fix request: `.library-folder-panel__trash-row`/`__trash-action` hover-reveal styles)
- `client/src/library/LibraryPage.tsx` (modified: toolbar Delete, purge confirm, lens copy; Task 13 fix request: toolbar Restore/Purge over the selection replacing the per-row design, icons on Delete/Restore/Purge, `purgeTargets: CollectionRow[]` generalized from a single target, Empty Trash wiring)
- `client/src/library/LibraryPage.test.tsx` (modified; Task 13: Trash describe block rewritten for the toolbar flow + bulk-purge + Empty-Trash tests)
- `client/src/library/useCollection.ts` (modified: restored-from-Trash toast on re-upload)
- `client/src/library/CollectionTable/CollectionTable.tsx` (modified: trash-lens callback threading; Task 13 fix request: two per-row callbacks collapsed into one `trashLens` boolean)
- `client/src/library/CollectionTable/CollectionTable.css` (modified: trash-action button styles; Task 13 fix request: removed, dead after the per-row overlay was dropped)
- `client/src/library/CollectionTable/CollectionTable.test.tsx` (modified: trash-lens drag-disabled regression, code-review fix; Task 13: updated for `trashLens`, added Open-hidden-in-Trash-lens test)
- `client/src/library/CollectionTable/PaperRow.tsx` (modified: Restore/Purge in place of Open; drag disabled in Trash lens, code-review fix; Task 13 fix request: reverted to a single Open button, gated by `trashLens` instead of `onRestore`/`onPurge`)

**Docs:**
- `docs/API.md` (modified: trash/restore/purge resource entries + changelog)

**Fixtures (added ahead of this session, used by the Task 11 live smoke):**
- `fixtures/sample-pdfs/0616.pdf`, `1903.03295v2.pdf`, `1906.03821v1.pdf`, `1907.10211v1.pdf`, `DeepAnT_A_Deep_Learning_Approach_for_Unsupervised_Anomaly_Detection_in_Time_Series.pdf`, `Microsoft COCO: Common Objects in Context.pdf`

**Tracking (not code):**
- `.bmad/implementation-artifacts/sprint-status.yaml` (story status `ready-for-dev` → `in-progress` → `review`)

### Change Log

- 2026-07-07: Extracted `DocIdSet` base model, `MoveRequest(DocIdSet)` subclass (Task 1).
- 2026-07-07: Added `storage.trash_papers`/`restore_papers`/`purge_document` (crash-safe rmtree-then-prune order) (Task 2).
- 2026-07-07: `import_pdf`'s re-import branch restores a trashed paper via `upsert_paper_entry(restore=True)`; `apply_extraction`/`reconcile_library` unaffected (Task 3).
- 2026-07-07: Added `POST /api/library/trash`, `POST /api/library/restore`, `DELETE /api/docs/{doc_id}` routes; regenerated `openapi.json`/`schema.d.ts` (Task 4).
- 2026-07-07: Added client API functions (`trashPapers`/`restorePapers`/`purgeDoc`), the `{ kind: "trash" }` folder-filter lens, and converted the `FolderPanel` Trash placeholder into a real selectable button (Task 5).
- 2026-07-07: Added `useTrashPapers` (optimistic trash/restore/purge, mirrors `useMovePapers`) (Task 6).
- 2026-07-07: Wired `LibraryPage`'s toolbar Delete button, per-row Restore/Purge, the purge `ConfirmDialog`, and Trash-lens copy ("Trash", "Trash is empty.") (Task 7).
- 2026-07-07: `PaperRow`/`CollectionTable` render Restore+Purge instead of Open in the Trash lens (Task 8).
- 2026-07-07: `useCollection.handleResolved` fires the "restored from Trash" toast when a re-upload's prior row was trashed (Task 9).
- 2026-07-07: Added backend (`test_models`/`test_storage`/`test_library`/`test_docs`) and client (`folderFilter`/`useTrashPapers`/`LibraryPage`/`FolderPanel`) test coverage for every AC; grepped the diff for em-dash (Task 10).
- 2026-07-07: Live-smoked on own fresh servers (port 8010/5183, isolated data dir, real sample PDFs): batch delete, restore, purge (confirm + Esc + focus-return), re-upload-restores-trashed edge, and keyboard reachability all verified (Task 11).
- 2026-07-07: Bumped `server/pyproject.toml`/`server/uv.lock` version `0.5.4` → `0.5.5`; updated `docs/API.md` with the three new resource entries + changelog (Task 12).
- 2026-07-07: Cross-model Codex `bmad-code-review` (AE-6): fixed 1 Medium (Trash-lens rows stayed draggable onto folder drop targets, silently moving a trashed paper; out of scope per this story). Verified and accepted 1 design candidate (the shared `useTrashPapers` seq-guard mirrors `useMovePapers`'s pre-existing identical behavior, per Dev Notes instruction). Client suite re-verified green (1171 tests), typecheck clean.
- 2026-07-07: Post-review fix requests (Task 13, user-directed): moved Restore/Purge from a per-row hover overlay to bulk toolbar buttons (icons added), added an icon to the normal-lens Delete button, and added a sidebar Empty Trash icon (hover-reveal on the Trash entry) that purges every trashed paper. Reverses the "batch/toolbar restore or purge" and "empty Trash all" out-of-scope lines from this story's original Scope Boundary and AC-2's "per-row" wording (both updated in place, with a superseded-note on Task 8). UI-only, no backend/contract change, no version bump. Client suite re-verified green: 1176 passed (61 files), typecheck clean.
