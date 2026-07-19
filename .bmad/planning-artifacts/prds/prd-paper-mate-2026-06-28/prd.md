---
title: Paper Mate PRD
status: final
created: 2026-06-28
updated: 2026-07-20
---

# Paper Mate PRD

## Overview

Paper Mate is a **web** PDF reading companion for academic papers: Kami-grade annotation where the page never moves, built so the same paper becomes *live* to a local AI agent in a later version. v1 ships the viewer/annotator only; the AI companion is the directional payoff the architecture is shaped around.

**Author/user:** Wonseok — a researcher reading papers daily. Solo, personal tool. Not internal, not commercial.

## Vision & Goals

Existing readers fail papers. Kami nails annotation UX but: annotations reflow/shift the PDF area, there is no drag-to-switch-tool, no freehand pen, no textbox memo. And none connect reading to a local AI agent that already holds the paper's context.

- **Primary goal (v1):** a daily-driver PDF annotator the author prefers over Kami for reading papers.
- **North star (vNext):** local AI agent integration. Phase 1 exists to make Phase 3 possible.

**Success signals** (solo, no business metric): "I stopped opening Kami" — driven by annotations that persist (reserved across sessions), are easy to edit, smooth scroll/zoom/pan, and **zero layout change of the PDF area**.

## Non-goals (v1)

- No collaboration / sharing.
- No cloud sync, WebDAV, or import/export (deferred — see Roadmap).
- No mobile/tablet.
- No reference-manager (Zotero-style library) in v1.

> `[NOTE FOR PM]` Non-goals were **not yet decided** by the author beyond the above inferred set. Confirm at review.

## Functional Requirements — v1 (Viewer / Annotator)

FR IDs are global and stable.

### FG-A · PDF Viewer (layout-stable core)

- **FR-1** Open/load a PDF from disk.
- **FR-2** Render pages with page navigation.
- **FR-3** Table of contents for jump-to-section. *(FR-35 upgrades this to a Table of contents synthesized from detected headings, so every paper gets one, Epic 10.)*
- **FR-4** Smooth vertical scrolling.
- **FR-5** Zoom via `ctrl` `+` / `-`.
- **FR-6** Hand tool — pan the page by dragging.

### FG-B · Annotation tools

- **FR-7** Highlight.
- **FR-8** Underline.
- **FR-9** Pen/brush freehand drawing.
- **FR-10** Textbox memo — free-floating text typed directly onto the page.
- **FR-11** Comment — a note pinned/anchored to a spot, opens on click.
- **FR-12** Range/area (box) selection of a region.
- **FR-28** *(post-v1, Epic 11 Story 11.1)* Textbox tool: a text-only floating block placed on the page, distinct from the FR-10 memo (no sticky-note fill/chrome).
- **FR-29** *(post-v1, Epic 11 Story 11.2, spike-first)* Image attachment block: upload an image from disk, place it on the page, resize via handles. Persists a binary asset (the byte-storage seam is an architecture-spine decision).

> FR-28/FR-29 (added 2026-07-18 via correct-course) introduce two new on-page block types beyond the v1 text/pen/memo/comment/region set. FR-29's persisted image bytes are the first binary asset in the annotation model; its storage location (client-embedded data-URI vs a server-stored asset) is gated by a spike.

### FG-C · Annotation interaction

- **FR-13** Drag-to-annotate (drag-select text or region to create an annotation).
- **FR-14** **Drag-to-change-tool** — on drag-select, a quick tool picker pops (highlight / underline / comment / memo) so the user switches tool without returning to the left rail.
- **FR-15** Edit an existing annotation: move, resize, restyle (color), and re-edit text.
- **FR-16** Undo / redo.
- **FR-17** Delete an annotation.
- **FR-25** *(post-v1, Epic 8 Story 8.4)* Attach a comment to a boxed region (comment on a `kind=rect` area, not only on text).
- **FR-30** *(post-v1, Epic 11 Story 11.3, spike-first)* Clipboard paste to block: pasting onto the page creates a textbox block (text payload, FR-28) or an image block (image payload, FR-29). Depends on FR-28 + FR-29.
- **FR-31** *(post-v1, Epic 9 Story 9.5)* Persist a moved comment box's position: a dragged comment bubble stays where dropped and restores across close/reopen (stored as a scale-independent offset from the pin). Extends FR-15.
- **FR-32** *(post-v1, Epic 9 Story 9.4)* Resizable, persisted collapsed memo box: the collapsed memo box is resizable and its size persists, distinct from the expanded size. Extends FR-15.

