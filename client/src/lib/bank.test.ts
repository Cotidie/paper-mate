import { describe, it, expect } from "vitest";
import { bankItems, filterBankItems, BANK_FILTER_TYPES, type BankItem } from "./bank";
import type { Annotation, Rect } from "@/api/client";

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

describe("bankItems (Story 8.3, reading order)", () => {
  it("AC-1: rows on different pages sort by page ascending, regardless of created_at", () => {
    const rows = bankItems(
      [
        textMark("page2", {
          created_at: "2026-06-29T00:00:01Z",
          anchor: { kind: "text", page_index: 1, rects: [{ x0: 0.1, y0: 0.1, x1: 0.4, y1: 0.15 }], text: "x" },
        }),
        textMark("page1", {
          created_at: "2026-06-29T00:00:09Z",
          anchor: { kind: "text", page_index: 0, rects: [{ x0: 0.1, y0: 0.9, x1: 0.4, y1: 0.95 }], text: "x" },
        }),
      ],
      "doc-1",
    );
    expect(rows.map((r) => r.id)).toEqual(["page1", "page2"]);
  });

  it("AC-1: rows on one page sort top-to-bottom by y0", () => {
    const rows = bankItems(
      [
        textMark("bottom", {}, "x", [{ x0: 0.1, y0: 0.8, x1: 0.4, y1: 0.85 }]),
        textMark("top", {}, "x", [{ x0: 0.1, y0: 0.1, x1: 0.4, y1: 0.15 }]),
      ],
      "doc-1",
    );
    expect(rows.map((r) => r.id)).toEqual(["top", "bottom"]);
  });

  it("AC-1: two marks at near-equal y0 (within epsilon) sort left-to-right by x0", () => {
    const rows = bankItems(
      [
        textMark("right", {}, "x", [{ x0: 0.6, y0: 0.301, x1: 0.9, y1: 0.35 }]),
        textMark("left", {}, "x", [{ x0: 0.1, y0: 0.3, x1: 0.4, y1: 0.35 }]),
      ],
      "doc-1",
    );
    expect(rows.map((r) => r.id)).toEqual(["left", "right"]);
  });

  it("AC-1: the epsilon band is transitive — a chain of near-equal-y marks sorts the same regardless of input order (Codex review finding)", () => {
    // y0 = 0, 0.009, 0.018: each CONSECUTIVE pair is within the 0.01 epsilon,
    // but the first/last pair (0.018 apart) is not — the classic case where a
    // pairwise "within epsilon counts as equal" comparator is non-transitive
    // (A ties B, B ties C, but A strictly precedes C), so `Array.sort` (which
    // assumes a total order) can return a DIFFERENT result depending on the
    // input's original order. Descending x0 makes the left-to-right tie-break
    // disagree with the top-to-bottom order, so a non-transitive comparator
    // would visibly disagree across permutations.
    const a = textMark("a", {}, "x", [{ x0: 0.9, y0: 0, x1: 1.0, y1: 0.02 }]);
    const b = textMark("b", {}, "x", [{ x0: 0.5, y0: 0.009, x1: 0.6, y1: 0.03 }]);
    const c = textMark("c", {}, "x", [{ x0: 0.1, y0: 0.018, x1: 0.2, y1: 0.04 }]);
    const permutations = [
      [a, b, c],
      [c, b, a],
      [b, a, c],
      [a, c, b],
    ];
    const results = permutations.map((marks) => bankItems(marks, "doc-1").map((r) => r.id));
    for (const result of results) {
      expect(result).toEqual(results[0]);
    }
  });

  it("AC-1: two marks with identical (page, y0, x0) fall back to created_at order", () => {
    const rows = bankItems(
      [
        textMark("later", { created_at: "2026-06-29T00:00:09Z" }, "x", [
          { x0: 0.1, y0: 0.3, x1: 0.4, y1: 0.35 },
        ]),
        textMark("earlier", { created_at: "2026-06-29T00:00:01Z" }, "x", [
          { x0: 0.1, y0: 0.3, x1: 0.4, y1: 0.35 },
        ]),
      ],
      "doc-1",
    );
    expect(rows.map((r) => r.id)).toEqual(["earlier", "later"]);
  });

  it("AC-3: a region (kind=rect) and a pen (kind=path) sort by their bbox top-left, alongside text marks", () => {
    const rows = bankItems(
      [
        textMark("text", {}, "x", [{ x0: 0.1, y0: 0.5, x1: 0.4, y1: 0.55 }]),
        regionMark("region", { anchor: { kind: "rect", page_index: 0, rect: { x0: 0.1, y0: 0.2, x1: 0.5, y1: 0.3 } } }),
        penMark("pen", {
          anchor: {
            kind: "path",
            page_index: 0,
            points: [
              { x: 0.1, y: 0.8 },
              { x: 0.2, y: 0.9 },
            ],
          },
        }),
      ],
      "doc-1",
    );
    expect(rows.map((r) => r.id)).toEqual(["region", "text", "pen"]);
  });

  it("AC-3: a region and a pen on the SAME row sort by their bbox LEFT, not just Y (Codex review finding)", () => {
    const rows = bankItems(
      [
        regionMark("region-right", {
          anchor: { kind: "rect", page_index: 0, rect: { x0: 0.6, y0: 0.5, x1: 0.9, y1: 0.55 } },
        }),
        penMark("pen-left", {
          anchor: {
            kind: "path",
            page_index: 0,
            points: [
              { x: 0.1, y: 0.5 },
              { x: 0.2, y: 0.51 },
            ],
          },
        }),
      ],
      "doc-1",
    );
    expect(rows.map((r) => r.id)).toEqual(["pen-left", "region-right"]);
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

  it("AC-2: dedup keeps the earliest-PAGE sibling even when it was created LAST", () => {
    const rows = bankItems(
      [
        textMark("page1-sibling", {
          group_id: "g1",
          created_at: "2026-06-29T00:00:01Z",
          anchor: { kind: "text", page_index: 1, rects: [{ x0: 0.1, y0: 0.1, x1: 0.4, y1: 0.15 }], text: "page2 half" },
        }),
        textMark("page0-sibling", {
          group_id: "g1",
          created_at: "2026-06-29T00:00:09Z",
          anchor: { kind: "text", page_index: 0, rects: [{ x0: 0.1, y0: 0.8, x1: 0.4, y1: 0.85 }], text: "page1 half" },
        }),
      ],
      "doc-1",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("page0-sibling");
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

  it("lists all five types: pen and underline appear alongside highlight/memo/comment", () => {
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
    expect(new Set(rows.map((r) => r.id))).toEqual(new Set(["pen", "underline", "highlight", "memo", "comment"]));
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

describe("filterBankItems (Story 8.2, AC #2, #4)", () => {
  const rows = bankItems(
    [
      penMark("pen", { created_at: "2026-06-29T00:00:01Z" }),
      textMark("underline", { type: "underline", created_at: "2026-06-29T00:00:02Z" }),
      textMark("highlight", { created_at: "2026-06-29T00:00:03Z" }),
      memoMark("memo", "note", { created_at: "2026-06-29T00:00:04Z" }),
      commentMark("comment", "reply", "rect", { created_at: "2026-06-29T00:00:05Z" }),
    ],
    "doc-1",
  );

  it("comments-only narrows to just the comment row", () => {
    expect(filterBankItems(rows, new Set(["comment"])).map((r) => r.id)).toEqual(["comment"]);
  });

  it("a multi-type set includes exactly those types, in reading order (memo top=.2, pen top=.5)", () => {
    expect(filterBankItems(rows, new Set(["pen", "memo"])).map((r) => r.id)).toEqual(["memo", "pen"]);
  });

  it("the empty set yields []", () => {
    expect(filterBankItems(rows, new Set())).toEqual([]);
  });

  it("preserves input order (composes with sort)", () => {
    expect(filterBankItems(rows, new Set(BANK_FILTER_TYPES)).map((r) => r.id)).toEqual(rows.map((r: BankItem) => r.id));
  });

  it("AC-4: a filtered subset stays in reading order (composed filterBankItems(bankItems(...)))", () => {
    const filtered = filterBankItems(rows, new Set(["underline", "highlight", "comment"]));
    expect(filtered.map((r) => r.id)).toEqual(["underline", "highlight", "comment"]);
    for (let i = 1; i < filtered.length; i++) {
      expect(filtered[i].pageIndex).toBeGreaterThanOrEqual(filtered[i - 1].pageIndex);
    }
  });
});
