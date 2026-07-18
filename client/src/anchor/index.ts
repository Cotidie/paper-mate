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

import type { Rect, Point } from "@/api/client";

/**
 * The page box the anchor service normalizes against: logical page dimensions
 * in CSS px at scale 1.0 (CropBox + `/Rotate` baked in). The render layer's
 * `getPageBox` returns a structurally identical shape — the VALUE flows down
 * from render at runtime — but the anchor layer owns this TYPE so it never
 * imports upward from `render/` (AD-9 layering).
 */
export interface PageBox {
  width: number;
  height: number;
}

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
  // Clamp to [0,1]: a text-selection client rect can overshoot the page card by
  // a sub-pixel (anti-aliasing, glyph descenders), and AD-4 defines the
  // normalized anchor as [0,1] fractions of the page. Out-of-page marks are not
  // a valid case in Story 2.2 (selection is over the page text layer).
  return {
    x0: w > 0 ? clamp01(c.x0 / w) : 0,
    y0: h > 0 ? clamp01(c.y0 / h) : 0,
    x1: w > 0 ? clamp01(c.x1 / w) : 0,
    y1: h > 0 ? clamp01(c.y1 / h) : 0,
  };
}

/** Clamp a fraction to the `[0,1]` page range. */
function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** A point in page-card-local CSS px (top-left origin), pre-normalization — the
 *  point twin of `LocalRect`, for pen freehand strokes. */
export interface LocalPoint {
  x: number;
  y: number;
}

/**
 * Normalize a card-local CSS-px point to a `[0,1]` `Point` fraction of the page
 * box (AD-4) — the point twin of `normalizeRect`, for pen strokes. Divide by
 * `box * scale` so the stored point is scale-independent; clamp to `[0,1]` so a
 * stray point dragged off the card edge stays on the page (a pen stroke binds to
 * the page its `pointerdown` landed on, single-page per AD-5).
 */
export function normalizePoint(local: LocalPoint, box: PageBox, scale: number): Point {
  const w = box.width * scale;
  const h = box.height * scale;
  return {
    x: w > 0 ? clamp01(local.x / w) : 0,
    y: h > 0 ? clamp01(local.y / h) : 0,
  };
}

/**
 * Denormalize a stored `Point` back to a card-local screen point at the current
 * `scale` (AD-4, NFR-3) — the inverse of `normalizePoint`. Multiply the fractions
 * by `box * scale`; called on every scale change so a pen stroke re-renders at its
 * exact PDF location and rides the zoom.
 */
export function denormalizePoint(point: Point, box: PageBox, scale: number): LocalPoint {
  return {
    x: point.x * box.width * scale,
    y: point.y * box.height * scale,
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

// ── Edit geometry (Story 3.1): move/resize transforms on stored normalized
//    anchors. Operate in [0,1] page-fraction space (the stored anchor space), so
//    they are scale-independent and the mark rides zoom unchanged (NFR-3). The
//    edit gesture converts a screen-px drag delta to a normalized delta via the
//    same `box * scale` the projection uses, then calls these. kind=text marks are
//    NOT moved/resized here (that desyncs `anchor.text`; Story 3.8 re-resolves the
//    run instead) — these serve kind=rect (memo/region/comment-pin) + kind=path (pen).

/**
 * Shift a normalized rect by (dx, dy) page fractions, PRESERVING its size: the
 * DELTA is clamped (not the corners) so a move stops at the page edge without the
 * rect shrinking. Story 3.1 move for kind=rect marks. Assumes a canonical rect.
 */
export function translateRect(rect: Rect, dx: number, dy: number): Rect {
  const cdx = Math.max(-rect.x0, Math.min(1 - rect.x1, dx));
  const cdy = Math.max(-rect.y0, Math.min(1 - rect.y1, dy));
  return { x0: rect.x0 + cdx, y0: rect.y0 + cdy, x1: rect.x1 + cdx, y1: rect.y1 + cdy };
}

/**
 * Shift every normalized point by (dx, dy), PRESERVING the stroke shape: the
 * delta is clamped against the stroke's bounding box so the whole stroke stays
 * on-page (clamping each point independently would distort it). Story 3.1 move
 * for kind=path marks (pen).
 */
export function translatePoints(points: Point[], dx: number, dy: number): Point[] {
  if (points.length === 0) return [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const cdx = Math.max(-minX, Math.min(1 - maxX, dx));
  const cdy = Math.max(-minY, Math.min(1 - maxY, dy));
  return points.map((p) => ({ x: p.x + cdx, y: p.y + cdy }));
}

/**
 * The normalized bounding box of a pen stroke's points (min/max corners), or a
 * zero rect for no points. Story 3.1: the edit frame positions a pen's handles on
 * this box, and the resize gesture scales the points about its opposite corner.
 */
export function pointsBounds(points: Point[]): Rect {
  if (points.length === 0) return { x0: 0, y0: 0, x1: 0, y1: 0 };
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of points) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x0, y0, x1, y1 };
}

/**
 * Whether two normalized (canonical) rects overlap at all (touching edges do not
 * count). Pure AABB test, no clamping/mutation. Box-select's marquee hit-test
 * (a mark counts as caught if the drag rect overlaps ANY of its geometry) is the
 * only caller today.
 */
export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
}

