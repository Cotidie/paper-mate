// useMultiSelectGesture — the box-select marquee gesture (user feature request):
// drag a rectangle while the Box-select pointer tool is armed to select every
// EXISTING annotation the rectangle overlaps, on the page the drag started on.
// A SEPARATE selection mode from the single `selectedId` (AD-12 extended):
// populates `multiSelectedIds` instead, which supports bulk Delete + bulk Move
// (not recolor/restroke/retext) via its own small group edit frame
// (AnnotationLayer's `renderMultiSelectFrame`, `useEditGesture`'s group-move path).
//
// Clone of useBoxGesture's shape (draft -> preview -> commit, abort, document-
// level, AP-1) with different hit-testing (existing marks, not a new create) and
// a different commit action (setMultiSelected, not addAnnotation). Also owns
// Del/Esc + empty-space-deselect for the multi-selection, mirroring
// useSelection.ts's own selectedAnno-gated effect (that one never sees
// `multiSelectedIds` — a deliberately separate concern, kept out of that
// heavily-tested single-select file).

import { useEffect, useRef, useState, type RefObject } from "react";
import { normalizeRect, pickPage, pointsBounds, rectsIntersect, type PageCardRef } from "@/anchor";
import { useAnnotationStore } from "@/store";
import type { Annotation, Rect } from "@/api/client";
import { isExempt } from "./shared";

/** Minimum pointer travel (px) for a marquee drag to commit a selection. Below
 *  this the drag is treated as a stray click and the selection is left
 *  untouched (mirrors useBoxGesture's BOX_DRAG_THRESHOLD). */
const MULTI_SELECT_DRAG_THRESHOLD = 8;

/** A client-space rubber-band preview rect, cleared on commit/abort. */
export interface MultiSelectPreview {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Whether a mark's own geometry overlaps the marquee rect (normalized space;
 *  the caller already scopes candidates to one page). A text mark counts if the
 *  marquee overlaps ANY of its per-line rects (not just their envelope, so a
 *  marquee threading between two lines doesn't falsely catch the gap between
 *  them); rect/path marks use their own rect / points bounding box. */
function markOverlaps(a: Annotation, marquee: Rect): boolean {
  if (a.anchor.kind === "text") return a.anchor.rects.some((r) => rectsIntersect(r, marquee));
  if (a.anchor.kind === "rect") return rectsIntersect(a.anchor.rect, marquee);
  return rectsIntersect(pointsBounds(a.anchor.points), marquee);
}

