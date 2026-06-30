import { describe, it, expect } from "vitest";
import type { Annotation } from "../api/client";
import { ANNOTATION_TOOLS } from "../tools";
import { MARK_DESCRIPTORS, quickBoxSpec } from "./marks";

function anno(type: Annotation["type"], kind: Annotation["anchor"]["kind"]): Annotation {
  const base = { id: "a", doc_id: "d", type, group_id: null, style: { color: "annotation-default", stroke_width: null, alpha: null }, body: null, created_at: "t", updated_at: "t" };
  if (kind === "text") return { ...base, anchor: { kind, page_index: 0, rects: [], text: "" } };
  if (kind === "path") return { ...base, anchor: { kind, page_index: 0, points: [] } };
  return { ...base, anchor: { kind, page_index: 0, rect: { x0: 0, y0: 0, x1: 1, y1: 1 } } };
}

describe("MARK_DESCRIPTORS (Story 5.0 registry)", () => {
  it("has exactly one descriptor per annotation tool", () => {
    expect(Object.keys(MARK_DESCRIPTORS).sort()).toEqual([...ANNOTATION_TOOLS].sort());
    for (const tool of ANNOTATION_TOOLS) expect(MARK_DESCRIPTORS[tool].type).toBe(tool);
  });

  it("maps each tool to its canonical create geometry kind (AD-5)", () => {
    expect(MARK_DESCRIPTORS.highlight.kind).toBe("text");
    expect(MARK_DESCRIPTORS.underline.kind).toBe("text");
    expect(MARK_DESCRIPTORS.pen.kind).toBe("path");
    expect(MARK_DESCRIPTORS.memo.kind).toBe("rect");
    expect(MARK_DESCRIPTORS.comment.kind).toBe("rect");
  });
});

describe("quickBoxSpec (selection quick-box capability)", () => {
  it("pen → stroke-width + alpha rows, Pen actions label", () => {
    const s = quickBoxSpec(anno("pen", "path"));
    expect(s).toMatchObject({ strokeWidth: true, alpha: true, size: false, usesBubble: false, ariaLabel: "Pen actions" });
  });

  it("memo → no rows (Story 3.1 dropped the size picker), Memo actions label", () => {
    const s = quickBoxSpec(anno("memo", "rect"));
    expect(s).toMatchObject({ strokeWidth: false, alpha: false, size: false, usesBubble: false, ariaLabel: "Memo actions" });
  });

  it("comment → routed to the bubble (generic box gated off), either kind", () => {
    expect(quickBoxSpec(anno("comment", "text")).usesBubble).toBe(true);
    expect(quickBoxSpec(anno("comment", "rect")).usesBubble).toBe(true);
  });

  it("highlight + underline → no extra rows, Highlight actions label (text or region)", () => {
    for (const a of [anno("highlight", "text"), anno("highlight", "rect"), anno("underline", "text")]) {
      const s = quickBoxSpec(a);
      expect(s).toMatchObject({ strokeWidth: false, alpha: false, size: false, usesBubble: false, ariaLabel: "Highlight actions" });
    }
  });
});
