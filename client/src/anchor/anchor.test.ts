import { describe, it, expect } from "vitest";
import {
  canonicalize,
  normalizeRect,
  denormalizeRect,
  normalizePoint,
  denormalizePoint,
  pickPage,
  mergeRects,
  collectTextRects,
  translateRect,
  translatePoints,
  resizeRectCorner,
  scalePoints,
  pointsBounds,
  rectsIntersect,
  pendingSelectionGeometry,
  clipRectToViewport,
  viewportRectsFromPages,
  type PageBox,
  type PageSelection,
  type PageCardRef,
} from "./index";

const box: PageBox = { width: 600, height: 800 };

describe("canonicalize", () => {
  it("orders a negative drag so x0<=x1, y0<=y1", () => {
    expect(canonicalize(100, 200, 40, 50)).toEqual({ x0: 40, y0: 50, x1: 100, y1: 200 });
  });
  it("leaves an already-canonical rect unchanged", () => {
    expect(canonicalize(10, 20, 30, 40)).toEqual({ x0: 10, y0: 20, x1: 30, y1: 40 });
  });
});

describe("normalizeRect", () => {
  it("normalizes a card-local rect to [0,1] fractions of box*scale", () => {
    // At scale 1 the card is 600x800; a 0..300 x, 0..400 y rect → 0.5, 0.5.
    expect(normalizeRect({ x0: 0, y0: 0, x1: 300, y1: 400 }, box, 1)).toEqual({
      x0: 0,
      y0: 0,
      x1: 0.5,
      y1: 0.5,
    });
  });
  it("removes scale so the same PDF region normalizes identically at any zoom", () => {
    const at1 = normalizeRect({ x0: 60, y0: 80, x1: 300, y1: 400 }, box, 1);
    // Same PDF region at 2x is twice the pixels; must normalize to the same fractions.
    const at2 = normalizeRect({ x0: 120, y0: 160, x1: 600, y1: 800 }, box, 2);
    expect(at2).toEqual(at1);
  });
  it("canonicalizes a negative drag before normalizing", () => {
    expect(normalizeRect({ x0: 300, y0: 400, x1: 0, y1: 0 }, box, 1)).toEqual({
      x0: 0,
      y0: 0,
      x1: 0.5,
      y1: 0.5,
    });
  });
  it("clamps overshoot back into [0,1] (sub-pixel selection past the card edge)", () => {
    // A rect a few px past the 600x800 card → fractions just over 1 → clamped.
    expect(normalizeRect({ x0: -2, y0: -3, x1: 606, y1: 808 }, box, 1)).toEqual({
      x0: 0,
      y0: 0,
      x1: 1,
      y1: 1,
    });
  });

  it("guards divide-by-zero on a zero-size box", () => {
    expect(normalizeRect({ x0: 1, y0: 1, x1: 2, y1: 2 }, { width: 0, height: 0 }, 1)).toEqual({
      x0: 0,
      y0: 0,
      x1: 0,
      y1: 0,
    });
  });
});

describe("normalize ↔ denormalize round-trip (AC-6 anchor fidelity)", () => {
  it("denormalize is the inverse of normalize at the same scale", () => {
    const local = { x0: 60, y0: 80, x1: 360, y1: 480 };
    const norm = normalizeRect(local, box, 1);
    expect(denormalizeRect(norm, box, 1)).toEqual({ left: 60, top: 80, width: 300, height: 400 });
  });
  it("re-derives a larger screen box when scale grows (zoom)", () => {
    const norm = normalizeRect({ x0: 60, y0: 80, x1: 360, y1: 480 }, box, 1);
    const at1 = denormalizeRect(norm, box, 1);
    const at2 = denormalizeRect(norm, box, 2);
    // Position + size scale exactly with zoom — the anchor stays put in PDF space.
    expect(at2).toEqual({ left: at1.left * 2, top: at1.top * 2, width: at1.width * 2, height: at1.height * 2 });
  });
});

