import { describe, it, expect, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useUndoRedo } from "./useUndoRedo";
import { useAnnotationStore, DEFAULT_MEMO_SIZE } from "@/store";
import type { Annotation } from "@/api/client";

function mark(id: string): Annotation {
  return {
    id,
    doc_id: "doc-1",
    type: "highlight",
    group_id: null,
    anchor: { kind: "text", page_index: 0, rects: [], text: "x" },
    style: { color: "annotation-default", stroke_width: null, alpha: null },
    body: null,
    created_at: "2026-06-29T00:00:01Z",
    updated_at: "2026-06-29T00:00:01Z",
  };
}

const ctrl = (key: string, shift = false) =>
  document.dispatchEvent(
    new KeyboardEvent("keydown", { key, ctrlKey: true, shiftKey: shift, bubbles: true }),
  );

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
    activeStrokeWidth: 8,
    activeMemoSize: DEFAULT_MEMO_SIZE,
    activeAlpha: { pen: 0.4, memo: 0.4 },
  });
  useAnnotationStore.temporal.getState().clear();
});

describe("useUndoRedo (Story 3.2, AC-1, AC-5, AC-6)", () => {
  it("Ctrl+Z undoes the last create (store loses the annotation)", () => {
    renderHook(() => useUndoRedo({ enabled: true }));
    useAnnotationStore.getState().addAnnotation(mark("a"));
    expect(useAnnotationStore.getState().annotations.has("a")).toBe(true);
    ctrl("z");
    expect(useAnnotationStore.getState().annotations.has("a")).toBe(false);
  });

  it("Ctrl+Shift+Z redoes after an undo (annotation restored)", () => {
    renderHook(() => useUndoRedo({ enabled: true }));
    useAnnotationStore.getState().addAnnotation(mark("a"));
    ctrl("z");
    expect(useAnnotationStore.getState().annotations.has("a")).toBe(false);
    ctrl("z", true); // Ctrl+Shift+Z
    expect(useAnnotationStore.getState().annotations.has("a")).toBe(true);
  });

  it("Ctrl+Y also redoes (Windows alt)", () => {
    renderHook(() => useUndoRedo({ enabled: true }));
    useAnnotationStore.getState().addAnnotation(mark("a"));
    ctrl("z");
    ctrl("y");
    expect(useAnnotationStore.getState().annotations.has("a")).toBe(true);
  });

  it("empty-stack Ctrl+Z is a silent no-op (no throw, no spurious render)", () => {
    renderHook(() => useUndoRedo({ enabled: true }));
    expect(() => ctrl("z")).not.toThrow();
    expect(useAnnotationStore.getState().annotations.size).toBe(0);
  });

  it("empty-stack Ctrl+Shift+Z is a silent no-op", () => {
    renderHook(() => useUndoRedo({ enabled: true }));
    expect(() => ctrl("z", true)).not.toThrow();
  });

  it("Ctrl+Z clears stale selectedId when the undo removes the selected annotation", () => {
    renderHook(() => useUndoRedo({ enabled: true }));
    useAnnotationStore.getState().addAnnotation(mark("a"));
    useAnnotationStore.getState().select("a");
    expect(useAnnotationStore.getState().selectedId).toBe("a");
    ctrl("z"); // undo the add → "a" gone
    expect(useAnnotationStore.getState().annotations.has("a")).toBe(false);
    expect(useAnnotationStore.getState().selectedId).toBeNull();
  });

  it("Ctrl+Z inside a focused textarea does NOT trigger annotation undo (isExempt)", () => {
    renderHook(() => useUndoRedo({ enabled: true }));
    useAnnotationStore.getState().addAnnotation(mark("a"));
    const textarea = document.createElement("textarea");
    document.body.appendChild(textarea);
    textarea.focus();
    // Fire directly on the textarea so e.target is the textarea.
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }));
    // Annotation should still be there; only the BROWSER's text undo fired.
    expect(useAnnotationStore.getState().annotations.has("a")).toBe(true);
  });

  it("Ctrl+Z while a quick-box button has focus STILL undoes (buttons are not exempt)", () => {
    // After a create, the selection quick-box opens and focus lands on its first
    // swatch <button>; undo must still fire (a button has no native text-undo).
    renderHook(() => useUndoRedo({ enabled: true }));
    useAnnotationStore.getState().addAnnotation(mark("a"));
    const button = document.createElement("button");
    document.body.appendChild(button);
    button.focus();
    button.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }));
    expect(useAnnotationStore.getState().annotations.has("a")).toBe(false);
  });

  it("handler is NOT active when enabled=false (phase gate)", () => {
    renderHook(() => useUndoRedo({ enabled: false }));
    useAnnotationStore.getState().addAnnotation(mark("a"));
    ctrl("z");
    expect(useAnnotationStore.getState().annotations.has("a")).toBe(true);
  });
});
