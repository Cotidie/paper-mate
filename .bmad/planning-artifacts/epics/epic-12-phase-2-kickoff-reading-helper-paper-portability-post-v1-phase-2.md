# Epic 12: Phase 2 kickoff, reading helper & paper portability (post-v1, Phase-2)

> Added 2026-07-11 via correct-course (`sprint-change-proposal-2026-07-11-epic-8-9-stories.md`). The FIRST epic to cross the v1 → Phase-2 line. Split out of a ten-request user batch: the seven polish/defect items stayed in Epic 8; these three are net-new Phase-2 capabilities that each carry a new FR and (for 12.2/12.3) an architecture decision, so they were grouped here rather than folded into a fix-themed epic. Theme: get papers out of Paper Mate (download, export) and start the reading-helper preview through-line. 12.2 and 12.3 are SPIKE-FIRST (feasibility/design gate before commit) and want an architecture-spine note at create-story. New FRs: reader FR-26 (export), FR-27 (preview); Library FR-30 (download).

## Story 12.1: Download a library paper's original file

> User request: "download papers from my library so that I can save or access them outside Paper Mate." Reuses the existing `GET /api/docs/{doc_id}/file` served PDF (docs.py `get_doc_file`). Library **FR-30** (feature group F9). **AMENDED 2026-07-18 via correct-course (`sprint-change-proposal-2026-07-18.md`, item 13):** scope now includes a **multi-select → zip** download and a **Download button on the Library buttons panel** (beside Display / Move / Star / Delete / Add) — the single-file path and the bulk-zip path are one story, not two. The bulk/zip case moved from Out-of-scope into scope; the client-vs-server zip mechanism is a create-story call.

As a reader,
I want to download a paper from my library,
So that I can save or open it outside Paper Mate.

**Acceptance Criteria:**

**Given** a paper in the collection
**When** I choose Download (a row action, the Library buttons panel, or the reader)
**Then** the browser downloads its original PDF with a sensible filename (the original upload name or the paper title), reusing the existing `GET /api/docs/{doc_id}/file` served file with `Content-Disposition: attachment` (FR-30, NFR-1-Library)

**Given** a Download button on the Library buttons panel (beside Display / Move / Star / Delete / Add)
**When** ONE paper is selected and I click Download
**Then** that paper's original PDF downloads (same single-file path as the row action) (FR-30)

**Given** MULTIPLE papers selected
**When** I click Download
**Then** the selected originals download together as a single `.zip` (byte-identical members, sensible per-file names, deduped on name collision), via a client-side zip (JSZip) or a server zip route — decided at create-story (FR-30)

**Given** the download
**Then** it is byte-identical to the stored original (no re-encoding), works fully offline (local file server, no network), and never triggers the row's open/arm gesture (FR-30, NFR-6-Library)

**Given** a Trashed paper (Story 7.5)
**Then** whether Download is offered there is a create-story call (default: collection only) (FR-30)

**Given** the Download control label/tooltip
**Then** it contains no em-dash (L-UX-DR13)

> **Out of scope:** downloading an ANNOTATED PDF (that is Story 12.2, export). **Open design calls:** dedicated download route vs a `?download=1` flag on the existing file route; client-side (JSZip) vs a server zip route for the multi-select case; filename source (upload name vs title); whether download appears in the reader too.

## Story 12.2: Export an annotated PDF (SPIKE-FIRST)

> User request: "export a PDF containing my annotations so that I can preserve and share my marked-up paper." Promotes the Phase-2 "export-with-highlights" roadmap item into a named FR. Reader **FR-26**. Consumes AD-4 anchors. Starts with a flatten-path spike; the client-vs-server decision is an architecture-spine touch recorded at create-story.

As a reader,
I want to export a PDF that contains my annotations,
So that I can preserve and share my marked-up paper.

**Acceptance Criteria:**

**Given** an annotated paper
**When** I export
**Then** I get a PDF file with the annotations rendered onto the pages (highlight/underline/pen/memo/comment/region), positioned at their exact PDF coordinates via the AD-4 anchors (FR-26, NFR-3)

**Given** the story
**Then** it STARTS with a flatten-path spike: prototype stamping annotations onto a real annotated paper and decide client (pdf-lib) vs server (pikepdf/pypdf/reportlab), recording the choice as an architecture-spine decision before the full build (FR-26, AD-4)

**Given** a comment/memo (text body)
**Then** the export represents it legibly (create-story: a PDF text annotation/popup vs a flattened box), and a pen stroke exports as its vector/raster path with alpha (FR-26)

**Given** the export
**Then** it is verified by exporting a real multi-page annotated paper and opening the result in an external PDF viewer to confirm placement across pages at DPR>1, not only a unit test

> **Out of scope:** editable round-trip (re-importing the exported PDF back into Paper Mate's annotation model); export presets/filtering which annotations to include (unless the spike makes it cheap). **Open design calls:** client vs server flatten (the spike decides); how comments render; whether export is a new API route (then `docs/API.md`) or client-only.

## Story 12.3: Inline footnote & reference preview (SPIKE-FIRST)

> **SUPERSEDED 2026-07-20 by Story 10.4** (`sprint-change-proposal-2026-07-20-opendataloader-structure-layer.md`). This story's *approach*, "regex over text-layer spans + geometry", is dropped in favor of a lookup against the opendataloader-backed document-structure layer (Epic 10). Its *capability* (FR-27) is delivered by Story 10-4 on that layer. Kept here for provenance; `12-3-footnote-reference-preview` is marked `blocked` (superseded, never attempted). Same shape as 8-9 → 8-11 (approach replaced, concern absorbed). Original spec below.
>
> User request: "preview footnotes and references without leaving my current reading position so that I can check supporting information without interrupting my flow." The Phase-2 reading-helper through-line. Reader **FR-27**. Consumes AD-4 anchors. Starts with a resolver spike; the reading-helper resolver seam is an architecture-spine touch recorded at create-story.

As a reader,
I want to preview footnotes and references without leaving my reading position,
So that I can check a supporting note or citation without losing my place.

**Acceptance Criteria:**

**Given** a footnote marker, a reference/citation marker (`[n]`), or a `Figure N`/`Table N` mention in the text
**When** I click it
**Then** a floating preview of the target (the footnote text, the reference entry, or the figure/table region) opens in place, without scrolling me away or reflowing the page (FR-27, NFR-1)

**Given** the story
**Then** it STARTS with a resolver spike: prototype detecting these markers in the pdf.js text layer and resolving each to its target region via the AD-4 anchor model, validated against 2–3 real papers (multi-column, numbered-and-named references), before building the preview UI (FR-27, AD-4)

**Given** a preview
**Then** it is dismissable (`Esc`/outside-click), keyboard-reachable, and stays anchored at correct coordinates across zoom (FR-27, NFR-3, UX-DR17)

**Given** a marker whose target cannot be resolved
**Then** it degrades gracefully (no preview / a muted "couldn't locate" affordance), never a broken or mis-placed popup (FR-27)

> **Out of scope:** click-to-chat / AI targeting (Phase 3); synthesizing a reference list when the PDF has none; OCR for scanned PDFs. **Open design calls:** which marker classes ship first (footnotes vs `[n]` vs Figure/Table); detection strategy (regex over text-layer spans + geometry); the reading-helper resolver seam location (a new `render/`-adjacent module), recorded as an architecture-spine decision at create-story.
