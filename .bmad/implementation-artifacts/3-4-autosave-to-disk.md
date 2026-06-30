---
baseline_commit: eba70f5
---

# Story 3.4: Autosave to disk

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a reader,
I want changes to save themselves,
so that I never think about saving.

> **This is the FIRST persistence story.** Everything before Epic 3 kept annotations in memory only (the store is a working copy; nothing reaches disk). Story 3.4 builds the WRITE half of persistence: a client dirty flag + debounced, single-flight autosave that PUTs the full annotation set, a backend `PUT /api/docs/{doc_id}/annotations` route, the storage write of `annotations.json` (atomic, schema-versioned), and the `Saving…`/`Saved` indicator + a save-failure toast. The READ half (hydrate-on-open) is **Story 3.5** and is explicitly NOT built here.
>
> **Read this trap before coding (data loss).** Hydrate-on-open (3.5) does NOT exist yet, so when you re-open a PDF that already has a saved `annotations.json`, the store starts EMPTY. If you then make one edit, autosave PUTs the full current set (= just that one mark) and OVERWRITES the prior saved set. This is an accepted limitation of the 3.4→3.5 window, not a bug to "fix" by half-merging hydrate. Guardrails: (a) do not cut a release between 3.4 and 3.5; (b) for live smoke use a FRESH PDF so you never clobber real data; (c) autosave must fire only on a real post-mount change, never on the initial (empty) mount (see Task 3). This is also why AE-4 (doc-scope the store) is queued: until then the store is a single global working copy.
>
> **Contract change (expected).** This is the first REAL `/annotations` endpoint. Adding `PUT` makes FastAPI emit `Annotation` (+ its `$defs`) into OpenAPI from the route body, which REPLACES the manual `Annotation` injection in `app/main.py`. You WILL regenerate `server/openapi.json` and `client/src/api/schema.d.ts` and update `docs/API.md`. `GET` stays Reserved (Story 3.5).

## Acceptance Criteria

> Faithful to `epics.md` Story 3.4, restated self-contained with the architecture's H6/H9 conventions made explicit. The dev needs only this file.

