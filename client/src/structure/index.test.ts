import { describe, it, expect } from "vitest";

import type { DocStructure, StructureElement } from "@/api/client";
import type { TocEntry } from "@/render";
import { denormalizeRect } from "@/anchor";
import {
  captions,
  denormalizeElement,
  elementAt,
  elementsOnPage,
  figures,
  headings,
  resolveToc,
  synthesizeToc,
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

describe("synthesizeToc", () => {
  it("maps headings to TocEntry (title, 1-based page, depth-from-level, region)", () => {
    const s: DocStructure = {
      elements: [
        el("1", "heading", 0, { x0: 0.1, y0: 0.05, x1: 0.9, y1: 0.1 }, {
          heading_level: 1,
          text: "1 Intro",
        }),
        el("2", "heading", 1, { x0: 0.1, y0: 0.02, x1: 0.9, y1: 0.06 }, {
          heading_level: 2,
          text: "1.1 Background",
        }),
      ],
    };
    expect(synthesizeToc(s)).toEqual([
      { title: "1 Intro", pageNumber: 1, depth: 0, rect: s.elements[0].rect },
      { title: "1.1 Background", pageNumber: 2, depth: 1, rect: s.elements[1].rect },
    ]);
  });

  it("preserves reading order (array order)", () => {
    const s: DocStructure = {
      elements: [
        el("a", "heading", 2, { x0: 0, y0: 0, x1: 1, y1: 0.1 }, { heading_level: 1, text: "C" }),
        el("b", "heading", 0, { x0: 0, y0: 0, x1: 1, y1: 0.1 }, { heading_level: 1, text: "A" }),
        el("c", "heading", 1, { x0: 0, y0: 0, x1: 1, y1: 0.1 }, { heading_level: 1, text: "B" }),
      ],
    };
    expect(synthesizeToc(s).map((e) => e.title)).toEqual(["C", "A", "B"]);
  });

  it("excludes non-heading elements", () => {
    const s: DocStructure = {
      elements: [
        el("1", "heading", 0, { x0: 0, y0: 0, x1: 1, y1: 0.1 }, { heading_level: 1, text: "H" }),
        el("2", "paragraph", 0, { x0: 0, y0: 0.1, x1: 1, y1: 0.2 }, { text: "P" }),
        el("3", "figure", 0, { x0: 0, y0: 0.2, x1: 1, y1: 0.3 }, { text: "F" }),
      ],
    };
    expect(synthesizeToc(s).map((e) => e.title)).toEqual(["H"]);
  });

  it("skips a blank/whitespace-only heading title", () => {
    const s: DocStructure = {
      elements: [
        el("1", "heading", 0, { x0: 0, y0: 0, x1: 1, y1: 0.1 }, { heading_level: 1, text: "  " }),
        el("2", "heading", 0, { x0: 0, y0: 0.1, x1: 1, y1: 0.2 }, {
          heading_level: 1,
          text: "Real",
        }),
      ],
    };
    expect(synthesizeToc(s).map((e) => e.title)).toEqual(["Real"]);
  });

  it("defaults depth to 0 when heading_level is null or absent", () => {
    const s: DocStructure = {
      elements: [
        el("1", "heading", 0, { x0: 0, y0: 0, x1: 1, y1: 0.1 }, {
          heading_level: null,
          text: "No level",
        }),
      ],
    };
    expect(synthesizeToc(s)[0].depth).toBe(0);
  });

  it("clamps a deep heading_level so the indent never runs unbounded", () => {
    const s: DocStructure = {
      elements: [
        el("1", "heading", 0, { x0: 0, y0: 0, x1: 1, y1: 0.1 }, {
          heading_level: 99,
          text: "Deep",
        }),
      ],
    };
    expect(synthesizeToc(s)[0].depth).toBe(5);
  });
});

describe("resolveToc", () => {
  const synthesized: DocStructure = {
    elements: [
      el("1", "heading", 0, { x0: 0.1, y0: 0.05, x1: 0.9, y1: 0.1 }, {
        heading_level: 1,
        text: "Synth",
      }),
    ],
  };
  const embedded: TocEntry[] = [{ title: "Embedded", pageNumber: 1, depth: 0 }];

  it("prefers a non-empty embedded outline over the synthesized fallback", () => {
    expect(resolveToc(embedded, synthesized)).toBe(embedded);
  });

  it("falls back to the synthesized ToC when the embedded outline is empty", () => {
    expect(resolveToc([], synthesized).map((e) => e.title)).toEqual(["Synth"]);
  });

  it("returns [] when both sources are empty", () => {
    expect(resolveToc([], { elements: [] })).toEqual([]);
  });
});
