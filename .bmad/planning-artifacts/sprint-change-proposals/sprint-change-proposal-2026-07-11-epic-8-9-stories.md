# Sprint Change Proposal: refine ten user requests into Epic 8 (reader/annotation polish) + a new Phase-2 Epic 9

**Date:** 2026-07-11
**Author:** Wonseok (via bmad-correct-course)
**Scope classification:** Moderate (backlog reorganization). Seven new Epic 8 backlog stories + a new Epic 9 with three backlog stories; five proposed new FRs across the two PRDs; two architecture-spine touches for the Epic 9 heavyweight stories. No in-flight or completed work is altered (Epics 1–7 are all `done`).

## Section 1: Issue Summary

The user handed ten reader/library requests and asked to "refine them as Epic 8's user stories." A review of each against the existing PRDs, architecture, and shipped epics shows they are **not one epic's worth of work**: seven are reader/annotation/library polish or defects that sit against existing FRs, and three are net-new **Phase-2** capabilities that each need their own FR and an architecture decision.

The current **Epic 8** is charted narrowly ("Reader fidelity round 2 (post-v1, Phase-1.5)": fix correctness, add no capability, no new FRs, one story `8.1` = paragraph-aware copy). Most of the ten requests *add capability*, so folding them all in would silently break that charter.

**Decision (user, 2026-07-11):** **split**. Epic 8 is re-themed to a broader reader/annotation polish round holding the seven polish/defect items (plus the existing 8.1); the three heavyweight Phase-2 features form a **new Epic 9** with their own FRs.

The ten requests, classified:

| # | Request | Nature | Home |
| --- | --- | --- | --- |
| 1 | Download Library Papers | Net-new Phase-2 capability (portability) | **Epic 9** Story 9.1 |
| 5 | Export Annotated PDF | Net-new Phase-2 capability (export-with-highlights, promoted) | **Epic 9** Story 9.2 |
| 7 | Footnote & Reference Preview | Net-new Phase-2 capability (reading-helper through-line) | **Epic 9** Story 9.3 |
| 3 | Annotation Bank Filters | Extends the Bank (FR-18/19/20, which deferred filter) | **Epic 8** Story 8.2 |
| 4 | Sort Annotations | Extends the Bank (reading-order ordering) | **Epic 8** Story 8.3 |
| 6 | Box Comment | Completes the FR-11×FR-12 seam the region quick-box reserved | **Epic 8** Story 8.4 |
| 2 | Shortened/Full Name for Venues | Refines the Story 7.9 Venue column | **Epic 8** Story 8.5 |
| 8 | Comment Box Preview Size | Defect (preview vs full-size consistency) | **Epic 8** Story 8.6 |
| 9 | Tab-Switching Delay | Defect (viewer stalls on tab return) | **Epic 8** Story 8.7 |
| 10 | Dragging from Empty Space | Defect (empty-space drag selects underlying text) | **Epic 8** Story 8.8 |

## Section 2: Impact Analysis

- **Epic impact.**
  - **Epic 8** re-themed from "Reader fidelity round 2" (fix-only, no new FRs) to **"Reader & annotation polish, round 2"** — reader/annotation/library polish + defects. Its "no new FRs" charter line is retired: three capability-adds (8.2/8.3/8.4) carry new reader FRs. Existing Story 8.1 is kept verbatim and un-renumbered.
  - **Epic 9 (NEW): "Phase 2 kickoff: reading helper & paper portability."** First epic to cross the v1→Phase-2 line. Three stories; two (9.2 export, 9.3 preview) are spike-first and want an architecture-spine note at create-story time.
