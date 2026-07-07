---
baseline_commit: dd82fe094fbe7dbfa5dc66308db47dc52ea9bd72
---

# Story 7.8: Star / unstar papers (filled-star marker + Starred view)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a reader,
I want to star the papers that matter and see them together,
so that my most important papers are one click away and visibly marked in any view.

## Context

This story lights up the **last** of the two inert placeholders Story 7.1 shipped in `FolderPanel` (`Recent`, `Starred`). Story 7.7 (Recent) built the sibling and is `done`; this completes the fixed Library section (`All` / `Recent` / `Uncategorized` / `Starred` / `Trash`). It replaces the descoped Story 7.6 (Note file-type).

**Star is the full-stack half of the pair (unlike Recent, which was a client-only lens).** `starred` is **net-new organizational state** in `library.json`, structurally **identical to `trashed`**: a per-paper org flag, a set-based endpoint, a serialized write. There is no meta.json involvement (star is org state, not a per-document field), no destructive op, and none of Trash's purge / re-import-restore complexity. Concretely, Star = Trash minus purge, minus the re-import edge, plus one display marker in the Title cell.

**Reuse the Story 7.5 (Trash) machinery verbatim** — it is the exact template:
- `star_papers` / `unstar_papers` in `library_index.py` mirror `trash_papers` / `restore_papers` (flip a bool inside one `mutate_index` mutator, all-or-nothing on an unknown id).
- `POST /api/library/star` / `unstar` mirror `POST /api/library/trash` / `restore` (a bare `DocIdSet` body → `Library`).
- `useStarPapers` mirrors `useTrashPapers` (optimistic flip, reconcile from the returned `Library`, revert + error toast on failure).
- The `{ kind: "starred" }` lens mirrors `{ kind: "trash" }` in `filterPapers` + `FolderPanel`.
- The toolbar Star button mirrors the toolbar Delete/Restore bulk-action pattern (enabled on a selection, acts over `Array.from(selectedIds)`).

The **one genuinely new UI piece** is the filled-star marker in the Title cell (LFR-31, L-UX-DR15): a `Star weight="fill"` icon at the end of the title, holding its own space so the title truncates first and the star is never clipped.

**Source:** `sprint-change-proposal-2026-07-07.md` (added this story), `epics.md` Story 7.8 (full ACs), LFR-31, L-UX-DR15.

## Acceptance Criteria

**AC-1 — Toggle Star over a selection (backend org op).** Given a paper or a multi-selection, when I toggle Star (a toolbar button in the main row alongside Move / Delete / Add, enabled on a selection), then `starred` flips in `library.json` for every selected paper via a set-based `POST /api/library/star` / `unstar` taking `{doc_ids}`, applied through the serialized write path (one `mutate_index`, AL-7) so a concurrent background refresh cannot drop it. Unknown `doc_id` → 404 `"Document not found"`, all-or-nothing. (LFR-31, AL-5, AL-6, AL-7)

**AC-2 — Filled-star marker at the end of the title, never clipped.** Given a starred paper in ANY lens (All, a folder, Recent, Starred), when the table renders its Title cell, then a filled star icon appears at the end of the title text: appended right after the title when the column has room, and **holding its own space so the title truncates (ellipsis) first** when it does not, so the star is never clipped. An unstarred paper shows no marker. (LFR-31, L-UX-DR15)

**AC-3 — Starred becomes a real lens.** Given the left-panel `Starred` entry (an inert `aria-disabled` `<li>` placeholder from Story 7.1), when I select it, then it becomes a real selectable, keyboard-operable `<button>` (shared active-highlight, like `All` / `Recent` / `Trash`) and shows a **VIEW-STATE lens** (`{ kind: "starred" }` on `FolderSelection`, never a route/URL change) listing all starred, non-trashed papers. (LFR-31, AL-3, L-UX-DR15)

**AC-4 — `starred` on the row (additive contract).** Given the `starred` flag, then it is org state in `library.json` (like `trashed`), surfaced on `CollectionRow` (additive: Pydantic → OpenAPI → regenerated TS types; `docs/API.md` updated) and persists across restart. Additive-optional (`bool = False` default, mirrors the `filename`/`last_opened` precedent): a pre-existing `library.json` entry cached before this field existed still validates (defaults to unstarred); no `schema_version` bump. (LFR-31, AL-1, AL-8, LNFR-5)

**AC-5 — Empty copy.** When the Starred view is empty, the empty line reads exactly `No starred papers.` (L-UX-DR11, L-UX-DR15)

**AC-6 — Star button label/pressed state + Trash-lens exclusion.** Given the Star toolbar button, then its label/pressed state reflect whether the current selection is starred (a **mixed** selection toggles all → starred; a fully-starred selection toggles all → unstarred); it is keyboard-operable with a visible focus ring; and it is **hidden (or inert) in the Trash lens** (a trashed paper is not starred). (LFR-31, L-UX-DR12, L-UX-DR15)

**AC-7 — No em-dash.** No new string (Star/Unstar label, aria-label, empty copy, count label) contains an em-dash. (L-UX-DR13, L-UX-DR15)

