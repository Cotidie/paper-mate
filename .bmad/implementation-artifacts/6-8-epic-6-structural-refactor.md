# Story 6.8: Epic 6 structural refactor: modularize the library client and split the storage/domain backend

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want the Epic 6 code (client `library/` plus backend `storage`/`domain`/`routes`) decomposed into cohesive, single-responsibility modules with dependencies audited, duplication removed, and conditional sprawl simplified,
so that the next Library story (Epic 7 folders/trash/sort) builds on legible modular seams instead of a 621-line storage god-module and 400-line flat components.

**This is a pure refactor thread, same footing as Stories 5.0 / 5.3 / 5.4.** No behavior change, no contract change, no schema change, no version-format change. Its own PR(s); client and server MAY split into separate PRs. Never folded into a feature story.

## Acceptance Criteria

Restated from `epics.md` Story 6.8 (lines 1511-1532). Fidelity preserved; wording adjusted only to drop em-dashes.

1. **Storage package split behind a stable facade (AL-9, AL-7, AD-9).** `server/app/storage/__init__.py` (621 lines spanning error taxonomy, path/data-root resolution, atomic-IO primitives, PDF parse, the `meta.json` store, the `library.json` read-modify-write index, and the annotations store) is split into a `storage/` package of focused modules (for example: errors, paths, atomic-IO, meta store, library index, annotations store) behind a stable `__init__` facade that re-exports the current public surface unchanged. Every `storage.<name>` call site in routes and `main.py` stays byte-identical. Storage remains the ONLY code that touches `~/.paper-mate` (AD-9), and the single process-level index lock stays the sole `library.json` writer (AL-7).

