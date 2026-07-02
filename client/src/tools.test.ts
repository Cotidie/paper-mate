import { describe, it, expect } from "vitest";
import {
  ANNOTATION_TOOLS,
  POINTER_TOOLS,
  isAnnotationTool,
  isPointerTool,
  type ActiveTool,
} from "./tools";

describe("tool FSM partition (AD-11)", () => {
  it("partitions the ActiveTool union into pointer vs annotation, with no overlap", () => {
    for (const t of ANNOTATION_TOOLS) {
      expect(isAnnotationTool(t)).toBe(true);
      expect(isPointerTool(t)).toBe(false);
    }
    for (const t of POINTER_TOOLS) {
      expect(isPointerTool(t)).toBe(true);
      expect(isAnnotationTool(t)).toBe(false);
    }
  });

  it("every member is exactly one of pointer or annotation (mutually exclusive, exhaustive)", () => {
    const all: ActiveTool[] = [...POINTER_TOOLS, ...ANNOTATION_TOOLS];
    for (const t of all) {
      // XOR: exactly one predicate is true for any tool.
      expect(isPointerTool(t) !== isAnnotationTool(t)).toBe(true);
    }
  });

  it("names the pointer + annotation tools the FSM reserves", () => {
    expect([...POINTER_TOOLS]).toEqual(["cursor", "hand", "boxSelect"]);
    expect([...ANNOTATION_TOOLS]).toEqual(["highlight", "underline", "pen", "memo", "comment"]);
  });
});
