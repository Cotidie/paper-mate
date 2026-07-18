import { describe, it, expect, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useEditGesture } from "./useEditGesture";
import { useAnnotationStore, DEFAULT_MEMO_SIZE } from "@/store";
import type { Annotation } from "@/api/client";
import type { PageCardRef } from "@/anchor";

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

function mountGesture(multiSelectActive = false) {
  renderHook(() =>
    useEditGesture({
      enabled: true,
      getPagesRef: { current: pages },
      scaleRef: { current: 1 },
      multiSelectActive,
    }),
  );
}

function handle(kind: string, id: string): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.dataset.editHandle = kind;
  btn.dataset.editId = id;
  document.body.appendChild(btn);
  return btn;
}

/** A memo's own wrapper (data-edit-handle carried UNCONDITIONALLY — user feature
 *  request: drag-to-move from empty space even unselected), nesting a collapse
 *  toggle and a textarea. jsdom has no real layout, so scrollHeight/rect are
 *  stubbed directly, letting each test control whether a given clientY reads as
 *  "on text" or "below it" (isBelowMemoText's threshold). */
function memoWrapper(
  id: string,
  opts: { naturalHeight: number; top: number; height: number },
): { wrapper: HTMLDivElement; textarea: HTMLTextAreaElement; toggle: HTMLButtonElement } {
  const wrapper = document.createElement("div");
  wrapper.dataset.editHandle = "move";
  wrapper.dataset.editId = id;
  wrapper.className = "annotation-memo";

  const toggle = document.createElement("button");
  toggle.className = "memo-collapse-toggle";
  wrapper.appendChild(toggle);

  const textarea = document.createElement("textarea");
  textarea.className = "annotation-memo__body";
  Object.defineProperty(textarea, "scrollHeight", { value: opts.naturalHeight, configurable: true });
  textarea.getBoundingClientRect = () =>
    ({
      left: 0,
      top: opts.top,
      right: 200,
      bottom: opts.top + opts.height,
      width: 200,
      height: opts.height,
      x: 0,
      y: opts.top,
    }) as DOMRect;
  wrapper.appendChild(textarea);

  document.body.appendChild(wrapper);
  return { wrapper, textarea, toggle };
}

/** The multi-select group frame's move grip: `data-edit-group` instead of a
 *  per-mark `data-edit-id` (targets `multiSelectedIds`, read live at pointerdown). */
