// usePenGesture — the pen freehand gesture (Story 2.8), encapsulated (Story 5.0).
// Owns its synchronous draft refs + the live-preview state and binds its own
// document-level handlers (AP-1). A pointer DRAG (not a text selection) while pen
// is armed: pointerdown over a page starts a draft, pointermove accumulates client
// points (and drives the preview), pointerup resolves the page, normalizes the
// points, and stores ONE kind=path mark. `preventDefault` on down/move suppresses
// native text-selection + image drag. pointercancel/blur abort a half-stroke so an
// interrupted gesture can't strand a draft (the recurring held-state bug).

import { useEffect, useRef, useState } from "react";
import { normalizePoint, pickPage } from "../../anchor";
import { newId } from "../../uuid";
import { buildPenAnnotation } from "../create";
import type { StrokeInputPoint } from "../pen";
import type { AnnotationTool } from "../../tools";
import { isExempt, type GestureContext } from "./shared";

export function usePenGesture(
  ctx: GestureContext,
  /** The armed tool VALUE (the abort-on-disarm effect keys on it, not the ref). */
  armedTool: AnnotationTool | null,
): { penPreview: StrokeInputPoint[] | null } {
  const { enabled, docId, armedToolRef, getPagesRef, scaleRef, defaultsRef, addAnnotation } = ctx;

  // The in-progress stroke's CLIENT-space points. `penDraftRef` is the
  // authoritative list (read at pointerup to build the mark); `penPreview` mirrors
  // it as state so the live preview SVG re-renders as the pointer moves. Both clear
  // on pointerup/abort. Client space is safe for one stroke: the pointer is
  // captured for the gesture, so the canvas can't scroll mid-draw.
  const penDraftRef = useRef<StrokeInputPoint[]>([]);
  const penDrawingRef = useRef(false);
  // Set true after a stroke is committed so the click that may follow (a scribble
  // that started + ended on an existing mark) is swallowed instead of selecting it.
  const suppressClickRef = useRef(false);
  const [penPreview, setPenPreview] = useState<StrokeInputPoint[] | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const abort = () => {
      penDrawingRef.current = false;
      penDraftRef.current = [];
      suppressClickRef.current = false;
      setPenPreview(null);
    };
    const onDown = (e: PointerEvent) => {
      // A fresh gesture clears any stale click-suppression: a drag-draw sets the flag
      // but (because the pointer moved) NO click follows it, so without this reset the
      // flag would persist and wrongly swallow the user's NEXT click — e.g. a later
      // click-to-select an idle stroke (caught in live smoke).
      suppressClickRef.current = false;
      if (armedToolRef.current !== "pen" || e.button !== 0 || isExempt(e.target)) return;
      const el = e.target as Element | null;
      // Only start over an actual page CARD (not the gutter/margin/chrome or the
      // quick-box): a draft over empty canvas would show a preview + suppress
      // default, then drop the mark on release (pickPage = -1). Require a page.
      if (!el?.closest?.(".page-surface") || el.closest?.(".quick-box")) return;
      penDrawingRef.current = true;
      penDraftRef.current = [{ x: e.clientX, y: e.clientY }];
      setPenPreview([{ x: e.clientX, y: e.clientY }]);
      e.preventDefault();
      // NOTE: do NOT setPointerCapture on the target. Capturing to the mark under
      // the pointer made the browser fire a `click` on that mark when a DRAG that
      // started on it released → it got selected instead of a new stroke landing
      // (user bug). Without capture, document listeners still drive move/up within
      // the window, and a drag's release fires no click on the start mark. A plain
      // CLICK on a mark (no drag) still reaches the mark's own onClick → selects it.
    };
    const onMove = (e: PointerEvent) => {
      if (!penDrawingRef.current) return;
      penDraftRef.current.push({ x: e.clientX, y: e.clientY });
      setPenPreview([...penDraftRef.current]);
      e.preventDefault();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && penDrawingRef.current) abort();
    };
    const onUp = () => {
      if (!penDrawingRef.current) return;
      penDrawingRef.current = false;
      const pts = penDraftRef.current;
      penDraftRef.current = [];
      setPenPreview(null);
      // Inverse path (Codex HIGH): if the pen was disarmed mid-drag (V/Esc → tool
      // switch), do NOT persist a stroke after pen is no longer the armed tool.
      if (armedToolRef.current !== "pen") return;
      // A click with no real drag (< 2 points) makes no mark.
      if (pts.length < 2) return;
      const pages = getPagesRef.current();
      const cardBoxes = pages.map((p) => p.cardEl.getBoundingClientRect());
      // The stroke binds to the page its pointerdown landed on (single-page, AD-5).
      const startIdx = pickPage(
        { left: pts[0].x, top: pts[0].y, right: pts[0].x, bottom: pts[0].y },
        cardBoxes.map((c) => ({ left: c.left, top: c.top, right: c.right, bottom: c.bottom })),
      );
      if (startIdx < 0) return;
      const page = pages[startIdx];
      const cardRect = cardBoxes[startIdx];
      const scale = scaleRef.current;
      const points = pts.map((p) =>
        normalizePoint({ x: p.x - cardRect.left, y: p.y - cardRect.top }, page.box, scale),
      );
      const created = buildPenAnnotation({ page_index: page.pageIndex, points }, docId, {
        now: new Date().toISOString(),
        newId,
        color: defaultsRef.current.color,
        strokeWidth: defaultsRef.current.strokeWidth,
        alpha: defaultsRef.current.alpha,
      });
      addAnnotation(created);
      // Pen does NOT auto-select on release (unlike highlight/memo/comment): drawing
      // is a repeated gesture, so popping the selection quick-box + edit frame after
      // every stroke would interrupt drawing the next one. The stroke lands
      // unselected; click it later to select + edit (restroke/alpha/move/resize).
      // A stroke WAS drawn → swallow the click this gesture may synthesize (a short
      // scribble that started + ended on an existing mark), so it can't ALSO select
      // that mark. A plain click (no stroke, < 2 points) leaves this false, so the
      // mark's own onClick still selects it (click-to-select an idle stroke).
      suppressClickRef.current = true;
    };
    // Swallow exactly one click after a stroke is drawn (see onUp). Capture phase +
    // registered before the mark's React click handling so it wins.
    const onClick = (e: MouseEvent) => {
      if (!suppressClickRef.current) return;
      suppressClickRef.current = false;
      e.preventDefault();
      e.stopPropagation();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", abort);
    document.addEventListener("keydown", onKey);
    document.addEventListener("click", onClick, true);
    window.addEventListener("blur", abort);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", abort);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("blur", abort);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, docId, addAnnotation]);

  // Abort an in-progress pen draft the moment the pen tool is switched away (V/Esc
  // or another tool) — so a stranded draft can't keep a stale preview on screen and
  // the next pointerup can't persist a mark after disarm (Codex HIGH; the twin of
  // the Reader's canPan tear-down). Pure cleanup of the draft state.
  useEffect(() => {
    if (armedTool !== "pen" && penDrawingRef.current) {
      penDrawingRef.current = false;
      penDraftRef.current = [];
      setPenPreview(null);
    }
  }, [armedTool]);

  return { penPreview };
}
