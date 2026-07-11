---
title: Paper Mate PRD
status: final
created: 2026-06-28
updated: 2026-06-28
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
- **FR-3** Table of contents for jump-to-section.
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

### FG-C · Annotation interaction

- **FR-13** Drag-to-annotate (drag-select text or region to create an annotation).
- **FR-14** **Drag-to-change-tool** — on drag-select, a quick tool picker pops (highlight / underline / comment / memo) so the user switches tool without returning to the left rail.
- **FR-15** Edit an existing annotation: move, resize, restyle (color), and re-edit text.
- **FR-16** Undo / redo.
- **FR-17** Delete an annotation.
- **FR-25** *(post-v1, Epic 8 Story 8.4)* Attach a comment to a boxed region (comment on a `kind=rect` area, not only on text).

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

- **Phase 2 — Reading Helper.** Inline previews from clicked references (`Figure N` / `Table N`, footnotes, citation markers `[1]`), paper-metadata extraction, export of PDF-with-highlights, folder-based Library page. Two of these are now named FRs, sequenced in Epic 9 (added 2026-07-11 via correct-course):
  - **FR-26** *(Epic 9 Story 9.2)* Export a PDF containing the user's annotations (the export-with-highlights item, promoted).
  - **FR-27** *(Epic 9 Story 9.3)* Inline preview of a clicked footnote, reference/citation (`[n]`), or `Figure N`/`Table N` mention, without leaving the reading position.
- **Phase 3 — AI Companion (the north star).** Q&A against **local CLI agents only** (no hosted API), vendor-switchable (Claude / Codex / Antigravity) behind one interface, paper digest auto-injected into context, drag/click-to-chat that resolves the exact PDF location or a Figure/Table selection.

Two through-lines the v1 build must not paint into a corner (detail in addendum):

- **Spatial anchoring** — one coordinate/anchor model (page + rect/text range) consumed by annotations now, inline-preview triggers and click-to-chat targeting later.
- **Agent abstraction** — local agent CLIs behind one switchable interface, so vendor choice and the default paper-digest context are vendor-agnostic.

## Open questions

- `[NOTE FOR PM]` Firefox + on-disk storage: pure-web disk access (File System Access API) is Chrome-only. Resolve in architecture (local backend / desktop shell vs. IndexedDB-on-Firefox). See addendum.
- Non-goals not yet decided by author (confirm set above).
- Tech stack not yet chosen (pre-implementation repo).
