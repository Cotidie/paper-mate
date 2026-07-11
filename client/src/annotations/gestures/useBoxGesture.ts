// useBoxGesture — the box-drag gesture (Story 2.11; generalized Story 8.4),
// encapsulated (Story 5.0). A pointer DRAG while a box mode is on: Highlight's
// box-highlight mode builds a region highlight, Comment's box-comment mode
// (Story 8.4) builds a region comment. Gates on `boxMode` (the armed tool is
// "highlight"/"comment", but this is a rectangle drag, not a text selection, so
// it needs the explicit signal). Clone of the pen gesture: document-level
// (AP-1), page-gated, draft→preview→commit, abort. On commit: canonicalized
// rect → normalizeRect → the mode's builder → addAnnotation → select (the 2.5
// selection quick-box, or the comment bubble, takes over).

import { useEffect, useRef, useState } from "react";
import { normalizeRect, pickPage } from "@/anchor";
import { newId } from "@/lib/uuid";
import { buildRegionAnnotation, buildCommentPin } from "@/annotations/create";
import { isExempt, type GestureContext } from "./shared";

/** Minimum pointer travel (px) for a box-select drag to commit a region. Below
 *  this the drag is treated as a stray click and no mark is created. */
const BOX_DRAG_THRESHOLD = 8;

/** Which mark a box drag builds; `null` = no box mode active. */
export type BoxMode = "highlight" | "comment";

/** A client-space rubber-band preview rect, cleared on commit/abort. */
export interface BoxPreview {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function useBoxGesture(
  ctx: GestureContext,
  /** The active box mode (Highlight's box-highlight or Comment's box-comment),
   *  or null while no box mode is on. */
  boxMode: BoxMode | null,
): { boxPreview: BoxPreview | null } {
  const { enabled, docId, getPagesRef, scaleRef, defaultsRef, addAnnotation, select } = ctx;

  // Box gesture gates on boxMode (a pointer-tool signal), NOT armedTool (which
  // still reads "highlight"/"comment" while a box mode is active, Decision 5).
  // Owned by this hook.
  const boxModeRef = useRef(boxMode);
  boxModeRef.current = boxMode;
  const boxDrawingRef = useRef(false);
  const boxStartRef = useRef<{ x: number; y: number } | null>(null);
  // The mode a drag STARTED under, snapshotted at pointerdown. A hotkey/flyout
  // switch mid-drag (e.g. comment-box → highlight-box, Codex 8.4 review, Med
  // finding 1) mutates `boxModeRef` live without ever passing through null, so
  // the pointerup handler must compare against the START mode, not re-read the
  // current one, or it commits the WRONG mark type for a drag that began under
  // a different mode.
  const dragModeRef = useRef<BoxMode | null>(null);
  const [boxPreview, setBoxPreview] = useState<BoxPreview | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const abort = () => {
      boxDrawingRef.current = false;
      boxStartRef.current = null;
      dragModeRef.current = null;
      setBoxPreview(null);
    };
    const onDown = (e: PointerEvent) => {
      if (boxModeRef.current === null || e.button !== 0 || isExempt(e.target)) return;
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
      dragModeRef.current = boxModeRef.current;
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
      // Disarm mid-drag (tool switched to off, OR to the OTHER box mode without
      // ever passing through null): commit under the mode the drag STARTED
      // with, and only if it is still on. Do not persist otherwise.
      const mode = dragModeRef.current;
      dragModeRef.current = null;
      if (mode === null || mode !== boxModeRef.current) return;
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
      const placement = { page_index: page.pageIndex, rect };
      const created =
        mode === "highlight"
          ? buildRegionAnnotation(placement, docId, {
              now: new Date().toISOString(),
              newId,
              // Box-highlight is a MODE of the Highlight tool (not its own tool), so
              // it reads the Highlight tool's own remembered default color.
              color: defaultsRef.current.colors.highlight,
            })
          : buildCommentPin(placement, docId, {
              now: new Date().toISOString(),
              newId,
              // Box-comment is a MODE of the Comment tool (Story 8.4); same pattern.
              color: defaultsRef.current.colors.comment,
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
      // `enabled` going false (e.g. the hide-all toggle, Story 5.5) tears down these
      // listeners mid-drag same as any other disable path: abort the draft here too,
      // not just remove listeners, so a physical pointerup landing with no listener
      // bound can't leave a stale draft for the next enable to pick up (the recurring
      // held-state bug).
      abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, docId, addAnnotation, select]);

  // Abort an in-progress box draft the moment box mode is switched off — so a
  // stranded draft can't keep a stale preview or persist after disarm (mirrors the
  // pen abort-on-disarm pattern, Codex HIGH).
  useEffect(() => {
    if (boxMode === null && boxDrawingRef.current) {
      boxDrawingRef.current = false;
      boxStartRef.current = null;
      dragModeRef.current = null;
      setBoxPreview(null);
    }
  }, [boxMode]);

  return { boxPreview };
}
