import { describe, it, expect } from "vitest";
import { buildAnnotations, buildPenAnnotation, buildMemoAnnotation, buildCommentPin, buildRegionAnnotation } from "./create";
import type { PageSelection } from "@/anchor";

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
    expect(a.style).toEqual({ color: "annotation-default", stroke_width: null, alpha: null });
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

describe("buildPenAnnotation (Story 2.8 + 2.13, AD-5 pen → path)", () => {
  const penOpts = (newId: () => string) => ({
    now: "2026-06-29T00:00:00+00:00",
    newId,
    color: "annotation-green",
    strokeWidth: 4,
    alpha: 0.4,
  });
  const stroke = {
    page_index: 2,
    points: [
      { x: 0.1, y: 0.1 },
      { x: 0.2, y: 0.15 },
      { x: 0.3, y: 0.2 },
    ],
  };

  it("builds one single-page pen mark with a path anchor + null group", () => {
    const a = buildPenAnnotation(stroke, "doc-1", penOpts(counter()));
    expect(a.type).toBe("pen");
    expect(a.group_id).toBeNull();
    expect(a.doc_id).toBe("doc-1");
    expect(a.anchor).toEqual({ kind: "path", page_index: 2, points: stroke.points });
    expect(a.body).toBeNull();
    expect(a.created_at).toBe("2026-06-29T00:00:00+00:00");
    expect(a.updated_at).toBe(a.created_at);
  });

  it("carries color + stroke_width + alpha in style (path-only fields, AR-5)", () => {
    const a = buildPenAnnotation(stroke, "doc-1", penOpts(counter()));
    expect(a.style).toEqual({ color: "annotation-green", stroke_width: 4, alpha: 0.4 });
  });

  it("carries a non-default alpha when specified", () => {
    const a = buildPenAnnotation(stroke, "doc-1", { ...penOpts(counter()), alpha: 0.8 });
    expect(a.style.alpha).toBe(0.8);
  });
});

describe("buildMemoAnnotation (Story 2.9, AD-5 memo → rect; alpha added by fix request)", () => {
  const memoOpts = (newId: () => string) => ({
    now: "2026-06-29T00:00:00+00:00",
    newId,
    color: "annotation-blue",
    alpha: 0.4,
  });
  const placement = { page_index: 3, rect: { x0: 0.2, y0: 0.3, x1: 0.5, y1: 0.45 } };

  it("builds one single-page memo with a rect anchor, null group, and empty body", () => {
    const a = buildMemoAnnotation(placement, "doc-1", memoOpts(counter()));
    expect(a.type).toBe("memo");
    expect(a.group_id).toBeNull();
    expect(a.doc_id).toBe("doc-1");
    expect(a.anchor).toEqual({ kind: "rect", page_index: 3, rect: placement.rect });
    // The FIRST mark with a non-null body — starts as "" (not null).
    expect(a.body).toBe("");
    expect(a.created_at).toBe("2026-06-29T00:00:00+00:00");
    expect(a.updated_at).toBe(a.created_at);
  });

  it("carries the accent color + alpha; stroke_width stays null (memo has no stroke)", () => {
    const a = buildMemoAnnotation(placement, "doc-1", memoOpts(counter()));
    expect(a.style).toEqual({ color: "annotation-blue", stroke_width: null, alpha: 0.4 });
  });

  it("carries a non-default alpha when specified", () => {
    const a = buildMemoAnnotation(placement, "doc-1", { ...memoOpts(counter()), alpha: 0.8 });
    expect(a.style.alpha).toBe(0.8);
  });
});

describe("buildAnnotations body param (Story 2.10 — AC1,3)", () => {
  it("a comment DRAG passes body='' → a kind=text comment with non-null body", () => {
    const [a] = buildAnnotations([page0], "doc-1", {
      now: "2026-06-29T00:00:00+00:00",
      newId: counter(),
      type: "comment",
      color: "annotation-default",
      body: "",
    });
    expect(a.type).toBe("comment");
    expect(a.anchor.kind).toBe("text");
    expect(a.body).toBe("");
  });

  it("highlight/underline omit body → it stays null (regression)", () => {
    const [h] = buildAnnotations([page0], "doc-1", opts(counter()));
    expect(h.body).toBeNull();
  });
});

describe("buildRegionAnnotation (Story 2.11, AD-5 highlight → rect)", () => {
  const regionOpts = (newId: () => string) => ({
    now: "2026-06-29T00:00:00+00:00",
    newId,
    color: "annotation-green",
  });
  const placement = { page_index: 2, rect: { x0: 0.1, y0: 0.2, x1: 0.6, y1: 0.7 } };

  it("builds one region highlight: type=highlight, kind=rect, null body, null group", () => {
    const a = buildRegionAnnotation(placement, "doc-1", regionOpts(counter()));
    expect(a.type).toBe("highlight");
    expect(a.group_id).toBeNull();
    expect(a.doc_id).toBe("doc-1");
    expect(a.anchor).toEqual({ kind: "rect", page_index: 2, rect: placement.rect });
    expect(a.body).toBeNull();
    expect(a.created_at).toBe("2026-06-29T00:00:00+00:00");
    expect(a.updated_at).toBe(a.created_at);
  });

  it("carries accent color; stroke_width null (region has no stroke, AR-5)", () => {
    const a = buildRegionAnnotation(placement, "doc-1", regionOpts(counter()));
    expect(a.style).toEqual({ color: "annotation-green", stroke_width: null, alpha: null });
  });
});

describe("buildCommentPin (Story 2.10, AD-5 comment → rect)", () => {
  const pinOpts = (newId: () => string) => ({
    now: "2026-06-29T00:00:00+00:00",
    newId,
    color: "annotation-purple",
  });
  const placement = { page_index: 4, rect: { x0: 0.25, y0: 0.35, x1: 0.25, y1: 0.35 } };

  it("builds one single-page comment pin: type=comment, kind=rect, empty body, null group", () => {
    const a = buildCommentPin(placement, "doc-1", pinOpts(counter()));
    expect(a.type).toBe("comment");
    expect(a.group_id).toBeNull();
    expect(a.doc_id).toBe("doc-1");
    expect(a.anchor).toEqual({ kind: "rect", page_index: 4, rect: placement.rect });
    expect(a.body).toBe("");
    expect(a.created_at).toBe("2026-06-29T00:00:00+00:00");
    expect(a.updated_at).toBe(a.created_at);
  });

  it("carries the accent color; stroke_width stays null (a pin has no stroke)", () => {
    const a = buildCommentPin(placement, "doc-1", pinOpts(counter()));
    expect(a.style).toEqual({ color: "annotation-purple", stroke_width: null, alpha: null });
  });
});
