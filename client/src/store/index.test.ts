import { describe, it, expect, beforeEach } from "vitest";
import { useAnnotationStore } from "./index";
import type { Annotation } from "../api/client";

function mark(id: string, color: string, createdAt: string, groupId: string | null = null): Annotation {
  return {
    id,
    doc_id: "doc-1",
    type: "highlight",
    group_id: groupId,
    anchor: { kind: "text", page_index: 0, rects: [], text: "x" },
    style: { color, stroke_width: null },
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
  }),
);

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
      style: { color: "annotation-default", stroke_width: width },
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
