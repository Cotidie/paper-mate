import { describe, it, expect } from "vitest";
import { clampToViewport } from "./position";

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
