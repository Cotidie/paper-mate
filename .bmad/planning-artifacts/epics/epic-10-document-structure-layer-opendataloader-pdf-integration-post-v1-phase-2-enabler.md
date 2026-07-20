# Epic 10: Document structure layer (opendataloader-pdf integration) (post-v1, Phase-2 enabler)

> Added 2026-07-20 via correct-course (`sprint-change-proposal-2026-07-20-opendataloader-structure-layer.md`). User decision to adopt **opendataloader-pdf** (Apache-2.0) as Paper Mate's document-structure engine and heavily replace custom PDF-interpretation logic with the building blocks it provides. The tool emits, per element, `{type, page number, bounding box [left,bottom,right,top] in PDF points, heading level, font, content}` for headings (leveled), paragraphs, tables, lists, images, captions, formulas, plus reading order and header/footer/watermark filtering, and those boxes map 1:1 onto our `RectAnchor` (AD-4: normalize by page dims, flip Y). One server-side extraction pass at import yields a **document-structure layer** (a per-doc `structure.json` + a `DocStructure` contract + a client `structure/` service) that TOC, a Figures/Tables index, the reading-helper previews, and metadata all consume as thin readers, replacing four hand-rolled detectors. Architecture: **AD-13** (main spine, the structure layer) + **AD-L8** (library spine, structure extraction = the domain layer's second tenant). It runs INSIDE the container (Java core + `opendataloader-pdf` Python binding + a JRE; the PDF is already in `/data`), so unlike the Phase-3 host agent CLIs it does not hit the dockerization boundary. Deterministic + offline for born-digital PDFs in **local mode**; **hybrid mode** (Docling + a vision model) is adopted in Story **10-3** for higher fidelity (runtime-switchable back to local); OCR/scanned mode stays out of scope. Story **10-1 is the SPIKE-FIRST enabler** and a hard prerequisite for 10-2..10-8; Story **10-5 supersedes Story 12.3** (FR-27 delivered on the structure layer). Story 10-9 is the terminal structural-refactor pass (AE7-5). New FRs (proposed, finalize in a reader-PRD addendum): FR-34 (structure), FR-35 (section nav), FR-36 (figures/tables index), FR-37 (digest, directional); FR-27 reframed; LFR-8 upgraded.

## Story 10.1: Structure-extraction enabler (SPIKE-FIRST)

> The Phase-2 structure foundation. Proves the dependency and builds the layer nothing else in the epic can exist without: the `opendataloader-pdf` Python binding running in the container image (a JRE + the bundled JVM), the extraction port + adapter, the per-doc artifact, the contract + route, and the coordinate mapping. SPIKE-FIRST because two things must be proven before the contract is committed: (a) the binding runs deterministically in-image, and (b) the PDF-points → normalized-rect → screen mapping is pixel-correct. New reader **FR-34**; architecture **AD-13** (main) + **AD-L8** (library). Consumes/produces AD-4 anchors; runs in the AD-L4 import pipeline; writes to the AD-8 storage layout.

As a reader,
I want each imported paper analyzed into a structured, box-anchored set of document elements,
So that the reader can become section-aware (Figures, Tables, Headings, Paragraphs, Footnotes, Captions, Lists) from one source of truth.

**Acceptance Criteria:**

**Given** the story
**Then** it STARTS with a spike (a negative outcome is complete + acceptable): confirm `opendataloader-pdf` (Python binding) runs inside the container image with a bundled/added JRE, deterministically and offline, on 2-3 real papers (single- and multi-column); produce each paper's raw element output; and prototype the `[left,bottom,right,top]`-points → normalized `[0,1]` top-left-origin `Rect` mapping (page dimensions from the JSON if present, else PyMuPDF `page.rect`), live-smoked by overlaying the derived rects on the rendered pages at DPR>1 and confirming they sit on the real elements, BEFORE committing the contract (FR-34, AD-4, AD-13)

