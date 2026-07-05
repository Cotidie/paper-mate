---
baseline_commit: 9abe42e093e28441a58b1b3e845f715e28756cbf
---

# Story 6.2: The collection index (papers persist and list)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a reader,
I want the app to keep a durable index of every paper I have added,
so that my collection survives restarts and can be listed in one fast read.

This is a **backend + contract** story. It stands up the concurrency-safe `~/.paper-mate/library.json` collection index (AL-1/AL-7), the `GET /api/library` read endpoint (AL-6), the new Pydantic models (`CollectionRow`, `Folder`, `Library`, status/file-type) that generate the client types (AL-8/AD-3), and the boot-reconcile that ties on-disk doc dirs to the index. It is the persistence spine every later Library story sits on. It renders **no UI** (the collection table is Story 6.3), runs **no extraction** (that is Story 6.5), and builds **no folders/trash behaviour** (that is Epic 7). It only ensures: a paper imported via `POST /api/docs` is durably indexed, survives a restart, and lists in one read.

## Acceptance Criteria

1. **`library.json` is the authoritative cross-doc index (AL-1).** When storage persists collection state it writes `~/.paper-mate/library.json` carrying `schema_version`, the folder tree (identity/nesting/names, incl. empty folders), folder membership (paper→≤1 folder), trash state, and paper inclusion + order. Per-paper **own** fields (title, authors, added, page_count, file_type, status) stay authoritative in `meta.json`; membership/trash/order are **not** written into `meta.json`. In this story folders is an empty list and every paper is Uncategorized (`folder_id: null`), untrashed, ordered by insertion (Epic 7 populates folders/trash; do not build that behaviour here).

2. **`library.json` carries a non-authoritative display cache (AL-1, LNFR-4).** Each paper entry caches the meta-derived display projection (title, authors, added, file_type, status), rebuildable from `meta.json`. `meta.json` wins on any conflict, and the cache is refreshed **on every index write**, so `GET /api/library` renders the table from **one file read** without opening N `meta.json` files.

3. **`GET /api/library` returns the collection in one read (AL-6, AL-8/AD-3).** Called, it returns the collection as a Pydantic `Library` = `{ papers: CollectionRow[], folders: Folder[] }`, read directly from `library.json`'s display cache (a single file read, no per-doc `meta.json` fan-out). Each `CollectionRow` carries `doc_id, title, authors, added, file_type, status, folder_id, trashed, order`. The new models (`CollectionRow`, `Folder`, `Library`, and the status + file_type value sets) flow through Pydantic → OpenAPI → the generated TS client types (`schema.d.ts` regenerated + committed); no client type is hand-authored.

4. **Boot reconcile aligns dirs and index (AL-1).** At app boot storage reconciles: a `library/{doc_id}/` dir present on disk but **absent from the index** is added as Uncategorized (its display cache built from its `meta.json`); an index entry whose `{doc_id}/` dir has **vanished** is pruned. A dir whose `meta.json` is missing/corrupt is skipped (best-effort, never crashes boot). This is what indexes papers imported before this story existed (Epic 1–5 test docs, the Story 6.1 single-file-bridge uploads).

5. **Every index mutation is a serialized, atomic read-modify-write (AL-7, AL-9).** All `library.json` writes go through one path that takes a **process-level lock**, reads the whole index, mutates it in memory, and commits it via the existing atomic temp+rename. Concurrent writers (a future background extraction cache-refresh vs a user op) can never drop a change. `GET /api/library` reads the file lock-free (the atomic rename guarantees a reader always sees a complete old-or-new file). Storage stays the **only** code touching `~/.paper-mate` (routes never do disk I/O).

6. **Persistence proof, end to end (LFR-21).** A paper imported via the existing `POST /api/docs`, then a process restart, still lists in `GET /api/library` with its own fields intact.

7. **Additive schema evolution only (LNFR-5, AD-8).** `library.json` carries `schema_version`; changes are additive-only. The `meta.json` extension (new `authors`/`file_type`/`status` fields) is additive with defaults and does **not** bump `META_SCHEMA_VERSION` (existing v1 files still validate). A breaking change to either persisted format is an AD-8-class break requiring a MAJOR version bump.

## Tasks / Subtasks

