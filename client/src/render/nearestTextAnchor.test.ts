// jsdom returns zeroed client rects and has no real layout, so these tests
// inject rect readers (mirroring anchor/collectTextRects's `rectsOf` pattern)
// to place spans/characters in space and exercise the pure resolver logic.

import { describe, it, expect } from "vitest";
import { nearestGlyph, nearestOffsetInTextNode, resolveNearestText, resolveOrigin } from "./nearestTextAnchor";

function rectReader(map: WeakMap<Element, DOMRect>) {
  return (el: Element): DOMRect => map.get(el) ?? new DOMRect(0, 0, 0, 0);
}
function glyph(left: number, right: number, top = 0, bottom = 16) {
  return { el: document.createElement("span"), left, right, top, bottom };
}

describe("nearestGlyph (2D rect distance)", () => {
  it("returns the glyph whose rect is nearest the point, inside wins", () => {
    const a = glyph(100, 140, 0, 16),
      b = glyph(200, 240, 0, 16);
    expect(nearestGlyph([a, b], 120, 8)).toBe(a); // inside a
    expect(nearestGlyph([a, b], 210, 8)).toBe(b); // inside b
    expect(nearestGlyph([a, b], 170, 8)).toBe(a); // between, nearer a's right edge
  });

  it("picks the correct COLUMN by horizontal distance across a wide gutter", () => {
    // Left column glyph [50,240] and right column glyph [900,1100] on the same
    // row. A point just right of the left column resolves to the LEFT glyph, not
    // the far right one (this is what makes column handling automatic).
    const left = glyph(50, 240, 100, 116),
      right = glyph(900, 1100, 100, 116);
    expect(nearestGlyph([left, right], 260, 108)).toBe(left);
    expect(nearestGlyph([left, right], 880, 108)).toBe(right);
  });

  it("prefers a vertically-near line over a horizontally-far same-row glyph", () => {
    // Point in the left column, between two left lines, with a right-column glyph
    // at the same Y. The near left line wins (small dy) over the far right glyph.
    const leftLine = glyph(50, 240, 20, 36),
      rightSameRow = glyph(900, 1100, 0, 16);
    expect(nearestGlyph([leftLine, rightSameRow], 100, 10)).toBe(leftLine);
  });

  it("returns null for no glyphs", () => {
    expect(nearestGlyph([], 100, 8)).toBeNull();
  });
});

describe("nearestOffsetInTextNode", () => {
  // "hello" (len 5), each char 10px wide, node starts at x=100.
  const node = document.createTextNode("hello");
  const rectsOf = (r: Range) => {
    const s = r.startOffset,
      e = r.endOffset;
    return [new DOMRect(100 + 10 * s, 0, 10 * (e - s), 16)];
  };
  it("finds the nearest character boundary", () => {
    expect(nearestOffsetInTextNode(node, 134, rectsOf)).toBe(3);
    expect(nearestOffsetInTextNode(node, 126, rectsOf)).toBe(3);
  });
  it("clamps to node start when the point is left of the line", () => {
    expect(nearestOffsetInTextNode(node, 90, rectsOf)).toBe(0);
  });
  it("clamps to node end when the point is right of the line (trailing blank space)", () => {
    expect(nearestOffsetInTextNode(node, 160, rectsOf)).toBe(5);
  });
  it("returns 0 for an empty text node", () => {
    expect(nearestOffsetInTextNode(document.createTextNode(""), 100, rectsOf)).toBe(0);
  });
});

