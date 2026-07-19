import { describe, it, expect } from "vitest";
import {
  MIN_MEMO_WIDTH_PX,
  MIN_MEMO_HEIGHT_PX,
  memoMinFraction,
  moveMemoRect,
  resizeMemoRect,
  reseedMemoResizeRect,
} from "./memoBoxGeometry";

const BOX = { width: 800, height: 1000 };

describe("memoMinFraction", () => {
  it("is undefined for a region rect (no floor)", () => {
    expect(memoMinFraction(false, BOX)).toBeUndefined();
  });

  it("normalizes the CSS-px memo min to a page fraction", () => {
    expect(memoMinFraction(true, BOX)).toEqual({ w: MIN_MEMO_WIDTH_PX / 800, h: MIN_MEMO_HEIGHT_PX / 1000 });
  });
});

describe("moveMemoRect", () => {
  const rect = { x0: 0.2, y0: 0.2, x1: 0.4, y1: 0.4 };

  it("with no collapsed width, just translates + clamps (region/expanded path)", () => {
    const moved = moveMemoRect(rect, 0.1, 0.1, null);
    expect(moved.x0).toBeCloseTo(0.3);
    expect(moved.y0).toBeCloseTo(0.3);
    expect(moved.x1).toBeCloseTo(0.5);
    expect(moved.y1).toBeCloseTo(0.5);
  });

  it("clamps X against the WIDER collapsed footprint so a wide collapsed box can't leave the page", () => {
    // collapsed width 0.5 > expanded width 0.2: effX1 = 0.2 + 0.5 = 0.7, so the
    // max rightward dx is 1 - 0.7 = 0.3 even though the expanded rect could go further.
    const moved = moveMemoRect(rect, 0.9, 0, 0.5);
    expect(moved.x0).toBeCloseTo(0.5); // 0.2 + 0.3
    expect(moved.x1).toBeCloseTo(0.7); // 0.4 + 0.3
  });
});

describe("resizeMemoRect", () => {
  const rect = { x0: 0.2, y0: 0.2, x1: 0.5, y1: 0.5 };

  it("a collapsed memo resizes WIDTH only, pinning the top-left, y-axis untouched", () => {
    const next = resizeMemoRect(rect, "se", 0.1, 0.3, true, true, BOX);
    expect(next.x0).toBe(0.2);
    expect(next.y0).toBe(0.2);
    expect(next.y1).toBe(0.5); // y unchanged despite dy=0.3
    expect(next.x1).toBeCloseTo(0.6); // width grew by 0.1
  });

  it("an expanded memo resizes both axes and honors the min floor", () => {
    // Shrink the se corner past the min: width/height clamp UP to the memo floor,
    // not collapsed further. (rect is 0.3x0.3; dx=dy=-0.28 would leave 0.02, below
    // the min of 0.06/0.032.)
    const next = resizeMemoRect(rect, "se", -0.28, -0.28, true, false, BOX);
    expect(next.x1 - next.x0).toBeCloseTo(MIN_MEMO_WIDTH_PX / 800); // 0.06
    expect(next.y1 - next.y0).toBeCloseTo(MIN_MEMO_HEIGHT_PX / 1000); // 0.032
  });

  it("a region rect has no floor (shrinks below the memo min)", () => {
    const next = resizeMemoRect(rect, "se", -0.28, -0.28, false, false, BOX);
    expect(next.x1 - next.x0).toBeCloseTo(0.02); // below the 0.06 memo floor
    expect(next.y1 - next.y0).toBeCloseTo(0.02);
  });
});

describe("reseedMemoResizeRect", () => {
  const rect = { x0: 0.2, y0: 0.2, x1: 0.5, y1: 0.4 };

  it("re-seeds y1 from the rendered height (expanded: width left alone)", () => {
    // rendered height 300 at scale 1, box height 1000 -> heightFrac 0.3 -> y1 = 0.2 + 0.3
    const next = reseedMemoResizeRect(rect, { width: 400, height: 300 }, BOX, 1, false);
    expect(next.y1).toBeCloseTo(0.5);
    expect(next.x1).toBe(0.5); // expanded: width NOT re-seeded
  });

  it("re-seeds width too when collapsed", () => {
    const next = reseedMemoResizeRect(rect, { width: 240, height: 300 }, BOX, 1, true);
    expect(next.x1).toBeCloseTo(0.5); // 0.2 + 240/800
    expect(next.y1).toBeCloseTo(0.5);
  });

  it("is a no-op when rendered size is null (jsdom / no layout)", () => {
    expect(reseedMemoResizeRect(rect, null, BOX, 1, true)).toEqual(rect);
  });
});
