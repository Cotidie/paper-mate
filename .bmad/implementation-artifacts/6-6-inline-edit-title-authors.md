---
baseline_commit: 2a39b6ba63be1d0866256f94744d69eacc42de28
---

# Story 6.6: Inline edit Title and Authors

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a reader,
I want to fix a wrong Title or Authors right in the table,
so that I can correct extraction without leaving the Library.

## Acceptance Criteria

1. **Given** a Title or Authors cell, **when** I click it (or focus it and press Enter), **then** it becomes an inline `{component.text-input}` seeded with the cell's current text; Enter or blur commits, Esc cancels. (LFR-11, L-UX-DR7)
2. **Given** a committed edit, **then** it persists via `PATCH /api/docs/{id}` authoritative on `meta.json`, and storage refreshes the `library.json` display cache so the table reflects the new value. (AL-6, AL-1)
3. **Given** a `parse-failed` or `enrich-skipped` row, **then** its Title/Authors are editable the same way, correcting a bad parse. (LFR-10, LFR-11)
4. **Given** the inline editor, **when** focused, **then** it shows a 2px `{colors.ink}` focus treatment and is keyboard-operable. (L-UX-DR12)

### Derived acceptance criteria (system-correctness, own these too)

5. **Given** a committed edit, **then** the row updates optimistically at once; on a `PATCH` failure the cell reverts to its prior value and a non-blocking error notice is shown (the same `Toast variant="error"` used for upload failures). No other row is touched.
6. **Given** a committed value equal to the current stored value (after trimming), **then** no `PATCH` is sent (no-op guard).
7. **Given** an emptied cell (blank or whitespace-only committed), **then** the field is cleared to `null`: Title falls back to the filename (existing 6.3 fallback), Authors renders empty. The server normalizes trim/empty → `null`.
8. **Given** an `extracting` row (background job unsettled) or an optimistic `pending` row (no `doc_id` yet), **then** its cells are NOT editable — editing is offered only for settled rows (`ready` / `enrich-skipped` / `parse-failed`). This removes the edit-vs-`apply_extraction` write race.
9. **Given** `PATCH /api/docs/{id}`, **then** it is a partial update: only the fields present in the body change; unknown `doc_id` → 404 `{ "detail" }`, an empty body → 400 `{ "detail" }`, a malformed/forbidden field → 422 `{ "detail" }`, a storage failure → 500 `{ "detail" }` (AR-11 single envelope). Editing does NOT change `status`, `page_count`, `added`, or `last_opened`.

## Tasks / Subtasks

