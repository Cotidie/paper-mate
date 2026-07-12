// render/nearestTextAnchor — resolve the nearest text position to an
// empty-origin pointer point WITHOUT the caretRangeFromPoint/
// caretPositionFromPoint family (poisoned mid-session; see
// deferred-work.md#Discarded: Story 8.9). Local to render/ (AD-9: no import
// from anchor/); replicates collectTextRects's per-text-node sub-range
// measurement locally rather than importing it.

export interface SpanLine {
  spans: HTMLElement[];
  top: number;
  bottom: number;
}

const defaultElRectsOf = (el: Element): DOMRect => el.getBoundingClientRect();
const defaultRangeRectsOf = (r: Range): ArrayLike<DOMRect> => r.getClientRects();

/**
 * pdf.js sets `--rotate` as an INLINE style on a rotated glyph run (e.g. a
 * margin-printed arXiv id rotated -90deg). Its post-transform bounding box is
 * axis-aligned and near page-tall, which would otherwise merge every normal
 * line band into one. Read the inline custom property directly (jsdom-safe; no
 * computed style needed).
 */
function isRotatedSpan(span: HTMLElement): boolean {
  const rotate = span.style.getPropertyValue("--rotate").trim();
  return rotate !== "" && rotate !== "0deg" && rotate !== "0";
}

/**
 * Group a text layer's glyph spans into line bands by vertical overlap. pdf.js
 * emits spans in column-major DOM order; `nearestSpanInLine`'s horizontal step
 * resolves the origin's own column within a band.
 */
export function groupSpanLines(
  spans: HTMLElement[],
  elRectsOf: (el: Element) => DOMRect = defaultElRectsOf,
): SpanLine[] {
  const lines: SpanLine[] = [];
  for (const span of spans) {
    if (isRotatedSpan(span)) continue;
    const r = elRectsOf(span);
    if (r.width <= 0 || r.height <= 0) continue;
    const line = lines.find((l) => r.top < l.bottom && r.bottom > l.top);
    if (line) {
      line.spans.push(span);
      line.top = Math.min(line.top, r.top);
      line.bottom = Math.max(line.bottom, r.bottom);
    } else {
      lines.push({ spans: [span], top: r.top, bottom: r.bottom });
    }
  }
  return lines;
}

/**
 * Nearest line band to `y`: a containing band wins; else the nearer edge.
 * Equidistant between two lines prefers the PRECEDING line (matches "start
 * from the end of the preceding line when dragging down").
 */
export function nearestLine(lines: SpanLine[], y: number): SpanLine | null {
  let best: SpanLine | null = null;
  let bestDist = Infinity;
  let bestIsPreceding = false;
  for (const line of lines) {
    if (y >= line.top && y <= line.bottom) return line;
    const isPreceding = line.bottom <= y;
    const dist = isPreceding ? y - line.bottom : line.top - y;
    if (dist < bestDist || (dist === bestDist && isPreceding && !bestIsPreceding)) {
      best = line;
      bestDist = dist;
      bestIsPreceding = isPreceding;
    }
  }
  return best;
}

/**
 * The glyph span in a line whose horizontal extent is nearest `x` (a
 * containing span wins; else the nearer edge).
 */
export function nearestSpanInLine(
  line: SpanLine,
  x: number,
  elRectsOf: (el: Element) => DOMRect = defaultElRectsOf,
): HTMLElement | null {
  let best: HTMLElement | null = null;
  let bestDist = Infinity;
  for (const span of line.spans) {
    const r = elRectsOf(span);
    if (x >= r.left && x <= r.right) return span;
    const dist = x < r.left ? r.left - x : x - r.right;
    if (dist < bestDist) {
      best = span;
      bestDist = dist;
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

export interface NearestTextPoint {
  node: Text;
  offset: number;
}

/**
 * A pointer more than this many line-heights from the nearest band is a
 * genuinely empty margin, not "blank space next to text" — the no-op stays.
 */
const MAX_LINE_DISTANCE_IN_LINE_HEIGHTS = 2;

/**
 * Resolve the nearest text position to `(x, y)` within `layer` (a registered
 * `.textLayer`), once. Null when no line is close enough to count as next to
 * text (the far-margin no-op case).
 */
export function resolveNearestTextPoint(
  layer: Element,
  x: number,
  y: number,
  elRectsOf: (el: Element) => DOMRect = defaultElRectsOf,
  rangeRectsOf: (r: Range) => ArrayLike<DOMRect> = defaultRangeRectsOf,
): NearestTextPoint | null {
  const spans = Array.from(layer.querySelectorAll<HTMLElement>("span")).filter(
    (s) => !s.classList.contains("endOfContent"),
  );
  const lines = groupSpanLines(spans, elRectsOf);
  const line = nearestLine(lines, y);
  if (!line) return null;
  const lineHeight = line.bottom - line.top || 16;
  const lineDistance = y < line.top ? line.top - y : y > line.bottom ? y - line.bottom : 0;
  if (lineDistance > lineHeight * MAX_LINE_DISTANCE_IN_LINE_HEIGHTS) return null;
  const span = nearestSpanInLine(line, x, elRectsOf);
  const textNode = span?.firstChild;
  if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return null;
  const offset = nearestOffsetInTextNode(textNode as Text, x, rangeRectsOf);
  return { node: textNode as Text, offset };
}
