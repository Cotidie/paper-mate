import { describe, it, expect, beforeEach, vi } from "vitest";
import { useAnnotationStore, hydrateStore, flashAnnotation, FLASH_MS, DEFAULT_MEMO_SIZE, MEMO_SIZES } from "./index";
import type { Annotation } from "@/api/client";

function mark(id: string, color: string, createdAt: string, groupId: string | null = null): Annotation {
  return {
    id,
    doc_id: "doc-1",
    type: "highlight",
    group_id: groupId,
    anchor: { kind: "text", page_index: 0, rects: [], text: "x" },
    style: { color, stroke_width: null, alpha: null },
    body: null,
    created_at: createdAt,
    updated_at: createdAt,
  };
}

beforeEach(() => {
  useAnnotationStore.setState({
    annotations: new Map(),
    selectedId: null,
    multiSelectedIds: [],
    hoveredId: null,
    dragPreview: null,
    groupDragPreview: null,
    flashId: null,
    activeColors: {
      highlight: "annotation-default",
      underline: "annotation-default",
      pen: "annotation-default",
      memo: "annotation-default",
      comment: "annotation-default",
    },
    activeStrokeWidth: 4,
    activeMemoSize: DEFAULT_MEMO_SIZE,
    activeAlpha: 0.4,
  });
  // Reset temporal history so undo/redo state never leaks between tests.
  useAnnotationStore.temporal.getState().clear();
});

function memoMark(
  id: string,
  rect: { x0: number; y0: number; x1: number; y1: number },
  createdAt: string,
  body = "",
): Annotation {
  return {
    id,
    doc_id: "doc-1",
    type: "memo",
    group_id: null,
    anchor: { kind: "rect", page_index: 0, rect },
    style: { color: "annotation-default", stroke_width: null, alpha: null },
    body,
    created_at: createdAt,
    updated_at: createdAt,
  };
}

