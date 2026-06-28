// Pure quick-box positioning (AC-4): nudge the popup so it stays fully on-screen
// without ever shifting the canvas. DOM-free so it is unit-testable; the
// controller feeds it the measured box size + viewport at layout time.

export interface Point {
  x: number;
  y: number;
}

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
