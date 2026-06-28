import { describe, it, expect, vi } from "vitest";

// The render module wires the pdf.js worker + vendor CSS at import. Stub the
// heavy bits so this stays a fast, DOM-free unit test of the pure zoom math.
vi.mock("pdfjs-dist", () => ({ GlobalWorkerOptions: {}, getDocument: vi.fn(), TextLayer: class {} }));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "worker.js" }));
vi.mock("pdfjs-dist/web/pdf_viewer.css", () => ({}));

import {
  nextZoom,
  focalScrollOffset,
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

describe("focalScrollOffset", () => {
  // factor = newScale / oldScale.
  it("keeps the focal point fixed when zooming in (factor > 1)", () => {
    // scroll 0, focal 100, 2× zoom → the content at the focal point doubles its
    // distance from the origin (0+100)*2 = 200, so scroll moves to 200-100 = 100.
    expect(focalScrollOffset(0, 100, 2)).toBe(100);
  });

  it("keeps the focal point fixed when zooming out (factor < 1)", () => {
    // (200 + 100) * 0.5 - 100 = 50.
    expect(focalScrollOffset(200, 100, 0.5)).toBe(50);
  });

  it("is a no-op at factor 1", () => {
    expect(focalScrollOffset(123, 50, 1)).toBe(123);
  });

  it("accounts for the existing scroll offset", () => {
    // scroll 100, focal 50, 2× → (100+50)*2 - 50 = 250.
    expect(focalScrollOffset(100, 50, 2)).toBe(250);
  });
});