> FR-30/FR-31/FR-32 (added 2026-07-18 via correct-course). FR-31/FR-32 make an annotation's popup geometry (position, collapsed size) persisted state rather than a fixed derived default; both are additive to the annotation contract (no `schema_version` break: a mark without the field falls back to the current default). FR-30's paste target and permission path are gated by a spike.

### FG-D · Annotation Bank

- **FR-18** A separate Annotation Bank layout/drawer that toggles open/closed.
- **FR-19** Lists all annotations in the document.
- **FR-20** Click an entry to jump to that annotation's location.
- **FR-23** *(post-v1, Epic 8 Story 8.2)* Filter the Bank by annotation type; the default view is comments only.
- **FR-24** *(post-v1, Epic 8 Story 8.3)* Order the Bank in reading order: by page, then by on-page position.

> v1 Bank shipped as list + jump only. FR-23/FR-24 (added 2026-07-11 via correct-course) add filter-by-type and reading-order sort post-v1. In-bank editing, search, and export stay deferred.

### FG-E · Persistence

- **FR-21** Save annotations local-first to disk (see Storage in addendum).
- **FR-22** On reopening a PDF, restore its annotations exactly (reserved across sessions).
- **FR-33** *(post-v1, Epic 9 Story 9.7)* Remember and restore last view position: on close, remember the page + intra-page scroll offset per document; restore it on reopen (scale-independent, so a zoom change since last visit still lands on the right content). First-time open is unchanged (top of page 1).

> FR-33 (added 2026-07-18 via correct-course) extends persistence from "restore WHAT (annotations)" to "restore WHERE (reading position)." Its storage location (client-only view-prefs vs `meta.json`) is a create-story call; it is view state, never part of the annotation contract.

## Cross-cutting requirements (NFRs)

- **NFR-1 Layout stability** *(defining bar)* — the PDF area is pixel-stable regardless of UI state. The left rail, drag-to-change-tool picker, and Annotation Bank all overlay or reserve fixed space; none reflow or resize the page.
- **NFR-2 Smoothness** — scroll, zoom, and pan stay fluid (target ~60fps, no jank) on a large paper (50+ pages).
- **NFR-3 Anchor fidelity** — every annotation re-renders at its exact PDF coordinates across all zoom levels. (Spatial-anchor model design → addendum.)
- **NFR-4 Durability** — annotations are never silently lost; local-first storage survives reload.
- **NFR-5 Immersion** — minimal Obsidian-style chrome; hairlines and restraint; UI recedes behind the paper (per `DESIGN.md`; ignore its Expo component catalog, token scales only).

**Runtime:** Chrome + Firefox desktop. (Storage-on-disk has a Firefox constraint — see addendum.)

## Scope & Phasing

