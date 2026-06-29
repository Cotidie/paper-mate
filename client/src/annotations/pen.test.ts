import { describe, it, expect } from "vitest";
import { strokeOutline, svgPathFromOutline } from "./pen";

describe("pen stroke engine", () => {
  it("turns >=2 points into a non-empty outline", () => {
    const outline = strokeOutline(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 5 },
      ],
      4,
    );
    expect(outline.length).toBeGreaterThan(0);
    // Each outline vertex is an [x, y] pair of finite numbers.
    for (const v of outline) {
      expect(v).toHaveLength(2);
      expect(Number.isFinite(v[0])).toBe(true);
      expect(Number.isFinite(v[1])).toBe(true);
    }
  });

  it("turns a single point into a non-empty outline (a dot)", () => {
    const outline = strokeOutline([{ x: 5, y: 5 }], 4);
    expect(outline.length).toBeGreaterThan(0);
  });

  it("returns an empty outline for empty input", () => {
    expect(strokeOutline([], 4)).toEqual([]);
  });

  it("builds a non-empty SVG path d from an outline", () => {
    const outline = strokeOutline(
      [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
      4,
    );
    const d = svgPathFromOutline(outline);
    expect(d.startsWith("M ")).toBe(true);
    expect(d.includes(" Q ")).toBe(true);
    expect(d.trimEnd().endsWith("Z")).toBe(true);
  });

  it("returns an empty path d for an empty outline", () => {
    expect(svgPathFromOutline([])).toBe("");
  });
});
