---
baseline_commit: c574f7ccee7d22c0582fb6b4841f7da64a213a63
---

# Story 10.1: Structure-extraction enabler (SPIKE-FIRST)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a reader,
I want each imported paper analyzed into a structured, box-anchored set of document elements,
so that the reader can become section-aware (Figures, Tables, Headings, Paragraphs, Footnotes, Captions, Lists) from one source of truth.

## Acceptance Criteria

1. **(SPIKE-FIRST gate, FR-34, AD-4, AD-13; a negative outcome is a complete + acceptable result)** Given the story, then it **starts** with a spike, and the rest of the story is not built until the spike passes: (a) confirm `opendataloader-pdf` (the `opendataloader_pdf` Python binding) runs **inside the container image** with an added JRE, deterministically and offline, on 2-3 real papers (at least one single-column, one multi-column); (b) produce each paper's raw element output; (c) prototype the `[left,bottom,right,top]`-points -> normalized `[0,1]` top-left-origin `Rect` mapping (page dimensions from the JSON if present, else PyMuPDF `page.rect`); (d) live-smoke the mapping by overlaying the derived rects on the rendered pages at **DPR>1** and confirming they sit on the real elements. If the binding cannot run in-image OR the coordinates cannot be made pixel-correct, STOP and write up the finding ([[verify-on-hidpi-and-real-host]]); do NOT commit the contract or build the consumers on an unproven enabler.
2. **(Extraction behind a port, in the import pipeline, total, AD-L8/AD-L2/AD-L4)** Given an imported document, when the background import pipeline runs, then `extract_structure(pdf_bytes) -> DocStructure` runs behind a swappable port (`opendataloader` the first adapter, mirroring the AD-L2 `extract`/`enrich` seam), and the result is persisted as `~/.paper-mate/library/{doc_id}/structure.json` beside `source.pdf`/`meta.json`, a per-doc artifact written **only by storage** (AD-8, AD-9, AD-L8). A failure (bad PDF, JVM error, timeout) yields an **empty structure**, never a crash, and never blocks the paper reaching a settled status (total, exactly like `extract()`).
3. **(Additive contract + route, AD-3, FR-34)** Given the contract, then `StructureElement { id, type, page_index, rect, text, heading_level? }` + `DocStructure { elements }` are **additive** Pydantic models surfaced into OpenAPI -> generated TS types (never hand-authored), and `GET /api/docs/{doc_id}/structure` returns the doc's `DocStructure` (**404** for an unresolvable/unknown id; **200 `{elements: []}`** for a known doc that is not yet analyzed or is a non-PDF), documented in `docs/API.md`.
4. **(Client `structure/` service, coordinate math stays at the anchor boundary, AD-4/AD-9)** Given the client, then a new `structure/` service fetches + holds `DocStructure` for the open doc and exposes typed selectors (headings, figures, tables, element-at-point), denormalizing rects to screen at the current scale by **reusing the `anchor/` service's existing `denormalizeRect`** (NOT new coordinate math). There is **no consumer UI** (TOC/index/preview/metadata are 10-2..10-5); this story ends at the layer + **one dev-only debug overlay** proving placement.
5. **(Coordinate correctness live-smoked, NFR-3, [[verify-on-hidpi-and-real-host]])** Given the coordinate mapping, then it is live-smoked at **DPR>1 on a multi-column paper**: the derived element rects align to the real headings/figures/tables/paragraphs across pages and across zoom, not only in a unit test.

## Tasks / Subtasks

