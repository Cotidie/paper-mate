import { describe, it, expect, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useEditGesture } from "./useEditGesture";
import { useAnnotationStore, DEFAULT_MEMO_SIZE } from "../../store";
import type { Annotation } from "../../api/client";
import type { PageCardRef } from "../../anchor";

// box = 1000x1000 so a 250px drag at scale 1 is a clean 0.25 normalized delta.
const BOX = { width: 1000, height: 1000 };

function memo(id: string, rect: { x0: number; y0: number; x1: number; y1: number }): Annotation {
  return {
    id,
    doc_id: "doc-1",
    type: "memo",
    group_id: null,
    anchor: { kind: "rect", page_index: 0, rect },
    style: { color: "annotation-default", stroke_width: null, alpha: null },
    body: "",
    created_at: "2026-06-30T00:00:00Z",
    updated_at: "2026-06-30T00:00:00Z",
  };
}

function pages(): PageCardRef[] {
  return [{ pageIndex: 0, cardEl: document.createElement("div"), box: BOX }];
}

function mountGesture() {
  renderHook(() => useEditGesture({ enabled: true, getPagesRef: { current: pages }, scaleRef: { current: 1 } }));
}

function handle(kind: string, id: string): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.dataset.editHandle = kind;
  btn.dataset.editId = id;
  document.body.appendChild(btn);
  return btn;
}

const down = (btn: HTMLElement, x: number, y: number) =>
  btn.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: x, clientY: y, button: 0 }));
const move = (x: number, y: number) => document.dispatchEvent(new MouseEvent("pointermove", { clientX: x, clientY: y }));
const up = () => document.dispatchEvent(new MouseEvent("pointerup", {}));

beforeEach(() => {
  document.body.innerHTML = "";
  useAnnotationStore.setState({
    annotations: new Map(),
    selectedId: null,
    hoveredId: null,
    dragPreview: null,
    activeColor: "annotation-default",
    activeStrokeWidth: 4,
    activeMemoSize: DEFAULT_MEMO_SIZE,
    activeAlpha: 0.4,
  });
});

