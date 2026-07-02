// useBoxGesture — the box-highlight drag gesture (Story 2.11), encapsulated
// (Story 5.0). A pointer DRAG while box-highlight mode is on (Highlight active +
// box mode). Gates on `boxActive` (the armed tool is "highlight", but this is a
// rectangle drag, not a text selection, so it needs the explicit signal). Clone of
// the pen gesture: document-level (AP-1), page-gated, draft→preview→commit, abort.
// On commit: canonicalized rect → normalizeRect → buildRegionAnnotation →
// addAnnotation → select (the 2.5 selection quick-box takes over).

import { useEffect, useRef, useState } from "react";
import { normalizeRect, pickPage } from "@/anchor";
import { newId } from "@/lib/uuid";
import { buildRegionAnnotation } from "@/annotations/create";
import { isExempt, type GestureContext } from "./shared";

/** Minimum pointer travel (px) for a box-select drag to commit a region. Below
 *  this the drag is treated as a stray click and no mark is created. */
const BOX_DRAG_THRESHOLD = 8;

/** A client-space rubber-band preview rect, cleared on commit/abort. */
export interface BoxPreview {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function useBoxGesture(
  ctx: GestureContext,
  /** True when box-highlight mode is on (Highlight active + box mode). */
  boxActive: boolean,
): { boxPreview: BoxPreview | null } {
  const { enabled, docId, getPagesRef, scaleRef, defaultsRef, addAnnotation, select } = ctx;

  // Box-select gesture gates on boxActive (a pointer-tool signal), NOT armedTool
  // (which is null while box is active, Decision 5). Owned by this hook.
  const boxActiveRef = useRef(boxActive);
  boxActiveRef.current = boxActive;
  const boxDrawingRef = useRef(false);
  const boxStartRef = useRef<{ x: number; y: number } | null>(null);
  const [boxPreview, setBoxPreview] = useState<BoxPreview | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const abort = () => {
      boxDrawingRef.current = false;
      boxStartRef.current = null;
      setBoxPreview(null);
    };
    const onDown = (e: PointerEvent) => {
      if (!boxActiveRef.current || e.button !== 0 || isExempt(e.target)) return;
      const el = e.target as Element | null;
      // Reject chrome, quick-box, and existing marks (a click on a mark selects it,
      // not starts a new region). Require a real page card.
      if (
        !el?.closest?.(".page-surface") ||
        el.closest?.(".quick-box") ||
        el.closest?.(".annotation-highlight, .annotation-pen, .annotation-memo, .annotation-comment-pin")
      )
        return;
      boxDrawingRef.current = true;
      boxStartRef.current = { x: e.clientX, y: e.clientY };
      setBoxPreview({ x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY });
      e.preventDefault();
      try {
        (el as Element & { setPointerCapture?: (id: number) => void }).setPointerCapture?.(e.pointerId);
      } catch {
        /* capture refused on synthetic events */
      }
    };
    const onMove = (e: PointerEvent) => {
      if (!boxDrawingRef.current || !boxStartRef.current) return;
      const { x, y } = boxStartRef.current;
      setBoxPreview({ x0: x, y0: y, x1: e.clientX, y1: e.clientY });
      e.preventDefault();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && boxDrawingRef.current) abort();
    };
    const onUp = (e: PointerEvent) => {
      if (!boxDrawingRef.current || !boxStartRef.current) return;
      boxDrawingRef.current = false;
      const start = boxStartRef.current;
      boxStartRef.current = null;
      setBoxPreview(null);
      // Disarm mid-drag (tool switched): do not persist.
      if (!boxActiveRef.current) return;
      // Below-threshold drag → stray click, no region.
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < BOX_DRAG_THRESHOLD) return;
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
      // Card-local corners; normalizeRect canonicalizes (x0≤x1, y0≤y1) and clamps
      // to [0,1] — handles an up-left drag (negative delta) and off-card overshoot.
      const rect = normalizeRect(
        {
          x0: start.x - cardRect.left,
          y0: start.y - cardRect.top,
          x1: e.clientX - cardRect.left,
          y1: e.clientY - cardRect.top,
        },
        page.box,
        scale,
      );
      const created = buildRegionAnnotation({ page_index: page.pageIndex, rect }, docId, {
        now: new Date().toISOString(),
        newId,
        // Box-highlight is a MODE of the Highlight tool (not its own tool), so it
        // reads the Highlight tool's own remembered default color.
        color: defaultsRef.current.colors.highlight,
      });
      addAnnotation(created);
      select(created.id);
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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, docId, addAnnotation, select]);

  // Abort an in-progress box draft the moment box mode is switched off — so a
  // stranded draft can't keep a stale preview or persist after disarm (mirrors the
  // pen abort-on-disarm pattern, Codex HIGH).
  useEffect(() => {
    if (!boxActive && boxDrawingRef.current) {
      boxDrawingRef.current = false;
      boxStartRef.current = null;
      setBoxPreview(null);
    }
  }, [boxActive]);

  return { boxPreview };
}