/** A rect's corner handle (north/south + west/east). */
export type RectCorner = "nw" | "ne" | "sw" | "se";

/**
 * Resize a normalized rect by dragging one CORNER by (dx, dy) page fractions,
 * then `canonicalize` (so a drag past the opposite edge flips cleanly) and clamp
 * to [0,1]. Story 3.1 free corner-resize for kind=rect marks (the memo priority).
 */
export function resizeRectCorner(rect: Rect, corner: RectCorner, dx: number, dy: number): Rect {
  let { x0, y0, x1, y1 } = rect;
  if (corner === "nw") {
    x0 += dx;
    y0 += dy;
  } else if (corner === "ne") {
    x1 += dx;
    y0 += dy;
  } else if (corner === "sw") {
    x0 += dx;
    y1 += dy;
  } else {
    x1 += dx;
    y1 += dy;
  }
  const c = canonicalize(x0, y0, x1, y1);
  return { x0: clamp01(c.x0), y0: clamp01(c.y0), x1: clamp01(c.x1), y1: clamp01(c.y1) };
}

/**
 * Scale every normalized point about an origin (ox, oy) by (sx, sy), clamped to
 * [0,1]. Story 3.1 resize for kind=path marks (pen): the gesture passes the
 * opposite bbox corner as the origin and the drag-derived factors. Geometry only
 * — `stroke_width` is unchanged (Open Q2).
 */
export function scalePoints(points: Point[], sx: number, sy: number, ox: number, oy: number): Point[] {
  return points.map((p) => ({ x: clamp01(ox + (p.x - ox) * sx), y: clamp01(oy + (p.y - oy) * sy) }));
}

/**
 * A same-row horizontal gap strictly greater than this multiple of the row's
 * own height is treated as a column gutter, not inter-word/inter-run spacing
 * (Story 4.2); a gap at or below it still merges. Height-relative, NOT a
 * fixed page-width fraction: a page-width fraction is fragile across real
 * documents — live-smoke on a real two-column paper (Microsoft COCO,
 * arXiv:1405.0312) found an actual gutter of only ~2% of page width (well
 * under an earlier 3%-of-page-width threshold that missed it), while normal
 * word-spacing is a small fraction of the text's own line height regardless
 * of page width or font size. Typical academic two-column gutters run
 * roughly 1-2x line height (confirmed ~1.4x on the COCO fixture); normal
 * inter-word/inter-run gaps are well under 0.5x. Chosen with margin above the
 * former and below the latter.
 */
const GUTTER_GAP_HEIGHT_MULTIPLE = 0.5;

/**
 * Merge per-line text rects so each line is ONE band (NFR-1, anti-stacking).
 * `Range.getClientRects()` can return several overlapping fragments for the same
 * line (mixed fonts/italics, sub-pixel duplicates ~1-2px apart) — painted at the
 * highlight's reduced opacity they compound into a darker, thicker band. Cluster
 * rects into rows by vertical overlap (>50% of the smaller height, so genuinely
 * separate lines — which only touch by a few px — stay separate) AND
 * horizontal contiguity (Story 4.2: a same-row rect separated by a column
 * gutter starts its own row rather than bridging across it), and union each
 * row into a single rect. Operates on canonical normalized rects.
 */