**v1 — Phase 1: Viewer / Annotator** (this PRD's FRs above).

Lightweight roadmap for later versions (kept here so v1 architecture reserves room):

- **Phase 2: Reading Helper.** Inline previews from clicked references (`Figure N` / `Table N`, footnotes, citation markers `[1]`), paper-metadata extraction, export of PDF-with-highlights, folder-based Library page, and a **document-structure layer** that makes the reader section-aware. Named FRs (Epic 12 = download/export; Epic 10 = structure layer, added 2026-07-20 via correct-course):
  - **FR-26** *(Epic 12 Story 12.2)* Export a PDF containing the user's annotations (the export-with-highlights item, promoted).
  - **FR-34** *(Epic 10 Story 10.1, spike-first enabler)* Document-structure extraction: analyze each imported paper into a per-document, box-anchored set of typed elements (heading/paragraph/table/figure/caption/list/footnote + reading order), produced at import and consumed by the reader. The foundation the other structure FRs read from.
  - **FR-35** *(Epic 10 Story 10.2)* Section navigation: a Table of contents synthesized from detected headings, giving jump-to-section on every paper (upgrades FR-3, which today needs an embedded PDF outline).
  - **FR-36** *(Epic 10 Story 10.3)* Figures & Tables index: a navigable list of detected figures and tables, each jumping to its region.
  - **FR-27** *(Epic 10 Story 10.4, structure-backed; supersedes Epic 12 Story 12.3)* Inline preview of a clicked footnote, reference/citation (`[n]`), or `Figure N`/`Table N` mention, without leaving the reading position. Resolves each marker against the FR-34 structure layer (a lookup against typed, box-anchored elements), not hand-rolled text-layer geometry.
  - **FR-37** *(Epic 10 Story 10.6, directional, Phase-3 groundwork)* Structure-derived paper digest: reading-order, header/footer-stripped, sectioned text derived from FR-34, exposed as the context payload the Phase-3 AI companion auto-injects.

  > The structure layer runs server-side at import via **opendataloader-pdf** (Apache-2.0, in-container, born-digital, OCR deferred). Its typed element boxes map onto the v1 spatial-anchor model (page + normalized rect). Metadata extraction (Library **LFR-8**) is upgraded to take the title from this structure layer (heading-level-1 / reading order), keeping the current PyMuPDF font heuristic as the fallback (Epic 10 Story 10.5). Architecture: AD-13 (main spine) + AD-L8 (library spine). It replaces four hand-rolled PDF-interpretation detectors (title heuristic, embedded-outline-only ToC, regex reading-helper, figure/table geometry), which survive only as graceful fallbacks.
- **Phase 3 — AI Companion (the north star).** Q&A against **local CLI agents only** (no hosted API), vendor-switchable (Claude / Codex / Antigravity) behind one interface, paper digest auto-injected into context, drag/click-to-chat that resolves the exact PDF location or a Figure/Table selection.

**Post-v1 batch (added 2026-07-18 via correct-course, `sprint-change-proposal-2026-07-18.md`).** A 13-request user batch, split by weight:

- **Epic 9: reader polish, round 3 (Phase-1.5).** Defects + small polish (no new FR) plus three small persistence FRs: **FR-31** (comment-box position), **FR-32** (collapsed-memo resize), **FR-33** (last-view restore). Also two AC-extensions of existing FRs, NOT new FRs: a fourth (thinner) pen width extends FR-9; multi-select zip download extends Library FR-30.
- **Epic 11: annotation blocks (Phase-2).** *(Renumbered from Epic 10 on 2026-07-20 when the structure-layer epic was prioritized ahead of it; content unchanged.)* Three new on-page block types: **FR-28** (textbox tool), **FR-29** (image attachment block, spike-first), **FR-30** (clipboard paste to block, spike-first). FR-29 introduces the first persisted binary asset (storage seam is an architecture-spine decision).

**Structure-layer epic (added 2026-07-20 via correct-course, `sprint-change-proposal-2026-07-20-opendataloader-structure-layer.md`).** Adopt opendataloader-pdf as the document-structure engine and heavily replace custom PDF-interpretation logic:

- **Epic 10: document structure layer (Phase-2 enabler).** A spike-first structure-extraction enabler plus its consumers: **FR-34** (structure), **FR-35** (section nav / synthesized ToC), **FR-36** (figures/tables index), **FR-27** (structure-backed reading-helper preview, supersedes Epic 12 Story 12.3), **FR-37** (structure-derived digest, directional), plus a metadata upgrade (Library **LFR-8**). Prioritized ahead of the annotation-blocks epic (the two were switched: structure = Epic 10 and runs first, blocks = Epic 11). Architecture: AD-13 + AD-L8.

Two through-lines the v1 build must not paint into a corner (detail in addendum):

- **Spatial anchoring** — one coordinate/anchor model (page + rect/text range) consumed by annotations now, inline-preview triggers and click-to-chat targeting later.
- **Agent abstraction** — local agent CLIs behind one switchable interface, so vendor choice and the default paper-digest context are vendor-agnostic.

## Open questions

- `[NOTE FOR PM]` Firefox + on-disk storage: pure-web disk access (File System Access API) is Chrome-only. Resolve in architecture (local backend / desktop shell vs. IndexedDB-on-Firefox). See addendum.
- Non-goals not yet decided by author (confirm set above).
- Tech stack not yet chosen (pre-implementation repo).
