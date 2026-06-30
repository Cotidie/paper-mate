// useEditGesture — drag-handle MOVE/RESIZE of a selected pen or rect mark
// (Story 3.1). The edit frame (AnnotationLayer) renders a move grip + 4 corner
// handles tagged with `data-edit-handle` + `data-edit-id`; this hook turns a drag
// on one of them into a geometry edit. The live drag previews through the
// transient store `dragPreview` (no per-pointermove commit); the ONE
// `setAnnotationGeometry` lands on release, so Story 3.2's zundo records a single
// undo step. Document-level handlers (AP-1); abort on Esc / pointercancel / blur
// WITHOUT committing, so an interrupted drag never strands a preview (the
// recurring held-state bug).
//
// kind=text marks are NOT edited here (no frame is rendered for them): moving a
// text rect would desync `anchor.text` from the glyphs (Story 3.8 re-resolves the
// run instead). This serves kind=rect (memo / region) + kind=path (pen).
// Coordinate math lives in `anchor/` (AD-9); the store does none — the gesture
// computes the next anchor and hands it to `setAnnotationGeometry`.

import { useEffect, useRef, type RefObject } from "react";
import {
  translateRect,
  translatePoints,
  resizeRectCorner,
  scalePoints,
  pointsBounds,
  type PageCardRef,
  type RectCorner,
} from "../../anchor";
import { useAnnotationStore } from "../../store";
import type { Annotation } from "../../api/client";

/** A handle on the edit frame: the move grip or one of the four resize corners. */
export type EditHandle = "move" | RectCorner;

/** Smallest scale factor a pen resize may collapse to, so an overshooting drag
 *  can't scale a stroke to a zero/negative (flipped) size. */
const MIN_PEN_SCALE = 0.05;

interface DragState {
  id: string;
  handle: EditHandle;
  startAnchor: Annotation["anchor"];
  box: { width: number; height: number };
  scale: number;
  startX: number;
  startY: number;
  lastAnchor: Annotation["anchor"] | null;
  moved: boolean;
}

export function useEditGesture(opts: {
  enabled: boolean;
  getPagesRef: RefObject<() => PageCardRef[]>;
  scaleRef: RefObject<number>;
}): void {
  const { enabled, getPagesRef, scaleRef } = opts;
  const setDragPreview = useAnnotationStore((s) => s.setDragPreview);
  const setAnnotationGeometry = useAnnotationStore((s) => s.setAnnotationGeometry);
  const dragRef = useRef<DragState | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const abort = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      setDragPreview(null);
    };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const handleEl = (e.target as HTMLElement | null)?.closest?.(
        "[data-edit-handle]",
      ) as HTMLElement | null;
      if (!handleEl) return;
      const handle = handleEl.dataset.editHandle as EditHandle | undefined;
      const id = handleEl.dataset.editId;
      if (!handle || !id) return;
      const anno = useAnnotationStore.getState().annotations.get(id);
      if (!anno) return;
      const page = getPagesRef.current().find((p) => p.pageIndex === anno.anchor.page_index);
      if (!page) return;
      dragRef.current = {
        id,
        handle,
        startAnchor: anno.anchor,
        box: page.box,
        scale: scaleRef.current,
        startX: e.clientX,
        startY: e.clientY,
        lastAnchor: null,
        moved: false,
      };
      // Suppress the native text-selection/drag the pointerdown would otherwise
      // start; the document listeners drive the gesture from here.
      e.preventDefault();
      try {
        handleEl.setPointerCapture?.(e.pointerId);
      } catch {
        /* capture refused (e.g. synthetic event) — document listeners still drive it */
      }
    };
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const w = d.box.width * d.scale;
      const h = d.box.height * d.scale;
      const dx = w > 0 ? (e.clientX - d.startX) / w : 0;
      const dy = h > 0 ? (e.clientY - d.startY) / h : 0;
      if (dx !== 0 || dy !== 0) d.moved = true;
      const next = computeAnchor(d, dx, dy);
      if (!next) return;
      d.lastAnchor = next;
      setDragPreview({ id: d.id, anchor: next });
      e.preventDefault();
    };
    const onUp = () => {
      const d = dragRef.current;
      if (!d) return;
      dragRef.current = null;
      setDragPreview(null);
      // Commit ONE geometry mutation (so 3.2's zundo records one step). A handle
      // press with no real drag changes nothing → no commit, no updated_at bump.
      if (d.moved && d.lastAnchor) {
        setAnnotationGeometry(d.id, d.lastAnchor, new Date().toISOString());
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dragRef.current) abort();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", abort);
    document.addEventListener("keydown", onKey);
    window.addEventListener("blur", abort);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", abort);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", abort);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
}

/** Compute the dragged mark's next anchor from the normalized delta (page
 *  fractions). Returns null for a kind that is not editable here (text marks are
 *  never given a frame). All math is in `anchor/` (AD-9). */
function computeAnchor(d: DragState, dx: number, dy: number): Annotation["anchor"] | null {
  const a = d.startAnchor;
  if (a.kind === "rect") {
    const rect = d.handle === "move" ? translateRect(a.rect, dx, dy) : resizeRectCorner(a.rect, d.handle, dx, dy);
    return { ...a, rect };
  }
  if (a.kind === "path") {
    if (d.handle === "move") return { ...a, points: translatePoints(a.points, dx, dy) };
    // Resize: scale the points about the FIXED corner opposite the dragged one.
    const b = pointsBounds(a.points);
    if (b.x1 - b.x0 <= 0 || b.y1 - b.y0 <= 0) return a; // a dot/straight stroke: nothing to scale
    const ox = d.handle === "ne" || d.handle === "se" ? b.x0 : b.x1;
    const oy = d.handle === "sw" || d.handle === "se" ? b.y0 : b.y1;
    const movingX = d.handle === "ne" || d.handle === "se" ? b.x1 : b.x0;
    const movingY = d.handle === "sw" || d.handle === "se" ? b.y1 : b.y0;
    const sx = Math.max(MIN_PEN_SCALE, (movingX + dx - ox) / (movingX - ox));
    const sy = Math.max(MIN_PEN_SCALE, (movingY + dy - oy) / (movingY - oy));
    return { ...a, points: scalePoints(a.points, sx, sy, ox, oy) };
  }
  return null; // text marks are not moved here (Story 3.8 re-resolves their run)
}
