// render/nearestTextAnchor — resolve the nearest text position to an
// empty-origin pointer point WITHOUT the caretRangeFromPoint/
// caretPositionFromPoint family (poisoned mid-session; see
// deferred-work.md#Discarded: Story 8.9). Local to render/ (AD-9: no import
// from anchor/); replicates collectTextRects's per-text-node sub-range
// measurement locally rather than importing it.
//
// NEAREST GLYPH BY 2D DISTANCE (Story 8.11): the empty-space drag should behave
// exactly like an on-text drag, only with its START snapped to the nearest
// text. So both the anchor (at pointerdown) and the focus (each drag frame) are
// the glyph whose rect is nearest the pointer by 2D distance, then the nearest
// character within it. This is column-correct for free: the horizontal distance
// across a two-column gutter is large, so a point in the left column resolves
// to left-column text and a point in the right column to right-column text —
// no band/gutter model needed. Dragging from one column into the other then
// extends the native selection across, just as a native text drag does (the
// browser's own contiguous range), which is the point of "behave like a text
// drag". No column locking.
//
// LIVE, NOT CACHED (Story 8.11 perf + scroll): resolution re-runs from live
// geometry each drag frame (rAF-throttled by the caller). The lag came from
// setBaseAndExtent on every pointermove, not this resolver (~0.3ms over a
// page's glyphs); caching rects would go stale on scroll mid-drag.

/** A glyph span with its current rect. */
interface Glyph {
  el: HTMLElement;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface NearestTextPoint {
  node: Text;
  offset: number;
}

const defaultElRectsOf = (el: Element): DOMRect => el.getBoundingClientRect();
const defaultRangeRectsOf = (r: Range): ArrayLike<DOMRect> => r.getClientRects();

/**
 * pdf.js sets `--rotate` as an INLINE style on a rotated glyph run (e.g. a
 * margin-printed arXiv id rotated -90deg). Its post-transform bounding box is
 * axis-aligned and near page-tall, which would sit "nearest" a huge swath of
 * the page. Read the inline custom property directly (jsdom-safe).
 */
function isRotatedSpan(span: HTMLElement): boolean {
  const rotate = span.style.getPropertyValue("--rotate").trim();
  return rotate !== "" && rotate !== "0deg" && rotate !== "0";
}

/** Measure a layer's usable glyph spans (live). */
function gatherGlyphs(layer: Element, elRectsOf: (el: Element) => DOMRect): Glyph[] {
  const glyphs: Glyph[] = [];
  for (const el of layer.querySelectorAll<HTMLElement>("span")) {
    if (el.classList.contains("endOfContent") || isRotatedSpan(el)) continue;
    const r = elRectsOf(el);
    if (r.width <= 0 || r.height <= 0) continue;
    glyphs.push({ el, left: r.left, right: r.right, top: r.top, bottom: r.bottom });
  }
  return glyphs;
}

/** Squared distance from point `(x, y)` to a glyph's rect (0 if inside). */
function distSqToGlyph(g: Glyph, x: number, y: number): number {
  const dx = x < g.left ? g.left - x : x > g.right ? x - g.right : 0;
  const dy = y < g.top ? g.top - y : y > g.bottom ? y - g.bottom : 0;
  return dx * dx + dy * dy;
}

/** The glyph whose rect is nearest `(x, y)` by 2D distance. */
export function nearestGlyph(glyphs: Glyph[], x: number, y: number): Glyph | null {
  let best: Glyph | null = null;
  let bestDist = Infinity;
  for (const g of glyphs) {
    const d = distSqToGlyph(g, x, y);
    if (d < bestDist) {
      bestDist = d;
      best = g;
    }
  }
  return best;
}

/**
 * Binary-search the nearest character boundary within `textNode` to `x`. Every
 * probed boundary is measured with a NON-collapsed single-character sub-range
 * (a collapsed Range's `getClientRects()` is inconsistent across engines).
 * Mirrors `collectTextRects`'s per-text-node sub-range pattern; `rectsOf` is
 * injectable so the search is unit-testable without real layout.
 */
export function nearestOffsetInTextNode(
  textNode: Text,
  x: number,
  rectsOf: (r: Range) => ArrayLike<DOMRect> = defaultRangeRectsOf,
): number {
  const length = textNode.length;
  if (length === 0) return 0;
  const boundaryX = (offset: number): number | null => {
    const r = document.createRange();
    if (offset <= 0) {
      r.setStart(textNode, 0);
      r.setEnd(textNode, Math.min(1, length));
      const rects = Array.from(rectsOf(r));
      return rects[0]?.left ?? null;
    }
    r.setStart(textNode, offset - 1);
    r.setEnd(textNode, offset);
    const rects = Array.from(rectsOf(r));
    return rects[rects.length - 1]?.right ?? null;
  };
  const startX = boundaryX(0);
  const endX = boundaryX(length);
  if (startX === null || endX === null) return 0;
  if (x <= startX) return 0;
  if (x >= endX) return length;
  let lo = 0;
  let hi = length;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    const midX = boundaryX(mid);
    if (midX !== null && midX <= x) lo = mid;
    else hi = mid;
  }
  const loX = boundaryX(lo) ?? x;
  const hiX = boundaryX(hi) ?? x;
  return Math.abs(x - loX) <= Math.abs(x - hiX) ? lo : hi;
}

/**
 * A pointer whose nearest glyph is more than this many line-heights away is a
 * genuinely empty margin, not "blank space next to text" — the no-op stays.
 */
const MAX_DISTANCE_IN_LINE_HEIGHTS = 3;

/**
 * Resolve the nearest text position to `(x, y)` within `layer` from live
 * geometry: the glyph nearest by 2D distance, then the nearest character within
 * it. Null when the nearest glyph is too far (a far-empty margin) or the layer
 * has no glyphs. Used for BOTH the snap anchor (at pointerdown) and the focus
 * (each drag frame) — there is no column locking, so a drag extends across
 * columns exactly like a native text drag.
 */
export function resolveNearestText(
  layer: Element,
  x: number,
  y: number,
  elRectsOf: (el: Element) => DOMRect = defaultElRectsOf,
  rangeRectsOf: (r: Range) => ArrayLike<DOMRect> = defaultRangeRectsOf,
): NearestTextPoint | null {
  const glyphs = gatherGlyphs(layer, elRectsOf);
  const glyph = nearestGlyph(glyphs, x, y);
  if (!glyph) return null;
  const height = glyph.bottom - glyph.top || 16;
  if (distSqToGlyph(glyph, x, y) > (MAX_DISTANCE_IN_LINE_HEIGHTS * height) ** 2) return null;
  const textNode = glyph.el.firstChild;
  if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return null;
  const offset = nearestOffsetInTextNode(textNode as Text, x, rangeRectsOf);
  return { node: textNode as Text, offset };
}