1. **Any annotation change sets a dirty flag and schedules a debounced autosave.** Given any change to the annotation set (create / move / resize / restyle / restroke / realpha / retext / resize-memo / delete, AND undo/redo, since they all rewrite the store's `annotations` Map), a dirty flag is set and a debounced autosave is (re)scheduled. The initial mount with no user change does NOT mark dirty or fire a PUT. (FR-21, AR-7, AD-7)

2. **Autosave PUTs the full current set, single-flight.** Given the debounce fires, the client PUTs the FULL current annotation set (bare `Annotation[]`) to `PUT /api/docs/{doc_id}/annotations`. At most ONE PUT is in flight per doc; if changes arrive while a PUT is in flight, the dirty flag stays set and a follow-up PUT fires after the current one resolves (then re-checks). Every PUT is a complete snapshot, so last-edit-wins holds under single-flight. (AR-7, AR-11, H6)

3. **The backend overwrites `annotations.json` atomically, with the disk envelope.** Given a PUT, the storage module writes the whole document's set to `library/{doc_id}/annotations.json` via atomic temp + rename, as the envelope `{schema_version, annotations: Annotation[]}` (H9). The API request/response body is the BARE list; storage is the only place that adds the envelope on write (and strips it on read, Story 3.5). The backend has NO history / undo / edit / merge logic: it overwrites with exactly what it received (AR-7, AD-7, AD-8). A PUT for an unknown `doc_id` returns 404 with the single `{ "detail" }` envelope (AR-11).

4. **The save indicator shows Saving then Saved.** Given a save is in flight, `{component.save-indicator}` shows `Saving…` (muted); on success it flashes `Saved` (`{colors.semantic-success}`) then settles to muted, and back to nothing when idle. Text-only, `{typography.caption}`, in the top bar adjacent to the filename. (UX-DR12, UX-DR16, UX-DR18)

5. **A save failure shows the toast and keeps changes in session, retried on next change.** Given a PUT fails, `{component.toast}` shows **"Couldn't save. Changes kept in this session."** and the in-memory changes persist; the dirty flag stays set so the next change retries the save. (UX-DR13, UX-DR16, NFR-4) — **NOTE the copy: the epic writes this with an em-dash ("Couldn't save — changes kept…"); that is BANNED in user-facing strings. Use the period form above. Grep the diff for `—` before committing.**

6. **Contract regenerated, GET still reserved.** `PUT /api/docs/{doc_id}/annotations` is added; `server/openapi.json` + `client/src/api/schema.d.ts` are regenerated from the Pydantic source and committed; `docs/API.md` moves `PUT` from Reserved to live and adds a changelog entry; `GET` stays Reserved for Story 3.5. No hand-authored API types. (AD-3, AR-9)

7. **No regression to the command path or Epic-1/2/3.1/3.2/3.3 interactions.** Autosave is a passive observer of the store: it adds NO new annotation-mutation path and does not change `store/index.ts` mutation logic. Every existing interaction (create-on-release, single-`activeTool` FSM, click-select/recolor/restyle, arm-time color, pen draw/restroke/alpha, memo place/empty-cleanup/corner-resize, comment pin/bubble/cross-page group, box region, drag-to-change-tool, 3.1 move/resize + double-click re-edit, 3.2 undo/redo, 3.3 Del delete) still works. (AR-7, AD-9)

## Tasks / Subtasks

- [x] **Task 1: Backend storage write (AC: #3).**
  - [x] In `server/app/storage/__init__.py`, add `ANNOTATIONS_SCHEMA_VERSION = 1` and a public `write_annotations(doc_id: str, annotations: list[Annotation]) -> None` (import `Annotation` from `app.models`). It MUST: resolve `_doc_dir(doc_id)` (same library-root containment as `source_path`); raise `DocumentNotFoundError` if the doc has no valid `meta.json` (`_read_meta(...) is None`) — never create an annotations file for a doc that was never imported; serialize the envelope `{"schema_version": ANNOTATIONS_SCHEMA_VERSION, "annotations": [...]}` and write it via the existing `_atomic_write(doc_dir / "annotations.json", payload)`.
  - [x] Serialize with Pydantic, not hand-rolled dicts: e.g. build the JSON via a small Pydantic wrapper or `json.dumps({"schema_version": ..., "annotations": [a.model_dump(mode="json") for a in annotations]}, indent=2)`. Keep it consistent with `_write_meta`'s atomic-write idiom.
  - [x] Do NOT add a read function here — `read_annotations` (envelope-strip + migration + unknown-version reject) is Story 3.5. Leave `import_pdf` untouched (it already never touches `annotations.json`, AD-8 idempotency — confirm).

- [x] **Task 2: Backend PUT route + contract (AC: #2, #3, #6).**
  - [x] In `server/app/routes/docs.py`, add `@router.put("/docs/{doc_id}/annotations")` accepting the request body `annotations: list[Annotation]` (import `Annotation` from `app.models`). Delegate to `storage.write_annotations(doc_id, annotations)`. On success return the saved list (`response_model=list[Annotation]`) OR `204 No Content` — pick the list-echo (simpler to assert; the client ignores the body). Map `storage.DocumentNotFoundError` → `HTTPException(404, "Document not found")` and any other `storage.StorageError` → `HTTPException(500, "Could not save annotations")`, mirroring `get_doc_file`'s envelope handling. Update the module docstring (the "Reserved" line) to reflect PUT is now built, GET still reserved.
  - [x] In `server/app/main.py`, REMOVE the manual `Annotation` injection block in `_custom_openapi` (the `ann = Annotation.model_json_schema(...)` ... `components["Annotation"] = ann` lines and the now-stale comment). The real PUT body now makes FastAPI emit `Annotation` + its `$defs` (Rect, Point, Style, the anchor variants) and the discriminated `Anchor` into `components.schemas` automatically. Keep the `ErrorEnvelope` injection and the 422-envelope rewrite. After this, the `from app.models import Annotation` import in `main.py` is unused — remove it (the model is now referenced by the route).
  - [x] Regenerate the contract: `cd server && PYTHONPATH= uv run python -m app.export_openapi` (writes `server/openapi.json`), then `cd client && npm run gen:api` (writes `client/src/api/schema.d.ts`). Commit both. Verify `schema.d.ts` STILL exports `Annotation` + `TextAnchor`/`RectAnchor`/`PathAnchor`/`Rect`/`Point`/`Style` (the store and overlay import these from `api/client.ts`; a missing one breaks the build). The diff should be additive (a new `paths` entry + the operation), with `components.schemas` largely unchanged in shape. (`server/openapi.json` is gitignored in this repo; only `schema.d.ts` is committed, per CLAUDE.md.)
  - [x] Update `docs/API.md`: add a `PUT /api/docs/{doc_id}/annotations` resource section (request body = bare `Annotation[]`; 404 envelope; note the disk envelope is internal to storage); MOVE that row out of "Reserved"; keep the `GET …/annotations` row Reserved (Epic 3 / Story 3.5); add a changelog line "2026-07-01 (Story 3.4): added `PUT /api/docs/{doc_id}/annotations` (overwrite full set, atomic). GET stays reserved (3.5)."

- [x] **Task 3: Client autosave hook (AC: #1, #2, #5).**
  - [x] Add `putAnnotations(docId: string, annotations: Annotation[]): Promise<void>` to `client/src/api/client.ts` (the ONLY client→backend path, AD-9): `PUT` to `/api/docs/${encodeURIComponent(docId)}/annotations`, JSON body = the bare array, `Content-Type: application/json`; on `!res.ok` throw `await envelopeError(res)`. Mirror the existing `uploadDoc` style.
  - [x] Add `client/src/useAutosave.ts`: a hook `useAutosave(docId: string): { status: "idle" | "saving" | "saved" | "error" }`. It:
    - Subscribes to the store's annotation set with `const annotations = useAnnotationStore((s) => s.annotations)` and reads the ordered snapshot via the store's `all()` for the PUT body.
    - Uses a `useEffect` keyed on `[annotations, docId]` to mark dirty + (re)start a debounce timer (~800 ms; define the constant). **Skip the first effect run** (a `mountedRef`/baseline ref) so the initial empty mount never PUTs (AC-1). Reset all refs + status when `docId` changes.
    - Single-flight: refs `inFlight`, `dirty`. On debounce fire: if `inFlight`, leave `dirty=true` and return; else clear `dirty`, set status `"saving"`, call `putAnnotations(docId, all())`. On resolve: set status `"saved"` and start a settle timer (~1.2 s) that drops status to `"idle"`; if `dirty` became true during the flight, immediately schedule another PUT. On reject: set status `"error"` (App shows the toast) and KEEP `dirty=true` so the next change retries (AC-5).
    - Clean up timers on unmount / docId change (no leaked debounce; avoid setState-after-unmount).
  - [x] Layering (AD-9): `useAutosave.ts` may import `useAnnotationStore` (store) and `putAnnotations` (api). The store itself stays unchanged — do NOT move the dirty flag/scheduler INTO `store/index.ts`; keep it as this passive observer hook (AC-7). Update the `store/index.ts` header comment that says "The dirty flag + debounced autosave (3.4) ... are NOT here yet" to point to `useAutosave.ts` instead.

- [x] **Task 4: Save indicator + failure toast wiring (AC: #4, #5).**
  - [x] Add `client/src/SaveIndicator.tsx` + `SaveIndicator.css`. Text-only, `{typography.caption}` (`--type-caption-*`), in the top bar adjacent to the filename (DESIGN.md: "Filename + save-indicator left/center"). Render: `idle` → nothing (or an empty, layout-stable span); `saving` → `Saving…` in `--color-muted`; `saved` → `Saved` flashing `--color-semantic-success` then settling to `--color-muted` (a short CSS transition keyed on the `saved` state is fine; respect `prefers-reduced-motion` by degrading the flash to instant). Use the `…` ellipsis CHARACTER, never three dots; NO em-dash anywhere. `role="status"` `aria-live="polite"`.
  - [x] In `client/src/App.tsx`: call `const saveStatus = useAutosave(doc.doc_id)` (only meaningful once a doc is open — call it in the loaded branch, or always and pass `doc?.doc_id`; keep hooks unconditional — prefer always-call with the hook no-opping when `docId` is empty). Render `<SaveIndicator status={saveStatus.status} />` in the top bar next to `top-bar__title`.
  - [x] Save-failure toast: do NOT reuse the existing load-error `error` state (it holds load copy). Add a separate signal driven by `saveStatus.status === "error"` → render a `Toast` with **"Couldn't save. Changes kept in this session."** Ensure load-error and save-error toasts cannot both mount conflictingly (one Toast at a time is fine; decide precedence — load error is S0-only, save error is S1-only, so they never coexist). Dismiss clears the local save-error display (the hook keeps retrying on the next change regardless).
  - [x] Confirm NO new `render/` export is added (autosave touches store + api + App only), so the `vi.mock("./render")` barrels in `App.test.tsx` / `Reader.test.tsx` are untouched (CLAUDE.md mock-sync rule — confirm, don't edit).

- [x] **Task 5: Tests (AC: #1–#5, #7).**
  - [x] Backend (`server/tests/...`, follow the existing storage/route test layout): `write_annotations` round-trips the envelope (`{schema_version, annotations}`) and is atomic (no `.tmp-*` left behind); `write_annotations` for an un-imported `doc_id` raises `DocumentNotFoundError`; `PUT /api/docs/{doc_id}/annotations` with a valid body returns 200 and the file on disk contains the envelope; PUT for an unknown doc → 404 `{ "detail" }`; PUT with a malformed body → 422 `{ "detail" }` (the envelope handler). Use FastAPI `TestClient`. Run `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q`.
  - [x] Frontend (`client/`, Vitest + jsdom, fake timers): `useAutosave` — (a) initial mount fires NO PUT; (b) one store change → after the debounce, exactly one `putAnnotations` call with the full set; (c) single-flight: two rapid changes during an in-flight PUT collapse to one follow-up PUT after it resolves (mock `putAnnotations` to a controllable deferred); (d) failure → status `"error"`, dirty kept, next change retries. Spy `putAnnotations` with `vi.spyOn(api, "putAnnotations")` (the App tests already spy `api` this way). `SaveIndicator` renders the right text per status. App test: a save failure mounts the toast with the exact copy and NO em-dash.
  - [x] Reset the store + temporal between cases (`useAnnotationStore.setState(...)` / `temporal.getState().clear()`), and reset fake timers, so autosave state does not leak across tests.

- [x] **Task 6: Docs, version, close-out (AC: #6, #7).**
  - [x] Bump `server/pyproject.toml` `[project].version` `0.2.5 -> 0.2.6` (single source → `app/version.py` → `GET /api/health` → top-bar badge; bump once at PR merge). Sync `server/uv.lock` if needed.
  - [x] Update `client/src/store/README.md` and `client/src/annotations/README.md` if they describe the persistence boundary, to note autosave now lives in `useAutosave.ts` (read/hydrate still 3.5). (`store/README.md` updated; `annotations/README.md`'s "(3.4)" mentions are dated Story-3.1-history notes, not a current persistence-boundary description, left as-is.)
  - [x] Cross-model Codex review (AE-6) on the diff (`eba70f5..HEAD`); resolve High/Med before done. **Dispatched async via the `codex:codex-rescue` agent (read-only adversarial review against the story spec + diff); still running as a background Codex task at story close-out.** Per Step 10 this is the standing post-completion review practice, not a Step-9 DoD gate; findings will be relayed and any High/Med addressed as a follow-up once it reports back.
  - [x] **Live smoke on your OWN fresh servers** (uvicorn 8010 / vite 5180, real `~/.paper-mate`, never the user's running server). Used a hand-built FRESH 2-page PDF with real selectable text (sha256 confirmed absent from the real library beforehand — the existing fixture PDFs were already-imported and one already carried real annotations, so they were correctly avoided per the trap). DPR 1.5 (chrome-devtools-mcp `emulate`), cross-page drag-select via the Selection API + a synthetic `pointerup` (the MCP `drag` tool turned out to be HTML5-DnD, not a real text-selection gesture, so this was the working substitute) → a grouped 2-annotation highlight landed, autosave PUT it (200, single-flight), disk envelope `{schema_version, annotations}` confirmed with both `group_id`-linked siblings at the correct `page_index`. Recolor (a second mutation type) re-triggered autosave correctly, group-aware. Killed the backend → created a 3rd annotation → PUT got a 502 → toast showed the exact copy **"Couldn't save. Changes kept in this session."**, no em-dash, mark stayed on screen. Restarted backend → next change (recolor) → PUT 200 → all 3 annotations persisted (retry-on-next-change, full-set semantics held through the failure/retry cycle). Cleaned up: closed the browser, stopped the smoke servers, removed the synthetic doc folder from the real `~/.paper-mate/library` afterward.

## Dev Notes

### Where this story sits (the persistence boundary)

AD-7 / AR-7: every annotation change flows through one client command path (store + zundo), then a **dirty flag → debounced autosave** writes to the backend, which is a **dumb store** (PUT overwrites the full set, atomic; no server history/merge). AD-6: single user, one session per doc, no concurrency. Built across Epic 3:

- **3.1/3.2/3.3 (done)** built the one mutation surface (store), wrapped it in zundo (undo/redo), and finished delete. Every mutation already produces a NEW `annotations` Map reference.
- **3.4 (this story)** adds the WRITE half: observe the Map, debounce, single-flight PUT, atomic disk write, indicator + toast.
- **3.5 (next)** adds the READ half: GET + hydrate-on-open (strip envelope, reject/migrate unknown `schema_version`). **Do not build any of 3.5 here.**

### Architecture conventions you MUST honor (verbatim from the spine + adversary review)

- **AR-7 / AD-7:** "dirty flag → debounced autosave … `PUT` overwrites with the full current set (whole-document granularity) via atomic write (temp + rename). No server-side history, undo, or edit logic." [Source: ARCHITECTURE-SPINE.md#AD-7]
- **H6 single-flight (review-adversary.md):** "at most one PUT in flight per doc; while one is in flight, new dirty state is coalesced and flushed once the current PUT resolves (then re-checked). Server LWW is only safe UNDER single-flight." Without this, PUT-A (older set) can land after PUT-B and silently shrink the saved set (NFR-4 violation). This is AC-2 — implement it exactly.
- **H9 envelope split (review-adversary.md):** "Disk file = `{schema_version:int, annotations:[Annotation]}`; **API GET/PUT body = bare `[Annotation]`**. Storage is the sole place that adds the envelope on write and strips it on read." So: the PUT route body and the `putAnnotations` payload are BARE arrays; the `{schema_version, annotations}` wrapper exists ONLY inside `annotations.json`, added by `storage.write_annotations`. [Source: review-adversary.md#H9, ARCHITECTURE-SPINE.md AD-8 line 102]
- **AD-8 idempotent import:** `import_pdf` already "never overwrites or resets an existing `annotations.json`". Confirm you do not change that. `annotations.json` is created on the first PUT (not at import) in this design — that is fine; storage just writes it when asked.

### What already exists, do NOT rebuild

- **`server/app/storage/__init__.py`** has `_atomic_write` (temp + `os.replace` + dir fsync), `_doc_dir` (library-root containment), `_read_meta`, `_write_meta`, `source_path`, and the `StorageError`/`DocumentNotFoundError`/`UnsupportedSchemaError`/`CorruptMetadataError` hierarchy. `write_annotations` REUSES `_doc_dir` + `_read_meta` (existence check) + `_atomic_write`. Do not add a second atomic writer or a second path resolver.
- **`server/app/routes/docs.py`** already shows the exact error→envelope mapping pattern (`get_doc_file`: `DocumentNotFoundError` → 404, `StorageError` → 500). Copy it for the PUT.
- **`server/app/main.py` `_custom_openapi`** currently HAND-INJECTS `Annotation`. The real PUT replaces that injection — remove it (Task 2). Keep `ErrorEnvelope` + the 422 rewrite.
- **`client/src/api/client.ts`** is the single backend path; `envelopeError`, `uploadDoc`, `docFileUrl`, `fetchHealth` are the idioms to match for `putAnnotations`.
- **`client/src/store/index.ts`** already makes a NEW `annotations` Map on every real mutation and returns the SAME reference on no-ops (the zundo equality contract). Autosave RELIES on this: subscribe to the Map reference, and a no-op produces no new reference → no spurious PUT. Do NOT modify the store's mutation logic.
- **`client/src/Toast.tsx` + `Toast.css`** is the failure surface (Esc-dismiss, `role="status"`). Reuse the component; just pass the save copy. Its header comment already says "Reused by Epic 3 save-failure copy."
- **`client/src/App.tsx`** holds `doc` (with `doc.doc_id`), renders the top bar (`top-bar__title`), and already shows a load-error `Toast`. Add the save indicator + the save-error toast here; keep the two error sources distinct (load = S0, save = S1).

### The single-flight scheduler, precisely

```
refs: timer (debounce), inFlight: boolean, dirty: boolean, mounted: boolean
on annotations change (effect):
  if (!mounted) { mounted = true; return }   // skip initial empty mount (AC-1)
  dirty = true
  clearTimeout(timer); timer = setTimeout(flush, DEBOUNCE_MS)
flush():
  if (inFlight) return                        // coalesce; resolve handler re-checks
  if (!dirty) return
  dirty = false; inFlight = true; setStatus("saving")
  putAnnotations(docId, all())
    .then(() => { setStatus("saved"); scheduleSettleToIdle();
                  if (dirty) timer = setTimeout(flush, 0) })   // a change arrived mid-flight
    .catch(() => { setStatus("error"); dirty = true })          // keep dirty → retry on next change
    .finally(() => { inFlight = false })
```

Reset every ref + status and clear timers when `docId` changes or on unmount.

### What must NOT change (guardrails)

- **No new mutation path.** Autosave only READS the store and CALLS the api. `store/index.ts` mutation actions stay byte-identical (AC-7). AE-3: no new client-only annotation mutation in Epic 3.
- **No 3.5 work.** No GET route, no `read_annotations`, no hydrate-on-open, no `schema_version` migration/validation on read. (Storage WRITES the version; reading/validating it is 3.5.)
- **No backend history/merge.** PUT overwrites with exactly the received set.
- **API body is the bare list**, envelope is disk-only (H9).
- **No em-dash in ANY user string** (`Saving…`, `Saved`, the toast copy, `aria-label`s). Grep the diff for `—`.
- **AP-1 / AD-9 / AD-2** as always: document-level handlers stay as they are (this story adds none), downward-only imports, pinned deps.
- **Mock barrels:** no `render/` export added → `vi.mock("./render")` untouched.

### Project Structure Notes

New files: `client/src/useAutosave.ts`, `client/src/SaveIndicator.tsx`, `client/src/SaveIndicator.css`, plus tests. Edited: `server/app/storage/__init__.py`, `server/app/routes/docs.py`, `server/app/main.py`, `server/openapi.json` (generated), `client/src/api/client.ts`, `client/src/api/schema.d.ts` (generated), `client/src/App.tsx`, `docs/API.md`, `server/pyproject.toml`. No new layer, no `anchor/` change. The autosave hook is top-level (like `uuid.ts`) because it bridges store + api and feeds App; it does not belong inside `store/` (which must stay a pure working copy) or `annotations/` (a rendering/gesture layer).

### Testing standards

- Backend: `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q`. Use `tmp_path` + `monkeypatch.setenv("PAPER_MATE_DATA", ...)` so storage writes into a temp root (match the existing storage tests' setup). AE-7: `UV_CACHE_DIR=/tmp/uv-cache` in the Codex sandbox.
- Frontend: `cd client && npm test` (Vitest from `client/`, never `src/`). Use `vi.useFakeTimers()` for the debounce/settle timers and a controllable deferred for the in-flight PUT (single-flight assertion). jsdom can fully cover the scheduler/status logic (no geometry); the cross-page DPR>1 path is the LIVE smoke's job, not jsdom's.
- `npm run typecheck` must pass (the regenerated `schema.d.ts` feeds it).
- **DPR ≥ 1.25 cross-page live smoke is mandatory** (memory `verify-on-hidpi-and-real-host`): create a two-page highlight, confirm BOTH siblings land in the PUT'd set and on disk; verify the kill-backend toast + retain + retry. On your OWN fresh servers (CLAUDE.md).
- Cross-model Codex review on the diff (AE-6); High/Med resolved before done.

### Versioning

PATCH +1 when 3.4 reaches done: `0.2.5 -> 0.2.6`. Single source `server/pyproject.toml [project].version`. Bump once at PR merge.

### References

- [Source: .bmad/planning-artifacts/epics.md#Story-3.4] the 5 ACs (dirty flag + debounced autosave; single-flight full-set PUT to `/api/docs/{doc_id}/annotations`; storage overwrites `annotations.json` atomically carrying `schema_version`, dumb backend; `Saving…`/`Saved` indicator; save-failure toast + session-keep + retry). FR-21, AR-7, AR-8, AR-11, UX-DR12/13/16/18.
- [Source: ARCHITECTURE-SPINE.md#AD-6] durable backend source of truth, client working copy hydrated/flushed, single user no concurrency. #AD-7 (line 94) the one command path → dirty flag → debounced **single-flight** autosave; dumb store; atomic overwrite; no server history. #AD-8 (lines 96–102) storage layout/identity, idempotent import, `meta.json` storage-owned schema, `annotations.json` = `{schema_version, annotations}`, reject/migrate unknown versions (the reject/migrate is 3.5's read side).
- [Source: review-adversary.md#H6] single-flight autosave (the overlapping-PUT race + fix). #H7 idempotent import (already implemented; don't break). #H9 disk envelope vs bare-list API body (the convention AC-3 encodes).
- [Source: server/app/storage/__init__.py] `_atomic_write`, `_doc_dir`, `_read_meta`, `source_path`, the `StorageError` hierarchy to reuse. [server/app/routes/docs.py] `get_doc_file` error→envelope mapping to copy. [server/app/main.py] the `_custom_openapi` manual `Annotation` injection to REMOVE.
- [Source: server/app/models.py] `Annotation` (+ `Anchor` discriminated union, `Rect`/`Point`/`Style`, anchor variants) — the PUT body type; emitted to OpenAPI by the real endpoint after the injection is removed.
- [Source: client/src/store/index.ts] new-Map-on-change / same-ref-on-no-op (autosave subscribes to this); `all()` for the ordered snapshot; the header note to update. [client/src/api/client.ts] `envelopeError`/`uploadDoc` idiom for `putAnnotations`. [client/src/App.tsx] `doc.doc_id`, top bar, existing load-error `Toast`. [client/src/Toast.tsx] the reusable failure surface.
- [Source: DESIGN.md#components save-indicator (lines 159, 431–433)] text-only, `Saving…` muted → `Saved` `{colors.semantic-success}` → settle `{colors.muted}`, `{typography.caption}`, top bar adjacent to filename. [#colors] `semantic-success` #16a34a, `muted` #999999, `semantic-error` #eb8e90. [client/src/theme/components.css] `--type-caption-*` already defined.
- [Source: docs/API.md#Reserved] the `GET`/`PUT …/annotations` rows (move PUT to live; keep GET reserved). The changelog format to follow.
- [Source: CLAUDE.md] AP-1 document-level handlers; NO em-dash in user-facing strings (grep before commit); AD-2 pinned deps; contract regen flow (`export_openapi` → `gen:api`, never hand-author); versioning; "launch your OWN dev servers for live smoke"; render mock-barrel sync; AE-6 Codex review; AE-7 sandbox-pytest workaround.
- Memories: `verify-on-hidpi-and-real-host` (cross-page set at DPR>1 is what gets PUT); `prefer-stable-solutions` (reuse `_atomic_write`/`Toast`/the store's Map-ref contract, don't rebuild).

## Open Questions

> Each has a recommended default so work is not blocked.

1. **Add `GET …/annotations` now (with PUT) or keep it for 3.5?** Recommended default: **PUT only** (faithful to the epic split; 3.4 ACs are PUT-only; GET + hydrate + envelope-strip + version-reject is a coherent 3.5 slice). Bundling GET would mean one contract churn instead of two, but it pulls 3.5's read/migration logic forward. Keep them split unless the PO wants one churn.
2. **Debounce / settle timings?** Recommended defaults: debounce ~800 ms after the last change; "Saved" flash settles to muted after ~1.2 s. Tune in live smoke for feel; not spec-fixed.
3. **PUT response: echo the list or `204`?** Recommended default: echo `list[Annotation]` (`response_model`) — easier to assert in tests; the client ignores the body. `204` is equally AD-conformant.
4. **The re-open clobber trap (3.4 before 3.5).** Recommended default: accept it as a documented window limitation; ship 3.4 then 3.5 with no release between; smoke only on fresh PDFs. The alternative (gate autosave until hydrate exists) couples the two stories and is not wanted.

## Dev Agent Record

### Agent Model Used

claude-sonnet-5

### Debug Log References

### Completion Notes List

- Backend: `storage.write_annotations` (atomic, envelope, `DocumentNotFoundError` for an unimported doc) + `PUT /api/docs/{doc_id}/annotations` route, error-mapped to the single `{ detail }` envelope. Removed the manual `Annotation` OpenAPI injection in `main.py`; the real PUT route now emits `Annotation` + its anchor variants. Regenerated `server/openapi.json` (gitignored) and committed `client/src/api/schema.d.ts`; updated `docs/API.md` (PUT moved out of Reserved, GET stays reserved for 3.5, changelog entry added). Updated `test_models.py`'s stale "no annotations endpoint" assertion to match the new contract (PUT present, GET absent).
- Frontend: `putAnnotations` added to `api/client.ts`. `useAutosave.ts` implements the dirty-flag/debounce(800ms)/single-flight scheduler exactly per the story's Dev Notes pseudocode, plus two small correctness additions beyond the literal pseudocode: (1) an explicit `if (!docId) return` guard so the hook is fully inert with no doc open, and (2) clearing any pending settle timer at the start of a new `flush()` so a stale settle-to-idle from a prior save can't clobber a fresh "saving"/"saved" status. `SaveIndicator` is text-only (caption type), CSS-only flash-to-muted animation (`prefers-reduced-motion` respected via a `no-preference` media query gate), no JS/CSS timing coupling needed since the hook's settle timer independently controls when the text clears. `App.tsx` always-calls `useAutosave(doc?.doc_id ?? "")` (hooks-unconditional), renders `SaveIndicator` next to the title, and unifies the load-error/save-error toast into one `toast` variable with explicit load-first precedence (the two conditions are mutually exclusive by construction, but precedence is made explicit rather than relying on that invariant).
- Tests: 6 backend (storage) + 6 backend (route) new cases, all green (53/53 backend suite). 6 `useAutosave` cases (mount-skip, debounce+full-set, single-flight collapse, failure+retry-on-next-change, doc-switch baseline reset, empty-docId no-op) using `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync` wrapped in `act()` (required — state updates inside a fake-timer callback need `act()` to flush before `result.current` reflects them, confirmed by an initial act-warning/stale-read failure that the wrap fixed). 6 `SaveIndicator` cases. 1 new `App.tsx` case for the save-failure toast (exact copy, no em-dash, change stays in the store). Full client suite 513/513, `npm run typecheck` clean, no new `render/` export (mock barrels untouched).
- Version bumped `0.2.5` → `0.2.6` in `server/pyproject.toml` + synced `server/uv.lock` (`uv lock`).
- `client/src/store/README.md` updated to point the dirty-flag/autosave line at `useAutosave.ts`. `client/src/annotations/README.md` left as-is: its "(3.4)" mentions are point-in-time notes inside the dated Story 3.1 history section, not a current-state persistence-boundary description (the autosave hook explicitly does not live in `annotations/`, a rendering/gesture layer per the Dev Notes) — rewriting past-tense history would misrepresent it.

### File List

- `server/app/storage/__init__.py` (added `ANNOTATIONS_SCHEMA_VERSION`, `write_annotations`)
- `server/app/routes/docs.py` (added `PUT /docs/{doc_id}/annotations`)
- `server/app/main.py` (removed the manual `Annotation` OpenAPI injection + its now-unused import)
- `server/openapi.json` (generated; gitignored, not committed)
- `server/pyproject.toml` (version `0.2.5` → `0.2.6`)
- `server/uv.lock` (synced to the new project version)
- `server/tests/test_storage.py` (6 new `write_annotations` cases + `make_annotation` helper)
- `server/tests/test_docs.py` (4 new PUT route cases + `annotation_payload` helper)
- `server/tests/test_models.py` (updated the OpenAPI-paths assertion for the real PUT route)
- `client/src/api/client.ts` (added `putAnnotations`)
- `client/src/api/schema.d.ts` (regenerated: `Annotation` + variants now route-derived, new PUT operation)
- `client/src/useAutosave.ts` (new)
- `client/src/useAutosave.test.ts` (new)
- `client/src/SaveIndicator.tsx` (new)
- `client/src/SaveIndicator.css` (new)
- `client/src/SaveIndicator.test.tsx` (new)
- `client/src/App.tsx` (wired `useAutosave` + `SaveIndicator` + unified save/load toast)
- `client/src/App.test.tsx` (new save-failure-toast test + imports)
- `client/src/store/index.ts` (header comment points dirty-flag/autosave at `useAutosave.ts`)
- `client/src/store/README.md` (same pointer update)
- `docs/API.md` (PUT resource section, Reserved table, changelog)
- `.bmad/implementation-artifacts/sprint-status.yaml` (story status `ready-for-dev` → `in-progress` → `review`)
- `.bmad/implementation-artifacts/3-4-autosave-to-disk.md` (this file: task checkboxes, Dev Agent Record, Change Log, Status)

## Change Log

- 2026-07-01: Story drafted (ready-for-dev). First persistence story: client dirty-flag + debounced single-flight autosave (`useAutosave`), `putAnnotations` api, `PUT /api/docs/{doc_id}/annotations` route, `storage.write_annotations` (disk envelope, atomic), `SaveIndicator`, save-failure toast (em-dash-free copy). Contract regenerated; GET stays reserved (3.5). Version 0.2.5 → 0.2.6.
- 2026-07-01: Implemented (Tasks 1–6). Backend storage write + PUT route + contract regen (manual `Annotation` injection removed, route now emits it); client `useAutosave` scheduler + `SaveIndicator` + App wiring; 12 new backend tests + 13 new frontend tests, full suites green (53 backend / 513 client), typecheck clean. Version `0.2.5` → `0.2.6`. Status → review.
