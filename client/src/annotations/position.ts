// Pure quick-box positioning (AC-4): nudge the popup so it stays fully on-screen
// without ever shifting the canvas. DOM-free so it is unit-testable; the
// controller feeds it the measured box size + viewport at layout time.

import type { ScreenRect } from "@/anchor";

export interface Point {
  x: number;
  y: number;
}

/** Gap (viewport px) between a mark and a quick-box/popup floating beside or
 *  below it — shared by every "beside the mark" placement (the memo selection
 *  quick-box's left shift, the box comment popup's right shift, fix request). */
export const QUICK_BOX_GAP = 6;

/**
 * Clamp the top-left `(x, y)` of a `boxW × boxH` popup so it stays within the
 * `vw × vh` viewport, keeping a `margin` gutter. If the box is wider/taller than
 * the viewport it pins to the top-left margin.
 */
export function clampToViewport(
  x: number,
  y: number,
  boxW: number,
  boxH: number,
  vw: number,
  vh: number,
  margin = 8,
): Point {
  const maxX = Math.max(margin, vw - boxW - margin);
  const maxY = Math.max(margin, vh - boxH - margin);
  return {
    x: Math.min(Math.max(margin, x), maxX),
    y: Math.min(Math.max(margin, y), maxY),
  };
}

/**
 * `rect` shifted to sit just to the RIGHT of its own position, top-aligned,
 * `gap` px clear of its edge (box comment popup, fix request: beside the
 * highlight, never over it). Returns a full `ScreenRect` (NOT a bare `Point`)
 * because the caller (`CommentBubble`/`CommentPreview`'s `pos` prop) requires
 * that exact shape — width/height pass through unchanged, unused by today's
 * callers but keeping the return a well-formed `ScreenRect` like its input.
 */
export function rightOf(rect: ScreenRect, gap: number = QUICK_BOX_GAP): ScreenRect {
  return { left: rect.left + rect.width + gap, top: rect.top, width: rect.width, height: rect.height };
}

/** Viewport-px bounds of a selection or selected mark (`position: fixed` coordinate space). */
export interface SelectionRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Decide where a `boxW × boxH` quick-box should sit beside a selection: prefer
 * the RIGHT of `sel` (top-aligned to `sel.top`); if that would overflow the
 * viewport, flip to the LEFT (mirrored, still top-aligned); if that also
 * overflows, fall back BELOW `sel` (pre-10.6 anchor). A final `clampToViewport`
 * always runs so the box is fully on-screen regardless of which candidate won.
 */
export function placeBesideSelection(
  sel: SelectionRect,
  boxW: number,
  boxH: number,
  vw: number,
  vh: number,
  gap: number = QUICK_BOX_GAP,
  margin = 8,
): Point {
  const right = { x: sel.right + gap, y: sel.top };
  if (right.x + boxW <= vw - margin) return clampToViewport(right.x, right.y, boxW, boxH, vw, vh, margin);

  const left = { x: sel.left - gap - boxW, y: sel.top };
  if (left.x >= margin) return clampToViewport(left.x, left.y, boxW, boxH, vw, vh, margin);

  const below = { x: sel.left, y: sel.bottom + gap };
  return clampToViewport(below.x, below.y, boxW, boxH, vw, vh, margin);
}
