import { describe, it, expect, beforeEach } from "vitest";
import { useAnnotationStore } from "./index";
import type { Annotation } from "../api/client";

function mark(id: string, color: string, createdAt: string): Annotation {
  return {
    id,
    doc_id: "doc-1",
    type: "highlight",
    group_id: null,
    anchor: { kind: "text", page_index: 0, rects: [], text: "x" },
    style: { color, stroke_width: null },
    body: null,
    created_at: createdAt,
    updated_at: createdAt,
  };
}

beforeEach(() => useAnnotationStore.setState({ annotations: new Map() }));

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