describe("resolveNearestText", () => {
  function layerWith(specs: { text: string; left: number; right: number; top: number }[]) {
    const layer = document.createElement("div");
    const map = new WeakMap<Element, DOMRect>();
    map.set(layer, new DOMRect(0, 0, 1200, 800));
    for (const s of specs) {
      const span = document.createElement("span");
      span.append(document.createTextNode(s.text));
      layer.append(span);
      map.set(span, new DOMRect(s.left, s.top, s.right - s.left, 16));
    }
    return { layer, map };
  }
  // Range reader: chars 10px wide from the parent span's cached left edge.
  function rangeReader(map: WeakMap<Element, DOMRect>) {
    return (r: Range) => {
      const span = (r.startContainer.parentElement ?? r.startContainer) as Element;
      const base = map.get(span)?.left ?? 0;
      return [new DOMRect(base + 10 * r.startOffset, 0, 10 * (r.endOffset - r.startOffset), 16)];
    };
  }

  it("resolves to the LEFT column for a left-side point, ignoring the far right column", () => {
    const { layer, map } = layerWith([
      { text: "leftrow", left: 50, right: 120, top: 100 },
      { text: "rightrow", left: 900, right: 980, top: 100 },
    ]);
    const p = resolveNearestText(layer, 130, 108, rectReader(map), rangeReader(map))!;
    expect(p.node.textContent).toBe("leftrow"); // nearest = left, not the far right
    expect(p.onRow).toBe(true); // y=108 is within the row band (100..116)
  });

  it("resolves to the RIGHT column for a right-side point (cross-column drag can extend here)", () => {
    const { layer, map } = layerWith([
      { text: "leftrow", left: 50, right: 120, top: 100 },
      { text: "rightrow", left: 900, right: 980, top: 100 },
    ]);
    const p = resolveNearestText(layer, 890, 108, rectReader(map), rangeReader(map))!;
    expect(p.node.textContent).toBe("rightrow");
  });

  it("reports onRow=false when the pointer Y is in a blank vertical gap (still returns the nearest point)", () => {
    const { layer, map } = layerWith([{ text: "body", left: 50, right: 90, top: 100 }]);
    // y=200 is well below the row band (100..116, height 16): off-row.
    const p = resolveNearestText(layer, 70, 200, rectReader(map), rangeReader(map))!;
    expect(p.node.textContent).toBe("body");
    expect(p.onRow).toBe(false);
  });

  it("reports onRow=true within the inter-line leading tolerance (no flicker on a normal drag)", () => {
    const { layer, map } = layerWith([{ text: "body", left: 50, right: 90, top: 100 }]);
    // y=122 is 6px below the band bottom (116), within 0.5*16 = 8px tolerance.
    const p = resolveNearestText(layer, 70, 122, rectReader(map), rangeReader(map))!;
    expect(p.onRow).toBe(true);
  });

  it("has NO horizontal proximity gate: a deep-margin pointer still resolves on-row (Issue #2)", () => {
    const { layer, map } = layerWith([{ text: "body", left: 50, right: 90, top: 100 }]);
    // x=900 is far right of the glyph, but y is in its band: onRow stays true.
    const p = resolveNearestText(layer, 900, 108, rectReader(map), rangeReader(map))!;
    expect(p.node.textContent).toBe("body");
    expect(p.onRow).toBe(true);
  });

  it("stays in the pointer's column past a short line's end (no cross-column flicker/leak)", () => {
    // A two-column body: the left column has several justified full-width lines
    // plus a SHORT last line; the right column has lines at the same Y bands.
    // A cursor in the left column, past the short line's text end, must resolve
    // to the left column, never flip to the horizontally-closer right column.
    const { layer, map } = layerWith([
      { text: "leftfulllineone", left: 150, right: 650, top: 0 },
      { text: "leftfulllinetwo", left: 150, right: 650, top: 20 },
      { text: "shorttail", left: 150, right: 300, top: 40 }, // short last line
      { text: "rightlineone", left: 730, right: 1180, top: 0 },
      { text: "rightlinetwo", left: 730, right: 1180, top: 20 },
      { text: "rightlinethree", left: 730, right: 1180, top: 40 },
    ]);
    // Cursor at x=550 (inside the LEFT column's range, but 250px past the short
    // line's end at 300; the right column starts at 730, dx=180 < 250).
    const p = resolveNearestText(layer, 550, 48, rectReader(map), rangeReader(map))!;
    expect(p.node.textContent).toBe("shorttail"); // left column, not "rightlinethree"
  });

  it("Y-in-band wins over a horizontally-closer glyph on a DIFFERENT line (M1)", () => {
    // Short row A at y 100..116; a much longer row B one line below at y 120..136.
    // Cursor (1000,108): Y is inside A's band, but B is horizontally far closer.
    // The band-containing row A must win, and onRow stays true (deep side margin).
    const { layer, map } = layerWith([
      { text: "shortA", left: 50, right: 100, top: 100 },
      { text: "longrowB", left: 50, right: 900, top: 120 },
    ]);
    const p = resolveNearestText(layer, 1000, 108, rectReader(map), rangeReader(map))!;
    expect(p.node.textContent).toBe("shortA");
    expect(p.onRow).toBe(true);
  });

  it("skips a rotated (--rotate) margin span", () => {
    const layer = document.createElement("div");
    const map = new WeakMap<Element, DOMRect>();
    map.set(layer, new DOMRect(0, 0, 1200, 800));
    const rot = document.createElement("span");
    rot.style.setProperty("--rotate", "-90deg");
    rot.append(document.createTextNode("margin"));
    const body = document.createElement("span");
    body.append(document.createTextNode("body"));
    layer.append(rot, body);
    map.set(rot, new DOMRect(10, 0, 30, 780)); // page-tall rotated run, would be "nearest"
    map.set(body, new DOMRect(100, 100, 40, 16));
    const rr = (r: Range) => [new DOMRect(100 + 10 * r.startOffset, 0, 10 * (r.endOffset - r.startOffset), 16)];
    const p = resolveNearestText(layer, 110, 108, rectReader(map), rr)!;
    expect(p.node.textContent).toBe("body");
  });

  it("returns null for a layer with no usable glyphs", () => {
    const layer = document.createElement("div");
    const map = new WeakMap<Element, DOMRect>([[layer, new DOMRect(0, 0, 1200, 800)]]);
    expect(resolveNearestText(layer, 100, 8, rectReader(map))).toBeNull();
  });
});

