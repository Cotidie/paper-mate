import { describe, it, expect } from "vitest";

import type { DocStructure, StructureElement } from "@/api/client";
import { denormalizeRect } from "@/anchor";
import {
  captions,
  denormalizeElement,
  elementAt,
  elementsOnPage,
  figures,
  headings,
  tables,
} from "@/structure";

function el(
  id: string,
  type: StructureElement["type"],
  page_index: number,
  rect: { x0: number; y0: number; x1: number; y1: number },
  extra: Partial<StructureElement> = {},
): StructureElement {
  return { id, type, page_index, rect, text: "", heading_level: null, ...extra };
}

const structure: DocStructure = {
  elements: [
    el("1", "heading", 0, { x0: 0.1, y0: 0.05, x1: 0.9, y1: 0.1 }, { heading_level: 1 }),
    el("2", "paragraph", 0, { x0: 0.1, y0: 0.12, x1: 0.9, y1: 0.4 }),
    el("3", "figure", 0, { x0: 0.5, y0: 0.5, x1: 0.9, y1: 0.8 }),
    el("4", "caption", 0, { x0: 0.5, y0: 0.82, x1: 0.9, y1: 0.86 }),
    el("5", "table", 1, { x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.5 }),
    el("6", "heading", 1, { x0: 0.1, y0: 0.02, x1: 0.9, y1: 0.06 }, { heading_level: 2 }),
  ],
};

describe("structure selectors", () => {
  it("headings() returns only headings, in reading order", () => {
    expect(headings(structure).map((e) => e.id)).toEqual(["1", "6"]);
  });

  it("figures() returns only figures", () => {
    expect(figures(structure).map((e) => e.id)).toEqual(["3"]);
  });

  it("tables() returns only tables", () => {
    expect(tables(structure).map((e) => e.id)).toEqual(["5"]);
  });

  it("captions() returns only captions", () => {
    expect(captions(structure).map((e) => e.id)).toEqual(["4"]);
  });

  it("elementsOnPage() filters by 0-based page index, preserving order", () => {
    expect(elementsOnPage(structure, 0).map((e) => e.id)).toEqual(["1", "2", "3", "4"]);
    expect(elementsOnPage(structure, 1).map((e) => e.id)).toEqual(["5", "6"]);
  });
});

describe("elementAt hit-test", () => {
  it("returns the element whose rect contains the point", () => {
    const hit = elementAt(structure, 0, { x: 0.5, y: 0.07 });
    expect(hit?.id).toBe("1"); // inside the heading
  });

  it("returns null when the point hits nothing on that page", () => {
    expect(elementAt(structure, 0, { x: 0.01, y: 0.99 })).toBeNull();
  });

  it("respects page scoping (a point over page 1 does not match page 0)", () => {
    // Page 1's table covers y 0.1..0.5; the same point on page 0 hits the paragraph.
    expect(elementAt(structure, 1, { x: 0.5, y: 0.3 })?.id).toBe("5");
    expect(elementAt(structure, 0, { x: 0.5, y: 0.3 })?.id).toBe("2");
  });

  it("recent-wins on overlap (topmost in reading order)", () => {
    const overlapping: DocStructure = {
      elements: [
        el("under", "paragraph", 0, { x0: 0, y0: 0, x1: 1, y1: 1 }),
        el("over", "figure", 0, { x0: 0.2, y0: 0.2, x1: 0.8, y1: 0.8 }),
      ],
    };
    expect(elementAt(overlapping, 0, { x: 0.5, y: 0.5 })?.id).toBe("over");
  });
});

describe("denormalizeElement", () => {
  it("delegates to the anchor service's denormalizeRect (AD-9)", () => {
    const box = { width: 600, height: 800 };
    const scale = 2;
    const element = structure.elements[0];
    expect(denormalizeElement(element, box, scale)).toEqual(
      denormalizeRect(element.rect, box, scale),
    );
  });
});
