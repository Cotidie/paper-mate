# Deferred Work

Items surfaced during review that are real but intentionally not actioned now.

## Deferred from: code review of story-1-2-open-a-pdf-from-disk (2026-06-28)

- **Upload size cap** [server/app/routes/docs.py:21] — `POST /api/docs` reads the entire PDF into memory (`await file.read()`) with no size limit, so a very large upload could exhaust server memory before validation. Deferred: the deployment is localhost single-user with no auth (AD-1/AD-10), no size limit is specified, and papers are small. Revisit if the app is ever exposed to multiple/untrusted users — add a max-size guard returning 413, or a storage-owned streaming hash path.

## Deferred from: code review of 1-5-zoom (2026-06-28)

- ~~**Text layer scale variables outside pdf.js viewer wrapper**~~ **(RESOLVED 2026-06-28)** — `renderPage` now explicitly sets `--scale-factor` and `--total-scale-factor` on the swapped `.textLayer`, instead of relying on a `.pdfViewer .page` wrapper or the copied `cssText` alone. Live-verified after a zoom: `--scale-factor` = scale, `--total-scale-factor` = scale × DPR, spans aligned.
- ~~**Scroll-away render cancellation**~~ **(PROMOTED 2026-06-28 → Story 1.7)** [client/src/Reader.tsx] — `PageCard` marks a page visible once and disconnects the observer, so in-flight page renders cancel on unmount or scale change but not when the card leaves the viewport. Now tracked as Story 1.7 (render perf — windowing & viewport unification) via correct-course; see `.bmad/planning-artifacts/sprint-change-proposal-2026-06-28-render.md`.

## Deferred from: story 1-9-table-of-contents (2026-06-29) — Phase 2

> Surfaced while building the v1 ToC (embedded-outline only). These three are coupled: synthesizing a ToC is expensive, so it must be persisted, which bumps the metadata schema. Treat as one Phase-2 thread. **Backend-grows-in-v2 trigger.** When picked up, this likely wants an architecture-spine note (storage layer + `meta.json` schema), not just a story — route through `correct-course` or a fresh Phase-2 epic before `create-story`.

- **Synthesize a ToC when there is no embedded outline** [client/src/render/index.ts `getOutline`] — v1 reads only the PDF's embedded outline; a scanned/simple/no-outline PDF (and a PDF whose outline has dangling named dests, e.g. `fixtures/sample-pdfs/09-regularization.pdf` — `/Dest /3b` with no `/Names`/`/Dests` tree) gets the empty state. Two synthesis paths evaluated:
  - **Font-heuristic, in-process** (preferred for our architecture): detect headings from pdf.js `getTextContent` span styles (size/weight/position) + section-numbering regex (`1`, `1.1`, `2 Methods`). Gives page numbers for free (the heading IS a span on a known page — the data the jump needs). ~70-85% on clean digital papers, ~0 on scans (needs OCR first). Slots into `render/` (or a new `outline/` synthesizer) behind the same `TocEntry[]` contract, so `TocPanel`/`jumpToPage` are unchanged.
  - **GROBID** (most reliable off-the-shelf for academic papers, ML, → TEI XML): higher quality but a heavy Java/Docker service — only viable once the backend grows past the single-container, no-heavy-deps v1 posture. Page-mapping is extra work vs. the font-heuristic path.
  - LLM path rejected for grounding: it gives section titles but not page positions, so it still needs the positional layer anyway — no advantage over the font-heuristic for our jump-to-page need.
- **Persist the parsed/synthesized ToC in doc metadata** [server/app/storage, `library/<doc_id>/meta.json`] — synthesis is expensive, so compute once per `doc_id` and cache, not on every open. Either add a `toc: TocEntry[]` field to `meta.json` or a sibling `library/<doc_id>/toc.json` (atomic write via the storage module, AD-8). Client reads the cached ToC by id; falls back to live parse + write-through on a cache miss. Keep the `TocEntry` shape as the single contract shared by the live `getOutline`, the synthesizer, and the persisted form.
- **Metadata schema bump** [server/app/models.py `Doc.schema_version`] — adding a persisted `toc` is a `meta.json` schema change → bump `schema_version` and define the read path for older docs (lazy re-parse on open, or a one-time migration). Pydantic-model change → regenerates OpenAPI → TS contract (per CLAUDE.md), and needs a `docs/API.md` entry. This is why the thread wants an architecture-spine touch, not just a story.
