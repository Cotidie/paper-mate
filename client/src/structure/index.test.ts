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

  it("excludes a figure/table caption mis-tagged as a heading (opendataloader quirk)", () => {
    const s: DocStructure = {
      elements: [
        el("1", "heading", 0, { x0: 0, y0: 0, x1: 1, y1: 0.1 }, {
          heading_level: 2,
          text: "3.3 Transformer Model",
        }),
        el("2", "heading", 0, { x0: 0, y0: 0.2, x1: 1, y1: 0.3 }, {
          heading_level: 4,
          text: "Figure 1: The TranAD Model.",
        }),
        el("3", "heading", 1, { x0: 0, y0: 0, x1: 1, y1: 0.1 }, {
          heading_level: 4,
          text: "Table 4: Diagnosis Performance.",
        }),
        el("4", "heading", 1, { x0: 0, y0: 0.2, x1: 1, y1: 0.3 }, {
          heading_level: 2,
          text: "4 Experiments",
        }),
      ],
    };
    expect(synthesizeToc(s).map((e) => e.title)).toEqual([
      "3.3 Transformer Model",
      "4 Experiments",
    ]);
  });

  it("excludes broadened caption forms (Fig., S1, 1a, roman, A.1) but keeps real headings", () => {
    const cap = (id: string, text: string) =>
      el(id, "heading", 0, { x0: 0, y0: 0, x1: 1, y1: 0.1 }, { heading_level: 3, text });
    const s: DocStructure = {
      elements: [
        cap("1", "Fig. 2: Architecture"),
        cap("2", "Figure S1: Supplementary"),
        cap("3", "Figure 1a Detail"),
        cap("4", "Table IV Results"),
        cap("5", "Table A.1: Hyperparameters"),
        el("6", "heading", 0, { x0: 0, y0: 0.5, x1: 1, y1: 0.6 }, {
          heading_level: 2,
          text: "3 Methodology", // a real numbered section, NOT a caption
        }),
      ],
    };
    expect(synthesizeToc(s).map((e) => e.title)).toEqual(["3 Methodology"]);
  });

  it("does not drop a short-title paper's real first-page section (prefix guard)", () => {
    const s: DocStructure = {
      elements: [
        el("1", "heading", 0, { x0: 0, y0: 0.3, x1: 1, y1: 0.4 }, {
          heading_level: 1,
          text: "Results and Discussion",
        }),
      ],
    };
    // A too-short metadata title must not swallow a real section via startsWith.
    expect(synthesizeToc(s, "Results").map((e) => e.title)).toEqual(["Results and Discussion"]);
  });

  it("excludes the paper title when the metadata title is a short subtitle-split name", () => {
    // Crossref splits some records into title + subtitle; a paper whose stored
    // title is the short half ("TranAD") is still the paper title when the
    // heading continues with a subtitle delimiter (live-smoke finding, TranAD).
    const s: DocStructure = {
      elements: [
        el("1", "heading", 0, { x0: 0.1, y0: 0.05, x1: 0.9, y1: 0.12 }, {
          heading_level: 1,
          text: "TranAD: Deep Transformer Networks for Anomaly Detection in\nMultivariate Time Series Data",
        }),
        el("2", "heading", 0, { x0: 0.1, y0: 0.2, x1: 0.9, y1: 0.24 }, {
          heading_level: 2,
          text: "1 Introduction",
        }),
      ],
    };
    expect(synthesizeToc(s, "TranAD").map((e) => e.title)).toEqual(["1 Introduction"]);
  });

  it("does not drop a short-title section when the heading just continues in prose", () => {
    const s: DocStructure = {
      elements: [
        el("1", "heading", 0, { x0: 0, y0: 0.3, x1: 1, y1: 0.4 }, {
          heading_level: 1,
          text: "Results, Limitations and Future Work",
        }),
      ],
    };
    // A comma is punctuation but NOT a title/subtitle delimiter: kept.
    expect(synthesizeToc(s, "Results").map((e) => e.title)).toEqual([
      "Results, Limitations and Future Work",
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

  it("excludes the paper title (a page-1 heading matching the metadata title)", () => {
    const s: DocStructure = {
      elements: [
        el("1", "heading", 0, { x0: 0.1, y0: 0.05, x1: 0.9, y1: 0.12 }, {
          heading_level: 1,
          // the heading text often carries a line break the flat title lacks
          text: "TranAD: Deep Transformer Networks for Anomaly Detection in\nMultivariate Time Series Data",
        }),
        el("2", "heading", 0, { x0: 0.1, y0: 0.2, x1: 0.9, y1: 0.24 }, {
          heading_level: 2,
          text: "1 Introduction",
        }),
      ],
    };
    const titles = synthesizeToc(
      s,
      "TranAD: Deep Transformer Networks for Anomaly Detection in Multivariate Time Series Data",
    ).map((e) => e.title);
    expect(titles).toEqual(["1 Introduction"]);
  });

  it("keeps the first heading when no metadata title is given (drops nothing)", () => {
    const s: DocStructure = {
      elements: [
        el("1", "heading", 0, { x0: 0, y0: 0, x1: 1, y1: 0.1 }, { heading_level: 1, text: "Some Title" }),
        el("2", "heading", 0, { x0: 0, y0: 0.2, x1: 1, y1: 0.3 }, { heading_level: 2, text: "1 Intro" }),
      ],
    };
    expect(synthesizeToc(s, null).map((e) => e.title)).toEqual(["Some Title", "1 Intro"]);
    expect(synthesizeToc(s).map((e) => e.title)).toEqual(["Some Title", "1 Intro"]);
  });

  it("does not drop a later-page heading that coincidentally matches the title", () => {
    const s: DocStructure = {
      elements: [
        el("1", "heading", 1, { x0: 0, y0: 0, x1: 1, y1: 0.1 }, { heading_level: 2, text: "Results" }),
      ],
    };
    // page_index 1 (not the title page) -> never treated as the paper title.
    expect(synthesizeToc(s, "Results").map((e) => e.title)).toEqual(["Results"]);
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
