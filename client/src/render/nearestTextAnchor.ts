// render/nearestTextAnchor — resolve the nearest text position to an
// empty-origin pointer point WITHOUT the caretRangeFromPoint/
// caretPositionFromPoint family (poisoned mid-session; see
// deferred-work.md#Discarded: Story 8.9). Local to render/ (AD-9: no import
// from anchor/); replicates collectTextRects's per-text-node sub-range
// measurement locally rather than importing it.
//
// TWO RESOLUTIONS (Story 8.11):
//   - The FOCUS (moving end, each drag frame): `resolveNearestText` — the glyph
//     nearest the pointer by 2D distance, then the nearest character in it.
//     Column-correct for free (the gutter's horizontal gap is large, so a point
//     resolves to its own column) and lets a drag extend across columns exactly
//     like a native text drag.
//   - The ANCHOR (fixed end, from the origin): `resolveOrigin` — direction-aware
//     so a drag that STARTS in the blank gap between paragraphs anchors on a
//     paragraph boundary, not a mid-line character: dragging UP anchors at the
//     END of the line above the gap, dragging DOWN at the START of the line
//     below (both in the pointer's own column). Beside text (inside a line's
//     vertical band, e.g. a right margin) it is just the nearest character.
//
// LIVE, NOT CACHED (Story 8.11 perf + scroll): the focus re-resolves from live
// geometry each frame (rAF-throttled by the caller). The lag came from
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

/** One text line within a single column: its glyphs + vertical band. */
interface Line {
  glyphs: Glyph[];
  top: number;
  bottom: number;
}

export interface NearestTextPoint {
  node: Text;
  offset: number;
}

/**
 * The moving-focus result: a nearest text point plus whether the pointer's Y is
 * ON that glyph's text row — inside its vertical band OR within a small
 * tolerance of it. `onRow` is the "touching a row" signal the caller uses to
 * decide when the snap selection is live: it starts painting on the first
 * on-row frame (Issue #1: no paint while the cursor is still in blank space),
 * and collapses again whenever the cursor sits in a blank vertical gap between
 * paragraphs (no lingering selection at a point with no text). The tolerance is
 * wide enough to bridge inter-line leading within a paragraph (so a normal
 * down-drag does not flicker) but narrower than a paragraph gap.
 */
export interface FocusPoint extends NearestTextPoint {
  onRow: boolean;
}

/**
 * The snap origin's anchor candidates: `inBand` when the pointer is beside text
 * (inside a line's vertical band); otherwise the pointer is in a vertical gap
 * and `aboveEnd` / `belowStart` are the paragraph-boundary anchors chosen by
 * drag direction. `originY` is the pointerdown Y used to decide the direction.
 */
