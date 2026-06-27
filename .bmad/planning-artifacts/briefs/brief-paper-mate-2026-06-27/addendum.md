---
title: "Paper Mate Brief — Addendum"
status: draft
created: 2026-06-28
updated: 2026-06-28
---

# Addendum: Design Depth & Options Considered

Detail captured during briefing that downstream documents (PRD, architecture) will want, but that does not belong in the 1-2 page brief.

## Annotation interaction model (decided: Hybrid)

The page-reflow pain in incumbents pairs with a modal-tooling pain: you must pre-select a mode in a toolbox, and forgetting it makes a stray drag spawn an unwanted comment box.

Options considered:
- **Keep modal, fix the leak** — drawer sets the tool, "select/read" is the safe default; stray drags do nothing until a tool is chosen.
- **Go non-modal** — select text, a floating menu offers highlight/underline/comment; no mode to forget; drawer loses its mode role.
- **Hybrid (chosen)** — non-modal floating selection menu *and* a left toolbox drawer for persistent/power use. Safe default (`Select`) prevents stray-drag boxes; the drawer is for discovery and sustained work, not a required stop.

## Rendering invariant

Annotations render on a transparent overlay layer above the PDF; the comment composer is a popover anchored to the marked spot. The right-side Annotation Bank and the left toolbox drawer both overlay or toggle fully off. **Invariant: no annotation action ever changes the PDF area's size.**

## Persistence & reopen (decided: Option B — sidecar file)

Requirement surfaced by user: annotations must restore exactly when a PDF is reopened.

Two sub-problems:
1. **Document identity.** Identify the PDF by a **content-hash fingerprint** of its bytes (rename-safe, copy-safe). Tradeoff: an edited/re-exported PDF gets a new hash and reads as "new" — acceptable, papers are immutable.
2. **Mark placement.** Anchor each annotation to **page number + position normalized to page size + quoted text** (text-quote anchoring, Hypothesis-style). Re-resolves correctly at any zoom or window size; never store raw screen pixels.

Storage options considered:
- **A. IndexedDB** — keyed by content-hash, in-browser. Zero friction, but tied to one browser, not portable, and **wiped by clearing browser data** or evicted under storage pressure. Rejected for that data-loss risk.
- **B. Sidecar file (chosen)** — `paper.pdf.annotations.json` written next to the PDF via the File System Access API. Portable, backup-able, survives a browser wipe, travels with the document. Costs: Chromium-only (Chrome/Edge), requires directory-access grant on open (permission can persist per directory).
- **C. Both** — IndexedDB primary + sidecar export/import. Best durability, more v1 work; deferred.

Annotated-PDF export remains the share format; portable-sidecar refinements and notes/markdown export are Phase 2.

## Proposed keyboard map (refine in PRD)

| Key | Action |
|---|---|
| `V` | Select / read (safe default) |
| `H` | Highlight mode |
| `U` | Underline mode |
| `C` | Comment mode |
| `T` | Table of contents |
| `B` | Toggle Annotation Bank |
| `[` | Toggle toolbox drawer |
| `Ctrl +/-` | Zoom |
| `Esc` | Back to Select |

## Cross-phase foundations built in v1

Two v1 internals exist partly to make later phases natural rather than a rewrite:
- **Local-first storage** (sidecar) → Phase 3 local-agent AI keeps everything on-machine.
- **Spatial-anchor model** (page + normalized position + quoted text) → Phase 2 figure/footnote/reference previews and Phase 3 click/drag-to-chat both reuse it to map an interaction back to an exact PDF location.
