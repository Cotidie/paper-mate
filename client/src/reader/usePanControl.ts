// usePanControl — Reader's pan concern (Story 5.3 extraction, mirrors the
// Story 5.0 `annotations/gestures/*` pattern). Hold-`Space` temp-pan (falls
// back to the armed tool on release) OR the Hand tool armed via `panArmed`,
// plus the pointer-drag mechanics that move `scrollLeft`/`scrollTop` only
// (NFR-1) — never the scale, card geometry, or page box, and no anchor math
// (AR-9).

import { useEffect, useRef, useState, type RefObject } from "react";
import { panScroll } from "../render";
import { isControlTarget } from "../lib/domFocus";

export interface PanControlApi {
  canPan: boolean;
  dragging: boolean;
  handlePointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  handlePointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
  endDrag: (e: React.PointerEvent<HTMLDivElement>) => void;
}

export function usePanControl(opts: {
  scrollRef: RefObject<HTMLDivElement | null>;
  panArmed?: boolean;
  phase: "loading" | "ready" | "error";
}): PanControlApi {
  const { scrollRef, panArmed, phase } = opts;

  // `dragging` drives the grab→grabbing cursor; the drag origin lives in a ref
  // so a pointermove never re-renders.
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [dragging, setDragging] = useState(false);
  const canPan = (panArmed ?? false) || spaceHeld;
  const dragOrigin = useRef<
    { x: number; y: number; scrollLeft: number; scrollTop: number } | null
  >(null);
  // The captured pointer for the active drag, so an interrupted pan (e.g. Space
  // released mid-drag → no longer pannable) can release capture + stop.
  const dragPointerId = useRef<number | null>(null);

  // Hold-`Space` temp-pan (AC-2/AC-3), bound at the DOCUMENT level (guarded
  // `phase === "ready"`) so it arms regardless of which reader element has focus —
  // mirroring the zoom-key effect. Skip editable fields and buttons so Space still
  // activates a focused control (and the rail/flyout buttons keep working). Ignore
  // auto-repeat so a held key doesn't thrash. keydown suppresses the browser's
  // page-scroll-on-Space; keyup drops `spaceHeld` so `canPan` falls back to the
  // armed tool (the active-drag teardown below stops any pan already in flight).
  useEffect(() => {
    if (phase !== "ready") return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== " " || isControlTarget(e.target)) return;
      if (!e.repeat) setSpaceHeld(true);
      e.preventDefault();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === " ") setSpaceHeld(false);
    };
    // Always clear the held flag when the window loses focus or visibility: if
    // focus leaves mid-hold (alt-tab, OS shortcut, devtools), the `keyup` never
    // arrives, so `spaceHeld` would stick true forever — `canPan` stays true,
    // `.pdf-canvas` keeps the grab cursor, and every drag pans instead of
    // selecting, which silently kills text highlighting. Reset on blur/hidden so
    // a missed keyup can never strand the reader in pan mode (Epic-1 retro AP-1:
    // the recurring focus-handler bug).
    const releaseSpace = () => setSpaceHeld(false);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", releaseSpace);
    document.addEventListener("visibilitychange", releaseSpace);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", releaseSpace);
      document.removeEventListener("visibilitychange", releaseSpace);
    };
  }, [phase]);

  // Stop an in-flight pan the moment it stops being pannable — e.g. `Space` is
  // released mid-drag while the armed tool is cursor (AC-3: control returns to the
  // previous tool). With the hand armed, `canPan` stays true so the drag continues
  // until pointerup. Releases any captured pointer so a later move can't resume it.
  useEffect(() => {
    if (canPan || !dragOrigin.current) return;
    const container = scrollRef.current;
    if (container && dragPointerId.current !== null) {
      try {
        container.releasePointerCapture?.(dragPointerId.current);
      } catch {
        /* capture already gone */
      }
    }
    dragOrigin.current = null;
    dragPointerId.current = null;
    setDragging(false);
  }, [canPan, scrollRef]);

  // Pointer-drag pan: only when pannable and with the primary button. Capture the
  // pointer so a fast drag off the canvas keeps panning and still gets pointerup;
  // preventDefault suppresses text selection / native image drag. The page follows
  // the pointer via panScroll (grab-and-drag). Scroll-offset only (NFR-1).
  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!canPan || e.button !== 0) return;
    const container = scrollRef.current;
    if (!container) return;
    // Record the origin + arm the drag FIRST, so panning never depends on pointer
    // capture succeeding. Capture is a best-effort enhancement (keeps a fast drag
    // that leaves the canvas panning); wrap it so a refusal can't abort the drag.
    dragOrigin.current = {
      x: e.clientX,
      y: e.clientY,
      scrollLeft: container.scrollLeft,
      scrollTop: container.scrollTop,
    };
    dragPointerId.current = e.pointerId;
    setDragging(true);
    e.preventDefault();
    try {
      container.setPointerCapture?.(e.pointerId);
    } catch {
      /* no active pointer (e.g. synthetic event) — drag still works without capture */
    }
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    // Re-check `canPan`: if the gesture stopped being pannable mid-drag (Space
    // released while cursor is the armed tool), don't keep panning (AC-3). The
    // canPan effect above also tears the drag down, but gating here is immediate.
    if (!canPan) return;
    const origin = dragOrigin.current;
    const container = scrollRef.current;
    if (!origin || !container) return;
    container.scrollLeft = panScroll(origin.scrollLeft, e.clientX - origin.x);
    container.scrollTop = panScroll(origin.scrollTop, e.clientY - origin.y);
  }

  function endDrag(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragOrigin.current) return;
    scrollRef.current?.releasePointerCapture?.(e.pointerId);
    dragOrigin.current = null;
    dragPointerId.current = null;
    setDragging(false);
  }

  return { canPan, dragging, handlePointerDown, handlePointerMove, endDrag };
}