export interface OriginContext {
  originY: number;
  inBand: NearestTextPoint | null;
  aboveEnd: NearestTextPoint | null;
  belowStart: NearestTextPoint | null;
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

/** The glyph whose horizontal extent is nearest `x` (0 distance if x is inside). */
function nearestGlyphByX(glyphs: Glyph[], x: number): Glyph | null {
  let best: Glyph | null = null;
  let bestDist = Infinity;
  for (const g of glyphs) {
    const d = x >= g.left && x <= g.right ? 0 : x < g.left ? g.left - x : x - g.right;
    if (d < bestDist) {
      bestDist = d;
      best = g;
    }
  }
  return best;
}

/**
 * Group glyphs into line bands by vertical overlap (pure). Glyphs are sorted by
 * top first so a band that bridges two earlier bands still merges them into one
 * line regardless of input order (a bridging glyph always arrives adjacent to
 * the bands it joins).
 */
function groupLines(glyphs: Glyph[]): Line[] {
  const lines: Line[] = [];
  for (const glyph of [...glyphs].sort((a, b) => a.top - b.top)) {
    const line = lines.find((l) => glyph.top < l.bottom && glyph.bottom > l.top);
    if (line) {
      line.glyphs.push(glyph);
      line.top = Math.min(line.top, glyph.top);
      line.bottom = Math.max(line.bottom, glyph.bottom);
    } else {
      lines.push({ glyphs: [glyph], top: glyph.top, bottom: glyph.bottom });
    }
  }
  return lines;
}

/**
 * The horizontal extent of the run of glyphs on `g`'s own row that is
 * contiguous with `g` (breaking at any gap wider than a column gutter,
 * approximated as one line-height). Used as a local fallback column when the
 * page's coverage histogram does not carve out a range for a sparse region
 * (e.g. a lone caption or heading on one side).
 */
function localColumnBand(glyphs: Glyph[], g: Glyph): [number, number] {
  const height = g.bottom - g.top || 16;
  const gutter = height; // a real inter-column gutter exceeds ~1 line-height
  const row = glyphs.filter((q) => q.top < g.bottom && q.bottom > g.top).sort((a, b) => a.left - b.left);
  let lo = row.indexOf(g);
  let hi = lo;
  while (lo > 0 && row[lo].left - row[lo - 1].right < gutter) lo--;
  while (hi < row.length - 1 && row[hi + 1].left - row[hi].right < gutter) hi++;
  const run = row.slice(lo, hi + 1);
  return [Math.min(...run.map((q) => q.left)), Math.max(...run.map((q) => q.right))];
}

const COLUMN_BINS = 120;

/**
 * Detect column X-ranges from a page's line bands by horizontal coverage: an
 * X-bin is "in a column" when MANY lines have a glyph over it. Body columns are
 * covered by most lines; the gutter by none; a centered title/header or a short
 * heading covers its span for only a line or two, so a column's range is the
 * FULL body width (never the width of one short line). Returns ranges L→R.
 */
function detectColumns(lines: Line[], layerLeft: number, layerWidth: number): [number, number][] {
  if (lines.length === 0 || layerWidth <= 0) return [];
  const binW = layerWidth / COLUMN_BINS;
  const coverage = new Array(COLUMN_BINS).fill(0);
  for (const line of lines) {
    const covered = new Array(COLUMN_BINS).fill(false);
    for (const g of line.glyphs) {
      const b0 = Math.max(0, Math.min(COLUMN_BINS - 1, Math.floor((g.left - layerLeft) / binW)));
      const b1 = Math.max(0, Math.min(COLUMN_BINS - 1, Math.floor((g.right - layerLeft) / binW)));
      for (let b = b0; b <= b1; b++) covered[b] = true;
    }
    for (let b = 0; b < COLUMN_BINS; b++) if (covered[b]) coverage[b]++;
  }
  const threshold = Math.max(2, lines.length * 0.15);
  const ranges: [number, number][] = [];
  let start = -1;
  for (let b = 0; b <= COLUMN_BINS; b++) {
    const on = b < COLUMN_BINS && coverage[b] >= threshold;
    if (on && start < 0) start = b;
    else if (!on && start >= 0) {
      ranges.push([layerLeft + start * binW, layerLeft + b * binW]);
      start = -1;
    }
  }
  return ranges;
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
 * A pointer within this fraction of a line-height above/below a row's band
 * counts as "on the row". Wide enough to bridge inter-line leading inside a
 * paragraph (a normal down-drag never flickers), narrower than a paragraph gap
 * (so the cursor sitting in a blank gap reads as off-row → no selection).
 */
const LINE_TOUCH_TOLERANCE = 0.5;

function pointOfNode(node: ChildNode | null, offset: number): NearestTextPoint | null {
  return node && node.nodeType === Node.TEXT_NODE ? { node: node as Text, offset } : null;
}

/** The character point nearest `x` within a line. */
function nearestCharInLine(
  line: Line,
  x: number,
  rangeRectsOf: (r: Range) => ArrayLike<DOMRect>,
): NearestTextPoint | null {
  let best: Glyph | null = null;
  let bestDist = Infinity;
  for (const g of line.glyphs) {
    const d = x >= g.left && x <= g.right ? 0 : x < g.left ? g.left - x : x - g.right;
    if (d < bestDist) {
      bestDist = d;
      best = g;
    }
  }
  const node = best?.el.firstChild;
  if (!node || node.nodeType !== Node.TEXT_NODE) return null;
  return { node: node as Text, offset: nearestOffsetInTextNode(node as Text, x, rangeRectsOf) };
}

/** The end (last char) of a line, in reading order. */
function lineEnd(line: Line): NearestTextPoint | null {
  const last = line.glyphs.reduce((a, b) => (b.right > a.right ? b : a));
  const node = last.el.firstChild;
  return pointOfNode(node, node?.nodeType === Node.TEXT_NODE ? (node as Text).length : 0);
}

/** The start (first char) of a line, in reading order. */
function lineStart(line: Line): NearestTextPoint | null {
  const first = line.glyphs.reduce((a, b) => (b.left < a.left ? b : a));
  return pointOfNode(first.el.firstChild, 0);
}

/**
 * Resolve the moving FOCUS each drag frame from live geometry. If the pointer's
 * `y` is inside some glyph's vertical band, the cursor is ON that row: pick the
 * horizontally nearest glyph AMONG the in-band glyphs (so a horizontally closer
 * glyph on a DIFFERENT line never wins, and a cursor deep in the side margin at
 * a row's Y keeps tracking that row — Issue #2, no horizontal gate). Only when
 * `y` sits in a vertical gap does it fall back to the nearest glyph by 2D
 * distance, with `onRow` decided by the line-touch tolerance. No column locking,
 * so a drag extends across columns like a native text drag. Null only when the
 * layer has no usable glyphs.
 */
export function resolveNearestText(
  layer: Element,
  x: number,
  y: number,
  elRectsOf: (el: Element) => DOMRect = defaultElRectsOf,
  rangeRectsOf: (r: Range) => ArrayLike<DOMRect> = defaultRangeRectsOf,
): FocusPoint | null {
  const glyphs = gatherGlyphs(layer, elRectsOf);
  if (glyphs.length === 0) return null;
  const inBand = glyphs.filter((g) => y >= g.top && y <= g.bottom);
  let glyph: Glyph | null;
  let onRow: boolean;
  if (inBand.length > 0) {
    glyph = nearestGlyphByX(inBand, x);
    onRow = true;
  } else {
    glyph = nearestGlyph(glyphs, x, y);
    if (!glyph) return null;
    const height = glyph.bottom - glyph.top || 16;
    const dy = y < glyph.top ? glyph.top - y : y - glyph.bottom;
    onRow = dy <= LINE_TOUCH_TOLERANCE * height;
  }
  const node = glyph?.el.firstChild;
  if (!node || node.nodeType !== Node.TEXT_NODE) return null;
  return { node: node as Text, offset: nearestOffsetInTextNode(node as Text, x, rangeRectsOf), onRow };
}

/**
 * Resolve the snap ANCHOR context at gesture start. The pointer's column is
 * taken from the glyph nearest by 2D distance (the gutter's horizontal gap
 * keeps this in one column); its line's horizontal extent defines the column
 * band, and the layer's glyphs within that band are grouped into lines.
 *   - Beside text (pointer inside a line's vertical band): `inBand` is the
 *     nearest character (e.g. a right-margin drag anchors at the line's end).
 *   - In a vertical gap: `aboveEnd` = end of the line above, `belowStart` =
 *     start of the line below, so the caller anchors by drag direction.
 * Null past the proximity threshold (far-empty margin) or with no glyphs.
 */
export function resolveOrigin(
  layer: Element,
  x: number,
  y: number,
  elRectsOf: (el: Element) => DOMRect = defaultElRectsOf,
  rangeRectsOf: (r: Range) => ArrayLike<DOMRect> = defaultRangeRectsOf,
): OriginContext | null {
  const glyphs = gatherGlyphs(layer, elRectsOf);
  const g = nearestGlyph(glyphs, x, y);
  if (!g) return null;
  const height = g.bottom - g.top || 16;
  if (distSqToGlyph(g, x, y) > (MAX_DISTANCE_IN_LINE_HEIGHTS * height) ** 2) return null;

  // The origin's column = the coverage-detected column X-range that contains the
  // ORIGIN GLYPH's centre (robust to short headings/last lines, unlike one
  // glyph's own width). Keyed off the glyph's centre, not the raw pointer x, so
  // the column that actually won `nearestGlyph` stays eligible. If no detected
  // body column contains it (a sparse region — a lone caption/heading on one
  // side), fall back to a local band from the glyph's own row so the anchor
  // never jumps into the other column. Group just that column's glyphs into
  // lines so the gap's above/below boundaries stay in-column.
  const layerRect = elRectsOf(layer);
  const columns = detectColumns(groupLines(glyphs), layerRect.left, layerRect.width || 1);
  const gCenter = (g.left + g.right) / 2;
  const column = columns.find((c) => gCenter >= c[0] && gCenter <= c[1]) ?? localColumnBand(glyphs, g);
  const columnGlyphs = glyphs.filter((q) => {
    const c = (q.left + q.right) / 2;
    return c >= column[0] && c <= column[1];
  });
  const lines = groupLines(columnGlyphs).sort((a, b) => a.top - b.top);

  let inBandLine: Line | null = null;
  let aboveLine: Line | null = null;
  let belowLine: Line | null = null;
  for (const line of lines) {
    if (y >= line.top && y <= line.bottom) inBandLine = line;
    else if (line.bottom < y) {
      if (!aboveLine || line.bottom > aboveLine.bottom) aboveLine = line;
    } else if (line.top > y && (!belowLine || line.top < belowLine.top)) belowLine = line;
  }

  return {
    originY: y,
    inBand: inBandLine ? nearestCharInLine(inBandLine, x, rangeRectsOf) : null,
    aboveEnd: aboveLine ? lineEnd(aboveLine) : null,
    belowStart: belowLine ? lineStart(belowLine) : null,
  };
}
