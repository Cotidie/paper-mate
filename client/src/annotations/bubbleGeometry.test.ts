import { describe, it, expect } from "vitest";
import type { Annotation } from "@/api/client";
import {
  PIN_OFFSET_TRANSFORM,
  committedBubbleOffset,
  bubbleTransform,
  manualBubbleSize,
  manualSizeStyle,
} from "./bubbleGeometry";

// A minimal comment annotation whose style fields we vary per test.
function comment(style: Partial<Annotation["style"]> = {}): Annotation {
  return {
    id: "c1",
    doc_id: "d1",
    type: "comment",
    anchor: { kind: "text", page_index: 0, rects: [], text: "x" },
    body: "note",
    style: { color: "annotation-default", ...style },
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  } as Annotation;
}

describe("committedBubbleOffset", () => {
  it("defaults to {0,0} for a never-moved comment", () => {
    expect(committedBubbleOffset(comment(), 1)).toEqual({ x: 0, y: 0 });
  });

  it("rescales the scale-1.0-independent stored offset to the current zoom (AD-4)", () => {
    const a = comment({ bubble_offset_x: 10, bubble_offset_y: -4 });
    expect(committedBubbleOffset(a, 2)).toEqual({ x: 20, y: -8 });
    expect(committedBubbleOffset(a, 0.5)).toEqual({ x: 5, y: -2 });
  });
});

describe("bubbleTransform", () => {
  it("prepends the below-pin nudge when NOT beside the anchor", () => {
    expect(bubbleTransform({ x: 3, y: 4 }, false)).toBe(`${PIN_OFFSET_TRANSFORM} translate(3px, 4px)`);
  });

  it("omits the pin nudge when the caller already placed pos beside the anchor", () => {
    expect(bubbleTransform({ x: 3, y: 4 }, true)).toBe("translate(3px, 4px)");
  });
});

describe("manualBubbleSize", () => {
  it("is null per axis when never resized", () => {
    expect(manualBubbleSize(comment())).toEqual({ width: null, height: null });
  });

  it("reads persisted bubble_width/height", () => {
    expect(manualBubbleSize(comment({ bubble_width: 200, bubble_height: 120 }))).toEqual({ width: 200, height: 120 });
  });
});

describe("manualSizeStyle", () => {
  it("contributes nothing for an unset axis", () => {
    expect(manualSizeStyle({ width: null, height: null })).toEqual({});
    expect(manualSizeStyle({ width: 200, height: null })).toEqual({ width: "200px" });
  });

  it("emits px width/height when set", () => {
    expect(manualSizeStyle({ width: 200, height: 120 })).toEqual({ width: "200px", height: "120px" });
  });
});
