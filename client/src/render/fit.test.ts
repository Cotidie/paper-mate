import { describe, it, expect, vi } from "vitest";

// The render module wires the pdf.js worker + vendor CSS at import. Stub the
// heavy bits so this stays a fast, DOM-free unit test of the pure scale math.
vi.mock("pdfjs-dist", () => ({ GlobalWorkerOptions: {}, getDocument: vi.fn(), TextLayer: class {} }));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "worker.js" }));
vi.mock("pdfjs-dist/web/pdf_viewer.css", () => ({}));

import { fitToWidthScale } from "./index";

describe("fitToWidthScale", () => {
  it("fits a wide page down to the available canvas width", () => {
    expect(fitToWidthScale(1000, 500)).toBeCloseTo(0.5);
  });

  it("caps the scale so a narrow page does not blow up (default cap 2)", () => {
    expect(fitToWidthScale(100, 1000)).toBe(2);
  });

  it("honours a custom cap", () => {
    expect(fitToWidthScale(100, 1000, 1.5)).toBe(1.5);
  });

  it("returns 1 for non-positive inputs (no division by zero)", () => {
    expect(fitToWidthScale(0, 500)).toBe(1);
    expect(fitToWidthScale(600, 0)).toBe(1);
  });
});