**Given** an imported document
**When** the background import pipeline runs (AD-L4)
**Then** `extract_structure(pdf_bytes) -> DocStructure` runs behind a port (opendataloader the first adapter, mirroring AD-L2's extract/enrich seam), and the result is persisted as `~/.paper-mate/library/{doc_id}/structure.json` beside `source.pdf`/`meta.json`, a per-doc artifact, written by storage only (AD-8, AD-9, AD-L8); a failure yields an empty structure, never a crash, and never blocks the paper reaching `ready` (total, like `extract()`)

**Given** the contract
**Then** `StructureElement { id, type, page_index, rect (normalized), text, heading_level? }` + `DocStructure { elements }` are additive Pydantic models surfaced into OpenAPI → generated TS types (never hand-authored), and `GET /api/docs/{doc_id}/structure` returns the doc's structure (404/empty for an unanalyzed or non-PDF doc), documented in `docs/API.md` (AD-3, FR-34)

**Given** the client
**Then** a new `structure/` service fetches + holds `DocStructure` for the open doc and exposes typed selectors (headings, figures, tables, element-at-marker), denormalizing rects to screen at the current scale exactly like the annotation anchor layer (AD-4, AD-9: coordinate math stays at the anchor boundary), with NO consumer UI yet (this story ends at the layer + one debug overlay proving placement)

**Given** the coordinate mapping
**Then** it is live-smoked at DPR>1 on a multi-column paper: the derived element rects align to the real headings/figures/tables/paragraphs across pages and across zoom, not only in a unit test ([[verify-on-hidpi-and-real-host]])

> **Out of scope:** OCR / scanned PDFs (opendataloader hybrid mode, Docling + vision model); any user-facing consumer (TOC/index/preview/metadata are 10-2, 10-4..10-7); re-analysis on annotation edits (structure is import-time, immutable). **Open design calls for create-story:** JRE bundling strategy (base image with JRE vs a multi-stage add); the exact `StructureElement.type` enum (map opendataloader types to our vocabulary); whether page dimensions come from the JSON or PyMuPDF; sync-at-import vs a separate `analyzing` status distinct from `extracting`; version-pinning opendataloader.

## Story 10.2: Section navigation, synthesized Table of Contents

> Replaces Story 1.9's dependence on the PDF's *embedded* outline (absent from most papers) with a Table of Contents synthesized from opendataloader's leveled headings, so every paper gets jump-to-section. New reader **FR-35** (upgrades **FR-3**). Consumes the Story 10-1 structure layer (headings). Depends on 10-1.

As a reader,
I want a table of contents built from the paper's own headings,
So that I can jump to any section even when the PDF has no embedded outline.

**Acceptance Criteria:**

**Given** an analyzed paper with detected headings
**When** I open the Table of Contents
**Then** it lists the headings in reading order with their hierarchy (heading level), and each entry jumps to that heading's page + region (FR-35, AD-4)

**Given** a paper WITH an embedded PDF outline
**Then** create-story decides precedence (embedded outline vs synthesized) so the better source wins and the two never double-render; a paper with NEITHER shows the existing empty/absent state, unchanged (FR-3/FR-35)

**Given** a heading jump
**Then** it composes with the Story 1.7 render windowing (target page rendered before the jump) and the Story 3.6 flash idiom, landing at the section without a scroll-jank burst (NFR-2)

**Given** the TOC UI
**Then** it reuses the existing ToC panel affordance (Story 1.9) and its labels/tooltips contain no em-dash

> **Out of scope:** editing/reordering the synthesized TOC; numbering sections. **Open design calls for create-story:** embedded-vs-synthesized precedence (or a merge); how deep the hierarchy nests; whether Story 1.9's outline code stays as a fallback or is retired.

## Story 10.3: Migrate structure extraction to opendataloader hybrid mode (runtime-switchable)

> Added 2026-07-21 via correct-course (`sprint-change-proposal-2026-07-21-structure-hybrid-mode.md`); **prioritized to 10.3** (was 10.8) via correct-course 2026-07-21 (`sprint-change-proposal-2026-07-21-prioritize-hybrid-mode.md`) so the fidelity upgrade lands BEFORE the remaining consumers (Figures/Tables index, reading-helper, metadata, digest) are built — they then read the higher-fidelity structure from the start instead of local mode then a re-validate after a later hybrid swap. Story 10.1 shipped opendataloader's **local/fast** mode (deterministic + offline, born-digital PDFs) and deferred the **hybrid** mode (Docling + a vision model). A live diagnostic on the TranAD paper (`fixtures/sample-pdfs/adtran.pdf`, no embedded outline) showed local mode's heading-detection gaps: `3 METHODOLOGY` extracted but mis-tagged `paragraph`, `3.1 Problem Formulation` / `3.2 Data Preprocessing` not extracted at all — so the synthesized ToC (10.2) drops real sections. User decision (2026-07-21): **migrate to hybrid mode for better structure fidelity, and keep the mode runtime-switchable so falling back to local (non-hybrid) is trivial at any time.** Consumes/produces the Story 10.1 layer unchanged (same `DocStructure` contract, same `[left,bottom,right,top]`-points → normalized-`Rect` mapping); this changes only the extractor's *mode*, behind the existing `extract_structure` port. Amends **AD-13** (un-defers hybrid; the deterministic + offline guarantee becomes MODE-dependent, see below). No new FR — a quality/fidelity upgrade to **FR-34** (structure) that flows into every consumer (10.2 ToC, 10.4 Figures/Tables index, 10.5 reading-helper, 10.6 metadata, 10.7 digest). Depends on 10.1. **SPIKE-FIRST**, mirroring 10.1: hybrid mode adds heavy deps and relaxes two AD-13 invariants, so prove it in-container before committing.

As a reader,
I want the document structure extracted with higher fidelity (fewer missed/mis-tagged headings, tables, and figures),
So that the ToC, Figures/Tables index, reading-helper, and metadata are more complete and accurate, especially on papers with no embedded outline.

**Acceptance Criteria:**

**Given** the story **(SPIKE-FIRST gate; a negative outcome is a complete + acceptable result)**
**Then** it STARTS with a spike before any migration is committed: confirm opendataloader's **hybrid** mode (Docling + a vision model) runs **inside the container image**, and characterize its cost/behavior against local mode on 2-3 real papers (incl. the TranAD case): (a) that `3 METHODOLOGY` / `3.1` / `3.2` and similar are now recovered as headings; (b) the added image size + dependency footprint (Docling + the vision model weights); (c) whether the mode needs network / a model download at build or run (the offline question); (d) whether it is deterministic run-to-run (a vision model may not be); (e) that the hybrid JSON output shape (bbox `[left,bottom,right,top]` points, 1-indexed page, our `type` vocabulary) is **identical** to local mode, so `domain/structure.py`'s points→normalized `Rect` mapping and type-map need NO change (if it differs, that delta is the finding). If hybrid cannot run in-image, or breaks the coordinate mapping, STOP and write it up ([[verify-on-hidpi-and-real-host]]).

**Given** the mode is proven
**When** structure extraction runs at import (AD-L4)
**Then** the `OpenDataLoaderExtractor` adapter selects local vs hybrid from a **single runtime config switch** (e.g. `PAPER_MATE_STRUCTURE_MODE=hybrid|local`, read once; create-story fixes the exact name/mechanism), **defaulting to hybrid** (the migration), with **local reachable by flipping one env value** — no code change, no rebuild-for-flip beyond whatever deps the image already carries. The `extract_structure` port + the `DocStructure` contract + the persisted `structure.json` shape are **unchanged** (AD-13/AD-3): a consumer cannot tell which mode produced a structure.

**Given** either mode
**Then** extraction stays **total + non-blocking** exactly as Story 10.1 (a hybrid failure — model load error, timeout, OOM — yields an empty `DocStructure`, never crashes the import, never blocks the paper reaching a settled status), and the structure-status dot's `analyzing`→`ready` lifecycle is unchanged.

**Given** AD-13's "deterministic + offline for born-digital PDFs" invariant
**Then** the change **surfaces, not hides,** how hybrid relaxes it: if hybrid is non-deterministic or needs network/model weights, that is documented as a MODE property, and **local mode remains the deterministic + offline fallback** reachable via the switch (so the offline/local-first promise, NFR-1, is still satisfiable by config). The default (hybrid vs local) is the user's call, recorded in create-story.

**Given** the migration is live-smoked
**Then** on the TranAD paper the synthesized ToC (Story 10.2) now includes the sections local mode dropped (`3 Methodology`, `3.1`, `3.2`), verified at DPR>1 that the recovered headings still land on the real on-page elements (the coordinate mapping still holds under hybrid output).

> **Out of scope:** re-analyzing already-imported papers (new-imports-only; a backfill/re-extract pass is its own story); changing any consumer (ToC/index/reading-helper/metadata read the same contract); a per-doc or per-request mode override (ONE global switch this story). **Open design calls for create-story:** the exact config mechanism + name + default (hybrid vs local); the JRE/Docling/vision-model bundling strategy for the image (and its size budget); whether hybrid needs a build-time model fetch vs a bundled weight; the timeout/resource guard for the heavier pass; whether to expose the active mode via `GET /api/health` for observability.

## Story 10.4: Figures & Tables index

> Surfaces opendataloader's detected figure and table regions as a navigable index (a visual TOC), the first user-facing payoff of section-awareness beyond headings, and the groundwork for Phase-3 "select a Figure/Table to chat about" (the region is already known, no box-drawing). New reader **FR-36**. Consumes the Story 10-1 structure layer (figures, tables, captions). Depends on 10-1.

As a reader,
I want an index of the paper's figures and tables,
So that I can jump straight to any figure or table and see where they are.

**Acceptance Criteria:**

**Given** an analyzed paper
**When** I open the Figures & Tables index
**Then** it lists each detected figure and table (label from its caption where available, e.g. "Figure 3", "Table 1"), grouped/ordered by reading order, each jumping to its region (FR-36, AD-4)

**Given** a figure/table entry
**When** I select it
**Then** the reader scrolls to and briefly indicates its region (the Story 3.6 flash idiom), anchored at correct coordinates across zoom (NFR-3)

**Given** a paper with no detected figures/tables
**Then** the index shows a calm empty state, never a broken panel (FR-36)

**Given** the index is live-smoked at DPR>1 on a multi-column paper
**Then** entries map to the correct on-page figures/tables

> **Out of scope:** extracting figure/table CONTENT (image crop, table cells as data, a later story); click-to-chat (Phase 3). **Open design calls for create-story:** where the index lives (its own panel/lens vs a section of the ToC); caption-label parsing ("Figure N" from the caption element); dedupe of a figure and its caption element.

## Story 10.5: Inline reading-helper previews via structure lookup (supersedes Story 12.3)

> Delivers FR-27 (inline preview of a clicked Figure/Table mention, footnote, or citation marker) on the Story 10-1 structure layer, superseding Story 12.3, whose "regex over text-layer spans + geometry" approach is dropped in favor of a lookup against typed, box-anchored elements. Figure/Table first (cleanest: a "Figure N" mention resolves to the figure/caption element whose caption starts "Figure N"), then footnote / `[n]`. **FR-27** (reframed). Depends on 10-1 (and benefits from 10-4's caption-label parsing).

As a reader,
I want to preview a figure, table, footnote, or reference without leaving my reading position,
So that I can check supporting information without losing my place.

**Acceptance Criteria:**

**Given** a `Figure N`/`Table N` mention, a footnote marker, or a citation marker (`[n]`) in the text
**When** I click it
**Then** a floating preview of the target region opens in place (the figure/table region, the footnote text, or the reference entry), resolved by looking the marker up against the structure layer's typed elements, without scrolling me away or reflowing the page (FR-27, FR-34, NFR-1)

**Given** the preview
**Then** it is dismissable (`Esc`/outside-click), keyboard-reachable, and stays anchored at correct coordinates across zoom (FR-27, NFR-3, UX-DR17), reusing the fixed-overlay re-anchor idiom ([[fixed-overlay-live-reanchor]])

**Given** a marker whose target cannot be resolved (thin/absent structure)
**Then** it degrades gracefully (no preview / a muted "couldn't locate" affordance), never a broken or mis-placed popup (FR-27)

**Given** the resolver
**Then** it is validated against 2-3 real papers (multi-column, numbered-and-named references) and live-smoked at DPR>1

> **Out of scope:** click-to-chat / AI targeting (Phase 3); synthesizing a reference list when the PDF has none; OCR. **Open design calls for create-story:** which marker classes ship first; marker detection (text-layer span scan for `Figure N`/`[n]` vs opendataloader-provided links); how footnote markers map to footnote elements; the preview UI (reuse the comment-preview surface vs a new one).

## Story 10.6: Structure-backed metadata extraction

> Routes `extract()` (Story 6.5) through the structure layer, title from heading-level-1 / reading order instead of the PyMuPDF largest-font heuristic, keeping the current heuristic as the graceful fallback when structure is thin. The `bytes -> ExtractedMeta` seam is already documented "GROBID-swappable"; this is the swap-in. Upgrades **LFR-8**. Consumes the Story 10-1 structure layer. Depends on 10-1.

As a reader,
I want paper titles and authors detected more reliably,
So that my library rows are correct more often, on more papers.

**Acceptance Criteria:**

**Given** an analyzed paper
**When** the extraction pipeline runs
**Then** the title is taken from the structure layer (heading-level-1 in reading order at the top of page 1) when available, falling back to the existing PyMuPDF font heuristic + XMP + `/Info` when structure is thin/absent (LFR-8, AD-L2/AD-L8)

**Given** the DOI/arXiv capture
**Then** it is unchanged (regex over `/Info` + XMP + first-page text), now fed opendataloader's clean reading-order text; the Crossref/arXiv enrich hop (`enrich()`) is untouched (LFR-8)

**Given** the change
**Then** it is a pure quality upgrade behind the existing `extract() -> ExtractedMeta` contract: the extraction status lifecycle (`extracting → ready | enrich-skipped | parse-failed`), the storage projection, and `meta.json`/`CollectionRow` shapes are unchanged (AD-L2, AD-L4)

**Given** a corpus of real papers
**Then** the new path is spot-checked to not REGRESS titles the heuristic already gets right (a guarded swap, not a blind replace)

> **Out of scope:** author-list extraction from structure (authors still come from `/Info`/XMP + Crossref); re-running extraction on already-imported papers (create-story: backfill vs new-imports-only). **Open design calls for create-story:** the exact title-selection rule from structure; the fallback trigger (empty structure vs low confidence); whether the two sources are merged or strictly preferred.

## Story 10.7: Structure-derived paper digest (Phase-3 groundwork, directional)

> Directional Phase-3 groundwork: turn the structure layer's reading-order, header/footer-stripped, sectioned text into a clean "paper digest", the context payload the Phase-3 AI companion auto-injects (the north star). No AI feature is built here; this only produces + exposes the digest so Phase-3 consumes a ready artifact. New reader **FR-37** (directional). Consumes the Story 10-1 structure layer. Depends on 10-1. May be deferred if Phase-3 timing slips.

As a reader (and the future AI companion),
I want the paper's text available as a clean, reading-order, sectioned digest,
So that a later AI feature can be given accurate paper context by default.

**Acceptance Criteria:**

**Given** an analyzed paper
**Then** a digest is derivable from the structure layer: reading-order body text with headings as section boundaries, header/footer/watermark furniture removed, figures/tables represented by their captions (FR-37, FR-34)

**Given** the digest
**Then** it is exposed in a form Phase-3 can consume (create-story: a field on the structure response, a separate `GET .../digest`, or an in-memory client derivation) without committing any agent-execution decision (the Phase-3 host-CLI boundary stays deferred, AD-9)

**Given** a paper with thin structure
**Then** the digest degrades gracefully (raw reading-order text) rather than failing

> **Out of scope:** ALL Phase-3 AI/agent work (Q&A, vendor switching, click-to-chat); token-budgeting/chunking the digest for a model. **Open design calls for create-story:** where the digest lives (server field vs client derivation); whether it ships at all this epic or waits for Phase-3; format (markdown vs structured sections).

## Story 10.8: Prioritize Semantic Scholar over Crossref for metadata enrichment

> Added 2026-07-20 via correct-course (`sprint-change-proposal-2026-07-20-metadata-semantic-scholar-first.md`). A live diagnostic on DOI `10.14778/3514061.3514067` (TranAD) found Crossref registers a **source-truncated** title (`TranAD`) that our DOI-first `enrich()` takes verbatim (no plausibility gate on the DOI path), overwriting the correct local title `TranAD: Deep Transformer Networks for Anomaly Detection in Multivariate Time Series Data`. Field-by-field, **Semantic Scholar** is the better source for title, year, venue (full + short), and author display names; **Crossref** is better for full-given author names + reference graphs, so it is **demoted to fallback and reserved for later AI features** (paper digest, citation-aware chat). This **resolves the Library-PRD open question** (which external metadata service, and by what key). New reader/library **LFR-9** (reframed: S2-primary, Crossref-fallback). An enrich-source change behind the existing `enrich(meta) -> meta | "skipped"` seam (AD-L2); **independent of the structure layer** (does NOT consume Story 10-1). Interacts with Story 10-6 on the title field (10-6 improves the LOCAL title candidate; this improves the EXTERNAL correction + guards against a bad overwrite) — sequence deliberately.

As a reader,
I want metadata enriched from Semantic Scholar first, with Crossref as the fallback,
So that my library rows show the correct full title and a clean venue instead of the truncated or worse values Crossref sometimes registers.

**Acceptance Criteria:**

**Given** a paper with a resolvable DOI (or arXiv id, or a confident title match)
**Then** Semantic Scholar is the **primary** source for `title`, `year`, `venue`, `venue_short`, and author display names (`authors_list`), replacing the Crossref-first order; the truncated-title DOI `10.14778/3514061.3514067` resolves to the FULL title (LFR-9)

**Given** Semantic Scholar skips (offline, non-200, rate-limited, or no match)
**Then** Crossref fills the same fields as the fallback (its existing cascade), and if Crossref also skips the local `extract()` values survive; `crossref.py` stays in the codebase as the fallback + the reserved detailed-author/reference source for future AI features (LFR-9, AD-L2)

**Given** Semantic Scholar's `publicationVenue.alternate_names`
**Then** `venue_short` is the **shortest** entry (ties -> first), not the acronym-shape-only scan of Story 8.5 (which returns nothing for multi-word venues like VLDB)

**Given** any failure at any hop (S2 or Crossref: offline, timeout, 429 rate-limit, malformed)
**Then** enrichment degrades to `"skipped"` and the paper still settles (`ready | enrich-skipped | parse-failed`), never raises, never blocks the add; a 429 is a normal skip, not an error notice (NFR-1/NFR-3)

**Given** whichever source wins
**Then** a strictly-shorter title that is a prefix/substring of a better one never overwrites it (a targeted guard that kills the truncation class regardless of source), and the change is additive behind the existing seam: no new `DocMeta`/`CollectionRow` field, no `schema_version` bump, no route change, new-imports-only

> **Out of scope:** backfill of already-imported papers; a heavy retry/queue for S2 rate limits (a 429 is just a skip this story); consuming Crossref's detailed authors/references (reserved for a future AI-features story). **Open design calls for create-story:** the S2 lookup-key order (DOI -> arXiv id -> title-search) and the title-search plausibility gate; whether `journal.name` beats the shortest `alternate_names` for `venue_short`; whether to read an optional `S2_API_KEY` env for a higher rate limit.

## Story 10.9: Epic 10 structural refactor (terminal)

> Terminal structural-refactor pass (AE7-5), same footing as Stories 5.0/5.3/5.4/6.8/8.10/9.9. Sequenced LAST so its scope reflects everything Stories 10.1-10.8 touched: the `domain/structure.py` extraction seam + adapter (now incl. the local/hybrid mode switch, Story 10.3), the `structure/` client service + its consumers (TOC, index, reading-helper, metadata), the enrich-source cascade (10.8), the structure-status derivation (marker + existence), and any coordinate-mapping helper. No new FR, no behavior/contract change.

As a developer-user,
I want the structure-layer code unified behind cohesive modules with reduced conditional sprawl,
So that Phase-3 builds on clean boundaries instead of accreting patches onto the same files.

**Acceptance Criteria:**

**Given** every file Stories 10.1-10.8 touched (finalize the list once they land)
**Then** each is audited for the same smells 5.3/6.8/8.10/9.9 targeted (god-objects/god-functions, near-duplicate conditional branches that should be one descriptor/registry, coordinate math outside the anchor boundary AD-9), and recorded decomposed-or-left-clean with rationale

**Given** the extraction adapter (+ its local/hybrid mode switch) + the client `structure/` service + its consumers + the enricher cascade
**Then** their shared concerns (marker→element resolution, element-type dispatch, points→normalized mapping, enricher-source fallback, extraction-mode selection) are unified behind cohesive units rather than parallel per-consumer conditionals

**Given** this is a pure refactor thread
**Then** it changes NO behavior and NO contract: every existing test still passes unmodified in intent; no structure-contract / storage / API change; lands in its own PR(s)

> **Out of scope:** any new capability; touching modules Epic 10 did not touch. **Open design calls for create-story:** the exact module boundaries; final scope depends on which of 10.1-10.8 shipped.
