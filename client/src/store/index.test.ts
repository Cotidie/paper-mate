import { describe, it, expect, beforeEach } from "vitest";
import { useAnnotationStore, DEFAULT_MEMO_SIZE, MEMO_SIZES } from "./index";
import type { Annotation } from "../api/client";

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

beforeEach(() =>
  useAnnotationStore.setState({
    annotations: new Map(),
    selectedId: null,
    hoveredId: null,
    activeColor: "annotation-default",
    activeStrokeWidth: 4,
    activeMemoSize: DEFAULT_MEMO_SIZE,
    activeAlpha: 0.4,
  }),
);

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

describe("active/default color (Story 2.6)", () => {
  it("defaults to annotation-default and setActiveColor remembers the last choice", () => {
    expect(useAnnotationStore.getState().activeColor).toBe("annotation-default");
    useAnnotationStore.getState().setActiveColor("annotation-pink");
    expect(useAnnotationStore.getState().activeColor).toBe("annotation-pink");
    useAnnotationStore.getState().setActiveColor("annotation-blue");
    expect(useAnnotationStore.getState().activeColor).toBe("annotation-blue");
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