- [x] **Task 1, Models: `CollectionRow`, `Folder`, `Library`, extend `DocMeta` (AC: 1, 2, 3, 7)** [`server/app/models.py`]
  - [x] Extend `DocMeta` additively (AD-8, no `META_SCHEMA_VERSION` bump): add `authors: str | None = None`, `file_type: Literal["pdf", "note"] = "pdf"`, `status: Literal["extracting", "ready", "enrich-skipped", "parse-failed"] = "ready"`. Keep the field order stable, put the new fields before `schema_version`. Defaults matter: an existing v1 `meta.json` missing these fields validates (Pydantic fills defaults); a fresh 6.2 import (no extraction pipeline yet) is immediately `status: "ready"`, `authors: null` (Story 6.5 drives the `extracting → ready | enrich-skipped | parse-failed` transitions and fills `authors`). `Doc(DocMeta)` inherits these automatically — the `GET`/`POST /api/docs` `Doc` responses gain the three fields (additive, no reader breakage).
  - [x] Add `class Folder(BaseModel)`: `id: str` (UUIDv4, inherited IDs convention), `name: str`, `parent_id: str | None = None`. Reserved for Epic 7 CRUD; defined here so the type is generated (AC-3). Docstring: name is mutable, keyed by id, so rename never orphans membership (spine Consistency Conventions).
  - [x] Add `class CollectionRow(BaseModel)`: `doc_id: str`, `title: str | None`, `authors: str | None`, `added: str`, `file_type: Literal["pdf", "note"]`, `status: Literal[...]` (same literals as `DocMeta.status`), `folder_id: str | None`, `trashed: bool`, `order: int`. This is the API row = organizational fields (authoritative in `library.json`) + the meta-derived display projection.
  - [x] Add `class Library(BaseModel)`: `papers: list[CollectionRow]`, `folders: list[Folder]`. The `GET /api/library` response envelope (table + folder tree in one read; folders empty until Epic 7). See Dev Notes "Why a `Library` wrapper".
  - [x] Keep the `status`/`file_type` literals identical between `DocMeta` and `CollectionRow` (copy the exact `Literal[...]` or, if you prefer a single named generated schema, define one `class PaperStatus(str, Enum)` / `class FileType(str, Enum)` and reference it from both — dev's call; Literal matches the house style used by `Annotation.type`/`anchor.kind`, see Dev Notes).

- [x] **Task 2, Storage: `library.json` I/O, display cache, serialized RMW, boot-reconcile (AC: 1, 2, 4, 5, 7)** [`server/app/storage/__init__.py`]
  - [x] Add `LIBRARY_SCHEMA_VERSION = 1` and a `_library_path() -> Path` = `_data_root() / "library.json"` (sibling of the `library/` dir, NOT inside it — see the Structural Seed layout). Add a `CorruptLibraryError(StorageError)` for an unreadable/wrong-shape `library.json`, mirroring `CorruptMetadataError`.
  - [x] Define the on-disk `library.json` shape (code owns the detail): `{ "schema_version": 1, "folders": [], "papers": [ { "doc_id", "folder_id", "trashed", "order", <cache: "title", "authors", "added", "file_type", "status"> } ] }`. The org fields (`folder_id`/`trashed`/`order`) are authoritative here; the cache fields are refreshed from `meta.json` on every write.
  - [x] Add a module-level `threading.Lock` and a private `_mutate_index(mutator: Callable[[dict], dict]) -> dict` that: acquires the lock; reads the current index (or the empty default `{schema_version, folders:[], papers:[]}` if the file is absent); calls `mutator(index)`; validates + atomically writes it via the existing `_atomic_write`; returns the new index. **Every** index write goes through this single path (AL-7). Reads do NOT take the lock.
  - [x] Add `read_library() -> Library`: read `library.json` lock-free (absent → return an empty `Library(papers=[], folders=[])`; unreadable/wrong-shape/unknown `schema_version` → `CorruptLibraryError`), and project it to the `Library`/`CollectionRow` models straight from the stored display cache (no `meta.json` fan-out — that is the whole point of the cache, AC-2/AC-3).
  - [x] Add a helper to build a paper's cache entry from a `DocMeta` (title, authors, added, file_type, status) so `import_pdf` and reconcile share one projection (meta wins, AC-2).
  - [x] Wire `import_pdf` to index on import: after writing `meta.json`, `_mutate_index` to upsert this `doc_id`'s entry — on a **new** import append `{folder_id: null, trashed: false, order: <next>, ...cache}`; on an **idempotent re-import** ensure the entry exists and refresh its cache from the (updated) meta, without creating a duplicate and without disturbing an existing `folder_id`/`trashed`/`order`. (The AL-4 "re-upload restores a trashed paper" edge is DEFERRED to Story 7.5 — Trash does not exist yet; here re-import is just no-dup + cache-refresh.)
  - [x] Add `reconcile_library() -> None` (AC-4): under `_mutate_index`, list `library/*/` dirs; for each dir absent from `papers`, read its `meta.json` (skip on missing/corrupt, best-effort) and append an Uncategorized entry with a cache built from meta; for each `papers` entry whose dir is gone, prune it. Keep `order` stable for surviving entries; assign appended entries the next order values. Idempotent (a second call is a no-op on a converged store).

- [x] **Task 3, Route: `GET /api/library` (AC: 3, 5)** [`server/app/routes/library.py` (new), `server/app/routes/__init__.py`]
  - [x] Create `server/app/routes/library.py` with `router = APIRouter(tags=["library"])` and `@router.get("/library", response_model=Library) -> get_library()`, delegating to `storage.read_library()`. Map `storage.StorageError` → 500 `{ "detail": "Could not read library" }` (the single envelope, AR-11), mirroring `get_annotations`'s error mapping. The route is thin: no filesystem access, no domain logic (AD-9).
  - [x] Register it in `server/app/routes/__init__.py`: `from app.routes.library import router as library_router` + `api_router.include_router(library_router)`. Update the module docstring: `library` is now exposed; drop `GET /api/docs/{doc_id}` etc. from the stale "Reserved" list wording as needed (leave `GET /api/docs` list — that endpoint is NOT built in this story, see Dev Notes "Scope fence").
  - [x] `GET /api/library` returns `Library` from one lock-free read; do NOT trigger reconcile on the request path (reconcile is a boot concern, Task 4).

- [x] **Task 4, Boot: run `reconcile_library()` at startup (AC: 4, 6)** [`server/app/main.py`]
  - [x] Add a FastAPI `lifespan` (async context manager) to the `FastAPI(...)` constructor that calls `storage.reconcile_library()` on startup (before yielding). It resolves the data root lazily at call time, so the test `data_root` fixture (isolated `PAPER_MATE_DATA`) is respected and a fresh/empty install is a safe no-op. Wrap the reconcile so a storage failure logs and does not abort boot (best-effort; a corrupt single doc must not brick the app). This is what makes AC-6 (import → restart → still lists) work without an O(N) scan on every `GET /api/library`.

- [x] **Task 5, Contract: regenerate OpenAPI + client types (AC: 3)**
  - [x] `cd server && PYTHONPATH= uv run python -m app.export_openapi` (writes `server/openapi.json`, gitignored), then `cd client && npm run gen:api` (regenerates `client/src/api/schema.d.ts`, committed). Never hand-author the types.
  - [x] Surface the new generated types in `client/src/api/client.ts` as type aliases mirroring the existing `export type Doc = components["schemas"]["Doc"]` pattern: `CollectionRow`, `Folder`, `Library`. **Defer** the `getLibrary()` fetch function to Story 6.3 (no consumer here → avoid an unused runtime export; 6.3 is the table that calls it). If an unused-export lint trips on the type aliases, drop them too and let 6.3 add them with its consumer.
  - [x] Update `docs/API.md` in the same change: move `GET /api/docs` note as needed, add a **`GET /api/library`** entry under Resources (200 → `Library`; 500 → `{ "detail": "Could not read library" }`), document the `library.json` shape + display-cache semantics + the `DocMeta` field additions (authors/file_type/status), and add a Story 6.2 changelog entry. (`GET /api/docs` list stays Reserved.)

- [x] **Task 6, Tests: storage + route + models + contract + regression fix (AC: 1–7)**
  - [x] `server/tests/test_storage.py`: **FIX the regression first** — `test_import_writes_source_and_meta` asserts `set(on_disk) == {6 fields}` EXACTLY; extending `DocMeta` adds `authors`/`file_type`/`status`, so update that expected set to the new 9-field schema (still `schema_version == 1`, still no `doc_id` inside meta). Then add: import writes a `library.json` entry (Uncategorized, untrashed, cache matches meta); `read_library()` returns the row in one read; re-import creates no duplicate row and refreshes the cache; `reconcile_library()` adds a dir-without-index as Uncategorized and prunes an index-entry-without-dir; a dir with a missing/corrupt `meta.json` is skipped, not fatal; `read_library()` on a fresh root returns empty `papers`/`folders`; an unknown `library.json` `schema_version` → `CorruptLibraryError`.
  - [x] Add a serialized-write test for AL-7: fire concurrent `_mutate_index`/`import_pdf` calls from threads and assert no entry is lost (the lock prevents a lost update). Keep it deterministic (small N; the assertion is on the final row set, not timing).
  - [x] `server/tests/test_docs.py` (or a new `server/tests/test_library.py`): `GET /api/library` returns 200 + `{papers, folders}` after an import (persistence-proof shape); empty collection → `{papers: [], folders: []}`; storage failure → 500 `{ "detail" }`. Note the CLAUDE.md sandbox caveat — the `TestClient`-backed tests can hang under the Codex review sandbox; the human runs the backend suite on the host.
  - [x] `server/tests/test_openapi.py`: add a test mirroring `test_openapi_contains_doc_model_and_upload_path` — assert `CollectionRow`, `Folder`, `Library` are in `components.schemas` and `/api/library` is in `paths` with a `get`. `server/tests/test_models.py`: round-trip the new models + defaults (a bare `DocMeta` defaults `file_type="pdf"`, `status="ready"`, `authors=None`).
  - [x] `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q` green (host); `cd client && npm run typecheck` clean; `cd client && npm test` green (the `Doc` type gained optional fields — reader consumers are unaffected, but run it to confirm).

- [x] **Task 7, Version bump (at merge)** [`server/pyproject.toml`]
  - [x] PATCH +1 at PR-merge (CLAUDE.md versioning): read the current `[project].version` first (it is `0.4.1` as of this writing) and bump the patch (`0.4.1 → 0.4.2`). Single source is `server/pyproject.toml`; never hard-code a version elsewhere. Confirm `server/tests/test_version.py` (pyproject vs `uv.lock`) stays green after the bump.

### Review Findings

Cross-model review run standalone through Codex (`codex exec --sandbox read-only`, working-tree diff vs `baseline_commit` `9abe42e` since this story's changes were uncommitted at review time). Codex ran the three-layer pass (Blind Hunter, Edge Case Hunter, Acceptance Auditor) sequentially (no subagent tool available to it) then triaged. Could not write its own report file (read-only sandbox rejected the patch); findings captured here instead. 0 High, 2 Medium, 1 Low, 1 dismissed.

- [x] [Review][Patch] Malformed `library.json` paper row escapes the `StorageError` taxonomy as a raw `KeyError` [`server/app/storage/__init__.py:224`] (Medium): `_upsert_paper_entry`/`_reconcile`/`_next_order` all do raw `entry["doc_id"]`/`entry["order"]` bracket access on rows straight off disk; only `read_library()`'s `CollectionRow.model_validate` path caught a malformed row (as `CorruptLibraryError`) — the mutate path (`import_pdf`, `reconcile_library`) did not, so a hand-corrupted row missing `doc_id`/`order` would raise a raw `KeyError`: through `import_pdf` that bypasses `POST /api/docs`'s `StorageError` catch (AR-11's single `{detail}` envelope broken, falls through to FastAPI's default 500), and through the boot `lifespan` it would crash startup entirely (violates AC-4's "never crashes boot, best-effort"). Fixed by validating every paper row has `doc_id`+`order` (dict, both keys present) inside `_read_index_unlocked` — the single choke point both `read_library()` and `_mutate_index()` go through — raising `CorruptLibraryError` there instead. Added `test_malformed_paper_row_raises_corrupt_not_keyerror` (asserts `CorruptLibraryError`, not `KeyError`, from `read_library()`, `import_pdf()`, and `reconcile_library()` against a row with `order` stripped).
- [x] [Review][Patch] The lifespan-triggers-reconcile wiring itself was untested [`server/tests/test_library.py`] (Low): every existing route test (this story's and pre-existing) uses a module-level `client = TestClient(app)` with no `with` block; empirically confirmed (`python -c` probe) that this pattern never runs FastAPI's `lifespan` startup, so no automated test actually proved `main.py`'s `_lifespan` → `storage.reconcile_library()` wiring executes at boot — only that `reconcile_library()` itself works in isolation (`test_storage.py`) and that it works live (manual own-server smoke, restart, `curl /api/library`). Added `test_app_startup_runs_reconcile` using `with TestClient(app) as boot_client:` (which does trigger lifespan) against a pre-existing on-disk doc with no `library.json`, asserting it appears after boot.
- [ ] [Review][Dismissed] `reconcile_library()` doesn't refresh the display cache for already-indexed papers, "violating AC-2": out of scope for this story by its own Task 2 spec — the reconcile subtask explicitly only adds unindexed dirs and prunes vanished ones ("Keep `order` stable for surviving entries"), never refreshes a surviving row's cache. Cache-refresh-on-write is wired through `import_pdf`'s `_upsert_paper_entry` call (AC-2's "refreshed on every index write" is satisfied at the write path that actually has a fresh `DocMeta` in hand); a future out-of-band `meta.json` mutation (e.g. Story 6.5's background extraction finishing) is explicitly called out in this story's own Dev Notes (AL-2) as that story's responsibility to wire its own cache-refresh write, not reconcile's.

Both patch findings fixed; full suite re-verified green (96 backend, up from 94; 861 client unaffected).

## Dev Notes

### The shape of this change (read first)

Today the backend is a "dumb store": `storage/` owns per-doc `library/{doc_id}/` dirs (`source.pdf` + `meta.json` + `annotations.json`), routes are thin pass-throughs, and there is **no cross-doc index** — nothing knows the *set* of papers except by scanning dirs. `GET /api/docs` (list) was deliberately left Reserved for exactly this story. This story adds the **collection index** as a new sibling file `~/.paper-mate/library.json` and the read endpoint `GET /api/library`, keeping storage the sole disk writer (AD-9) and routes thin.

Storage layout after this story (spine Structural Seed):

```text
~/.paper-mate/
  library.json          # NEW (AD-L1): authoritative index (folders, membership, trash, order)
                        #             + non-authoritative meta-derived display cache
  library/{doc_id}/     # existing: source.pdf + annotations.json + meta.json
```

### Authority split — where each field lives (AL-1, the load-bearing rule)

- **`meta.json` (per paper, authoritative for the paper's OWN fields):** `filename, title, authors, page_count, added, last_opened, file_type, status, schema_version`. This story ADDS `authors`/`file_type`/`status` here, additively.
- **`library.json` (authoritative for CROSS-doc state):** folder tree (incl. empty folders), membership (paper→≤1 `folder_id`), `trashed`, and inclusion + `order`. Plus a **non-authoritative display cache** of the meta-derived projection so the table renders in one read.
- **Conflict rule:** `meta.json` always wins; the cache is refreshed from meta on every index write. Never read a paper's own field from the cache as authoritative — the cache exists purely to avoid an N-file read on `GET /api/library` (NFR-4).
- Membership/trash/order live ONLY in `library.json`, never in `meta.json` (a paper does not know its folder). [Source: architecture-spine AD-L1; Consistency Conventions table]

### Why the display cache holds the full row (not just title/authors)

AL-1's wording emphasizes a "title/authors display cache", but the stated purpose is "so the table renders in one read (LNFR-4)" and `GET /api/library` must return `added`, `file_type`, and `status` too (AC-3 lists them). Reading those from N `meta.json` files on every list defeats the one-read goal. So the cache is the **full meta-derived projection** (title, authors, added, file_type, status), still non-authoritative and refreshed-on-write. This is the interpretation this story builds; see the Clarifications at the end if you want to confirm before coding. [Source: architecture-spine AD-L1; epics.md Story 6.2 AC "returns the collection rows ... from the display cache in a single read"]

### Serialized read-modify-write (AL-7) — why a lock, which lock

AL-2's background extraction (Story 6.5) will refresh a paper's cache from a background task **while** a user op may be mutating the same `library.json`. Whole-file last-writer-wins would drop one of them. So every mutation is a read-modify-write of the whole index under a **process-level lock** (AL-7 — the collection-index analogue of the AR-7 single-flight annotation autosave). Use a module-level `threading.Lock`: storage functions are synchronous and FastAPI runs sync route/background work in a threadpool, so a `threading.Lock` (not `asyncio.Lock`) is the correct primitive. Single-process/single-worker is the deployment model (AD-10 one container, single user), so a process-level lock is sufficient — do NOT reach for a cross-process file lock. **Reads are lock-free:** `_atomic_write`'s temp+rename means `os.replace` swaps the file atomically, so `read_library()` always sees a complete old-or-new file, never a torn write. [Source: architecture-spine AD-L7; storage `_atomic_write`]

### Boot reconcile (AL-1) — placement and resilience

Reconcile runs once at boot via a FastAPI `lifespan` startup hook, not on the request path (`GET /api/library` must stay a one-read, no scan). It exists because papers can appear on disk out-of-band relative to the index: the Story 6.1 single-file-bridge upload calls `POST /api/docs` → `import_pdf` (which, before this story, never wrote `library.json`), and every Epic 1–5 dev/test import predates the index entirely. On first boot after this story, reconcile indexes them all as Uncategorized. It must be **best-effort**: a single dir with a missing/corrupt `meta.json` is skipped (it can't be projected to a row) and must never crash boot. Resolve the data root lazily inside the reconcile so the test `data_root` fixture is honored and a lifespan on an empty root is a safe no-op. [Source: architecture-spine AD-L1 "Boot reconcile"; epics.md Story 6.2 AC-4]

### Why a `Library` wrapper `{papers, folders}` (not a bare `CollectionRow[]`)

`/api/library` is "the organization layer" (AL-6) — table AND folder tree read from one file. Returning a `Library` object with both lists (folders empty until Epic 7) means Story 6.3 (table + count) and Epic 7 (folder panel) both consume this one endpoint with **no later contract change**. A bare `CollectionRow[]` would force a breaking response reshape when folders land. The count line "N files in library" (Story 6.3) is `papers.length` client-side — do NOT add a count field. [Source: architecture-spine AD-L6 "/api/library = the organization layer (table via display cache + folders CRUD)"]

### Scope fence — what this story does NOT build

- **No `GET /api/docs` (list).** The collection list is `GET /api/library` (via the cache), not a docs-list scan. `GET /api/docs` stays Reserved. [AD-L6]
- **No extraction.** `authors`/`status` fields are added with benign defaults; the `extract()`/`enrich()` domain module, PyMuPDF, the AGPL relicense, background tasks, and the `extracting → ready | enrich-skipped | parse-failed` transitions are all **Story 6.5**. A 6.2 import is immediately `ready`. Do NOT add PyMuPDF or expand `_parse_pdf` (title still comes from pypdf `/Info`, authors stays `null`). [AD-L2, epics.md Story 6.5]
- **No folders / trash / move behaviour.** `Folder` model is defined (generated type), `folders: []`, every paper Uncategorized + untrashed. Folder CRUD, `/api/library/folders`, and set-based `move/trash/restore` are **Epic 7**. [AD-L5/AD-L6, epics.md Epic 7]
- **No table UI, no dropzone, no polling.** The collection table + count + skeleton is Story 6.3; bulk optimistic upload + polling is Story 6.4. Client scope here is contract regeneration only. [epics.md Stories 6.3/6.4]

### `DocMeta` extension breaks an exact-set test (regression heads-up)

`server/tests/test_storage.py::test_import_writes_source_and_meta` asserts `set(on_disk) == {filename, title, page_count, added, last_opened, schema_version}` EXACTLY. Adding `authors`/`file_type`/`status` to `DocMeta` changes the written key set → this test WILL fail until you update the expected set to the new 9 keys. `schema_version` stays `1` (additive, no bump). Fix this in the same change (Task 6). No other test pins the meta field set (checked). [Source: server/tests/test_storage.py:48]

### Models / literals — house style

`Annotation.type` and `anchor.kind` use `Literal[...]`, not `enum.Enum`. Matching that, `status` and `file_type` as `Literal[...]` on the field is the idiomatic choice and openapi-typescript still generates a string-union TS type (satisfies AC-3 "status enum ... generate the TS client types"). If you want a single **named** reusable component in `components.schemas` (referenced by both `DocMeta` and `CollectionRow`), use `class PaperStatus(str, Enum)` / `class FileType(str, Enum)` instead — also fine, slightly more ceremony. Either satisfies the AC; keep the two definitions in lockstep whichever you pick. [Source: server/app/models.py Annotation/anchor]

### Testing standards

- pytest, storage isolated via the `data_root` fixture (`PAPER_MATE_DATA` → `tmp_path`); build PDFs with `make_pdf_bytes(pages, title)` from `tests/conftest.py` (no committed binaries). Route tests use `TestClient(app)`.
- The `lifespan` reconcile runs when `TestClient(app)` starts up. Under the isolated empty `data_root` it is a no-op; a route test that first `import_pdf`s then GETs `/api/library` proves the import→index path (reconcile is not needed for that, `import_pdf` indexes directly).
- **Sandbox caveat (CLAUDE.md):** the `TestClient`-backed tests (and now the lifespan) can hang under the Codex review sandbox; a reviewer verifies backend findings by reading, and the human runs `PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q` on the host. `uv` needs a writable cache in-sandbox (`export UV_CACHE_DIR=/tmp/uv-cache`).
- No geometry/UI here, so no DPR>1 live smoke is required (AE-5 applies to placement features; this story renders nothing). A one-shot manual sanity check is enough: import a PDF via `POST /api/docs`, restart the server, `curl /api/library` shows the paper (AC-6).

### Project Structure Notes

- New: `server/app/routes/library.py`, `~/.paper-mate/library.json` (runtime artifact, not committed). Extended: `server/app/models.py` (+`CollectionRow`/`Folder`/`Library`, `DocMeta` fields), `server/app/storage/__init__.py` (+library I/O, lock, reconcile), `server/app/routes/__init__.py` (register), `server/app/main.py` (lifespan), `docs/API.md`, `client/src/api/schema.d.ts` (regenerated), `client/src/api/client.ts` (type aliases). This lands the spine's `server/app/` "routes: + library.py; storage: extended; models.py + CollectionRow/Folder" additions. The `server/app/domain/` dir is NOT created here (Story 6.5). [Source: architecture-spine Structural Seed]
- Downward-dependency rule (AD-9) intact: `library.py` route → `storage` only; storage is the sole disk writer; client reaches the backend only through the generated client.

### DECISION notes (defaults chosen; confirm if you disagree)

1. **Display cache = full meta-derived projection** (title, authors, added, file_type, status), not just title/authors — required for `GET /api/library` to be one read (see the dedicated note above). Alternative: cache only title/authors and read added/file_type/status from each `meta.json` (violates the one-read goal; rejected).
2. **`Library` response wrapper `{papers, folders}`** over a bare `CollectionRow[]` (forward-compatible with Epic 7 folders; see note above).
3. **6.2 import status = `ready`.** No extraction pipeline exists yet, so a freshly imported paper is settled, not `extracting`. Story 6.5 switches import to set `extracting` and kick the background task.
4. **`threading.Lock`, process-level, reads lock-free** (see AL-7 note). Not `asyncio.Lock`, not a cross-process file lock.
5. **Reconcile at `lifespan` startup**, not lazily on first GET (keeps GET a pure one-read).

### References

- [Source: .bmad/planning-artifacts/epics.md#Story-6.2] — the 7 ACs (index, display cache, GET /api/library, boot-reconcile, serialized RMW, persistence proof, additive schema)
- [Source: .bmad/planning-artifacts/epics.md#Library-Additional-Requirements] — AL-1 (authority split), AL-2 (extraction is 6.5, not here), AL-6 (API boundary), AL-7 (write concurrency), AL-8 (inherited AD-3/AD-6/AD-8/AD-9), AL-9 (structural additions)
- [Source: architecture-paper-mate-library-2026-07-04/ARCHITECTURE-SPINE.md#AD-L1] — collection store & authority split, display cache, boot reconcile, schema_version additive
- [Source: ...#AD-L6] — `/api/docs` = document vs `/api/library` = organization; `GET /api/library` = table via display cache, one fast read, poll target
- [Source: ...#AD-L7] — serialize all `library.json` mutations under a process-level lock (RMW of the whole index), atomic temp+rename stands
- [Source: ...#Structural Seed] — `library.json` sibling of `library/`; `server/app/` routes/library.py + storage extension + models additions; `domain/` is 6.5
- [Source: ...#Consistency Conventions] — meta.json extended `{... authors, file_type, status ...}`; folder id = UUIDv4, name mutable; index writes serialized RMW + atomic
- [Source: server/app/storage/__init__.py] — `_atomic_write` (temp+rename), `_read_meta`/`read_meta`, `import_pdf` (idempotent by doc_id), `_data_root`; storage is the only disk writer
- [Source: server/app/models.py] — `DocMeta` (extend), `Doc(DocMeta)`, `Literal` house style (Annotation.type / anchor.kind)
- [Source: server/app/routes/docs.py] — mirror `get_annotations`'s `StorageError → 500 {detail}` mapping for `get_library`
- [Source: server/app/routes/__init__.py] — `api_router` registration pattern
- [Source: server/app/main.py] — add `lifespan`; `_custom_openapi` already documents the 422 envelope (new route inherits it)
- [Source: server/tests/conftest.py] — `data_root` fixture, `make_pdf_bytes`, `sha256_hex`
- [Source: server/tests/test_storage.py:48] — the exact-field-set assertion that the `DocMeta` extension breaks (must update)
- [Source: server/tests/test_openapi.py] — mirror `test_openapi_contains_doc_model_and_upload_path` for the new models/path
- [Source: docs/API.md] — add `GET /api/library` to Resources + changelog; `GET /api/docs` list stays Reserved
- [Source: CLAUDE.md] — storage-only disk I/O, generated types never hand-authored, contract-regen commands, backend-test sandbox caveat, versioning (PATCH +1 at merge), no em-dash in any user-facing string

## Dev Agent Record

### Agent Model Used

Sonnet 5 (bmad-dev-story).

### Debug Log References

- `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q` → 94 passed pre-review, 96 passed post-review-fixes (up from 38 pre-story).
- `codex exec --sandbox read-only` (`bmad-code-review`, standalone, working-tree diff vs `baseline_commit`): 0 High, 2 Medium (both fixed), 1 Low (fixed), 1 dismissed (out of scope, see Review Findings above).
- `cd server && uv run python -m app.export_openapi` → `server/openapi.json` regenerated.
- `cd client && npm run gen:api` → `client/src/api/schema.d.ts` regenerated, confirmed `CollectionRow`/`Folder`/`Library`/`GET /library` present.
- `cd client && npm run typecheck` → clean after updating 3 stale `Doc` test fixtures missing `file_type`/`status`.
- `cd client && npm test -- --run` → 861 passed (43 files).
- `uv lock` after the version bump (0.4.1 → 0.4.2); `test_pyproject_and_lock_version_match` stays green.
- Live smoke: own `uvicorn` on an isolated scratch `PAPER_MATE_DATA` (ports 8123 → restarted on 8124, no reload flag). `GET /api/library` on an empty root → `{"papers":[],"folders":[]}`; imported a real PDF (`fixtures/sample-pdfs/Microsoft COCO...pdf`) via `POST /api/docs`; `GET /api/library` showed the row (Uncategorized, untrashed, order 0, cache matching meta); killed the process and booted a fresh one on the same data root → `GET /api/library` still showed the row (AC-6 persistence-across-restart proof, exercising the `lifespan` boot reconcile path). No UI in this story (no DPR>1 smoke required, per Dev Notes).

### Completion Notes List

- Models (`server/app/models.py`): extended `DocMeta` additively with `authors: str | None`, `file_type: Literal["pdf","note"]`, `status: Literal["extracting","ready","enrich-skipped","parse-failed"]` (new fields before `schema_version`, no schema-version bump); added `Folder`, `CollectionRow`, `Library` per the house `Literal[...]` style (matches `Annotation.type`/`anchor.kind`).
- Storage (`server/app/storage/__init__.py`): added `LIBRARY_SCHEMA_VERSION`, `_library_path()` (sibling of `library/`), `CorruptLibraryError`, a module-level `threading.Lock` + `_mutate_index()` single read-modify-write path (AL-7; reads are lock-free), `_cache_from_meta`/`_next_order`/`_upsert_paper_entry` helpers, `read_library()` (one lock-free read, validates via `CollectionRow`/`Folder.model_validate`), and `reconcile_library()` (adds unindexed dirs as Uncategorized, prunes vanished dirs, best-effort skip on missing/corrupt `meta.json`, idempotent). Wired `import_pdf` to upsert the index entry on both new-import and idempotent-reimport paths.
- Route (`server/app/routes/library.py`, new): thin `GET /api/library` → `storage.read_library()`, `StorageError` → 500 `{detail}` mirroring `get_annotations`. Registered in `routes/__init__.py`; updated its module docstring.
- Boot (`server/app/main.py`): added a `lifespan` context manager calling `storage.reconcile_library()` before yielding, wrapped in try/except so a reconcile failure logs and never aborts boot.
- Contract: regenerated `server/openapi.json` (gitignored) + `client/src/api/schema.d.ts` (committed); added `CollectionRow`/`Folder`/`Library` type aliases to `client/src/api/client.ts` with no fetch function yet (deferred to Story 6.3, its first consumer, per the story's own guidance — avoids an unused runtime export). Updated `docs/API.md`: `Doc` example + prose gain the three new fields, new `GET /api/library` Resources entry (shape, semantics, boot-reconcile note), changelog entry.
- Tests: fixed the `test_import_writes_source_and_meta` regression (6 → 9 expected on-disk keys). Added storage tests for empty-root read, import-indexes-as-Uncategorized, reimport-refreshes-cache-without-duplicate, reconcile add/prune/corrupt-skip/idempotent, unknown-schema-version → `CorruptLibraryError`, and a threaded concurrent-import test proving AL-7's lock prevents a lost update. Added `server/tests/test_library.py` (route: empty collection, row-after-import shape, storage-failure → 500). Extended `test_models.py` (DocMeta defaults/round-trip, Folder/CollectionRow/Library round-trip) and `test_openapi.py` (new models + `/api/library` path present in `components.schemas`/`paths`).
- Client fixture fix (incidental, required for `npm run typecheck` to stay green after `Doc` gained two new required-ish fields): `Reader.test.tsx`, `LibraryPage.test.tsx`, `ReaderPage.test.tsx` each had a hand-built `Doc` fixture; added `file_type: "pdf"`, `status: "ready"` to all three.
- Version: bumped `server/pyproject.toml` `0.4.1 → 0.4.2` (PATCH, per-story convention) and re-ran `uv lock` to keep `uv.lock` in sync (`test_pyproject_and_lock_version_match` green).

### File List

**Backend**
- `server/app/models.py` (extended `DocMeta`; added `Folder`, `CollectionRow`, `Library`)
- `server/app/storage/__init__.py` (added `LIBRARY_SCHEMA_VERSION`, `_library_path`, `CorruptLibraryError`, `_index_lock`, `_default_index`, `_read_index_unlocked`, `_write_index`, `_mutate_index`, `_cache_from_meta`, `_next_order`, `_upsert_paper_entry`, `read_library`, `reconcile_library`; wired `import_pdf`)
- `server/app/routes/library.py` (new: `GET /api/library`)
- `server/app/routes/__init__.py` (registered `library_router`; docstring update)
- `server/app/main.py` (added `lifespan` calling `storage.reconcile_library()` at boot)
- `server/pyproject.toml` (version `0.4.1` → `0.4.2`)
- `server/uv.lock` (re-locked for the version bump)
- `server/openapi.json` (regenerated, gitignored build artifact)
- `server/tests/test_storage.py` (fixed the 6→9-field regression; added `library.json` storage tests + AL-7 concurrency test)
- `server/tests/test_library.py` (new: `GET /api/library` route tests)
- `server/tests/test_models.py` (added `DocMeta`/`Folder`/`CollectionRow`/`Library` tests)
- `server/tests/test_openapi.py` (added the new models + `/api/library` path assertion)

**Client**
- `client/src/api/schema.d.ts` (regenerated from the updated OpenAPI contract)
- `client/src/api/client.ts` (added `CollectionRow`/`Folder`/`Library` type aliases; no fetch function yet, deferred to Story 6.3)
- `client/src/components/Reader/Reader.test.tsx` (fixture: added `file_type`/`status` to the hand-built `Doc`)
- `client/src/library/LibraryPage.test.tsx` (fixture: added `file_type`/`status` to the hand-built `Doc`)
- `client/src/reader/ReaderPage.test.tsx` (fixture: added `file_type`/`status` to the hand-built `Doc`)

**Docs**
- `docs/API.md` (`Doc` example + prose updated; new `GET /api/library` Resources entry; changelog entry)
