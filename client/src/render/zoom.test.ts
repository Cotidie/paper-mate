import { describe, it, expect, vi } from "vitest";

// The render module wires the pdf.js worker + vendor CSS at import. Stub the
// heavy bits so this stays a fast, DOM-free unit test of the pure zoom math.
vi.mock("pdfjs-dist", () => ({ GlobalWorkerOptions: {}, getDocument: vi.fn(), TextLayer: class {} }));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "worker.js" }));
vi.mock("pdfjs-dist/web/pdf_viewer.css", () => ({}));

import { nextZoom, ZOOM_MIN, ZOOM_MAX, ZOOM_STEP } from "./index";

// Pure zoom-step math (DOM-free), mirroring fit.test.ts / nav.test.ts.
describe("nextZoom", () => {
  it("steps in by multiplying by ZOOM_STEP", () => {
    expect(nextZoom(1, +1)).toBeCloseTo(ZOOM_STEP);
  });

  it("steps out by dividing by ZOOM_STEP", () => {
    expect(nextZoom(1, -1)).toBeCloseTo(1 / ZOOM_STEP);
  });

  it("round-trips in then out back to ~1.0", () => {
    expect(nextZoom(nextZoom(1, +1), -1)).toBeCloseTo(1);
  });

  it("clamps at ZOOM_MAX (stepping in from the max stays at max)", () => {
    expect(nextZoom(ZOOM_MAX, +1)).toBe(ZOOM_MAX);
    // a value just below max never overshoots past it
    expect(nextZoom(ZOOM_MAX / 1.01, +1)).toBe(ZOOM_MAX);
  });

  it("clamps at ZOOM_MIN (stepping out from the min stays at min)", () => {
    expect(nextZoom(ZOOM_MIN, -1)).toBe(ZOOM_MIN);
    expect(nextZoom(ZOOM_MIN * 1.01, -1)).toBe(ZOOM_MIN);
  });

  it("exposes a sane range", () => {
    expect(ZOOM_MIN).toBeLessThan(1);
    expect(ZOOM_MAX).toBeGreaterThan(1);
    expect(ZOOM_STEP).toBeGreaterThan(1);
  });
});
