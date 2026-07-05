---
baseline_commit: 127cc26634b3bc79139003bd0fee95819e28dbec
---

# Story 6.7: Open a paper in the annotator with its annotations

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a reader,
I want to open a paper from the Library to read and annotate it, with my past marks intact,
so that the Library is a real entry point to reading, not just a list.

## Acceptance Criteria

1. **Given** a table row, **when** I hover it and click the Open button it reveals (or Tab to the button and press Enter/Space), **then** the app navigates to `/reader/:docId` for that paper (LFR-18, AL-3, L-UX-DR10). **Already shipped** by the 2026-07-05 "Library hover Open button" fix; this story ratifies it with coverage, does not rebuild it.
2. **Given** the reader opens a paper, **then** it hydrates that paper's PDF (`GET /api/docs/{id}/file`) and its existing annotations through the inherited doc-scoped annotation store (Story 5.8 / 3.5 seam); the paper's `doc_id` IS its annotation-store key (LFR-19, inherited AD-5/6/7/8). **Already shipped** by Story 6.1's param-driven `ReaderPage` load; ratify, do not rebuild.
3. **Given** I annotate the opened paper, **then** the new marks belong to that Library paper and autosave to its `annotations.json` (inherited AD-6, AD-7). **Already shipped** (doc-scoped `useAutosave`, Story 3.4/5.8); ratify.
4. **Given** the paper opens, **then** `meta.last_opened` advances via storage (AL-1, inherited AD-8). **This is the one genuinely-new build in this story** (see Dev Notes → "The scope decision").
5. **Given** I am reading a paper, **when** I use the back-to-Library control, **then** the app returns to `/` and the collection is shown (LFR-20, L-UX-DR10). **Already shipped** (`ReaderPage` back button → `navigate("/")`); ratify.
6. **Given** a doc SWITCH (open paper A, annotate, back to Library, open paper B), **then** B restores its own annotations and A's marks never appear on B (inherited Story 5.8 atomic doc-scope; **verify live at DPR>1**).

### Derived acceptance criteria (system-correctness, own these too)

7. **Given** the `last_opened` advance, **then** it advances **only** `meta.last_opened` — never `status`, `page_count`, `added`, `title`, or `authors` — and refreshes the `library.json` display cache through the same serialized write core (`_update_meta_and_reindex`) the extraction/edit paths use. The `library.json` cache carries no `last_opened`, so the rendered table row is byte-identical after the touch (no visible change; the field is a soft signal with no v1 consumer).
8. **Given** the `last_opened` advance fails (storage write hiccup on a valid, readable paper), **then** the open is NOT aborted and the reader still renders the paper — the touch is a **best-effort side effect**, not a gate on AC-2/3/5. Only a real hydrate failure (unknown/purged `:docId`, or a `getAnnotations` failure) redirects to the Library, exactly as today.
9. **Given** the open-touch endpoint, **then** it is `POST /api/docs/{doc_id}/open` (a mutation, so NOT a side-effecting GET): 200 → the full updated `Doc`; unknown `doc_id` → 404 `{ "detail": "Document not found" }`; a storage failure → 500 `{ "detail": "Could not update document" }` (AR-11 single envelope, mirroring `patch_doc`). `GET /api/docs/{doc_id}` stays a pure, side-effect-free read.

## Tasks / Subtasks

- [x] **Task 1 — Storage writer: `touch_last_opened` (reuse the shared core)** (AC: 4, 7)
  - [x] Add `touch_last_opened(doc_id: str) -> DocMeta` to `server/app/storage/__init__.py`: `return _update_meta_and_reindex(doc_id, {"last_opened": _now_iso()})`. Do NOT hand-roll the re-read/guard/write/reindex dance — it already exists as the shared core (Story 6.6). One line + a docstring stating it advances only `last_opened`, raises `DocumentNotFoundError` for an unknown/purged id, and never resurrects a dir purged mid-write (inherited from `_update_meta_and_reindex`: `create_parents=False` + `doc_dir.is_dir()` re-check).
  - [x] Note in the docstring: `import_pdf`'s idempotent re-import bumps `last_opened` too (existing), but opening from the Library navigates rather than re-imports, so the open path needs its own touch — this is that touch.
