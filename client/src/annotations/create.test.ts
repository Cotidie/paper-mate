import { describe, it, expect } from "vitest";
import { buildAnnotations } from "./create";
import type { PageSelection } from "../anchor";

function counter() {
  let n = 0;
  return () => `id-${n++}`;
}

const opts = (newId: () => string) => ({
  now: "2026-06-29T00:00:00+00:00",
  newId,
  type: "highlight" as const,
  color: "annotation-default",
});

const page0: PageSelection = { page_index: 0, rects: [{ x0: 0.1, y0: 0.1, x1: 0.4, y1: 0.2 }], text: "hello" };
const page1: PageSelection = { page_index: 1, rects: [{ x0: 0, y0: 0, x1: 0.3, y1: 0.1 }], text: "world" };

describe("buildAnnotations (AC-3, AC-5)", () => {
  it("a single-page selection → one annotation, group_id null", () => {
    const [a] = buildAnnotations([page0], "doc-1", opts(counter()));
    expect(a.group_id).toBeNull();
    expect(a.doc_id).toBe("doc-1");
    expect(a.type).toBe("highlight");
    expect(a.anchor).toEqual({ kind: "text", page_index: 0, rects: page0.rects, text: "hello" });
    expect(a.style).toEqual({ color: "annotation-default", stroke_width: null });
    expect(a.body).toBeNull();
    expect(a.created_at).toBe("2026-06-29T00:00:00+00:00");
    expect(a.updated_at).toBe(a.created_at);
  });

  it("a two-page selection → two annotations sharing one group_id", () => {
    const anns = buildAnnotations([page0, page1], "doc-1", opts(counter()));
    expect(anns).toHaveLength(2);
    expect(anns[0].group_id).not.toBeNull();
    expect(anns[0].group_id).toBe(anns[1].group_id);
    // Distinct ids, one anchor per page.
    expect(anns[0].id).not.toBe(anns[1].id);
    expect(anns.map((a) => a.anchor.page_index)).toEqual([0, 1]);
  });

  it("renders off anchor.kind: every proof mark is a text anchor", () => {
    const anns = buildAnnotations([page0, page1], "doc-1", opts(counter()));
    expect(anns.every((a) => a.anchor.kind === "text")).toBe(true);
  });
});
