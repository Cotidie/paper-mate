// structure/ — the client document-structure service (AD-13, Story 10.1).
//
// A thin reader of the server-produced structure layer: it fetches + holds the
// open doc's `DocStructure` (typed, box-anchored elements already in AD-4
// normalized coordinates) and exposes typed selectors + a screen-projection.
//
// Coordinate rule (AD-9): this service NEVER computes normalize<->screen math
// itself. Each element's `rect` is already normalized (the SERVER did the
// PDF-points -> normalized flip in `domain/structure.py`), so projecting one to
// the page overlay is exactly the annotation anchor's `denormalizeRect` — reused
// here, not re-derived. The real consumers (synthesized ToC, Figures/Tables
// index, reading-helper previews, metadata) are Epic 10 stories 10-2..10-6;
// this story ships the layer + selectors + a dev-only debug overlay only.

import type { DocStructure, StructureElement } from "@/api/client";
import { type PageBox, type ScreenRect, denormalizeRect } from "@/anchor";
import type { TocEntry } from "@/render";

/** The empty structure (an unanalyzed / non-PDF doc, or a thin extraction). */
export const EMPTY_STRUCTURE: DocStructure = { elements: [] };

/** All heading elements, in reading order (the source for a synthesized ToC). */
export function headings(structure: DocStructure): StructureElement[] {
  return structure.elements.filter((e) => e.type === "heading");
}

/** All figure elements (opendataloader `image`/`picture`), in reading order. */
export function figures(structure: DocStructure): StructureElement[] {
  return structure.elements.filter((e) => e.type === "figure");
}

/** All table elements, in reading order. */
export function tables(structure: DocStructure): StructureElement[] {
  return structure.elements.filter((e) => e.type === "table");
}

/** All caption elements, in reading order. */
export function captions(structure: DocStructure): StructureElement[] {
  return structure.elements.filter((e) => e.type === "caption");
}

/** Every element anchored on a given 0-based page, in reading order — what the
 *  per-page debug overlay iterates. */
export function elementsOnPage(structure: DocStructure, pageIndex: number): StructureElement[] {
  return structure.elements.filter((e) => e.page_index === pageIndex);
}

/**
 * The topmost element whose normalized rect contains a normalized `[0,1]` point
 * on a page (recent-wins: later-in-reading-order beats earlier when they
 * overlap, mirroring the annotation hit-test's recent-wins rule). Returns
 * `null` when the point hits no element. The Phase-2 reading-helper (10-4) and
 * Phase-3 click-to-chat resolve a pointer to an element through this.
 */
export function elementAt(
  structure: DocStructure,
  pageIndex: number,
  point: { x: number; y: number },
): StructureElement | null {
  let hit: StructureElement | null = null;
  for (const e of structure.elements) {
    if (e.page_index !== pageIndex) continue;
    const { x0, y0, x1, y1 } = e.rect;
    if (point.x >= x0 && point.x <= x1 && point.y >= y0 && point.y <= y1) {
      hit = e; // keep scanning; the last (topmost in reading order) wins
    }
  }
  return hit;
}

/**
 * Project an element's normalized rect to a page-card-local screen rect at the
 * current scale — delegates to the anchor service's `denormalizeRect` (AD-9:
 * the ONE home of normalize<->screen math). The overlay positions an element
 * with the returned `{left, top, width, height}`.
 */
export function denormalizeElement(
  element: StructureElement,
  box: PageBox,
  scale: number,
): ScreenRect {
  return denormalizeRect(element.rect, box, scale);
}

/**
 * `heading_level` (1 = top) -> the panel's 0-based `depth`. A missing/thin
 * level defaults to depth 0 (top); depth is capped so a noisy deep level can
 * never push the panel's indent off its fixed width.
 */
const MAX_TOC_DEPTH = 5;
function clampDepth(level: number | null | undefined): number {
  return Math.max(0, Math.min((level ?? 1) - 1, MAX_TOC_DEPTH));
}

/**
 * Matches a figure/table caption label ("Figure 1: ...", "Table 4. ...").
 * opendataloader sometimes mis-tags a caption as `type: "heading"` (observed
 * on real papers: `heading_level` 4, text starting with the caption label)
 * instead of `type: "caption"` — a caption is never a section to navigate to,
 * so `synthesizeToc` excludes anything matching this shape regardless of the
 * type the layer assigned it (user fix request, live-smoke finding on the
 * TranAD paper).
 */
const FIGURE_TABLE_CAPTION = /^(figure|table)\s+\d+\b/i;

/**
 * Synthesize a Table-of-Contents from the structure layer's heading elements
 * (Story 10.2, FR-35) — the fallback source for the common case where the PDF
 * has no embedded outline (`render/getOutline` returns `[]`). Reading order is
 * already the array order (Story 10.1's adapter walks opendataloader's tree
 * pre-order), so no extra sort. Each entry carries its heading's normalized
 * `rect` (already server-flipped, AD-4) so a synthesized jump can land on the
 * exact region, not just the page top — unlike an embedded-outline entry.
 */
export function synthesizeToc(structure: DocStructure): TocEntry[] {
  const out: TocEntry[] = [];
  for (const element of headings(structure)) {
    const title = element.text.trim();
    if (!title) continue; // a blank heading element never produces a dead row
    if (FIGURE_TABLE_CAPTION.test(title)) continue; // a caption, not a section
    out.push({
      title,
      pageNumber: element.page_index + 1, // 0-based -> the TocEntry convention
      depth: clampDepth(element.heading_level),
      rect: element.rect,
    });
  }
  return out;
}

/**
 * Decide which ToC source renders: the embedded PDF outline when present
 * (author-curated, keeps every Story 1.9 paper unchanged) else the synthesized
 * fallback from detected headings (Story 10.2, the common outline-less case).
 * Exactly one source ever renders — never a merge — so the two can never
 * double-render (epic Story 10.2 AC #2).
 */
export function resolveToc(embedded: TocEntry[], structure: DocStructure): TocEntry[] {
  return embedded.length > 0 ? embedded : synthesizeToc(structure);
}
