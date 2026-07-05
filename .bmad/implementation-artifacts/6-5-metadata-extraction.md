---
baseline_commit: e85dfb3a279a8ea3b251d7792c206951bd33cb7a
---

# Story 6.5: Backend metadata extraction (extract + enrich)

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a reader,
I want the Title and Authors filled in automatically after I upload,
so that the table is useful without me typing metadata.

This is the **risk-gate** story of Epic 6: it opens the backend **domain layer** (AD-L2, its first tenant), adds the **PyMuPDF** parse dependency (and the license flip that comes with it), and turns Story 6.4's client-side `extracting` transient into a **real, backend-driven** lifecycle. On a new upload, `POST /api/docs` now stores the paper at `status: "extracting"` and returns immediately; a **background task** runs `extract()` (embedded `/Info` + XMP, then a font-size heuristic, via PyMuPDF in-process) then `enrich()` (Crossref DOI-first, title/author fallback), and **storage** (the only writer) persists the result to `meta.json` and refreshes the `library.json` display cache. The status settles to `ready | enrich-skipped | parse-failed`; the client **polls `GET /api/library`** until every row settles, then stops, and surfaces a **non-error** notice for any paper whose enrichment was skipped. A paper is **never lost**: a failed parse still lands as a filename-title row, editable in Story 6.6.

## Acceptance Criteria

