import { describe, it, expect } from "vitest";
import { bankItems } from "./bank";
import type { Annotation, Rect } from "./api/client";

function textMark(
  id: string,
  overrides: Partial<Annotation> = {},
  text = "Selected run",
  rects: Rect[] = [{ x0: 0.1, y0: 0.3, x1: 0.5, y1: 0.35 }],
): Annotation {
  return {
    id,
    doc_id: "doc-1",
    type: "highlight",
    group_id: null,
    anchor: { kind: "text", page_index: 0, rects, text },
    style: { color: "annotation-default", stroke_width: null, alpha: null },
    body: null,
    created_at: "2026-06-29T00:00:01Z",
    updated_at: "2026-06-29T00:00:01Z",
    ...overrides,
  };
}

function regionMark(id: string, overrides: Partial<Annotation> = {}): Annotation {
  return {
    id,
    doc_id: "doc-1",
    type: "highlight",
    group_id: null,
    anchor: { kind: "rect", page_index: 0, rect: { x0: 0.1, y0: 0.4, x1: 0.5, y1: 0.6 } },
    style: { color: "annotation-default", stroke_width: null, alpha: null },
    body: null,
    created_at: "2026-06-29T00:00:01Z",
    updated_at: "2026-06-29T00:00:01Z",
    ...overrides,
  };
}

function penMark(id: string, overrides: Partial<Annotation> = {}): Annotation {
  return {
    id,
    doc_id: "doc-1",
    type: "pen",
    group_id: null,
    anchor: {
      kind: "path",
      page_index: 0,
      points: [
        { x: 0.1, y: 0.5 },
        { x: 0.2, y: 0.6 },
      ],
    },
    style: { color: "annotation-blue", stroke_width: 4, alpha: null },
    body: null,
    created_at: "2026-06-29T00:00:01Z",
    updated_at: "2026-06-29T00:00:01Z",
    ...overrides,
  };
}

function memoMark(id: string, body: string | null, overrides: Partial<Annotation> = {}): Annotation {
  return {
    id,
    doc_id: "doc-1",
    type: "memo",
    group_id: null,
    anchor: { kind: "rect", page_index: 0, rect: { x0: 0.1, y0: 0.2, x1: 0.4, y1: 0.3 } },
    style: { color: "annotation-pink", stroke_width: null, alpha: null },
    body,
    created_at: "2026-06-29T00:00:01Z",
    updated_at: "2026-06-29T00:00:01Z",
    ...overrides,
  };
}

function commentMark(
  id: string,
  body: string | null,
  kind: "text" | "rect" = "rect",
  overrides: Partial<Annotation> = {},
): Annotation {
  const anchor: Annotation["anchor"] =
    kind === "text"
      ? { kind: "text", page_index: 0, rects: [{ x0: 0.1, y0: 0.1, x1: 0.3, y1: 0.15 }], text: "anchored run" }
      : { kind: "rect", page_index: 0, rect: { x0: 0.2, y0: 0.3, x1: 0.2, y1: 0.3 } };
  return {
    id,
    doc_id: "doc-1",
    type: "comment",
    group_id: null,
    anchor,
    style: { color: "annotation-default", stroke_width: null, alpha: null },
    body,
    created_at: "2026-06-29T00:00:01Z",
    updated_at: "2026-06-29T00:00:01Z",
    ...overrides,
  };
}

