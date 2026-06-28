import { describe, it, expect, vi } from "vitest";

// The render module wires the pdf.js worker + vendor CSS at import. Stub the
// heavy bits so this stays a fast, DOM-free unit test of the pure nav math.
vi.mock("pdfjs-dist", () => ({ GlobalWorkerOptions: {}, getDocument: vi.fn(), TextLayer: class {} }));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "worker.js" }));
vi.mock("pdfjs-dist/web/pdf_viewer.css", () => ({}));

import { currentPageInView, pageNavTarget, type PageExtent } from "./index";

// Three 100px-tall pages stacked at 0, 100, 200 (no gaps, for simple math).
const pages: PageExtent[] = [
  { pageNumber: 1, top: 0, bottom: 100 },
  { pageNumber: 2, top: 100, bottom: 200 },
  { pageNumber: 3, top: 200, bottom: 300 },
];

describe("currentPageInView", () => {
  it("picks the only page when the viewport sits inside it", () => {
    expect(currentPageInView(pages, 10, 90)).toBe(1);
  });

  it("picks the TOP-MOST page when two straddle the viewport", () => {
    // Viewport 60–160 overlaps page 1 (0–100) and page 2 (100–200); page 1 is
    // still visible at the top, so it is the top-most in view.
    expect(currentPageInView(pages, 60, 160)).toBe(1);
    // Once page 1 scrolls fully above (top 110), page 2 becomes top-most.
    expect(currentPageInView(pages, 110, 210)).toBe(2);
  });

  it("tracks the page as the viewport scrolls down", () => {
    expect(currentPageInView(pages, 210, 290)).toBe(3);
  });

  it("ignores pages fully above or below the viewport", () => {
    // Viewport 120–180 is entirely within page 2; pages 1 & 3 don't intersect.
    expect(currentPageInView(pages, 120, 180)).toBe(2);
  });

  it("defaults to page 1 when nothing intersects or the list is empty", () => {
    expect(currentPageInView(pages, 1000, 1100)).toBe(1);
    expect(currentPageInView([], 0, 100)).toBe(1);
  });
});

describe("pageNavTarget", () => {
  it("advances and retreats by one page", () => {
    expect(pageNavTarget(2, 1, 5)).toBe(3);
    expect(pageNavTarget(2, -1, 5)).toBe(1);
  });

  it("clamps at the first page", () => {
    expect(pageNavTarget(1, -1, 5)).toBe(1);
  });

  it("clamps at the last page", () => {
    expect(pageNavTarget(5, 1, 5)).toBe(5);
  });

  it("is safe for an empty/zero-page document", () => {
    expect(pageNavTarget(1, 1, 0)).toBe(1);
  });
});
