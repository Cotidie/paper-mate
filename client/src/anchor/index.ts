// anchor/ — the SINGLE home of normalized↔screen coordinate math (AD-4, AD-9).
// No other module (render/, annotations/, store/, components) computes
// screen↔PDF coordinates.
//
// Coordinate model (AD-4):
//  - The render layer is the single source of the page box: `getPageBox(page)`
//    = the pdf.js viewport at scale 1.0, in CSS px, with CropBox + `/Rotate`
//    baked in (render/index.ts). The card's rendered size = `box * scale`.
//  - A normalized anchor stores `[0,1]` fractions of that box, canonical
//    (`x0<=x1, y0<=y1`), top-left origin, y-down. Screen position is ALWAYS
//    derived from the normalized anchor at the current `scale`, never stored.
//
// Adopt-stable, not hand-rolled (Epic-1 retro PREP-1): the bottom-left→top-left
// projection + rotation is owned by pdf.js `getViewport` (consumed via
// render/getPageBox), so the anchor service works purely in top-left y-down
// space and must NOT re-flip y. Re-calling `viewport.convertToPdfPoint` here
// would hand us y-up PDF points and force exactly the manual `height - y` flip
// the principle warns against — so the remaining math is plain scale
// normalization (divide/multiply by `box * scale`), which round-trips correctly
// across zoom AND rotation because both directions use the same baked box.

import type { PageBox } from "../render";
import type { Rect } from "../api/client";

/** A rect in page-card-local CSS px (top-left origin), pre-normalization. */
export interface LocalRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A positioned box in page-card-local CSS px, derived from a normalized anchor
 *  at the current scale — what the overlay positions an element with. */
export interface ScreenRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Order the corners so `x0<=x1, y0<=y1` — canonicalizes a negative drag. */
export function canonicalize(x0: number, y0: number, x1: number, y1: number): LocalRect {
  return {
    x0: Math.min(x0, x1),
    y0: Math.min(y0, y1),
    x1: Math.max(x0, x1),
    y1: Math.max(y0, y1),
  };
}

/**
 * Normalize a card-local CSS-px rect to `[0,1]` fractions of the page box
 * (AD-4). The card's on-screen size is `box * scale`, so dividing by it removes
 * the scale → the stored anchor is scale-independent. Canonicalizes first.
 */
export function normalizeRect(local: LocalRect, box: PageBox, scale: number): Rect {
  const w = box.width * scale;
  const h = box.height * scale;
  const c = canonicalize(local.x0, local.y0, local.x1, local.y1);
  return {
    x0: w > 0 ? c.x0 / w : 0,
    y0: h > 0 ? c.y0 / h : 0,
    x1: w > 0 ? c.x1 / w : 0,
    y1: h > 0 ? c.y1 / h : 0,
  };
}

/**
 * Denormalize a stored anchor rect back to a card-local screen box at the
 * current `scale` (AD-4, AC-6). The inverse of `normalizeRect`: multiply the
 * fractions by `box * scale`. Called on every scale change so a mark re-renders
 * at its exact PDF location at every zoom level.
 */
export function denormalizeRect(rect: Rect, box: PageBox, scale: number): ScreenRect {
  const w = box.width * scale;
  const h = box.height * scale;
  const c = canonicalize(rect.x0, rect.y0, rect.x1, rect.y1);
  return {
    left: c.x0 * w,
    top: c.y0 * h,
    width: (c.x1 - c.x0) * w,
    height: (c.y1 - c.y0) * h,
  };
}

/** A client-rect-shaped box (CSS px in viewport space). Mirrors the fields of
 *  `DOMRect` we read, so the page-pick logic is unit-testable with plain data. */
export interface ClientBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Pure helper: the index into `cards` whose box contains the midpoint of
 * `rect`, or `-1` if none. Drives the two-page split (AC-5) — a selection
 * crossing two cards yields rects that pick different cards. Midpoint (not
 * top-left) so a rect straddling a card gap still lands on the card it mostly
 * covers. DOM-free, unit-testable (jsdom zeroes real client rects).
 */
export function pickPage(rect: ClientBox, cards: ClientBox[]): number {
  const midX = (rect.left + rect.right) / 2;
  const midY = (rect.top + rect.bottom) / 2;
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    if (midX >= c.left && midX <= c.right && midY >= c.top && midY <= c.bottom) return i;
  }
  return -1;
}

/** One page's slice of a text selection: its 0-based `page_index`, the
 *  normalized per-line `rects`, and the selection `text`. Feeds a `TextAnchor`. */
export interface PageSelection {
  page_index: number;
  rects: Rect[];
  text: string;
}

/** A rendered page card the selection may cross: its DOM element, scale-1.0
 *  box, and 0-based page index. */
export interface PageCardRef {
  pageIndex: number;
  cardEl: HTMLElement;
  box: PageBox;
}

/**
 * Map a live text selection to one `PageSelection` per page it covers (AD-4),
 * reading text-run rects from the native Selection API (`Range.getClientRects`,
 * the stable primitive — NOT a glyph hit-test). Each client rect is localized
 * into its page card's box (CSS px, DPR already divided out by
 * `getBoundingClientRect`) and normalized via `normalizeRect`. A selection
 * crossing two cards yields two entries → the AC-5 two-page split. Returns `[]`
 * for an empty/collapsed selection.
 *
 * DOM-touching (so jsdom can't exercise it — its rects are zeroed); the pure
 * math underneath (`normalizeRect`, `pickPage`) carries the unit tests.
 */
export function rectsFromSelection(
  selection: Selection | null,
  pages: PageCardRef[],
  scale: number,
): PageSelection[] {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return [];
  const cardBoxes: ClientBox[] = pages.map((p) => p.cardEl.getBoundingClientRect());
  // Accumulate normalized rects per page index, in card order.
  const byPage = new Map<number, Rect[]>();

  for (let r = 0; r < selection.rangeCount; r++) {
    const range = selection.getRangeAt(r);
    for (const cr of Array.from(range.getClientRects())) {
      if (cr.width <= 0 || cr.height <= 0) continue;
      const idx = pickPage({ left: cr.left, top: cr.top, right: cr.right, bottom: cr.bottom }, cardBoxes);
      if (idx < 0) continue;
      const page = pages[idx];
      const cardRect = cardBoxes[idx];
      const local: LocalRect = {
        x0: cr.left - cardRect.left,
        y0: cr.top - cardRect.top,
        x1: cr.right - cardRect.left,
        y1: cr.bottom - cardRect.top,
      };
      const norm = normalizeRect(local, page.box, scale);
      const list = byPage.get(page.pageIndex) ?? [];
      list.push(norm);
      byPage.set(page.pageIndex, list);
    }
  }

  const text = selection.toString();
  // Preserve card order (pages array order) so a two-page split is stable.
  const out: PageSelection[] = [];
  for (const page of pages) {
    const rects = byPage.get(page.pageIndex);
    if (rects && rects.length > 0) out.push({ page_index: page.pageIndex, rects, text });
  }
  return out;
}