describe("useEditGesture (move/resize drag, Story 3.1)", () => {
  it("moves a rect mark by the drag delta and commits ONE geometry mutation on release", () => {
    useAnnotationStore.getState().addAnnotation(memo("m", { x0: 0.25, y0: 0.25, x1: 0.5, y1: 0.5 }));
    mountGesture();
    down(handle("move", "m"), 100, 100);
    move(350, 350); // dx = dy = 250/1000 = 0.25

    // The drag previews live; the stored mark is NOT committed mid-drag.
    const pv = useAnnotationStore.getState().dragPreview;
    expect(pv?.id).toBe("m");
    if (pv && pv.anchor.kind === "rect") {
      expect(pv.anchor.rect).toEqual({ x0: 0.5, y0: 0.5, x1: 0.75, y1: 0.75 });
    }
    expect(useAnnotationStore.getState().annotations.get("m")!.updated_at).toBe("2026-06-30T00:00:00Z");

    up();
    const m = useAnnotationStore.getState().annotations.get("m")!;
    if (m.anchor.kind === "rect") expect(m.anchor.rect).toEqual({ x0: 0.5, y0: 0.5, x1: 0.75, y1: 0.75 });
    expect(useAnnotationStore.getState().dragPreview).toBeNull();
    expect(m.updated_at).not.toBe("2026-06-30T00:00:00Z"); // committed → bumped
  });

  it("resizes a rect mark from a corner handle", () => {
    useAnnotationStore.getState().addAnnotation(memo("m", { x0: 0.25, y0: 0.25, x1: 0.5, y1: 0.5 }));
    mountGesture();
    down(handle("se", "m"), 100, 100);
    move(225, 225); // dx = dy = 0.125 → SE corner grows
    up();
    const m = useAnnotationStore.getState().annotations.get("m")!;
    if (m.anchor.kind === "rect") expect(m.anchor.rect).toEqual({ x0: 0.25, y0: 0.25, x1: 0.625, y1: 0.625 });
  });

  it("remembers a memo's RESIZED size as the session default (last-adjusted-size-wins)", () => {
    useAnnotationStore.getState().addAnnotation(memo("m", { x0: 0.25, y0: 0.25, x1: 0.5, y1: 0.5 }));
    mountGesture();
    down(handle("se", "m"), 100, 100);
    move(225, 225); // SE +0.125 → new rect 0.25..0.625 → 0.375 of the 1000px box = 375px
    up();
    const size = useAnnotationStore.getState().activeMemoSize;
    expect(size.width).toBeCloseTo(375, 4);
    expect(size.height).toBeCloseTo(375, 4);
  });

  it("a MOVE does not change the remembered memo size (only resize does)", () => {
    useAnnotationStore.getState().addAnnotation(memo("m", { x0: 0.25, y0: 0.25, x1: 0.5, y1: 0.5 }));
    const before = useAnnotationStore.getState().activeMemoSize;
    mountGesture();
    down(handle("move", "m"), 100, 100);
    move(350, 350);
    up();
    expect(useAnnotationStore.getState().activeMemoSize).toBe(before);
  });

  it("aborts on Escape WITHOUT committing (preview cleared, mark unchanged)", () => {
    useAnnotationStore.getState().addAnnotation(memo("m", { x0: 0.25, y0: 0.25, x1: 0.5, y1: 0.5 }));
    mountGesture();
    down(handle("move", "m"), 100, 100);
    move(350, 350);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(useAnnotationStore.getState().dragPreview).toBeNull();
    up();
    const m = useAnnotationStore.getState().annotations.get("m")!;
    if (m.anchor.kind === "rect") expect(m.anchor.rect).toEqual({ x0: 0.25, y0: 0.25, x1: 0.5, y1: 0.5 });
    expect(m.updated_at).toBe("2026-06-30T00:00:00Z");
  });

  it("a press with no drag commits nothing (no updated_at bump)", () => {
    useAnnotationStore.getState().addAnnotation(memo("m", { x0: 0.25, y0: 0.25, x1: 0.5, y1: 0.5 }));
    mountGesture();
    down(handle("move", "m"), 100, 100);
    up();
    expect(useAnnotationStore.getState().annotations.get("m")!.updated_at).toBe("2026-06-30T00:00:00Z");
    expect(useAnnotationStore.getState().dragPreview).toBeNull();
  });

  it("a sub-slop press-and-jiggle commits nothing (click-vs-drag slop, matches COMMENT_CLICK_SLOP)", () => {
    useAnnotationStore.getState().addAnnotation(memo("m", { x0: 0.25, y0: 0.25, x1: 0.5, y1: 0.5 }));
    mountGesture();
    down(handle("move", "m"), 100, 100);
    move(102, 101); // dist ≈ 2.24px, below the 5px slop
    expect(useAnnotationStore.getState().dragPreview).toBeNull();
    up();
    const m = useAnnotationStore.getState().annotations.get("m")!;
    expect(m.updated_at).toBe("2026-06-30T00:00:00Z");
  });

  it("a past-slop drag measures the delta from the ORIGINAL down-point (no jump at the slop threshold)", () => {
    useAnnotationStore.getState().addAnnotation(memo("m", { x0: 0.25, y0: 0.25, x1: 0.5, y1: 0.5 }));
    mountGesture();
    down(handle("move", "m"), 100, 100);
    move(103, 100); // dist = 3px, still below slop — no preview yet
    move(350, 100); // now well past slop; dx must be measured from x=100, not x=103
    up();
    const m = useAnnotationStore.getState().annotations.get("m")!;
    if (m.anchor.kind === "rect") {
      // dx = (350-100)/1000 = 0.25 — same delta as the plain move test above,
      // proving the intermediate sub-slop sample never became the new origin.
      expect(m.anchor.rect).toEqual({ x0: 0.5, y0: 0.25, x1: 0.75, y1: 0.5 });
    }
  });
});