describe("normalizePoint / denormalizePoint (pen freehand points, AD-4)", () => {
  it("normalizes a card-local point to [0,1] fractions of box*scale", () => {
    expect(normalizePoint({ x: 300, y: 400 }, box, 1)).toEqual({ x: 0.5, y: 0.5 });
  });

  it("removes scale so the same PDF point normalizes identically at any zoom", () => {
    const at1 = normalizePoint({ x: 150, y: 200 }, box, 1);
    const at2 = normalizePoint({ x: 300, y: 400 }, box, 2);
    expect(at1).toEqual(at2);
  });

  it("clamps an off-card point back into [0,1] (stroke binds to its start page)", () => {
    expect(normalizePoint({ x: -50, y: 1200 }, box, 1)).toEqual({ x: 0, y: 1 });
  });

  it("guards divide-by-zero on a zero-size box", () => {
    expect(normalizePoint({ x: 5, y: 5 }, { width: 0, height: 0 }, 1)).toEqual({ x: 0, y: 0 });
  });

  it("denormalize is the inverse of normalize at the same scale", () => {
    const norm = normalizePoint({ x: 150, y: 240 }, box, 1);
    expect(denormalizePoint(norm, box, 1)).toEqual({ x: 150, y: 240 });
  });

  it("re-derives a larger screen point when scale grows (zoom, NFR-3)", () => {
    const norm = normalizePoint({ x: 150, y: 240 }, box, 1);
    const at2 = denormalizePoint(norm, box, 2);
    expect(at2).toEqual({ x: 300, y: 480 });
  });
});

