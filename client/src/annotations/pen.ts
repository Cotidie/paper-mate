// pen.ts — the freehand stroke engine (AD-2: adopt perfect-freehand, do NOT
// hand-roll spline math). Pure + DOM-free so the live preview AND AnnotationLayer
// draw a stroke IDENTICALLY (what-you-draw-is-what-you-get) and so the geometry is
// unit-testable without a canvas. Input points are in whatever space the caller
// works in (client px for the preview, card-local px for the stored mark
// re-derived at scale); `size` is the stroke diameter in that same space.
//
// Two steps: (1) `strokeOutline` turns the drawn points into the polygon outline
// that surrounds them (perfect-freehand `getStroke`); (2) `svgPathFromOutline`
// turns that outline into an SVG path `d` (quadratic-smoothed, the canonical
// perfect-freehand snippet). The mark renders as a FILLED path of that outline.

import { getStroke } from "perfect-freehand";

/** A drawn input point in some px space (client or card-local). */
export interface StrokeInputPoint {
  x: number;
  y: number;
}

/** Fixed stroke options. We capture no stylus pressure (mouse/touch/pen all land
 *  the same width), so `simulatePressure` is off and `thinning` is 0 → a constant
 *  `size` line. `streamline`/`smoothing` soften the hand jitter; round caps so
 *  short strokes read as a dot, not a sliver. (Pressure/tilt tuning is OUT, a
 *  later polish item.) */
const STROKE_OPTIONS = {
  thinning: 0,
  smoothing: 0.5,
  streamline: 0.5,
  simulatePressure: false,
  last: true,
} as const;

/**
 * The polygon outline (a closed ring of `[x, y]` points) that surrounds the drawn
 * input at the given stroke diameter `size`. Returns `[]` for empty input. The
 * outline is in the SAME space as the input points.
 */
export function strokeOutline(points: StrokeInputPoint[], size: number): number[][] {
  if (points.length === 0) return [];
  return getStroke(points, { ...STROKE_OPTIONS, size });
}

/**
 * Build an SVG path `d` from a stroke outline (the canonical perfect-freehand
 * quadratic-smoothing snippet: move to the first point, then draw a quadratic
 * curve through each point's midpoint, and close). Returns `""` for an empty
 * outline (so an empty stroke renders nothing rather than crashing the path).
 */
export function svgPathFromOutline(outline: number[][]): string {
  if (outline.length === 0) return "";
  const d = outline.reduce(
    (acc, [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length];
      acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
      return acc;
    },
    ["M", ...outline[0], "Q"] as (string | number)[],
  );
  d.push("Z");
  return d.join(" ");
}