describe("annotation store (Story 2.2 + 2.3)", () => {
  it("addAnnotation keys by id; all() orders by created_at ascending", () => {
    const s = useAnnotationStore.getState();
    s.addAnnotation(mark("b", "annotation-default", "2026-06-29T00:00:02Z"));
    s.addAnnotation(mark("a", "annotation-default", "2026-06-29T00:00:01Z"));
    const all = useAnnotationStore.getState().all();
    expect(all.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("recolorAnnotation changes style.color + bumps updated_at, keyed by id", () => {
    const s = useAnnotationStore.getState();
    s.addAnnotation(mark("a", "annotation-default", "2026-06-29T00:00:01Z"));
    useAnnotationStore.getState().recolorAnnotation(["a"], "annotation-green", "2026-06-29T12:00:00Z");
    const a = useAnnotationStore.getState().annotations.get("a")!;
    expect(a.style.color).toBe("annotation-green");
    expect(a.updated_at).toBe("2026-06-29T12:00:00Z");
    expect(a.created_at).toBe("2026-06-29T00:00:01Z");
  });

  it("recolorAnnotation recolors a whole group together (two-page case)", () => {
    const s = useAnnotationStore.getState();
    s.addAnnotation(mark("a", "annotation-default", "2026-06-29T00:00:01Z"));
    s.addAnnotation(mark("b", "annotation-default", "2026-06-29T00:00:01Z"));
    useAnnotationStore.getState().recolorAnnotation(["a", "b"], "annotation-pink", "2026-06-29T12:00:00Z");
    const map = useAnnotationStore.getState().annotations;
    expect(map.get("a")!.style.color).toBe("annotation-pink");
    expect(map.get("b")!.style.color).toBe("annotation-pink");
  });

  it("recolorAnnotation ignores unknown ids without throwing", () => {
    useAnnotationStore.getState().recolorAnnotation(["missing"], "annotation-blue", "2026-06-29T12:00:00Z");
    expect(useAnnotationStore.getState().annotations.size).toBe(0);
  });
});

describe("selection + delete (Story 2.5)", () => {
  it("starts with no selection", () => {
    expect(useAnnotationStore.getState().selectedId).toBeNull();
  });

  it("select sets selectedId; select(null)/clearSelection clears it", () => {
    const s = useAnnotationStore.getState();
    s.addAnnotation(mark("a", "annotation-default", "2026-06-29T00:00:01Z"));
    s.select("a");
    expect(useAnnotationStore.getState().selectedId).toBe("a");
    useAnnotationStore.getState().select(null);
    expect(useAnnotationStore.getState().selectedId).toBeNull();
    useAnnotationStore.getState().select("a");
    useAnnotationStore.getState().clearSelection();
    expect(useAnnotationStore.getState().selectedId).toBeNull();
  });

  it("deleteAnnotation removes the mark by id", () => {
    const s = useAnnotationStore.getState();
    s.addAnnotation(mark("a", "annotation-default", "2026-06-29T00:00:01Z"));
    s.addAnnotation(mark("b", "annotation-default", "2026-06-29T00:00:02Z"));
    useAnnotationStore.getState().deleteAnnotation("a");
    const map = useAnnotationStore.getState().annotations;
    expect(map.has("a")).toBe(false);
    expect(map.has("b")).toBe(true);
  });

  it("deleteAnnotation removes group siblings together (two-page highlight, AR-4)", () => {
    const s = useAnnotationStore.getState();
    s.addAnnotation(mark("a", "annotation-default", "2026-06-29T00:00:01Z", "g1"));
    s.addAnnotation(mark("b", "annotation-default", "2026-06-29T00:00:01Z", "g1"));
    s.addAnnotation(mark("c", "annotation-default", "2026-06-29T00:00:02Z", null));
    useAnnotationStore.getState().deleteAnnotation("a");
    const map = useAnnotationStore.getState().annotations;
    expect(map.has("a")).toBe(false);
    expect(map.has("b")).toBe(false);
    expect(map.has("c")).toBe(true);
  });

  it("deleting the selected mark clears selectedId", () => {
    const s = useAnnotationStore.getState();
    s.addAnnotation(mark("a", "annotation-default", "2026-06-29T00:00:01Z", "g1"));
    s.addAnnotation(mark("b", "annotation-default", "2026-06-29T00:00:01Z", "g1"));
    useAnnotationStore.getState().select("b");
    useAnnotationStore.getState().deleteAnnotation("a"); // b is a group sibling
    expect(useAnnotationStore.getState().selectedId).toBeNull();
  });

  it("deleting a non-selected mark leaves selectedId intact", () => {
    const s = useAnnotationStore.getState();
    s.addAnnotation(mark("a", "annotation-default", "2026-06-29T00:00:01Z"));
    s.addAnnotation(mark("b", "annotation-default", "2026-06-29T00:00:02Z"));
    useAnnotationStore.getState().select("b");
    useAnnotationStore.getState().deleteAnnotation("a");
    expect(useAnnotationStore.getState().selectedId).toBe("b");
  });
});

describe("multi-selection (box-select, user feature request) — mutual exclusion with selectedId", () => {
  it("starts with no multi-selection", () => {
    expect(useAnnotationStore.getState().multiSelectedIds).toEqual([]);
  });

  it("setMultiSelected sets the ids AND clears any single selection", () => {
    const s = useAnnotationStore.getState();
    s.addAnnotation(mark("a", "annotation-default", "2026-06-29T00:00:01Z"));
    s.select("a");
    useAnnotationStore.getState().setMultiSelected(["a", "b"]);
    expect(useAnnotationStore.getState().multiSelectedIds).toEqual(["a", "b"]);
    expect(useAnnotationStore.getState().selectedId).toBeNull();
  });

  it("select(id) clears any active multi-selection", () => {
    useAnnotationStore.getState().setMultiSelected(["a", "b"]);
    useAnnotationStore.getState().select("a");
    expect(useAnnotationStore.getState().selectedId).toBe("a");
    expect(useAnnotationStore.getState().multiSelectedIds).toEqual([]);
  });

  it("clearSelection also clears a multi-selection", () => {
    useAnnotationStore.getState().setMultiSelected(["a", "b"]);
    useAnnotationStore.getState().clearSelection();
    expect(useAnnotationStore.getState().multiSelectedIds).toEqual([]);
  });

  it("clearMultiSelection clears only the multi-selection", () => {
    useAnnotationStore.getState().setMultiSelected(["a", "b"]);
    useAnnotationStore.getState().clearMultiSelection();
    expect(useAnnotationStore.getState().multiSelectedIds).toEqual([]);
  });
});

describe("deleteMany (box-select bulk delete, user feature request)", () => {
  it("removes every listed mark in ONE batch", () => {
    const s = useAnnotationStore.getState();
    s.addAnnotation(mark("a", "annotation-default", "2026-06-29T00:00:01Z"));
    s.addAnnotation(mark("b", "annotation-default", "2026-06-29T00:00:02Z"));
    s.addAnnotation(mark("c", "annotation-default", "2026-06-29T00:00:03Z"));
    useAnnotationStore.getState().deleteMany(["a", "c"]);
    const map = useAnnotationStore.getState().annotations;
    expect(map.has("a")).toBe(false);
    expect(map.has("b")).toBe(true);
    expect(map.has("c")).toBe(false);
  });

  it("also removes each id's group siblings (AR-4), even a sibling not explicitly listed", () => {
    const s = useAnnotationStore.getState();
    s.addAnnotation(mark("a", "annotation-default", "2026-06-29T00:00:01Z", "g1"));
    s.addAnnotation(mark("b", "annotation-default", "2026-06-29T00:00:01Z", "g1"));
    s.addAnnotation(mark("c", "annotation-default", "2026-06-29T00:00:02Z", null));
    useAnnotationStore.getState().deleteMany(["a"]);
    const map = useAnnotationStore.getState().annotations;
    expect(map.has("a")).toBe(false);
    expect(map.has("b")).toBe(false); // sibling, not explicitly listed
    expect(map.has("c")).toBe(true);
  });

  it("clears the multi-selection unconditionally, even for a no-op call", () => {
    useAnnotationStore.getState().setMultiSelected(["a", "b"]);
    useAnnotationStore.getState().deleteMany([]);
    expect(useAnnotationStore.getState().multiSelectedIds).toEqual([]);
  });

  it("clears selectedId only if it was among the deleted", () => {
    const s = useAnnotationStore.getState();
    s.addAnnotation(mark("a", "annotation-default", "2026-06-29T00:00:01Z"));
    s.addAnnotation(mark("b", "annotation-default", "2026-06-29T00:00:02Z"));
    useAnnotationStore.getState().select("b");
    // A direct select() call, not setMultiSelected — mimics a mixed state where a
    // single mark stays selected while a bulk delete runs elsewhere.
    useAnnotationStore.getState().deleteMany(["a"]);
    expect(useAnnotationStore.getState().selectedId).toBe("b");
  });

  it("ignores unknown ids without throwing", () => {
    useAnnotationStore.getState().deleteMany(["missing"]);
    expect(useAnnotationStore.getState().annotations.size).toBe(0);
  });
});

describe("setAnnotationGeometries (box-select group move, user feature request)", () => {
  it("commits every {id, anchor} pair in ONE batch", () => {
    const s = useAnnotationStore.getState();
    s.addAnnotation(memoMark("m1", { x0: 0.1, y0: 0.1, x1: 0.3, y1: 0.3 }, "2026-06-29T00:00:01Z"));
    s.addAnnotation(memoMark("m2", { x0: 0.5, y0: 0.5, x1: 0.7, y1: 0.7 }, "2026-06-29T00:00:02Z"));
    useAnnotationStore.getState().setAnnotationGeometries(
      [
        { id: "m1", anchor: { kind: "rect", page_index: 0, rect: { x0: 0.2, y0: 0.2, x1: 0.4, y1: 0.4 } } },
        { id: "m2", anchor: { kind: "rect", page_index: 0, rect: { x0: 0.6, y0: 0.6, x1: 0.8, y1: 0.8 } } },
      ],
      "2026-06-29T12:00:00Z",
    );
    const map = useAnnotationStore.getState().annotations;
    const a1 = map.get("m1")!;
    const a2 = map.get("m2")!;
    if (a1.anchor.kind === "rect") expect(a1.anchor.rect).toEqual({ x0: 0.2, y0: 0.2, x1: 0.4, y1: 0.4 });
    if (a2.anchor.kind === "rect") expect(a2.anchor.rect).toEqual({ x0: 0.6, y0: 0.6, x1: 0.8, y1: 0.8 });
    expect(a1.updated_at).toBe("2026-06-29T12:00:00Z");
    expect(a2.updated_at).toBe("2026-06-29T12:00:00Z");
  });

  it("skips an unknown id without throwing, committing the rest", () => {
    const s = useAnnotationStore.getState();
    s.addAnnotation(memoMark("m1", { x0: 0.1, y0: 0.1, x1: 0.3, y1: 0.3 }, "2026-06-29T00:00:01Z"));
    useAnnotationStore.getState().setAnnotationGeometries(
      [
        { id: "missing", anchor: { kind: "rect", page_index: 0, rect: { x0: 0, y0: 0, x1: 0.1, y1: 0.1 } } },
        { id: "m1", anchor: { kind: "rect", page_index: 0, rect: { x0: 0.2, y0: 0.2, x1: 0.4, y1: 0.4 } } },
      ],
      "2026-06-29T12:00:00Z",
    );
    const a1 = useAnnotationStore.getState().annotations.get("m1")!;
    if (a1.anchor.kind === "rect") expect(a1.anchor.rect).toEqual({ x0: 0.2, y0: 0.2, x1: 0.4, y1: 0.4 });
  });

  it("skips a kind change (rejects a discriminator mismatch, AC-8), leaving that mark untouched", () => {
    const s = useAnnotationStore.getState();
    s.addAnnotation(memoMark("m1", { x0: 0.1, y0: 0.1, x1: 0.3, y1: 0.3 }, "2026-06-29T00:00:01Z"));
    useAnnotationStore.getState().setAnnotationGeometries(
      [{ id: "m1", anchor: { kind: "path", page_index: 0, points: [{ x: 0.1, y: 0.1 }] } }],
      "2026-06-29T12:00:00Z",
    );
    const a1 = useAnnotationStore.getState().annotations.get("m1")!;
    expect(a1.anchor.kind).toBe("rect"); // unchanged
    expect(a1.updated_at).toBe("2026-06-29T00:00:01Z"); // not bumped
  });

  it("an all-skipped batch is a true no-op (preserves the Map reference, zundo equality guard)", () => {
    const before = useAnnotationStore.getState().annotations;
    useAnnotationStore.getState().setAnnotationGeometries(
      [{ id: "missing", anchor: { kind: "rect", page_index: 0, rect: { x0: 0, y0: 0, x1: 0.1, y1: 0.1 } } }],
      "2026-06-29T12:00:00Z",
    );
    expect(useAnnotationStore.getState().annotations).toBe(before);
  });
});

describe("active/default color, per tool (Story 2.6 + user fix request)", () => {
  it("defaults to annotation-default and setActiveColor remembers the last choice", () => {
    expect(useAnnotationStore.getState().activeColors.highlight).toBe("annotation-default");
    useAnnotationStore.getState().setActiveColor("highlight", "annotation-pink");
    expect(useAnnotationStore.getState().activeColors.highlight).toBe("annotation-pink");
    useAnnotationStore.getState().setActiveColor("highlight", "annotation-blue");
    expect(useAnnotationStore.getState().activeColors.highlight).toBe("annotation-blue");
  });

  it("each tool remembers its OWN color independently (changing one does not change the others)", () => {
    useAnnotationStore.getState().setActiveColor("highlight", "annotation-pink");
    useAnnotationStore.getState().setActiveColor("pen", "annotation-blue");
    useAnnotationStore.getState().setActiveColor("memo", "annotation-green");
    const colors = useAnnotationStore.getState().activeColors;
    expect(colors.highlight).toBe("annotation-pink");
    expect(colors.pen).toBe("annotation-blue");
    expect(colors.memo).toBe("annotation-green");
    // Untouched tools stay at the default.
    expect(colors.underline).toBe("annotation-default");
    expect(colors.comment).toBe("annotation-default");
  });
});

describe("pen stroke width + restroke (Story 2.8)", () => {
  function penMark(id: string, width: number, createdAt: string): Annotation {
    return {
      id,
      doc_id: "doc-1",
      type: "pen",
      group_id: null,
      anchor: { kind: "path", page_index: 0, points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }] },
      style: { color: "annotation-default", stroke_width: width, alpha: null },
      body: null,
      created_at: createdAt,
      updated_at: createdAt,
    };
  }

  it("defaults activeStrokeWidth and setActiveStrokeWidth remembers the last choice", () => {
    expect(useAnnotationStore.getState().activeStrokeWidth).toBe(4);
    useAnnotationStore.getState().setActiveStrokeWidth(8);
    expect(useAnnotationStore.getState().activeStrokeWidth).toBe(8);
  });

  it("restrokeAnnotation changes style.stroke_width + bumps updated_at, keyed by id", () => {
    const s = useAnnotationStore.getState();
    s.addAnnotation(penMark("p", 4, "2026-06-29T00:00:01Z"));
    useAnnotationStore.getState().restrokeAnnotation(["p"], 8, "2026-06-29T12:00:00Z");
    const p = useAnnotationStore.getState().annotations.get("p")!;
    expect(p.style.stroke_width).toBe(8);
    expect(p.style.color).toBe("annotation-default");
    expect(p.updated_at).toBe("2026-06-29T12:00:00Z");
    expect(p.created_at).toBe("2026-06-29T00:00:01Z");
  });

  it("restrokeAnnotation ignores unknown ids without throwing", () => {
    useAnnotationStore.getState().restrokeAnnotation(["missing"], 8, "2026-06-29T12:00:00Z");
    expect(useAnnotationStore.getState().annotations.size).toBe(0);
  });
});

describe("pen alpha + realpha (Story 2.13)", () => {
  function penMark(id: string, createdAt: string): Annotation {
    return {
      id,
      doc_id: "doc-1",
      type: "pen",
      group_id: null,
      anchor: { kind: "path", page_index: 0, points: [{ x: 0.1, y: 0.1 }] },
      style: { color: "annotation-default", stroke_width: 4, alpha: null },
      body: null,
      created_at: createdAt,
      updated_at: createdAt,
    };
  }

  function textMark(id: string, createdAt: string): Annotation {
    return {
      id,
      doc_id: "doc-1",
      type: "highlight",
      group_id: null,
      anchor: { kind: "text", page_index: 0, rects: [], text: "hi" },
      style: { color: "annotation-default", stroke_width: null, alpha: null },
      body: null,
      created_at: createdAt,
      updated_at: createdAt,
    };
  }

  it("defaults activeAlpha to 0.4 and setActiveAlpha remembers the last choice", () => {
    expect(useAnnotationStore.getState().activeAlpha).toBe(0.4);
    useAnnotationStore.getState().setActiveAlpha(0.8);
    expect(useAnnotationStore.getState().activeAlpha).toBe(0.8);
  });

  it("realphaAnnotation changes style.alpha + bumps updated_at, keyed by id", () => {
    const s = useAnnotationStore.getState();
    s.addAnnotation(penMark("p", "2026-06-29T00:00:01Z"));
    useAnnotationStore.getState().realphaAnnotation(["p"], 0.8, "2026-06-29T12:00:00Z");
    const p = useAnnotationStore.getState().annotations.get("p")!;
    expect(p.style.alpha).toBe(0.8);
    expect(p.style.color).toBe("annotation-default");
    expect(p.updated_at).toBe("2026-06-29T12:00:00Z");
    expect(p.created_at).toBe("2026-06-29T00:00:01Z");
  });

  it("realphaAnnotation ignores unknown ids without throwing", () => {
    useAnnotationStore.getState().realphaAnnotation(["missing"], 0.8, "2026-06-29T12:00:00Z");
    expect(useAnnotationStore.getState().annotations.size).toBe(0);
  });

  it("realphaAnnotation guards non-path marks (a stale text id is untouched)", () => {
    const s = useAnnotationStore.getState();
    s.addAnnotation(textMark("h", "2026-06-29T00:00:01Z"));
    useAnnotationStore.getState().realphaAnnotation(["h"], 0.8, "2026-06-29T12:00:00Z");
    const h = useAnnotationStore.getState().annotations.get("h")!;
    expect(h.style.alpha).toBeNull();
    expect(h.updated_at).toBe("2026-06-29T00:00:01Z");
  });
});

describe("memo size, retext + resize (Story 2.9)", () => {
  const rect = { x0: 0.1, y0: 0.2, x1: 0.4, y1: 0.5 };

  it("defaults activeMemoSize to the medium preset and remembers the last choice", () => {
    expect(useAnnotationStore.getState().activeMemoSize).toBe(DEFAULT_MEMO_SIZE);
    expect(DEFAULT_MEMO_SIZE.key).toBe("medium");
    const large = MEMO_SIZES.find((s) => s.key === "large")!;
    useAnnotationStore.getState().setActiveMemoSize(large);
    expect(useAnnotationStore.getState().activeMemoSize).toBe(large);
  });

  it("retextAnnotation sets body + bumps updated_at, keyed by id", () => {
    const s = useAnnotationStore.getState();
    s.addAnnotation(memoMark("m", rect, "2026-06-29T00:00:01Z"));
    useAnnotationStore.getState().retextAnnotation("m", "a note", "2026-06-29T12:00:00Z");
    const m = useAnnotationStore.getState().annotations.get("m")!;
    expect(m.body).toBe("a note");
    expect(m.updated_at).toBe("2026-06-29T12:00:00Z");
    expect(m.created_at).toBe("2026-06-29T00:00:01Z");
  });

  it("retextAnnotation ignores an unknown id without throwing", () => {
    useAnnotationStore.getState().retextAnnotation("missing", "x", "2026-06-29T12:00:00Z");
    expect(useAnnotationStore.getState().annotations.size).toBe(0);
  });

  it("resizeMemoAnnotation rewrites the rect width/height keeping the top-left", () => {
    const s = useAnnotationStore.getState();
    s.addAnnotation(memoMark("m", rect, "2026-06-29T00:00:01Z"));
    useAnnotationStore.getState().resizeMemoAnnotation(["m"], { w: 0.5, h: 0.25 }, "2026-06-29T12:00:00Z");
    const m = useAnnotationStore.getState().annotations.get("m")!;
    expect(m.anchor.kind).toBe("rect");
    if (m.anchor.kind === "rect") {
      expect(m.anchor.rect).toEqual({ x0: 0.1, y0: 0.2, x1: 0.6, y1: 0.45 });
    }
    expect(m.updated_at).toBe("2026-06-29T12:00:00Z");
  });

  it("resizeMemoAnnotation clamps the regrown rect to the page (<=1)", () => {
    const s = useAnnotationStore.getState();
    s.addAnnotation(memoMark("m", { x0: 0.8, y0: 0.9, x1: 0.85, y1: 0.95 }, "2026-06-29T00:00:01Z"));
    useAnnotationStore.getState().resizeMemoAnnotation(["m"], { w: 0.5, h: 0.5 }, "2026-06-29T12:00:00Z");
    const m = useAnnotationStore.getState().annotations.get("m")!;
    if (m.anchor.kind === "rect") {
      expect(m.anchor.rect.x1).toBe(1);
      expect(m.anchor.rect.y1).toBe(1);
    }
  });

  it("resizeMemoAnnotation guards non-memo marks (a stale text/path id is untouched)", () => {
    const s = useAnnotationStore.getState();
    s.addAnnotation(mark("h", "annotation-default", "2026-06-29T00:00:01Z")); // a text highlight
    useAnnotationStore.getState().resizeMemoAnnotation(["h"], { w: 0.5, h: 0.5 }, "2026-06-29T12:00:00Z");
    const h = useAnnotationStore.getState().annotations.get("h")!;
    expect(h.anchor.kind).toBe("text");
    expect(h.updated_at).toBe("2026-06-29T00:00:01Z"); // not bumped
  });
});

describe("setMemoCollapsed (memo collapse/expand, user feature request)", () => {
  const rect = { x0: 0.1, y0: 0.2, x1: 0.4, y1: 0.5 };

  it("sets style.collapsed and bumps updated_at", () => {
    const s = useAnnotationStore.getState();
    s.addAnnotation(memoMark("m", rect, "2026-06-29T00:00:01Z"));
    useAnnotationStore.getState().setMemoCollapsed(["m"], true, "2026-06-29T12:00:00Z");
    const m = useAnnotationStore.getState().annotations.get("m")!;
    expect(m.style.collapsed).toBe(true);
    expect(m.updated_at).toBe("2026-06-29T12:00:00Z");
  });

  it("expands back (collapsed=false) and bumps updated_at again", () => {
    const s = useAnnotationStore.getState();
    s.addAnnotation(memoMark("m", rect, "2026-06-29T00:00:01Z"));
    useAnnotationStore.getState().setMemoCollapsed(["m"], true, "2026-06-29T12:00:00Z");
    useAnnotationStore.getState().setMemoCollapsed(["m"], false, "2026-06-29T13:00:00Z");
    const m = useAnnotationStore.getState().annotations.get("m")!;
    expect(m.style.collapsed).toBe(false);
    expect(m.updated_at).toBe("2026-06-29T13:00:00Z");
  });

  it("does not disturb the memo's other style fields (color, geometry)", () => {
    const s = useAnnotationStore.getState();
    s.addAnnotation(memoMark("m", rect, "2026-06-29T00:00:01Z"));
    useAnnotationStore.getState().setMemoCollapsed(["m"], true, "2026-06-29T12:00:00Z");
    const m = useAnnotationStore.getState().annotations.get("m")!;
    expect(m.style.color).toBe("annotation-default");
    if (m.anchor.kind === "rect") expect(m.anchor.rect).toEqual(rect);
  });

  it("guards non-memo marks (a stale text/path id is untouched)", () => {
    const s = useAnnotationStore.getState();
    s.addAnnotation(mark("h", "annotation-default", "2026-06-29T00:00:01Z"));
    useAnnotationStore.getState().setMemoCollapsed(["h"], true, "2026-06-29T12:00:00Z");
    const h = useAnnotationStore.getState().annotations.get("h")!;
    expect(h.style.collapsed).toBeUndefined();
    expect(h.updated_at).toBe("2026-06-29T00:00:01Z"); // not bumped
  });

  it("guards a rect mark that is not a memo (e.g. a region highlight)", () => {
    const s = useAnnotationStore.getState();
    const region: Annotation = {
      id: "r",
      doc_id: "doc-1",
      type: "highlight",
      group_id: null,
      anchor: { kind: "rect", page_index: 0, rect },
      style: { color: "annotation-default", stroke_width: null, alpha: null },
      body: null,
      created_at: "2026-06-29T00:00:01Z",
      updated_at: "2026-06-29T00:00:01Z",
    };
    s.addAnnotation(region);
    useAnnotationStore.getState().setMemoCollapsed(["r"], true, "2026-06-29T12:00:00Z");
    const r = useAnnotationStore.getState().annotations.get("r")!;
    expect(r.style.collapsed).toBeUndefined();
    expect(r.updated_at).toBe("2026-06-29T00:00:01Z");
  });

  it("ignores an unknown id without throwing", () => {
    useAnnotationStore.getState().setMemoCollapsed(["missing"], true, "2026-06-29T12:00:00Z");
    expect(useAnnotationStore.getState().annotations.size).toBe(0);
  });

  it("is undoable via zundo (the normal command path, AD-7)", () => {
    const s = useAnnotationStore.getState();
    s.addAnnotation(memoMark("m", rect, "2026-06-29T00:00:01Z"));
    useAnnotationStore.temporal.getState().clear();
    useAnnotationStore.getState().setMemoCollapsed(["m"], true, "2026-06-29T12:00:00Z");
    expect(useAnnotationStore.getState().annotations.get("m")!.style.collapsed).toBe(true);
    useAnnotationStore.temporal.getState().undo();
    expect(useAnnotationStore.getState().annotations.get("m")!.style.collapsed).toBeUndefined();
  });
});

describe("geometry edit — setAnnotationGeometry (move/resize command path, Story 3.1)", () => {
  const rect = { x0: 0.1, y0: 0.2, x1: 0.4, y1: 0.5 };

  function penMark(id: string, createdAt: string): Annotation {
    return {
      id,
      doc_id: "doc-1",
      type: "pen",
      group_id: null,
      anchor: { kind: "path", page_index: 0, points: [{ x: 0.1, y: 0.1 }] },
      style: { color: "annotation-default", stroke_width: 4, alpha: 0.4 },
      body: null,
      created_at: createdAt,
      updated_at: createdAt,
    };
  }

  it("replaces a rect mark's geometry + bumps updated_at, keeping unrelated fields", () => {
    const s = useAnnotationStore.getState();
    s.addAnnotation(memoMark("m", rect, "2026-06-29T00:00:01Z", "note"));
    const moved = { x0: 0.2, y0: 0.3, x1: 0.5, y1: 0.6 };
    useAnnotationStore
      .getState()
      .setAnnotationGeometry("m", { kind: "rect", page_index: 0, rect: moved }, "2026-06-29T12:00:00Z");
    const m = useAnnotationStore.getState().annotations.get("m")!;
    expect(m.anchor.kind).toBe("rect");
    if (m.anchor.kind === "rect") expect(m.anchor.rect).toEqual(moved);
    expect(m.body).toBe("note"); // unrelated fields preserved
    expect(m.updated_at).toBe("2026-06-29T12:00:00Z");
    expect(m.created_at).toBe("2026-06-29T00:00:01Z");
  });

  it("replaces a path mark's points (pen move/resize), leaving style untouched", () => {
    const s = useAnnotationStore.getState();
    s.addAnnotation(penMark("p", "2026-06-29T00:00:01Z"));
    const pts = [{ x: 0.3, y: 0.3 }, { x: 0.4, y: 0.4 }];
    useAnnotationStore
      .getState()
      .setAnnotationGeometry("p", { kind: "path", page_index: 0, points: pts }, "2026-06-29T12:00:00Z");
    const p = useAnnotationStore.getState().annotations.get("p")!;
    if (p.anchor.kind === "path") expect(p.anchor.points).toEqual(pts);
    expect(p.style.stroke_width).toBe(4);
    expect(p.updated_at).toBe("2026-06-29T12:00:00Z");
  });

  it("ignores an unknown id without throwing", () => {
    useAnnotationStore
      .getState()
      .setAnnotationGeometry("missing", { kind: "rect", page_index: 0, rect }, "2026-06-29T12:00:00Z");
    expect(useAnnotationStore.getState().annotations.size).toBe(0);
  });

  it("rejects a kind change — a geometry edit rewrites VALUES, never the discriminator (AC#8)", () => {
    const s = useAnnotationStore.getState();
    s.addAnnotation(memoMark("m", rect, "2026-06-29T00:00:01Z"));
    useAnnotationStore
      .getState()
      .setAnnotationGeometry("m", { kind: "text", page_index: 0, rects: [], text: "x" }, "2026-06-29T12:00:00Z");
    const m = useAnnotationStore.getState().annotations.get("m")!;
    expect(m.anchor.kind).toBe("rect"); // unchanged
    expect(m.updated_at).toBe("2026-06-29T00:00:01Z"); // not bumped
  });

  it("setDragPreview holds a transient preview WITHOUT touching the stored annotation", () => {
    const s = useAnnotationStore.getState();
    s.addAnnotation(memoMark("m", rect, "2026-06-29T00:00:01Z"));
    s.setDragPreview({ id: "m", anchor: { kind: "rect", page_index: 0, rect: { x0: 0.2, y0: 0.3, x1: 0.5, y1: 0.6 } } });
    expect(useAnnotationStore.getState().dragPreview?.id).toBe("m");
    // The committed annotation is untouched — the preview is separate transient state.
    const m = useAnnotationStore.getState().annotations.get("m")!;
    if (m.anchor.kind === "rect") expect(m.anchor.rect).toEqual(rect);
    expect(m.updated_at).toBe("2026-06-29T00:00:01Z");
    s.setDragPreview(null);
    expect(useAnnotationStore.getState().dragPreview).toBeNull();
  });
});

describe("convert highlight <-> comment — retypeAnnotation (Story 3.7)", () => {
  it("flips highlight -> comment: type + body change together, updated_at bumped", () => {
    const s = useAnnotationStore.getState();
    s.addAnnotation(mark("a", "annotation-default", "2026-06-29T00:00:01Z"));
    useAnnotationStore.getState().retypeAnnotation(["a"], "comment", "", "2026-06-29T12:00:00Z");
    const a = useAnnotationStore.getState().annotations.get("a")!;
    expect(a.type).toBe("comment");
    expect(a.body).toBe("");
    expect(a.updated_at).toBe("2026-06-29T12:00:00Z");
    expect(a.created_at).toBe("2026-06-29T00:00:01Z");
  });

  it("flips comment -> highlight: body drops to null even when it held a note", () => {
    const s = useAnnotationStore.getState();
    s.addAnnotation({
      ...mark("c", "annotation-default", "2026-06-29T00:00:01Z"),
      type: "comment",
      body: "a note",
    });
    useAnnotationStore.getState().retypeAnnotation(["c"], "highlight", null, "2026-06-29T12:00:00Z");
    const c = useAnnotationStore.getState().annotations.get("c")!;
    expect(c.type).toBe("highlight");
    expect(c.body).toBeNull();
  });

  it("is group-aware: both group_id siblings flip together in one call", () => {
    const s = useAnnotationStore.getState();
    s.addAnnotation(mark("a", "annotation-default", "2026-06-29T00:00:01Z", "g1"));
    s.addAnnotation(mark("b", "annotation-default", "2026-06-29T00:00:01Z", "g1"));
    useAnnotationStore.getState().retypeAnnotation(["a", "b"], "comment", "", "2026-06-29T12:00:00Z");
    const map = useAnnotationStore.getState().annotations;
    expect(map.get("a")!.type).toBe("comment");
    expect(map.get("b")!.type).toBe("comment");
  });

  it("ignores an unknown id: Map reference is unchanged (zundo no-op suppression)", () => {
    const s = useAnnotationStore.getState();
    s.addAnnotation(mark("a", "annotation-default", "2026-06-29T00:00:01Z"));
    const before = useAnnotationStore.getState().annotations;
    useAnnotationStore.getState().retypeAnnotation(["missing"], "comment", "", "2026-06-29T12:00:00Z");
    expect(useAnnotationStore.getState().annotations).toBe(before);
  });

  it("Task 4 regression: forward convert, a typed-body session, and reverse convert are THREE distinct undo steps", () => {
    const s = useAnnotationStore.getState();
    const t = () => useAnnotationStore.temporal.getState();
    s.addAnnotation(mark("a", "annotation-default", "2026-06-29T00:00:01Z")); // highlight
    const depth0 = t().pastStates.length;

    s.retypeAnnotation(["a"], "comment", "", "2026-06-29T12:00:00Z"); // forward convert
    expect(t().pastStates.length).toBe(depth0 + 1);

    // A typed-body session, coalesced exactly like AnnotationLayer's focus/blur
    // handlers (Story 3.2): pause -> N retext calls -> resume + one manual push.
    const preSession = useAnnotationStore.getState().annotations;
    t().pause();
    s.retextAnnotation("a", "typed note", "2026-06-29T12:00:01Z");
    t().resume();
    useAnnotationStore.temporal.setState({
      pastStates: [...t().pastStates.slice(-99), { annotations: preSession }],
      futureStates: [],
    });
    expect(t().pastStates.length).toBe(depth0 + 2);

    s.retypeAnnotation(["a"], "highlight", null, "2026-06-29T12:00:02Z"); // reverse convert
    expect(t().pastStates.length).toBe(depth0 + 3);

    // Undo unwinds ONE command at a time, in reverse order.
    t().undo(); // undoes the reverse convert
    let a = useAnnotationStore.getState().annotations.get("a")!;
    expect(a.type).toBe("comment");
    expect(a.body).toBe("typed note");

    t().undo(); // undoes the typed-body session
    a = useAnnotationStore.getState().annotations.get("a")!;
    expect(a.body).toBe("");

    t().undo(); // undoes the forward convert
    a = useAnnotationStore.getState().annotations.get("a")!;
    expect(a.type).toBe("highlight");
    expect(a.body).toBeNull();
  });
});

describe("hydrate-on-open (Story 3.5)", () => {
  const t = () => useAnnotationStore.temporal.getState();

  it("hydrate builds the Map keyed by id and clears transient UI state", () => {
    const s = useAnnotationStore.getState();
    // Seed prior transient state that a hydrate must wipe.
    s.addAnnotation(mark("old", "annotation-default", "2026-06-29T00:00:01Z"));
    s.select("old");
    s.setHovered("old");
    s.setDragPreview({ id: "old", anchor: { kind: "text", page_index: 0, rects: [], text: "x" } });

    useAnnotationStore.getState().hydrate([
      mark("a", "annotation-pink", "2026-06-29T00:00:02Z"),
      mark("b", "annotation-blue", "2026-06-29T00:00:03Z"),
    ]);

    const st = useAnnotationStore.getState();
    expect([...st.annotations.keys()].sort()).toEqual(["a", "b"]);
    expect(st.annotations.get("a")!.style.color).toBe("annotation-pink");
    expect(st.annotations.has("old")).toBe(false);
    expect(st.selectedId).toBeNull();
    expect(st.hoveredId).toBeNull();
    expect(st.dragPreview).toBeNull();
  });

  it("hydrateStore clears zundo history so undo() cannot remove restored marks (AC-4)", () => {
    // Prior edits leave undo history that hydrateStore must wipe.
    const s = useAnnotationStore.getState();
    s.addAnnotation(mark("x", "annotation-default", "2026-06-29T00:00:01Z"));
    s.addAnnotation(mark("y", "annotation-default", "2026-06-29T00:00:02Z"));
    expect(t().pastStates.length).toBeGreaterThan(0);

    hydrateStore([mark("r", "annotation-green", "2026-06-29T00:00:03Z")]);

    expect(t().pastStates.length).toBe(0);
    expect(t().futureStates.length).toBe(0);
    // Undo is a no-op: the restored mark survives (it is the undo floor).
    t().undo();
    expect(useAnnotationStore.getState().annotations.has("r")).toBe(true);
  });

  it("hydrateStore([]) restores an empty set (imported-but-unannotated doc)", () => {
    const s = useAnnotationStore.getState();
    s.addAnnotation(mark("stale", "annotation-default", "2026-06-29T00:00:01Z"));
    hydrateStore([]);
    expect(useAnnotationStore.getState().annotations.size).toBe(0);
    expect(t().pastStates.length).toBe(0);
  });
});

describe("undo/redo — zundo temporal store (Story 3.2)", () => {
  const t = () => useAnnotationStore.temporal.getState();

  it("addAnnotation then undo() removes the annotation", () => {
    const s = useAnnotationStore.getState();
    s.addAnnotation(mark("a", "annotation-default", "2026-06-29T00:00:01Z"));
    expect(useAnnotationStore.getState().annotations.has("a")).toBe(true);
    t().undo();
    expect(useAnnotationStore.getState().annotations.has("a")).toBe(false);
  });

  it("undo() then redo() restores the annotation", () => {
    const s = useAnnotationStore.getState();
    s.addAnnotation(mark("a", "annotation-default", "2026-06-29T00:00:01Z"));
    t().undo();
    expect(useAnnotationStore.getState().annotations.has("a")).toBe(false);
    t().redo();
    expect(useAnnotationStore.getState().annotations.has("a")).toBe(true);
  });

  it("addAnnotations batch-adds two marks as ONE history entry", () => {
    const s = useAnnotationStore.getState();
    s.addAnnotations([
      mark("a", "annotation-default", "2026-06-29T00:00:01Z", "g1"),
      mark("b", "annotation-default", "2026-06-29T00:00:01Z", "g1"),
    ]);
    expect(useAnnotationStore.getState().annotations.size).toBe(2);
    // One undo step removes BOTH.
    t().undo();
    expect(useAnnotationStore.getState().annotations.size).toBe(0);
    t().redo();
    expect(useAnnotationStore.getState().annotations.size).toBe(2);
  });

  it("no-op action (restroke on a text mark) pushes NO history entry", () => {
    const s = useAnnotationStore.getState();
    s.addAnnotation(mark("a", "annotation-default", "2026-06-29T00:00:01Z")); // text mark
    const depthAfterAdd = t().pastStates.length;
    // restroke on a text mark is a no-op — the guard returns `state` unchanged.
    useAnnotationStore.getState().restrokeAnnotation(["a"], 8, "2026-06-29T12:00:00Z");
    expect(t().pastStates.length).toBe(depthAfterAdd);
  });

  it("no-op action (setAnnotationGeometry unknown id) pushes NO history entry", () => {
    const depthBefore = t().pastStates.length;
    const dummyRect = { x0: 0.1, y0: 0.1, x1: 0.5, y1: 0.5 };
    useAnnotationStore
      .getState()
      .setAnnotationGeometry("missing", { kind: "rect", page_index: 0, rect: dummyRect }, "2026-06-29T12:00:00Z");
    expect(t().pastStates.length).toBe(depthBefore);
  });

  it("partialize: undo after select(id)+addAnnotation does NOT un-select", () => {
    const s = useAnnotationStore.getState();
    s.addAnnotation(mark("a", "annotation-default", "2026-06-29T00:00:01Z"));
    s.select("a");
    s.addAnnotation(mark("b", "annotation-default", "2026-06-29T00:00:02Z"));
    // Undo the addAnnotation("b"); selectedId is NOT part of temporal history.
    t().undo();
    expect(useAnnotationStore.getState().annotations.has("b")).toBe(false);
    // Selection state is unchanged (not rolled back by undo).
    expect(useAnnotationStore.getState().selectedId).toBe("a");
  });

  it("empty-stack undo is a safe no-op", () => {
    expect(() => t().undo()).not.toThrow();
    expect(useAnnotationStore.getState().annotations.size).toBe(0);
  });

  it("empty-stack redo is a safe no-op", () => {
    expect(() => t().redo()).not.toThrow();
  });

  it("a new edit after undo clears redo history (linear undo semantics)", () => {
    const s = useAnnotationStore.getState();
    s.addAnnotation(mark("a", "annotation-default", "2026-06-29T00:00:01Z"));
    t().undo();
    expect(t().futureStates.length).toBeGreaterThan(0);
    // A new edit wipes the redo stack.
    s.addAnnotation(mark("b", "annotation-default", "2026-06-29T00:00:02Z"));
    expect(t().futureStates.length).toBe(0);
  });

  it("pause() suppresses history; commitTextEditSession pushes ONE entry back to pre-session state", () => {
    const s = useAnnotationStore.getState();
    // Place a baseline annotation so there is prior state.
    s.addAnnotation(mark("a", "annotation-default", "2026-06-29T00:00:01Z"));
    const depthAfterAdd = t().pastStates.length;

    // Simulate onFocus: save pre-session annotations + pause temporal.
    const preFocusAnnotations = useAnnotationStore.getState().annotations;
    t().pause();

    // Multiple retextAnnotation calls during a typing session — none recorded.
    s.retextAnnotation("a", "h", "2026-06-29T12:00:01Z");
    s.retextAnnotation("a", "hi", "2026-06-29T12:00:02Z");
    s.retextAnnotation("a", "hii", "2026-06-29T12:00:03Z");
    expect(t().pastStates.length).toBe(depthAfterAdd);

    // Simulate onBlur: resume + manually push ONE history entry (pre-session state).
    t().resume();
    const currentAnnotations = useAnnotationStore.getState().annotations;
    // Only push if something actually changed (Map ref differs from pre-session).
    if (currentAnnotations !== preFocusAnnotations) {
      const { pastStates } = t();
      useAnnotationStore.temporal.setState({
        pastStates: [...pastStates.slice(-99), { annotations: preFocusAnnotations }],
        futureStates: [],
      });
    }
    expect(t().pastStates.length).toBe(depthAfterAdd + 1);

    // ONE undo step takes us back to the pre-session state (body = null).
    t().undo();
    const restored = useAnnotationStore.getState().annotations.get("a")!;
    expect(restored.body).toBeNull();
  });

  it("restyle (recolor) is one undo step", () => {
    const s = useAnnotationStore.getState();
    s.addAnnotation(mark("a", "annotation-default", "2026-06-29T00:00:01Z"));
    s.recolorAnnotation(["a"], "annotation-pink", "2026-06-29T12:00:00Z");
    t().undo();
    const a = useAnnotationStore.getState().annotations.get("a")!;
    expect(a.style.color).toBe("annotation-default");
  });

  it("convert (retypeAnnotation) is one undo step; undo restores prior type + body exactly", () => {
    const s = useAnnotationStore.getState();
    s.addAnnotation(mark("a", "annotation-default", "2026-06-29T00:00:01Z")); // type=highlight, body=null
    const depthAfterAdd = t().pastStates.length;
    s.retypeAnnotation(["a"], "comment", "", "2026-06-29T12:00:00Z");
    expect(t().pastStates.length).toBe(depthAfterAdd + 1);
    let a = useAnnotationStore.getState().annotations.get("a")!;
    expect(a.type).toBe("comment");
    expect(a.body).toBe("");
    t().undo();
    a = useAnnotationStore.getState().annotations.get("a")!;
    expect(a.type).toBe("highlight");
    expect(a.body).toBeNull();
  });

  it("deleteAnnotation then undo restores the mark exactly (AC-3)", () => {
    const s = useAnnotationStore.getState();
    const original = mark("a", "annotation-pink", "2026-06-29T00:00:01Z");
    s.addAnnotation(original);
    s.deleteAnnotation("a");
    expect(useAnnotationStore.getState().annotations.has("a")).toBe(false);
    t().undo();
    const restored = useAnnotationStore.getState().annotations.get("a")!;
    expect(restored.id).toBe(original.id);
    expect(restored.style.color).toBe(original.style.color);
    expect(restored.anchor).toEqual(original.anchor);
  });

  it("deleteAnnotation then undo then redo re-deletes (AC-3)", () => {
    const s = useAnnotationStore.getState();
    s.addAnnotation(mark("a", "annotation-default", "2026-06-29T00:00:01Z"));
    s.deleteAnnotation("a");
    t().undo();
    expect(useAnnotationStore.getState().annotations.has("a")).toBe(true);
    t().redo();
    expect(useAnnotationStore.getState().annotations.has("a")).toBe(false);
  });

  it("grouped deleteAnnotation then one undo restores ALL siblings (AC-4)", () => {
    const s = useAnnotationStore.getState();
    s.addAnnotations([
      mark("a", "annotation-default", "2026-06-29T00:00:01Z", "g1"),
      mark("b", "annotation-default", "2026-06-29T00:00:01Z", "g1"),
    ]);
    s.deleteAnnotation("a");
    expect(useAnnotationStore.getState().annotations.has("a")).toBe(false);
    expect(useAnnotationStore.getState().annotations.has("b")).toBe(false);
    t().undo();
    const map = useAnnotationStore.getState().annotations;
    expect(map.has("a")).toBe(true);
    expect(map.has("b")).toBe(true);
  });
});

describe("transient flash (Story 3.6, Annotation Bank jump)", () => {
  const t = () => useAnnotationStore.temporal.getState();

  it("flash(id) sets flashId; flash(null) clears it", () => {
    useAnnotationStore.getState().flash("a");
    expect(useAnnotationStore.getState().flashId).toBe("a");
    useAnnotationStore.getState().flash(null);
    expect(useAnnotationStore.getState().flashId).toBeNull();
  });

  it("flashId is excluded from the zundo partialize: flash() pushes NO undo history entry", () => {
    const before = t().pastStates.length;
    useAnnotationStore.getState().flash("a");
    expect(t().pastStates.length).toBe(before);
  });

  it("hydrate clears a stale flashId", () => {
    useAnnotationStore.getState().flash("stale");
    useAnnotationStore.getState().hydrate([]);
    expect(useAnnotationStore.getState().flashId).toBeNull();
  });

  it("flashAnnotation(id) sets flashId then auto-clears after FLASH_MS", async () => {
    vi.useFakeTimers();
    try {
      flashAnnotation("a");
      expect(useAnnotationStore.getState().flashId).toBe("a");
      await vi.advanceTimersByTimeAsync(FLASH_MS);
      expect(useAnnotationStore.getState().flashId).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a second flashAnnotation before the first clears cancels the first timer (retargets, no premature clear)", async () => {
    vi.useFakeTimers();
    try {
      flashAnnotation("a");
      await vi.advanceTimersByTimeAsync(FLASH_MS / 2);
      flashAnnotation("b");
      // The first timer's original deadline passes; since it was cancelled,
      // flashId must still be "b" (not cleared early / not stranded).
      await vi.advanceTimersByTimeAsync(FLASH_MS / 2);
      expect(useAnnotationStore.getState().flashId).toBe("b");
      // The second timer's own full duration then clears it.
      await vi.advanceTimersByTimeAsync(FLASH_MS / 2);
      expect(useAnnotationStore.getState().flashId).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
