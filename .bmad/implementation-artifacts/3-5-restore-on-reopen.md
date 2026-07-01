---
baseline_commit: 314092e
---

# Story 3.5: Restore on reopen

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a reader,
I want every mark back exactly where I left it,
so that my annotated record is durable across sessions.

> **This is the READ half of persistence — the exact mirror of Story 3.4 (the WRITE half, now merged, PR #27).** 3.4 built: client dirty-flag + debounced single-flight autosave (`useAutosave`), `putAnnotations` api, `PUT /api/docs/{doc_id}/annotations` route, `storage.write_annotations` (atomic, disk envelope `{schema_version, annotations}`). This story builds: `storage.read_annotations` (envelope-strip + unknown-`schema_version` reject), a `GET /api/docs/{doc_id}/annotations` route, a `getAnnotations` api call, a store `hydrate` action (that also clears zundo history), and the open-a-doc wiring that hydrates the store BEFORE the reader mounts.
>
> **Read this before coding — this story CLOSES the 3.4 clobber trap.** 3.4's Dev Notes documented an accepted window: with no hydrate-on-open, re-opening an annotated PDF started the store EMPTY, so the first edit's autosave PUT overwrote the saved set. **3.5 removes that trap.** The whole point is that opening an annotated doc now restores its marks. The single most important correctness property (Task 4): **hydration must NOT itself trigger an autosave PUT, and must NOT be undoable.** If you get the ordering wrong, opening a doc immediately PUTs the just-loaded set back (harmless data-wise but wrong), or a user can `Ctrl+Z` the restored marks into emptiness and then autosave clobbers disk. The design below (hydrate the store while `doc` is still `null`, then flip `doc`; clear zundo history in the same step) makes both impossible without touching `useAutosave.ts`.
>
> **Contract change (expected, small).** Adding `GET /api/docs/{doc_id}/annotations` adds ONE `paths` entry to OpenAPI. `components.schemas` does NOT change shape — `list[Annotation]` (and every `Annotation`/anchor/`Rect`/`Point`/`Style` component) is ALREADY emitted by the 3.4 PUT route. You WILL still regenerate `server/openapi.json` (gitignored) + `client/src/api/schema.d.ts` (committed) and update `docs/API.md` (move GET out of Reserved). After this, `GET`/`PUT …/annotations` are both live; the `/api/docs` list + `/api/docs/{doc_id}` detail stay Reserved.

## Acceptance Criteria

> Faithful to `epics.md` Story 3.5, restated self-contained with the architecture's H9 (disk-envelope) and AD-6/AD-7 (hydrate-on-open, one command path) conventions made explicit. The dev needs only this file.

1. **Opening a previously annotated PDF GETs and restores its marks.** Given a doc that has a saved `annotations.json`, when it is opened, the client GETs `/api/docs/{doc_id}/annotations` (bare `Annotation[]` body, H9) and hydrates the store's `annotations` Map keyed by `id`; every restored mark renders. A doc that was imported but never annotated (no `annotations.json` on disk) restores as an EMPTY set (a `200` with `[]`, NOT a 404). (FR-22, AR-6, AR-8, AD-6)

2. **Restored marks render at their exact PDF coordinates across all zoom levels.** Given the store is hydrated, each mark re-renders at its exact page-normalized position (AR-4), correct at every zoom, with two-page (`group_id`) siblings restored and rendered as one group. This is derived by the existing overlay/anchor layer from the store — no new geometry code — so the ONLY new work is populating the store correctly. (FR-22, NFR-3)

3. **`annotations.json` with an unknown `schema_version` is rejected, not guessed.** Given the on-disk envelope carries a `schema_version` this code cannot handle, `storage.read_annotations` raises rather than silently returning a partial/guessed set; the GET surfaces the single `{ "detail" }` envelope (500). Corrupt/unreadable JSON is likewise rejected, not treated as empty. (AR-8, AD-8, H9)

4. **Restore is not a change: it neither PUTs back nor becomes undoable.** Given a doc is opened and its marks hydrated, autosave does NOT fire a PUT as a result of the hydration (the restored set is the autosave BASELINE, not a new dirty change — AC-1 of 3.4 stays true), and the hydration is NOT an undo step: `Ctrl+Z` immediately after opening cannot remove restored marks (zundo history is cleared to the hydrated set as the floor). A real user edit after opening still dirties + PUTs and is undoable as normal. (AR-7, AD-7, NFR-4)

5. **Nothing is silently lost across the session boundary.** Given the prior session's saved set, every mark present at last save is present after reopen (round-trip PUT→GET is lossless: same ids, anchors, styles, `body`, `group_id`, timestamps). If the GET fails on open, the doc is NOT opened with an empty store (which would let the next edit clobber disk); the failure surfaces and the reader stays closed. (NFR-4)

6. **Contract regenerated; GET now live.** `GET /api/docs/{doc_id}/annotations` is added (`response_model=list[Annotation]`); `server/openapi.json` (gitignored) + `client/src/api/schema.d.ts` (committed) are regenerated from the Pydantic source; `docs/API.md` moves GET out of "Reserved" and adds a changelog entry. No hand-authored API types. `components.schemas` shape is unchanged (list[Annotation] already emitted by PUT). (AD-3, AR-9)

7. **No regression to autosave, the command path, or Epic-1/2/3 interactions.** Hydration adds ONE store action (`hydrate`) and does not alter any existing mutation action, `useAutosave.ts`, or the overlay/anchor render path. Every existing interaction (create-on-release, single-`activeTool` FSM, click-select/recolor/restyle, arm-time color, pen draw/restroke/alpha, memo place/resize, comment pin/bubble/cross-page group, box region, drag-to-change-tool, 3.1 move/resize + double-click re-edit, 3.2 undo/redo, 3.3 Del delete, 3.4 autosave) still works. (AR-7, AD-9)

## Tasks / Subtasks

- [x] **Task 1: Backend storage read (AC: #1, #3, #5).**
  - [x] In `server/app/storage/__init__.py`, add a public `read_annotations(doc_id: str) -> list[Annotation]` (import `Annotation` is already at module top). Model it EXACTLY on the existing `_read_meta` template (same error taxonomy):
    - Resolve `_doc_dir(doc_id)`; on the containment `StorageError` raise `DocumentNotFoundError` (mirror `source_path`/`write_annotations`).
    - `if _read_meta(doc_dir) is None: raise DocumentNotFoundError(...)` — a doc with no valid `meta.json` is "not found" (never invent an annotations set for an unimported doc).
    - `annotations_path = doc_dir / "annotations.json"`; `if not annotations_path.is_file(): return []` — an imported-but-never-annotated doc restores empty (AC-1). This is the common first-open case; it is NOT an error.
    - `try: payload = json.loads(annotations_path.read_text())` — on `(json.JSONDecodeError, OSError)` raise the corrupt-file error (see next subtask).
    - `version = payload.get("schema_version") if isinstance(payload, dict) else None`; `if version != ANNOTATIONS_SCHEMA_VERSION: raise UnsupportedSchemaError(...)` (reject, do not guess — AC-3).
    - Validate the list: `raw = payload.get("annotations")` must be a list; `try: return [Annotation.model_validate(a) for a in raw]` — on `ValidationError` (or a non-list `raw`) raise the corrupt error. This strips the envelope and returns the BARE list (H9).
  - [x] Add a `CorruptAnnotationsError(StorageError)` sibling next to `CorruptMetadataError` (annotations corruption is a distinct on-disk fault from meta corruption; keep the taxonomy precise). Both it and `UnsupportedSchemaError` are `StorageError` subclasses, so the route's `except storage.StorageError` maps them to 500 without extra handling.
  - [x] Do NOT change `write_annotations`, `import_pdf`, `_read_meta`, or `_atomic_write`. `read_annotations` REUSES `_doc_dir` + `_read_meta` (existence gate) + `ANNOTATIONS_SCHEMA_VERSION` — do not add a second path resolver or a second version constant.

- [x] **Task 2: Backend GET route + contract (AC: #1, #3, #6).**
  - [x] In `server/app/routes/docs.py`, add `@router.get("/docs/{doc_id}/annotations", response_model=list[Annotation], responses={404: ..., 500: ...})` mirroring the PUT route's `responses` envelope refs. Body: `async def get_annotations(doc_id: str) -> list[Annotation]:` → `return storage.read_annotations(doc_id)`, with `except storage.DocumentNotFoundError → HTTPException(404, "Document not found")` and `except storage.StorageError → HTTPException(500, "Could not read annotations")` (copy the PUT/`get_doc_file` mapping idiom exactly).
  - [x] Update the module docstring: move `GET /api/docs/{doc_id}/annotations` out of the "Reserved" line (it is now built); keep `GET /api/docs` and `GET /api/docs/{doc_id}` reserved.
  - [x] Regenerate the contract: `cd server && PYTHONPATH= uv run python -m app.export_openapi` (writes `server/openapi.json`), then `cd client && npm run gen:api` (writes `client/src/api/schema.d.ts`). Commit `schema.d.ts` (openapi.json is gitignored per CLAUDE.md). Verify the diff is ADDITIVE: a new `GET …/annotations` operation under `paths`; `components.schemas` unchanged (a good sign — `list[Annotation]` was already there from PUT). Confirm `schema.d.ts` STILL exports `Annotation` + `TextAnchor`/`RectAnchor`/`PathAnchor`/`Rect`/`Point`/`Style`.
  - [x] Update `docs/API.md`: promote the `GET /api/docs/{doc_id}/annotations` row out of the Reserved table into a live resource section (response body = bare `Annotation[]`; `[]` for an imported-but-unannotated doc; 404 for unknown doc; 500 `{ "detail": "Could not read annotations" }` for a corrupt/unknown-version disk file; note the disk envelope is stripped inside storage). Add a changelog line: `2026-07-01 (Story 3.5): added GET /api/docs/{doc_id}/annotations (hydrate-on-open; bare list, [] when unannotated). GET /api/docs + /api/docs/{doc_id} stay reserved.`

- [x] **Task 3: Client api + store hydrate action (AC: #1, #2, #4, #7).**
  - [x] Add `getAnnotations(docId: string): Promise<Annotation[]>` to `client/src/api/client.ts` (the ONLY client→backend path, AD-9): `GET /api/docs/${encodeURIComponent(docId)}/annotations`; on `!res.ok` throw `await envelopeError(res)`; else `return (await res.json()) as Annotation[]`. Mirror the `fetchHealth`/`putAnnotations` idioms.
  - [x] In `client/src/store/index.ts`, add a `hydrate(annotations: Annotation[]): void` action to `AnnotationStore` + its implementation. It replaces the working copy for a freshly opened doc:
    - `set(() => ({ annotations: new Map(annotations.map((a) => [a.id, a])), selectedId: null, hoveredId: null, dragPreview: null }))` — build the Map keyed by `id` (AC-1), and clear the transient UI fields (nothing from a prior state should survive a hydrate).
    - Document it: this is a LOAD, not a user edit — it is the ONLY non-mutation way the annotation set is set wholesale.
  - [x] Export a free function `hydrateStore(annotations: Annotation[]): void` from `store/index.ts` that (1) calls the `hydrate` action, THEN (2) clears zundo history so the loaded set is the undo FLOOR: `useAnnotationStore.temporal.getState().clear()`. Encapsulating the temporal clear here keeps zundo knowledge inside the store module (the caller in App just calls `hydrateStore`). AC-4: after this, `pastStates`/`futureStates` are empty → `Ctrl+Z` cannot undo the restore.
  - [x] Update the `store/index.ts` header comment (line ~12: "hydrate-on-open (3.5) is also not here yet") to state hydrate-on-open now lives here via `hydrate`/`hydrateStore`. Update `client/src/store/README.md` similarly if it describes the persistence boundary.
  - [x] Layering (AD-9): `getAnnotations` sits in `api/` alongside `putAnnotations`; `hydrate`/`hydrateStore` live in `store/`. Do NOT put the fetch inside the store. Do NOT modify `useAutosave.ts` (AC-7).

- [x] **Task 4: Open-a-doc wiring — hydrate BEFORE the reader mounts (AC: #1, #4, #5). THE CRITICAL TASK.**
  - [x] In `client/src/App.tsx` `handleFile`, change the open flow so the store is hydrated while `doc` is still `null`, then `doc` flips:
    ```
    const opened = await uploadDoc(file);
    const restored = await getAnnotations(opened.doc_id);
    hydrateStore(restored);   // populate store + clear undo history — while doc is still null
    setDoc(opened);           // NOW the reader mounts and useAutosave keys onto the real doc_id
    ```
    Keep BOTH awaits inside the existing `try`; a failure of either lands in the existing `catch` → `setError("Couldn't open this file.")`, `doc` stays `null`, store stays empty → NO clobber (AC-5). Keep the `busy` single-flight guard and `finally { setBusy(false) }`.
  - [x] **Why this exact order is the whole story (do not "simplify" it):** `useAutosave(doc?.doc_id ?? "")` is keyed on the open doc. While `doc` is `null`, `docId` is `""` and the hook is fully inert (`if (!docId) return`; `mountedRef` stays `false`), so `hydrateStore` mutating the store fires the hook's `[annotations]` effect but it returns early WITHOUT marking the baseline or dirtying. When `setDoc` then flips `docId` to the real id, the hook's reset effect runs and the `[annotations, docId]` effect takes its BASELINE run against the ALREADY-hydrated Map (sets `mountedRef=true`, returns, no dirty). Net: the restored set becomes the autosave baseline and is never PUT back (AC-4). If you instead hydrate AFTER `setDoc` (e.g. in a `useEffect` on the Reader), the baseline captures the EMPTY set and the later hydrate is seen as a dirty change → a spurious PUT of the just-loaded data. Order is load-bearing.
  - [x] Do NOT reset the store on the empty-dropzone path or add a doc-switch affordance — there is one doc per page-load in v1 (AD-6, no in-session doc switch UI). The store starts empty on load; `hydrateStore` establishes the clean baseline on first open.

- [x] **Task 5: Tests (AC: #1–#5, #7).**
  - [x] Backend (`server/tests/test_storage.py`, reuse the `make_annotation` helper 3.4 added): `read_annotations` round-trips a set written by `write_annotations` (same ids/anchors/styles/body/group_id — AC-5); returns `[]` for an imported doc with NO `annotations.json` (AC-1); raises `DocumentNotFoundError` for an unknown/unimported `doc_id`; raises `UnsupportedSchemaError` for a hand-written `annotations.json` whose `schema_version` is bogus (AC-3); raises `CorruptAnnotationsError` for malformed JSON and for a valid-JSON-but-wrong-shape file (e.g. `annotations` not a list / a member missing required fields). Use `tmp_path` + `monkeypatch.setenv("PAPER_MATE_DATA", ...)`, matching the existing storage tests.
  - [x] Backend (`server/tests/test_docs.py`, reuse `annotation_payload`): `GET /api/docs/{doc_id}/annotations` returns 200 + the saved list after a PUT (PUT→GET round-trip, AC-5); returns 200 + `[]` for an imported-but-unannotated doc; 404 `{ "detail" }` for an unknown doc; 500 `{ "detail" }` when the on-disk file has an unknown `schema_version` (write a bad file under the doc dir, then GET). Use FastAPI `TestClient`.
  - [x] Backend `test_models.py`: update the OpenAPI-paths assertion to expect the GET `…/annotations` operation now present (3.4 updated it for PUT; add GET).
  - [x] Frontend (`client/`, Vitest + jsdom): `getAnnotations` parses the array and throws the envelope error on `!ok` (spy `fetch` like the existing client tests). Store: `hydrate` builds the Map keyed by `id` and clears `selectedId`/`hoveredId`/`dragPreview`; `hydrateStore` ALSO empties `temporal.getState().pastStates`/`futureStates` so a subsequent `undo()` is a no-op (AC-4). Reset the store + `temporal.getState().clear()` between cases (the existing `beforeEach` pattern).
  - [x] **Frontend — the anti-clobber regression (AC-4), the most important test.** In `App.test.tsx`: with `getAnnotations` mocked to return a non-empty set and `putAnnotations` spied, open a doc, advance past the 800ms debounce with fake timers, and assert `putAnnotations` was NEVER called (restore did not dirty). Add a companion: after opening, `useAnnotationStore.temporal.getState().undo()` (or assert `pastStates.length === 0`) leaves the restored marks intact. Then make ONE real store edit and assert `putAnnotations` IS called (baseline→dirty still works). This test is the executable proof the 3.4 trap is closed.
  - [x] **Frontend — update the shared `beforeEach`.** The new open flow calls `getAnnotations`, so EVERY existing App test that opens a doc will otherwise fire the real fetch and fail. Add `vi.spyOn(api, "getAnnotations").mockResolvedValue([])` next to the existing `fetchHealth`/`uploadDoc` spies in `App.test.tsx`'s setup (CLAUDE.md: keep test scaffolding in sync). Confirm no NEW `render/` export is added → the `vi.mock("./render")` barrels in `App.test.tsx`/`Reader.test.tsx` are untouched.

- [x] **Task 6: Docs, version, live smoke, close-out (AC: #5, #6, #7).**
  - [x] Bump `server/pyproject.toml` `[project].version` `0.2.6 -> 0.2.7` (single source → `app/version.py` → `GET /api/health` → top-bar badge; bump once at PR merge). Sync `server/uv.lock` (`uv lock`) if needed.
  - [x] `npm run typecheck` clean (regenerated `schema.d.ts` feeds it); full backend + client suites green.
  - [x] Cross-model Codex review (AE-6) on the diff (`314092e..HEAD`); resolve High/Med before done. (AE-7: `UV_CACHE_DIR=/tmp/uv-cache` in the sandbox for the backend suite.)
  - [x] **Live smoke on your OWN fresh servers** (uvicorn + vite dev on alternate ports, real `~/.paper-mate`, NEVER the user's running server — CLAUDE.md). This story's smoke is a genuine RE-OPEN cycle at DPR ≥ 1.25 (memory `verify-on-hidpi-and-real-host`): (1) open a fresh 2-page PDF, make a CROSS-PAGE highlight + a second mark (e.g. a pen stroke or recolor) so autosave writes `annotations.json`; (2) confirm the disk envelope; (3) **reload the page and re-open the SAME PDF** → assert every mark restores at the exact position at DPR>1, the two-page group renders as one, and the SaveIndicator does NOT flash "Saving" on open (proves restore didn't dirty — AC-4); (4) `Ctrl+Z` right after open does not remove restored marks (AC-4); (5) make one new edit → it PUTs normally. Clean up the synthetic doc folder from the real library afterward. The cross-page-at-DPR>1 path is jsdom-invisible; this smoke is mandatory, not optional.

## Dev Notes

### Where this story sits (the persistence boundary — READ half)

AD-6 / AR-7: the backend is the durable source of truth; the client holds a working copy that is **hydrated on open** and **flushed on change**. 3.4 built flush (write); 3.5 builds hydrate (read). AD-6: single user, one session per doc, no concurrency — so hydrate-on-open is a clean full replace, never a merge.

- **3.1/3.2/3.3 (done):** one mutation surface (store) + zundo (undo/redo) + delete.
- **3.4 (done, PR #27):** WRITE half — dirty flag → debounced single-flight PUT → atomic disk write; indicator + toast.
- **3.5 (this story):** READ half — `read_annotations` (envelope-strip + unknown-version reject) → GET route → `getAnnotations` → `hydrate` (+ zundo clear) → open-flow wiring. **Closes 3.4's documented clobber window.**

### The anti-clobber ordering, precisely (the crux of AC-4)

`useAutosave` (unchanged) uses a `mountedRef` baseline: the first `[annotations, docId]` effect run after `docId` becomes non-empty is the BASELINE and never dirties (3.4 AC-1). The open flow exploits this by hydrating while `docId` is still `""`:

```
handleFile:
  opened   = await uploadDoc(file)          // doc still null, autosave inert (docId "")
  restored = await getAnnotations(opened.doc_id)
  hydrateStore(restored)                     // store set + temporal.clear(); autosave effect fires but returns early (docId still "")
  setDoc(opened)                             // docId → real; autosave BASELINE run captures the hydrated Map → no dirty, no PUT
```

- Because `hydrateStore` runs BEFORE `setDoc`, by the time `useAutosave`'s baseline effect runs, `useAnnotationStore((s)=>s.annotations)` already returns the restored Map. Baseline = restored set. No spurious PUT (AC-4).
- `temporal.getState().clear()` inside `hydrateStore` wipes the undo history AFTER the hydrate `set`, so the restored state is the floor — `Ctrl+Z` on open is a no-op (AC-4).
- If GET throws, we never reach `hydrateStore`/`setDoc`; the catch keeps `doc` null and the store empty → the next session can't clobber because there IS no next-session edit path without an open doc (AC-5).

### Architecture conventions you MUST honor

- **H9 envelope split:** disk file = `{schema_version, annotations:[Annotation]}`; API GET/PUT body = BARE `[Annotation]`. Storage is the SOLE place that strips the envelope on read (as `write_annotations` is the sole place that adds it). `read_annotations` returns a bare list; the route/`getAnnotations`/store all speak bare lists. [Source: review-adversary.md#H9, ARCHITECTURE-SPINE.md#AD-8]
- **AD-8 reject/migrate:** "reject or migrate an unknown `schema_version` rather than guessing." v1 has only version 1, so the correct behavior is REJECT (raise `UnsupportedSchemaError`). Do not coerce or partial-parse. [Source: ARCHITECTURE-SPINE.md#AD-8]
- **AD-6 hydrate/flush:** "client working copy hydrated on open, flushed on change; single user, no concurrency." Hydrate is a full replace, not a merge. [Source: ARCHITECTURE-SPINE.md#AD-6]
- **AD-9 layering:** downward-only imports; the fetch lives in `api/`, the store action in `store/`, the wiring in `App.tsx`. The store does not fetch; `useAutosave` is untouched.

### What already exists, do NOT rebuild

- **`server/app/storage/__init__.py`** — `_doc_dir` (containment), `_read_meta` (the EXACT template for `read_annotations`: JSON read → `CorruptMetadataError`, version mismatch → `UnsupportedSchemaError`, `ValidationError` → corrupt), `ANNOTATIONS_SCHEMA_VERSION`, `write_annotations` (the write mirror), the `StorageError` hierarchy. Add `read_annotations` + `CorruptAnnotationsError`; reuse everything else.
- **`server/app/routes/docs.py`** — `put_annotations` is a copy-ready template for `get_annotations` (same `responses` envelope refs, same `DocumentNotFoundError`→404 / `StorageError`→500 mapping). The Reserved docstring line to edit is at the top.
- **`client/src/api/client.ts`** — `envelopeError`, `fetchHealth`, `putAnnotations` are the idioms for `getAnnotations`.
- **`client/src/store/index.ts`** — the `create(temporal(...))` store; `temporal.getState().clear()` (zundo handle, already used by `useUndoRedo` + tests) is how you drop history; `partialize` tracks only `annotations` (so a hydrate `set` that also touches `selectedId`/`hoveredId`/`dragPreview` records at most one history entry, which `clear()` then wipes). Add `hydrate` alongside the existing actions; do not change any existing action.
- **`client/src/useAutosave.ts`** — the baseline/single-flight scheduler. UNTOUCHED. Its `mountedRef` baseline + `if (!docId) return` inertness are exactly what makes the hydrate-before-setDoc ordering safe. Read it, rely on it, don't edit it.
- **`client/src/App.tsx`** — `handleFile` (the open flow to edit), `useAutosave(doc?.doc_id ?? "")`, the load-error `Toast`. Add the two awaits + `hydrateStore`; reuse the existing catch/toast.
- **`AnnotationLayer` / `anchor/`** — already render marks from the store at any zoom (AR-4). Populating the store is ALL that restore needs; no render change (AC-2, AC-7).

### What must NOT change (guardrails)

- **No new mutation path, no autosave edit.** `hydrate` is the only addition; `useAutosave.ts` and every existing store action stay byte-identical (AC-7, AE-3).
- **Hydrate order is load-bearing** — hydrate the store BEFORE flipping `doc` to non-null (see the crux section). Do not move hydration into a Reader effect.
- **Reject, don't guess** on unknown `schema_version` / corrupt file (AC-3). No silent empty-set fallback for a corrupt file (that would be data loss framed as success — the exact NFR-4 failure).
- **`[]` is not an error** — an imported doc with no `annotations.json` restores empty via a 200, not a 404 (AC-1).
- **Bare list over the API; envelope on disk only** (H9).
- **No em-dash in any user-facing string** (the API detail strings are developer-facing, but grep the diff anyway). Contract regen via `export_openapi` → `gen:api`, never hand-authored. Mock barrels untouched (no `render/` export). AD-2 pinned deps.

### Project Structure Notes

New: `read_annotations` + `CorruptAnnotationsError` in `server/app/storage/__init__.py`; `get_annotations` route in `server/app/routes/docs.py`; `getAnnotations` in `client/src/api/client.ts`; `hydrate` action + `hydrateStore` export in `client/src/store/index.ts`; the two-await wiring in `App.tsx`. Edited (generated): `server/openapi.json` (gitignored), `client/src/api/schema.d.ts` (committed). Docs: `docs/API.md`, `client/src/store/README.md`. Version: `server/pyproject.toml` (+ `uv.lock`). Tests: `test_storage.py`, `test_docs.py`, `test_models.py`, `client/src/api/client.test.ts`(or existing), `store/index.test.ts`, `App.test.tsx`. No new layer, no new file needed beyond these edits.

### Testing standards

- Backend: `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q`. `tmp_path` + `monkeypatch.setenv("PAPER_MATE_DATA", ...)` (match the storage tests). To force the unknown-version/corrupt paths, write the bad `annotations.json` directly under the doc dir after importing.
- Frontend: `cd client && npm test` (Vitest from `client/`). The anti-clobber App test uses `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync` (wrap timer-driven state in `act()`, as the 3.4 `useAutosave` tests do). `npm run typecheck` must pass.
- **DPR ≥ 1.25 re-open live smoke is mandatory** (memory `verify-on-hidpi-and-real-host`): a real reload → re-open with a cross-page group, exact positions, no "Saving" flash on open. On your OWN fresh servers (CLAUDE.md).
- Cross-model Codex review on the diff (AE-6); High/Med resolved before done.

### Versioning

PATCH +1 when 3.5 reaches done: `0.2.6 -> 0.2.7`. Single source `server/pyproject.toml [project].version`. Bump once at PR merge.

### References

- [Source: .bmad/planning-artifacts/epics.md#Story-3.5] the 4 ACs (GET + hydrate keyed by id + render every mark; exact coords across zoom; unknown `schema_version` reject/migrate; nothing silently lost). FR-22, AR-6, AR-8, NFR-3, NFR-4.
- [Source: .bmad/implementation-artifacts/3-4-autosave-to-disk.md] the WRITE mirror this story reads back: `write_annotations` (disk envelope, atomic), the PUT route, `useAutosave` baseline/single-flight scheduler, and the DOCUMENTED clobber trap this story closes ("The READ half (hydrate-on-open) is Story 3.5 … do not cut a release between 3.4 and 3.5").
- [Source: ARCHITECTURE-SPINE.md#AD-6] durable backend truth, client working copy hydrated-on-open/flushed-on-change, single user no concurrency. #AD-7 one command path → dirty flag → debounced single-flight autosave (why hydrate must not dirty). #AD-8 storage layout, `annotations.json` = `{schema_version, annotations}`, reject/migrate unknown versions (this story's read-side reject).
- [Source: review-adversary.md#H9] disk envelope vs bare-list API body (the convention `read_annotations` strips).
- [Source: server/app/storage/__init__.py] `_read_meta` (the read template), `_doc_dir`, `ANNOTATIONS_SCHEMA_VERSION`, `write_annotations`, the `StorageError`/`UnsupportedSchemaError`/`CorruptMetadataError`/`DocumentNotFoundError` hierarchy. [server/app/routes/docs.py] `put_annotations` (the route template) + `get_doc_file` error→envelope mapping. [server/app/models.py] `Annotation` (+ `Anchor` union, `Rect`/`Point`/`Style`) — the GET response type, already emitted to OpenAPI by PUT.
- [Source: client/src/store/index.ts] `create(temporal(...))`, `partialize: {annotations}`, `temporal.getState().clear()`; the header comment (line ~12) to update. [client/src/useAutosave.ts] the baseline (`mountedRef`) + `if (!docId) return` inertness the ordering relies on. [client/src/api/client.ts] `envelopeError`/`putAnnotations` idiom. [client/src/App.tsx] `handleFile`, `useAutosave(doc?.doc_id ?? "")`, the load-error catch/Toast.
- [Source: docs/API.md#Reserved] the `GET …/annotations` row to promote; the PUT resource section + changelog format to mirror.
- [Source: CLAUDE.md] AP-1 document-level handlers (none added here); NO em-dash in user-facing strings; AD-2 pinned deps; contract regen flow (`export_openapi` → `gen:api`); versioning; "launch your OWN dev servers for live smoke"; render mock-barrel sync; AE-6 Codex review; AE-7 sandbox-pytest workaround.
- Memories: `verify-on-hidpi-and-real-host` (re-open at DPR>1 is the smoke that matters); `prefer-stable-solutions` (reuse `_read_meta`'s error taxonomy, the PUT route template, `temporal.clear()` — don't rebuild).

## Open Questions

> Each has a recommended default so work is not blocked.

1. **GET failure on open: block the open, or open with an empty store?** Recommended default: **block the open** (surface the existing "Couldn't open this file." toast, keep `doc` null). Opening empty would re-arm the 3.4 clobber (a later edit PUTs `[]` over the saved set) — the exact NFR-4 loss this story exists to prevent. Distinct copy (e.g. "Couldn't load your annotations.") is a nicety; reuse the single copy unless the PO wants a specific string.
2. **`schema_version` mismatch → 500 or 422?** Recommended default: **500** (`Could not read annotations`). It is a server-data fault the client cannot fix, mirroring `get_doc_file`'s corrupt→500. 422 implies a bad client request, which this isn't.
3. **Separate `CorruptAnnotationsError` vs reuse `CorruptMetadataError`?** Recommended default: **separate sibling** — annotations corruption is a distinct on-disk fault; a precise taxonomy keeps future logging/handling clean. Both map to 500 via `except StorageError`, so it costs nothing at the route.
4. **Distinct annotations-restore copy vs the single load copy?** Recommended default: **reuse the single "Couldn't open this file."** (the epic/UX specifies no distinct string; one open-failure surface is simpler). Revisit if the PO wants restore failures called out separately.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (bmad-dev-story).

### Debug Log References

- Backend: `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 UV_CACHE_DIR=/tmp/uv-cache uv run pytest -q` → 65 passed.
- Frontend: `cd client && npm run typecheck` clean; `npm test` → 524 passed (33 files).
- Contract regen: `python -m app.export_openapi` → `npm run gen:api`; diff additive (new GET operation only; `components.schemas` unchanged; `Annotation` + anchor/`Rect`/`Point`/`Style` still exported).
- Cross-model Codex review on the working-tree diff (AE-6): **No blocking findings.**

### Completion Notes List

- **Task 1** — `storage.read_annotations` added, modeled on `_read_meta`: `DocumentNotFoundError` (unresolvable / no `meta.json`), `[]` when no `annotations.json` (imported-but-unannotated), `UnsupportedSchemaError` on unknown `schema_version`, new `CorruptAnnotationsError` on unreadable JSON or wrong shape (non-list `annotations` or a member failing validation). Strips the H9 disk envelope → bare `list[Annotation]`. Reused `_doc_dir`/`_read_meta`/`ANNOTATIONS_SCHEMA_VERSION`; no second path resolver/version constant. `write_annotations`/`import_pdf`/`_atomic_write` untouched.
- **Task 2** — `GET /api/docs/{doc_id}/annotations` route (`response_model=list[Annotation]`, 404/500 envelope refs mirroring PUT); `DocumentNotFoundError`→404, `StorageError`→500 (`"Could not read annotations"`). Docstring: GET moved out of Reserved (list + detail stay reserved). Contract regenerated; `docs/API.md` promoted GET to a live resource + changelog line.
- **Task 3** — `getAnnotations` added to `api/client.ts` (bare list, envelope error on `!ok`). Store `hydrate` action (rebuild Map keyed by `id`, clear `selectedId`/`hoveredId`/`dragPreview`) + `hydrateStore` free fn (hydrate then `temporal.getState().clear()`). Header comment + `store/README.md` updated. `useAutosave.ts` untouched.
- **Task 4 (crux)** — `App.handleFile` now `uploadDoc` → `getAnnotations` → `hydrateStore(restored)` → `setDoc(opened)`, both awaits inside the existing try/catch. Hydrate runs while `doc` is null so `useAutosave` is inert; the restored set becomes the autosave baseline (never PUT back) and the temporal clear makes it the undo floor. A GET failure lands in the catch → stays S0, empty store, no clobber.
- **Task 5** — Backend: 6 storage + 4 route tests (round-trip, `[]`, 404, unknown-version 500/raise, corrupt/wrong-shape). `test_models.py` now asserts GET present on the annotations path. Frontend: `api/client.test.ts` (parse/`[]`/envelope-error/encoding); store hydrate + `hydrateStore` (Map keyed by id, transient cleared, zundo floor); `App.test.tsx` global `getAnnotations` spy added to `beforeEach`, plus the anti-clobber regression (restore → no PUT past debounce, Ctrl+Z no-op; a real edit → PUTs; GET-failure keeps reader closed).
- **Task 6** — Version `0.2.6 → 0.2.7` (`pyproject.toml` + `uv.lock`). Live re-open smoke on OWN fresh servers (uvicorn:8137 + vite:5237, throwaway data dir) at **DPR 1.5**: created a real CROSS-PAGE highlight (group across pages 0+1) + a single-page highlight → `annotations.json` written (envelope v1, 3 marks). Reloaded + re-opened the SAME PDF: GET fired once, **0 PUTs** (restore didn't dirty), all marks re-rendered, SaveIndicator never flashed "Saving", `Ctrl+Z` on open was a no-op (undo floor); a fresh edit after open PUT exactly once (baseline→dirty works). Synthetic doc lived in the throwaway dir; servers torn down.

### File List

- `server/app/storage/__init__.py` — `read_annotations` + `CorruptAnnotationsError`.
- `server/app/routes/docs.py` — `get_annotations` GET route + docstring.
- `server/openapi.json` — regenerated (gitignored).
- `client/src/api/schema.d.ts` — regenerated (committed): new GET operation.
- `client/src/api/client.ts` — `getAnnotations`.
- `client/src/store/index.ts` — `hydrate` action + `hydrateStore` export + header comment.
- `client/src/store/README.md` — persistence-boundary note.
- `client/src/App.tsx` — hydrate-before-setDoc open wiring.
- `docs/API.md` — GET resource section + changelog.
- `server/pyproject.toml`, `server/uv.lock` — version 0.2.7.
- Tests: `server/tests/test_storage.py`, `server/tests/test_docs.py`, `server/tests/test_models.py`, `client/src/api/client.test.ts` (new), `client/src/store/index.test.ts`, `client/src/App.test.tsx`.

## Change Log

- 2026-07-01: Implemented (status → review). `read_annotations` (+ `CorruptAnnotationsError`), `GET /api/docs/{doc_id}/annotations`, `getAnnotations`, store `hydrate`/`hydrateStore` (zundo floor), hydrate-before-setDoc open wiring. Contract regenerated (GET live, list/detail stay reserved); `docs/API.md` updated. Version 0.2.6 → 0.2.7. Backend 65 + frontend 524 tests green; Codex review clean; live DPR-1.5 re-open smoke confirmed restore with 0 spurious PUTs and undo floor.
- 2026-07-01: Story drafted (ready-for-dev). READ half of persistence and the close of 3.4's clobber trap: `storage.read_annotations` (envelope-strip + unknown-`schema_version`/corrupt reject, `[]` for unannotated), `GET /api/docs/{doc_id}/annotations` route, `getAnnotations` api, store `hydrate` action + `hydrateStore` (zundo history clear), and the hydrate-before-setDoc open wiring that makes restore a non-dirtying, non-undoable baseline. Contract regenerated (GET live, GET-list/detail stay reserved). Version 0.2.6 → 0.2.7.