describe("mergeRects (per-line merge, anti-stacking #3)", () => {
  it("merges near-duplicate rects on the same line into one band", () => {
    // Two ~sub-pixel-apart rects for one line (the getClientRects doubling).
    const merged = mergeRects([
      { x0: 0.1, y0: 0.20, x1: 0.8, y1: 0.23 },
      { x0: 0.1, y0: 0.202, x1: 0.8, y1: 0.232 },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toEqual({ x0: 0.1, y0: 0.2, x1: 0.8, y1: 0.232 });
  });

  it("keeps genuinely separate lines separate (small touch, not >50% overlap)", () => {
    // Adjacent lines whose bands touch by a sliver must NOT fuse.
    const merged = mergeRects([
      { x0: 0.1, y0: 0.20, x1: 0.8, y1: 0.23 },
      { x0: 0.1, y0: 0.229, x1: 0.8, y1: 0.259 },
    ]);
    expect(merged).toHaveLength(2);
  });

  it("unions the horizontal extent of same-line fragments", () => {
    const merged = mergeRects([
      { x0: 0.1, y0: 0.2, x1: 0.4, y1: 0.23 },
      { x0: 0.35, y0: 0.2, x1: 0.9, y1: 0.23 },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toEqual({ x0: 0.1, y0: 0.2, x1: 0.9, y1: 0.23 });
  });
});

describe("mergeRects (column-aware gutter split, Story 4.2 AC-1)", () => {
  it("does NOT union same-line rects separated by a gutter-scale horizontal gap", () => {
    const merged = mergeRects([
      { x0: 0.1, y0: 0.2, x1: 0.45, y1: 0.23 },
      { x0: 0.55, y0: 0.2, x1: 0.9, y1: 0.23 },
    ]);
    expect(merged).toHaveLength(2);
  });

  it("still unions same-line rects separated by normal inter-run spacing (below gutter threshold)", () => {
    const merged = mergeRects([
      { x0: 0.1, y0: 0.2, x1: 0.3, y1: 0.23 },
      { x0: 0.31, y0: 0.2, x1: 0.5, y1: 0.23 },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toEqual({ x0: 0.1, y0: 0.2, x1: 0.5, y1: 0.23 });
  });

  it("merges a gap just at/under 0.5x row height, splits a gap just over it (boundary is inclusive, not exclusive)", () => {
    const underThreshold = mergeRects([
      { x0: 0.1, y0: 0.2, x1: 0.3, y1: 0.23 }, // height 0.03, threshold gap = 0.015
      { x0: 0.3145, y0: 0.2, x1: 0.5, y1: 0.23 }, // gap 0.0145, just under
    ]);
    expect(underThreshold).toHaveLength(1);

    const overThreshold = mergeRects([
      { x0: 0.1, y0: 0.2, x1: 0.3, y1: 0.23 },
      { x0: 0.3155, y0: 0.2, x1: 0.5, y1: 0.23 }, // gap 0.0155, just over
    ]);
    expect(overThreshold).toHaveLength(2);
  });

  it("splits a narrow real-world gutter that is small relative to page width but wide relative to line height (regression: Microsoft COCO paper, arXiv:1405.0312)", () => {
    // Reproduces the exact geometry found via live smoke on a real two-column
    // paper: an actual column gutter of only ~2% of page width (narrower than
    // the earlier fixed 3%-of-page-width threshold this replaced, which missed
    // it and bridged the highlight across both columns) but ~1.4x the row's
    // own height — the height-relative check must still split it.
    const merged = mergeRects([
      { x0: 0.0805, y0: 0.6886, x1: 0.4909, y1: 0.7027 }, // left column line (height ~0.0141)
      { x0: 0.5098, y0: 0.6886, x1: 0.9201, y1: 0.7027 }, // right column line, gap ~0.019 (~1.35x height)
    ]);
    expect(merged).toHaveLength(2);
  });

  it("still unions a same-line gap that is small relative to BOTH page width and line height (not just page width)", () => {
    // A fixed page-width-fraction threshold would treat this identically to
    // the regression case above (same absolute gap); the height-relative
    // check must tell them apart because this gap is small relative to a
    // much TALLER line.
    const merged = mergeRects([
      { x0: 0.0805, y0: 0.6886, x1: 0.4909, y1: 0.7886 }, // tall row (height 0.1)
      { x0: 0.5098, y0: 0.6886, x1: 0.9201, y1: 0.7886 }, // gap ~0.019 (~0.19x this row's height)
    ]);
    expect(merged).toHaveLength(1);
  });

  it("merges a column's own fragments with each other, not with the other column's row processed earlier (ordering trap)", () => {
    // Right column's first fragment is processed BEFORE the left column's
    // fragment, so it occupies rows[0]. A naive "match first vertically-
    // overlapping row, then reject the union" implementation would wrongly
    // bridge the left fragment into rows[0] (it only rejects AFTER matching,
    // it doesn't keep scanning). The gap check must live inside the `find`
    // predicate so `find` skips rows[0] and creates a genuine new row for the
    // left fragment, leaving rows[0] free to correctly absorb the right
    // column's second fragment.
    const merged = mergeRects([
      { x0: 0.55, y0: 0.2, x1: 0.7, y1: 0.23 }, // right col, fragment 1 (processed first)
      { x0: 0.1, y0: 0.2, x1: 0.2, y1: 0.23 }, // left col, single fragment
      { x0: 0.71, y0: 0.2, x1: 0.85, y1: 0.23 }, // right col, fragment 2 (must join fragment 1)
    ]);
    expect(merged).toHaveLength(2);
    const right = merged.find((r) => r.x0 === 0.55);
    const left = merged.find((r) => r.x0 === 0.1);
    expect(right).toEqual({ x0: 0.55, y0: 0.2, x1: 0.85, y1: 0.23 });
    expect(left).toEqual({ x0: 0.1, y0: 0.2, x1: 0.2, y1: 0.23 });
  });

  it("returns bands in stable, first-appearance (reading) order", () => {
    const merged = mergeRects([
      { x0: 0.1, y0: 0.2, x1: 0.2, y1: 0.23 }, // left col
      { x0: 0.21, y0: 0.2, x1: 0.35, y1: 0.23 }, // left col, merges into band 0
      { x0: 0.55, y0: 0.2, x1: 0.7, y1: 0.23 }, // right col
      { x0: 0.71, y0: 0.2, x1: 0.85, y1: 0.23 }, // right col, merges into band 1
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toEqual({ x0: 0.1, y0: 0.2, x1: 0.35, y1: 0.23 });
    expect(merged[1]).toEqual({ x0: 0.55, y0: 0.2, x1: 0.85, y1: 0.23 });
  });
});

describe("pickPage (two-page split logic, AC-5)", () => {
  const cards = [
    { left: 0, top: 0, right: 600, bottom: 800 },
    { left: 0, top: 820, right: 600, bottom: 1620 },
  ];
  it("assigns a rect to the card containing its midpoint", () => {
    expect(pickPage({ left: 10, top: 10, right: 50, bottom: 30 }, cards)).toBe(0);
    expect(pickPage({ left: 10, top: 900, right: 50, bottom: 920 }, cards)).toBe(1);
  });
  it("returns -1 for a rect in the gutter between cards", () => {
    expect(pickPage({ left: 10, top: 805, right: 50, bottom: 815 }, cards)).toBe(-1);
  });
  it("splits a two-card selection: top rects → card 0, bottom rects → card 1", () => {
    const rects = [
      { left: 10, top: 700, right: 200, bottom: 720 },
      { left: 10, top: 840, right: 200, bottom: 860 },
    ];
    const assigned = rects.map((r) => pickPage(r, cards));
    expect(assigned).toEqual([0, 1]);
  });
});

describe("collectTextRects (cross-page selection bug — Range.getClientRects leaks element boxes)", () => {
  const LINE = { width: 40, height: 16, left: 0, top: 0, right: 40, bottom: 16, x: 0, y: 0 } as DOMRect;
  const PAGE = { width: 960, height: 1240, left: 0, top: 0, right: 960, bottom: 1240, x: 0, y: 0 } as DOMRect;

  // Inject the rect reader (no global Range mutation): mimic the browser where a
  // single-text-node sub-range yields one line rect, while a MULTI-node range
  // (the whole cross-page selection) ALSO yields the enclosed element's
  // full-page border box — the exact source of the cross-page bug.
  const rectsOf = (r: Range): DOMRect[] => {
    const single = r.startContainer === r.endContainer && r.startContainer.nodeType === Node.TEXT_NODE;
    return single ? [LINE] : [LINE, PAGE];
  };

  // A fully-enclosed element (page card / canvas / text layer) contributes its
  // border box to a whole-range getClientRects(); a cross-page selection
  // encloses such elements, so those FULL-PAGE rects must NOT become highlight
  // rects. collectTextRects measures TEXT NODES only, so they never enter.
  it("returns only text-line rects, never the enclosed element border box", () => {
    const container = document.createElement("div");
    const s1 = document.createElement("span");
    s1.appendChild(document.createTextNode("hello"));
    const s2 = document.createElement("span");
    s2.appendChild(document.createTextNode("world"));
    container.append(s1, s2);
    document.body.appendChild(container);

    const range = document.createRange();
    range.setStart(s1.firstChild as Text, 0);
    range.setEnd(s2.firstChild as Text, 5);

    // The OLD whole-range approach would include the full-page box (documents the bug).
    expect(rectsOf(range).some((r) => r.height > 100)).toBe(true);

    // collectTextRects decomposes into per-text-node sub-ranges → text lines only.
    const rects = collectTextRects(range, rectsOf);
    expect(rects.length).toBe(2);
    expect(rects.every((r) => r.height <= 16)).toBe(true);
    expect(rects.some((r) => r.height > 100)).toBe(false);

    document.body.removeChild(container);
  });

  it("returns [] (never the whole-range rects) when the range exposes no text nodes", () => {
    // A range whose content is an element with no text node → no text to measure.
    const el = document.createElement("div");
    document.body.appendChild(el);
    const range = document.createRange();
    range.selectNode(el);
    // Even if the (whole-range) reader would report a box, collectTextRects must
    // NOT use it — the cross-page leak is exactly the whole-range rects.
    const wholeRangeReader = () => [PAGE];
    const rects = collectTextRects(range, wholeRangeReader);
    expect(rects).toHaveLength(0);
    document.body.removeChild(el);
  });
});

// Binary-clean fractions (0.25/0.125/0.5/0.75) keep `toEqual` exact: the helpers
// do pure float math (no rounding), so 0.05-style increments would trip float drift.
describe("translateRect (move a rect mark, Story 3.1)", () => {
  it("shifts both corners by the delta, preserving size", () => {
    expect(translateRect({ x0: 0.25, y0: 0.25, x1: 0.5, y1: 0.5 }, 0.125, 0.125)).toEqual({
      x0: 0.375,
      y0: 0.375,
      x1: 0.625,
      y1: 0.625,
    });
  });
  it("clamps the delta (not the corners) at the page edge so size is preserved", () => {
    // dx wants +0.5 but x1 is 0.75, so dx is clamped to 0.25; width stays 0.25.
    expect(translateRect({ x0: 0.5, y0: 0.5, x1: 0.75, y1: 0.75 }, 0.5, 0.5)).toEqual({
      x0: 0.75,
      y0: 0.75,
      x1: 1,
      y1: 1,
    });
  });
  it("clamps a negative delta at the top-left edge", () => {
    expect(translateRect({ x0: 0.25, y0: 0.25, x1: 0.5, y1: 0.5 }, -0.5, -0.5)).toEqual({
      x0: 0,
      y0: 0,
      x1: 0.25,
      y1: 0.25,
    });
  });
});

describe("translatePoints (move a pen stroke, Story 3.1)", () => {
  it("shifts every point by the delta, preserving the stroke shape", () => {
    expect(
      translatePoints([{ x: 0.25, y: 0.25 }, { x: 0.5, y: 0.5 }], 0.125, 0),
    ).toEqual([{ x: 0.375, y: 0.25 }, { x: 0.625, y: 0.5 }]);
  });
  it("clamps the delta by the stroke bounding box so the whole stroke stays on-page", () => {
    // maxX is 0.5; +0.5 keeps it at 1.0, the page edge — applied to ALL points.
    expect(
      translatePoints([{ x: 0.25, y: 0.5 }, { x: 0.5, y: 0.5 }], 0.5, 0),
    ).toEqual([{ x: 0.75, y: 0.5 }, { x: 1, y: 0.5 }]);
  });
  it("returns [] for no points", () => {
    expect(translatePoints([], 0.125, 0.125)).toEqual([]);
  });
});

describe("resizeRectCorner (free corner-drag resize, Story 3.1)", () => {
  const rect = { x0: 0.25, y0: 0.25, x1: 0.5, y1: 0.5 };
  it("moves the SE corner, growing the rect", () => {
    expect(resizeRectCorner(rect, "se", 0.125, 0.125)).toEqual({ x0: 0.25, y0: 0.25, x1: 0.625, y1: 0.625 });
  });
  it("moves the NW corner, shrinking from the top-left", () => {
    expect(resizeRectCorner(rect, "nw", 0.125, 0.125)).toEqual({ x0: 0.375, y0: 0.375, x1: 0.5, y1: 0.5 });
  });
  it("moves the NE corner (x1, y0)", () => {
    expect(resizeRectCorner(rect, "ne", 0.125, -0.125)).toEqual({ x0: 0.25, y0: 0.125, x1: 0.625, y1: 0.5 });
  });
  it("canonicalizes when a corner is dragged past the opposite edge", () => {
    // SE dragged far up-left flips so the result stays canonical (x0<=x1, y0<=y1).
    expect(resizeRectCorner(rect, "se", -0.5, -0.5)).toEqual({ x0: 0, y0: 0, x1: 0.25, y1: 0.25 });
  });
  it("clamps a corner to the page bounds", () => {
    expect(resizeRectCorner(rect, "se", 0.75, 0.75)).toEqual({ x0: 0.25, y0: 0.25, x1: 1, y1: 1 });
  });
});

describe("resizeRectCorner min floor (Story 10.2, memo minimum size)", () => {
  const rect = { x0: 0.25, y0: 0.25, x1: 0.5, y1: 0.5 };
  const min = { w: 0.1, h: 0.1 };

  it("floors an SE drag that would otherwise flip/collapse the rect: the fixed NW corner stays put, the moving SE corner stops at the min distance from it", () => {
    expect(resizeRectCorner(rect, "se", -0.5, -0.5, min)).toEqual({ x0: 0.25, y0: 0.25, x1: 0.35, y1: 0.35 });
  });

  it("floors an NW drag: the fixed SE corner stays put, the moving NW corner stops at the min distance from it", () => {
    expect(resizeRectCorner(rect, "nw", 0.5, 0.5, min)).toEqual({ x0: 0.4, y0: 0.4, x1: 0.5, y1: 0.5 });
  });

  it("floors an NE drag independently per axis: the fixed x0/y1 stay put, the moving x1/y0 each stop at their own min", () => {
    expect(resizeRectCorner(rect, "ne", -0.3, 0.3, min)).toEqual({ x0: 0.25, y0: 0.4, x1: 0.35, y1: 0.5 });
  });

  it("floors an SW drag independently per axis: the fixed x1/y0 stay put, the moving x0/y1 each stop at their own min", () => {
    expect(resizeRectCorner(rect, "sw", 0.3, -0.3, min)).toEqual({ x0: 0.4, y0: 0.25, x1: 0.5, y1: 0.35 });
  });

  it("a resize that stays above the min is unaffected by the floor (identical to the no-min result)", () => {
    expect(resizeRectCorner(rect, "se", 0.125, 0.125, min)).toEqual(resizeRectCorner(rect, "se", 0.125, 0.125));
  });

  it("no min (region rects, undefined) behaves exactly as before — can shrink toward zero", () => {
    expect(resizeRectCorner(rect, "se", -0.5, -0.5, undefined)).toEqual(resizeRectCorner(rect, "se", -0.5, -0.5));
  });

  it("preserves the floor for a legacy rect whose fixed corner sits within `min` of the page edge (Codex review MED: clamp01 must not silently shrink below the floor)", () => {
    // Fixed corner (x0,y0) at 0.97 — within min.w (0.048) of the right/bottom
    // edge. A naive floor would push x1/y1 to 1.018, then clamp01 to 1,
    // yielding a 0.03-wide result — below the requested floor.
    const edgeRect = { x0: 0.97, y0: 0.97, x1: 0.99, y1: 0.99 };
    const result = resizeRectCorner(edgeRect, "se", -0.5, -0.5, min);
    expect(result.x1).toBe(1);
    expect(result.y1).toBe(1);
    expect(result.x1 - result.x0).toBeCloseTo(min.w, 10);
    expect(result.y1 - result.y0).toBeCloseTo(min.h, 10);
  });

  it("preserves the floor for a legacy rect whose fixed corner sits within `min` of the page's top-left edge", () => {
    // Fixed corner (x1,y1) at 0.02 — within min.h (0.032) of the top/left edge.
    const edgeRect = { x0: 0, y0: 0, x1: 0.02, y1: 0.02 };
    const result = resizeRectCorner(edgeRect, "nw", 0.5, 0.5, min);
    expect(result.x0).toBe(0);
    expect(result.y0).toBe(0);
    expect(result.x1 - result.x0).toBeCloseTo(min.w, 10);
    expect(result.y1 - result.y0).toBeCloseTo(min.h, 10);
  });
});

describe("scalePoints (resize a pen stroke about an origin, Story 3.1)", () => {
  it("scales every point about the origin corner", () => {
    expect(
      scalePoints([{ x: 0.25, y: 0.25 }, { x: 0.5, y: 0.5 }], 2, 2, 0.25, 0.25),
    ).toEqual([{ x: 0.25, y: 0.25 }, { x: 0.75, y: 0.75 }]);
  });
  it("clamps scaled points to [0,1]", () => {
    expect(scalePoints([{ x: 0.5, y: 0.5 }], 3, 3, 0, 0)).toEqual([{ x: 1, y: 1 }]);
  });
  it("returns [] for no points", () => {
    expect(scalePoints([], 2, 2, 0, 0)).toEqual([]);
  });
});

describe("pointsBounds (pen stroke bounding box, Story 3.1)", () => {
  it("returns the min/max corners of the points", () => {
    expect(pointsBounds([{ x: 0.2, y: 0.3 }, { x: 0.5, y: 0.1 }, { x: 0.4, y: 0.6 }])).toEqual({
      x0: 0.2,
      y0: 0.1,
      x1: 0.5,
      y1: 0.6,
    });
  });
  it("returns a zero rect for no points", () => {
    expect(pointsBounds([])).toEqual({ x0: 0, y0: 0, x1: 0, y1: 0 });
  });
});

describe("rectsIntersect (box-select marquee hit-test, user feature request)", () => {
  it("true for two overlapping rects", () => {
    expect(rectsIntersect({ x0: 0.1, y0: 0.1, x1: 0.4, y1: 0.4 }, { x0: 0.3, y0: 0.3, x1: 0.6, y1: 0.6 })).toBe(true);
  });

  it("true when one rect fully contains the other", () => {
    expect(rectsIntersect({ x0: 0, y0: 0, x1: 1, y1: 1 }, { x0: 0.4, y0: 0.4, x1: 0.5, y1: 0.5 })).toBe(true);
  });

  it("false for disjoint rects (gap on the x axis)", () => {
    expect(rectsIntersect({ x0: 0.1, y0: 0.1, x1: 0.2, y1: 0.2 }, { x0: 0.3, y0: 0.1, x1: 0.4, y1: 0.2 })).toBe(false);
  });

  it("false for disjoint rects (gap on the y axis)", () => {
    expect(rectsIntersect({ x0: 0.1, y0: 0.1, x1: 0.2, y1: 0.2 }, { x0: 0.1, y0: 0.3, x1: 0.2, y1: 0.4 })).toBe(false);
  });

  it("false for merely TOUCHING edges (strict overlap, not inclusive)", () => {
    expect(rectsIntersect({ x0: 0, y0: 0, x1: 0.5, y1: 0.5 }, { x0: 0.5, y0: 0, x1: 1, y1: 0.5 })).toBe(false);
  });

  it("is symmetric (order of arguments does not matter)", () => {
    const a = { x0: 0.1, y0: 0.1, x1: 0.4, y1: 0.4 };
    const b = { x0: 0.3, y0: 0.3, x1: 0.6, y1: 0.6 };
    expect(rectsIntersect(a, b)).toBe(rectsIntersect(b, a));
  });
});

describe("pendingSelectionGeometry (CREATE quick-box tracking, Story 4.x — selection survives zoom/scroll)", () => {
  const boxOf = (pageIndex: number): PageBox | null => (pageIndex === 0 || pageIndex === 1 ? box : null);

  it("denormalizes a single-page selection and anchors to its bounds (no gap: Story 10.6 moved the gap into placeBesideSelection)", () => {
    const selection: PageSelection[] = [
      { page_index: 0, text: "line one", rects: [{ x0: 0, y0: 0, x1: 0.5, y1: 0.1 }] },
    ];
    const geom = pendingSelectionGeometry(selection, boxOf, 1);
    expect(geom).not.toBeNull();
    expect(geom!.pages).toEqual([{ pageIndex: 0, rects: [{ left: 0, top: 0, width: 300, height: 80 }] }]);
    expect(geom!.anchor).toEqual({ pageIndex: 0, rect: { left: 0, top: 0, right: 300, bottom: 80 } });
  });

  it("anchors to the MAX right / LOWEST bottom of multiple rects on the first page, left/top from the first rect", () => {
    const selection: PageSelection[] = [
      {
        page_index: 0,
        text: "two lines",
        rects: [
          { x0: 0.1, y0: 0, x1: 0.5, y1: 0.05 }, // left 60, right 300, bottom 40
          { x0: 0, y0: 0.1, x1: 0.4, y1: 0.2 }, // left 0, right 240, bottom 160 (the lower one)
        ],
      },
    ];
    const geom = pendingSelectionGeometry(selection, boxOf, 1);
    // left/top from the FIRST rect (60, 0); right/bottom are the MAX across both rects.
    expect(geom!.anchor).toEqual({ pageIndex: 0, rect: { left: 60, top: 0, right: 300, bottom: 160 } });
  });

  it("re-derives at double the pixels when scale doubles (scale-independent stored rects, live at any zoom)", () => {
    const selection: PageSelection[] = [
      { page_index: 0, text: "x", rects: [{ x0: 0.1, y0: 0.1, x1: 0.5, y1: 0.2 }] },
    ];
    const at1 = pendingSelectionGeometry(selection, boxOf, 1)!;
    const at2 = pendingSelectionGeometry(selection, boxOf, 2)!;
    expect(at2.pages[0].rects[0].left).toBeCloseTo(at1.pages[0].rects[0].left * 2);
    expect(at2.pages[0].rects[0].width).toBeCloseTo(at1.pages[0].rects[0].width * 2);
    // No gap term in the anchor rect any more, so every edge doubles cleanly.
    expect(at2.anchor.rect.right).toBeCloseTo(at1.anchor.rect.right * 2);
    expect(at2.anchor.rect.bottom).toBeCloseTo(at1.anchor.rect.bottom * 2);
  });

  it("anchors a multi-page selection to its FIRST page only (mirrors selecting created[0].id for a persisted mark)", () => {
    const selection: PageSelection[] = [
      { page_index: 0, text: "page 1 half", rects: [{ x0: 0, y0: 0.9, x1: 0.3, y1: 1 }] },
      { page_index: 1, text: "page 2 half", rects: [{ x0: 0, y0: 0, x1: 0.3, y1: 0.1 }] },
    ];
    const geom = pendingSelectionGeometry(selection, boxOf, 1);
    expect(geom!.anchor.pageIndex).toBe(0);
    expect(geom!.pages.map((p) => p.pageIndex)).toEqual([0, 1]);
  });

  it("returns null for an empty selection (the click-to-place case has no rects to derive from)", () => {
    expect(pendingSelectionGeometry([], boxOf, 1)).toBeNull();
  });

  it("returns null when the first page's box is unavailable (not currently mounted)", () => {
    const selection: PageSelection[] = [{ page_index: 9, text: "x", rects: [{ x0: 0, y0: 0, x1: 0.1, y1: 0.1 }] }];
    expect(pendingSelectionGeometry(selection, boxOf, 1)).toBeNull();
  });

  it("skips (does not throw for) a later page whose box is unavailable, keeping the pages it CAN resolve", () => {
    const selection: PageSelection[] = [
      { page_index: 0, text: "ok", rects: [{ x0: 0, y0: 0, x1: 0.1, y1: 0.1 }] },
      { page_index: 9, text: "missing", rects: [{ x0: 0, y0: 0, x1: 0.1, y1: 0.1 }] },
    ];
    const geom = pendingSelectionGeometry(selection, boxOf, 1);
    expect(geom!.pages).toEqual([
      { pageIndex: 0, rects: [{ left: 0, top: 0, width: 60, height: 80 }] },
      { pageIndex: 9, rects: [] },
    ]);
  });
});

describe("clipRectToViewport (fixed-position CREATE preview clipped to the reader viewport, Story 4.2)", () => {
  const viewport = { top: 48, bottom: 1000 };

  it("returns the rect unchanged when fully inside the viewport", () => {
    const rect = { left: 10, top: 100, width: 200, height: 20 };
    expect(clipRectToViewport(rect, viewport)).toEqual(rect);
  });

  it("clips the top when the rect starts above the viewport (scrolled behind the top-bar)", () => {
    const rect = { left: 10, top: 20, width: 200, height: 40 };
    expect(clipRectToViewport(rect, viewport)).toEqual({ left: 10, top: 48, width: 200, height: 12 });
  });

  it("clips the bottom when the rect extends past the viewport", () => {
    const rect = { left: 10, top: 980, width: 200, height: 40 };
    expect(clipRectToViewport(rect, viewport)).toEqual({ left: 10, top: 980, width: 200, height: 20 });
  });

  it("returns null when the rect is entirely above the viewport", () => {
    const rect = { left: 10, top: 0, width: 200, height: 30 };
    expect(clipRectToViewport(rect, viewport)).toBeNull();
  });

  it("returns null when the rect is entirely below the viewport", () => {
    const rect = { left: 10, top: 1000, width: 200, height: 30 };
    expect(clipRectToViewport(rect, viewport)).toBeNull();
  });

  it("returns null for a rect that exactly touches the viewport edge with zero overlap", () => {
    const rect = { left: 10, top: 8, width: 200, height: 40 };
    expect(clipRectToViewport(rect, viewport)).toBeNull();
  });
});

describe("viewportRectsFromPages (denormalize-and-clip to viewport pixels, shared by the live-drag and pending selection previews, Story 10.1)", () => {
  const cardAt = (pageIndex: number, left: number, top: number): PageCardRef => ({
    pageIndex,
    cardEl: {
      getBoundingClientRect: () =>
        ({ left, top, right: left + 600, bottom: top + 800, width: 600, height: 800, x: left, y: top }) as DOMRect,
    } as HTMLElement,
    box,
  });

  it("offsets card-local rects by the card's live viewport position", () => {
    const pages = [{ pageIndex: 0, rects: [{ left: 10, top: 20, width: 100, height: 30 }] }];
    const cardOf = (i: number): PageCardRef | null => (i === 0 ? cardAt(0, 50, 200) : null);
    expect(viewportRectsFromPages(pages, cardOf, null)).toEqual([{ left: 60, top: 220, width: 100, height: 30 }]);
  });

  it("skips a page whose card is not currently mounted", () => {
    const pages = [{ pageIndex: 9, rects: [{ left: 0, top: 0, width: 10, height: 10 }] }];
    expect(viewportRectsFromPages(pages, () => null, null)).toEqual([]);
  });

  it("clips a rect to a given viewport band (Story 4.2: a row scrolled behind the top-bar must not bleed through)", () => {
    const pages = [{ pageIndex: 0, rects: [{ left: 10, top: -30, width: 100, height: 50 }] }];
    const cardOf = (i: number): PageCardRef | null => (i === 0 ? cardAt(0, 0, 200) : null);
    // Screen rect: top = 200 + (-30) = 170, bottom = 220. Band top 190 clips 30px off the top.
    expect(viewportRectsFromPages(pages, cardOf, { top: 190, bottom: 1000 })).toEqual([
      { left: 10, top: 190, width: 100, height: 30 },
    ]);
  });

  it("drops a rect entirely outside the given viewport band", () => {
    const pages = [{ pageIndex: 0, rects: [{ left: 10, top: 0, width: 100, height: 20 }] }];
    const cardOf = (i: number): PageCardRef | null => (i === 0 ? cardAt(0, 0, 0) : null);
    expect(viewportRectsFromPages(pages, cardOf, { top: 100, bottom: 1000 })).toEqual([]);
  });

  it("flattens rects across multiple pages, preserving page order", () => {
    const pages = [
      { pageIndex: 0, rects: [{ left: 0, top: 0, width: 10, height: 10 }] },
      { pageIndex: 1, rects: [{ left: 0, top: 0, width: 20, height: 20 }] },
    ];
    const cardOf = (i: number): PageCardRef | null => cardAt(i, i * 1000, 0);
    expect(viewportRectsFromPages(pages, cardOf, null)).toEqual([
      { left: 0, top: 0, width: 10, height: 10 },
      { left: 1000, top: 0, width: 20, height: 20 },
    ]);
  });
});