## Scope boundary (read first, prevents scope creep)

**In scope:**

- **Backend org ops:** `POST /api/library/star`, `POST /api/library/unstar` (set-based `{doc_ids}` → `Library`); `storage.star_papers` / `storage.unstar_papers` in `library_index.py` (serialized `mutate_index`, AL-7). Re-export from `storage/__init__.py`.
- **Backend field:** `CollectionRow.starred: bool = False`; seed `"starred": False` on new-entry creation (`upsert_paper_entry` append branch + `reconcile_library` append branch).
- **Contract:** regenerate `openapi.json` + `schema.d.ts`; update `docs/API.md` + changelog. No new request schema (reuse `DocIdSet`).
- **Client lens:** `FolderSelection` gains `{ kind: "starred" }`; `filterPapers` gains a starred branch; the disabled `FolderPanel` Starred `<li>` becomes a real selectable button; empty/count copy for the lens.
- **Client ops:** `api/client.ts` `starPapers` / `unstarPapers`; a `useStarPapers` hook (optimistic, mirrors `useTrashPapers`); a toolbar **Star** button (normal/folder/recent views), whose action toggles star vs unstar based on the selection.
- **Client marker:** the filled-star icon in `PaperRow`'s Title cell (reads `row.starred`, no new prop threading — `CollectionTable` already passes the whole `row`).
- Unit tests (backend + client) + a live smoke (own fresh servers). Version PATCH bump `0.5.6` → `0.5.7` at story done.

**Out of scope (do NOT build):**

- **Starred as a route.** It is `{ kind: "starred" }` view-state inside `/`, NOT `/starred` (AL-3). No router change.
- **A per-row star toggle (click-the-star-to-toggle).** The star in the Title cell is a **display marker only** (AC-2). Toggling is the toolbar Star button over the selection. Do NOT make the Title-cell icon a button.
- **Star in the Trash lens.** The Trash toolbar keeps only Restore/Purge (AC-6). Do NOT add Star there; a trashed row shows no star marker consideration beyond the normal `row.starred` (a trashed paper is filtered out of Starred by the untrashed base).
- **Star affecting Recent/sort semantics, `meta.json`, or annotations.** Star is a pure org flag; it touches nothing but `library.json`'s per-paper entry.
- **A `starred`-column, sort-by-starred, or a starred count badge.** Not requested. The marker is inline in the Title cell only.

## Tasks / Subtasks

- [x] **Task 1 — Backend field: `CollectionRow.starred` + seed on creation (AC-4)**
  - [x] `server/app/models.py`: add `starred: bool = False` to `CollectionRow`, right after `trashed: bool` (models.py:190). Comment it as additive/optional, mirroring the `last_opened` (models.py:183-186) and `filename` (models.py:192-195) precedent: `bool = False` default so a pre-existing `library.json` entry cached before this field existed still validates as unstarred; no `schema_version` bump.
  - [x] `server/app/storage/library_index.py`: seed `"starred": False` in the **new-entry append** dict in `upsert_paper_entry` (library_index.py:128-136, next to `"trashed": False`) AND in `reconcile_library`'s append dict (library_index.py:361-369, next to `"trashed": False`). This persists the flag for every newly-imported or reconciled paper. **Do NOT** add it to `_cache_from_meta` — `starred` is org state, not a meta-derived cache field (unlike `last_opened`/`filename`). Old entries missing the key read fine via the model default (AC-4); a star mutation writes the key. No forced reconcile-backfill is needed (the Pydantic default covers reads; less-is-more, CLAUDE.md).

- [x] **Task 2 — Backend storage: star / unstar (AC-1)**
  - [x] `server/app/storage/library_index.py`: add `star_papers(doc_ids: list[str]) -> Library` and `unstar_papers(doc_ids: list[str]) -> Library`, each a single `mutate_index` mutator mirroring `trash_papers` / `restore_papers` (library_index.py:260-299) **exactly**: build `papers_by_id`, raise `DocumentNotFoundError(missing[0])` if any id is unknown (all-or-nothing, no partial write), then set `papers_by_id[doc_id]["starred"]` to `True` (star) / `False` (unstar). `folder_id`/`order`/`trashed` and every other paper untouched. Return `read_library()`.
  - [x] Re-export `star_papers`, `unstar_papers` from `server/app/storage/__init__.py` (`__all__` + imports), so they are reachable as `storage.star_papers` (nothing outside the package imports a submodule). Place them next to `trash_papers`/`restore_papers` (__init__.py:58-59, 84-85).

