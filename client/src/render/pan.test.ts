import { describe, it, expect, vi } from "vitest";

// The render module wires the pdf.js worker + vendor CSS at import. Stub the
// heavy bits so this stays a fast, DOM-free unit test of the pure pan math.
vi.mock("pdfjs-dist", () => ({ GlobalWorkerOptions: {}, getDocument: vi.fn(), TextLayer: class {} }));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "worker.js" }));
vi.mock("pdfjs-dist/web/pdf_viewer.css", () => ({}));

import { panScroll } from "./index";

// Pure pan-offset math (DOM-free), mirroring zoom.test.ts / nav.test.ts.
describe("panScroll", () => {
  it("subtracts the pointer delta so content follows the pointer (grab-drag)", () => {
    expect(panScroll(100, 30)).toBe(70);
  });

  it("dragging back (negative delta) scrolls the other way", () => {
    expect(panScroll(0, -50)).toBe(50);
  });

  it("is the identity at zero delta", () => {
    expect(panScroll(420, 0)).toBe(420);
  });
});