describe("resolveOrigin (direction-aware anchoring)", () => {
  // A left column with two paragraphs separated by a blank gap, plus a right
  // column. Left para A: two lines at y 0-16 and 20-36 ("aEndword" is the last
  // glyph of line 2). Blank gap 36-100. Left para B: "bStart" at y 100-116.
  function gappedLayer() {
    const layer = document.createElement("div");
    const map = new WeakMap<Element, DOMRect>();
    map.set(layer, new DOMRect(0, 0, 1200, 800));
    const mk = (text: string, x: number, w: number, top: number) => {
      const s = document.createElement("span");
      s.append(document.createTextNode(text));
      layer.append(s);
      map.set(s, new DOMRect(x, top, w, 16));
      return s;
    };
    const a1 = mk("aone", 50, 120, 0); // para A line 1 [50,170]
    const aEnd = mk("prediction.", 50, 150, 20); // para A line 2 (its end) [50,200]
    const bStart = mk("Introduction", 50, 140, 100); // para B first line [50,190]
    const right = mk("rightcol", 900, 90, 20); // right column, same band as aEnd
    return { layer, map, a1, aEnd, bStart, right };
  }
  function rangeReader(map: WeakMap<Element, DOMRect>) {
    return (r: Range) => {
      const span = (r.startContainer.parentElement ?? r.startContainer) as Element;
      const base = map.get(span)?.left ?? 0;
      return [new DOMRect(base + 10 * r.startOffset, 0, 10 * (r.endOffset - r.startOffset), 16)];
    };
  }

  it("in a vertical gap: aboveEnd = END of the line above, belowStart = START of the line below (same column)", () => {
    const { layer, map, aEnd, bStart } = gappedLayer();
    // Pointer at x=120 (left column), y=60 (in the gap between aEnd and bStart).
    const ctx = resolveOrigin(layer, 120, 60, rectReader(map), rangeReader(map))!;
    expect(ctx.inBand).toBeNull();
    expect(ctx.aboveEnd).toEqual({ node: aEnd.firstChild, offset: (aEnd.firstChild as Text).length });
    expect(ctx.belowStart).toEqual({ node: bStart.firstChild, offset: 0 });
  });

  it("ignores the OTHER column when finding the gap's line boundaries", () => {
    const { layer, map, aEnd, bStart } = gappedLayer();
    const ctx = resolveOrigin(layer, 120, 60, rectReader(map), rangeReader(map))!;
    // aboveEnd/belowStart come from the LEFT column, never the right-column glyph.
    expect(ctx.aboveEnd!.node).toBe(aEnd.firstChild);
    expect(ctx.belowStart!.node).toBe(bStart.firstChild);
  });

  it("beside text (inside a line band): inBand is the nearest character, no gap anchors used", () => {
    const { layer, map, aEnd } = gappedLayer();
    // Pointer just past aEnd's right edge (within the proximity threshold), y in band.
    const ctx = resolveOrigin(layer, 220, 28, rectReader(map), rangeReader(map))!;
    expect(ctx.inBand).not.toBeNull();
    expect(ctx.inBand!.node).toBe(aEnd.firstChild);
    expect(ctx.inBand!.offset).toBe((aEnd.firstChild as Text).length); // clamped to line end
  });

  it("returns null past the proximity threshold (far-empty margin)", () => {
    const { layer, map } = gappedLayer();
    expect(resolveOrigin(layer, 120, 100 + 200, rectReader(map), rangeReader(map))).toBeNull();
  });

  it("returns null for a layer with no usable glyphs", () => {
    const layer = document.createElement("div");
    const map = new WeakMap<Element, DOMRect>([[layer, new DOMRect(0, 0, 1200, 800)]]);
    expect(resolveOrigin(layer, 100, 8, rectReader(map))).toBeNull();
  });

  it("anchors in the origin glyph's own column when that region is a single sparse line (M4)", () => {
    // Left column: three body lines. Right side: ONE isolated line (a caption)
    // — too sparse to form a coverage column. A pointer beside that lone right
    // line must anchor on it, not jump into the left column.
    const layer = document.createElement("div");
    const map = new WeakMap<Element, DOMRect>();
    map.set(layer, new DOMRect(0, 0, 1200, 800));
    const mk = (text: string, x: number, w: number, top: number) => {
      const s = document.createElement("span");
      s.append(document.createTextNode(text));
      layer.append(s);
      map.set(s, new DOMRect(x, top, w, 16));
      return s;
    };
    mk("leftone", 50, 200, 0);
    mk("lefttwo", 50, 200, 20);
    mk("leftthree", 50, 200, 40);
    const caption = mk("caption", 900, 120, 40); // lone right-side line
    const rr = (r: Range) => {
      const span = (r.startContainer.parentElement ?? r.startContainer) as Element;
      const base = map.get(span)?.left ?? 0;
      return [new DOMRect(base + 10 * r.startOffset, 0, 10 * (r.endOffset - r.startOffset), 16)];
    };
    // Pointer just right of the caption, y in its band: inBand must be the caption.
    const ctx = resolveOrigin(layer, 1030, 48, rectReader(map), rr)!;
    expect(ctx.inBand).not.toBeNull();
    expect(ctx.inBand!.node).toBe(caption.firstChild);
  });
});