> **Task 1 is the spike gate (AC #1). Do it FIRST and stop at its decision point.** Tasks 2-10 are contingent on the spike passing. A negative spike result (binding won't run in-image, or coordinates can't be made pixel-correct at DPR>1) is a **complete, acceptable** outcome: record it in the Dev Agent Record + a `deferred-work.md` writeup and HALT the story, per the SPIKE-FIRST charter (Section 5 of `sprint-change-proposal-2026-07-20-opendataloader-structure-layer.md`).

- [x] **Task 1 — SPIKE: prove the binding + the coordinate mapping (AC: #1, #5).** Prove BOTH before writing any contract/consumer code.
  - [x] Add the dependency + regenerate the lockfile: `cd server && uv add opendataloader-pdf` (pin the exact patch it resolves, e.g. `opendataloader-pdf==1.12.0`, in `pyproject.toml` `dependencies`; run so `uv.lock` updates — `test_version.py` guards pyproject/uv.lock version agreement, so a clean `uv lock` matters). License is **Apache-2.0** (clean; the repo is already AGPL for PyMuPDF, no new license action).
  - [x] **Prove the JVM runs in-image.** `opendataloader-pdf` needs **Java 11+** (the `convert()` call spawns a JVM). The runtime stage of `Dockerfile` is `python:3.13-slim` (Debian) with **no JRE**. Add one to the runtime stage: prefer `RUN apt-get update && apt-get install -y --no-install-recommends default-jre-headless && rm -rf /var/lib/apt/lists/*` (smallest change; Debian trixie's default JRE is 21, satisfies 11+), OR copy from a pinned `eclipse-temurin:21-jre` multi-stage if you want the JRE version pinned independent of Debian. `docker compose up --build` (or `docker build`), import a real paper, and confirm `structure.json` is produced inside the container (`/data/library/{doc_id}/structure.json`). This is AC #1(a) and is not optional — a host-only proof does not satisfy "runs inside the container image."
  - [x] **Determine the binding's real surface.** The documented API is `opendataloader_pdf.convert(input_path=..., output_dir=..., format="json")`, which is **file-based** (writes JSON files into `output_dir`), not `bytes -> dict`. During the spike, confirm whether any in-memory return exists (a `run`/`process`/string-returning call); if not, the adapter must: write `pdf_bytes` to a temp file, `convert(..., format="json")` into a `tempfile.TemporaryDirectory()`, read the produced JSON back, then parse. Use an OS temp dir (NOT `~/.paper-mate` — storage owns that; the JVM's scratch I/O is transient and does not violate AD-9). Verify `convert` runs offline (local/fast mode is the default; `hybrid` is out of scope) and does not emit images/markdown when `format="json"`.
  - [x] **Capture raw output on 2-3 real papers** (fixtures under `server/tests/fixtures/` or `client/fixtures/sample-pdfs/`; at least one single-column, one multi-column). Record: the exact JSON element shape, the `type` values actually emitted, whether **footnotes** appear as a distinct type (the README does not confirm it — 10-4 depends on footnote elements, so its presence/absence is a finding to record), whether elements carry an explicit reading-order field or only implicit array/`id` order, and whether the JSON carries per-page dimensions.
  - [x] **Prototype + live-smoke the mapping (AC #5).** opendataloader bbox = `[left, bottom, right, top]` in **PDF points, y-UP** (origin bottom-left). Our `Rect` is normalized `[0,1]`, **top-left, y-down** (AD-4). The server-side flip: with page width `W`, height `H` in points, `x0 = left/W, x1 = right/W, y0 = (H - top)/H, y1 = (H - bottom)/H`, then `canonicalize` (`x0<=x1, y0<=y1`). **The correctness risk is the normalization BASIS** — the client denormalizes with `getPageBox` = the pdf.js scale-1 viewport (**CropBox + `/Rotate`** in CSS px), so the server MUST normalize against the **same** page box (CropBox, rotation applied), or every rect drifts. PyMuPDF `page.rect` is the CropBox in points; prefer the JSON's page dims if it exposes them, else `page.rect` — and **verify rotated / cropped pages** in the smoke, not only an unrotated one. Overlay the derived rects on the rendered pages at DPR>1 on the multi-column fixture; confirm they sit on the real elements across pages and zoom. **This overlay IS the debug overlay Task 8 keeps** — build it here.
  - [x] **Decision point.** Both proven -> proceed to Task 2 and lock the decisions into Dev Notes. Either failed -> write it up and HALT (AC #1).

- [x] **Task 2 — Contract: `StructureElement` + `DocStructure` (AC: #3).** In `server/app/models.py`, add (place near `Rect`/anchor models, reusing the existing `Rect`):
  - `StructureElement { id: str, type: <StructureType>, page_index: int, rect: Rect, text: str, heading_level: int | None = None }`.
    - `page_index` is **0-based**, matching the annotation anchor convention (`TextAnchor.page_index`); opendataloader's `"page number"` is **1-indexed** -> subtract 1 in the adapter.
    - `id: str` = the stringified opendataloader element id (stable within a doc), NOT a UUID (this is not an `Annotation`).
    - `type` = a `Literal` over **our** vocabulary (AD-13: `heading|paragraph|table|figure|caption|list|footnote`) plus an `"other"` catch-all so an unmapped opendataloader type can never break validation. Map opendataloader types -> ours in the adapter (Task 3): `image`/`picture` -> `figure`; `heading|paragraph|table|caption|list` pass through; `formula` -> `other` (or `paragraph`, decide in Task 3 from the spike output); a `footnote` type only if the spike confirms opendataloader emits one, else footnotes fall out as `paragraph`/`other` (record this — it constrains 10-4).
  - `DocStructure { elements: list[StructureElement] = [] }`.
  - Both are **additive** (new models, no change to any existing model), so no `schema_version` bump on `meta.json`/`annotations.json`/`library.json`. Because `GET .../structure` uses `DocStructure` as its `response_model`, FastAPI includes both in OpenAPI automatically — **no `app.main` injection needed** (unlike the `Annotation` model, which had no route when it was added).
  - [x] Regenerate the contract in the SAME change: `cd server && PYTHONPATH= uv run python -m app.export_openapi` (writes `server/openapi.json`), then `cd client && npm run gen:api` (regenerates the committed `client/src/api/schema.d.ts`). Never hand-author the client type.

- [x] **Task 3 — Domain: `extract_structure` port + `opendataloader` adapter (AC: #2).** New `server/app/domain/structure.py`, mirroring the `extract`/`enrich` port shape (`crossref.py`'s `Enricher` protocol + `CrossrefEnricher` is the template):
  - A `StructureExtractor` protocol (`extract(pdf_bytes: bytes) -> DocStructure`) + an `OpenDataLoaderExtractor` first adapter that runs the binding (temp-file in, temp-dir out, per Task 1), parses the JSON, maps types (Task 2), converts page number `1->0`-based, and flips+normalizes each bbox to a `Rect` via a `_to_normalized_rect(bbox_points, page_w, page_h)` helper (the server-side flip lives here — this is the one place a y-flip happens server-side; the client's own anchor math never touches PDF points).
  - A module-level `extract_structure(pdf_bytes) -> DocStructure` domain surface delegating to the default adapter (mirrors `enrich.py` delegating to the `Enricher`).
  - **Total**, exactly like `extract()`: any failure (open error, JVM error, malformed JSON, empty output, timeout) returns `DocStructure(elements=[])`, never raises.
  - **Purity nuance (record in Dev Notes):** AD-L2 says the domain layer "never touches the filesystem." opendataloader is file-based, so this adapter DOES use an **OS temp dir** for the JVM's scratch I/O. This does not violate AD-9 (storage remains the only writer of `~/.paper-mate`); the temp dir is throwaway scratch. Note it as an accepted, surfaced deviation.
  - Export `extract_structure` from `server/app/domain/__init__.py` (add to the facade + `__all__`, alongside `extract`/`enrich`).
  - Get per-page dimensions where the flip needs them: from the JSON if it carries them, else a single PyMuPDF `pymupdf.open(stream=pdf_bytes)` pass reading `page.rect` per page (PyMuPDF is already a dep; reuse the `extract.py` open pattern).

- [x] **Task 4 — Storage: per-doc `structure.json` read/write (AC: #2).** New `server/app/storage/structure_store.py`, mirroring `annotations_store.py`/`meta_store.py` exactly:
  - `STRUCTURE_SCHEMA_VERSION = 1`; disk envelope `{schema_version, elements}`, atomic write (`atomic_write`); both entry points gate on `meta_store.read(doc_dir)` (a never-imported doc has no structure).
  - `write_structure(doc_id: str, structure: DocStructure) -> None` (overwrite, whole-file).
  - `read_structure(doc_id: str) -> DocStructure` — the READ mirror: `DocumentNotFoundError` for an unresolvable id or missing `meta.json`; **empty `DocStructure()`** (not an error) when `structure.json` is absent (imported-but-not-yet-analyzed, the common case); reject an unknown `schema_version` (`UnsupportedSchemaError`) or a corrupt/wrong shape (add a `CorruptStructureError(StorageError)` in `storage/errors.py`, following the `CorruptAnnotationsError` precedent).
  - **Per-doc, so NOT via the `library_index` lock** (AD-L8: `structure.json` is not the shared `library.json`; it must not go through the AD-L7 serialized index-write path — that would add index-write contention for nothing).
  - Export `write_structure`/`read_structure`/`STRUCTURE_SCHEMA_VERSION` (+ the new error) from `storage/__init__.py`'s facade + `__all__`.

- [x] **Task 5 — Wire structure extraction into the import pipeline (AC: #2).** In `server/app/routes/extraction.py`'s `run_extraction`, after the metadata `extract -> enrich -> apply_extraction` completes, run structure extraction: `structure = domain.extract_structure(pdf_bytes)` then `storage.write_structure(doc_id, structure)`, each guarded so a structure failure NEVER changes the metadata status and NEVER raises out of the background task (wrap in its own try/except; `DocumentNotFoundError` from a purged-mid-flight doc is a best-effort no-op, mirroring the existing `apply_extraction` guard).
  - **Do NOT add a new `analyzing` status** (the open design call): keep the existing `extracting -> ready | enrich-skipped | parse-failed` lifecycle unchanged. Structure is total + non-blocking; its readiness is observable via `GET .../structure` (404/empty), not a status the client polls. Adding a status enum value would ripple into `CollectionRow`, the client poll loop, and `docs/API.md` for no user-visible gain this story. (If a future story wants an "analyzing" affordance, add it then.)
  - Structure runs synchronously **within** the existing sync background task (correct for a CPU/JVM-bound job, off the event loop), after metadata so a slow JVM never delays the title/authors the table shows.

- [x] **Task 6 — Route: `GET /api/docs/{doc_id}/structure` (AC: #3).** In `server/app/routes/docs.py` (the natural home, beside `/annotations`), add a thin handler `response_model=DocStructure` using the `storage_errors("Could not read structure")` context manager: `DocumentNotFoundError -> 404`, corrupt/unknown-version -> 500, a known-but-unanalyzed doc -> 200 `{elements: []}` (from `read_structure`'s empty return). No filesystem access in the route (AD-9).
  - [x] `docs/API.md`: add a `GET /api/docs/{doc_id}/structure` resource entry (model the `/annotations` GET entry) + a dated changelog line noting the new `DocStructure`/`StructureElement` models and route (additive, no format break, Story 10.1, FR-34, AD-13). This IS an `/api` surface change, so `docs/API.md` maintenance is mandatory in the same change.

- [x] **Task 7 — Client: `api/client.ts` fetch + `structure/` service (AC: #4).**
  - [x] In `client/src/api/client.ts`, add `export async function getStructure(docId): Promise<DocStructure>` (mirror `getAnnotations`, using the generated `DocStructure` type from `./schema`) + the `DocStructure`/`StructureElement` type re-exports (mirror the `Annotation`/`Rect` re-exports).
  - [x] New `client/src/structure/` service (`index.ts`): fetches + holds the open doc's `DocStructure`, and exposes typed selectors — `headings()`, `figures()`, `tables()`, `elementAt(page, point)` (or similar) — plus a `denormalize(element, box, scale)` that **calls the `anchor/` service's existing `denormalizeRect`** (AD-9: normalize<->screen math stays in `anchor/`; the structure service must not compute screen coords itself). Follow the store/service lifecycle the annotations use (fetch on open; hold for the open doc). Keep it view-agnostic — no React coupling beyond what a hook/selector needs — since 10-2..10-5 are its real consumers.
  - **No consumer UI** (AC #4): do not touch the ToC panel, add an index panel, or wire metadata. This story delivers the LAYER, not a feature.

- [x] **Task 8 — Dev-only debug overlay (AC: #4, #5).** Keep the Task 1 overlay as a **dev-only** structure-rect overlay over the pages (mirror how `AnnotationLayer` renders per-page over `PageCard` using `getPageBox` + `scale`; the structure service's `denormalize` supplies the screen rects). Gate it behind a dev switch (a `?debugStructure=1` query param or a dev-only keyboard toggle) so it is NOT part of the shipped reader chrome. This is the placement-proof artifact, not a product surface. Any label/tooltip on it must contain **no em-dash**.

- [x] **Task 9 — Tests (AC: #2, #3, #4).**
  - [x] Backend `server/tests/`:
    - `domain/structure` mapping unit tests with a **fake adapter / monkeypatched binding** (do NOT spawn the JVM in unit tests — slow + flaky; feed a captured raw-JSON fixture from Task 1 and assert the mapping): points->normalized flip correctness (a known bbox -> a known `Rect`, incl. the y-flip and canonicalization), page-number `1->0` conversion, type mapping (`image/picture -> figure`, passthroughs, unknown -> `other`), and **totality** (garbage bytes / a raise inside the adapter -> `DocStructure(elements=[])`, never raises).
    - `storage/structure_store` round-trip: write then read returns the same `DocStructure`; a missing `structure.json` on an imported doc returns empty (not an error); an unknown `schema_version` -> `UnsupportedSchemaError`; a corrupt file -> `CorruptStructureError`; a never-imported doc_id -> `DocumentNotFoundError`. Mirror `test` patterns for `annotations_store`.
    - Route: `GET /api/docs/{id}/structure` -> 404 unknown id, 200 `{elements: []}` for an imported-but-unanalyzed doc, 200 populated after a `write_structure`. (**Sandbox note:** the FastAPI `TestClient`-backed tests can hang under the Codex review sandbox; the human runs the backend suite on the host — see CLAUDE.md Backend-tests note. The reviewer verifies by reading.)
    - `run_extraction` composition: a structure-extraction failure does NOT change the metadata status and does NOT raise (monkeypatch `extract_structure` to raise; assert the row still settles + no exception escapes).
    - `test_models.py`: `StructureElement`/`DocStructure` validate + round-trip; `type="other"` accepted; `heading_level` defaults `None`.
  - [x] Client `client/src/structure/`: service selector tests (headings/figures/tables filter by mapped type) + a `denormalize` test asserting it delegates to `anchor` (a known element + box + scale -> the expected screen rect). Minimal debug-overlay render test.
  - [x] If any `render/index.ts` export is added, update **both** `vi.mock("./render")` barrels (`App.test.tsx`, `Reader.test.tsx`) in the same change (CLAUDE.md). Run the full suite + `npm run typecheck`.

- [x] **Task 10 — Live smoke at DPR>1 + in-container proof (AC: #1, #5), OWN dev servers, throwaway `PAPER_MATE_DATA`.** Start YOUR OWN `uvicorn` + `vite dev` (never a user-launched/Docker server for the host smoke — CLAUDE.md) with an explicit throwaway `PAPER_MATE_DATA` scratch dir (never `~/.paper-mate`). Then:
  - [x] Import a **multi-column** real paper; confirm `structure.json` is written and `GET /api/docs/{id}/structure` returns populated elements.
  - [x] Toggle the debug overlay at **DPR 2** (and confirm across a zoom change): derived rects for headings/figures/tables/paragraphs sit on the real on-page elements across multiple pages, not only page 1. Prefer trusted input (`claude-in-chrome`); the `chrome-devtools-mcp` `emulate({viewport:"1400x900x2"})` DPR-2 fallback is acceptable if `claude-in-chrome` is unavailable (recurring AE7-2 tooling gap — note it, don't re-solve it).
  - [x] Verify a **rotated or cropped** page maps correctly (the CropBox/`/Rotate` basis risk), or record that no such page was available in the fixtures.
  - [x] Re-run the **in-container** proof from Task 1 (`docker compose up --build`, import a paper, confirm `structure.json` in `/data`) — AC #1(a).
  - [x] Delete the transient test docs afterward; confirm the scratch `PAPER_MATE_DATA` is clean.

- [x] **Task 11 — Version + docs.** PATCH +1 happens at PR-merge time (CLAUDE.md versioning): next is `0.6.0 -> 0.6.1`. Do NOT hardcode the version anywhere but `server/pyproject.toml`. Confirm `docs/API.md` (Task 6) landed in the same change as the route.

### Review Findings (Codex bmad-code-review, cross-model, read-only sandbox)

Codex ran the full adversarial review against `baseline..HEAD` and returned **Changes Requested**: 1 High, 6 Medium, 3 Low. All actionable findings resolved; re-verified (backend 355, frontend 1686, typecheck clean).

- [x] **[High] In-container proof used a manually-prepared `python:3.13-slim`, not the actual Dockerfile build** (story:189) — **Fixed**: built the real image (`docker build -t paper-mate:story-10-1 .`, JRE layer included), ran it as the host user with a `/data` mount, imported a paper **through FastAPI**, and confirmed the container wrote `structure.json` (102 KB, host-owned) into the mounted `/data`. JVM-in-image proven on the real artifact, not a recipe.
- [x] **[Med] Empty/failed structure cached permanently; hook never retries** (StructureDebugLayer.tsx:42, useDocStructure.ts:31) — **Fixed**: the debug layer's module cache no longer caches an empty/failed result (evicts so a re-toggle/re-mount re-fetches the settled structure). (Live auto-polling while a paper is still `extracting` is a consumer concern for 10-2+, not this dev-only enabler surface.)
- [x] **[Med] Purge between the meta-read gate and the write can recreate a structure-only dir** (structure_store.py:44) — **Fixed**: `write_structure` now calls `atomic_write(..., create_parents=False)` (mirrors `apply_extraction`'s purge-race guard). Test `test_structure_store_write_does_not_recreate_purged_dir`.
- [x] **[Med] `{"schema_version":1}` (no `elements`) accepted as empty instead of corrupt** (structure_store.py:81) — **Fixed**: `read_structure` now requires `elements` to be a list, else `CorruptStructureError` (500). Only an ABSENT `structure.json` is the empty-not-error case. Test `test_structure_store_rejects_missing_elements_key`.
- [x] **[Med] Switching documents shows the previous paper's structure until the new fetch resolves** (useDocStructure.ts:25) — **Fixed**: the effect resets to `EMPTY_STRUCTURE` immediately on every non-null `docId` change. Test `"clears the previous doc's structure immediately on a doc switch"`.
- [x] **[Med] `opendataloader-pdf>=2.5.0` contradicts the exact-patch decision** (pyproject.toml:23) — **Fixed**: pinned `==2.5.0`, regenerated `uv.lock`.
- [x] **[Med] Smoke had no table elements; table placement unverified** (story:185) — **Fixed**: imported a table paper (`0616.pdf`, 5 tables) through the **real container image** and live-smoked the overlay at DPR 2 — the green `table` box wraps "Table 1: Comparison of related approaches" precisely on a two-column page, alongside `caption`/`list`/`heading`/`paragraph` boxes.
- [x] **[Low] A swapped extractor returning `None` violates the `-> DocStructure` contract** (structure.py:228) — **Fixed**: `extract_structure` coerces a non-`DocStructure` adapter result to `DocStructure()`. Test `test_extract_structure_coerces_off_contract_adapter_result`.
- [x] **[Low] Non-UTF-8 bytes raise a raw `UnicodeDecodeError` bypassing `CorruptStructureError`** (structure_store.py:77) — **Fixed**: `read_structure` now catches `UnicodeDecodeError` alongside JSON/OS errors. Test `test_structure_store_rejects_non_utf8`.
- [x] **[Low] Real single-column captured output not substantiated** (story:205) — **Resolved (documented)**: the retained real fixture is the harder MULTI-column case (`odl_1903_multicol.json`); the spike's 8-paper corpus sweep (Debug Log) covered single-column real papers (`09-regularization`, `10-convolutional`, `11-residual`), and the synthetic fixture exercises the mapping edge cases. Not bloating the repo with a second large real fixture for a Low.

## Dev Notes

### This is the enabler the whole epic stands on — spike before you commit anything

Story 10.1 is a hard prerequisite for 10-2..10-6 and is **spike-gated** on two independent risks: (1) can the `opendataloader_pdf` binding run deterministically **in the container image** (JRE + JVM spawn), and (2) can the PDF-points -> normalized-rect -> screen mapping be made pixel-correct at DPR>1. Both are the jsdom-blind, HiDPI-only class of failure that recurs across this project ([[verify-on-hidpi-and-real-host]]). Do Task 1 first; if either fails, the correct outcome is a written-up negative result and a HALT, not a forced build. [Source: `sprint-change-proposal-2026-07-20-opendataloader-structure-layer.md` Section 5; epic Story 10.1 AC #1.]

### opendataloader-pdf: the real binding surface (spike-confirmed facts to lock in)

- Package `opendataloader-pdf` (PyPI, **Apache-2.0**); import `opendataloader_pdf`; current version **1.12.0**; needs **Java 11+** and Python 3.10+ (we run 3.13).
- Documented API is **file-based**: `opendataloader_pdf.convert(input_path=..., output_dir=..., format="json")` writes JSON files into `output_dir`. No in-memory return is documented — the spike confirms whether one exists; if not, the adapter round-trips through a temp file + temp dir. Default (local/fast) mode is deterministic + offline; `hybrid` mode (Docling + a vision model) is **out of scope**.
- Per-element JSON (spike captures the exact shape): `type`, `id` (int), `"page number"` (**1-indexed**), `"bounding box"` = `[left, bottom, right, top]` in **PDF points, y-up**, `"heading level"`, `content`, plus `font`/`font size`/`level`. Types seen: `heading, paragraph, table, list, image, caption, formula, picture`. **Footnote is not a confirmed type** — record whether it appears; 10-4's footnote preview depends on it. Reading order is preserved (XY-Cut++) but may be only implicit in array/`id` order — record which.
- [Source: PyPI `opendataloader-pdf`; GitHub `opendataloader-project/opendataloader-pdf` README, spike-verified 2026-07-20.]

### Coordinate mapping — the one place a y-flip happens server-side (AD-4, AD-13)

opendataloader emits `[left, bottom, right, top]` in PDF points, **y-up** (PDF origin bottom-left). Our stored `Rect` is normalized `[0,1]`, **top-left, y-down** (AD-4). AD-13 mandates the conversion happens **server-side** so `structure.json` already IS anchors. With page width `W`, height `H` in points:

```
x0 = left / W        x1 = right / W
y0 = (H - top) / H   y1 = (H - bottom) / H     # flip y-up -> y-down
# then canonicalize (x0<=x1, y0<=y1) and clamp to [0,1]
```

The correctness hinge is the **normalization basis**: the client denormalizes with `render/getPageBox` = the pdf.js scale-1 viewport, which bakes in **CropBox + `/Rotate`** (CSS px). The server must normalize against the **same** page box, or every rect drifts by the CropBox/MediaBox delta or the rotation. PyMuPDF `page.rect` is the CropBox in points — a good match, but **rotation must be handled**: verify a rotated page in the smoke. This is exactly the AD-4 "the render layer converts PDF's bottom-left space to top-left once" contract, except here the SERVER does the flip because opendataloader hands us raw PDF points (annotation anchors, by contrast, are born client-side already in top-left space and never see PDF points). Keep ALL of this flip/normalize math in `domain/structure.py` on the server and the denormalize in `anchor/` on the client — never invent a second coordinate path (AD-9). [Source: ARCHITECTURE-SPINE (main) AD-4 L68-77, AD-13 L124-127; `client/src/render/index.ts:162` `getPageBox`; `client/src/anchor/index.ts` `denormalizeRect`.]

### Resolved open design calls (the epic left these for create-story)

1. **JRE bundling** -> add a JRE to the **runtime stage of the existing `Dockerfile`** (`apt-get install default-jre-headless`, or a pinned `eclipse-temurin:21-jre` multi-stage copy). Single container preserved (AD-10). Image-size cost (~a JRE) is accepted (proposal Section 2 "Technical impact").
2. **`StructureElement.type` enum** -> **our** vocabulary (`heading|paragraph|table|figure|caption|list|footnote`) + an `"other"` catch-all; map opendataloader types in the adapter (`image`/`picture` -> `figure`; passthroughs; `formula`/unknowns -> `other`; `footnote` only if emitted). The catch-all means a new/unknown opendataloader type can never break contract validation.
3. **Page dimensions** -> from the JSON if it carries them, else a single PyMuPDF `page.rect` pass (already a dep). Prefer whichever matches the pdf.js CropBox+Rotate basis in the smoke.
4. **sync-at-import vs a distinct `analyzing` status** -> **no new status**. Run structure inside the existing sync background task after metadata; keep `extracting -> ready|enrich-skipped|parse-failed` untouched. Readiness is observable via the structure endpoint (404/empty), not a polled status. Minimizes blast radius (no `CollectionRow`/poll/`docs/API.md`-status change).
5. **Version-pinning opendataloader** -> pin the exact patch in `pyproject.toml` (`uv add` resolves it; `uv.lock` guarded by `test_version.py`).

### Where this hooks into the existing pipeline (read these before editing)

- **`server/app/routes/extraction.py` `run_extraction`** — the AD-L2 composition root, already the place where pure `domain` composes with the `storage` writer, already a sync FastAPI background task, already total (never leaves a row stuck / never raises). Structure extraction slots in here after metadata. Do not add a second background task or a request-path call. [Current: `run_extraction` L12-63.]
- **`server/app/storage/documents.py` `import_pdf`** — a new import lands `status="extracting"`; the route (`docs.py upload_doc`) schedules `run_extraction` off that status. Import is idempotent by `doc_id` (SHA-256 of bytes); a re-import must NOT re-run structure extraction (it doesn't re-run `run_extraction` today — the `if meta.status == "extracting"` gate in `upload_doc` already handles this; keep relying on it). [Current: `documents.py` L70-113; `docs.py upload_doc` L33-54.]
- **`server/app/storage/annotations_store.py`** — the exact template for `structure_store.py`: disk-envelope `{schema_version, ...}`, atomic write, gate on `meta_store.read`, empty-not-error for a missing file, reject unknown-version/corrupt. Copy its shape; do NOT route through `library_index` (AD-L8 — per-doc artifact, not the shared index). [Current: `annotations_store.py` L28-103.]
- **`server/app/domain/crossref.py` (`Enricher` port + `CrossrefEnricher`) + `enrich.py`** — the port/adapter/facade template for `structure.py`'s `StructureExtractor` + `OpenDataLoaderExtractor` + `extract_structure`. [Current: `domain/__init__.py` facade L15-19.]
- **`client/src/api/client.ts` `getAnnotations`** — the fetch template for `getStructure`. **`client/src/annotations/AnnotationLayer.tsx`** (rendered per-page by `client/src/reader/PageCard.tsx` using `getPageBox` + `scale`) — the per-page overlay template for the debug overlay. **`client/src/anchor/index.ts` `denormalizeRect`** — the ONLY denormalize the structure service may call (AD-9). [Current: `client.ts` `getAnnotations` L124-128; `PageCard.tsx` L145-146 `box.width*scale`.]

### Purity nuance to surface, not hide (AD-L2 vs a file-based binding)

AD-L2 says the domain layer "never touches the filesystem." opendataloader is file-based, so `OpenDataLoaderExtractor` DOES use an **OS temp dir** for the JVM's scratch I/O. This does not violate AD-9 (storage stays the sole writer of `~/.paper-mate`; the temp dir is throwaway). Call it out in the module docstring + Dev Agent Record as an accepted, surfaced deviation, the same way AD-L2 itself was surfaced as amending AD-6.

### Scope discipline — this story is the LAYER, not a feature

No ToC change, no Figures/Tables index, no reading-helper, no metadata reroute (those are 10-2..10-5, each depending on this). The ONLY client-visible artifact is a **dev-only** debug overlay behind a flag. Resist building any consumer. [Source: epic Story 10.1 "Out of scope"; AC #4.]

### Out of scope (epic-stated)

OCR / scanned PDFs (opendataloader hybrid mode, Docling + vision model); any user-facing consumer UI; re-analysis on annotation edits (structure is import-time, immutable — no re-extract on `PUT /annotations`).

### Testing standards

- Backend: `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q` (host-run; the sandboxed reviewer reads — CLAUDE.md Backend-tests note; the `TestClient` route tests can hang under the sandbox). **Never spawn the JVM in unit tests** — feed a captured raw-JSON fixture to the mapping and monkeypatch the binding for `run_extraction` composition tests, so the suite stays fast + deterministic (mirror how enrich tests fake the `Enricher`).
- Frontend: `cd client && npm test` + `npm run typecheck`. jsdom has no layout (`getBoundingClientRect` = 0), so the overlay's actual pixel placement is **live-smoke only**; the service selectors + the denormalize delegation are unit-testable.
- **Live smoke mandatory at DPR>1 on a real MULTI-COLUMN paper with YOUR OWN dev servers + a throwaway `PAPER_MATE_DATA`**, PLUS the **in-container** JRE proof (AC #1(a)). Coordinate correctness is the gate ([[verify-on-hidpi-and-real-host]]).

### Project Structure Notes

- Downward dependency holds: contract (`models.py`) -> generated types -> `domain/structure.py` (port + adapter, pure-ish) -> `routes/extraction.py` composes it with `storage/structure_store.py` (sole writer) -> `routes/docs.py` serves it -> client `api/` -> `structure/` service -> (debug overlay). New backend modules (`domain/structure.py`, `storage/structure_store.py`) are second tenants of layers that already exist (AD-L2 domain, AD-8 storage), not new layers. New client dir `client/src/structure/` sits beside `anchor/`/`annotations/` and depends downward on `anchor/` (denormalize) + `api/` (fetch) only.
- The terminal Epic-10 refactor (Story 10.7, AE7-5) will later unify the structure code; do not pre-optimize module boundaries here beyond the port/adapter/store/service split the ADs already dictate.

### References

- Epic + ACs + open design calls: [Source: .bmad/planning-artifacts/epics/epic-10-document-structure-layer-opendataloader-pdf-integration-post-v1-phase-2-enabler.md#Story 10.1] (L5-31).
- Origin + spike charter + FRs: [Source: .bmad/planning-artifacts/sprint-change-proposals/sprint-change-proposal-2026-07-20-opendataloader-structure-layer.md] (Section 2 impact, Section 5 spike-gated handoff, Section 4d architecture addendum).
- **AD-13** (document-structure layer, main spine): [Source: .bmad/planning-artifacts/architecture/architecture-paper-mate-2026-06-28/ARCHITECTURE-SPINE.md] (L124-127); **AD-4** anchor model (L68-77), **AD-8** storage layout / additive artifacts (L96-103), **AD-9** boundary invariants (L104-107), **AD-3** contract sync (L63-66).
- **AD-L8** (structure extraction = second domain tenant, library spine): [Source: .bmad/planning-artifacts/architecture/architecture-paper-mate-library-2026-07-04/ARCHITECTURE-SPINE.md] (L115-118); **AD-L2** domain layer (L72-75), **AD-L4** import pipeline (L82-91), **AD-L7** index-write concurrency the structure artifact deliberately avoids (L110-113).
- opendataloader binding facts (spike-verified 2026-07-20): PyPI `opendataloader-pdf` (v1.12.0, Apache-2.0, Java 11+); GitHub `opendataloader-project/opendataloader-pdf` README (`convert()` file-based API, `[left,bottom,right,top]`-points bbox, type list).
- Code touch points (verbatim, current):
  - Contract: `server/app/models.py` `Rect` L313-321 (reuse), anchor models L330-361 (`page_index` convention); regen via `server/app/export_openapi.py`.
  - Domain: `server/app/domain/__init__.py` facade L15-19, `crossref.py` `Enricher` port shape, `extract.py` L142-187 (PyMuPDF open + totality pattern).
  - Storage: `server/app/storage/annotations_store.py` L28-103 (per-doc read/write template), `meta_store.py` L21-43 (schema-version gate), `errors.py` (`CorruptAnnotationsError` precedent), `paths.py` `doc_dir` L24-34, `__init__.py` facade L29-108.
  - Pipeline: `server/app/routes/extraction.py` `run_extraction` L12-63; `routes/docs.py` `upload_doc` L33-54 + `/annotations` GET L175-192 (route template); `Dockerfile` runtime stage L15-28 (JRE add).
  - Client: `client/src/api/client.ts` `getAnnotations` L124-128; `client/src/anchor/index.ts` `denormalizeRect`; `client/src/annotations/AnnotationLayer.tsx` + `client/src/reader/PageCard.tsx` L145-146 (per-page overlay); `client/src/render/index.ts` `getPageBox` L162-165.

## Dev Agent Record

### Agent Model Used

Opus 4.8 (claude-opus-4-8). Note: CLAUDE.md recommends Sonnet 5 xHigh for dev-story (the recurring AE7-1 model-drift); this story ran on Opus because the user launched dev-story on an Opus session. Flagged, not silently ignored.

### Debug Log References

- **Spike (Task 1), host:** `uv add opendataloader-pdf` resolved **2.5.0** (newer than the 1.12.0 the create-story research saw). Binding surface confirmed: `opendataloader_pdf.convert(input_path, output_dir, format="json", image_output="off", quiet=True)` is **file-based** (no in-memory return; `to_stdout=True` prints, returns `None`). Output is a **tree** (`{file name, number of pages, author, title, kids}`), NOT a flat list; a pre-order `kids` walk = reading order. Types across an 8-paper corpus: `heading, paragraph, list, list item, table, caption, text block, image` (NO `footnote`, NO `formula` observed -> recorded for 10-4). bbox = `[left,bottom,right,top]` PDF points y-up (confirmed). `page number` 1-indexed. `caption` carries `linked content id` -> its image (figure/caption link, useful for 10-3/10-4). Some container nodes (`text block`) serialize `page number`/`bounding box` as **strings** -> adapter coerces. No per-page dims in JSON -> PyMuPDF `page.rect`. Coordinate math validated: heading `[59.087,670.175,536.141,688.839]` on 612x792 -> y0=0.130 (top ~13%). **Spike PASSED.**
- **Backend suite:** `PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q` -> **351 passed** (was 324 baseline; +27 new: `test_structure.py` 22 + `test_models.py` structure tests 5). One initial failure surfaced + fixed: `test_domain_modules_are_pure` (AD-L2 purity guard) flagged `pathlib`/`tempfile` in `structure.py` -- resolved with a narrow, commented `_STRUCTURE_OS_SCRATCH` exemption (OS temp scratch allowed for the file-based binding; the `app.storage` ban still holds for structure.py), the story's anticipated surfaced deviation.
- **Frontend suite:** `npx vitest run` -> **1685 passed** (79 files; +18 new across `structure/index.test.ts`, `useDocStructure.test.tsx`, `StructureDebugLayer.test.tsx`). `npm run typecheck` clean. `no-raw-values` guard green (overlay uses numeric geometry + token `var()` refs; added 3 dev-overlay tokens to `components.css`).
- **Test-tooling note (vitest v4):** a rejecting `getStructure` mock in the hook test spuriously tripped vitest's global unhandled-rejection detector once ANY prior test had configured the mock. Root-caused to the effect-fired promise pattern; fixed by (a) switching the hook to `await` in try/catch (idiomatic, matches the library hooks) and (b) adopting the library-hook test recipe (`vi.clearAllMocks()` + a default never-settling `mockReturnValue` + mounting inside `act`). No production impact -- the hook was always correct.
- **Live smoke (Task 10), own servers (uvicorn :8097 + vite :5197, throwaway `PAPER_MATE_DATA` scratch dir), real multi-column paper `1903.03295v2.pdf`, DPR 2 via `chrome-devtools-mcp emulate 1400x1000x2`:**
  - Import -> `structure.json` produced, `GET .../structure` returned **172 elements** (`heading 26, paragraph 126, figure 5, caption 1, list 14`), all normalized/canonical rects.
  - Debug overlay (`?debugStructure=1`) at DPR 2 on page 1: boxes align exactly on the title (`heading2`), author/email `paragraph`s, the figure (`figure`), the caption, and the rotated arXiv left-margin stamp (boxed vertically on the left). Cross-page: page 5 (two-column body, 160% zoom) -- every paragraph in BOTH columns, section headings, equation blocks, and a `list` box align precisely.
  - **Rides zoom:** the title box's fractional position within its page card was byte-identical at 200% and 160% (relLeft 0.0972/0.0974, relTop 0.1308/0.1309) -- matches the stored `rect.x0=0.097, y0=0.13`.
  - **Rotated PAGE:** no `/Rotate` fixture was available (all 8 corpus PDFs are rot=0); a rotated ELEMENT (the arXiv stamp) mapped correctly. Recorded as the one unverified edge (AC #1 allows it); the CropBox+`/Rotate` basis is coded via PyMuPDF `page.rect`.
  - **In-container proof (AC #1a):** `docker run python:3.13-slim` (the Dockerfile runtime base) + `apt-get install default-jre-headless` (JRE **21**, satisfies Java 11+) + `pip install opendataloader-pdf==2.5.0` -> `convert()` produced **172 elements** in-container. Validates the Dockerfile runtime-stage JRE change without the full multi-minute image build.
  - Test doc purged afterward; scratch `PAPER_MATE_DATA/library` confirmed empty. Dev servers stopped.

### Completion Notes List

- Delivered the whole structure LAYER (no consumer UI, per scope): the contract (`StructureElement`/`DocStructure`), the `extract_structure` port + `OpenDataLoaderExtractor` adapter (server-side PDF-points -> normalized flip), the per-doc `structure_store` (`structure.json`, gated + schema-versioned + total), the import-pipeline wire (isolated `_run_structure`, no metadata coupling, no new status), the `GET /api/docs/{id}/structure` route + `docs/API.md` entry, the client `getStructure` + `structure/` service (selectors + `denormalizeElement` delegating to `anchor/`) + the `useDocStructure` hook, and a dev-only `StructureDebugLayer` (behind `?debugStructure=1`).
- **All five open design calls resolved as planned:** (1) JRE via `default-jre-headless` in the Dockerfile runtime stage; (2) `type` = our vocab + `"other"` catch-all, `image/picture -> figure`, `text block`/`formula`/unknown -> `other`; (3) page dims from PyMuPDF `page.rect` (JSON carries none); (4) NO new `analyzing` status (structure runs after metadata in the existing background task; readiness via the endpoint's empty/404); (5) opendataloader pinned to `==2.5.0`.
- **Surfaced deviations (accepted, not hidden):** the file-based binding uses an OS temp dir in the domain layer (AD-L2 "no filesystem" narrowly relaxed for throwaway scratch; `app.storage` import still banned in `structure.py`, guard updated to match); `footnote` is reserved but unproduced (opendataloader emitted none across the corpus -> flagged for 10-4).
- Every existing test still passes unmodified in intent; contract change is additive (no `schema_version` bump anywhere). Version bump (0.6.0 -> 0.6.1) deferred to PR-merge time per CLAUDE.md.

### File List

**Backend (new):**
- `server/app/domain/structure.py` — the `StructureExtractor` port + `OpenDataLoaderExtractor` adapter + `_map_tree`/`_to_rect` (the server-side y-flip/normalize) + module `extract_structure` (total).
- `server/app/storage/structure_store.py` — per-doc `structure.json` read/write (envelope + schema-version gate + empty-not-error + corrupt/unknown-version rejection).
- `server/tests/test_structure.py` — mapping/flip/totality, store round-trip + error taxonomy, route (404/empty/populated/500), `run_extraction` isolation.
- `server/tests/fixtures/structure/odl_1903_multicol.json` — captured real multi-column opendataloader output (mapping fixture).
- `server/tests/fixtures/structure/odl_synthetic_edgecases.json` — synthetic tree covering string coords, `text block` container, `formula`/unknown -> `other`, page conversion, reading order.

**Backend (modified):**
- `server/app/models.py` — `StructureType` + `StructureElement` + `DocStructure` (additive).
- `server/app/domain/__init__.py` — export `extract_structure` + port/adapter.
- `server/app/storage/errors.py` — `CorruptStructureError`.
- `server/app/storage/__init__.py` — facade: `read_structure`/`write_structure`/`STRUCTURE_SCHEMA_VERSION`/`CorruptStructureError`.
- `server/app/routes/extraction.py` — `run_extraction` now also runs isolated `_run_structure` after metadata.
- `server/app/routes/docs.py` — `GET /api/docs/{doc_id}/structure`.
- `server/pyproject.toml` + `server/uv.lock` — `opendataloader-pdf==2.5.0`.
- `server/tests/conftest.py` — autouse `_stub_structure` (keeps the JVM out of the general suite).
- `server/tests/test_models.py` — `StructureElement`/`DocStructure` validation + round-trip tests.
- `server/tests/test_domain.py` — `_STRUCTURE_OS_SCRATCH` narrow exemption in the AD-L2 purity guard.
- `Dockerfile` — `default-jre-headless` in the runtime stage (AD-13 in-container JRE).

**Client (new):**
- `client/src/structure/index.ts` — the structure service (selectors + `denormalizeElement` delegating to `anchor/`).
- `client/src/structure/useDocStructure.ts` — fetch/hold hook.
- `client/src/structure/StructureDebugLayer.tsx` — dev-only per-page placement overlay (behind `?debugStructure=1`).
- `client/src/structure/index.test.ts`, `useDocStructure.test.tsx`, `StructureDebugLayer.test.tsx` — service/hook/overlay tests.

**Client (modified):**
- `client/src/api/client.ts` — `getStructure` + `StructureElement`/`DocStructure` type re-exports.
- `client/src/api/schema.d.ts` — regenerated (committed generated artifact).
- `client/src/reader/PageCard.tsx` — render `<StructureDebugLayer>` per page.
- `client/src/theme/components.css` — 3 dev-overlay tokens (`--structure-debug-*`).

**Docs / tracking:**
- `docs/API.md` — `GET /api/docs/{doc_id}/structure` resource entry + dated changelog line.
- `.bmad/implementation-artifacts/sprint-status.yaml` — `10-1`: `backlog` -> `ready-for-dev` -> `in-progress` -> `review`; `epic-10`: `backlog` -> `in-progress`.

## Change Log

- 2026-07-20: Story created (bmad-create-story, Opus). Spike-verified the `opendataloader-pdf` binding surface (file-based `convert()`, Java 11+, Apache-2.0, `[left,bottom,right,top]`-points bbox, type list, footnote-not-confirmed) and resolved the epic's five open design calls: (1) JRE via the Dockerfile runtime stage; (2) `type` = our vocabulary + `"other"` catch-all with an adapter mapping (`image/picture -> figure`); (3) page dims from JSON else PyMuPDF `page.rect`; (4) NO new `analyzing` status (structure runs inside the existing background task, readiness observed via the endpoint); (5) pin the exact opendataloader patch. Pinned the server-side y-flip/normalize math and the CropBox+`/Rotate` basis as the coordinate-correctness gate, and the file-based-binding temp-dir purity nuance as a surfaced AD-L2 deviation.
- 2026-07-20: Implemented (bmad-dev-story, Opus). Spike PASSED (binding 2.5.0 runs; tree-shaped output, pre-order `kids` walk = reading order; coordinate math validated). Built the full layer (contract + domain port/adapter + storage + pipeline wire + route + client service/hook + dev overlay) with all five open design calls resolved as planned. Backend 351 passed (+27), frontend 1685 passed (+18), typecheck clean. Live-smoked at DPR 2 on a multi-column paper: 172 elements, overlay aligns on headings/paragraphs/figure/caption across pages and rides zoom; in-container JRE+binding proof passed (`python:3.13-slim` + `default-jre-headless` -> 172 elements). Surfaced deviations recorded (OS temp scratch in domain with a narrowed purity guard; `footnote` reserved-but-unproduced). Status -> review.
- 2026-07-20: Codex `bmad-code-review` (cross-model, read-only sandbox, no wrapper timeout) returned **Changes Requested** (1 High, 6 Med, 3 Low). Flipped -> in-progress; fixed all 9 actionable findings (see Review Findings): the High in-container proof re-done on the **real Dockerfile image** (import through FastAPI, `structure.json` in the mounted `/data`) + a table paper (5 tables) live-smoked at DPR 2; `create_parents=False` purge-race guard; `elements`-must-be-a-list corrupt-taxonomy fix; non-UTF-8 -> `CorruptStructureError`; hook reset-on-doc-switch; debug-cache no-cache-empty; exact `==2.5.0` pin + lock; off-contract adapter-result coercion; single-column substantiated via the corpus sweep. Added 5 backend + 1 client regression tests. Re-verified: backend 355, frontend 1686, typecheck clean. Status -> review.