function pen(id: string, points: { x: number; y: number }[]): Annotation {
  return {
    id,
    doc_id: "doc-1",
    type: "pen",
    group_id: null,
    anchor: { kind: "path", page_index: 0, points },
    style: { color: "annotation-default", stroke_width: 8, alpha: 0.4 },
    body: null,
    created_at: "2026-06-30T00:00:00Z",
    updated_at: "2026-06-30T00:00:00Z",
  };
}

function penPoints(id: string): { x: number; y: number }[] {
  const a = useAnnotationStore.getState().annotations.get(id)!;
  return a.anchor.kind === "path" ? a.anchor.points : [];
}

describe("useEditGesture pen resize (Codex review fix — 1-D strokes + edge overscale)", () => {
  it("resizes a perfectly HORIZONTAL stroke (zero y-extent) on its x axis instead of no-op", () => {
    useAnnotationStore
      .getState()
      .addAnnotation(pen("h", [{ x: 0.2, y: 0.5 }, { x: 0.4, y: 0.5 }, { x: 0.6, y: 0.5 }]));
    mountGesture();
    down(handle("se", "h"), 100, 100);
    move(300, 100); // dx = 200/1000 = 0.2, dy = 0
    up();
    const pts = penPoints("h");
    // x scales about x0=0.2 by 1.5 (edge 0.6→0.8); y is the zero-extent axis → unchanged.
    expect(pts[0].x).toBeCloseTo(0.2, 6);
    expect(pts[2].x).toBeCloseTo(0.8, 6);
    expect(pts.every((p) => p.y === 0.5)).toBe(true);
  });

  it("resizes a perfectly VERTICAL stroke (zero x-extent) on its y axis instead of no-op", () => {
    useAnnotationStore
      .getState()
      .addAnnotation(pen("v", [{ x: 0.5, y: 0.2 }, { x: 0.5, y: 0.4 }, { x: 0.5, y: 0.6 }]));
    mountGesture();
    down(handle("se", "v"), 100, 100);
    move(100, 300); // dx = 0, dy = 0.2
    up();
    const pts = penPoints("v");
    expect(pts[0].y).toBeCloseTo(0.2, 6);
    expect(pts[2].y).toBeCloseTo(0.8, 6);
    expect(pts.every((p) => p.x === 0.5)).toBe(true);
  });

  it("an overscale drag clamps the FACTOR (shape preserved), not each point flat at the edge", () => {
    useAnnotationStore
      .getState()
      .addAnnotation(pen("e", [{ x: 0.2, y: 0.2 }, { x: 0.4, y: 0.4 }, { x: 0.6, y: 0.6 }]));
    mountGesture();
    down(handle("se", "e"), 100, 100);
    move(5100, 5100); // dx = dy = 5 (massively past the page edge)
    up();
    const pts = penPoints("e");
    // Edge clamps to 1.0 → scale 2.0 about (0.2,0.2). The MIDPOINT must stay at 0.6,
    // proving shape is preserved (the old per-point clip flattened it to 1.0).
    expect(pts[2].x).toBeCloseTo(1, 6);
    expect(pts[2].y).toBeCloseTo(1, 6);
    expect(pts[1].x).toBeCloseTo(0.6, 6);
    expect(pts[1].y).toBeCloseTo(0.6, 6);
  });

  it("does not collapse/flip when dragging a corner far past the opposite edge (MIN_PEN_SCALE floor)", () => {
    useAnnotationStore
      .getState()
      .addAnnotation(pen("c", [{ x: 0.3, y: 0.3 }, { x: 0.6, y: 0.6 }]));
    mountGesture();
    // Drag the SE corner up-left far past the NW origin (0.3,0.3): the stroke must
    // keep a positive extent (floored), never invert.
    down(handle("se", "c"), 500, 500);
    move(100, 100); // dx = dy = -0.4 → moving edge would go below origin
    up();
    const pts = penPoints("c");
    expect(pts[1].x).toBeGreaterThan(pts[0].x); // still x0 < x1 (no flip)
    expect(pts[1].y).toBeGreaterThan(pts[0].y);
  });
});
