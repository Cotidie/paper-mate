import { describe, it, expect } from "vitest";
import { overlayReducer, initialOverlayState, type OverlayState } from "./machine";
import type { PageSelection } from "../anchor";

const sel: PageSelection[] = [{ page_index: 0, rects: [{ x0: 0, y0: 0, x1: 1, y1: 1 }], text: "x" }];
const at = { x: 10, y: 20 };

describe("overlayReducer (PREP-3 state machine)", () => {
  it("starts empty", () => {
    expect(initialOverlayState).toEqual({ status: "empty" });
  });

  it("arm → armed; disarm → empty", () => {
    const armed = overlayReducer(initialOverlayState, { type: "arm", tool: "highlight" });
    expect(armed).toEqual({ status: "armed", tool: "highlight" });
    expect(overlayReducer(armed, { type: "disarm" })).toEqual({ status: "empty" });
  });

  it("begin from empty → annotating with no tool", () => {
    expect(overlayReducer(initialOverlayState, { type: "begin" })).toEqual({
      status: "annotating",
      tool: null,
    });
  });

  it("begin from armed carries the armed tool", () => {
    const armed: OverlayState = { status: "armed", tool: "underline" };
    expect(overlayReducer(armed, { type: "begin" })).toEqual({ status: "annotating", tool: "underline" });
  });

  it("present pops the quick-box (pending) carrying selection + position", () => {
    const annotating: OverlayState = { status: "annotating", tool: null };
    expect(overlayReducer(annotating, { type: "present", selection: sel, at })).toEqual({
      status: "pending",
      tool: null,
      selection: sel,
      at,
    });
  });

  it("commit from pending returns to the armed tool (sticky)", () => {
    const pending: OverlayState = { status: "pending", tool: "highlight", selection: sel, at };
    expect(overlayReducer(pending, { type: "commit" })).toEqual({ status: "armed", tool: "highlight" });
  });

  it("dismiss from a tool-less pending returns to empty", () => {
    const pending: OverlayState = { status: "pending", tool: null, selection: sel, at };
    expect(overlayReducer(pending, { type: "dismiss" })).toEqual({ status: "empty" });
  });

  it("ignores begin while a quick-box is pending", () => {
    const pending: OverlayState = { status: "pending", tool: null, selection: sel, at };
    expect(overlayReducer(pending, { type: "begin" })).toBe(pending);
  });
});