export function mergeRects(rects: Rect[]): Rect[] {
  const rows: Rect[] = [];
  for (const r of rects) {
    const h = r.y1 - r.y0;
    const row = rows.find((x) => {
      const rowH = x.y1 - x.y0;
      const minH = Math.min(rowH, h);
      const overlap = Math.max(0, Math.min(x.y1, r.y1) - Math.max(x.y0, r.y0));
      if (overlap <= 0.5 * minH) return false;
      // Horizontal gap between the two rects' x-extents (negative/zero when
      // overlapping or touching). Checked INSIDE the predicate so `find` skips
      // a gutter-separated row and keeps scanning for the rect's own column's
      // row, rather than matching the first vertically-overlapping row and
      // rejecting it (which would strand every same-column fragment after the
      // first as its own singleton row). Height-relative (not a page-width
      // fraction, see GUTTER_GAP_HEIGHT_MULTIPLE) so it works across page
      // widths and font sizes.
      const gap = Math.max(r.x0 - x.x1, x.x0 - r.x1);
      return gap <= GUTTER_GAP_HEIGHT_MULTIPLE * minH;
    });
    if (row) {
      row.x0 = Math.min(row.x0, r.x0);
      row.y0 = Math.min(row.y0, r.y0);
      row.x1 = Math.max(row.x1, r.x1);
      row.y1 = Math.max(row.y1, r.y1);
    } else {
      rows.push({ ...r });
    }
  }
  return rows;
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

/** CARD-LOCAL geometry for the CREATE quick-box while a text-drag selection is
 *  pending (not yet a persisted `Annotation`): one preview rect per selected
 *  line per page, plus where the popup anchors. The caller adds each page's
 *  LIVE `getBoundingClientRect()` viewport offset to get final screen
 *  positions (untestable in jsdom — that step is live-smoke covered, not
 *  unit-tested; this function is the DOM-free part). */
export interface PendingSelectionGeometry {
  /** Per-selection-page CARD-LOCAL preview rects, in selection order. */
  pages: { pageIndex: number; rects: ScreenRect[] }[];
  /** The popup's CARD-LOCAL anchor point (below the FIRST page's rects — a
   *  multi-page selection's popup always tracks its first page, mirroring
   *  `createTextTool`'s `select(created[0].id)` for a persisted mark) + which
   *  page it's relative to. */
  anchor: { pageIndex: number; point: { x: number; y: number } };
}

/**
 * Re-derive the CREATE quick-box's geometry from a pending text-drag
 * `selection` at the CURRENT `scale` — the fix for the selection "resetting"
 * on zoom/scroll (Story 4.x): previously the popup was pinned to a frozen
 * viewport point captured once at drag-release, which went stale on zoom and
 * was dismissed outright on any scroll. Denormalizing the STORED (already
 * scale-independent) selection rects here, on demand, lets the caller re-run
 * this on every scroll/resize/zoom to keep the popup + a preview highlight
 * glued to the actual text (AD-4, same pattern `useSelection.ts`'s
 * `selectionPoint()` uses for a persisted mark's selection quick-box).
 * `boxOf` resolves a page's scale-1.0 box (`null` if that page isn't
 * currently mounted); returns `null` for an empty selection (the click-to-
 * place Comment/Memo picker has no rects — the caller anchors that case from
 * the click point directly) or if the first page's box isn't available.
 */
export function pendingSelectionGeometry(
  selection: PageSelection[],
  boxOf: (pageIndex: number) => PageBox | null,
  scale: number,
  gap: number,
): PendingSelectionGeometry | null {
  if (selection.length === 0) return null;
  const pages = selection.map((ps) => {
    const box = boxOf(ps.page_index);
    const rects = box ? ps.rects.map((r) => denormalizeRect(r, box, scale)) : [];
    return { pageIndex: ps.page_index, rects };
  });
  const firstPage = pages[0];
  if (firstPage.rects.length === 0) return null;
  const first = firstPage.rects[0];
  let bottom = first.top + first.height;
  for (const r of firstPage.rects) bottom = Math.max(bottom, r.top + r.height);
  return {
    pages,
    anchor: { pageIndex: firstPage.pageIndex, point: { x: first.left, y: bottom + gap } },
  };
}

/**
 * Clip a viewport-space preview rect to the reader's visible vertical band.
 * The CREATE preview is `position: fixed` (Story 4.x — it must span two page
 * cards for a cross-page selection), which, unlike the card-scoped
 * AnnotationLayer marks, escapes `.pdf-canvas`'s scroll-clipping ancestor
 * entirely. Without this, a selection row whose true position has scrolled
 * above/below the visible reader viewport still paints — on top of the
 * top-bar chrome (Story 4.2 bug: a same-page column-2 row scrolled behind the
 * top-bar bled through above it). Returns `null` when nothing of the rect
 * remains visible. DOM-free, unit-testable.
 */
export function clipRectToViewport(rect: ScreenRect, viewport: { top: number; bottom: number }): ScreenRect | null {
  const top = Math.max(rect.top, viewport.top);
  const bottom = Math.min(rect.top + rect.height, viewport.bottom);
  if (bottom <= top) return null;
  return { left: rect.left, top, width: rect.width, height: bottom - top };
}

/**
 * Offset each page's CARD-LOCAL preview rects (`pendingSelectionGeometry`'s
 * `pages`) by that page's LIVE `getBoundingClientRect()` into `position:
 * fixed` viewport pixels, clipped to the reader's visible vertical band. The
 * DOM-touching half of the CREATE quick-box preview pass (`pendingSelectionGeometry`
 * above is the DOM-free half) — factored out so the post-release pending
 * preview (`useCreateQuickBox`) and the pre-release live-drag preview
 * (`useLiveSelectionPreview`) paint from the exact same geometry pass instead
 * of each hand-rolling their own (Story 10.1, AC-1: one uniform tint across
 * both phases, no release "thickening").
 */
export function viewportRectsFromPages(
  pages: { pageIndex: number; rects: ScreenRect[] }[],
  cardOf: (pageIndex: number) => PageCardRef | null,
  viewportBand: { top: number; bottom: number } | null,
): ScreenRect[] {
  return pages.flatMap(({ pageIndex, rects }) => {
    const card = cardOf(pageIndex);
    if (!card) return [];
    const cardRect = card.cardEl.getBoundingClientRect();
    return rects.flatMap((r) => {
      const screen = { left: cardRect.left + r.left, top: cardRect.top + r.top, width: r.width, height: r.height };
      const clipped = viewportBand ? clipRectToViewport(screen, viewportBand) : screen;
      return clipped ? [clipped] : [];
    });
  });
}

/**
 * The on-screen rects of the TEXT a `range` selects — one set of line boxes per
 * text node it covers, EXCLUDING element border boxes.
 *
 * Why not `range.getClientRects()` directly: per the DOM spec it also returns
 * the border boxes of elements FULLY enclosed by the range, not only text. A
 * selection that spans two page cards fully encloses the intervening page block
 * elements (canvas / page-surface / text layer), so their full-PAGE rects leak
 * into the result and, once normalized + clamped, paint as full-page highlights
 * (the cross-page bug). Decomposing the range into per-text-node sub-ranges
 * measures only glyph line boxes — never an element box — so the result is the
 * actual selected text on each page.
 *
 * Never falls back to the whole range's rects: that is exactly the leak this
 * exists to prevent (the constraint is "selection geometry MUST measure text
 * nodes, never the whole range"). A range with no text nodes yields `[]` → no
 * highlight, which is correct (a text highlight needs text). A real text
 * selection always exposes text nodes.
 *
 * DOM-touching (jsdom zeroes real client rects); the per-node decomposition is
 * unit-tested by injecting `rectsOf` (the rect reader) so the test never has to
 * mutate the global `Range` prototype.
 */
export function collectTextRects(
  range: Range,
  rectsOf: (r: Range) => ArrayLike<DOMRect> = (r) => r.getClientRects(),
): DOMRect[] {
  const out: DOMRect[] = [];
  const root = range.commonAncestorContainer;
  const doc = root.ownerDocument ?? document;
  const measure = (node: Node) => {
    if (node.nodeType !== Node.TEXT_NODE || !range.intersectsNode(node)) return;
    const sub = doc.createRange();
    sub.selectNodeContents(node);
    // Clip the first/last text node to the selection's offsets; interior text
    // nodes are fully selected.
    if (node === range.startContainer) sub.setStart(node, range.startOffset);
    if (node === range.endContainer) sub.setEnd(node, range.endOffset);
    if (sub.collapsed) return;
    for (const cr of Array.from(rectsOf(sub))) out.push(cr);
  };
  if (root.nodeType === Node.TEXT_NODE) {
    measure(root);
  } else {
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) measure(n);
  }
  return out;
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
 * math underneath (`normalizeRect`, `pickPage`) carries the unit tests. The
 * `rectsOf` reader (how a text-node sub-range yields client rects) is injectable
 * so component tests can drive it without real layout — production uses the real
 * `getClientRects`.
 */
export function rectsFromSelection(
  selection: Selection | null,
  pages: PageCardRef[],
  scale: number,
  rectsOf: (r: Range) => ArrayLike<DOMRect> = (r) => r.getClientRects(),
): PageSelection[] {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return [];
  const cardBoxes: ClientBox[] = pages.map((p) => p.cardEl.getBoundingClientRect());
  // Accumulate normalized rects per page index, in card order.
  const byPage = new Map<number, Rect[]>();

  for (let r = 0; r < selection.rangeCount; r++) {
    const range = selection.getRangeAt(r);
    // Measure the selected TEXT (per text node), NOT the whole range: a
    // cross-page range encloses page block elements whose full-page border boxes
    // would otherwise leak in and paint as full-page highlights (see
    // `collectTextRects`).
    for (const cr of collectTextRects(range, rectsOf)) {
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
    // Merge per-line so each line is one band (no compounding overlap, AC #3).
    if (rects && rects.length > 0) {
      out.push({ page_index: page.pageIndex, rects: mergeRects(rects), text });
    }
  }
  return out;
}
