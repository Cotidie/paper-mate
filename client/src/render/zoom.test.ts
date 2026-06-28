import { describe, it, expect, vi } from "vitest";

// The render module wires the pdf.js worker + vendor CSS at import. Stub the
// heavy bits so this stays a fast, DOM-free unit test of the pure zoom math.
vi.mock("pdfjs-dist", () => ({ GlobalWorkerOptions: {}, getDocument: vi.fn(), TextLayer: class {} }));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "worker.js" }));
vi.mock("pdfjs-dist/web/pdf_viewer.css", () => ({}));

import {
  nextZoom,
  focalScroll,
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_STEP,
  ZOOM_WHEEL_STEP,
} from "./index";

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

  it("uses a finer wheel step than the keyboard step", () => {
    expect(ZOOM_WHEEL_STEP).toBeGreaterThan(1);
    expect(ZOOM_WHEEL_STEP).toBeLessThan(ZOOM_STEP);
    // A wheel notch moves less than a keyboard press from the same scale.
    const fromKeyboard = nextZoom(2, +1, ZOOM_STEP);
    const fromWheel = nextZoom(2, +1, ZOOM_WHEEL_STEP);
    expect(fromWheel - 2).toBeLessThan(fromKeyboard - 2);
  });
});

describe("focalScroll", () => {
  // focalScroll(cardEdge, cardSize, frac, focal) = cardEdge + frac*cardSize - focal.
  // It pins the captured fraction of the anchor card back under the focal point.
  it("scrolls so the captured fraction of the card sits under the focal point", () => {
    // Card now spans content [1000, 1000+800]; focal sat 25% into it; focal point
    // is 300px down the viewport → scroll = 1000 + 0.25*800 - 300 = 900.
    expect(focalScroll(1000, 800, 0.25, 300)).toBe(900);
  });

  it("keeps the card top pinned when the focal point is the card top (frac 0)", () => {
    // frac 0 → content target = cardEdge; scroll = cardEdge - focal.
    expect(focalScroll(500, 800, 0, 200)).toBe(300);
  });

  it("scales the within-card offset by the NEW card size, not a uniform factor", () => {
    // Same fraction against a larger (zoomed-in) card lands further down.
    expect(focalScroll(0, 1000, 0.5, 0)).toBe(500);
    expect(focalScroll(0, 2000, 0.5, 0)).toBe(1000);
  });
});
