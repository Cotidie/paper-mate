// jsdom returns zeroed client rects and has no real layout, so these tests
// inject rect readers (mirroring anchor/collectTextRects's `rectsOf` pattern)
// to place spans/characters in space and exercise the pure resolver logic.

import { describe, it, expect } from "vitest";
import {
  groupSpanLines,
  nearestLine,
  nearestSpanInLine,
  nearestOffsetInTextNode,
  type SpanLine,
} from "./nearestTextAnchor";

function rectReader(map: WeakMap<Element, DOMRect>) {
  return (el: Element): DOMRect => map.get(el) ?? new DOMRect(0, 0, 0, 0);
}
function span(rotate?: string): HTMLElement {
  const s = document.createElement("span");
  if (rotate) s.style.setProperty("--rotate", rotate);
  return s;
}

describe("groupSpanLines", () => {
  it("groups spans into bands by vertical overlap", () => {
    const a = span(),
      b = span(),
      c = span();
    const rects = new WeakMap<Element, DOMRect>([
      [a, new DOMRect(100, 0, 40, 16)], // line 1
      [b, new DOMRect(200, 2, 40, 16)], // line 1 (overlaps a vertically)
      [c, new DOMRect(100, 20, 40, 16)], // line 2
    ]);
    const lines = groupSpanLines([a, b, c], rectReader(rects));
    expect(lines).toHaveLength(2);
    expect(lines[0].spans).toEqual([a, b]);
    expect(lines[1].spans).toEqual([c]);
  });

  it("skips a rotated (--rotate) span so it can't merge every line into one band", () => {
    const rot = span("-90deg"),
      a = span();
    const rects = new WeakMap<Element, DOMRect>([
      [rot, new DOMRect(10, 0, 40, 800)], // page-tall rotated run
      [a, new DOMRect(100, 100, 40, 16)],
    ]);
    const lines = groupSpanLines([rot, a], rectReader(rects));
    expect(lines).toHaveLength(1);
    expect(lines[0].spans).toEqual([a]);
  });

  it("skips zero-area spans", () => {
    const a = span(),
      empty = span();
    const rects = new WeakMap<Element, DOMRect>([
      [a, new DOMRect(100, 0, 40, 16)],
      [empty, new DOMRect(0, 0, 0, 0)],
    ]);
    const lines = groupSpanLines([a, empty], rectReader(rects));
    expect(lines).toHaveLength(1);
    expect(lines[0].spans).toEqual([a]);
  });
});

describe("nearestLine", () => {
  const lines: SpanLine[] = [
    { spans: [], top: 0, bottom: 16 },
    { spans: [], top: 20, bottom: 36 },
  ];
  it("returns the band containing y", () => {
    expect(nearestLine(lines, 10)).toBe(lines[0]);
    expect(nearestLine(lines, 30)).toBe(lines[1]);
  });
  it("returns the nearest band when y is outside every band", () => {
    expect(nearestLine(lines, 40)).toBe(lines[1]);
    expect(nearestLine(lines, -5)).toBe(lines[0]);
  });
  it("prefers the PRECEDING band when equidistant", () => {
    // y=18: 2px below line0 bottom, 2px above line1 top -> preceding (line0).
    expect(nearestLine(lines, 18)).toBe(lines[0]);
  });
  it("returns null for no lines", () => {
    expect(nearestLine([], 10)).toBeNull();
  });
});

describe("nearestSpanInLine", () => {
  it("returns the containing span, else the horizontally nearest", () => {
    const a = span(),
      b = span();
    const rects = new WeakMap<Element, DOMRect>([
      [a, new DOMRect(100, 0, 40, 16)], // [100,140]
      [b, new DOMRect(200, 0, 40, 16)], // [200,240]
    ]);
    const line: SpanLine = { spans: [a, b], top: 0, bottom: 16 };
    expect(nearestSpanInLine(line, 210, rectReader(rects))).toBe(b); // inside b
    expect(nearestSpanInLine(line, 150, rectReader(rects))).toBe(a); // nearer a's right edge
    expect(nearestSpanInLine(line, 300, rectReader(rects))).toBe(b); // past both, nearer b
  });
});

describe("nearestOffsetInTextNode", () => {
  // "hello" (len 5), each char 10px wide, node starts at x=100.
  // Boundary at offset k sits at x = 100 + 10*k.
  const node = document.createTextNode("hello");
  const rectsOf = (r: Range) => {
    const s = r.startOffset,
      e = r.endOffset;
    return [new DOMRect(100 + 10 * s, 0, 10 * (e - s), 16)];
  };
  it("finds the nearest character boundary", () => {
    expect(nearestOffsetInTextNode(node, 134, rectsOf)).toBe(3); // 130 closer than 140
    expect(nearestOffsetInTextNode(node, 126, rectsOf)).toBe(3); // 130 closer than 120
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