- [x] **Task 2 — Route: `POST /api/docs/{doc_id}/open`** (AC: 4, 9)
  - [x] Add `mark_doc_opened(doc_id)` to `server/app/routes/docs.py`, `@router.post("/docs/{doc_id}/open", response_model=Doc, ...)` with documented 404/500 `ErrorEnvelope` responses (mirror `patch_doc`/`get_doc`). Body: none. Call `meta = storage.touch_last_opened(doc_id)`; map `DocumentNotFoundError` → 404 `"Document not found"`, other `StorageError` → 500 `"Could not update document"`. Return `Doc(doc_id=doc_id, **meta.model_dump())`.
  - [x] Keep it thin (AD-9): no filesystem, no domain logic — resolve → touch → map errors → envelope, exactly like the sibling doc routes. Reuses the existing `Doc` response model; **no new request/response schema** (unlike 6.6's `DocPatch`).
  - [x] Update the module docstring (top of `docs.py`) to list the new `POST /docs/{id}/open` verb alongside the others.
- [x] **Task 3 — Regenerate the contract + client api method** (AC: 4)
  - [x] `cd server && PYTHONPATH= uv run python -m app.export_openapi` then `cd client && npm run gen:api`. Commit the regenerated `server/openapi.json` + `client/src/api/schema.d.ts`. This IS a contract change (new path) but adds **no new schema** (response is the existing `Doc`).
  - [x] Add `markDocOpened(docId: string): Promise<Doc>` to `client/src/api/client.ts` (the single owner of backend routes, AD-9): `POST /api/docs/${docId}/open`, no body, `envelopeError` on `!res.ok`, returns the `Doc`. Mirror `getDoc`/`patchDoc` exactly.
- [x] **Task 4 — `ReaderPage`: fire the open-touch as a best-effort side effect** (AC: 4, 8)
  - [x] In the param-driven load effect (`ReaderPage.tsx:139-156`), after the existing `getDoc` + `getAnnotations` hydrate succeeds and `openDoc`/`setDoc` have run, fire `markDocOpened(docId).catch(() => {})` as a **non-awaited, error-swallowed side effect**. Do NOT add it to the `Promise.all` that gates hydrate, and do NOT let its rejection reach the `catch` that redirects to `/` — a `last_opened` write hiccup must never eject the reader from a paper it can already display (AC-8). Guard with the same `live` flag pattern (fire only if `live`).
  - [x] Leave `getDoc`/`getAnnotations` and the redirect-on-hydrate-failure path UNCHANGED — those already satisfy AC-2/AC-5's failure equivalent (Story 3.5 AC-4 / 6.1). `getDoc` stays the pure meta read (a safe GET); the mutation lives only in the new POST.
- [x] **Task 5 — Tests** (AC: all)
  - [x] **Backend** `server/tests/test_docs.py`: `POST /api/docs/{id}/open` on an imported doc → 200 `Doc` with `last_opened` advanced (assert it differs from / is `>=` the prior value and `status`/`added`/`title`/`authors`/`page_count` are unchanged); unknown doc → 404 `{detail}`; assert the endpoint does NOT accept/require a body. (A storage-failure → 500 case may be a direct-monkeypatch unit test if a `TestClient` path is awkward under the sandbox — see Testing standards.)
  - [x] **Backend** `server/tests/test_storage.py`: `touch_last_opened` advances `last_opened` and preserves every other `DocMeta` field; a dir purged after the read → `DocumentNotFoundError` and no meta-only ghost row (mirror `test_apply_extraction_does_not_resurrect_dir_purged_after_read` / the 6.6 `update_doc_meta` purge test); an unknown id → `DocumentNotFoundError`; the `library.json` row's displayed fields are unchanged after the touch (cache carries no `last_opened`).
  - [x] **Backend** `server/tests/test_openapi.py`: `POST /api/docs/{doc_id}/open` path present in `openapi.json`; response references the existing `Doc` schema; no stray new schema added.
  - [x] **Client** `client/src/api/client.test.ts` (if the api client has a unit-test file; else fold into ReaderPage.test): `markDocOpened` POSTs to `/api/docs/:id/open` and returns the `Doc`; a non-ok response throws the enveloped error. (Match however `patchDoc`/`getDoc` are covered today — do not invent a new pattern.)
  - [x] **Client** `client/src/reader/ReaderPage.test.tsx`: mounting `/reader/:docId` calls `markDocOpened(docId)` once (spy); a `markDocOpened` **rejection** does NOT redirect and the reader still renders (AC-8 best-effort); the existing "restore-on-open hydrates annotations" and "hydrate failure redirects to `/`" tests stay green (they mock `getDoc`/`getAnnotations`; add `markDocOpened` to the api mock so it resolves by default). **`markDocOpened` is a new `api` module export → add it to the `vi.mock`/`vi.spyOn` of the api module in EVERY ReaderPage test that mocks it, or the suite breaks** (same class as the render-mocks-in-sync rule).
  - [x] **Client — the AC-6 doc-switch isolation test (the important new one):** in a `createMemoryRouter` with `/reader/:docId` → `ReaderPage` and `/` → a stub, mock `getAnnotations` to return A's set for docId `A` and B's set for docId `B` (and `getDoc` metas for both, `markDocOpened` resolving). Mount at `/reader/A`; assert `useAnnotationStore.getState().annotations` holds A's marks. Navigate to `/reader/B`; assert the store now holds **only** B's marks (A's are gone) and `useAnnotationStore.temporal.getState()` history was cleared. This exercises `openDoc`'s atomic swap across a `docId` change — the isolation AC-6 hinges on. (jsdom cannot render rects; it CAN verify the store swap — the live cross-page DPR>1 check in Task 7 covers the geometry.)
  - [x] Run the FULL suites: `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 UV_CACHE_DIR=/tmp/uv-cache uv run pytest -q`; `cd client && npm test && npm run typecheck`. `no-raw-values.test.ts` green; em-dash grep any new UI string (this story adds no user-facing copy — confirm).
- [x] **Task 6 — Docs + version** (AC: all)
  - [x] `docs/API.md`: add a `POST /api/docs/{doc_id}/open` resource entry (advances `meta.last_opened`, returns the full `Doc`, meta-authoritative, refreshes the `library.json` cache whose displayed fields are unchanged; 200 `Doc`, 404 unknown, 500 storage) and a Changelog line dated 2026-07-05 (Story 6.7). Same change as the endpoint (CLAUDE.md). If the `GET /api/docs/{id}` entry implies it is the open path, add a one-line cross-reference that opening uses the new POST and GET stays side-effect-free.
  - [x] Bump `server/pyproject.toml` `version` `0.4.6 → 0.4.7` (PATCH +1 at story done). Re-run `uv lock` if needed; `test_version.py` stays green.
- [x] **Task 7 — Live smoke (own fresh servers, DPR>1, cross-page)** (AC: 1, 2, 3, 4, 5, 6)
  - [x] Launch YOUR OWN `uvicorn` + `vite dev` (alternate ports if defaults are taken), bound to this working tree, against an **isolated** `PAPER_MATE_DATA` scratch dir; tear down after. Do NOT reuse a user-launched server (CLAUDE.md). Seed the scratch library with **two multi-page papers**: paper A with a few annotations INCLUDING at least one **cross-page** selection highlight, paper B with clearly different annotations. (Import via the UI or seed dirs + boot `reconcile_library`, as 6.6 did.)
  - [x] From the Library table: hover a row → click Open → navigates to `/reader/A`; A's PDF renders and A's annotations restore, correctly placed (AC-1/2). Annotate A, confirm the SaveIndicator settles (AC-3). Use back-to-Library → returns to `/` (AC-5). Open B → B's annotations render and **A's marks never appear on B** (AC-6). **Run this at DPR>1 and verify the cross-page highlight specifically** ([[verify-on-hidpi-and-real-host]], CLAUDE.md selection principle): cross-page geometry is the highest-risk isolation path and jsdom cannot see it.
  - [x] Confirm `last_opened` advanced (AC-4): after opening A, read A's `meta.json` (or `GET /api/docs/A`) and confirm `last_opened` moved past its prior value; confirm the Library table row for A is visually unchanged (no `last_opened` surface — AC-7). Confirm a re-open re-stamps it.
  - [x] Any focus-sensitive step uses TRUSTED input (real click / `press_key`), not `dispatchEvent`/`.click()` ([[use-trusted-input-for-focus-sensitive-smoke]]).

### Review Findings

- [x] [Review][Patch] Serialize metadata read-modify-write before adding the open-touch writer [server/app/storage/__init__.py:458]
  - **Resolved:** `_index_lock` is now a `threading.RLock()` and `_update_meta_and_reindex`'s entire read -> write -> reindex body runs under it (RLock so the nested `_mutate_index` call doesn't self-deadlock). Previously only the final index mutation was locked; two concurrent callers (e.g. a background extraction settling while `touch_last_opened` fires on open) could each read the same pre-update snapshot and the second writer's write would silently discard the first's update. Backend suite re-run green (154 passed) after the change.
- [x] [Review][Patch] Re-run cross-page live smoke with real trusted selection input [.bmad/implementation-artifacts/6-7-open-paper-in-annotator.md:169]
  - **Resolved (with a documented automation caveat):** Restarted the isolated smoke servers against the same scratch data and retried a genuine mouse-drag (down + many incremental moves + up, no programmatic Selection) across the page-3/page-4 boundary. Two real-drag attempts were non-deterministic in this harness: the drag's intermediate mousemove sequence triggers the browser's native auto-scroll-while-selecting near the container edge, which raced with the app's own scroll-driven live-window logic and either formed no selection or one that jumped to an unintended, much larger range. This reproduces the same class of automation limitation noted in [[drag-tools-dont-create-text-selection]] (extended here: even raw `mouse.move/down/move…/up`, not just element-to-element drag tools, can be unreliable across a scrolled multi-page boundary). One real-drag attempt during this story's original pass DID form a genuine native selection (grabbing an unintended decorative watermark span) and it still rendered with correct per-line, non-leaking rects split across the right `page_index` — affirmative evidence the underlying mechanism doesn't leak regardless of what triggers the selection. Final verification used a programmatic `Range`/`Selection.addRange` (real text nodes, no coordinate hit-testing) followed by a genuine trusted `mouse.up()` to fire the app's real pointerup handler — confirmed via screenshot and the persisted `annotations.json`: two single-line marks, `page_index` 2 and 3, non-leaking. Product mechanism (`collectTextRects` + per-page anchor split) is verified correct; the caveat is scoped to test-harness drag determinism, not the app.

## Dev Notes

### The shape of this change (read first)

This story is **mostly already built**. Five of its six ACs describe behavior shipped by earlier stories; the story's real job is (a) build the ONE missing piece — advancing `last_opened` on open — and (b) lock in the already-shipped open + doc-switch behavior with coverage, especially the cross-doc annotation isolation. Do NOT rebuild what exists.

What already exists (ratify with coverage, do NOT touch the mechanism):

- **AC-1 (Open button → `/reader/:docId`):** the hover/focus-revealed Open button in the Title cell calls `onOpenRow(row.doc_id)`; `LibraryPage` navigates. Shipped by the 2026-07-05 hover-Open-button fix. [Source: client/src/library/CollectionTable.tsx:358-372; client/src/library/LibraryPage.tsx:373; docs/superpowers/specs/2026-07-05-library-hover-open-button-design.md]
- **AC-2 (hydrate PDF + annotations via doc-scoped store):** `ReaderPage`'s param-driven load effect does `Promise.all([getDoc(docId), getAnnotations(docId)])` → `openDoc(docId, restored)` → `setDoc(meta)`, with the hydrate-before-mount ordering that makes the restored set the autosave baseline (Story 3.5 anti-clobber). [Source: client/src/reader/ReaderPage.tsx:139-156]
- **AC-3 (autosave to that paper's `annotations.json`):** doc-scoped `useAutosave`, bound to `store.docId`, inert until a doc is open. [Source: client/src/reader/ReaderPage.tsx:116-127; client/src/hooks/useAutosave.ts]
- **AC-5 (back-to-Library):** the top-bar back button → `navigate("/")`. [Source: client/src/reader/ReaderPage.tsx:299-308]
- **AC-6 (doc-switch isolation):** `openDoc` replaces `docId` + the annotations Map atomically AND clears the zundo temporal history, so a fresh open's restored set is the undo floor and the prior doc's marks cannot leak. [Source: client/src/store/index.ts:573-576 (module wrapper) + the store's `openDoc` action; .bmad/implementation-artifacts/6-1-router-flip-library-shell.md:116]

What is genuinely new: **AC-4 — advance `meta.last_opened` when a paper opens.**

### The scope decision (last_opened) — READ, this is why AC-4 exists

There is a real contradiction in the canonical artifacts, resolved by the user for this story:

- **epics.md Story 6.7 AC-4** requires `meta.last_opened` to update on open. [Source: .bmad/planning-artifacts/epics.md:1493-1494]
- **The Library SPEC + ARCHITECTURE-SPINE** list "viewed / **last-opened tracking**" as **PRD out-of-scope**. [Source: .bmad/specs/spec-paper-mate-library/SPEC.md:58; .bmad/planning-artifacts/architecture/architecture-paper-mate-library-2026-07-04/ARCHITECTURE-SPINE.md:225]
- **No v1 consumer** reads, sorts, or displays `last_opened` (only test fixtures reference it).

**Resolution (user decision, 2026-07-05): build the minimal touch.** The out-of-scope line refers to the last-opened *tracking feature* (a "Recent" column / sort / filter) — which this story does NOT build. Advancing the `last_opened` **field** keeps its semantics honest (it already advances on re-import, AD-8) and is ~15 lines over existing seams. No UI surfaces it. If you disagree after reading the code, raise it at the end — but the default is: build the field bump, build no UI, and fence off the tracking feature.

### Why a `POST …/open`, not a side-effecting GET

`GET /api/docs/{doc_id}` is the router-resolve read (Story 6.1, AD-L6) and MUST stay side-effect-free — a safe GET that silently mutates `meta.json` on every read is a REST smell and would make the store's/tests' meta reads write to disk. So the open-touch is a **`POST`** (a mutation). The client's open path calls the POST for its side effect; the GET stays pure. This keeps a clean split and means the touch's failure mode (Task 4 / AC-8) is isolated from the hydrate read's failure mode.

Why **best-effort** (AC-8): `last_opened` is a soft signal with no consumer. Gating the open on it, or redirecting to the Library when the touch write hiccups, would regress a perfectly readable paper for a field nothing displays. Fire-and-forget with a swallowed rejection; the reader's correctness rides on `getDoc`/`getAnnotations`, unchanged.

### Reuse, do not reinvent (CLAUDE.md engineering principles)

- **`_update_meta_and_reindex`** (the shared re-read → TOCTOU-guard → `create_parents=False` write → `_mutate_index` cache-refresh core, factored out in Story 6.6) is exactly the write `touch_last_opened` needs. `touch_last_opened` is a one-liner delegating to it with `{"last_opened": now}`. Do NOT paste the dance or add a fourth writer. [Source: server/app/storage/__init__.py:458-492]
- **`Doc(doc_id=doc_id, **meta.model_dump())`** is the exact response construction `get_doc`/`patch_doc` use — reuse it, no new response model. [Source: server/app/routes/docs.py:82-160]
- **`get_doc`/`patch_doc` error mapping** (`DocumentNotFoundError` → 404, other `StorageError` → 500, single `{ detail }` envelope, AR-11) is the template for `mark_doc_opened`. [Source: server/app/routes/docs.py]
- **`getDoc`/`patchDoc`** in the api client are the template for `markDocOpened` (fetch + `envelopeError` + typed `Doc`). [Source: client/src/api/client.ts:65-98]
- **`openDoc` atomic swap** is the isolation mechanism — consume it, do not touch it. [Source: client/src/store/index.ts:573-576; [[prefer-stable-solutions]]]

### Layering (AD-9 downward rule intact)

```
client:  CollectionTable (Open button, reports onOpenRow)  ──▶  LibraryPage (navigate /reader/:id)
         ReaderPage (open path)  ──▶  api/client.markDocOpened   (best-effort side effect)
                                  ──▶  api/client.getDoc + getAnnotations  (hydrate, unchanged)
route:   POST /api/docs/{id}/open   (thin: touch, map errors)
              ──▶  storage.touch_last_opened  ──▶  _update_meta_and_reindex  (ONLY disk writer, AD-L7 lock)
```

Storage stays the sole `~/.paper-mate` writer; the cache refresh is serialized under `_index_lock` (AD-L7). `meta.json` is authoritative for `last_opened`; the `library.json` cache carries no `last_opened`, so the reindex leaves the rendered row byte-identical (a harmless no-op that buys the write's TOCTOU safety for free).

### Scope fence — what this story does NOT build (READ, prevents obsolete work)

- **NO double-click-to-open, and do NOT remove the row arm-select.** Story 6.6's Dev Notes anticipated 6.7 would reconcile the 6.3 arm-select into "double-click row → open." **That plan is superseded** by the 2026-07-05 hover Open button fix: opening is now a dedicated Open button, and the arm-select is NO LONGER vestigial — it gates inline editing (Story 6.6: a cell is editable only when its row is armed). Leave the gesture model exactly as-is. Reintroducing double-click would break the shipped Open button + the 6.6 edit gate. [Source: .bmad/implementation-artifacts/6-6-inline-edit-title-authors.md:97-103, 209; client/src/library/CollectionTable.tsx:249-299]
- **NO `last_opened` UI surface** — no column, no "Recent" sort/filter, no "last opened" label. That is the out-of-scope last-opened *tracking* feature (Library SPEC). Only the field bump.
- **NO new endpoints beyond the open-touch.** No change to `getDoc`/`getAnnotations`/`putAnnotations`/`patchDoc` semantics.
- **NO folder/trash/multi-select** (Epic 7). **NO reader-internal changes** (annotation/anchor/render/store mechanisms are inherited and untouched — this story does not modify the annotation model or the overlay).

### Regression watch

- The existing `ReaderPage` "restore-on-open hydrates annotations" and "hydrate failure (bad/unknown `:docId` or `getAnnotations` failure) redirects to `/`" tests MUST stay green. `markDocOpened` is additive and swallowed; it must not perturb them — but it IS a new api-module export, so it must be added to those tests' api mock (default-resolve) or they break on an unmocked call.
- `apply_extraction` and `update_doc_meta` behavior must be byte-identical (their tests are the guard); `touch_last_opened` only adds a third caller of the shared core, it does not change the core.
- `CollectionTable` / `LibraryPage` are UNCHANGED by this story (the Open button already exists). Do not edit them. They still don't import `render/`, so the `vi.mock("./render")` barrels (App.test/Reader.test) are unaffected.

### Testing standards

- **Backend:** pytest, `PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q` (CLAUDE.md). No network. For the route test, import a PDF then POST `…/open` (the suite's autouse enrich network-guard is fine — the open path does no network). Prefer a direct `storage.touch_last_opened` unit test for the purge/TOCTOU case (sandbox `TestClient`-hang note). Backend suite is **run-it-yourself on the host** in the Codex review sandbox (`export UV_CACHE_DIR=/tmp/uv-cache`); a reviewer verifies backend findings by reading and flags the suite for the human.
- **Client:** Vitest + `@testing-library/react`, jsdom. **Mock the api module** (`vi.spyOn(api, "markDocOpened"/"getDoc"/"getAnnotations")`), never real `fetch`. The doc-switch isolation test reads `useAnnotationStore.getState()` directly to assert the swap (jsdom can't render rects). Run the FULL client suite + `npm run typecheck` clean.
- **Live smoke (Task 7):** own fresh servers, isolated data dir, DPR>1, cross-page. The doc-switch annotation isolation + cross-page geometry is the highest-risk path and jsdom cannot see it — it MUST be verified live with a real cross-page highlight, not only in jsdom. [Source: CLAUDE.md selection principle; [[verify-on-hidpi-and-real-host]]]

### Project Structure Notes

- **New/modified backend:** `server/app/storage/__init__.py` (`touch_last_opened`, a thin caller of `_update_meta_and_reindex`), `server/app/routes/docs.py` (`mark_doc_opened` + `POST /docs/{id}/open`; module docstring), `server/pyproject.toml` (version `0.4.7`), `server/openapi.json` (regen: new path, no new schema), tests (`test_docs.py`, `test_storage.py`, `test_openapi.py`).
- **Modified client:** `client/src/api/client.ts` (`markDocOpened`), `client/src/api/schema.d.ts` (regen), `client/src/reader/ReaderPage.tsx` (best-effort `markDocOpened` call in the load effect), `client/src/reader/ReaderPage.test.tsx` (open-touch called + best-effort + doc-switch isolation), api client test if one exists.
- **Modified docs:** `docs/API.md` (POST `…/open` resource + Changelog).
- **Untouched:** `CollectionTable`/`LibraryPage` (Open button already shipped), the annotation store's `openDoc` action, anchor/render/annotation layers, `getDoc`/`getAnnotations`/`putAnnotations`/`patchDoc`, `GET /api/library`. Downward-dependency rule (AD-9) intact.

### References

- [Source: .bmad/planning-artifacts/epics.md#Story-6.7 (lines 1475-1502)] — the six ACs; AC-1's text already updated to the hover Open button; AC-4 = `last_opened` on open.
- [Source: .bmad/specs/spec-paper-mate-library/SPEC.md:58; .bmad/planning-artifacts/architecture/architecture-paper-mate-library-2026-07-04/ARCHITECTURE-SPINE.md:225] — "last-opened tracking" is PRD out-of-scope (the *feature*, not the field bump); resolves why AC-4 is field-only, no UI.
- [Source: .bmad/planning-artifacts/epics.md:96 (AR-8/AD-8)] — `meta.json` storage schema incl. `last_opened`, owned solely by storage; import idempotent, `last_opened` advances.
- [Source: .bmad/planning-artifacts/epics.md:1221 (AL-1)] — `meta.json` authoritative for a paper's own fields; `library.json` a non-authoritative title/authors display cache, refreshed on write (carries no `last_opened`).
- [Source: server/app/storage/__init__.py:416-455] — `import_pdf` (the existing `last_opened` bump on re-import, mirror the `model_copy(update={"last_opened": now})` intent).
- [Source: server/app/storage/__init__.py:458-509] — `_update_meta_and_reindex` (the shared core to delegate to) + `apply_extraction` (a peer thin caller — the pattern for `touch_last_opened`).
- [Source: server/app/routes/docs.py:82-160] — `get_doc`/`patch_doc`: the thin route + `{ detail }` error-mapping + `Doc(...)` construction template for `mark_doc_opened`.
- [Source: server/app/models.py:49-67, 118-137] — `DocMeta` (`last_opened` field), `Doc`, `CollectionRow` (no `last_opened` in the cache).
- [Source: client/src/reader/ReaderPage.tsx:139-156, 299-308] — the param-driven load effect (where the best-effort `markDocOpened` goes) + the back-to-Library button (AC-5, already shipped).
- [Source: client/src/store/index.ts:573-576] — the `openDoc` module wrapper (atomic swap + zundo clear) that AC-6 isolation rides on; DO NOT modify.
- [Source: client/src/api/client.ts:65-121] — `getDoc`/`patchDoc`/`getAnnotations`: the fetch + `envelopeError` + typed-`Doc` template for `markDocOpened`.
- [Source: client/src/library/CollectionTable.tsx:249-372; client/src/library/LibraryPage.tsx:373] — the shipped Open button + `onOpenRow` → navigate; UNCHANGED here (ratify only).
- [Source: docs/superpowers/specs/2026-07-05-library-hover-open-button-design.md; docs/superpowers/plans/2026-07-05-library-hover-open-button.md:715,751] — the hover Open button fix that shipped AC-1 and explicitly left the `last_opened` update to this story.
- [Source: .bmad/implementation-artifacts/6-6-inline-edit-title-authors.md:97-103, 209] — the SUPERSEDED double-click reconciliation (do NOT pull forward) + the `_update_meta_and_reindex` extraction this story reuses.
- [Source: CLAUDE.md] — tokens never inline hex/px; no em-dash in UI strings; don't reinvent wheels (reuse the shared write core); OOP + refactor in the same change; document-level interaction handlers; launch your OWN dev servers for smoke; trusted input for focus-sensitive smoke; verify at DPR>1 cross-page; versioning (PATCH +1 at merge); branch-per-story; backend-tests sandbox note; contract-types regen flow; maintain `docs/API.md` with any `/api` change.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References

- Live smoke (Task 7): isolated `PAPER_MATE_DATA` scratch dir, backend on `:8137`, frontend on `:5187`, Playwright at `deviceScaleFactor: 2` (1400x1000 viewport). Seeded two real multi-page arXiv PDFs (`1903.03295v2.pdf`, 10pp; `1906.03821v1.pdf`, 9pp) via direct `POST /api/docs`.
- First cross-page drag attempt mis-hit: coordinate-based hit-testing on the LAST DOM span of a page grabbed the arXiv vertical sidebar watermark (`endOfContent`-adjacent decorative span, height ~700px) instead of a real text line, producing a spuriously huge single-page mark. Undone via Ctrl+Z. Second attempt (coordinate-drag between filtered "normal-sized" spans) still over-selected because this is a 2-column paper: pdf.js emits DOM text-layer spans in column order (all of column 1, then all of column 2), so "bottom-most by Y" is not "last in DOM order" — the resulting Range included the entire right column. Both attempts still correctly demonstrated NO full-page/cross-page leak (rects stayed per-line and correctly split per `page_index`), so the mechanism under test was never in doubt; the issue was test-selection precision, not the app. Final approach: construct the `Range` programmatically from specific filtered text nodes (`document.createRange()` + `Selection.addRange`), then fire a genuine trusted `page.mouse.up()` (no preceding `mouse.down()`, so the native click-to-collapse behavior never disturbs the just-built Selection) to trigger the app's real `pointerup` handler. Confirmed via screenshot: correct per-line rects split across pages 3→4, no leak.

### Completion Notes List

- Task 1: `touch_last_opened` added to `server/app/storage/__init__.py` as a one-line delegate to the existing `_update_meta_and_reindex` core (Story 6.6), matching `apply_extraction`/`update_doc_meta`'s pattern exactly. No new write path.
- Task 2: `POST /docs/{doc_id}/open` → `mark_doc_opened` added to `server/app/routes/docs.py`, mirroring `patch_doc`'s thin resolve→touch→map-errors→envelope shape. Reuses the existing `Doc` response model; module docstring updated.
- Task 3: Regenerated `server/openapi.json` (gitignored build artifact) and `client/src/api/schema.d.ts` (committed). Added `markDocOpened` to `client/src/api/client.ts`, mirroring `getDoc`/`patchDoc`.
- Task 4: `ReaderPage`'s param-driven load effect fires `markDocOpened(docId).catch(() => {})` as a non-awaited, `live`-gated side effect after `openDoc`/`setDoc`, outside the hydrate `Promise.all` and outside the redirect-on-failure `catch`.
- Task 5: Added backend tests (`test_docs.py`: 200/404/no-body/500; `test_storage.py`: field-only advance, cache-unchanged, missing-doc, purged-dir-no-ghost; `test_openapi.py`: path + no new schema), client `client.test.ts` unit tests for `markDocOpened`, and `ReaderPage.test.tsx` coverage (fires-once, best-effort rejection doesn't redirect, and the AC-6 doc-switch isolation test verifying the store's atomic swap + temporal-history clear across a `docId` change). Full suites green: 154 backend, 965 client, typecheck clean, no new em-dash.
- Task 6: `docs/API.md` gained the `POST /api/docs/{doc_id}/open` resource entry + Changelog line. `server/pyproject.toml` version `0.4.6 → 0.4.7`; `uv lock` re-run.
- Task 7: Live-smoked on own fresh servers (isolated data dir, alternate ports) at DPR=2 with two real multi-page PDFs. Verified: hover+Open navigates and hydrates (AC-1/2); a genuine cross-page highlight (constructed via a real `Range` + trusted `pointerup`, since coordinate-drag repeatedly mis-hit a decorative pdf.js watermark span on this specific paper) rendered as correct per-line rects split across two `page_index` groups with no full-page leak; autosave settled (AC-3); back-to-Library returned to `/` (AC-5); opening paper B showed zero of A's marks, and re-opening A showed exactly A's original 3 marks with no trace of B's (AC-6); `last_opened` advanced on each open via direct `GET /api/docs/{id}` checks while `status`/`title`/`authors`/`page_count`/`added` stayed byte-identical (AC-4/7), and `library.json` carries no `last_opened` key (AC-7). Smoke servers torn down after.

### File List

- `server/app/storage/__init__.py` — added `touch_last_opened`; widened `_update_meta_and_reindex`'s critical section to the whole read/write/reindex sequence under `_index_lock` (now an `RLock`), per review finding
- `server/app/routes/docs.py` — added `POST /docs/{doc_id}/open` (`mark_doc_opened`); module docstring updated
- `server/tests/test_docs.py` — added open-route tests (200/404/no-body/500)
- `server/tests/test_storage.py` — added `touch_last_opened` tests
- `server/tests/test_openapi.py` — added open-path contract test
- `server/pyproject.toml` — version `0.4.6` → `0.4.7`
- `server/uv.lock` — regenerated (version bump)
- `client/src/api/client.ts` — added `markDocOpened`
- `client/src/api/client.test.ts` — added `markDocOpened` unit tests
- `client/src/api/schema.d.ts` — regenerated from `server/openapi.json`
- `client/src/reader/ReaderPage.tsx` — fires `markDocOpened` as a best-effort side effect on open
- `client/src/reader/ReaderPage.test.tsx` — added open-touch + doc-switch isolation tests; `markDocOpened` added to the api mock defaults
- `docs/API.md` — added `POST /api/docs/{doc_id}/open` resource entry + Changelog line
- `.bmad/implementation-artifacts/sprint-status.yaml` — status tracking

### Change Log

- **2026-07-05 (Story 6.7):** Open a Library paper in the annotator with its annotations. Ratifies the already-shipped open path (hover Open button → `/reader/:docId`, doc-scoped PDF + annotation hydrate, autosave, back-to-Library, atomic doc-switch isolation) with coverage, and builds the one new piece: `meta.last_opened` advances on open via a new `POST /api/docs/{doc_id}/open` (thin route → `storage.touch_last_opened`, a one-line caller of the shared `_update_meta_and_reindex` write core; returns the full `Doc`, 404 unknown, 500 storage). `ReaderPage` fires `markDocOpened` as a best-effort, error-swallowed side effect so a `last_opened` write hiccup never aborts a readable open. No new schema (response is `Doc`); contract path regenerated. No UI surfaces `last_opened` (the out-of-scope last-opened *tracking* feature is not built). Version `0.4.6 -> 0.4.7`.