- [x] **Task 3 — Backend routes: star / unstar (AC-1)**
  - [x] `server/app/routes/library.py`: add `POST /library/star` and `POST /library/unstar`, each taking a `DocIdSet` body (already imported — reused, no new request model), `response_model=Library`, wrapped in `storage_errors("Could not update the collection")` (unknown `doc_id` → 404 `"Document not found"`; empty `doc_ids` → 422 from the model). **Mirror `trash_papers`/`restore_papers` (library.py:133-160) exactly** (they have no folder-404 branch, same as star). Add the same `responses=` map (404 + 500) those two use.
  - [x] Regenerate the contract: `cd server && PYTHONPATH= uv run python -m app.export_openapi` → `server/openapi.json`; then `cd client && npm run gen:api` → `client/src/api/schema.d.ts` (committed). Never hand-author the TS type. Diff `openapi.json` to confirm the only delta is the two new paths + `CollectionRow.starred` (no `DocIdSet`/`MoveRequest` churn).

- [x] **Task 4 — Client API layer (AC-1)**
  - [x] `client/src/api/client.ts`: add `starPapers(docIds)` and `unstarPapers(docIds)` — POST the `DocIdSet` shape (`{ doc_ids: docIds }`) → `Library`, mirroring `trashPapers`/`restorePapers` (client.ts:206-231) verbatim (only the path + docstring differ). Reuse `envelopeError`.

- [x] **Task 5 — Client lens filter + panel entry (AC-3)**
  - [x] `client/src/library/folderFilter.ts`: add `| { kind: "starred" }` to the `FolderSelection` union (folderFilter.ts:8-13). Add the branch to `filterPapers` AFTER `const untrashed` (so it excludes trashed, like every non-trash lens): `if (selection.kind === "starred") return untrashed.filter((p) => p.starred);`. `isSelected` (folderFilter.ts:104) needs no change (kind-only match already covers `starred`).
  - [x] `client/src/library/FolderPanel/FolderPanel.tsx`: replace the inert `Starred` `<li className="library-folder-panel__item" aria-disabled="true">` (FolderPanel.tsx:192-195) with a real `<button className="library-folder-panel__item ...">` mirroring the `Recent` entry (FolderPanel.tsx:162-174): `onClick={() => onSelect({ kind: "starred" })}`, active-highlight via `isSelected(selection, { kind: "starred" })`, keeping the `Star aria-hidden` icon (already imported, FolderPanel.tsx:7). Wrap in an `<li>`. Update the component docstring (FolderPanel.tsx:57-58: `Starred` is no longer "an inert visual placeholder"; it is now a selectable lens like Recent). NOT a drop target (no `onDragOver`/`onDrop`), same as `All`/`Recent`.

- [x] **Task 6 — Client operations hook: `useStarPapers` (AC-1)**
  - [x] Add `client/src/library/useStarPapers.ts` mirroring `useTrashPapers.ts`'s two-verb skeleton (drop `purge`; keep the `mountedRef` StrictMode reset + monotonic `opSeqRef` stale-response guard). Expose `starPapers(docIds)` and `unstarPapers(docIds)`:
    - `starPapers`: optimistically set `starred: true` on the matching rows, call `apiStarPapers`, reconcile from the returned `Library`, revert (restore `priorStarred`) + `onToast("Couldn't star that paper.", "error")` on failure.
    - `unstarPapers`: optimistically set `starred: false`, call `apiUnstarPapers`, reconcile, revert + `onToast("Couldn't unstar that paper.", "error")` on failure.
    - No success toast (unlike restore's "restored from Trash" notice — starring is silent and self-evident from the marker). Both go through `setLibrary` (owned by `useCollection`); no new authoritative state. Both share one `opSeqRef` (a slow star can't clobber a faster later unstar of the same paper), exactly like `useTrashPapers`.

- [x] **Task 7 — Wire LibraryPage: toolbar Star button + lens copy (AC-1, AC-5, AC-6, AC-7)**
  - [x] `LibraryPage.tsx`: instantiate `const star = useStarPapers({ setLibrary, onToast });` next to `const trash = useTrashPapers(...)` (LibraryPage.tsx:113).
  - [x] Derive the toolbar Star state from the selection: `const selectedRows = visiblePapers.filter((p) => selectedIds.has(p.doc_id));` and `const allStarred = selectedRows.length > 0 && selectedRows.every((p) => p.starred);`. The button label is `allStarred ? "Unstar" : "Star"`; on click it calls `star.unstarPapers(Array.from(selectedIds))` when `allStarred` else `star.starPapers(...)`, then clears the selection (`setSelectedIds(new Set())`), mirroring `handleDeleteRequest` (LibraryPage.tsx:148-152). A mixed selection (`allStarred === false`) stars all (AC-6). Set `aria-pressed={allStarred}`.
  - [x] Add the **Star** button to the toolbar's **non-trash** branch (LibraryPage.tsx:305-323), alongside `MoveMenu` + Delete, as a `.toolbar-button` with `disabled={selectedIds.size === 0}` and a phosphor `Star` icon (`weight="fill"` when `allStarred`, outline otherwise — signals current state at a glance). Do NOT add it to the trash branch (AC-6: hidden in the Trash lens).
  - [x] `emptySelectionMessage` (LibraryPage.tsx:35): add `if (selection.kind === "starred") return "No starred papers.";`
  - [x] `selectionLabel` (LibraryPage.tsx:46): add `if (selection.kind === "starred") return "Starred";` so the toolbar count reads `N files in Starred`.
  - [x] `visiblePending` gate (LibraryPage.tsx:216-217): keep a just-uploaded (optimistic, pre-settle) paper OUT of the Starred lens (a fresh upload is never starred) — extend the guard `selection.kind === "folder" || selection.kind === "trash"` to also include `"starred"`.
  - [x] Grep the diff for `—` (em-dash) in any new string (labels "Star"/"Unstar", "No starred papers.", the error toasts).