describe("bankItems (Story 3.6, AC #2, #4)", () => {
  it("orders rows by created_at ascending", () => {
    const rows = bankItems(
      [
        textMark("late", { created_at: "2026-06-29T00:00:09Z" }),
        textMark("early", { created_at: "2026-06-29T00:00:01Z" }),
      ],
      "doc-1",
    );
    expect(rows.map((r) => r.id)).toEqual(["early", "late"]);
  });

  it("dedups a group_id-shared pair into ONE row, keeping the earliest sibling", () => {
    const rows = bankItems(
      [
        textMark("b", {
          group_id: "g1",
          created_at: "2026-06-29T00:00:02Z",
          anchor: { kind: "text", page_index: 1, rects: [], text: "page2 half" },
        }),
        textMark("a", { group_id: "g1", created_at: "2026-06-29T00:00:01Z" }),
      ],
      "doc-1",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("a");
    expect(rows[0].pageIndex).toBe(0);
  });

  it("never dedups marks with group_id === null", () => {
    const rows = bankItems([textMark("a"), textMark("b", { created_at: "2026-06-29T00:00:02Z" })], "doc-1");
    expect(rows).toHaveLength(2);
  });

  it("filters to the given doc_id; a foreign-doc mark is excluded", () => {
    const rows = bankItems([textMark("mine", { doc_id: "doc-1" }), textMark("other", { doc_id: "doc-2" })], "doc-1");
    expect(rows.map((r) => r.id)).toEqual(["mine"]);
  });

  it("excludes pen strokes and underlines; only highlight/memo/comment appear", () => {
    const rows = bankItems(
      [
        penMark("pen"),
        textMark("underline", { type: "underline" }),
        textMark("highlight"),
        memoMark("memo", "note"),
        commentMark("comment", "reply"),
      ],
      "doc-1",
    );
    expect(rows.map((r) => r.id)).toEqual(["highlight", "memo", "comment"]);
  });

  describe("snippet selection", () => {
    it("kind=text uses anchor.text, not a placeholder", () => {
      const [row] = bankItems([textMark("a", {}, "Theorem 1")], "doc-1");
      expect(row.snippet).toBe("Theorem 1");
      expect(row.isPlaceholder).toBe(false);
    });

    it("memo/comment with a non-empty body uses the body, not the anchored run", () => {
      const [memo] = bankItems([memoMark("m", "a note")], "doc-1");
      expect(memo.snippet).toBe("a note");
      expect(memo.isPlaceholder).toBe(false);

      const [comment] = bankItems([commentMark("c", "reply", "text")], "doc-1");
      expect(comment.snippet).toBe("reply");
      expect(comment.isPlaceholder).toBe(false);
    });

    it("a region highlight (kind=rect) gets a placeholder label", () => {
      const [region] = bankItems([regionMark("r")], "doc-1");
      expect(region.snippet).toBe("Region");
      expect(region.isPlaceholder).toBe(true);
    });

    it("an empty/whitespace-only body falls back to the type label", () => {
      const [memo] = bankItems([memoMark("m", "   ")], "doc-1");
      expect(memo.snippet).toBe("Memo");
      expect(memo.isPlaceholder).toBe(true);

      const [comment] = bankItems([commentMark("c", null)], "doc-1");
      expect(comment.snippet).toBe("Comment");
      expect(comment.isPlaceholder).toBe(true);
    });

    it("an empty anchor.text falls back to the type label", () => {
      const [row] = bankItems([textMark("a", {}, "   ")], "doc-1");
      expect(row.snippet).toBe("Highlight");
      expect(row.isPlaceholder).toBe(true);
    });

    it("collapses internal newlines to spaces", () => {
      const [row] = bankItems([textMark("a", {}, "line one\nline two")], "doc-1");
      expect(row.snippet).toBe("line one line two");
    });
  });

  describe("topFraction + page", () => {
    it("kind=text: the min y0 across all rects", () => {
      const [row] = bankItems(
        [
          textMark("a", {}, "x", [
            { x0: 0.1, y0: 0.5, x1: 0.4, y1: 0.55 },
            { x0: 0.1, y0: 0.2, x1: 0.4, y1: 0.25 },
          ]),
        ],
        "doc-1",
      );
      expect(row.topFraction).toBe(0.2);
    });

    it("kind=rect: rect.y0", () => {
      const [row] = bankItems([regionMark("r")], "doc-1");
      expect(row.topFraction).toBe(0.4);
    });

    it("page = page_index + 1", () => {
      const [row] = bankItems(
        [textMark("a", { anchor: { kind: "text", page_index: 3, rects: [], text: "x" } })],
        "doc-1",
      );
      expect(row.page).toBe(4);
      expect(row.pageIndex).toBe(3);
    });
  });

  it("colorToken is the mark's style.color", () => {
    const [row] = bankItems(
      [textMark("a", { style: { color: "annotation-green", stroke_width: null, alpha: null } })],
      "doc-1",
    );
    expect(row.colorToken).toBe("annotation-green");
  });

  it("returns [] for no annotations", () => {
    expect(bankItems([], "doc-1")).toEqual([]);
  });
});