function groupMoveHandle(): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.dataset.editHandle = "move";
  btn.dataset.editGroup = "";
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
    multiSelectedIds: [],
    hoveredId: null,
    dragPreview: null,
    groupDragPreview: null,
    activeColors: {
      highlight: "annotation-default",
      underline: "annotation-default",
      pen: "annotation-default",
      memo: "annotation-default",
      comment: "annotation-default",
    },
    activeStrokeWidth: 4,
    activeMemoSize: DEFAULT_MEMO_SIZE,
    activeAlpha: { pen: 0.4, memo: 0.4 },
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

  it("floors a memo corner-resize at the minimum size (Story 10.2): a drag that would shrink below 48×32 scale-1 px commits at the floor instead, with the FIXED (nw) corner untouched", () => {
    useAnnotationStore.getState().addAnnotation(memo("m", { x0: 0.25, y0: 0.25, x1: 0.5, y1: 0.5 }));
    mountGesture();
    down(handle("se", "m"), 100, 100);
    move(-200, -200); // dx = dy = -300/1000 = -0.3 — a drag far past the min from the nw corner
    up();
    const m = useAnnotationStore.getState().annotations.get("m")!;
    expect(m.anchor.kind).toBe("rect");
    if (m.anchor.kind !== "rect") return;
    const minW = 48 / BOX.width;
    const minH = 32 / BOX.height;
    expect(m.anchor.rect.x0).toBeCloseTo(0.25, 10); // fixed corner unmoved
    expect(m.anchor.rect.y0).toBeCloseTo(0.25, 10);
    expect(m.anchor.rect.x1).toBeCloseTo(0.25 + minW, 10); // moving corner floored, not collapsed
    expect(m.anchor.rect.y1).toBeCloseTo(0.25 + minH, 10);
  });

  it("does NOT floor a non-memo rect resize (region rects keep no minimum, Story 10.2): the same drag that floors a memo still flips/canonicalizes freely", () => {
    const region: Annotation = {
      id: "r",
      doc_id: "doc-1",
      type: "highlight",
      group_id: null,
      anchor: { kind: "rect", page_index: 0, rect: { x0: 0.25, y0: 0.25, x1: 0.5, y1: 0.5 } },
      style: { color: "annotation-default", stroke_width: null, alpha: null },
      body: null,
      created_at: "2026-06-30T00:00:00Z",
      updated_at: "2026-06-30T00:00:00Z",
    };
    useAnnotationStore.getState().addAnnotation(region);
    mountGesture();
    down(handle("se", "r"), 100, 100);
    move(-200, -200); // same delta as the memo min-floor test above
    up();
    const r = useAnnotationStore.getState().annotations.get("r")!;
    if (r.anchor.kind === "rect") expect(r.anchor.rect).toEqual({ x0: 0.2, y0: 0.2, x1: 0.25, y1: 0.25 });
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

function pen2(id: string, points: { x: number; y: number }[]): Annotation {
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

describe("useEditGesture group move (box-select multi-selection, user feature request)", () => {
  it("moves every multi-selected mark by the SAME delta and commits ONE batch on release", () => {
    useAnnotationStore.getState().addAnnotation(memo("m1", { x0: 0.25, y0: 0.25, x1: 0.5, y1: 0.5 }));
    useAnnotationStore.getState().addAnnotation(memo("m2", { x0: 0.6, y0: 0.6, x1: 0.7, y1: 0.7 }));
    useAnnotationStore.getState().setMultiSelected(["m1", "m2"]);
    mountGesture();
    down(groupMoveHandle(), 100, 100);
    move(350, 350); // dx = dy = 0.25

    // The group drag previews live; neither mark is committed mid-drag.
    const gp = useAnnotationStore.getState().groupDragPreview;
    expect(gp).not.toBeNull();
    expect(gp!.map((g) => g.id).sort()).toEqual(["m1", "m2"]);
    expect(useAnnotationStore.getState().annotations.get("m1")!.updated_at).toBe("2026-06-30T00:00:00Z");

    up();
    const a1 = useAnnotationStore.getState().annotations.get("m1")!;
    const a2 = useAnnotationStore.getState().annotations.get("m2")!;
    if (a1.anchor.kind === "rect") expect(a1.anchor.rect).toEqual({ x0: 0.5, y0: 0.5, x1: 0.75, y1: 0.75 });
    if (a2.anchor.kind === "rect") expect(a2.anchor.rect).toEqual({ x0: 0.85, y0: 0.85, x1: 0.95, y1: 0.95 });
    expect(useAnnotationStore.getState().groupDragPreview).toBeNull();
    expect(a1.updated_at).not.toBe("2026-06-30T00:00:00Z"); // committed → bumped
    expect(a2.updated_at).not.toBe("2026-06-30T00:00:00Z");
  });

  it("moves a mixed group (rect memo + path pen) together, each per its own kind", () => {
    useAnnotationStore.getState().addAnnotation(memo("m1", { x0: 0.1, y0: 0.1, x1: 0.2, y1: 0.2 }));
    useAnnotationStore.getState().addAnnotation(pen2("p1", [{ x: 0.5, y: 0.5 }, { x: 0.6, y: 0.6 }]));
    useAnnotationStore.getState().setMultiSelected(["m1", "p1"]);
    mountGesture();
    down(groupMoveHandle(), 100, 100);
    move(200, 100); // dx = 0.1, dy = 0
    up();
    const a1 = useAnnotationStore.getState().annotations.get("m1")!;
    const a2 = useAnnotationStore.getState().annotations.get("p1")!;
    if (a1.anchor.kind === "rect") {
      expect(a1.anchor.rect.x0).toBeCloseTo(0.2, 10);
      expect(a1.anchor.rect.y0).toBeCloseTo(0.1, 10);
      expect(a1.anchor.rect.x1).toBeCloseTo(0.3, 10);
      expect(a1.anchor.rect.y1).toBeCloseTo(0.2, 10);
    }
    if (a2.anchor.kind === "path") {
      expect(a2.anchor.points[0].x).toBeCloseTo(0.6, 10);
      expect(a2.anchor.points[0].y).toBeCloseTo(0.5, 10);
      expect(a2.anchor.points[1].x).toBeCloseTo(0.7, 10);
      expect(a2.anchor.points[1].y).toBeCloseTo(0.6, 10);
    }
  });

  it("a group press with no real drag commits nothing (no updated_at bump)", () => {
    useAnnotationStore.getState().addAnnotation(memo("m1", { x0: 0.25, y0: 0.25, x1: 0.5, y1: 0.5 }));
    useAnnotationStore.getState().setMultiSelected(["m1"]);
    mountGesture();
    down(groupMoveHandle(), 100, 100);
    up();
    expect(useAnnotationStore.getState().annotations.get("m1")!.updated_at).toBe("2026-06-30T00:00:00Z");
    expect(useAnnotationStore.getState().groupDragPreview).toBeNull();
  });

  it("aborts on Escape WITHOUT committing (preview cleared, marks unchanged)", () => {
    useAnnotationStore.getState().addAnnotation(memo("m1", { x0: 0.25, y0: 0.25, x1: 0.5, y1: 0.5 }));
    useAnnotationStore.getState().setMultiSelected(["m1"]);
    mountGesture();
    down(groupMoveHandle(), 100, 100);
    move(350, 350);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(useAnnotationStore.getState().groupDragPreview).toBeNull();
    up();
    const m1 = useAnnotationStore.getState().annotations.get("m1")!;
    if (m1.anchor.kind === "rect") expect(m1.anchor.rect).toEqual({ x0: 0.25, y0: 0.25, x1: 0.5, y1: 0.5 });
    expect(m1.updated_at).toBe("2026-06-30T00:00:00Z");
  });

  it("excludes a text-anchor mark from the group drag (Story 3.8 territory) even if listed in multiSelectedIds", () => {
    function textMark(id: string): Annotation {
      return {
        id,
        doc_id: "doc-1",
        type: "highlight",
        group_id: null,
        anchor: { kind: "text", page_index: 0, rects: [{ x0: 0.1, y0: 0.1, x1: 0.3, y1: 0.2 }], text: "x" },
        style: { color: "annotation-default", stroke_width: null, alpha: null },
        body: null,
        created_at: "2026-06-30T00:00:00Z",
        updated_at: "2026-06-30T00:00:00Z",
      };
    }
    useAnnotationStore.getState().addAnnotation(memo("m1", { x0: 0.5, y0: 0.5, x1: 0.6, y1: 0.6 }));
    useAnnotationStore.getState().addAnnotation(textMark("h1"));
    useAnnotationStore.getState().setMultiSelected(["m1", "h1"]);
    mountGesture();
    down(groupMoveHandle(), 100, 100);
    move(200, 100);
    up();
    const h1 = useAnnotationStore.getState().annotations.get("h1")!;
    // The text mark's rects are untouched; only m1 moved.
    if (h1.anchor.kind === "text") expect(h1.anchor.rects).toEqual([{ x0: 0.1, y0: 0.1, x1: 0.3, y1: 0.2 }]);
    const m1 = useAnnotationStore.getState().annotations.get("m1")!;
    if (m1.anchor.kind === "rect") expect(m1.anchor.rect).toEqual({ x0: 0.6, y0: 0.5, x1: 0.7, y1: 0.6 });
  });

  it("does nothing when multiSelectedIds is empty (no group frame, no marks to drag)", () => {
    useAnnotationStore.getState().addAnnotation(memo("m1", { x0: 0.25, y0: 0.25, x1: 0.5, y1: 0.5 }));
    mountGesture();
    down(groupMoveHandle(), 100, 100);
    move(350, 350);
    up();
    expect(useAnnotationStore.getState().groupDragPreview).toBeNull();
    const m1 = useAnnotationStore.getState().annotations.get("m1")!;
    if (m1.anchor.kind === "rect") expect(m1.anchor.rect).toEqual({ x0: 0.25, y0: 0.25, x1: 0.5, y1: 0.5 });
  });

  it("a single-mark drag and a group drag do not interfere (mutually exclusive DragState refs)", () => {
    useAnnotationStore.getState().addAnnotation(memo("solo", { x0: 0.1, y0: 0.1, x1: 0.2, y1: 0.2 }));
    useAnnotationStore.getState().addAnnotation(memo("g1", { x0: 0.5, y0: 0.5, x1: 0.6, y1: 0.6 }));
    useAnnotationStore.getState().setMultiSelected(["g1"]);
    mountGesture();
    // Single-mark move first.
    down(handle("move", "solo"), 100, 100);
    move(200, 100);
    up();
    const solo = useAnnotationStore.getState().annotations.get("solo")!;
    if (solo.anchor.kind === "rect") {
      expect(solo.anchor.rect.x0).toBeCloseTo(0.2, 10);
      expect(solo.anchor.rect.x1).toBeCloseTo(0.3, 10);
    }
    // The solo move must NOT clobber the pre-existing, UNRELATED g1
    // multi-selection (user feature request's select()-on-move guard) — the
    // regression this exact assertion caught: an earlier version called select()
    // unconditionally, wiping multiSelectedIds here and silently no-op-ing the
    // group move below (empty `members`).
    expect(useAnnotationStore.getState().multiSelectedIds).toEqual(["g1"]);
    // Then a group move.
    down(groupMoveHandle(), 100, 100);
    move(200, 100);
    up();
    const g1 = useAnnotationStore.getState().annotations.get("g1")!;
    if (g1.anchor.kind === "rect") {
      expect(g1.anchor.rect.x0).toBeCloseTo(0.6, 10);
      expect(g1.anchor.rect.x1).toBeCloseTo(0.7, 10);
    }
  });
});

describe("useEditGesture memo empty-space drag-to-move (user feature request)", () => {
  it("dragging EMPTY space inside an UNSELECTED memo's textarea moves it and selects it on commit", () => {
    useAnnotationStore.getState().addAnnotation(memo("m", { x0: 0.25, y0: 0.25, x1: 0.5, y1: 0.5 }));
    mountGesture();
    const { textarea } = memoWrapper("m", { naturalHeight: 20, top: 0, height: 200 });
    // clientY=150 is well below naturalHeight=20 -> empty space.
    down(textarea, 100, 150);
    move(350, 150);
    expect(useAnnotationStore.getState().dragPreview?.id).toBe("m");
    up();
    const m = useAnnotationStore.getState().annotations.get("m")!;
    if (m.anchor.kind === "rect") {
      expect(m.anchor.rect.x0).toBeCloseTo(0.5, 10);
      expect(m.anchor.rect.x1).toBeCloseTo(0.75, 10);
    }
    expect(useAnnotationStore.getState().selectedId).toBe("m");
  });

  it("pressing ON the text itself (above naturalHeight) does NOT start a move (normal textarea click/select proceeds)", () => {
    useAnnotationStore.getState().addAnnotation(memo("m", { x0: 0.25, y0: 0.25, x1: 0.5, y1: 0.5 }));
    mountGesture();
    const { textarea } = memoWrapper("m", { naturalHeight: 100, top: 0, height: 200 });
    // clientY=10 is within naturalHeight=100 -> real text.
    down(textarea, 100, 10);
    move(350, 10);
    expect(useAnnotationStore.getState().dragPreview).toBeNull();
    up();
    const m = useAnnotationStore.getState().annotations.get("m")!;
    if (m.anchor.kind === "rect") expect(m.anchor.rect).toEqual({ x0: 0.25, y0: 0.25, x1: 0.5, y1: 0.5 });
    expect(useAnnotationStore.getState().selectedId).toBeNull();
  });

  it("pressing the collapse toggle never starts a move, even though it is nested in the data-edit-handle wrapper", () => {
    useAnnotationStore.getState().addAnnotation(memo("m", { x0: 0.25, y0: 0.25, x1: 0.5, y1: 0.5 }));
    mountGesture();
    const { toggle } = memoWrapper("m", { naturalHeight: 20, top: 0, height: 200 });
    down(toggle, 100, 100);
    move(350, 100);
    expect(useAnnotationStore.getState().dragPreview).toBeNull();
  });

  it("empty-space press on the WRAPPER itself (not the textarea, e.g. the padding rim) also moves it", () => {
    useAnnotationStore.getState().addAnnotation(memo("m", { x0: 0.25, y0: 0.25, x1: 0.5, y1: 0.5 }));
    mountGesture();
    const { wrapper } = memoWrapper("m", { naturalHeight: 20, top: 0, height: 200 });
    down(wrapper, 100, 100);
    move(350, 100);
    expect(useAnnotationStore.getState().dragPreview?.id).toBe("m");
  });

  it("does NOT start a move while box-select is armed (yields the gesture to the marquee)", () => {
    useAnnotationStore.getState().addAnnotation(memo("m", { x0: 0.25, y0: 0.25, x1: 0.5, y1: 0.5 }));
    mountGesture(true);
    const { textarea } = memoWrapper("m", { naturalHeight: 20, top: 0, height: 200 });
    down(textarea, 100, 150);
    move(350, 150);
    expect(useAnnotationStore.getState().dragPreview).toBeNull();
  });

  it("moving an unrelated, UNSELECTED memo does not clobber an active multi-selection", () => {
    useAnnotationStore.getState().addAnnotation(memo("m", { x0: 0.25, y0: 0.25, x1: 0.5, y1: 0.5 }));
    useAnnotationStore.getState().addAnnotation(memo("g1", { x0: 0.6, y0: 0.6, x1: 0.7, y1: 0.7 }));
    useAnnotationStore.getState().setMultiSelected(["g1"]);
    mountGesture();
    const { textarea } = memoWrapper("m", { naturalHeight: 20, top: 0, height: 200 });
    down(textarea, 100, 150);
    move(350, 150);
    up();
    // Moved, but left the g1 multi-selection alone and did NOT promote "m" into
    // selectedId (AD-12 mutual exclusion: select() would have cleared g1's
    // selection out from under the user).
    expect(useAnnotationStore.getState().multiSelectedIds).toEqual(["g1"]);
    expect(useAnnotationStore.getState().selectedId).toBeNull();
  });
});