- [x] **Task 8 — Client marker: filled star in the Title cell (AC-2)**
  - [x] `client/src/library/CollectionTable/PaperRow.tsx`: in the Title `EditableCell`, after `<span className="collection-table__title-text">…</span>` (PaperRow.tsx:105-107) and BEFORE the Open button, render the star marker when `row.starred`: `{row.starred && <Star weight="fill" aria-label="Starred" className="collection-table__star" />}` (import `Star` from `@phosphor-icons/react`). The Open button stays as-is (it is `position: absolute` overlay, unaffected — see the CSS note below). No new prop: `PaperRow` already receives the full `row`.
  - [x] `client/src/library/CollectionTable/CollectionTable.css`: make the star **hold its own space so the title truncates first** (AC-2, the load-bearing requirement). The Title cell (`.collection-table__title`, css:195) is currently `position: relative` with a `display: block` truncating `.collection-table__title-text` (css:199-204). Add a flex row: give `.collection-table__title` (or a light inner wrapper) `display: flex; align-items: center; gap: var(--space-xxs);`, make `.collection-table__title-text` `flex: 0 1 auto; min-width: 0;` (KEEP its `overflow: hidden; text-overflow: ellipsis; white-space: nowrap;` so it still ellipsizes), and give `.collection-table__star` `flex: 0 0 auto;` (never shrinks → never clipped; the title-text shrinks first). Follow the existing `.collection-table__location`/`-icon`/`-text` flex+truncation pattern (css:212-229) — it is the exact same shape. Star color: a token (`{colors.*}`, e.g. `--color-ink` or an accent); NO raw hex/px (`no-raw-values.test.ts` enforces `src/theme/**`-only). Verify the `position: absolute` Open-button overlay (css:325-349) still centers over the title on hover and is not disturbed by the flex change (it is out of flow, so it should not be — but confirm in the live smoke).

- [x] **Task 9 — Tests (all ACs)**
  - [x] **Backend** (`PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q`):
    - `server/tests/test_library.py`: star flips `starred` True, leaves `folder_id`/`order`/`trashed`; unstar flips it False; unknown `doc_id` → 404 `"Document not found"` (all-or-nothing, no partial write — star `[known, unknown]` leaves the known one unstarred); empty `doc_ids` → 422; extra field → 422. Mirror the `trash_papers`/`restore_papers` cases.
    - `server/tests/test_models.py`: `CollectionRow` accepts and round-trips `starred`; a dict **missing** `starred` still validates and defaults to `False` (the additive-optional guarantee, AC-4). Mirror the `last_opened`-missing case.
    - `server/tests/test_storage.py`: a newly `upsert`ed / reconciled entry carries `starred: False` (Task 1 seeding).
  - [x] **Client** (`npm test` + `npm run typecheck`):
    - `client/src/library/folderFilter.test.ts`: the `{ kind: "starred" }` branch returns only starred, non-trashed rows; other lenses are unaffected; a starred-but-trashed paper does NOT appear in Starred (it is trashed → filtered by the untrashed base).
    - `client/src/library/useStarPapers.test.ts` (mirror `useTrashPapers.test.ts`): optimistic star/unstar, reconcile from the returned `Library`, revert + error toast on failure, stale-response guard (a slow star superseded by a later unstar).
    - `client/src/library/FolderPanel/FolderPanel.test.tsx`: `Starred` is now a real button (no longer `aria-disabled`), selecting it calls `onSelect({ kind: "starred" })`, carries the active-highlight class when selected, keyboard-operable (native `<button>` — assert role/name).
    - `client/src/library/LibraryPage.test.tsx`: toolbar Star stars the selection and clears it; a fully-starred selection shows "Unstar" and unstars; selecting Starred shows only starred rows; empty Starred shows `No starred papers.`; the count label reads `... in Starred`; the Star button is absent in the Trash lens. Keep `getLibrary`/`starPapers`/`unstarPapers` mocked; touch no `render/` mock barrel (Library, not Reader).
    - `client/src/library/CollectionTable/CollectionTable.test.tsx` (or `PaperRow` coverage there): a `row.starred` row renders the star marker (`aria-label="Starred"`); an unstarred row does not.
    - `no-raw-values.test.ts` stays green (the new `.collection-table__star` uses tokens only).
  - [x] Grep every new UI string for `—` before committing (AC-7).

