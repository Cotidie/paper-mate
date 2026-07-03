import { describe, it, expect } from "vitest";
import { inActiveGroup, markClass, unionRect, markBounds, commentGroupIds } from "./markGeometry";
import type { Annotation } from "@/api/client";

function textMark(id: string, groupId: string | null = null): Annotation {
  return {
    id,
    doc_id: "doc-1",
    type: "highlight",
    group_id: groupId,
    anchor: { kind: "text", page_index: 0, rects: [{ x0: 0.1, y0: 0.1, x1: 0.5, y1: 0.2 }], text: "x" },
    style: { color: "annotation-default", stroke_width: null, alpha: null },
    body: null,
    created_at: "2026-06-29T00:00:00+00:00",
    updated_at: "2026-06-29T00:00:00+00:00",
  };
}

function commentMark(id: string, docId = "doc-1", groupId: string | null = null): Annotation {
  return {
    id,
    doc_id: docId,
    type: "comment",
    group_id: groupId,
    anchor: { kind: "rect", page_index: 0, rect: { x0: 0.1, y0: 0.1, x1: 0.1, y1: 0.1 } },
    style: { color: "annotation-default", stroke_width: null, alpha: null },
    body: "",
    created_at: "2026-06-29T00:00:00+00:00",
    updated_at: "2026-06-29T00:00:00+00:00",
  };
}

describe("inActiveGroup", () => {
  it("is false when nothing is active", () => {
    const a = textMark("a");
    expect(inActiveGroup(a, null, new Map([["a", a]]))).toBe(false);
  });

  it("is true when the mark IS the active id", () => {
    const a = textMark("a");
    expect(inActiveGroup(a, "a", new Map([["a", a]]))).toBe(true);
  });

  it("is true for a group sibling of the active mark", () => {
    const a = textMark("a", "g1");
    const b = textMark("b", "g1");
    const all = new Map([
      ["a", a],
      ["b", b],
    ]);
    expect(inActiveGroup(b, "a", all)).toBe(true);
  });

  it("is false for a different mark with no shared group", () => {
    const a = textMark("a", "g1");
    const b = textMark("b", "g2");
    const all = new Map([
      ["a", a],
      ["b", b],
    ]);
    expect(inActiveGroup(b, "a", all)).toBe(false);
  });

  it("is false when the active id resolves to nothing in the map", () => {
    const b = textMark("b");
    expect(inActiveGroup(b, "missing", new Map([["b", b]]))).toBe(false);
  });
});

describe("markClass", () => {
  it("returns the base class with no modifiers", () => {
    expect(markClass("annotation-highlight", "annotation-highlight", false, false, false)).toBe(
      "annotation-highlight",
    );
  });

  it("appends every active modifier, in order", () => {
    expect(markClass("annotation-highlight", "annotation-highlight", true, true, true)).toBe(
      "annotation-highlight annotation-highlight--hovered annotation-highlight--selected annotation-highlight--flash",
    );
  });

  it("keeps extra classes in classList untouched", () => {
    expect(markClass("annotation-highlight annotation-region", "annotation-highlight", true, false, false)).toBe(
      "annotation-highlight annotation-region annotation-highlight--hovered",
    );
  });
});

describe("unionRect", () => {
  it("takes the min top-left and max bottom-right", () => {
    const a = { x0: 0, y0: 0.2, x1: 0.4, y1: 0.5 };
    const b = { x0: 0.1, y0: 0, x1: 0.3, y1: 0.6 };
    expect(unionRect(a, b)).toEqual({ x0: 0, y0: 0, x1: 0.4, y1: 0.6 });
  });
});

describe("markBounds", () => {
  it("returns the rect as-is for a rect anchor", () => {
    const rect = { x0: 0.1, y0: 0.1, x1: 0.4, y1: 0.4 };
    expect(markBounds({ kind: "rect", page_index: 0, rect })).toEqual(rect);
  });

  it("unions every rect for a multi-line text anchor", () => {
    const rects = [
      { x0: 0.1, y0: 0.1, x1: 0.5, y1: 0.2 },
      { x0: 0.1, y0: 0.2, x1: 0.3, y1: 0.3 },
    ];
    expect(markBounds({ kind: "text", page_index: 0, rects, text: "x" })).toEqual({
      x0: 0.1,
      y0: 0.1,
      x1: 0.5,
      y1: 0.3,
    });
  });

  it("returns null for a text anchor with no rects", () => {
    expect(markBounds({ kind: "text", page_index: 0, rects: [], text: "" })).toBeNull();
  });

  it("returns the points' bounding box for a path anchor", () => {
    const points = [
      { x: 0.1, y: 0.1 },
      { x: 0.4, y: 0.3 },
    ];
    expect(markBounds({ kind: "path", page_index: 0, points })).toEqual({
      x0: 0.1,
      y0: 0.1,
      x1: 0.4,
      y1: 0.3,
    });
  });
});

describe("commentGroupIds", () => {
  it("returns just the comment's own id when it has no group", () => {
    const a = commentMark("c1");
    expect(commentGroupIds(a, new Map([["c1", a]]))).toEqual(["c1"]);
  });

  it("returns every same-doc comment sibling sharing the group_id", () => {
    const a = commentMark("c1", "doc-1", "g1");
    const b = commentMark("c2", "doc-1", "g1");
    const all = new Map([
      ["c1", a],
      ["c2", b],
    ]);
    expect(commentGroupIds(a, all).sort()).toEqual(["c1", "c2"]);
  });

  it("excludes a same-group_id mark from a different doc", () => {
    const a = commentMark("c1", "doc-1", "g1");
    const other = commentMark("c2", "doc-2", "g1");
    const all = new Map([
      ["c1", a],
      ["c2", other],
    ]);
    expect(commentGroupIds(a, all)).toEqual(["c1"]);
  });

  it("excludes a same-group_id mark that isn't type=comment", () => {
    const a = commentMark("c1", "doc-1", "g1");
    const highlight = textMark("h1", "g1");
    const all = new Map([
      ["c1", a],
      ["h1", highlight],
    ]);
    expect(commentGroupIds(a, all)).toEqual(["c1"]);
  });
});
