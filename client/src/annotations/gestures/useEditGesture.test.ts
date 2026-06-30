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
});
