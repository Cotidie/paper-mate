import { describe, it, expect, vi } from "vitest";

// The render module wires the pdf.js worker + vendor CSS at import. Stub the
// heavy bits so this stays a fast, DOM-free unit test of the outline resolution.
vi.mock("pdfjs-dist", () => ({ GlobalWorkerOptions: {}, getDocument: vi.fn(), TextLayer: class {} }));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "worker.js" }));
vi.mock("pdfjs-dist/web/pdf_viewer.css", () => ({}));

import { getOutline, type TocEntry } from "./index";

/** A fake PDFDocumentProxy slice: only what getOutline reads. */
function fakePdf(opts: {
  outline: unknown;
  destinations?: Record<string, unknown[] | null>;
  pageIndexByRef?: Map<object, number>;
  numPages?: number;
}) {
  return {
    numPages: opts.numPages ?? 10,
    getOutline: vi.fn(async () => opts.outline),
    getDestination: vi.fn(async (id: string) => opts.destinations?.[id] ?? null),
    getPageIndex: vi.fn(async (ref: object) => {
      const idx = opts.pageIndexByRef?.get(ref);
      if (idx === undefined) throw new Error("unknown ref");
      return idx;
    }),
  } as unknown as Parameters<typeof getOutline>[0];
}

describe("getOutline", () => {
  it("flattens a nested outline with correct depth + 1-based page (RefProxy dest)", async () => {
    const refA = { num: 4, gen: 0 };
    const refB = { num: 9, gen: 0 };
    const pdf = fakePdf({
      outline: [
        { title: "1 Intro", dest: [refA, { name: "XYZ" }, 0, 700], items: [
          { title: "1.1 Background", dest: [refB, { name: "XYZ" }, 0, 500], items: [] },
        ] },
      ],
      pageIndexByRef: new Map([[refA, 0], [refB, 4]]),
    });
    const entries = await getOutline(pdf);
    expect(entries).toEqual<TocEntry[]>([
      { title: "1 Intro", pageNumber: 1, depth: 0 },
      { title: "1.1 Background", pageNumber: 5, depth: 1 },
    ]);
  });

  it("resolves a named (string) destination via getDestination", async () => {
    const ref = { num: 7, gen: 0 };
    const pdf = fakePdf({
      outline: [{ title: "Methods", dest: "sec.methods", items: [] }],
      destinations: { "sec.methods": [ref, { name: "Fit" }] },
      pageIndexByRef: new Map([[ref, 2]]),
    });
    expect(await getOutline(pdf)).toEqual([{ title: "Methods", pageNumber: 3, depth: 0 }]);
  });

  it("treats a numeric first element as a 0-based page index (n → n+1)", async () => {
    const pdf = fakePdf({ outline: [{ title: "Appendix", dest: [5, { name: "Fit" }], items: [] }] });
    expect(await getOutline(pdf)).toEqual([{ title: "Appendix", pageNumber: 6, depth: 0 }]);
  });

  it("clamps the resolved page to [1, numPages]", async () => {
    const pdf = fakePdf({ outline: [{ title: "Past end", dest: [99], items: [] }], numPages: 3 });
    expect(await getOutline(pdf)).toEqual([{ title: "Past end", pageNumber: 3, depth: 0 }]);
  });

  it("skips entries with a null/unresolvable dest but keeps the rest", async () => {
    const ref = { num: 1, gen: 0 };
    const pdf = fakePdf({
      outline: [
        { title: "Bookmark only", dest: null, items: [] },
        { title: "Broken name", dest: "missing", items: [] }, // getDestination → null
        { title: "Real", dest: [ref], items: [] },
      ],
      pageIndexByRef: new Map([[ref, 0]]),
    });
    expect(await getOutline(pdf)).toEqual([{ title: "Real", pageNumber: 1, depth: 0 }]);
  });

  it("skips a node whose page-index lookup throws, without rejecting the whole call", async () => {
    const good = { num: 1, gen: 0 };
    const bad = { num: 2, gen: 0 };
    const pdf = fakePdf({
      outline: [
        { title: "Throws", dest: [bad], items: [] },
        { title: "Fine", dest: [good], items: [] },
      ],
      pageIndexByRef: new Map([[good, 6]]), // `bad` not present → getPageIndex throws
    });
    expect(await getOutline(pdf)).toEqual([{ title: "Fine", pageNumber: 7, depth: 0 }]);
  });

  it("drops empty/whitespace titles", async () => {
    const ref = { num: 1, gen: 0 };
    const pdf = fakePdf({
      outline: [{ title: "   ", dest: [ref], items: [] }],
      pageIndexByRef: new Map([[ref, 0]]),
    });
    expect(await getOutline(pdf)).toEqual([]);
  });

  it("returns [] for a PDF with no outline (null)", async () => {
    expect(await getOutline(fakePdf({ outline: null }))).toEqual([]);
  });

  it("returns [] for an empty outline array", async () => {
    expect(await getOutline(fakePdf({ outline: [] }))).toEqual([]);
  });

  it("returns [] when getOutline itself rejects", async () => {
    const pdf = {
      numPages: 5,
      getOutline: vi.fn(async () => { throw new Error("boom"); }),
      getDestination: vi.fn(),
      getPageIndex: vi.fn(),
    } as unknown as Parameters<typeof getOutline>[0];
    expect(await getOutline(pdf)).toEqual([]);
  });
});
