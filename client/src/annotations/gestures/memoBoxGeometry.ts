// memoBoxGeometry — the memo box's drag geometry, unified (Story 10.9). A memo's
// rect responds to a move/resize drag differently from a plain region rect: a
// minimum-size floor (10.2), a COLLAPSED-only width-only resize that pins the
// top-left (10.4), a move that clamps against whichever footprint (expanded or
// the wider persisted collapsed width) is wider (10.4), and a resize-baseline
// re-seed from the box's REAL rendered size (10.2/10.4). Stories 10.2/10.4 grew
// these as inline conditionals interleaved in `useEditGesture.computeAnchor` /
// its `onDown`; here they are one cohesive model the gesture delegates to.
//
// Layer note (AD-9): this composes the anchor/ page-fraction primitives
// (`resizeRectCorner`, `translateRect`) into memo-specific rules, co-located with
// its only consumer (`useEditGesture`) — the same pattern `position.ts` uses for
// viewport-px placement. The memo-specific clamps stay out of the generic anchor/
// layer (which must not know the UI concept "collapsed memo").

import { resizeRectCorner, translateRect, type RectCorner } from "@/anchor";

/** A normalized ([0,1] page-fraction) rect — structurally the shape of a
 *  `kind:"rect"` anchor's `rect` and of anchor/'s own internal `Rect`. */
export interface NormRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Page box (scale-1.0 CSS px) used to convert the CSS-px memo min to a fraction. */
export interface PageDims {
  width: number;
  height: number;
}

/** Memo minimum resize floor, scale-1.0 CSS px (Story 10.2): small enough to
 *  still hold a short word, tall enough for ~1 line of body-sm text plus the
 *  memo's padding. Converted to a normalized page fraction at resize time so the
 *  floor is zoom-independent — a CSS-px floor would change the allowable min rect
 *  as the user zooms. */
export const MIN_MEMO_WIDTH_PX = 48;
export const MIN_MEMO_HEIGHT_PX = 32;

/** The memo min as a normalized page fraction (zoom-independent). Region rects
 *  pass `isMemo=false` and get `undefined` (no floor). */
export function memoMinFraction(isMemo: boolean, box: PageDims): { w: number; h: number } | undefined {
  return isMemo ? { w: MIN_MEMO_WIDTH_PX / box.width, h: MIN_MEMO_HEIGHT_PX / box.height } : undefined;
}

/**
 * Next rect for a MOVE. A memo whose persisted collapsed width is wider than its
 * expanded rect (`collapsedWidth != null`) clamps the X axis against that WIDER
 * footprint (Story 10.4) so the visibly-wider collapsed box can't be dragged
 * off-page even though only the (narrower) expanded rect commits; height clamps
 * against the (invariant) expanded rect. Every other mark has `collapsedWidth ==
 * null` and this is identical to `translateRect`.
 */
export function moveMemoRect(rect: NormRect, dx: number, dy: number, collapsedWidth: number | null): NormRect {
  if (collapsedWidth == null) return translateRect(rect, dx, dy);
  const { x0, y0, x1, y1 } = rect;
  const effX1 = Math.max(x1, x0 + collapsedWidth);
  const cdx = Math.max(-x0, Math.min(1 - effX1, dx));
  const cdy = Math.max(-y0, Math.min(1 - y1, dy));
  return { x0: x0 + cdx, y0: y0 + cdy, x1: x1 + cdx, y1: y1 + cdy };
}

/**
 * Next rect for a corner RESIZE. A COLLAPSED memo (Story 10.4, user decision)
 * resizes WIDTH ONLY: keep the top-left FIXED and grow/shrink width from it (dy
 * passed as 0 so `resizeRectCorner`'s height math is inert; its height floor is 0
 * too, so it can't bump the unused y1), then re-anchor width onto the memo's
 * stored top-left and clamp x1 to the page edge (a moving-corner clamp inside
 * `resizeRectCorner` is relative to that corner, not the fixed top-left we
 * re-anchor to, so reapplying its width can overshoot 1). Otherwise a normal
 * corner resize with the memo min floor (region rects: no floor).
 */
export function resizeMemoRect(
  rect: NormRect,
  corner: RectCorner,
  dx: number,
  dy: number,
  isMemo: boolean,
  collapsed: boolean,
  box: PageDims,
): NormRect {
  const min = memoMinFraction(isMemo, box);
  if (collapsed && isMemo) {
    const next = resizeRectCorner(rect, corner, dx, 0, min && { w: min.w, h: 0 });
    const x1 = Math.min(1, rect.x0 + (next.x1 - next.x0));
    return { x0: rect.x0, y0: rect.y0, x1, y1: rect.y1 };
  }
  return resizeRectCorner(rect, corner, dx, dy, min);
}

/**
 * Re-seed a memo corner-resize's baseline rect from the box's REAL rendered size
 * (Story 10.2/10.4). A memo's rendered HEIGHT can differ from its stored anchor
 * (auto-grown taller); its top always matches y0 (CSS `top` is set from it, only
 * height is intrinsic), so seed y1 from the rendered height. WIDTH is re-seeded
 * ONLY for a COLLAPSED memo (its rendered width may be driven by
 * `style.collapsed_width`, not the stored rect); an EXPANDED memo's width is
 * always exactly `anchor.rect`'s, so re-measuring it would only risk sub-pixel
 * drift. `rendered` is null under jsdom (no layout) → a no-op there (LIVE-SMOKE
 * only). The caller does the DOM read and passes the measured size in.
 */
export function reseedMemoResizeRect(
  rect: NormRect,
  rendered: { width: number; height: number } | null | undefined,
  box: PageDims,
  scale: number,
  collapsed: boolean,
): NormRect {
  const next = { ...rect };
  const heightFrac = (rendered?.height ?? 0) / (box.height * scale);
  if (Number.isFinite(heightFrac) && heightFrac > 0) next.y1 = rect.y0 + heightFrac;
  if (collapsed) {
    const widthFrac = (rendered?.width ?? 0) / (box.width * scale);
    if (Number.isFinite(widthFrac) && widthFrac > 0) next.x1 = rect.x0 + widthFrac;
  }
  return next;
}