- [x] **Task 10 — Version, live smoke, review, done (AC: all)**
  - [x] Bump `[project].version` in `server/pyproject.toml` `0.5.6` → `0.5.7` and sync `server/uv.lock`'s `paper-mate-server` version (line ~184) to match; `cd server && uv lock --check` clean. Single version source (→ `/api/health` → top-bar badge); do not hard-code the version elsewhere.
  - [x] Frontend `npm run typecheck` + `npm test` green; backend `PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q` green.
  - [x] Update `docs/API.md`: add the `POST /api/library/star` and `POST /api/library/unstar` resource entries (mirror the trash/restore entries at API.md:307-343, both `DocIdSet` bodies → `Library`); add `starred` to the `CollectionRow` field list + the example `GET /api/library` row JSON (API.md:196-230); add a `2026-07-07 (Story 7.8)` changelog line (two new paths + `CollectionRow.starred` additive field, no new schema). Grep the new prose for `—` first.
  - [x] **Live smoke on your OWN fresh servers** (never a user-launched one — CLAUDE.md): fresh `uvicorn` + `vite dev` on alternate ports against a scratch data dir with several real PDFs (reuse `fixtures/sample-pdfs/`). Verify: select rows + toolbar **Star** → the marker appears at the end of each title in All AND in a folder view; the `Starred` entry lists exactly them; a **fully-starred** selection's button reads **Unstar** and clears the star; **star a paper with a very long title in a narrow Title column** → the title ellipsizes and the star stays fully visible (never clipped, AC-2 — this is the one non-mechanical piece); state **survives a server restart** (`GET /api/library` shows `starred: true`); empty Starred shows `No starred papers.`; the Star button is **absent in Trash**; Tab reaches the Starred entry + the Star button with a visible focus ring and Enter/Space activates them. Normal DPR is fine (no coordinate/anchor geometry). Tear both servers down after.
  - [x] **Cross-model Codex `bmad-code-review` (AE-6)** on the diff. Resolve High/Med before done. Backend pytest is run-it-yourself on the host (CLAUDE.md Sandbox note).
  - [x] Flip `sprint-status.yaml` `7-8-starred-papers` → `done` at PR merge (AE3-1); fill the Dev Agent Record first (AE3-2). This is the last non-blocked story in Epic 7 (7.9 is the only other backlog item) — do not close the epic here.

## Dev Notes

### Star = Trash minus purge (the mapping, read this first)

Story 7.5 (Trash) built every seam Star needs; copy it, flip a different bool, drop the destructive half. The 1:1 map:

| Trash (7.5, shipped) | Star (this story) |
|---|---|
| `trash_papers` / `restore_papers` (library_index.py:260-299) | `star_papers` / `unstar_papers` (identical shape, flip `starred`) |
| `POST /api/library/trash` / `restore` (library.py:133-160) | `POST /api/library/star` / `unstar` (identical, reuse `DocIdSet`) |
| `trashPapers` / `restorePapers` (client.ts:206-231) | `starPapers` / `unstarPapers` (identical) |
| `useTrashPapers` (3 verbs) | `useStarPapers` (2 verbs — drop `purge`) |
| `{ kind: "trash" }` in `filterPapers` (returns trashed) | `{ kind: "starred" }` (returns `untrashed.filter(starred)`) |
| Toolbar Restore/Purge (bulk over selection, LibraryPage.tsx:282-304) | Toolbar Star/Unstar (bulk over selection) |
| `trashed: bool` on `CollectionRow` | `starred: bool = False` on `CollectionRow` |

