# Epic 10: Document structure layer (opendataloader-pdf integration) (post-v1, Phase-2 enabler)

> Added 2026-07-20 via correct-course (`sprint-change-proposal-2026-07-20-opendataloader-structure-layer.md`). User decision to adopt **opendataloader-pdf** (Apache-2.0) as Paper Mate's document-structure engine and heavily replace custom PDF-interpretation logic with the building blocks it provides. The tool emits, per element, `{type, page number, bounding box [left,bottom,right,top] in PDF points, heading level, font, content}` for headings (leveled), paragraphs, tables, lists, images, captions, formulas, plus reading order and header/footer/watermark filtering, and those boxes map 1:1 onto our `RectAnchor` (AD-4: normalize by page dims, flip Y). One server-side extraction pass at import yields a **document-structure layer** (a per-doc `structure.json` + a `DocStructure` contract + a client `structure/` service) that TOC, a Figures/Tables index, the reading-helper previews, and metadata all consume as thin readers, replacing four hand-rolled detectors. Architecture: **AD-13** (main spine, the structure layer) + **AD-L8** (library spine, structure extraction = the domain layer's second tenant). It runs INSIDE the container (Java core + `opendataloader-pdf` Python binding + a JRE; the PDF is already in `/data`), so unlike the Phase-3 host agent CLIs it does not hit the dockerization boundary. Deterministic + offline for born-digital PDFs (local mode); OCR/hybrid mode (Docling + a vision model) is out of scope. Story **10-1 is the SPIKE-FIRST enabler** and a hard prerequisite for 10-2..10-6; Story **10-4 supersedes Story 12.3** (FR-27 delivered on the structure layer). Story 10-7 is the terminal structural-refactor pass (AE7-5). New FRs (proposed, finalize in a reader-PRD addendum): FR-34 (structure), FR-35 (section nav), FR-36 (figures/tables index), FR-37 (digest, directional); FR-27 reframed; LFR-8 upgraded.

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

> **Out of scope:** OCR / scanned PDFs (opendataloader hybrid mode, Docling + vision model); any user-facing consumer (TOC/index/preview/metadata are 10-2..10-5); re-analysis on annotation edits (structure is import-time, immutable). **Open design calls for create-story:** JRE bundling strategy (base image with JRE vs a multi-stage add); the exact `StructureElement.type` enum (map opendataloader types to our vocabulary); whether page dimensions come from the JSON or PyMuPDF; sync-at-import vs a separate `analyzing` status distinct from `extracting`; version-pinning opendataloader.

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

## Story 10.3: Figures & Tables index

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

## Story 10.4: Inline reading-helper previews via structure lookup (supersedes Story 12.3)

> Delivers FR-27 (inline preview of a clicked Figure/Table mention, footnote, or citation marker) on the Story 10-1 structure layer, superseding Story 12.3, whose "regex over text-layer spans + geometry" approach is dropped in favor of a lookup against typed, box-anchored elements. Figure/Table first (cleanest: a "Figure N" mention resolves to the figure/caption element whose caption starts "Figure N"), then footnote / `[n]`. **FR-27** (reframed). Depends on 10-1 (and benefits from 10-3's caption-label parsing).

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

## Story 10.5: Structure-backed metadata extraction

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

## Story 10.6: Structure-derived paper digest (Phase-3 groundwork, directional)

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

## Story 10.7: Epic 10 structural refactor (terminal)

> Terminal structural-refactor pass (AE7-5), same footing as Stories 5.0/5.3/5.4/6.8/8.10/9.9. Sequenced LAST so its scope reflects everything Stories 10.1-11.6 touched: the `domain/structure.py` extraction seam + adapter, the `structure/` client service + its consumers (TOC, index, reading-helper, metadata), and any coordinate-mapping helper. No new FR, no behavior/contract change.

As a developer-user,
I want the structure-layer code unified behind cohesive modules with reduced conditional sprawl,
So that Phase-3 builds on clean boundaries instead of accreting patches onto the same files.

**Acceptance Criteria:**

**Given** every file Stories 10.1-11.6 touched (finalize the list once they land)
**Then** each is audited for the same smells 5.3/6.8/8.10/9.9 targeted (god-objects/god-functions, near-duplicate conditional branches that should be one descriptor/registry, coordinate math outside the anchor boundary AD-9), and recorded decomposed-or-left-clean with rationale

**Given** the extraction adapter + the client `structure/` service + its consumers
**Then** their shared concerns (marker→element resolution, element-type dispatch, points→normalized mapping) are unified behind cohesive units rather than parallel per-consumer conditionals

**Given** this is a pure refactor thread
**Then** it changes NO behavior and NO contract: every existing test still passes unmodified in intent; no structure-contract / storage / API change; lands in its own PR(s)

> **Out of scope:** any new capability; touching modules Epic 10 did not touch; the deferred OCR/hybrid path. **Open design calls for create-story:** the exact module boundaries; final scope depends on which of 10.1-11.6 shipped.