2. **Extract/enrich separation plus a Crossref enricher port (AD-L2).** `server/app/domain/extraction.py` (274 lines fusing the pure PyMuPDF `extract` with the Crossref-network `enrich`) is split so `extract` (PDF-only, total, GROBID-swappable) and `enrich` (the backend's only network call) live in their own modules. The Crossref access is abstracted behind a small enricher port/class (an interface plus a `CrossrefEnricher` implementation) so `enrich` is swappable and unit-testable without HTTP. The domain layer still imports nothing from `app.storage` and never touches disk.

3. **Route dedup: one error-envelope definition, one exception-mapping seam.** `routes/docs.py` (305 lines) currently repeats the OpenAPI `ErrorEnvelope` `responses=` block about 6 times and the `except DocumentNotFoundError -> 404 / except StorageError -> 500` mapping in every handler. The duplicated error-envelope responses and the storage-exception-to-HTTP mapping are each consolidated to one definition (a shared `responses=` constant/factory plus a single exception-mapping seam), leaving each handler a thin controller. The `run_extraction` extract-enrich-persist orchestrator is homed where it composes storage plus domain cleanly.

4. **Client `library/` adopts the scaffold-react layout; `CollectionTable`/`LibraryPage` decomposed.** The client `library/` dir (components flat today: `AddMenu`, `CollectionTable` 416, `LibraryPage` 386; hooks `useBulkUpload`/`useSettlePolling`; leaf `uploadQueue`) adopts the `/scaffold-react` convention as Story 5.4 established it for the rest of `client/src/`: each component in its own `<Name>/` folder colocated with its `.css` plus `.test.tsx`, page-specific hooks colocated with the page, pure leaves in a `lib/`-style home. `CollectionTable`/`LibraryPage` are decomposed so upload / optimistic-row / polling / inline-edit each own their state in a cohesive unit rather than one conditional sprawl, and the row/status shape is abstracted into a shared data type.

5. **Dedup + dead-code removal across the Epic 6 surface.** Logic duplicated across these files (or versus the existing `render/`/`anchor/`/`annotations/`/`store/` client layers and the `storage`/`domain` server layers) is consolidated to one definition. Dead code (unreferenced exports, stale branches, superseded comments) is deleted, not left "just in case."

6. **Behavior- and contract-identical gate.** Client plus server suites stay green. `server/openapi.json` and `client/src/api/schema.d.ts` regenerate byte-identical. Both `vi.mock(...)` barrels are updated if any import path moves. `no-raw-values` re-runs green after any CSS move. No em-dash is introduced in any UI string. The Library open-in-annotator and bulk-upload/table paths are re-smoked live at DPR>1 (inherited `annotations/` selection-geometry plus doc-switch risk).

7. **AD-9 downward layering respected.** The new module boundaries respect AD-9 (client `render/` -> `anchor/` -> `annotations/` -> `App`; server `routes/` -> `domain`/`storage`) and the domain's no-storage-import rule (AD-L2): no upward imports, routes stay thin, domain stays pure, storage stays the sole data-root writer.

## Tasks / Subtasks

> Server and client are independent; either can be done and PR'd first. Regenerate the contract on the server side, then verify the client's committed `schema.d.ts` is byte-identical.

- [ ] **Task 1: Split `storage/__init__.py` into a package behind a byte-identical facade (AC: 1, 5, 7)**
  - [ ] Create focused modules under `server/app/storage/` (suggested: `errors.py`, `paths.py`, `atomic.py`, `meta_store.py`, `library_index.py`, `annotations_store.py`). Keep the process-level `_index_lock` (an `RLock`) and `_mutate_index` as the single serialized `library.json` writer (AL-7); it MUST be shared by every mutator, not duplicated.
  - [ ] Make `storage/__init__.py` a thin facade that re-exports the FULL current public surface so `from app import storage; storage.<name>` and `from app.storage import <Name>` both keep working unchanged. Public surface to re-export (verified against call sites): functions `read_library`, `reconcile_library`, `source_path`, `read_meta`, `import_pdf`, `apply_extraction`, `update_doc_meta`, `touch_last_opened`, `write_annotations`, `read_annotations`; exception classes `StorageError`, `InvalidPDFError`, `UnsupportedSchemaError`, `CorruptMetadataError`, `CorruptAnnotationsError`, `DocumentNotFoundError`, `CorruptLibraryError`; constants `META_SCHEMA_VERSION`, `ANNOTATIONS_SCHEMA_VERSION`, `LIBRARY_SCHEMA_VERSION`.
  - [ ] Preserve the `_update_meta_and_reindex` shared write core (re-read -> apply -> TOCTOU purge-guard with `create_parents=False` + `doc_dir.is_dir()` re-check -> write -> reindex, all under `_index_lock`). `apply_extraction`, `update_doc_meta`, `touch_last_opened` stay thin callers of it.
  - [ ] **Test landmine (see Dev Notes):** `test_storage.py` does `monkeypatch.setattr(storage, "_read_meta", ...)` and expects the production TOCTOU path to call that patched name. Decide the seam so the patch still bites (keep `_read_meta` reachable-and-called via the facade name, OR update those three tests to patch the real call-site module attr). Do not let the guard test silently no-op.
  - [ ] Run `PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q` (from `server/`); all of `test_storage.py`, `test_docs.py`, `test_library.py`, `test_models.py` green.

- [ ] **Task 2: Separate `extract` and `enrich`; put Crossref behind an enricher port (AC: 2, 5, 7)**
  - [ ] Split `domain/extraction.py` into `extract` (pure PyMuPDF, total, `bytes -> ExtractedMeta`) and `enrich` in their own modules. Suggested: `domain/extract.py`, `domain/enrich.py`, `domain/crossref.py` (the port + `CrossrefEnricher`).
  - [ ] Define a small enricher port (a `Protocol` or ABC: `enrich(meta: ExtractedMeta) -> ExtractedMeta | Literal["skipped"]`, never raises, never blocks) and a `CrossrefEnricher` implementation holding the httpx client construction, DOI-first-then-title logic, `_titles_match` Jaccard gate, and `_meta_from_work`/`_authors_from_crossref` projection. `enrich(meta)` at the domain surface stays a stable function (`domain.enrich`) that delegates to the default `CrossrefEnricher`, so the route call site (`domain.enrich`) is unchanged and a test can inject a fake enricher (no HTTP).
  - [ ] Keep `domain/__init__.py` re-exporting `extract`, `enrich` (and export the port + `CrossrefEnricher` if tests want to construct/inject them). `__all__` updated.
  - [ ] **Test landmine (see Dev Notes):** `test_domain.py` does `ast.parse(pathlib.Path(extraction.__file__).read_text())` (a static check on the single extraction file, likely the no-`app.storage`-import / no-network guarantee). Point that AST check at the new module(s), or it inspects a file that no longer holds the code it asserts about.
  - [ ] Confirm the domain layer imports nothing from `app.storage` (grep) and never touches the filesystem. `test_domain.py` green.

- [ ] **Task 3: Dedup `routes/docs.py` error envelopes + exception mapping; home the orchestrator (AC: 3, 5, 7)**
  - [ ] Consolidate the repeated OpenAPI `ErrorEnvelope` `responses=` blocks into one shared definition (a constant/factory, for example `error_responses(404, 500)` producing the `$ref: '#/components/schemas/ErrorEnvelope'` content). Reuse it in `docs.py` and `library.py`.
  - [ ] Consolidate the `except DocumentNotFoundError -> 404 / except StorageError -> 500` mapping into one seam (a context manager or a small helper) so each handler is a thin controller. Preserve the exact status codes and detail strings per route (upload_doc 400 "Could not read PDF file" / 500 "Could not store document"; get_doc 404 "Document not found" / 500 "Could not read document"; patch_doc 400 "No fields to update" / 404 / 500 "Could not update document"; mark_doc_opened 404 / 500 "Could not update document"; get_doc_file 404 / 500 "Could not read document"; get_annotations 404 / 500 "Could not read annotations"; put_annotations 404 / 500 "Could not save annotations"; get_library 500 "Could not read library"). These detail strings and codes are the contract; keep them byte-identical.
  - [ ] Home `run_extraction` (the extract-enrich-persist background orchestrator) where it composes storage + domain cleanly. It stays importable as `from app.routes.docs import run_extraction` OR update `test_docs.py`'s import if it moves (see landmine). Keep it a sync function (Starlette threadpool, CPU-bound PyMuPDF + sync httpx) and keep its never-raise settle-to-`parse-failed` fallback.
  - [ ] Regenerate the contract and assert byte-identical (see Task 5).

- [ ] **Task 4: Move client `library/` onto the scaffold-react layout; decompose `CollectionTable`/`LibraryPage` (AC: 4, 5, 6, 7)**
  - [ ] Restructure `client/src/library/` to mirror the `reader/` feature-dir precedent (see Project Structure Notes for the recommended target and the shared-vs-colocated decision). Each component gets its own `<Name>/` folder with colocated `.css` + `.test.tsx`. Use `git mv` so history follows; update every `@/library/...` import (only external importer is `client/src/routes/router.tsx`, plus the intra-`library/` imports).
  - [ ] Decompose the sprawl: pull upload / optimistic-row / polling / inline-edit state into cohesive units (`LibraryPage` currently owns 6 refs + ~10 callbacks: `handleResolved`, `applyLibrary`, `settleNotices`, `handleBatchSettled`, `handleEditField`, `handleFailed`, plus the settle-poll wiring). `CollectionTable` mixes `TableSkeleton`, `TableHead`, `ColumnGroup`, `InlineEditor`, `EditableCell`, and the row-render sprawl. Split these so each concern reads as one unit. Abstract the row/status shape (`CollectionRow` + the `"extracting"` pending overlay, `RowStatus`, `docToRow`) into a shared data type/module rather than re-deriving it inline.
  - [ ] If any moved module is referenced through a `vi.mock(...)` factory, update BOTH mock barrels in the same change (CLAUDE.md standing rule; the canonical case is `vi.mock("./render")` in `App.test.tsx`/`Reader.test.tsx`, but audit every `vi.mock` whose path or export set shifts).
  - [ ] Move CSS with the component; re-run `no-raw-values.test.ts` (raw hex/px allowed ONLY in `src/theme/**`). Grep moved/edited UI strings for `—` (em-dash) before committing.
  - [ ] `npm test` (Vitest) and `npm run typecheck` green from `client/`.

- [ ] **Task 5: Contract-identical + suites-green verification (AC: 6)**
  - [ ] Server: `cd server && PYTHONPATH= uv run python -m app.export_openapi` writes `server/openapi.json`; confirm `git diff --stat server/openapi.json` is EMPTY (byte-identical).
  - [ ] Client: `cd client && npm run gen:api` regenerates `client/src/api/schema.d.ts`; confirm `git diff --stat client/src/api/schema.d.ts` is EMPTY (byte-identical, committed).
  - [ ] Full suites: backend `PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q` (154 baseline from Story 6.7; note the sandbox caveat, backend is run-it-yourself on the host); client `npm test` (965 baseline) + `npm run typecheck`.
  - [ ] `docs/API.md`: NO change expected (contract-identical). If the contract diff is non-empty, the refactor changed behavior: stop and fix, do not paper over it in API.md.

- [ ] **Task 6: Live smoke at DPR>1 (AC: 6)**
  - [ ] Launch YOUR OWN fresh servers (isolated `PAPER_MATE_DATA` scratch dir, alternate ports), never a user-launched/Docker one. Backend `uvicorn --reload`, client `vite dev`.
  - [ ] At `deviceScaleFactor: 2`: bulk-upload 2+ real multi-page PDFs (optimistic rows stream in, statuses settle), the table renders + inline-edit commits/reverts, open a paper from the Library into the reader, make a CROSS-PAGE highlight (the highest-risk selection path; jsdom cannot see it), autosave settles, back-to-Library, open a SECOND paper and confirm doc-switch isolation (paper B shows none of A's marks; re-opening A shows exactly A's). Tear the smoke servers down after.

- [ ] **Task 7: Version + status (AC: 6)**
  - [ ] Bump PATCH in `server/pyproject.toml` (`0.4.7 -> 0.4.8`) at story done/merge (once, not per commit); re-run `uv lock`. This is the only "version" touch; no MAJOR/MINOR and no schema-version change (behavior/contract-identical).
  - [ ] Flip `sprint-status.yaml` `6-8-...` to done at PR-merge time (AE3-1), and fill the Dev Agent Record fully before done (AE3-2).

## Dev Notes

### What this story is (and is not)

- **Is:** a structure-only refactor. Split god-modules into cohesive units, put Crossref behind a port, dedup the route error handling, move the client `library/` onto the established scaffold-react layout, delete dead code.
- **Is not:** any behavior, API, schema, or UX change. The gate is BYTE-IDENTICAL contract (`openapi.json` + `schema.d.ts`) and green suites. If either regenerated file differs, you changed behavior: that is a bug in the refactor, not an expected diff.
- Precedent to imitate: Stories 5.0 (structural refactor), 5.3 (Reader/annotation module split), 5.4 (client `src/` scaffold-react folder layout). Same footing, same "its own PR(s), never folded into a feature story" rule.

### Current state of the server files being refactored (read these before touching)

**`server/app/storage/__init__.py` (621 lines) — the sole `~/.paper-mate` writer (AD-9).** Seven concerns in one flat file:
1. Exception taxonomy: `StorageError` base + `InvalidPDFError`, `UnsupportedSchemaError`, `CorruptMetadataError`, `CorruptAnnotationsError`, `DocumentNotFoundError`, `CorruptLibraryError`.
2. Path/data-root resolution + containment: `_data_root`, `_doc_dir` (library-root escape guard), `_library_path`, `_now_iso`.
3. Atomic-IO primitives: `_fsync_dir`, `_atomic_write` (temp+rename, `create_parents` flag; wraps `OSError` as `StorageError`).
4. PDF parse: `_parse_pdf` (pypdf; `(page_count, title)`; any failure -> `InvalidPDFError`).
5. `meta.json` store: `_read_meta` (schema-version gate), `_write_meta`.
6. `library.json` index (AL-1/AL-7): `_index_lock` (`RLock`), `_default_index`, `_read_index_unlocked`, `_write_index`, `_mutate_index` (the single serialized read-modify-write), `_cache_from_meta`, `_next_order`, `_upsert_paper_entry`, `read_library`, `reconcile_library`, plus the shared `_update_meta_and_reindex` write core.
7. Public API + annotations store: `source_path`, `read_meta`, `import_pdf`, `apply_extraction`, `update_doc_meta`, `touch_last_opened`, `write_annotations`, `read_annotations`.

**Public surface the facade MUST preserve (call-site-verified):** used by `routes/docs.py`, `routes/library.py`, `main.py` (`reconcile_library` at startup). See Task 1 for the full re-export list. The single hard invariant: every `storage.<name>` reference elsewhere resolves unchanged, and `_mutate_index`/`_index_lock` stay the ONE serialized `library.json` writer (AL-7). A background extraction cache-refresh must never interleave with a user move/trash/restore.

**`server/app/domain/extraction.py` (274 lines) — pure domain (AD-L2), imports nothing from storage, never touches disk.** Two separable halves:
- `extract(pdf_bytes) -> ExtractedMeta`: rung-1 `/Info`+XMP (`_clean`, `_parse_xmp`, `_rdf_items`), rung-2 font heuristic (`_title_from_fonts`, `_is_horizontal`, `_TITLE_TOP_FRACTION`), DOI scan (`_find_doi`, `_DOI_RE`, `_DOI_TRAILING`). Total: any PyMuPDF failure returns `ExtractedMeta()`, never raises.
- `enrich(meta) -> ExtractedMeta | "skipped"`: the ONLY backend network call. `_CROSSREF`, `_TIMEOUT`, `_user_agent`, httpx client, DOI-first then title fallback, `_titles_match` (Jaccard `_TITLE_MATCH_MIN_JACCARD`), `_meta_from_work`, `_authors_from_crossref`. Never raises, never blocks; offline/failure/no-match -> `"skipped"`; at most 2 Crossref calls.
- The AC-2 port: wrap the Crossref half in `CrossrefEnricher` (holds the httpx-client construction + the query logic) behind a tiny port interface, so `enrich` is injectable/testable without HTTP. Keep `domain.enrich(meta)` as the stable facade delegating to a default `CrossrefEnricher()`.

**`server/app/routes/docs.py` (305 lines) — thin controllers, no filesystem, no domain logic.** The duplication to kill:
- The OpenAPI `responses={404: {...ErrorEnvelope...}, 500: {...}}` block is copy-pasted across `get_doc`, `patch_doc`, `mark_doc_opened`, `get_doc_file`, `get_annotations`, `put_annotations` (plus `library.py`'s 500). One shared `responses=` constant/factory.
- The `try: ... except DocumentNotFoundError -> 404; except StorageError -> 500` mapping is in every handler. One shared mapping seam (context manager or helper). Keep the per-route status codes + detail strings byte-identical (they are the contract; enumerated in Task 3).
- `run_extraction` is the extract-enrich-persist orchestrator; it composes `domain` + `storage`. Home it where that composition reads cleanly (it is the AD-L2 composition root). Keep the never-raise settle-to-`parse-failed` behavior and the sync-threadpool execution model.

### TWO TEST LANDMINES (will silently break or no-op the refactor)

1. **`test_storage.py` monkeypatches `storage._read_meta`** (lines ~559/624/693): `monkeypatch.setattr(storage, "_read_meta", read_then_purge)` to simulate a purge in the TOCTOU window, and expects the production `_update_meta_and_reindex` path to call the patched name. If `_read_meta` moves to a submodule and callers import it directly (`from .meta_store import read_meta`), patching the facade attribute will NOT affect the real call site: the guard test passes without exercising the guard (a false green). Choose the seam deliberately: either keep the production code calling `storage._read_meta` (facade-level, so the patch bites), or update these three tests to patch the actual call-site module attribute.
2. **`test_domain.py` AST-parses `extraction.__file__`** (line ~333): a static assertion over the single extraction source file (very likely: no `app.storage` import and/or the network-call shape). Splitting into `extract.py`/`enrich.py`/`crossref.py` means that file no longer holds what the test inspects. Repoint the AST check at the new module(s) so it still guards the real code.

### Client target: the scaffold-react layout (Story 5.4), by the `reader/` precedent

The established convention (verified in-tree):
- **Shared, reusable components** live in `client/src/components/<Name>/<Name>.{tsx,css,test.tsx}` (e.g. `Reader/`, `ToolRail/`, `Toast/`, `EmptyDropzone/`, `BankPanel/`).
- **A route-feature page** lives in its own feature dir with its page-specific hooks and leaves colocated: `client/src/reader/` holds `ReaderPage.{tsx,css,test.tsx}` PLUS `usePageNav.ts`, `usePanControl.ts`, `useZoomControl.ts` (page hooks) and `PageCard.tsx` (page leaf). Note reader keeps its OWN hooks/leaves colocated rather than pushing them to the shared `hooks/`/`lib/` homes.
- **App-wide hooks** in `client/src/hooks/` (`useAutosave`, `useLiveRef`); **pure leaves/utils** in `client/src/lib/` (`tools`, `bank`, `uuid`, `domFocus`).
- Path alias `@` -> `src` (`client/vite.config.ts` + `tsconfig.app.json` `@/*`), shared by dev/build/vitest.

**Decision to make (AC-4 phrasing vs. the reader precedent).** The AC literally says "each component in its own `components/<Name>/` folder, hooks a hooks home, leaves a `lib/`-style home." Read strictly that pushes `CollectionTable`/`AddMenu` to `client/src/components/<Name>/`, `useBulkUpload`/`useSettlePolling` to `client/src/hooks/`, `uploadQueue` to `client/src/lib/`. But `reader/` set the actual precedent that a route feature keeps its page-specific hooks/leaves/subcomponents colocated in the feature dir. **Recommended (matches `reader/` exactly, keeps the Library feature cohesive):**

```
client/src/library/
  LibraryPage.{tsx,css,test.tsx}         # the route page
  CollectionTable/CollectionTable.{tsx,css,test.tsx}
  AddMenu/AddMenu.{tsx,css,test.tsx}
  useBulkUpload.{ts, .test.ts}           # page hook, colocated like reader/usePageNav
  useSettlePolling.{ts, .test.ts}        # page hook
  uploadQueue.{ts, .test.ts}             # pure leaf, colocated like reader/PageCard
  row.ts (or types.ts)                   # the shared CollectionRow + RowStatus + docToRow data type (AC-4)
```

This satisfies "each component in its own `<Name>/` folder colocated with css+test" while following the `reader/` feature-dir pattern. Do NOT scatter `library/` across three shared homes if that fights the `reader/` precedent; keep the feature cohesive. Whichever you pick, apply it consistently and update `router.tsx`'s `@/library/LibraryPage` import.

Only external importer of `library/`: `client/src/routes/router.tsx` (`import LibraryPage from "@/library/LibraryPage"`). Everything else is intra-`library/`. Use `git mv` to preserve blame.

### Decomposition targets (the "conditional sprawl" AC-4/AC-5 names)

- **`LibraryPage.tsx` (386):** owns 6 refs (`mountedRef`, `fetchSeqRef`, `noticeBatchIdsRef`, `editSeqRef`, plus 2 file-input refs) and the interlocking fetch/poll/edit machine (`handleResolved`, `applyLibrary`, `settleNotices`, `handleBatchSettled`, `handleEditField`, `handleFailed`, `useBulkUpload`/`useSettlePolling` wiring). Pull the upload+settle+notice lifecycle and the inline-edit optimistic-PATCH lifecycle into cohesive hooks/units so the page reads as composition, not one 300-line body. Preserve the monotonic-sequence guards (`fetchSeqRef`, per-field `editSeqRef`) exactly: they fix real races (a slow fetch clobbering a newer reconcile; two edits to the same field) caught in Story 6.6 Codex review.
- **`CollectionTable.tsx` (416):** already has extracted sub-components (`TableSkeleton`, `TableHead`, `ColumnGroup`, `InlineEditor`, `EditableCell`) but the row-render body + the `suppressClickRef` arm/edit/open gesture juggling is dense. Extract the row (and pending-row) rendering into their own units; centralize the `RowStatus`/`statusLabel`/`rowStatusClass`/`docToRow`/`seedFieldValue` helpers into the shared row data-type module. Preserve the `suppressClickRef` blur-vs-click discipline exactly (it fixes the "click-away should only finish editing, not chain into arm/edit/open" bug documented inline).
- **Shared row/status data type (AC-4):** `CollectionRow` (generated API type) + the `"extracting"` pending overlay + `PendingUpload` shape are re-derived across `LibraryPage.docToRow`, `CollectionTable` `RowStatus`, and `useBulkUpload`. Home one shared type/module.

### Standing conventions that gate this story (CLAUDE.md)

- **Contract types are generated, never hand-authored.** After any server change: `uv run python -m app.export_openapi` -> `server/openapi.json`, then client `npm run gen:api` -> `schema.d.ts`. For THIS story both must come out byte-identical (no diff). `openapi.json` is a gitignored build artifact; `schema.d.ts` is committed.
- **`vi.mock` barrels stay in sync.** Any moved module referenced by a `vi.mock(...)` factory must update every barrel in the same change (the `render/` barrels in `App.test.tsx`/`Reader.test.tsx` are the canonical example; audit for others touched by the client move).
- **Tokens only in UI, no raw hex/px outside `src/theme/**`.** Moving CSS must keep `no-raw-values.test.ts` green.
- **No em-dash in any user-facing string** (tooltips/labels/aria/copy/toasts). Comments are exempt. Grep touched UI strings for `—`.
- **Document-level, phase-gated interaction handlers** (not canvas-bound). Not central to this refactor, but do not "fix" any handler binding while moving code: preserve the existing binding sites.
- **Live-smoke every geometry/placement feature at DPR>1, cross-page** (AE-5). jsdom zeroes rects and cannot see multi-page selection; the cross-page full-page-highlight class of bug only shows live at DPR>1.
- **Backend suite is run-it-yourself under the Codex review sandbox** (AE-7/AE3-4): `export UV_CACHE_DIR=/tmp/uv-cache`; `TestClient`-backed tests can hang in the sandbox. A reviewer verifies backend findings by reading; the human runs pytest on the host.

### Commands (copy-paste)

- Backend tests: `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q`
- Regen contract: `cd server && PYTHONPATH= uv run python -m app.export_openapi` then `cd client && npm run gen:api`; both target files must show an EMPTY git diff.
- Frontend tests: `cd client && npm test` | Typecheck: `cd client && npm run typecheck`
- Dev servers (own, for smoke): `cd server && uv run uvicorn app.main:app --reload --port <alt>` and `cd client && npm run dev` (set `PAPER_MATE_API_TARGET` + isolated `PAPER_MATE_DATA` scratch dir; alt ports).

### Testing standards

- Backend: pytest (no plugins). Keep the existing test files green; move-follow tests where a module split relocates the symbol under test. The two landmines above are mandatory to resolve.
- Client: Vitest + Testing Library. Colocated `.test.tsx` moves with its component. Keep coverage; do not delete a test to make a move easier.
- The refactor's own success test is the byte-identical contract + green suites + the DPR>1 live smoke. There is no new feature to test; there is existing behavior to prove unbroken.

### Project Structure Notes

- Server target (suggested, not mandated verbatim): `server/app/storage/{__init__ (facade), errors, paths, atomic, meta_store, library_index, annotations_store}.py`; `server/app/domain/{__init__, extract, enrich, crossref}.py`; `routes/docs.py` slimmed with a shared `error_responses` + exception-mapping seam (candidate home: `routes/_errors.py` or reuse across `docs.py`+`library.py`).
- Client target: recommended `library/` feature-dir layout above (mirrors `reader/`). Consistency with the reader precedent beats a literal reading of "components/<Name>/".
- No new source dirs are required beyond the package split; no new dependency; no schema/version-format change.
- Downward-layering (AD-9) must hold after the split: `routes/` -> `domain`/`storage`; `domain` imports nothing from `storage` and never touches disk (AD-L2); `storage` is the sole `~/.paper-mate` writer (AD-9). Grep for accidental upward imports before finishing.

### References

- [Source: .bmad/planning-artifacts/epics.md#Story 6.8] (lines 1503-1532) — story statement + the 7 Given/Then ACs.
- [Source: .bmad/planning-artifacts/sprint-change-proposals/sprint-change-proposal-2026-07-05-epic-6-refactor.md] — the correct-course that appended this story; Section 4/5 give the split scope + success criteria + handoff (own PR(s), Sonnet 5 xHigh dev, Codex review, client/server may split).
- [Source: .bmad/planning-artifacts/epics.md#Library Technical Requirements] (AL-1 index authority split, AL-2 pure extraction domain + Crossref enrich, AL-7 index write concurrency, AL-9 stack/source-dir additions; lines 1219-1229).
- [Source: server/app/storage/__init__.py] — the 621-line module to split; public surface + `_mutate_index`/`_index_lock`/`_update_meta_and_reindex` invariants.
- [Source: server/app/domain/extraction.py] — the 274-line extract+enrich module; the Crossref half to port.
- [Source: server/app/routes/docs.py] — the 305-line route with the duplicated error envelopes + exception mapping + `run_extraction` orchestrator.
- [Source: server/tests/test_storage.py, test_domain.py, test_docs.py] — the two monkeypatch/AST landmines + the run_extraction import.
- [Source: client/src/library/*] — flat components to move; `LibraryPage`/`CollectionTable` to decompose.
- [Source: client/src/reader/*, client/src/components/*/] — the scaffold-react layout precedent (Story 5.4) to imitate.
- [Source: client/src/routes/router.tsx] — the only external `@/library/...` importer.
- [Source: CLAUDE.md] — contract-gen, vi.mock barrels, no-raw-values, no em-dash, DPR>1 smoke, backend-sandbox caveat, versioning (PATCH +1 at story done).
- Precedent stories: [Source: .bmad/implementation-artifacts/6-7-open-paper-in-annotator.md] (prior story, its DPR>1 cross-page smoke method + doc-switch isolation test); Stories 5.0/5.3/5.4 (prior refactor threads, same footing).

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List