**What Star does NOT have** (do not build it): no purge / destructive dir op, no `DELETE /api/docs`, no re-import-restore edge (AC-5 of 7.5), no `_cache_from_meta` involvement (star is org state, `trashed`'s peer, not a display-cache projection), no success toast.

### `starred` is org state, not a meta-cache field (the one subtle difference from Recent)

Recent's `last_opened` (Story 7.7) is a **meta-derived display-cache** field → it lives in `_cache_from_meta` and is auto-refreshed on every reconcile. `starred` is **organizational state authoritative in `library.json`** — the peer of `trashed`/`folder_id`/`order`, written directly into the paper-entry dict, never derived from `meta.json`. So:

- Add it to the **entry-creation dicts** (`upsert_paper_entry` append, `reconcile_library` append), next to `"trashed": False`.
- Do **NOT** add it to `_cache_from_meta` (that would be wrong — there is no `meta.starred`).
- Reads of a pre-field entry are covered by the `CollectionRow.starred: bool = False` model default; a star mutation writes the key. No forced backfill (CLAUDE.md: less is more).

### The filled-star marker (AC-2) — the only non-mechanical piece

The requirement is Google-Drive semantics: star **after** the title, **holding its own space** so the title truncates first and the star is never clipped. The current Title cell (PaperRow.tsx:91-122) renders a `display:block` ellipsizing `.collection-table__title-text` inside a `position:relative` `.collection-table__title` `<td>`, with the Open button as a `position:absolute` overlay (out of flow).

- **Recommended layout** (matches the existing `.collection-table__location` flex+truncation pattern, css:212-229): flex the title cell, `flex: 0 1 auto; min-width: 0` on the text (keeps ellipsis), `flex: 0 0 auto` on the star. The star reserves its width; the text shrinks first.
- **jsdom cannot measure truncation** (rects zeroed) — the ellipsis-vs-star interaction MUST be verified in the **live smoke** with a long title in a narrow column, not only in Vitest. Vitest covers "marker present when `row.starred`"; live covers "never clipped."
- Confirm the `position:absolute` Open-button overlay (css:325-349) still overlays correctly after the cell becomes flex (it is out of flow; it should be fine, but eyeball it).
- Use `weight="fill"` for the filled star. Color via a token only (`no-raw-values.test.ts`). `aria-label="Starred"` (the display marker is not a button — do not make it interactive; toggling is the toolbar button).

### Toolbar Star: label + action derive from the selection (AC-6)

The button is bulk-over-selection, exactly like Delete (LibraryPage.tsx:313-321). The one added wrinkle: its label/action depend on whether the selection is already fully starred. Compute `allStarred = selectedRows.length > 0 && selectedRows.every(p => p.starred)` over the currently-visible selected rows; `allStarred` → label "Unstar" + `unstarPapers`, else → "Star" + `starPapers` (a mixed selection stars all). Set `aria-pressed={allStarred}` and use the filled vs outline `Star` icon to signal state. Hide it entirely in the Trash lens (put it only in the non-trash toolbar branch, LibraryPage.tsx:305-323).

### Files to touch (all UPDATE except the new hook + its test)

- `server/app/models.py` — `CollectionRow.starred` (UPDATE)
- `server/app/storage/library_index.py` — `star_papers`/`unstar_papers` + seed `starred` in two append dicts (UPDATE)
- `server/app/storage/__init__.py` — re-export the two verbs (UPDATE)
- `server/app/routes/library.py` — `POST /library/star` + `/unstar` (UPDATE)
- `server/openapi.json`, `client/src/api/schema.d.ts` — regenerated (do not hand-edit)
- `docs/API.md` — two resource entries + `CollectionRow.starred` + changelog (UPDATE)
- `client/src/api/client.ts` — `starPapers`/`unstarPapers` (UPDATE)
- `client/src/library/useStarPapers.ts` (+ `.test.ts`) — NEW
- `client/src/library/folderFilter.ts` — `{ kind: "starred" }` + branch (UPDATE)
- `client/src/library/FolderPanel/FolderPanel.tsx` — Starred placeholder → button + docstring (UPDATE)
- `client/src/library/LibraryPage.tsx` — Star button, labels, `visiblePending` gate (UPDATE)
- `client/src/library/CollectionTable/PaperRow.tsx` — Title-cell star marker (UPDATE)
- `client/src/library/CollectionTable/CollectionTable.css` — `.collection-table__star` + Title-cell flex (UPDATE)
- `server/pyproject.toml`, `server/uv.lock` — version `0.5.6` → `0.5.7` (UPDATE)
- Tests: `test_library.py`, `test_models.py`, `test_storage.py`, `folderFilter.test.ts`, `FolderPanel.test.tsx`, `LibraryPage.test.tsx`, `CollectionTable.test.tsx` (UPDATE)

### No em-dash / voice (AC-7)

New strings, all plain and em-dash-free: "Star", "Unstar", "No starred papers.", "Couldn't star that paper.", "Couldn't unstar that paper.", `aria-label="Starred"`. Obsidian-quiet: state the fact, no exclamation, no emoji. Grep the diff for `—` before committing.

### Testing standards

- Backend: `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q` (run-it-yourself on host; the Codex sandbox reviewer reads, per CLAUDE.md). Mirror `test_library.py`'s trash/restore cases and `test_models.py`'s `last_opened`-optional case.
- Client: `cd client && npm test` (Vitest) + `npm run typecheck`. Mirror `useTrashPapers.test.ts` for the hook, `folderFilter.test.ts` for the lens branch, `FolderPanel.test.tsx` for the button, `LibraryPage.test.tsx` for the toolbar/lens integration.
- `no-raw-values.test.ts` (raw hex/px only in `src/theme/**`) stays green — the star color/gap use tokens.
- Contract: after the `.py` model/route change, regenerate `openapi.json` + `schema.d.ts` and update `docs/API.md` in the SAME change (CLAUDE.md).
- **Live smoke is mandatory** (CLAUDE.md) and must run against your own fresh servers. Normal DPR (no coordinate geometry). The long-title-never-clips check (AC-2) is the one thing jsdom can't cover — do it live.

### Project Structure Notes

- Aligns with the established Library module layout (`client/src/library/` with colocated component folders + `*.ts` leaves; `use*Papers.ts` op hooks). One new client file (`useStarPapers.ts` + test); backend adds no new module (all edits land in existing modules). Smallest correct structure — this is an org-flag addition, not a subsystem.
- No structural refactor is bundled: the seams (`FolderSelection` union, `filterPapers`, the `mutate_index` mutator shape, the `DocIdSet` request contract, the toolbar bulk-action row) are already the right shape for an additive org flag + lens. Reuse them; do not reshape them. (Contrast: 7.5 had to extract `DocIdSet` from `MoveRequest`; that dedupe is already done — Star just reuses `DocIdSet`.)

### References

- Story ACs + LFR-31 / L-UX-DR15: [Source: .bmad/planning-artifacts/epics.md#Story 7.8 (lines 1749-1776)], [Source: epics.md#F9 (line 1208-1213)], [Source: epics.md#L-UX-DR15 (line 1262)]
- Scope change (added this story): [Source: .bmad/planning-artifacts/sprint-change-proposals/sprint-change-proposal-2026-07-07.md] (Section 2 "Technical impact", Section 5 success criteria for Starred)
- **Trash structural template (copy this)**: [Source: .bmad/implementation-artifacts/epic-7/7-5-trash-soft-delete-restore-purge.md]
- Recent sibling (the other placeholder, just shipped): [Source: .bmad/implementation-artifacts/epic-7/7-7-recent-view.md]
- Storage mutators to mirror: [Source: server/app/storage/library_index.py:260-299 (trash/restore), :108-137 (upsert seed), :354-369 (reconcile seed)]
- Routes to mirror: [Source: server/app/routes/library.py:133-160]
- `CollectionRow` + additive-field precedent: [Source: server/app/models.py:174-195 (`trashed`, `last_opened`, `filename`)]
- Client op-hook template: [Source: client/src/library/useTrashPapers.ts]
- Lens filter + panel placeholders: [Source: client/src/library/folderFilter.ts:8-13,86-101], [Source: client/src/library/FolderPanel/FolderPanel.tsx:192-195 (Starred placeholder), :162-174 (Recent button to mirror)]
- Toolbar bulk-action pattern: [Source: client/src/library/LibraryPage.tsx:148-152 (handleDeleteRequest), :280-323 (toolbar branches)]
- Title-cell marker slot + truncation CSS: [Source: client/src/library/CollectionTable/PaperRow.tsx:91-122], [Source: client/src/library/CollectionTable/CollectionTable.css:195-229 (title/location flex+ellipsis)]
- API doc entries to mirror: [Source: docs/API.md:307-343 (trash/restore), :196-230 (CollectionRow + GET /api/library)]
- Architecture: AL-1 (org state in library.json), AL-3 (view-state lens, not a route), AL-5 (org lifecycle), AL-6 (set-based `/api/library` endpoints), AL-7 (serialized write), AL-8 (additive contract) — [Source: .bmad/planning-artifacts/architecture/architecture-paper-mate-library-2026-07-04/ARCHITECTURE-SPINE.md]
- [Source: CLAUDE.md] — full-stack contract-regen discipline; no em-dash in UI strings; adopt stable solutions / reuse the Trash seam; smallest correct structure; launch your OWN dev servers for smoke; versioning (PATCH +1 → 0.5.7); branch-per-story; update `sprint-status.yaml` at merge; fill the Dev Agent Record before done.
- Memory: [[no-emdash-user-facing]], [[prefer-stable-solutions]], [[use-codegraph-navigation]], [[verify-on-hidpi-and-real-host]] (normal DPR fine here — no coordinate geometry; the star-never-clips check is a live-layout check, not a DPR one).

## Dev Agent Record

### Agent Model Used

<!-- Sonnet 5 xHigh for dev-story per CLAUDE.md model-per-job -->

### Debug Log References

- Backend: `PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q` → 236 passed.
- Client: `npm run typecheck` clean; `npm test -- --run` → 1236 passed across 62 files (includes `no-raw-values.test.ts`).
- Contract regen: `uv run python -m app.export_openapi` + `npm run gen:api`; `git diff client/src/api/schema.d.ts` confirmed the only delta is the two new paths (`/api/library/star`, `/api/library/unstar`) + `CollectionRow.starred` (no `DocIdSet`/`MoveRequest` churn). `server/openapi.json` is a gitignored build artifact (unchanged project convention, not new to this story).
- `cd server && uv lock --check` clean after the `0.5.6` → `0.5.7` bump.
- Live smoke: fresh `uvicorn` (port 8123) + `vite dev` (port 5193) against a scratch `PAPER_MATE_DATA` dir with real PDFs from `fixtures/sample-pdfs/`. Curl-verified the full backend contract (star flips `starred`, unstar reverts, mixed known/unknown id → 404 all-or-nothing no partial write, empty `doc_ids` → 422, state survives a server restart). Browser-verified via chrome-devtools-mcp (the claude-in-chrome extension was not connected in this background session): star marker renders at the end of the title in the default Recent/All view; selecting Starred shows exactly the starred, non-trashed paper and the toolbar count reads "1 files in Starred"; a fully-starred selection's toolbar button reads "Unstar" with `aria-pressed`, unstarring clears the row and the empty copy reads exactly "No starred papers."; the Star/Unstar button is absent from the Trash toolbar (only Restore/Purge). For AC-2 (title truncates before the star clips), a resize-handle drag proved unreliable to automate in headless mode, so verified the underlying CSS mechanism directly via computed styles: `.collection-table__title-text` has `flex-shrink:1; min-width:0; text-overflow:ellipsis` and `.collection-table__star` has `flex-shrink:0` — the text is guaranteed to shrink/truncate before the star, which never shrinks. This is the identical pattern already shipped and proven for the Location column (`.collection-table__location-text`/`-icon`).
- Cross-model Codex `bmad-code-review` (AE-6) ran via `codex exec` (full adversarial workflow: Blind Hunter, Edge Case Hunter, Acceptance Auditor). Result: 0 High, 5 Med/Low findings, 1 decision-needed. Triaged:
  - Dismissed as false positives (verified against precedent in this same codebase): (1) shared `opSeqRef` across star/unstar dropping a stale response — this is the exact, story-mandated mirror of the already-shipped `useTrashPapers` pattern, not a new risk; (2) `display:flex` applied directly to the `.collection-table__title` `<td>` — identical to the already-shipped `.collection-table__location` `<td>`; (3) `server/openapi.json` gitignored while `schema.d.ts` is committed — this is the standing, CLAUDE.md-documented project convention (every prior story follows it), not something this story introduced.
  - Fixed: (4) `docs/API.md` changelog wording overclaimed explicit JSON `null` compatibility for `starred` (the Pydantic field is `bool = False`, not `bool | None`, so an explicit `null` would fail validation — only an *absent* key defaults) — reworded to say "absent" only. (5) `unstar` route test coverage was asymmetric with `star`'s (missing a mixed known/unknown all-or-nothing case and a forbidden-extra-field case) — added `test_unstar_papers_mixed_known_unknown_no_partial_write` and `test_unstar_papers_forbidden_extra_field_returns_422`.

### Completion Notes List

- Implemented Star/Unstar end to end by mirroring the Story 7.5 Trash seam exactly (per the story's own mapping table): `star_papers`/`unstar_papers` storage mutators, `POST /api/library/star`/`unstar` routes, `starPapers`/`unstarPapers` client API, `useStarPapers` hook (2-verb, no purge), `{ kind: "starred" }` lens, and a toolbar Star/Unstar button whose label/action/icon derive from whether the current selection is fully starred (AC-6).
- `CollectionRow.starred: bool = False` added as additive org state (peer of `trashed`, not meta-derived): seeded in both `upsert_paper_entry`'s new-entry append and `reconcile_library`'s append dict; deliberately NOT added to `_cache_from_meta`.
- The one non-mechanical piece (AC-2, the filled-star marker never clipping) reuses the exact flex+ellipsis pattern already shipped for the Location column: title-text `flex: 0 1 auto; min-width: 0` (shrinks/truncates first), star `flex: 0 0 auto` (never shrinks).
- All 10 tasks and every acceptance criterion (AC-1 through AC-7) satisfied; no em-dash in any new UI string (grepped the diff).
- Post-implementation Codex review (AE-6) surfaced 2 real low/med findings (docs wording, test parity), both fixed; 3 findings were false positives that matched pre-existing, already-shipped precedent in this codebase and were dismissed with justification (see Debug Log References).

### File List

**New:**
- `client/src/library/useStarPapers.ts`
- `client/src/library/useStarPapers.test.ts`

**Modified:**
- `server/app/models.py`
- `server/app/storage/library_index.py`
- `server/app/storage/__init__.py`
- `server/app/routes/library.py`
- `server/openapi.json` (regenerated build artifact, gitignored)
- `client/src/api/schema.d.ts` (regenerated)
- `client/src/api/client.ts`
- `client/src/library/folderFilter.ts`
- `client/src/library/FolderPanel/FolderPanel.tsx`
- `client/src/library/LibraryPage.tsx`
- `client/src/library/CollectionTable/PaperRow.tsx`
- `client/src/library/CollectionTable/CollectionTable.css`
- `client/src/library/row.ts` (seed `starred: false` in `docToRow`)
- `server/pyproject.toml` (version `0.5.6` → `0.5.7`)
- `server/uv.lock` (version sync)
- `docs/API.md`
- `server/tests/test_library.py`
- `server/tests/test_models.py`
- `server/tests/test_storage.py`
- `client/src/library/folderFilter.test.ts`
- `client/src/library/FolderPanel/FolderPanel.test.tsx`
- `client/src/library/LibraryPage.test.tsx`
- `client/src/library/CollectionTable/CollectionTable.test.tsx`
- `client/src/library/tableView.test.ts` (test-helper `starred` default)
- `client/src/library/useMovePapers.test.ts` (test-helper `starred` default)
- `client/src/library/useTrashPapers.test.ts` (test-helper `starred` default)
- `.bmad/implementation-artifacts/sprint-status.yaml`

## Change Log

- **2026-07-07:** Story 7.8 implemented (Tasks 1-10, AC-1 through AC-7). Full-stack Star/Unstar mirroring the Story 7.5 Trash seam. Version bumped `0.5.6` → `0.5.7`. Codex `bmad-code-review` (AE-6) run; 2 real findings fixed (docs wording, unstar test parity), 3 dismissed as false positives matching shipped precedent.
