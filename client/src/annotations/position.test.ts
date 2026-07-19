import { describe, it, expect } from "vitest";
import { clampToViewport, placeBesideSelection, rightOf, QUICK_BOX_GAP } from "./position";

describe("rightOf (box comment popup: beside the highlight, fix request)", () => {
  it("shifts left to the rect's right edge using the default gap; top/width/height carry over", () => {
    expect(rightOf({ left: 60, top: 160, width: 240, height: 160 })).toEqual({
      left: 60 + 240 + QUICK_BOX_GAP,
      top: 160,
      width: 240,
      height: 160,
    });
  });

  it("accepts a custom gap", () => {
    expect(rightOf({ left: 0, top: 0, width: 100, height: 50 }, 20)).toEqual({
      left: 120,
      top: 0,
      width: 100,
      height: 50,
    });
  });

  it("a zero-width rect (degenerate) shifts by only the gap", () => {
    expect(rightOf({ left: 10, top: 10, width: 0, height: 0 })).toEqual({
      left: 10 + QUICK_BOX_GAP,
      top: 10,
      width: 0,
      height: 0,
    });
  });
});

describe("clampToViewport (AC-4 nudge on-screen)", () => {
  it("leaves a box that already fits where it is", () => {
    expect(clampToViewport(100, 100, 120, 40, 1024, 768)).toEqual({ x: 100, y: 100 });
  });

  it("pulls a box that overflows the right/bottom edge back inside (with margin)", () => {
    // x near right edge: 1000 + 120 > 1024 → clamp to 1024-120-8 = 896.
    expect(clampToViewport(1000, 760, 120, 40, 1024, 768)).toEqual({ x: 896, y: 720 });
  });

  it("clamps a negative origin to the margin", () => {
    expect(clampToViewport(-50, -10, 120, 40, 1024, 768)).toEqual({ x: 8, y: 8 });
  });

  it("pins a box larger than the viewport to the top-left margin", () => {
    expect(clampToViewport(500, 500, 2000, 2000, 1024, 768)).toEqual({ x: 8, y: 8 });
  });
});

describe("placeBesideSelection (Story 10.6: prefer-right -> flip-left -> below -> clamp)", () => {
  const vw = 1024;
  const vh = 768;

  it("a box that fits lands to the RIGHT, top-aligned", () => {
    const sel = { left: 100, top: 200, right: 300, bottom: 260 };
    expect(placeBesideSelection(sel, 120, 40, vw, vh)).toEqual({ x: 300 + QUICK_BOX_GAP, y: 200 });
  });

  it("a box that would overflow the right edge flips LEFT, still top-aligned", () => {
    const sel = { left: 800, top: 200, right: 950, bottom: 260 };
    // Right candidate: 950 + gap + 120 = 1076 > 1024 - 8 -> overflows.
    expect(placeBesideSelection(sel, 120, 40, vw, vh)).toEqual({ x: 800 - QUICK_BOX_GAP - 120, y: 200 });
  });

  it("a box that fits neither side falls BELOW the selection (pre-10.6 anchor)", () => {
    const sel = { left: 50, top: 100, right: 990, bottom: 150 };
    // Right and left candidates both overflow (selection spans nearly the full width).
    expect(placeBesideSelection(sel, 200, 50, vw, vh)).toEqual({ x: 50, y: 150 + QUICK_BOX_GAP });
  });

  it("the below/flip result is still clampToViewport-bounded (pulled up off the bottom edge)", () => {
    const sel = { left: 50, top: 700, right: 990, bottom: 750 };
    // Below would land at y = 756, past the viewport bottom for a 50px-tall box.
    expect(placeBesideSelection(sel, 200, 50, vw, vh)).toEqual({ x: 50, y: 768 - 50 - 8 });
  });

  it("a box larger than the viewport pins to the top-left margin (delegated clamp)", () => {
    const sel = { left: 100, top: 100, right: 150, bottom: 120 };
    expect(placeBesideSelection(sel, 2000, 2000, vw, vh)).toEqual({ x: 8, y: 8 });
  });

  it("honors a custom gap/margin", () => {
    const sel = { left: 100, top: 100, right: 300, bottom: 200 };
    expect(placeBesideSelection(sel, 100, 50, vw, vh, 20, 30)).toEqual({ x: 320, y: 100 });
  });
});
