---
id: SPEC-paper-mate
companions:
  - ../../../DESIGN.md
  - ../../../EXPERIENCE.md
  - ../../planning-artifacts/architecture/architecture-paper-mate-2026-06-28/ARCHITECTURE-SPINE.md
sources:
  - ../../planning-artifacts/prds/prd-paper-mate-2026-06-28/prd.md
  - ../../planning-artifacts/prds/prd-paper-mate-2026-06-28/addendum.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents in frontmatter are traceability only.

# Paper Mate — v1 (Viewer / Annotator)

## Why

A **vision to realize** for a single reader (Wonseok, a researcher). Existing PDF tools fail academic papers: Kami has the best annotation UX but its annotations reflow the page, it lacks drag-to-switch-tool, freehand pen, and free-floating memos — and no reader connects the paper to a local AI agent that already holds its context. v1 builds the viewer/annotator that earns daily use; it exists so the local-AI-agent companion (later) becomes possible. The build is shaped around two through-lines the later phases consume: one spatial-anchor model and one agent abstraction.

## Capabilities

- **CAP-1** — Open & render a paper.
  - **intent:** User can load a PDF from disk, render its pages, and navigate by page controls and a table of contents.
  - **success:** A multi-page PDF opens, every page renders, and a ToC entry jumps to its section.
- **CAP-2** — Read controls.
  - **intent:** User can scroll, zoom (ctrl +/-, ctrl+scroll, on-screen buttons, live %), and pan (hand tool / hold-space) the paper.
  - **success:** Scroll, zoom, and pan stay fluid (~60fps) on a 50+ page paper.
- **CAP-3** — Annotate.
  - **intent:** User can highlight, underline, draw freehand (pen/brush), place a free-floating textbox memo, leave a comment (highlights text + anchored bubble pin), and box-select a region.
  - **success:** Each annotation type is created and renders anchored to the correct spot on the page.
- **CAP-4** — Drag-to-annotate with contextual quick-box.
  - **intent:** User drags to create a mark; on release a mode-specific quick-box appears (selection→tool picker; highlight/underline→color; pen→color+width; memo→text entry; comment→bubble).
  - **success:** User creates and tunes an annotation without returning to the left rail.
- **CAP-5** — Edit annotations.
  - **intent:** User can select, move, resize, restyle, re-edit text, undo/redo, and delete annotations.
  - **success:** An annotation can be moved/recolored/deleted and undo/redo reverses each edit.
- **CAP-6** — Annotation Bank.
  - **intent:** User can toggle a panel listing all annotations and click one to jump to it.
  - **success:** Every annotation appears in the list; clicking a row scrolls the canvas to it and flashes the target.
- **CAP-7** — Persistence.
  - **intent:** Annotations autosave to disk and restore exactly on reopen.
  - **success:** After closing and reopening a paper, every annotation is present at its correct position across zoom levels; nothing is silently lost.

## Constraints

- **Layout stability:** the PDF canvas is pixel-stable — the tool rail, Annotation Bank, and quick-boxes all overlay, never reflowing or resizing the page. (The defining quality bar.)
- **Anchor model:** all annotation geometry is stored page-normalized (fractions [0,1], top-left, against the rendered page box); screen position is always derived, never persisted. See ARCHITECTURE-SPINE AD-4.
- **On-disk persistence:** annotations live under `~/.paper-mate/library/{doc_id}/` (`doc_id` = SHA-256 of PDF bytes), separate from `source.pdf`, which is never modified. See AD-8.
- **Runtime:** runs in Chrome **and** Firefox as a localhost SPA + dockerized FastAPI backend that owns all disk I/O; the client never touches the filesystem. (Forced: Firefox has no local File System Access.) See AD-1.
- **Immersion:** minimal Obsidian-style chrome; UI recedes behind the paper; styling references DESIGN.md tokens. See EXPERIENCE.md.
- **AI is local-only (directional):** the later AI companion uses local CLI agents (Claude/Codex/Antigravity) behind one switchable interface — no hosted API.

## Non-goals

- No collaboration or sharing.
- No cloud sync, WebDAV, or import/export in v1.
- No mobile or tablet (desktop web only).
- No reference manager (Zotero-style library).
- Phase 2 (reading helper: inline reference previews, metadata, export, Library) and Phase 3 (AI companion) are out of the v1 build — directional only; the architecture reserves their seams.

## Success signal

Wonseok stops opening Kami. He annotates a 23-page paper daily in Paper Mate: highlights, underlines, pen marks, memos, and comments land without the page ever shifting; edits and undo behave; he closes the tab and reopens the next day to find every mark exactly where he left it, correct across zoom levels.