1. **Domain layer, pure (AD-L2).** Extraction lives in a bounded, **pure** `server/app/domain/` module — the first tenant of a backend domain layer above storage — exposing exactly `extract(pdf_bytes: bytes) -> ExtractedMeta` and `enrich(meta: ExtractedMeta) -> ExtractedMeta | "skipped"`. The domain module **never touches disk and never imports `storage`** (it takes bytes in, returns data out); `enrich` is the only code that makes a network call. The `extract()` seam stays **GROBID-swappable** (signature `bytes -> ExtractedMeta`, no side effects). [Source: ARCHITECTURE-SPINE#AD-L2; epics.md#Story-6.5]

2. **`extract` resolves Title + Authors + DOI via rungs 1→2 (LFR-8, AD-L2).** `extract` opens the PDF from bytes with **PyMuPDF in-process** and resolves fields best-effort: **rung 1** = embedded `/Info` dictionary (`doc.metadata`) + **XMP** (`doc.get_xml_metadata()`, `dc:title`/`dc:creator`); **rung 2** = a **font-size heuristic** over page 0 (`page.get_text("dict")` spans) picks the largest-font top-of-page text as the Title when rung 1 gives none. It also extracts a **DOI** (regex `10.\d{4,9}/[-._;()/:A-Za-z0-9]+`, case-insensitive) from `/Info`/XMP/first-page text for `enrich` to key on. `extract` is **total**: any PyMuPDF failure on a stored-but-pathological PDF returns an empty `ExtractedMeta()` (never raises). [Source: ARCHITECTURE-SPINE#AD-L2; PyMuPDF API below]

3. **`enrich` corrects via Crossref, DOI-first, degrades to "skipped" (LFR-9, NFR-1, L-UX-DR9).** When online, `enrich` queries **Crossref DOI-first** (`GET https://api.crossref.org/works/{doi}`) then falls back to a **title/authors bibliographic query** (`GET https://api.crossref.org/works?query.bibliographic=...&rows=1`), returning a corrected `ExtractedMeta`. When **offline, on any HTTP failure/timeout/non-200/no-match, OR when the input has neither a DOI nor a title** (nothing to query), it returns the literal `"skipped"` — it **never raises and never blocks the add**. `enrich` never makes more than the bounded Crossref calls and uses a short timeout with a polite `User-Agent` (see Dev Notes). [Source: ARCHITECTURE-SPINE#AD-L2; epics.md#Story-6.5; addendum.md#Metadata-extraction]

4. **Background task, never on the request path (NFR-3, AD-L2).** For a **new** import, `POST /api/docs` persists the paper at `status: "extracting"` and returns immediately; the `extract`→`enrich`→persist orchestration runs as a **FastAPI background task** off the request/response path. An **idempotent re-import** of an already-settled paper does **not** re-extract (it returns the existing `meta.json` untouched, only `last_opened` advances). [Source: ARCHITECTURE-SPINE#AD-L2, AD-L4; storage `import_pdf`]

5. **Status lifecycle `extracting → ready | enrich-skipped | parse-failed` (AD-L4, LFR-10).** After the background task runs, storage persists the terminal status: **`ready`** when enrich succeeded (corrected metadata); **`enrich-skipped`** when extract produced usable local fields but enrich returned `"skipped"` (local fields kept); **`parse-failed`** when extract produced **no title and no authors** and enrich also skipped — the paper stays a **filename-title row** (title `null` → client filename fallback), fully **interactive and editable** (Story 6.6), **never lost**. (A DOI-only PDF whose local parse found no title but whose DOI enriches successfully settles to `ready`, not `parse-failed`.) [Source: epics.md#Story-6.5; ARCHITECTURE-SPINE#AD-L4]

6. **Storage is the only writer; the domain module persists nothing (AD-L2, AD-1/AD-9).** Extraction **returns data**; a new storage function (e.g. `apply_extraction(doc_id, title, authors, status)`) is the sole code that writes the resolved Title/Authors/status to `meta.json` and refreshes the `library.json` display cache, through the existing serialized index-write path (`_mutate_index` / `_index_lock`, AD-L7). The domain module imports no `storage`. A paper **purged** mid-extraction (dir gone) is a best-effort no-op, never a crash. [Source: ARCHITECTURE-SPINE#AD-L2, AD-L7, AD-L9; storage `_mutate_index`/`_upsert_paper_entry`]

7. **Client polls `GET /api/library` until settle, then stops (AD-L2, NFR-3).** After a bulk batch settles, if any row is `status: "extracting"` the Library **polls `GET /api/library`** on an interval and updates rows in place as statuses resolve; polling **stops** the moment no row is `extracting` (a bounded safety cap prevents an infinite loop if a status is stuck). A real (stored, has `doc_id`) `extracting` row is **openable/selectable** (only Story 6.4's pre-`doc_id` optimistic pending rows stay non-interactive). Polling is unmount-safe. [Source: ARCHITECTURE-SPINE#AD-L2; 6-4 `handleBatchSettled`]

8. **Enrich-skipped surfaces a NON-error notice, distinct from the error toast (LFR-9, L-UX-DR9).** When the batch settles, any paper that ended `enrich-skipped` raises a **non-error** notice ("Enrichment skipped." / "Enrichment skipped for N papers.") that is **visually distinct** from the upload-failure error `Toast` (a muted/info treatment, not the dark error surface). `parse-failed` rows are conveyed by their own row treatment + filename fallback (editable in 6.6), not the error toast. No new string contains an em-dash. [Source: epics.md#Story-6.5, #L-UX-DR9, #L-UX-DR13]

9. **PyMuPDF added → repo relicenses MIT → AGPL-3.0 in the same change (AD-L9, spine Deferred).** Adding PyMuPDF (AGPL-3.0, copyleft) requires relicensing the repo **MIT → AGPL-3.0 in this same change**: replace `LICENSE` with the canonical GNU AGPL-3.0 text, and update every MIT reference (`README.md` badge + License section; add an SPDX `license` to `server/pyproject.toml`). [Source: ARCHITECTURE-SPINE#Deferred (relicense), #Stack (PyMuPDF); epics.md#Story-6.5]

10. **Contract + docs consistency.** The API **shape** is unchanged (the `status` enum already carried all four values since Story 6.2, so **no `schema.d.ts` regen** is expected — regenerate only to *prove* zero diff). `docs/API.md` is updated in this same change: `POST /api/docs` now documents the async-extraction behavior (new import returns `extracting`; extraction runs in the background; poll `GET /api/library`), plus a Changelog entry. [Source: CLAUDE.md (contract types, API.md); client `schema.d.ts` already has the 4-value enum]

## Tasks / Subtasks

- [x] **Task 1, License flip MIT → AGPL-3.0 (AC: 9)** [`LICENSE`, `README.md`, `server/pyproject.toml`]
  - [x] Replace `LICENSE` (currently the MIT text) with the **full, verbatim GNU Affero General Public License v3.0** text (the canonical FSF text). Do this **before** adding PyMuPDF in Task 2, so no commit in this branch ships an AGPL dependency under an MIT license.
  - [x] `README.md`: change the badge `License: MIT` → `License: AGPL-3.0` (both the shields.io badge label/URL on line ~12 and the `## License` section text + link on line ~105-107). Keep the copy em-dash-free.
  - [x] `server/pyproject.toml`: add `license = "AGPL-3.0-or-later"` (SPDX expression) to `[project]`. Verify `uv run python -c "import app.main"` still imports and `uv build` (if run) doesn't choke on the license field. Do NOT invent a client `package.json` license field where none exists today (it has none — leave it).
  - [x] Add a one-line rationale comment near the dependency in `pyproject.toml` or the story record: PyMuPDF is AGPL-3.0; the combined distributed work is therefore AGPL. Personal local-only use never triggers distribution, but the repo license must be honest. [Source: ARCHITECTURE-SPINE#Deferred, #Stack]

- [x] **Task 2, Add PyMuPDF + promote httpx to a runtime dep (AC: 1, 2, 3)** [`server/pyproject.toml`, `server/uv.lock`]
  - [x] `cd server && uv add pymupdf` — pin the exact current stable patch (per ARCHITECTURE-SPINE#Stack "verify + pin exact patches at scaffold"; PyMuPDF is ~1.26.x as of this sprint). Canonical import is `import pymupdf` (the `fitz` alias still works; use `pymupdf`).
  - [x] Move **httpx** from `[dependency-groups].dev` to `[project].dependencies` (pin a compatible patch) — `enrich` needs it at runtime, not just in tests. Confirm no version clash with the FastAPI/uvicorn stack.
  - [x] Re-run `uv lock`; confirm `server/tests/test_version.py` (pyproject `version` ↔ `uv.lock` recorded version) stays green after this and the Task 8 bump.

- [x] **Task 3, `ExtractedMeta` model + shared `DocStatus` alias (AC: 1, 5)** [`server/app/models.py`]
  - [x] Add a **type alias** `DocStatus = Literal["extracting", "ready", "enrich-skipped", "parse-failed"]` and reference it in **both** `DocMeta.status` and `CollectionRow.status` (replace the two duplicated inline `Literal[...]`). Keep the model **default** `= "ready"` on `DocMeta.status` (an old v1 `meta.json` with no `status` is an already-settled pre-extraction doc → `ready`). This is a same-change tidy, not a behavior change; it must not alter the emitted OpenAPI enum.
  - [x] Add `ExtractedMeta(BaseModel)`: `title: str | None = None`, `authors: list[str] = []` (a **list** of author names — the domain's honest shape; storage joins to the display string), `doi: str | None = None`. It is **internal** (returned by no route), so it stays out of the OpenAPI schema and needs no client type. Document that in its docstring.
  - [x] Confirm (do not assume) via Task 7 that `PYTHONPATH= uv run python -m app.export_openapi` + `npm run gen:api` produce **zero diff** to `server/openapi.json` / `client/src/api/schema.d.ts` (the enum was already 4-valued; `ExtractedMeta` is unreferenced).

- [x] **Task 4, The pure domain module: `extract` + `enrich` (AC: 1, 2, 3)** [`server/app/domain/__init__.py` (new), `server/app/domain/extraction.py` (new), `server/tests/test_domain.py` (new)]
  - [x] `domain/extraction.py` exposes `extract(pdf_bytes) -> ExtractedMeta` and `enrich(meta) -> ExtractedMeta | Literal["skipped"]`; `domain/__init__.py` re-exports them. **Imports allowed: `pymupdf`, `httpx`, `re`, `app.models`. NOT allowed: `app.storage`, `os`, `pathlib`, any disk/FS access** (enforce with a review/test check — a pure layer). [Source: ARCHITECTURE-SPINE#AD-L2, dependency arrows]
  - [x] `extract`: open `pymupdf.open(stream=pdf_bytes, filetype="pdf")` inside a `try/except Exception` that returns `ExtractedMeta()` on any failure (AC-2 totality). Rung 1: read `doc.metadata` (`title`, `author`) and `doc.get_xml_metadata()` (parse `dc:title`, `dc:creator`); treat blank/whitespace as absent. Rung 2 (title only, when rung 1 has none): scan `page.get_text("dict")["blocks"][…]["lines"][…]["spans"]` on page 0, group by `size`, take the largest-size span text near the top as the title candidate. Extract DOI via the AC-2 regex over `/Info`+XMP+`page0.get_text()`. **Authors font-heuristic is out of scope this sprint** — authors come from `/Info`/XMP (and Crossref); do not build a fragile author-block detector. Close the document (`doc.close()`).
  - [x] `enrich`: if `meta.doi` is None and `meta.title` is None → return `"skipped"` (no network call). Build a sync `httpx.Client(timeout=~5.0, headers={"User-Agent": "PaperMate/<version> (mailto:...)"})`; DOI-first `GET .../works/{quote(doi)}`, else `GET .../works?query.bibliographic=<title>&rows=1` (add `query.author` if authors present). Parse `message.title[0]` and `message.author` (`"{given} {family}"` join). Any exception / non-200 / empty result → `return "skipped"`. Return a new `ExtractedMeta(title=..., authors=[...], doi=meta.doi)`. **Never** raise out of `enrich`. [Source: Crossref REST notes below]
  - [x] Tests (`test_domain.py`): build deterministic input PDFs **in-code with PyMuPDF** (`doc.set_metadata({...})` + `page.insert_text(...)` incl. a known DOI string) rather than checking in binaries. Cover: `/Info`-title+author extracted; XMP fallback; font-heuristic title when `/Info` empty; DOI regex hit; a blank/image-only doc → empty `ExtractedMeta`. For `enrich`, **mock httpx** (monkeypatch `httpx.Client` or use a transport stub — **never hit the real network**): DOI-hit success, title-fallback success, offline/timeout → `"skipped"`, and no-DOI/no-title → `"skipped"` with **zero** HTTP calls asserted.

- [x] **Task 5, Storage writer `apply_extraction` + new-import `extracting` (AC: 4, 5, 6)** [`server/app/storage/__init__.py`, `server/tests/test_storage.py`]
  - [x] In `import_pdf`, the **new-document** branch builds its `DocMeta(...)` with **`status="extracting"`** (leave the idempotent re-import branch untouched — it copies the existing meta, preserving its settled status). **Do NOT change `import_pdf`'s return signature** (it stays `tuple[str, DocMeta]`): the route decides whether to schedule extraction by reading `meta.status == "extracting"`, so none of the ~40 existing `import_pdf` call-sites/tests need re-unpacking.
  - [x] Add `apply_extraction(doc_id: str, *, title: str | None, authors: str | None, status: DocStatus) -> None` (the **only** persistence path for extraction results): re-read the current `meta.json` (fresh, so it can't clobber a concurrent `last_opened` write with stale fields), `model_copy(update={title, authors, status})`, `_write_meta`, then `_mutate_index(lambda idx: _upsert_paper_entry(idx, doc_id, updated_meta))` to refresh the display cache under the AD-L7 lock. If the doc dir/meta is gone (purged mid-flight) → `DocumentNotFoundError`; the orchestrator swallows it (best-effort). Storage stays disk-only; it imports nothing from `domain`.
  - [x] Update the existing storage/library tests that assert a *fresh* import's status: `test_storage.py:68` (`on_disk["status"]`) and `test_storage.py:363` (`row.status == meta.status`) now expect **`"extracting"`** (import no longer runs extraction inline — that is the route's background job). Add tests: `apply_extraction` persists title/authors/status + refreshes the cache; is idempotent; and is a best-effort no-op for a missing doc. Leave `test_models.py` status assertions alone (the model default is unchanged at `ready`).

- [x] **Task 6, Route: schedule the background orchestration (AC: 4, 5, 6)** [`server/app/routes/docs.py`, `server/tests/test_docs.py`, `server/tests/test_library.py`]
  - [x] Add a **sync** module-level orchestrator `run_extraction(doc_id: str, pdf_bytes: bytes) -> None` in `routes/docs.py` (the composition root; AD-L2 amends CLAUDE.md's "routes are thin" for this seam — the route is the diagram's node that calls **both** `domain` and `storage`). It: `extracted = domain.extract(pdf_bytes)`; `enriched = domain.enrich(extracted)`; resolve `(title, authors, status)` per AC-5 (see Dev Notes "Status resolution"); `try: storage.apply_extraction(...) except storage.DocumentNotFoundError: pass`. It must **not raise** (a background task's exception is swallowed by Starlette but would leave the row stuck `extracting`); wrap defensively and, on an unexpected failure, best-effort persist `status="parse-failed"` so the row still settles.
  - [x] `upload_doc`: accept `background_tasks: BackgroundTasks`; after a successful `import_pdf`, `if meta.status == "extracting": background_tasks.add_task(run_extraction, doc_id, raw)`. A **sync** `run_extraction` runs in Starlette's threadpool (off the event loop) — correct for PyMuPDF (CPU) + sync httpx (I/O). No `await` in the task.
  - [x] **TestClient runs background tasks synchronously after the response** — so `POST /api/docs` route tests would execute real extraction+enrich (real network → flaky). Every route/TestClient test that uploads MUST **monkeypatch `domain.enrich`** (and optionally `domain.extract`) to a deterministic stub, then assert the settled status. Update `test_library.py:38` accordingly (with `enrich` stubbed to `"skipped"`, a fixture PDF with an embedded title settles to `enrich-skipped`; assert that, or assert `in {"ready","enrich-skipped","parse-failed"}` where the exact value is not the point). Add a `test_docs.py` case: a new upload with `enrich` stubbed returns `status: "extracting"` in the POST response body AND, after the synchronous background task, `GET /api/docs/{id}` shows the settled status; a re-upload does not re-run extraction.
  - [x] **Sandbox caveat (CLAUDE.md):** the FastAPI `TestClient` suite can hang in the Codex review sandbox and backend pytest is run-it-yourself on the host. Prefer exercising `run_extraction` **directly** (call it with `domain.extract`/`enrich` stubbed and a real temp `PAPER_MATE_DATA`, assert the persisted status) for the core lifecycle coverage; keep TestClient cases minimal.

- [x] **Task 7, Contract regen proof + `docs/API.md` (AC: 10)** [`server/openapi.json`, `client/src/api/schema.d.ts`, `docs/API.md`]
  - [x] Run `cd server && PYTHONPATH= uv run python -m app.export_openapi` then `cd client && npm run gen:api`. **Expect zero diff** (the `status` enum was already 4-valued since 6.2; `ExtractedMeta` is unreferenced). If a diff appears, something leaked into the schema — investigate before proceeding; do not hand-edit generated files.
  - [x] Update `docs/API.md`: in `POST /api/docs`, change the response example/comment so a **new** import shows `"status": "extracting"` and add a paragraph: extraction (Title/Authors/DOI via PyMuPDF, optional Crossref enrich) runs as a **background task** off the request path; the client polls `GET /api/library` until statuses settle; an idempotent re-import does not re-extract. Drop the now-stale "null until Story 6.5 extraction fills it" / "lands immediately at status: ready" wording. Add a **Changelog** entry dated 2026-07-05 (Story 6.5): background extraction pipeline; new `domain/` pure layer (`extract`/`enrich`); `apply_extraction` storage writer; PyMuPDF added + repo relicensed MIT→AGPL-3.0; **no contract shape change**.

- [x] **Task 8, Client: poll-until-settle + enrich-skipped notice + status visuals (AC: 7, 8)** [`client/src/library/LibraryPage.tsx`+`.test.tsx`, `client/src/library/useSettlePolling.ts` (new)+`.test.ts`, `client/src/library/useBulkUpload.ts`, `client/src/library/CollectionTable.tsx`+`.css`+`.test.tsx`, `client/src/components/Toast/Toast.tsx`+`.css`+`.test.tsx`]
  - [x] **Poll seam.** Add a small, testable hook `useSettlePolling({ fetch, isSettled, intervalMs, maxPolls })` (or fold into a `useLibrarySync`) that, while `!isSettled(latest)`, refetches on an interval and hands the result up, stopping when settled or after a bounded `maxPolls` cap. Drive it from `LibraryPage`: `handleBatchSettled` still does the one authoritative `getLibrary()` reconcile, then — if any paper `status === "extracting"` — starts polling `getLibrary()` (~1200ms) until no paper is `extracting`; unmount-safe (clear timer on unmount and on settle); a new batch resets/continues the loop. **Do not** poll when nothing is `extracting` (keeps Story 6.4's ready-only tests green — they never enter the poll path).
  - [x] **Enrich-skipped notice (batch-scoped).** Have `useBulkUpload` surface the batch's resolved `doc_id`s (it already knows them from `onResolved`). When the poll settles, count **this batch's** rows that ended `enrich-skipped` and raise a **non-error** notice; do not re-notify previously-settled rows on a later batch. Copy: `Enrichment skipped.` (1) / `Enrichment skipped for N papers.` (>1). No em-dash.
  - [x] **Non-error notice UI.** Extend `Toast` with a `variant?: "error" | "info"` prop (default `"error"` to preserve all existing call-sites) + an `info`/muted CSS variant on a lighter surface (tokens only — put any new surface/color in `theme/components.css`/reference existing `{colors.*}`; `no-raw-values.test.ts` scans the CSS). Reuse `Toast`; do NOT add a second component. Render the enrich-skipped notice with `variant="info"`, keep upload-failure `Couldn't add…` as `variant="error"`. Both keep the Esc-dismiss + `role="status"` a11y.
  - [x] **Status visuals.** In `CollectionTable`, extend `statusLabel`/`rowStatusClass` (the 6.4 seam, keyed off `status`) for `enrich-skipped` and `parse-failed`: `extracting` → muted "Extracting" chip (existing); `enrich-skipped` → render as a **normal, fully-interactive** row (no persistent chip — the notice conveyed it); `parse-failed` → a subtle muted marker (e.g. a "Couldn't read metadata" caption or a muted chip) with the filename-title fallback, **still selectable/openable** (editable in 6.6). Critically: a **real** row (has `doc_id`) is interactive at **every** status including `extracting` — only Story 6.4's pre-`doc_id` `pending` rows stay non-interactive. Keep `prefers-reduced-motion` gating on any `extracting` pulse.
  - [x] Tests: `useSettlePolling` with **fake timers** (`vi.useFakeTimers()`) — polls until `isSettled`, stops after settle (assert no further `fetch`), respects `maxPolls`. `LibraryPage.test.tsx`: a batch whose `uploadDoc` returns `status: "extracting"` → poll fires `getLibrary` until the mock flips rows to settled → rows update in place → polling stops; an `enrich-skipped` result shows the `variant="info"` notice with the right count; a `parse-failed` row renders with the filename and is interactive (has an open handler). `CollectionTable.test.tsx`: label/class for all four statuses; a real `extracting` row is clickable, a `pending` row is not. `Toast.test.tsx`: `variant` renders the info vs error surface. Keep the existing 6.4 cases green (their `uploadDoc` mock returns `ready` → no poll path).

- [x] **Task 9, Live smoke (AC: 4, 5, 7, 8) — your OWN fresh servers**
  - [x] Per CLAUDE.md, launch your **own** fresh `uvicorn` + `vite dev` (alternate ports if 8000/5173 are taken) bound to YOUR working tree, against a scratch `PAPER_MATE_DATA`. Never reuse a server the user already has running (its backend predates PyMuPDF).
  - [x] **Online / ready:** upload a real paper that has a DOI (a fixture under `fixtures/sample-pdfs/`, e.g. the COCO paper). Confirm the row shows **Extracting**, then settles to **ready** with a Crossref-**corrected** Title/Authors; confirm in the Network panel that `GET /api/library` **polls** while extracting and **stops** once settled.
  - [x] **Offline / enrich-skipped:** block network (or point enrich at an unreachable host / pull the cable) and upload; confirm the row settles to **enrich-skipped** keeping its locally-parsed Title, and the **non-error info notice** appears (visually distinct from the red error toast).
  - [x] **Parse-failed:** upload a valid-but-metadata-poor PDF (image-only or one with no embedded/parseable title); confirm it settles to **parse-failed**, shows the **filename** as title, and the row is still **selectable and openable** (double-click opens the reader — proving real `extracting`/`parse-failed` rows are interactive, unlike pending rows).
  - [x] This is a **backend-extraction + table feature, NOT a geometry/placement/anchor feature** (no PDF coordinates, no canvas, no DPR-sensitive rects) — the AE-5 DPR>1 gate does **not** apply (same call as 6.3/6.4). One normal-DPR real-data pass suffices. [Source: CLAUDE.md AE-5 scope; [[verify-on-hidpi-and-real-host]]]
  - [x] Shut the servers down and remove the scratch data dir + any generated fixtures after.

- [x] **Task 10, Version bump (at merge)** [`server/pyproject.toml`, `server/uv.lock`]
  - [x] PATCH +1 at PR-merge (CLAUDE.md versioning): read `[project].version` (`0.4.4`) and bump `0.4.4 → 0.4.5`. Single source is `server/pyproject.toml`. Re-run `uv lock`; confirm `server/tests/test_version.py` stays green. (Do the Task 2 `uv add` bumps and this version bump so `uv.lock` ends consistent in one final `uv lock`.)

## Dev Notes

### The shape of this change (read first)

This is the **first backend story since Epic 3** — Stories 6.1–6.4 were client-only (router, table, bulk upload) on top of already-shipped storage/routes. 6.5 is where the **backend domain layer is born** (AD-L2) and the first new backend dependency (PyMuPDF, AGPL) lands. The seams already exist and are the ones to consume, not rebuild:

- **`import_pdf`** (storage) already validates the PDF (pypdf), computes `doc_id`, writes `source.pdf` + `meta.json` atomically, and upserts the `library.json` entry under the index lock. **Keep pypdf for the request-path validation + `page_count`** (cheap, MIT-clean); PyMuPDF is used **only** in the background `extract`. Do not rip out pypdf. [Source: server/app/storage/__init__.py:406-441, :155-171]
- **`_mutate_index` / `_upsert_paper_entry` / `_cache_from_meta`** are the concurrency-safe (AD-L7) cache-refresh path. `apply_extraction` refreshes the display cache **through** them — never a second write path to `library.json`. [Source: server/app/storage/__init__.py:241-292]
- **`GET /api/library`** already returns the table from the display cache in one read — it is both the table source and the **poll target**. No new endpoint. [Source: server/app/routes/library.py; ARCHITECTURE-SPINE#AD-L6]
- **Client status seam** already exists: `CollectionTable`'s `statusLabel`/`rowStatusClass` are keyed off `status` (built in 6.4 precisely so 6.5 drives real rows), and `handleBatchSettled` is the single reconcile that becomes the poll entry. [Source: client/src/library/CollectionTable.tsx:21-35,143-152; client/src/library/LibraryPage.tsx:127-140]
- **The `status` enum already carries all four values** in `models.py`, `openapi.json`, and `schema.d.ts` (6.2 forward-declared them). So this story is a **behavior** change, not a **contract** change: no client-type regen (Task 7 just proves the zero-diff). [Source: server/app/models.py:46,87; client/src/api/schema.d.ts:212,250]

### Layering (AD-9 downward rule + AD-L2 amendment)

```
route: POST /api/docs  ──(schedules)──▶ run_extraction (sync, threadpool)
                                          │
                    ┌─────────────────────┼───────────────────────┐
                    ▼                     ▼                        ▼
             domain.extract        domain.enrich            storage.apply_extraction
             (pymupdf, pure)   (httpx→Crossref, pure)   (ONLY disk writer, AD-L7 lock)
```

- **`domain/` is pure**: bytes/data in, data out; imports `pymupdf`, `httpx`, `re`, `app.models` — **never `app.storage`, never the filesystem**. `enrich` is the only network I/O in the whole backend.
- **`storage/` stays the sole disk writer** (AD-9): `apply_extraction` is a new *writer*, but domain results reach disk only through it.
- **The route is the composition root** that wires domain→storage — this is AD-L2 explicitly amending CLAUDE.md's "routes are thin, no domain logic" for the extraction seam (the spine's dependency diagram shows *Routes → Extraction* and *Routes → Storage*). Keep `run_extraction` small; if it grows, promote it to a `server/app/services/` module, but do not add that layer for ~15 lines now. [Source: ARCHITECTURE-SPINE#Design-Paradigm, #Invariants (mermaid), #AD-L2]

### Status resolution (the exact rule for `run_extraction`)

```python
extracted = domain.extract(pdf_bytes)          # never raises; may be empty
enriched  = domain.enrich(extracted)           # ExtractedMeta | "skipped"; never raises

if enriched != "skipped":
    final, status = enriched, "ready"
elif extracted.title or extracted.authors:
    final, status = extracted, "enrich-skipped"
else:
    final, status = extracted, "parse-failed"

title   = final.title                          # None -> client filename fallback
authors = ", ".join(final.authors) or None     # storage owns the list->display join
storage.apply_extraction(doc_id, title=title, authors=authors, status=status)
```

- A **DOI-only** paper (no local title/authors, but a DOI that enriches) → `enriched != "skipped"` → **`ready`**. That is why `extract` must pull the DOI even when it finds no title.
- `parse-failed` ⇒ no local title AND no local authors AND enrich skipped ⇒ the row keeps `title=None` → the table shows the **filename** (existing 6.3 fallback), editable in 6.6. **Never lost.**
- Wrap the whole body so an *unexpected* exception still best-effort persists `status="parse-failed"` (a row stuck at `extracting` forever is the worst outcome — the client would poll to its cap and give up with a permanently-muted row).

### PyMuPDF API (verified current; pin exact patch at scaffold)

Canonical import is `import pymupdf` (the `fitz` alias remains). Open from bytes, read metadata, XMP, and font-size spans:

```python
import pymupdf  # PyMuPDF ~1.26.x; `uv add pymupdf`

doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
info = doc.metadata                 # {"title": ..., "author": ..., "subject": ..., ...}  (note: "author", singular)
xmp  = doc.get_xml_metadata()       # XMP as a string ("" if none); parse dc:title / dc:creator
page = doc[0]
for block in page.get_text("dict")["blocks"]:
    if block.get("type") == 0:      # text block
        for line in block["lines"]:
            for span in line["spans"]:
                span["size"]        # font size (float) -> largest near top ≈ title
                span["text"]
doc.close()
```

- Treat empty/whitespace `/Info` values as **absent** (many PDFs ship `title=""`).
- The font heuristic is **title-only** and best-effort; do not over-fit. Authors come from `/Info`/XMP + Crossref.
- Extraction runs off the request path, so its cost is not user-visible; still, `doc.close()` promptly to free the MuPDF handle. [Source: context7 /pymupdf/pymupdf — metadata, get_text("dict"), open(stream=...)]

### Crossref REST (enrich)

- **DOI-first:** `GET https://api.crossref.org/works/{doi}` (URL-encode the DOI). Response `message.title` (a list; take `[0]`) and `message.author` (`[{given, family}, ...]` → `"Given Family"` joined).
- **Fallback:** `GET https://api.crossref.org/works?query.bibliographic={title}&rows=1` (optionally `&query.author=...`); take `message.items[0]` if the score/first result is plausible.
- **Etiquette:** set a descriptive `User-Agent` including the app + a contact `mailto` (Crossref's "polite pool"); a short timeout (~5s). Any failure/timeout/non-200/empty → `"skipped"`. **No retries loop** (single-user, best-effort). Semantic Scholar (no-DOI preprints) is **deferred** — the `enrich` seam already accommodates it, don't build it. [Source: ARCHITECTURE-SPINE#AD-L2, #Deferred; addendum.md]

### Background tasks + TestClient (the test trap)

Starlette runs a **sync** background task via `run_in_threadpool` (off the event loop) — so `run_extraction` being a plain `def` is correct for CPU-bound PyMuPDF + sync httpx. **But** FastAPI's `TestClient` runs background tasks **synchronously, after the response**, in the test thread. Consequences for tests:

- Any `POST /api/docs` TestClient test will execute real `extract`+`enrich` → **would hit the real Crossref network** → flaky/slow. **Always monkeypatch `domain.enrich`** (and usually `domain.extract`) in route tests to a deterministic stub, then assert the settled status.
- For the **core lifecycle** coverage, prefer calling `run_extraction(doc_id, raw)` **directly** against a real temp `PAPER_MATE_DATA` with `domain.extract`/`enrich` stubbed — it avoids TestClient entirely and sidesteps the Codex-sandbox TestClient hang (CLAUDE.md Backend-tests note). Assert `read_meta(doc_id).status` and the `library.json` cache both reflect the terminal status.
- The `import_pdf`-direct storage tests (no route, no background) now see a fresh import at `status="extracting"` (that is correct — extraction is the route's job). Update `test_storage.py:68` and `:363` to `"extracting"`.

### Client poll + notice (AC-7/AC-8)

- The optimistic→real handoff is **already** wired (6.4): `onResolved(doc)` upserts the returned `Doc` (now carrying `status: "extracting"`) as a real row; `handleResolved` projects `status` through. 6.5 only adds the **poll** after the reconcile and the **notice** on settle. [Source: client/src/library/LibraryPage.tsx:110-140]
- **Interval ~1200ms** (not sub-second — avoid hammering the backend; not too slow — the user is watching). Stop on settle. A **bounded cap** (e.g. ~60 polls) prevents an infinite loop if a status is stuck (a crashed background task); on cap, stop quietly (the row keeps its last-known muted state; the defensive `parse-failed` in `run_extraction` should make this near-impossible).
- **Batch-scoped notice:** count only *this batch's* enrich-skipped `doc_id`s so a later add doesn't re-warn about old rows. `useBulkUpload` already collects resolved `doc_id`s; surface them.
- **Notice ≠ error toast:** `Toast` gains `variant` (default `"error"`; existing call-sites unchanged). The info variant is a **muted/light** surface (L-UX-DR9 "visually distinct, non-error"). Tokens only — reference `{colors.*}` from DESIGN.md, put any new dim/surface var in `client/src/theme/components.css` (the px/hex-exempt token layer); `src/no-raw-values.test.ts` scans component CSS.

### Reuse, do not reinvent (CLAUDE.md engineering principles)

- **pypdf stays** for request-path validation + `page_count`; **PyMuPDF only** in the background `extract`. Two libs, two jobs — do not converge them this sprint.
- **`_mutate_index`/`_upsert_paper_entry`** are the cache path `apply_extraction` refreshes through — not a new `library.json` writer.
- **`GET /api/library`** is the poll target — no new "status" endpoint.
- **`Toast`** gains a `variant`, it is not duplicated.
- **`CollectionTable`'s status seam** (6.4) is extended, not replaced.
- **httpx** (already a dev dep) is promoted to runtime — no new HTTP client. [Source: [[prefer-stable-solutions]]; CLAUDE.md]

### Scope fence — what this story does NOT build

- **No inline edit** of Title/Authors — that is Story 6.6 (`PATCH /api/docs/{id}`). 6.5 makes `parse-failed`/`enrich-skipped` rows *interactive and ready to edit*, but the edit UI/endpoint is 6.6. [Source: epics.md#Story-6.6]
- **No GROBID** (rung 4) — `extract()` is GROBID-swappable but the sidecar is deferred (amends AD-10). **No Semantic Scholar** — deferred secondary. [Source: ARCHITECTURE-SPINE#Deferred]
- **No folders / sort / filter / trash / multi-select** — Epic 7. **No authors font-heuristic** — `/Info`+XMP+Crossref only.
- **No contract shape change** — the enum is already 4-valued; Task 7 only *proves* the zero-diff and updates prose. [Source: client/src/api/schema.d.ts]
- **No client re-sort** of new rows — backend append order stands until Story 7.4 (6.4's settled decision). [Source: 6-4 Review Findings, position-stable]

### DECISION notes (defaults chosen; confirm if you disagree)

1. **No `import_pdf` signature change.** New import lands `status="extracting"`; the route schedules extraction off `meta.status == "extracting"`. Rationale: avoids re-unpacking ~40 call-sites, and the `== "extracting"` signal also **auto-recovers** a doc left stuck `extracting` by a crash on the next re-upload.
2. **`ExtractedMeta.authors` is `list[str]`** (domain's honest shape); storage joins to the `str | None` display value. Keeps `meta.json`/`CollectionRow` contract (a single `authors` string) unchanged.
3. **`run_extraction` orchestrator lives in `routes/docs.py`** (composition root, per the AD-L2 diagram), sync so it runs in the threadpool. `domain/` stays strictly pure. Promote to `services/` only if it grows.
4. **`enrich-skipped` renders as a normal interactive row** (its local fields are shown); the skip is a one-time **batch notice**, not a persistent chip. `parse-failed` gets a subtle muted marker + filename fallback.
5. **Enrich uses Crossref only** (DOI-first + title fallback); offline/failure/no-key → `"skipped"`. Semantic Scholar deferred.
6. **License flip is Task 1 (first)** so no interim commit ships AGPL-under-MIT.
7. **Poll interval 1200ms, cap ~60 polls.** Non-error notice via a `Toast variant="info"`.

### Project Structure Notes

- **New backend:** `server/app/domain/__init__.py` + `server/app/domain/extraction.py` (pure `extract`/`enrich`), `server/tests/test_domain.py`. Realizes the spine's `server/app/domain/` = "extraction — pure extract() + enrich() (AD-L2, first domain tenant)". [Source: ARCHITECTURE-SPINE#Structural-Seed]
- **Modified backend:** `server/app/models.py` (`DocStatus` alias, `ExtractedMeta`), `server/app/storage/__init__.py` (new-import `extracting`, `apply_extraction`), `server/app/routes/docs.py` (`run_extraction` + `BackgroundTasks`), `server/pyproject.toml`+`uv.lock` (pymupdf, httpx→runtime, license, version), `server/tests/test_storage.py`/`test_library.py`/`test_docs.py` (status expectations + new coverage).
- **New client:** `client/src/library/useSettlePolling.ts` (+`.test.ts`). **Modified client:** `LibraryPage.tsx`/`.test.tsx` (poll + notice), `useBulkUpload.ts` (surface batch doc_ids), `CollectionTable.tsx`/`.css`/`.test.tsx` (status visuals), `Toast.tsx`/`.css`/`.test.tsx` (`variant`), `theme/components.css` (any info-notice dim).
- **Repo root:** `LICENSE` (MIT→AGPL-3.0), `README.md` (badge + section), `docs/API.md`.
- **Untouched:** router, ReaderPage, annotation store/anchor/render layers, `server/app/routes/library.py` (the GET is already the poll target). `LibraryPage` still does not import `render/`, so the `vi.mock("./render")` barrels (App.test/Reader.test) are **not** affected. [Source: CLAUDE.md render-mocks principle — N/A here]
- Downward-dependency rule (AD-9) intact: route (composition) → {domain (pure), storage (disk)}; client view → hooks → api client → backend.

### Testing standards

- **Backend:** pytest, `PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q` (CLAUDE.md). Never hit the real network — **mock httpx** in `enrich` tests and **stub `domain.enrich`** in route tests. Build domain-test PDFs in-code with PyMuPDF (`set_metadata` + `insert_text`), not checked-in binaries. Prefer direct `run_extraction` tests over TestClient for the lifecycle (sandbox TestClient-hang, CLAUDE.md). Backend suite is **run-it-yourself on the host** in the Codex review sandbox (`export UV_CACHE_DIR=/tmp/uv-cache`).
- **Client:** Vitest + `@testing-library/react`, jsdom. **Mock the api module** (`vi.spyOn(api, "uploadDoc"/"getLibrary")`), never real `fetch`. Use `vi.useFakeTimers()` for the poll hook. Every `LibraryPage.test.tsx` case mocks BOTH `uploadDoc` and `getLibrary` (mount fetches; interaction uploads/polls) — the render-mocks-in-sync rule that bit 6.3/6.4. Keep the existing 6.4 ready-only cases green (their mock returns `ready` → no poll path entered). Run the FULL client suite (`npm test`) + `npm run typecheck` clean; `no-raw-values.test.ts` + em-dash grep on new strings.
- **Regression watch:** the fresh-import `status` flips ready→extracting in storage tests; TestClient background-task execution; the `Toast` default variant must stay `"error"` so every existing caller is unchanged.

### References

- [Source: .bmad/planning-artifacts/epics.md#Story-6.5] — the 6 ACs: pure `domain/` (`extract`/`enrich`), rung 1→2 PyMuPDF + GROBID-swappable, Crossref DOI-first→title enrich degrading to "skipped", background task + poll-until-settle, `extracting → ready | enrich-skipped | parse-failed`, storage-as-sole-writer, MIT→AGPL relicense.
- [Source: ARCHITECTURE-SPINE#AD-L2] — metadata extraction opens the pure backend domain layer; `extract`/`enrich` signatures; PyMuPDF in-process, GROBID-swappable; Crossref DOI-first; background task; poll `GET /api/library`; storage the only writer; amends AD-6 "no domain logic".
- [Source: ARCHITECTURE-SPINE#AD-L4] — status lifecycle + parse-failure-not-lost + idempotent re-import (no re-extract).
- [Source: ARCHITECTURE-SPINE#AD-L7] — index-write concurrency; `apply_extraction`'s cache refresh goes through `_mutate_index` under `_index_lock`.
- [Source: ARCHITECTURE-SPINE#AD-L1/#AD-L6] — `meta.json` = own fields (authoritative), `library.json` = cache; `GET /api/library` = table + poll target; `POST /api/docs` keeps the shipped import route.
- [Source: ARCHITECTURE-SPINE#Stack, #Deferred] — PyMuPDF (AGPL) + httpx; MIT→AGPL relicense action lands at this story; GROBID sidecar + Semantic Scholar deferred.
- [Source: ARCHITECTURE-SPINE#Structural-Seed] — `server/app/domain/` new; `models.py` gains `ExtractedMeta` + status enum.
- [Source: .bmad/planning-artifacts/prds/prd-paper-mate-library-2026-07-04/prd.md#F2] — FR-8 (Title+Authors only, local), FR-9 (external enrich, non-error skip), FR-10 (never lost), FR-11 (inline edit → 6.6); NFR-1/NFR-3.
- [Source: .bmad/planning-artifacts/prds/prd-paper-mate-library-2026-07-04/addendum.md] — Crossref/Semantic Scholar by DOI or title; degrade offline.
- [Source: .bmad/implementation-artifacts/6-4-bulk-upload-optimistic-rows.md] — the client machine 6.5 extends: `handleBatchSettled` (→ poll entry), `onResolved` upsert carrying `status`, `CollectionTable` status seam, the StrictMode `mountedRef` gotcha, the "mock everything the mount calls" rule.
- [Source: server/app/storage/__init__.py:406,271,241,254] — `import_pdf` (new-import `extracting` here), `_upsert_paper_entry`, `_mutate_index`, `_cache_from_meta` (the cache path `apply_extraction` reuses).
- [Source: server/app/routes/docs.py:23-36] — `POST /api/docs` handler to extend with `BackgroundTasks` + `run_extraction`; the 400/500 `{detail}` mapping stays.
- [Source: server/app/models.py:26-53,77-95] — `DocMeta`/`CollectionRow` status enum (already 4-valued) → `DocStatus` alias + `ExtractedMeta`.
- [Source: client/src/library/CollectionTable.tsx:21-35,120-152] — `statusLabel`/`rowStatusClass` (extend for enrich-skipped/parse-failed); pending vs real-row interactivity.
- [Source: client/src/library/LibraryPage.tsx:110-150] — `handleResolved`/`handleBatchSettled`/`handleFailed` + `useBulkUpload` wiring (add poll + info notice).
- [Source: client/src/components/Toast/Toast.tsx] — add `variant`; keep default `"error"`, Esc-dismiss, `role="status"`.
- [Source: client/src/api/schema.d.ts:212,250] — the `status` enum already carries all four values (no regen).
- [Source: docs/API.md:29-62,175-178] — `POST /api/docs` prose + Changelog to update.
- [Source: DESIGN.md#components] — `toast`, `badge-pill`, `{colors.muted}`/`{colors.*}` tokens for the info notice + status chips.
- [Source: CLAUDE.md] — tokens never inline hex/px; no em-dash in UI strings; don't reinvent wheels; OOP decomposition; launch your OWN dev servers for smoke; versioning (PATCH +1 at merge); branch-per-story; backend-tests sandbox note (TestClient hang, run-it-yourself, `UV_CACHE_DIR`); contract-types regen flow; maintain `docs/API.md` with any `/api` change.
- [Source: context7 /pymupdf/pymupdf] — `pymupdf.open(stream=..., filetype="pdf")`, `doc.metadata`, `doc.get_xml_metadata()`, `page.get_text("dict")` span `size`/`text`.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Opus 4.8), Claude Code bmad-dev-story. (Story record recommends Sonnet 5 xHigh; run was invoked on Opus 4.8.)

### Debug Log References

- **Backend:** `PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 UV_CACHE_DIR=/tmp/uv-cache uv run pytest -q` → **129 passed**.
- **Client:** `npm run typecheck` clean; `npx vitest run` → **936 passed** (50 files); `no-raw-values.test.ts` 79 passed. (One transient parallel-load flake seen once, not in the 6.5 files; the 6.5 poll tests ran 5/5 stable in isolation and the full suite passed clean on two re-runs.)
- **Contract regen:** `python -m app.export_openapi` + `npm run gen:api` → **zero shape diff**; `ExtractedMeta` absent from both `openapi.json` and `schema.d.ts`; the 4-value `status` enum intact. The only generated change is the `POST /api/docs` `@description` prose.

### Completion Notes List

- **Backend domain layer born (AD-L2).** New pure `server/app/domain/` (`extraction.py` + `__init__`): `extract(bytes) -> ExtractedMeta` (PyMuPDF `/Info` + XMP rung 1, font-size heuristic rung 2 for title, DOI regex; total — never raises) and `enrich(meta) -> ExtractedMeta | "skipped"` (Crossref DOI-first + title fallback via runtime httpx; never raises, never blocks). A test asserts the module imports no storage/FS (AST-parsed, not a substring grep).
- **`enrich` title-fallback plausibility guard (added during live smoke).** Crossref `rows=1` always returns a top result, so a bare `items[0]` "corrected" COCO to an unrelated keyword-spam paper. Added a token-set Jaccard >= 0.5 gate on title-query hits (the DOI path stays exact). Live-verified: COCO now keeps its correct local title as `enrich-skipped`; a real-DOI paper still settles `ready`.
- **Storage sole-writer (AD-L2/AD-L7).** New-import `DocMeta` lands `status="extracting"` (signature unchanged, `tuple[str, DocMeta]`); new `apply_extraction()` re-reads meta fresh, applies title/authors/status, and refreshes the `library.json` cache through `_mutate_index`/`_upsert_paper_entry`. A purged doc raises `DocumentNotFoundError` (orchestrator swallows it).
- **Route composition root.** Sync `run_extraction()` wires `extract -> enrich -> apply_extraction` with the AC-5 status resolution; `upload_doc` schedules it as a `BackgroundTasks` job iff `meta.status == "extracting"`. It never raises: an unexpected failure best-effort settles the row to `parse-failed` so it never sticks at `extracting`. Suite-wide autouse fixture stubs `domain.enrich` to `"skipped"` so no test hits the real network.
- **Client poll-until-settle.** New `useSettlePolling` hook (interval 1200 ms, cap 60, unmount-safe, idempotent `start()`); `LibraryPage.handleBatchSettled` does the one AC-7 reconcile then polls `GET /api/library` only while a row is `extracting`. `useBulkUpload` now surfaces the batch's resolved `doc_id`s so the enrich-skipped notice is batch-scoped.
- **Non-error notice + status visuals.** `Toast` gained `variant?: "error" | "info"` (default `error`, existing call-sites unchanged) with a muted light `info` surface (tokens only). Enrich-skipped raises a `variant="info"` toast (`Enrichment skipped.` / `... for N papers.`). `CollectionTable`: `enrich-skipped` renders as a normal interactive row; `parse-failed` gets a subtle muted "No metadata" chip + filename fallback; real rows are interactive at every status (only pre-`doc_id` `pending` rows stay inert, keyed off `aria-disabled`).
- **License + version.** LICENSE replaced with verbatim GNU AGPL-3.0 (FSF canonical text, fetched + checksum-verified); README badge + License section updated; `server/pyproject.toml` gained `license = "AGPL-3.0-or-later"` and the PyMuPDF/httpx runtime deps. PATCH bump `0.4.4 -> 0.4.5`; `uv lock` re-run; `test_version.py` green.
- **Live smoke (own fresh servers, ports 8100/8101 backend + 5199 vite, scratch data; torn down after).** Backend, real PyMuPDF + real Crossref: **ready** (real DOI -> full corrected COCO title + 8 authors), **enrich-skipped** (COCO online, no plausible match -> local title kept), **enrich-skipped** (offline via dead proxy -> local title kept), **parse-failed** (blank PDF -> null title). End-to-end through the Vite proxy: POST returned `extracting`, then `GET /api/library` (the client's poll target) settled to `ready` with correct metadata. The **browser visual** pass (Network-panel poll observation) was blocked by the Chrome extension not connecting; the poll/notice/visual behavior is instead covered by the vitest fake-timer + DOM tests and the HTTP-level proxy smoke.
- **Scope fences honored:** no inline edit (6.6), no GROBID / Semantic Scholar, no folders/sort/trash (Epic 7), no authors font-heuristic, no contract shape change.

**Codex code-review (bmad-code-review, GPT-5 via `codex exec`) — 0 High, 3 Medium, 1 Low; all resolved:**
- **[Med] `apply_extraction` could resurrect a purged doc.** `_atomic_write`'s `mkdir(parents=True)` would recreate a dir purged in the read→write TOCTOU window, writing a meta-only ghost + re-indexing it. Fixed: added `create_parents` to `_atomic_write`/`_write_meta`; `apply_extraction` re-checks `doc_dir.is_dir()` then writes with `create_parents=False` (a purge is a clean `DocumentNotFoundError`, no resurrection). New test `test_apply_extraction_does_not_resurrect_dir_purged_after_read`.
- **[Med] Font heuristic took the global max font before the top filter.** A larger lower-page banner made a legitimate top title return `None`. Fixed: restrict to top-of-page spans first, then take the max size among those. New test `test_extract_font_heuristic_ignores_larger_lower_banner`.
- **[Med] Poll cap left batch-notice state uncleared.** A permanently-stuck `extracting` row capped without firing `onSettled`, leaking `noticeBatchIdsRef`. Fixed: `useSettlePolling` gained an `onMaxPolls(latest|null)` callback; `LibraryPage` resolves the batch notice (or clears IDs) on cap. New hook tests + a page-level cap test.
- **[Low] `enrich` treated a blank title/doi as queryable.** Fixed: `_clean()` both at entry, so whitespace-only metadata is "nothing to query" (zero HTTP calls). New test `test_enrich_treats_blank_title_and_doi_as_nothing_to_query`.
- Post-fix: backend **132 passed**, client **938 passed** + typecheck clean. Codex ran `npm run typecheck` + targeted Vitest (51 pass) itself; it verified backend findings by reading (sandbox pytest note).

### File List

**New (backend):**
- `server/app/domain/__init__.py`
- `server/app/domain/extraction.py`
- `server/tests/test_domain.py`

**New (client):**
- `client/src/library/useSettlePolling.ts`
- `client/src/library/useSettlePolling.test.ts`
- `client/src/components/Toast/Toast.test.tsx`

**Modified (backend):**
- `server/app/models.py` (`DocStatus` alias, `ExtractedMeta`)
- `server/app/storage/__init__.py` (new-import `extracting`, `apply_extraction`)
- `server/app/routes/docs.py` (`run_extraction` + `BackgroundTasks`)
- `server/pyproject.toml` (pymupdf + httpx runtime, `license`, version `0.4.5`)
- `server/uv.lock`
- `server/tests/conftest.py` (autouse `enrich` network guard)
- `server/tests/test_storage.py` (fresh-import `extracting` + `apply_extraction` tests)
- `server/tests/test_docs.py` (extracting/settle + `run_extraction` lifecycle tests)
- `server/tests/test_library.py` (settled-status expectation)

**Modified (client):**
- `client/src/library/LibraryPage.tsx` / `LibraryPage.test.tsx` (poll + info notice)
- `client/src/library/useBulkUpload.ts` (surface batch `doc_id`s)
- `client/src/library/CollectionTable.tsx` / `.css` / `.test.tsx` (status visuals)
- `client/src/components/Toast/Toast.tsx` / `.css` (`variant`)
- `client/src/api/schema.d.ts` (regen: `POST /api/docs` description only, no shape change)

**Modified (repo root / docs):**
- `LICENSE` (MIT -> AGPL-3.0)
- `README.md` (badge + License section)
- `docs/API.md` (async-extraction prose + Changelog)
- `server/openapi.json` (regen; no shape change)
- `.bmad/implementation-artifacts/sprint-status.yaml` (status)

### Change Log

- **2026-07-05 (Story 6.5):** Backend metadata extraction (extract + enrich). New pure `domain/` layer (AD-L2, first tenant); storage `apply_extraction` sole-writer; route `run_extraction` background orchestration (`POST /api/docs` returns `extracting`, settles to `ready | enrich-skipped | parse-failed`). Client polls `GET /api/library` until settle, raises a non-error `info` notice for enrich-skipped, and renders parse-failed as an interactive filename-fallback row. PyMuPDF added + httpx promoted to runtime; repo relicensed MIT -> AGPL-3.0. No API contract shape change. Version `0.4.4 -> 0.4.5`.