- [x] **Task 1 — Backend contract: `DocPatch` model + `PATCH /api/docs/{doc_id}`** (AC: 2, 7, 9)
  - [x] Add `DocPatch(BaseModel)` to `server/app/models.py`: `title: str | None = None`, `authors: str | None = None`, `model_config = ConfigDict(extra="forbid")` (a typo'd/forbidden field → 422, not a silent no-op). It is a request-only model surfaced into OpenAPI by the new route.
  - [x] Add `patch_doc(doc_id, patch: DocPatch)` to `server/app/routes/docs.py`, `@router.patch("/docs/{doc_id}", response_model=Doc, ...)` with documented 400/404/500 `ErrorEnvelope` responses (mirror `get_doc`). Body handling: `updates = patch.model_dump(exclude_unset=True)` (true PATCH semantics — only fields the client actually sent). Empty `updates` → `HTTPException(400, "No fields to update")`. Normalize each present string field: `.strip()`, and empty → `None`. Map `DocumentNotFoundError` → 404 `"Document not found"`, other `StorageError` → 500 `"Could not update document"`. Return `Doc(doc_id=doc_id, **meta.model_dump())`.
- [x] **Task 2 — Storage writer: `update_doc_meta` (reuse the `apply_extraction` core)** (AC: 2, 8, 9)
  - [x] Extract the shared re-read → TOCTOU-guard → `create_parents=False` write → cache-refresh sequence out of `apply_extraction` into one private helper `_update_meta_and_reindex(doc_id, updates: dict) -> DocMeta` (do NOT duplicate the pattern — CLAUDE.md: refactor structure in the same change).
  - [x] `update_doc_meta(doc_id, updates: dict[str, str | None]) -> DocMeta`: keys ⊆ `{"title", "authors"}` (already normalized by the route); delegates to the shared helper. Raises `DocumentNotFoundError` for an unresolvable id or missing `meta.json`, and never resurrects a dir purged mid-write (`create_parents=False` + `doc_dir.is_dir()` re-check, exactly as `apply_extraction`).
  - [x] `apply_extraction` becomes a thin caller of the same helper (passes `{title, authors, status}`); its behavior and tests stay green.
- [x] **Task 3 — Regenerate the contract + client api method** (AC: 2)
  - [x] `cd server && PYTHONPATH= uv run python -m app.export_openapi` then `cd client && npm run gen:api`. Commit the regenerated `server/openapi.json` + `client/src/api/schema.d.ts` (this IS a shape change: new `DocPatch` schema + new PATCH path — unlike 6.5's zero-diff).
  - [x] Add `patchDoc(docId, patch)` to `client/src/api/client.ts` (the single owner of backend routes, AD-9): `PATCH` with a JSON body, `Content-Type: application/json`, `envelopeError` on `!res.ok`, returns the `Doc`. Type the `patch` param from the generated `components["schemas"]["DocPatch"]` (export a `DocPatch` alias) — never hand-author it.
- [x] **Task 4 — `CollectionTable`: inline-editable Title/Authors cells** (AC: 1, 3, 4, 5, 6, 8)
  - [x] Add a required `onEditField: (docId: string, field: "title" | "authors", value: string | null) => void` to the loaded (`loading?: false`) props variant. The table reports the gesture; `LibraryPage` owns the fetch (same split as `onOpenRow`). Update every existing test render call-site to pass it.
  - [x] Decompose (OOP, CLAUDE.md): a small `EditableCell` (renders the static ellipsis cell OR, when this `{docId, field}` is the one being edited, an `InlineEditor`) and an `InlineEditor` (the `<input>`, owns its draft). Keep the "which cell is editing" as local `CollectionTable` state (`editing: { docId: string; field: "title" | "authors" } | null`), sibling to the existing `selectedId`.
  - [x] Editable ONLY when `status !== "extracting"` (settled rows) and never for pending rows. Cell is focusable (`tabIndex=0`); click OR `Enter` on the cell enters edit; both call `stopPropagation()` so the row's select/open handler (6.3) does NOT fire from an edit gesture.
  - [x] Seed the editor with the displayed text: Title = `row.title ?? (row.filename ? stripPdfExtension(row.filename) : "")` (never the literal `Untitled` placeholder); Authors = `row.authors ?? ""`. Autofocus + select-all on entering edit.
  - [x] Commit/cancel: Enter → commit; blur → commit; Esc → cancel (no commit). Guard the Esc-then-blur / Enter-then-blur double-fire with a `committedRef` so the unmount blur does not re-commit (classic inline-edit gotcha). On commit, compute `trimmed = value.trim()`; if `trimmed === (current field, normalized)` → no-op (do not call `onEditField`); else call `onEditField(docId, field, trimmed || null)`. Clicks inside the input `stopPropagation()`.
- [x] **Task 5 — `CollectionTable.css`: inline-editor styling (tokens only)** (AC: 4)
  - [x] Style `.collection-table__edit-input` from the DESIGN.md `text-input` family but sized to the dense cell: `background var(--color-surface-card)`, `color var(--color-ink)`, cell typography (`--font-sans`, `--type-body-sm-*`), `1px solid var(--color-hairline-strong)`, `var(--radius-sm)`, `width: 100%`, `box-sizing: border-box`, and `user-select: text` (the row sets `user-select: none`). Focus: a 2px ink treatment — `outline: var(--focus-ring-width) solid var(--color-ink)` (or an inset box-shadow), matching the row's armed treatment. This file is NOT under `src/theme/**`, so **only `var(--…)` tokens are allowed** (`no-raw-values.test.ts`); if a literal dim is truly needed, add a `--collection-table-edit-*` var to `client/src/theme/components.css` (the exempt layer) and reference it.
- [x] **Task 6 — `LibraryPage`: own the PATCH + optimistic update/revert** (AC: 2, 5)
  - [x] Add `handleEditField(docId, field, value)` (`useCallback`): capture the row's prior `field` value; optimistically `setLibrary(prev => map the one row's field)`; call `patchDoc(docId, { [field]: value })`; on success reconcile that row from the returned `Doc` (authoritative); on failure restore the prior value and `setToast({ variant: "error", message: "Couldn't save that change." })`. Use a functional `setLibrary` update keyed by `doc_id` (safe alongside `fetchSeqRef`; the settle-poll is idle for settled rows).
  - [x] Pass `onEditField={handleEditField}` into the loaded `<CollectionTable>` render.
- [x] **Task 7 — Tests** (AC: all)
  - [x] **Backend** `server/tests/test_docs.py`: PATCH updates title (200 → `Doc` with new title; `read_meta` + `read_library` cache both reflect it); PATCH authors-only leaves title untouched (partial semantics); PATCH `title: ""`/whitespace → stored `None` (Title falls back to filename); PATCH unknown doc → 404 `{detail}`; PATCH `{}` → 400 `{detail}`; PATCH a forbidden field (e.g. `status`) → 422 `{detail}`; PATCH does not change `status`/`page_count`/`added`.
  - [x] **Backend** `server/tests/test_storage.py`: `update_doc_meta` refreshes the `library.json` cache; a dir purged after the read → `DocumentNotFoundError` and no meta-only ghost row (mirror `test_apply_extraction_does_not_resurrect_dir_purged_after_read`). Confirm `apply_extraction`'s existing tests still pass after the helper extraction.
  - [x] **Backend** `server/tests/test_openapi.py`: `PATCH /api/docs/{doc_id}` path present and `DocPatch` in `components.schemas`.
  - [x] **Client** `CollectionTable.test.tsx`: click a Title cell → input seeded with current text; type + Enter → `onEditField(docId, "title", value)`; Esc → NOT called and the static cell returns; blur → commits; click on the cell does NOT call `onOpenRow` (stopPropagation); Enter on a focused cell enters edit; Authors cell edits the same; an `extracting` row is NOT editable (click leaves no input); a no-op commit (unchanged value) does not call `onEditField`. Update the existing render sites for the new required `onEditField`.
  - [x] **Client** `LibraryPage.test.tsx`: `vi.spyOn(api, "patchDoc")`; commit → optimistic row update + `patchDoc` called with the single field; on `patchDoc` reject → row reverts + error toast. Keep every existing case mocking BOTH `getLibrary` and (where used) `uploadDoc`; existing 6.3–6.5 cases stay green (they never trigger an edit).
  - [x] Run the FULL suites: `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 UV_CACHE_DIR=/tmp/uv-cache uv run pytest -q`; `cd client && npm test && npm run typecheck`. `no-raw-values.test.ts` green; em-dash grep any new UI string (`Couldn't save that change.`, `aria-label="Edit title/authors"` — none contain `—`).
- [x] **Task 8 — Docs + version** (AC: all)
  - [x] `docs/API.md`: add a `PATCH /api/docs/{doc_id}` resource entry (partial title/authors update, meta-authoritative, refreshes the `library.json` cache; 200 `Doc`, 400 empty, 404 unknown, 422 malformed/forbidden, 500 storage) and a Changelog line dated 2026-07-05 (Story 6.6). Same change as the endpoint (CLAUDE.md).
  - [x] Bump `server/pyproject.toml` `version` `0.4.5 → 0.4.6` (PATCH +1 at story done). Re-run `uv lock` if needed; `test_version.py` stays green.
- [x] **Task 9 — Live smoke (own fresh servers, trusted input)** (AC: 1, 4, 5)
  - [x] Launch YOUR OWN `uvicorn` + `vite dev` (alternate ports if defaults are taken), bound to this working tree; tear down after. Do NOT reuse a user-launched server (CLAUDE.md). This is a **focus-sensitive interaction** — drive it with TRUSTED input (real click / `press_key`), never `dispatchEvent`/`.click()` ([[use-trusted-input-for-focus-sensitive-smoke]]): click a Title cell → edit → type → Enter commits and the row shows the new value; Esc cancels back to the old value; click-away (blur) commits; the 2px ink focus ring is visible; confirm clicking a Title cell does NOT open the reader; verify a `parse-failed` row's filename-fallback title is editable.

## Dev Notes

### The shape of this change (read first)

This is a **small, well-seamed** story: one new REST verb, one storage writer (mostly a refactor of an existing one), and inline-edit UI on the existing table. Nearly every seam already exists — consume it, do not rebuild:

- **`apply_extraction`** (storage) already does the exact "re-read meta → guard the purge TOCTOU → write with `create_parents=False` → refresh the `library.json` cache through `_mutate_index`/`_upsert_paper_entry`" dance. `update_doc_meta` is the *same* operation with a user-supplied `{title?, authors?}` instead of the extraction's `{title, authors, status}`. **Extract the shared core once**; don't paste the pattern. [Source: server/app/storage/__init__.py:458-493]
- **`GET /api/library`** display cache is what the table renders from; `_upsert_paper_entry` refreshing it is the whole mechanism that makes a committed edit show up. No new read path. [Source: server/app/storage/__init__.py:264-302]
- **`CollectionTable`** is currently declared "read-only, owns no fetch" (its header comment). 6.6 adds *editing*, but keeps that contract: the table reports `onEditField`, `LibraryPage` owns `patchDoc` + optimistic state — the exact `onOpenRow` split already in place. [Source: client/src/library/CollectionTable.tsx:98-121]
- **`Toast variant="error"`** (added in 6.5) is the failure surface; reuse it for a save failure — do not add a new toast. [Source: client/src/library/LibraryPage.tsx:210-215; DESIGN.md#components toast]
- **The filename-fallback for a null title** already exists (`displayTitle = row.title ?? stripPdfExtension(filename)`). Clearing a title to `null` re-uses it for free (AC-7). [Source: client/src/library/CollectionTable.tsx:143-146]

Unlike 6.5, this **is** a contract shape change (new `DocPatch` + `PATCH` path) → regen `openapi.json` + `schema.d.ts` and commit them.

### Layering (AD-9 downward rule intact)

```
client:  CollectionTable (reports onEditField)  ──▶  LibraryPage (owns patchDoc + optimistic)
                                                          ──▶  api/client.patchDoc
route:   PATCH /api/docs/{id}  (thin: parse DocPatch, normalize, map errors)
              ──▶  storage.update_doc_meta  ──▶  _update_meta_and_reindex  (ONLY disk writer, AD-L7 lock)
```

- The route stays thin (no filesystem, no domain logic) — parse `DocPatch`, normalize strings, map the `StorageError` taxonomy to the `{ detail }` envelope, exactly like `get_doc`/`put_annotations`. [Source: server/app/routes/docs.py:100-112]
- Storage remains the sole `~/.paper-mate` writer (AD-9); the cache refresh is serialized under `_index_lock` (AD-L7) via `_mutate_index`.
- `meta.json` is authoritative for `title`/`authors`; `library.json`'s copy is the non-authoritative cache (meta wins on conflict, refreshed on every write). Editing writes meta, then refreshes the cache — never writes the cache directly. [Source: server/app/models.py:100-117; ARCHITECTURE-SPINE#AD-L1]

### The interaction knot: edit vs. select-vs-open (READ CAREFULLY)

The table's current gesture model (Story 6.3, unchanged): a **single click selects (arms)** a row; a **second click on the armed row opens** it via `onOpenRow`. Story 6.6 adds **single-click-on-Title/Authors-cell → edit**. Story 6.7 (the very next story) will change opening to **double-click the row**.

Resolution for 6.6 (scope-disciplined, forward-compatible with 6.7):

- Put the edit trigger on the Title/Authors `<td>` with `stopPropagation()`, so clicking those cells edits and never reaches the `<tr>` select/open handler.
- Leave the 6.3 row select/open **as-is** for the non-editable cells (Added, File type). A paper is therefore still openable during 6.6 (click a non-title cell to arm, click again to open).
- Story 6.7 reconciles this to "double-click row → open" and single-click-cell → edit; at that point the 6.3 arm-select becomes vestigial. **Do not pull that change forward here.** [Source: epics.md#Story-6.7]
- The existing 6.3/6.5 tests fire `click` on the `<tr>` directly (not on a `<td>`), so `td.stopPropagation()` does not affect them — they stay green. Real user clicks land on the `<td>`, where the new handler runs.

This interim (open only via non-title cells) is the one rough edge; it is called out as an end-of-story question. It does not block 6.6 standalone (edit works; open still works).

### Inline-edit mechanics (the gotchas that bite)

- **Esc-then-blur / Enter-then-blur double commit.** Enter (commit) and Esc (cancel) both cause the input to unmount, which fires `onBlur` during teardown; a naive `onBlur=commit` then re-commits (Esc would silently commit the draft). Guard with a `committedRef` set on Enter/Esc; `onBlur` only commits when `committedRef` is unset. This is the same class of focus-teardown bug that recurs in this repo.
- **Seed = displayed text, not raw null.** Editing a `parse-failed` filename-fallback row seeds the *filename* (extension stripped) so the user tweaks what they see (AC-3). Never seed the literal `Untitled` placeholder — seed `""` when neither title nor filename is known.
- **No-op guard (AC-6).** Committing an unchanged value must not `PATCH`. Compare `value.trim()` to the current field normalized (`row.title ?? ""` for title, `row.authors ?? ""` for authors); equal → do nothing, just exit edit mode.
- **Empty → null (AC-7).** A blank/whitespace commit clears the field. Client sends `trimmed || null`; the server also normalizes (`strip`, empty → `None`) so the invariant holds regardless of caller. A cleared Title re-shows the filename fallback.
- **Only settled rows edit (AC-8).** Gate editability on `status !== "extracting"` and non-pending. This is not cosmetic: a user editing during the `extracting` window could be clobbered by the background `apply_extraction` (which writes title/authors/status). Disallowing edits on unsettled rows removes the race entirely — no locking needed.
- **`user-select`.** Rows set `user-select: none` (CollectionTable.css:54-58); set `user-select: text` on the input so the field is normally selectable/editable. [Source: client/src/library/CollectionTable.css:54-58]
- **Autofocus + select-all** on entering edit: `useEffect(() => inputRef.current?.select(), [])` inside the mounted `InlineEditor` (focus via `autoFocus` or the same effect).

### Backend contract details (`DocPatch` + PATCH)

- **Partial semantics via `exclude_unset`.** `DocPatch` has both fields optional; `patch.model_dump(exclude_unset=True)` yields only the keys the client actually sent, so a single-cell edit sends `{ "title": ... }` and leaves `authors` untouched. A client that omits both → empty `updates` → 400.
- **`extra="forbid"`** on `DocPatch` so an attempt to PATCH a non-editable field (`status`, `page_count`, …) is a loud 422, not a silent drop. Only `title`/`authors` are patchable in this story.
- **Response = the full updated `Doc`** (like `GET /api/docs/{id}`), so the client reconciles the row authoritatively from it. The client already holds the value it typed; returning `Doc` keeps meta the source of truth and is trivial (`Doc(doc_id=doc_id, **meta.model_dump())`).
- **Error taxonomy** (AR-11, mirror `get_doc`): `DocumentNotFoundError` → 404 `"Document not found"`; other `StorageError` → 500 `"Could not update document"`; empty body → 400 `"No fields to update"`; Pydantic validation (forbidden/malformed field) → FastAPI's 422 `{ detail }`.

### Reuse, do not reinvent (CLAUDE.md engineering principles)

- **`_update_meta_and_reindex`** shared by `apply_extraction` + `update_doc_meta` — one write-and-refresh core, two callers. Not a second copy of the TOCTOU dance.
- **`_upsert_paper_entry` / `_mutate_index`** are the cache path — not a new `library.json` writer.
- **`Toast variant="error"`** reused for the save-failure notice.
- **`onOpenRow` split** is the template for `onEditField` (table reports, page fetches).
- **Filename fallback** (6.3) is reused for a cleared title — no new "empty title" rendering. [Source: [[prefer-stable-solutions]]; CLAUDE.md]

### Scope fence — what this story does NOT build

- **No double-click-to-open / no removing the 6.3 arm-select** — that is Story 6.7. 6.6 only adds cell editing; the open gesture is untouched. [Source: epics.md#Story-6.7]
- **No status change on edit.** Fixing a `parse-failed` row's title does not flip it to `ready`; the `status` and its "No metadata" chip are extraction-outcome markers, out of scope to re-derive here. (Called out as an end-of-story question.)
- **No new field editing** — Title and Authors only. No Added/File-type/folder editing (folders are Epic 7).
- **No multi-cell / bulk edit, no validation beyond trim/empty** (single-user, trust the input).
- **No optimistic-concurrency token / ETag** — last-write-wins; the settled-only gate (AC-8) already removes the one real race (edit vs. `apply_extraction`).

### DECISION notes (defaults chosen; confirm at end if you disagree)

1. **Single-click a Title/Authors cell edits it** (honoring AC-1's "click it"), with `stopPropagation` so it never opens. Opening stays on the 6.3 path via non-editable cells until 6.7 makes it double-click. **Interim rough edge, documented.**
2. **Editable only on settled rows** (`ready`/`enrich-skipped`/`parse-failed`), never while `extracting` or pending — removes the write race with `apply_extraction`.
3. **PATCH returns the full `Doc`**; the client reconciles the edited row from it (authoritative) after the optimistic update.
4. **`DocPatch` uses `extra="forbid"`** and `exclude_unset` partial semantics; empty body → 400.
5. **Emptied field → `null`** (server + client both normalize trim/empty). Title falls back to filename; Authors renders empty.
6. **Editing never changes `status`** (the `parse-failed` chip persists after a title fix).
7. **Failure → optimistic revert + `Toast variant="error"`** (`Couldn't save that change.`), not a page-wide refetch.

### Project Structure Notes

- **Modified backend:** `server/app/models.py` (`DocPatch`), `server/app/routes/docs.py` (`patch_doc`), `server/app/storage/__init__.py` (`update_doc_meta` + extracted `_update_meta_and_reindex`; `apply_extraction` becomes a thin caller), `server/pyproject.toml` (version `0.4.6`), `server/openapi.json` (regen: new path + `DocPatch`), tests (`test_docs.py`, `test_storage.py`, `test_openapi.py`).
- **Modified client:** `client/src/library/CollectionTable.tsx` (+`.css`, +`.test.tsx`) — `EditableCell`/`InlineEditor`, `onEditField` prop; `client/src/library/LibraryPage.tsx` (+`.test.tsx`) — `handleEditField` + optimistic/revert; `client/src/api/client.ts` (`patchDoc` + `DocPatch` alias); `client/src/api/schema.d.ts` (regen).
- **Modified docs:** `docs/API.md` (PATCH resource + Changelog).
- **Untouched:** router, `ReaderPage`, annotation store/anchor/render layers, `GET /api/library` route, `useBulkUpload`/`useSettlePolling`. `CollectionTable`/`LibraryPage` still do not import `render/`, so the `vi.mock("./render")` barrels (App.test/Reader.test) are **not** affected. [Source: CLAUDE.md render-mocks principle — N/A here]
- Downward-dependency rule (AD-9) intact: view (`CollectionTable`) → hooks/page (`LibraryPage`) → api client → route → storage (sole disk writer).

### Testing standards

- **Backend:** pytest, `PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q` (CLAUDE.md). No network. `PATCH` route tests can use `TestClient` (no background task on this path) but the suite has an autouse `enrich` network guard already; import a PDF then PATCH. Prefer a direct `storage.update_doc_meta` unit test for the TOCTOU/purge case (sandbox TestClient-hang note). Backend suite is **run-it-yourself on the host** in the Codex review sandbox (`export UV_CACHE_DIR=/tmp/uv-cache`).
- **Client:** Vitest + `@testing-library/react`, jsdom. **Mock the api module** (`vi.spyOn(api, "patchDoc"/"getLibrary")`), never real `fetch`. `CollectionTable` interaction tests use `fireEvent`/`@testing-library` `userEvent` for click/type/keydown; assert `onEditField` calls and that `onOpenRow` is NOT called on a cell click. Every `LibraryPage.test.tsx` case still mocks the mount's `getLibrary` (and `uploadDoc` where used) — the render-mocks-in-sync rule that bit 6.3/6.4. Run the FULL client suite (`npm test`) + `npm run typecheck` clean; `no-raw-values.test.ts` + em-dash grep on new strings.
- **Live smoke (Task 9):** own fresh servers, trusted input, focus-sensitive — see the task. jsdom cannot see real focus/blur/selection ordering, so the Esc-vs-blur and focus-ring behaviors MUST be verified live, not only in jsdom.
- **Regression watch:** the `apply_extraction` behavior must be byte-identical after the helper extraction (its existing tests are the guard); `Toast` default variant stays `"error"`; the 6.3 click-to-select/open tests stay green (they click the `<tr>`, not a `<td>`).

### References

- [Source: .bmad/planning-artifacts/epics.md#Story-6.6] — the 4 ACs: click/focus-Enter → inline `{component.text-input}`, Enter/blur commit + Esc cancel; persist via `PATCH /api/docs/{id}` authoritative on `meta.json` + refresh `library.json` cache; `parse-failed`/`enrich-skipped` editable the same; 2px ink focus, keyboard-operable.
- [Source: .bmad/planning-artifacts/epics.md#Story-6.7] — the NEXT story owns double-click-to-open; do not pull it forward.
- [Source: ARCHITECTURE-SPINE#AD-L1] — `meta.json` = own fields (authoritative), `library.json` = non-authoritative display cache, meta wins, refreshed on every write.
- [Source: ARCHITECTURE-SPINE#AD-L6] — docs vs library API boundary: per-doc mutation is `/api/docs/{id}`, not `/api/library`.
- [Source: ARCHITECTURE-SPINE#AD-L7] — index-write concurrency; the cache refresh goes through `_mutate_index` under `_index_lock`.
- [Source: server/app/storage/__init__.py:458-493] — `apply_extraction`: the exact re-read → TOCTOU-guard → `create_parents=False` write → `_mutate_index` cache-refresh sequence to factor out and share with `update_doc_meta`.
- [Source: server/app/storage/__init__.py:264-302] — `_cache_from_meta`, `_upsert_paper_entry`, `_next_order` (the cache path a committed edit refreshes through).
- [Source: server/app/routes/docs.py:82-112] — `get_doc` — the thin route + `{ detail }` error-mapping template for `patch_doc`.
- [Source: server/app/models.py:49-117] — `DocMeta` (`title`/`authors` fields), `Doc`, `CollectionRow`; add `DocPatch` here.
- [Source: server/app/routes/library.py] — `GET /api/library` is the display-cache read the table renders from; unchanged.
- [Source: client/src/library/CollectionTable.tsx:89-182] — props union + `handleRowClick` (6.3 select/open) + Title/Authors cell rendering + `stripPdfExtension`/`displayTitle` fallback to extend.
- [Source: client/src/library/CollectionTable.css:43-79] — cell/`user-select`/`aria-selected` focus-ring styling to mirror for the inline input.
- [Source: client/src/library/LibraryPage.tsx:133-231] — `handleResolved`/`setLibrary` state shape + `Toast` usage; add `handleEditField` (optimistic + revert) alongside.
- [Source: client/src/api/client.ts:50-83] — `uploadDoc`/`getDoc`/`putAnnotations` — the route-owner methods + `envelopeError`; add `patchDoc` in the same style.
- [Source: client/src/library/CollectionTable.test.tsx / LibraryPage.test.tsx] — existing test call-sites to update for the new required `onEditField`; `vi.spyOn(api, …)` mock pattern.
- [Source: DESIGN.md:310-317 (#components text-input)] — `text-input` design tokens (surface-card bg, ink text, hairline-strong border, radius-md); `{colors.ink}` + `--focus-ring-width` (2px) for the focus treatment.
- [Source: docs/API.md:29-113,185-199] — `POST`/`GET`/`PUT` docs entries (style) + Changelog to extend with the PATCH entry.
- [Source: .bmad/implementation-artifacts/6-5-metadata-extraction.md] — the seams 6.6 consumes: `apply_extraction` TOCTOU/cache-refresh (the pattern to share), `Toast variant`, the `CollectionTable` status seam, the contract-regen flow, the "mock everything the mount calls" rule.
- [Source: CLAUDE.md] — tokens never inline hex/px (raw values only in `src/theme/**`); no em-dash in UI strings; don't reinvent wheels; OOP decomposition + refactor structure in the same change; document-level interaction handlers; launch your OWN dev servers for smoke; trusted input for focus-sensitive smoke; versioning (PATCH +1 at merge); branch-per-story; backend-tests sandbox note; contract-types regen flow; maintain `docs/API.md` with any `/api` change.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5

### Debug Log References

- Backend suite: `PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 UV_CACHE_DIR=/tmp/uv-cache uv run pytest -q` → 145 passed.
- Client suite: `npm test` → 950 passed (50 files); `npm run typecheck` → clean.
- Live smoke: own `uvicorn --port 8010` + `vite dev --port 5183` against an isolated `PAPER_MATE_DATA` scratch dir (a hand-seeded `parse-failed` doc, boot `reconcile_library` auto-indexed it); driven via Playwright MCP with trusted click/type/keydown (Chrome extension was unavailable this session).

### Completion Notes List

- Backend: `DocPatch` (`extra="forbid"`, both fields optional) + `PATCH /api/docs/{doc_id}` (partial via `exclude_unset`, empty body → 400, unknown → 404, forbidden/malformed field → 422, storage failure → 500). Extracted `_update_meta_and_reindex` out of `apply_extraction` as the shared re-read/TOCTOU-guard/write/reindex core; `update_doc_meta` and `apply_extraction` are now both thin callers of it — no duplicated dance.
- Contract regenerated (`export_openapi` + `gen:api`); `openapi.json`/`schema.d.ts` committed. `patchDoc` + `DocPatch` alias added to `client/src/api/client.ts`.
- `CollectionTable` decomposed into `EditableCell` (static cell vs. `InlineEditor` per `{docId, field}`) + `InlineEditor` (owns its draft, autofocus+select-all, `committedRef` guard against the Esc/Enter-then-blur double-fire). Editable only for settled rows (`status !== "extracting"`); click/Enter on the cell both `stopPropagation()` so the 6.3 row select/open handler never fires from an edit gesture. No-op guard compares the trimmed commit against the raw stored field (`row.title ?? ""`/`row.authors ?? ""`), not the seeded fallback text, per the story's Dev Notes.
- `LibraryPage.handleEditField`: functional `setLibrary` optimistic update, `patchDoc`, authoritative reconcile of `title`/`authors` from the returned `Doc` on success, full revert + `Toast variant="error"` ("Couldn't save that change.") on failure. A `withField` helper avoids a TS-widening issue from a computed `{ [field]: value }` key spread.
- Tests: 12 new backend tests (`test_docs.py` PATCH cases, `test_storage.py` `update_doc_meta` cases incl. the purge-mid-write TOCTOU mirror, `test_openapi.py` schema/path check), 9 new `CollectionTable.test.tsx` inline-edit cases (all 16 pre-existing render call-sites updated for the new required `onEditField` prop), 2 new `LibraryPage.test.tsx` cases (optimistic commit + revert-on-reject). Full regression green on both suites.
- Live smoke (own fresh servers, trusted input, isolated data dir): click enters edit seeded with the filename fallback (`poor-paper`) on a `parse-failed` row; the 2px ink focus ring is visible; Enter commits and persists (`GET /api/library` reflects the new title, `status` still `parse-failed`); Esc cancels without persisting; blur commits; clicking the Title cell never opens the reader (URL stays `/`), including when the row is already armed/selected.
- Docs: `docs/API.md` gained the `PATCH /api/docs/{doc_id}` resource entry + a 2026-07-05 Story 6.6 Changelog line. Version bumped `0.4.5 -> 0.4.6` (`server/pyproject.toml` + `uv.lock`).
- End-of-story open question carried forward from Dev Notes (not blocking, flagged for 6.7): opening a paper is still only reachable via a non-Title/Authors cell (arm + second click) since 6.6 intentionally does not pull the double-click-to-open reconciliation forward; Story 6.7 owns that.

### File List

- `server/app/models.py` — added `DocPatch`.
- `server/app/routes/docs.py` — added `patch_doc` (`PATCH /api/docs/{doc_id}`); module docstring updated.
- `server/app/storage/__init__.py` — added `_update_meta_and_reindex` (shared core) + `update_doc_meta`; `apply_extraction` refactored to call the shared core.
- `server/openapi.json` — regenerated (new `DocPatch` schema + PATCH path).
- `server/pyproject.toml` — version `0.4.5` → `0.4.6`.
- `server/uv.lock` — regenerated for the version bump.
- `server/tests/test_docs.py` — added PATCH route tests.
- `server/tests/test_storage.py` — added `update_doc_meta` tests.
- `server/tests/test_openapi.py` — added `DocPatch`/PATCH-path contract test.
- `client/src/api/client.ts` — added `patchDoc` + `DocPatch` type alias.
- `client/src/api/schema.d.ts` — regenerated.
- `client/src/library/CollectionTable.tsx` — `EditableCell`/`InlineEditor`, `onEditField` prop, editing state.
- `client/src/library/CollectionTable.css` — `.collection-table__edit-input` styling.
- `client/src/library/CollectionTable.test.tsx` — updated all render call-sites for `onEditField`; added inline-edit test coverage.
- `client/src/library/LibraryPage.tsx` — added `handleEditField` (optimistic update + revert), wired `onEditField` into `CollectionTable`.
- `client/src/library/LibraryPage.test.tsx` — added inline-edit commit/revert tests.
- `docs/API.md` — added the `PATCH /api/docs/{doc_id}` resource entry + Changelog line.
- `.bmad/implementation-artifacts/sprint-status.yaml` — status transitions for `6-6-inline-edit-title-authors`.

### Change Log

- **2026-07-05 (Story 6.6):** Inline edit of Title/Authors in the Library table. New `PATCH /api/docs/{doc_id}` (`DocPatch` partial update, `meta.json`-authoritative, refreshes the `library.json` display cache) + `storage.update_doc_meta` sharing `apply_extraction`'s write-and-reindex core. `CollectionTable` gains inline-editable Title/Authors cells (`EditableCell`/`InlineEditor`, `onEditField`); `LibraryPage` owns the optimistic update + revert-on-failure via `patchDoc`. Contract shape change (new path + `DocPatch`): `openapi.json`/`schema.d.ts` regenerated. Version `0.4.5 -> 0.4.6`.
