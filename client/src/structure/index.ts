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