export function useMultiSelectGesture(opts: {
  enabled: boolean;
  docId: string;
  getPagesRef: RefObject<() => PageCardRef[]>;
  scaleRef: RefObject<number>;
  /** True when the Box-select pointer tool is armed. */
  active: boolean;
}): { multiSelectPreview: MultiSelectPreview | null } {
  const { enabled, docId, getPagesRef, scaleRef, active } = opts;
  const activeRef = useRef(active);
  activeRef.current = active;
  const drawingRef = useRef(false);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const [multiSelectPreview, setMultiSelectPreview] = useState<MultiSelectPreview | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const abort = () => {
      drawingRef.current = false;
      startRef.current = null;
      setMultiSelectPreview(null);
    };
    const onDown = (e: PointerEvent) => {
      if (!activeRef.current || e.button !== 0 || isExempt(e.target)) return;
      const el = e.target as Element | null;
      // A marquee CAN start over an existing mark (dragging across it is still a
      // valid selection drag) — only chrome/the quick-box are off-limits, unlike
      // useBoxGesture's create gesture (which rejects starting on a mark).
      if (!el?.closest?.(".page-surface") || el.closest?.(".quick-box")) return;
      drawingRef.current = true;
      startRef.current = { x: e.clientX, y: e.clientY };
      setMultiSelectPreview({ x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY });
      // Suppress the native text-selection drag (user fix request: dragging the
      // marquee over page text also highlighted it) — must fire on POINTERDOWN,
      // matching useBoxGesture's own onDown: the browser sets the selection anchor
      // at mousedown, so preventing default only on pointermove (below) is too
      // late, the anchor is already set and mousemove keeps extending it.
      e.preventDefault();
      try {
        (el as Element & { setPointerCapture?: (id: number) => void }).setPointerCapture?.(e.pointerId);
      } catch {
        /* capture refused on synthetic events */
      }
    };
    const onMove = (e: PointerEvent) => {
      if (!drawingRef.current || !startRef.current) return;
      const { x, y } = startRef.current;
      setMultiSelectPreview({ x0: x, y0: y, x1: e.clientX, y1: e.clientY });
      e.preventDefault();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && drawingRef.current) abort();
    };
    const onUp = (e: PointerEvent) => {
      if (!drawingRef.current || !startRef.current) return;
      drawingRef.current = false;
      const start = startRef.current;
      startRef.current = null;
      setMultiSelectPreview(null);
      // Disarm mid-drag (tool switched): do not commit.
      if (!activeRef.current) return;
      // Below-threshold drag -> stray click, no selection change.
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < MULTI_SELECT_DRAG_THRESHOLD) return;
      const pages = getPagesRef.current();
      const cardBoxes = pages.map((p) => p.cardEl.getBoundingClientRect());
      const startIdx = pickPage(
        { left: start.x, top: start.y, right: start.x, bottom: start.y },
        cardBoxes.map((c) => ({ left: c.left, top: c.top, right: c.right, bottom: c.bottom })),
      );
      if (startIdx < 0) return;
      const page = pages[startIdx];
      const cardRect = cardBoxes[startIdx];
      const scale = scaleRef.current;
      const marquee = normalizeRect(
        {
          x0: start.x - cardRect.left,
          y0: start.y - cardRect.top,
          x1: e.clientX - cardRect.left,
          y1: e.clientY - cardRect.top,
        },
        page.box,
        scale,
      );
      const hits = [...useAnnotationStore.getState().annotations.values()].filter(
        (a) => a.doc_id === docId && a.anchor.page_index === page.pageIndex && markOverlaps(a, marquee),
      );
      useAnnotationStore.getState().setMultiSelected(hits.map((a) => a.id));
      e.preventDefault();
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
      // `enabled` going false (e.g. the hide-all toggle, Story 5.5) tears down these
      // listeners mid-drag same as any other disable path: abort the draft here too,
      // not just remove listeners, so a physical pointerup landing with no listener
      // bound can't leave a stale draft for the next enable to pick up (the recurring
      // held-state bug).
      abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, docId]);

  // Abort an in-progress marquee draft the moment box-select mode is switched off
  // (mirrors the pen/box-highlight abort-on-disarm pattern).
  useEffect(() => {
    if (!active && drawingRef.current) {
      drawingRef.current = false;
      startRef.current = null;
      setMultiSelectPreview(null);
    }
  }, [active]);

  // Del/Esc + empty-space-deselect for the multi-selection, document-level +
  // phase-gated (AP-1). Live only while something is multi-selected. The group
  // frame's move grip / delete button are real <button>s, so `isExempt` catches a
  // click landing exactly ON one — but NOT a click on the delete button's Trash
  // <svg> icon CHILD (found live: `e.target` there is the svg/path, not the
  // button, so isExempt's exact-tagName check misses it and the deselect fired
  // before the click landed, silently eating the delete). The `inFrame` check
  // below covers the whole frame's interior, mirroring useSelection.ts's `inBox`
  // fallback for its own quick-box's icon buttons.
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const ids = useAnnotationStore.getState().multiSelectedIds;
      if (ids.length === 0) return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (isExempt(e.target)) return;
      if (e.key === "Escape") {
        useAnnotationStore.getState().clearMultiSelection();
        return;
      }
      if (e.key === "Delete") {
        e.preventDefault();
        useAnnotationStore.getState().deleteMany(ids);
      }
    };
    const onPointerDown = (e: PointerEvent) => {
      const ids = useAnnotationStore.getState().multiSelectedIds;
      if (ids.length === 0) return;
      const t = e.target as HTMLElement | null;
      if (isExempt(t)) return;
      const onMark = !!t?.closest?.(
        ".annotation-highlight, .annotation-pen, .annotation-memo, .annotation-comment-pin",
      );
      const inFrame = !!t?.closest?.(".annotation-multi-select-frame");
      if (!onMark && !inFrame) useAnnotationStore.getState().clearMultiSelection();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [enabled]);

  return { multiSelectPreview };
}
