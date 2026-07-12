// jsdom returns zeroed client rects and has no real layout, so these tests
// inject rect readers (mirroring anchor/collectTextRects's `rectsOf` pattern)
// to place spans/characters in space and exercise the pure resolver logic.

import { describe, it, expect } from "vitest";
import { nearestGlyph, nearestOffsetInTextNode, resolveNearestText } from "./nearestTextAnchor";

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
  });

  it("resolves to the RIGHT column for a right-side point (cross-column drag can extend here)", () => {
    const { layer, map } = layerWith([
      { text: "leftrow", left: 50, right: 120, top: 100 },
      { text: "rightrow", left: 900, right: 980, top: 100 },
    ]);
    const p = resolveNearestText(layer, 890, 108, rectReader(map), rangeReader(map))!;
    expect(p.node.textContent).toBe("rightrow");
  });

  it("returns null past the proximity threshold (far-empty margin)", () => {
    const { layer, map } = layerWith([{ text: "body", left: 50, right: 90, top: 100 }]);
    // > 3 line-heights (48px) below the glyph bottom (116) is a truly-empty margin.
    expect(resolveNearestText(layer, 70, 116 + 60, rectReader(map), rangeReader(map))).toBeNull();
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