- **Story impact.** Seven new Epic 8 stories (8.2–8.8) + three new Epic 9 stories (9.1–9.3), all `backlog`. No existing story changes status or content (8.1 untouched).
- **Artifact conflicts.**
  - `epics.md`: re-theme the Epic 8 header note; append Stories 8.2–8.8; add the Epic 9 section + Stories 9.1–9.3.
  - `sprint-status.yaml`: register the seven Epic-8 + three Epic-9 story rows; add the `epic-9`/`epic-9-retrospective` rows; bump `last_updated`.
  - **Reader PRD** (`prd-paper-mate-2026-06-28/prd.md`): add **FR-23** (Bank filter-by-type), **FR-24** (Bank reading-order sort), **FR-25** (comment on a boxed region), **FR-26** (export annotated PDF), **FR-27** (inline footnote/reference preview). Lift the "v1 Bank is list + jump only. No filter…" note (now superseded by FR-23/24). FR-26/27 promote the Phase-2 roadmap bullet into named FRs.
  - **Library PRD** (`prd-paper-mate-library-2026-07-04/prd.md`): add feature group **F9** + **FR-30** (download a paper's original file). Story 8.5 (venue short-name) refines the existing venue column (LFR-32); no new FR.
  - `ARCHITECTURE-SPINE.md` (reader): the "Phase 2 surfaces" line already reserves inline-preview + export-with-highlights as AD-4 anchor consumers. Epic 9 needs two new decisions recorded when those stories are created: (a) the **export flatten** decision (client pdf-lib vs server pikepdf/pypdf), (b) the **reading-helper resolver** seam (marker detection → target region → floating preview). Flag at create-story, not pre-decided here.
  - `docs/API.md`: 9.1 (download disposition), 9.2 (if export is a server route), 9.3 (if a resolver route is added), 8.5 (if Crossref `short-container-title` is captured onto the contract) each maintain their API entry in the same change.
- **Technical impact (when built).**
  - Bank (8.2/8.3): client-only, `annotations/bank` render + a filter/sort control; no contract/store change (ordering + type filter are view state over the existing annotation set).
  - Box comment (8.4): reuses the existing comment model (`type=comment`, `anchor kind=rect` already in AR-5) + the Story 2.11 region quick-box "comment" option; likely no contract change.
  - Venue (8.5): additive — capture Crossref `short-container-title` onto `ExtractedMeta`/`DocMeta` (like 7.9 did for `container-title`), or derive client-side; display short + full via `title`. Additive contract if captured server-side.
  - Defects (8.6/8.7/8.8): 8.6 client render; 8.7 needs a root-cause spike (pdf.js render throttle vs windowing recompute vs paused rAF); 8.8 client pointer/selection gating, adjacent to the deferred multi-column controller (scope-guarded to NOT reopen it).
  - Download (9.1): light — reuse `GET /api/docs/{doc_id}/file` (docs.py:164) with `Content-Disposition: attachment; filename=<original>` (query flag or sibling route) + a client download action.
  - Export (9.2): the real weight — a flatten pipeline stamping annotations onto page rasters/vectors; client-vs-server decision gates it. Spike-first.
  - Preview (9.3): the Phase-2 reading-helper through-line — detect `Figure N`/`Table N`/footnote/`[n]` markers in the text layer, resolve the target region via AD-4 anchors, render a floating non-displacing preview. Spike-first.

## Section 3: Recommended Approach

**Direct adjustment**: re-theme Epic 8, add 8.2–8.8; stand up Epic 9 with 9.1–9.3.

- **Sequencing — Epic 8** (number = suggested exec order): Bank capability first (8.2 filter → 8.3 sort, both touch the same Bank surface), then 8.4 box comment (completes the annotation-model seam), then polish/defects (8.5 venue, 8.6 preview size, 8.7 tab lag, 8.8 empty-space drag). 8.1 (already speced) can land any time.
- **Sequencing — Epic 9** (ascending risk): 9.1 download (light, reuses the file route) → 9.2 export (spike-first) → 9.3 preview (spike-first, largest).
- **Spike-first for 9.2 and 9.3** (mirrors the 8.1 precedent): each story STARTS with a prototype/design gate — 9.2 proves the flatten path on a real annotated paper before committing; 9.3 prototypes marker-detection + target-resolution on 2–3 real papers before the floating-preview UI.
- **Risk.** Epic 8 is low-risk (client-mostly polish; 8.7 carries a diagnosis unknown). Epic 9 is the higher-risk thread: 9.2/9.3 each carry a genuine feasibility unknown and an architecture decision, which is exactly why they were split out and gated.

## Section 4: Detailed Change Proposals

> The Epic 8/9 story specs below are written at epics.md fidelity so they can be pasted in directly on approval.

### 4a. `epics.md` — re-theme the Epic 8 header

OLD (line 1914–1916):

```
## Epic 8: Reader fidelity round 2 (post-v1, Phase-1.5)

> Added 2026-07-07 via correct-course … Same posture as Epic 4, fix correctness, do not add capability, no new FRs; sequenced post-v1.
```

NEW:

```
## Epic 8: Reader & annotation polish, round 2 (post-v1, Phase-1.5)

> Added 2026-07-07 via correct-course as Epic 9 (one reader-fidelity item, Story 8.1); RENUMBERED 9 → 8 on 2026-07-11. BROADENED 2026-07-11 via correct-course (sprint-change-proposal-2026-07-11-epic-8-9-stories.md): the epic's original "reader fidelity, no new capability, no new FRs" charter is retired. It now also holds Annotation-Bank capability (filter + reading-order sort), the comment-on-region completion, a Library venue-display refinement, and three reader defects, from a ten-request user batch whose three heavyweight Phase-2 features were split into the new Epic 9. Story 8.1 (paragraph-aware copy) is kept verbatim; 8.2–8.8 are the new polish/defect stories. New reader FRs: FR-23 (Bank filter), FR-24 (Bank sort), FR-25 (comment on a region).
```

### 4b. `epics.md` — Story 8.2: Annotation Bank filter by type (default comments)

> User request: "the Annotation Bank should include all annotation types and let me filter by type, defaulting to comments only." Extends Story 3.6 (Bank lists each mark, ordered by `created_at`) and lifts the PRD's "v1 Bank is list + jump only, no filter" note. New **FR-23**.

As a reader,
I want the Annotation Bank to list every annotation type and let me filter by type, starting with comments only,
So that I can focus on the annotations that matter to me without wading through every mark.

**Acceptance Criteria:**

**Given** a document with marks of several types (highlight, underline, pen, memo, comment, region)
**When** the Bank is open
**Then** it can list ALL types (each as `{component.bank-list-item}` with its type glyph + color dot + snippet + page), not only some (FR-19, FR-23, UX-DR9)

**Given** the Bank
**Then** a filter control selects which types are shown; the DEFAULT on open is comments only, and the reader can widen it to any subset or all types (FR-23, UX-DR9)

**Given** a filter that hides every mark of a type
**Then** the visible list updates without reflowing the canvas, and an empty result shows an empty-state message (e.g. "No comments yet." adapting to the active filter) (FR-23, NFR-1, UX-DR18)

**Given** the filter selection
**Then** it is view state (client-only); it does not mutate, reorder, or persist the annotation set, and it composes with the Story 8.3 sort (FR-23, AR-12)

**Given** any new control label, tooltip, or empty-state copy
**Then** no string contains an em-dash (UX-DR13)

> **Out of scope:** in-bank editing, search, export (still deferred). **Open design calls for create-story:** the filter control shape (chips vs a multi-select menu); whether the comments-only default is remembered per session; exact empty-state copy per filter.

### 4c. `epics.md` — Story 8.3: Sort annotations in reading order

> User request: "annotations sorted by page and their position on the page so that they follow the paper's reading order." Story 3.6 orders the Bank by `created_at` ascending; this changes the default ordering to spatial reading order. New **FR-24**.

As a reader,
I want Bank annotations ordered by page and then by their position on the page,
So that they follow the paper's reading order instead of the order I happened to create them.

**Acceptance Criteria:**

**Given** annotations across several pages
**When** the Bank lists them
**Then** they sort by page ascending, then by on-page position within a page (top-to-bottom by the mark's anchor Y, then left-to-right by X for ties), so the list reads in paper order (FR-24, AR-12)

**Given** a mark spanning a page boundary (a `group_id` split, AR-4)
**Then** it sorts by its first (top-most, earliest-page) rect so a multi-page mark appears once at its start (FR-24, AR-4)

**Given** a region (`kind=rect`) or pen (`kind=path`) mark
**Then** its sort position derives from its bounding-box top-left, consistent with text marks (FR-24)

**Given** the reading-order sort
**Then** it composes with the Story 8.2 type filter and stays client-only view state (no store/contract change) (FR-24, AR-12)

> **Out of scope:** a user-selectable sort menu (created-at vs reading-order) unless create-story decides reading-order should be a toggle rather than the sole order. **Open design calls:** whether reading-order fully replaces `created_at` ordering or is the new default with `created_at` as an option; the exact tie-break epsilon for near-equal Y.

### 4d. `epics.md` — Story 8.4: Comment on a boxed region

> User request: "attach a comment to a boxed highlight so that I can annotate a specific visual region." Completes the seam Story 2.11 reserved (the region quick-box was speced to offer "comment") on the model Story 2.10 already supports (`type=comment`, `anchor kind=rect`). New **FR-25**.

As a reader,
I want to attach a comment to a boxed region,
So that I can annotate a specific visual area (a figure, a table, a diagram) the way I comment on text.

**Acceptance Criteria:**

**Given** a boxed region (Story 2.11, `anchor kind=rect`) armed or selected
**When** I choose the region quick-box's "comment" option
**Then** a comment is attached to that region: `type=comment`, `anchor kind=rect {rect}`, `body=text`, created through the command path (FR-11, FR-12, FR-25, AR-5, AR-7)

**Given** a region comment
**When** I click its pin/marker
**Then** a `{component.comment-bubble}` opens over the region for read/edit, keyboard-reachable and `Esc`-dismissable, focus moving in on open and back on close, without reflowing the canvas (FR-25, UX-DR8, UX-DR17, NFR-1)

**Given** a region comment
**When** I zoom
**Then** the region box and its comment marker stay anchored at their exact PDF coordinates (NFR-3)

**Given** a region comment
**Then** it appears in the Annotation Bank (respecting the 8.2 filter as a comment) and sorts by the region's top-left in 8.3's reading order (FR-19, FR-24)

> **Out of scope:** a snapshot/thumbnail of the region (reserved for Phase 2 per Story 2.11); commenting on non-rect, non-text marks. **Open design calls:** verify what Story 2.11 actually shipped for the region quick-box "comment" option and close the gap; the region-comment marker placement (corner pin vs centered) and how it reads distinctly from a text comment.

### 4e. `epics.md` — Story 8.5: Venue short name displayed, full name accessible

> User request: "publication venues display a shortened name while keeping the full name accessible, so paper details stay compact but clear." Refines the Story 7.9 Venue column (LFR-32). No new FR.

As a reader,
I want the Venue column to show a shortened venue name with the full name still available,
So that the table stays compact without losing the exact publication name.

**Acceptance Criteria:**

**Given** a paper with a known venue
**When** the Venue cell renders
**Then** it shows a shortened form (e.g. Crossref `short-container-title`, or a derived abbreviation when no short form exists), while the full venue name is accessible on hover/focus via `title` (LFR-32)

**Given** the Crossref enrichment path (Story 7.9's `enrich()`)
**Then** if `short-container-title` is captured, it is additive to `ExtractedMeta`/`DocMeta` (no `schema_version` bump; existing `meta.json` missing it still validates) and projected onto `CollectionRow`/`docs/API.md` like the existing venue field (LFR-32, AL-1)

**Given** a paper with no short form
**Then** the cell falls back to the full venue name (or a client-derived abbreviation), never blank when a full venue exists (LFR-32)

**Given** sorting/filtering on Venue
**Then** it behaves consistently with the chosen display value (decide short vs full as the sort key at create-story) (LFR-32)

**Given** the short/full display strings
**Then** neither contains an em-dash (L-UX-DR13)

> **Out of scope:** backfilling short names for already-imported papers; a curated venue-abbreviation dictionary beyond Crossref's `short-container-title` + a simple derivation. **Open design calls:** short-name source (Crossref `short-container-title` captured server-side vs a client-side abbreviator); whether sort/filter key on short or full; whether existing rows re-enrich.

### 4f. `epics.md` — Story 8.6: Comment/memo preview size reflects its adjusted full size

> User request: "a comment box's preview size should reflect its adjusted full size, so its appearance stays consistent between collapsed and expanded views." Defect on the memo/comment preview render (Story 2.9 memo + 2.10 comment + the 3.1 corner-resize; see the [[comment-bubble-page-edge-clipping]] preview render in `AnnotationInteraction`). No new FR.

As a reader,
I want a comment's collapsed preview to match the size I adjusted its full view to,
So that its collapsed and expanded appearances stay consistent instead of snapping to a different size.

**Acceptance Criteria:**

**Given** a comment/memo whose full size was adjusted (resized via the Story 3.1 corner handles)
**When** it renders in its collapsed/preview state
**Then** the preview reflects the adjusted full size (its stored geometry), not a fixed preset, so collapsed and expanded read as the same box (FR-11, FR-15)

**Given** the adjusted size
**When** I reload and the mark is restored (Story 3.5)
**Then** the preview still reflects the persisted adjusted size (NFR-3, AR-6)

**Given** the preview render
**Then** it stays within the fixed-overlay render path (no page reflow, no page-edge clipping regression) (NFR-1, [[comment-bubble-page-edge-clipping]])

> **Open design calls for create-story:** confirm whether "comment box" here means the textbox memo (2.9), the comment bubble (2.10), or both; the exact collapsed-vs-expanded states in play and which dimension (width/height) the preview must track; whether a min/max preview clamp applies.

### 4g. `epics.md` — Story 8.7: Immediate viewer resume on tab return

> User request: "the paper viewer should respond immediately when I return from another browser tab, so my reading flow is not interrupted by lag." Defect: a stall on tab re-focus. Investigation-first. No new FR (defends NFR-2).

As a reader,
I want the viewer to respond immediately when I switch back from another browser tab,
So that returning to the paper does not pause or lag.

**Acceptance Criteria:**

**Given** the reader open on a paper
**When** I switch to another browser tab and back
**Then** the viewer is interactive immediately on return, with no multi-frame stall before scroll/zoom/annotate respond (NFR-2)

**Given** the story
**Then** it STARTS with a root-cause diagnosis (background-tab rAF/timer throttling, the Story 1.7 render windowing recomputing all visible pages on re-focus, a paused render queue draining as a burst, or a stale-layout reflow) before committing a fix, since the mechanism determines the fix (NFR-2)

**Given** the fix
**Then** it is verified live by backgrounding and re-focusing the tab on a large (50+ page) paper at DPR>1, not only in a unit test ([[verify-on-hidpi-and-real-host]])

**Given** the fix
**Then** it does not regress scroll/zoom smoothness or the render-windowing behavior during normal (non-tab-switch) reading (NFR-2)

> **Open design calls:** the actual root cause (settle in the diagnosis); whether the fix is in `render/` windowing, the rAF loop, or a `visibilitychange` handler.

### 4h. `epics.md` — Story 8.8: Empty-space drag does not select underlying text

> User request: "dragging from empty page space should avoid selecting or copying underlying rows, so accidental selections do not occur." Defect adjacent to the deferred blank-space/multi-column selection note (deferred-work "story 2-5 blank-space text selection"). Scope-guarded to NOT reopen the full multi-column controller. No new FR (defends FR-13's intent).

As a reader,
I want a drag that starts in empty page space to do nothing to the text,
So that I do not accidentally select or copy the nearby text lines.

**Acceptance Criteria:**

**Given** the pointer over empty page space (a margin/gutter/blank area with no glyph under it)
**When** I press and drag from there
**Then** it does NOT start a text selection that snaps to and grabs the nearest text lines ("rows"), so no accidental selection/copy of underlying text occurs (FR-13)

**Given** a drag that starts ON text
**Then** normal text selection is unchanged (this story only gates the empty-space ORIGIN case) (FR-13)

**Given** the empty-space drag
**Then** its behavior is defined (a no-op, or defers to the active tool such as pan/box) rather than a native text selection, decided at create-story (FR-13)

**Given** the change
**Then** it is live-smoked with an empty-margin drag AND a cross-column empty-gutter drag at DPR>1, and it does NOT reintroduce the full-page-highlight or cross-column leak the anchor layer guards ([[verify-on-hidpi-and-real-host]])

> **Scope guard:** this is the narrow "empty-space drag origin" fix, NOT the deferred layered multi-column selection controller (that stays deferred). **Open design calls:** confirm "underlying rows" = PDF text lines (assumed) vs any table/list surface; the exact empty-space behavior (no-op vs tool-defer); how "empty space" is detected (no text node hit vs geometry).

### 4i. `epics.md` — new section: Epic 9 + Stories 9.1–9.3

```
## Epic 9: Phase 2 kickoff — reading helper & paper portability (post-v1, Phase-2)

> Added 2026-07-11 via correct-course (sprint-change-proposal-2026-07-11-epic-8-9-stories.md). The FIRST epic to cross the v1 → Phase-2 line. Split out of a ten-request user batch: the seven polish/defect items stayed in Epic 8; these three are net-new Phase-2 capabilities that each carry a new FR and (for 9.2/9.3) an architecture decision, so they were grouped here rather than folded into a fix-themed epic. Theme: get papers out of Paper Mate (download, export) and start the reading-helper preview through-line. 9.2 and 9.3 are SPIKE-FIRST (feasibility/design gate before commit) and want an architecture-spine note at create-story. New FRs: reader FR-26 (export), FR-27 (preview); Library FR-30 (download).
```

**Story 9.1: Download a library paper's original file** (Library **FR-30**, F9)

As a reader,
I want to download a paper from my library,
So that I can save or open it outside Paper Mate.

**Acceptance Criteria:**

**Given** a paper in the collection
**When** I choose Download (a row action or the reader)
**Then** the browser downloads its original PDF with a sensible filename (the original upload name or the paper title), reusing the existing `GET /api/docs/{doc_id}/file` served file with `Content-Disposition: attachment` (FR-30, NFR-1-Library)

**Given** the download
**Then** it is byte-identical to the stored original (no re-encoding), works fully offline (local file server, no network), and never triggers the row's open/arm gesture (FR-30, NFR-6-Library)

**Given** a Trashed paper (Story 7.5)
**Then** whether Download is offered there is a create-story call (default: collection only) (FR-30)

**Given** the Download control label/tooltip
**Then** it contains no em-dash (L-UX-DR13)

> **Out of scope:** downloading an ANNOTATED PDF (that is Story 9.2, export); bulk/zip download of a multi-selection (create-story call). **Open design calls:** dedicated download route vs a `?download=1` flag on the existing file route; filename source (upload name vs title); whether download appears in the reader too.

**Story 9.2: Export an annotated PDF** (reader **FR-26**; SPIKE-FIRST)

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
**Then** it is verified by exporting a real multi-page annotated paper and opening the result in an external PDF viewer to confirm placement across pages at DPR>1, not only a unit test ([[verify-on-hidpi-and-real-host]])

> **Out of scope:** editable round-trip (re-importing the exported PDF back into Paper Mate's annotation model); export presets/filtering which annotations to include (unless the spike makes it cheap). **Open design calls:** client vs server flatten (the spike decides); how comments render; whether export is a new API route (then `docs/API.md`) or client-only.

**Story 9.3: Inline footnote & reference preview** (reader **FR-27**; SPIKE-FIRST)

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

> **Out of scope:** click-to-chat / AI targeting (Phase 3); synthesizing a reference list when the PDF has none; OCR for scanned PDFs. **Open design calls:** which marker classes ship first (footnotes vs `[n]` vs Figure/Table); detection strategy (regex over text-layer spans + geometry); the reading-helper resolver seam location (new `render/`-adjacent module) — record as an architecture-spine decision at create-story.

### 4j. Reader PRD (`prd-paper-mate-2026-06-28/prd.md`) — FR additions

- Under FG-D (Annotation Bank), add **FR-23** (filter the Bank by annotation type; default comments only) and **FR-24** (sort the Bank in reading order: page, then on-page position). Retire the "v1 Bank is list + jump only. No filter…" note (superseded).
- Under FG-C/FG-B (annotation), add **FR-25** (attach a comment to a boxed region).
- Add a Phase-2 FG (or extend the roadmap into named FRs): **FR-26** (export a PDF containing the user's annotations) and **FR-27** (inline preview of footnotes/references/figure-table mentions from a click).

### 4k. Library PRD (`prd-paper-mate-library-2026-07-04/prd.md`) — F9 + FR-30

- Add feature group **F9: Download** with **FR-30** (download a paper's original file from the Library to disk; local, offline, byte-identical). Note Story 8.5 (venue short name) refines the existing venue column and needs no new FR.

### 4l. `sprint-status.yaml`

Add to the Epic 8 block: `8-2-annotation-bank-filter-by-type`, `8-3-sort-annotations-reading-order`, `8-4-comment-on-region`, `8-5-venue-short-name`, `8-6-comment-preview-size`, `8-7-tab-switch-resume`, `8-8-empty-space-drag-no-select` — all `backlog`, with a provenance comment. Add a new **Epic 9** block: `epic-9: backlog`, `9-1-download-paper`, `9-2-export-annotated-pdf`, `9-3-footnote-reference-preview` (all `backlog`), `epic-9-retrospective: optional`. Bump `last_updated`.

## Section 5: Implementation Handoff

- **Scope:** Moderate (backlog reorganization). No in-flight/completed work touched; all ten stories `backlog`.
- **Recipients:** Developer (Wonseok) at the next `bmad-create-story` cycles, per the branch-per-story flow.
- **Sequencing:** Epic 8 in 8.2→8.8 order (Bank pair first, then box comment, then polish/defects); Epic 9 in 9.1→9.2→9.3 order (ascending risk). 9.2 and 9.3 are spike-first and each want an architecture-spine note captured at create-story.
- **Regen discipline flagged:** 8.5 (if `short-container-title` is captured), 9.1 (download disposition), 9.2 (if a server export route), 9.3 (if a resolver route) each maintain the Pydantic→OpenAPI→TS contract and `docs/API.md` in the same change.
- **Carried action item:** AE7-4 (DPR>1 cross-page smoke backfill: 2.11 box-select, 3.3 grouped-delete; adopt programmatic-Range + trusted-pointerup) explicitly targeted the "next epic touching cross-page PDF selection." Stories 8.4 (region comment), 8.8 (empty-space/cross-column drag), and 9.3 (cross-column marker resolution) are that occasion — fold AE7-4 into their smoke plans at create-story.
- **Success criteria:** all ten stories tracked in epics.md + sprint-status; Epic 8's retired "no new FRs" charter reconciled in the header note (AE7-3: reconcile epics.md in the SAME change); the five new FRs recorded in the two PRDs; Epic 9's two architecture decisions flagged (not silently pre-decided); no code touched this round.
