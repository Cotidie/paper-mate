// useZoomControl — Reader's zoom concern (Story 5.3 extraction, mirrors the
// Story 5.0 `annotations/gestures/*` pattern of one hook per interaction
// concern owning its own synchronous refs). Scale state, focal-anchored
// zoom in/out/reset (button + Ctrl+wheel + Ctrl+/-/0), and the post-layout
// scroll compensation that keeps the focal point fixed on screen through a
// re-render at the new scale.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { fitToWidthScale, nextZoom, focalScroll, ZOOM_STEP, ZOOM_WHEEL_STEP, type PageBox } from "../render";

/**
 * Read a spacing token (e.g. `--space-lg`) from the theme layer as a number of
 * CSS px, so layout math derives from the design tokens rather than hardcoding
 * dimensions in component code. Falls back if the var is unset (e.g. jsdom).
 */
function readSpacePx(varName: string, fallback: number): number {
  if (typeof getComputedStyle === "undefined") return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(varName);
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

export interface ZoomControlApi {
  scale: number;
  /** The raw setter, for the initial fit-to-width on doc load (no focal point
   *  to preserve yet — the container hasn't been scrolled). */
  setScale: (scale: number) => void;
  /** Fit-to-width scale for the given page boxes against the LIVE canvas width
   *  (read each call, so it refits after a resize). Shared by the initial load
   *  and `resetZoom` (DRY). */
  computeFitScale: (measured: PageBox[]) => number;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
}

export function useZoomControl(opts: {
  scrollRef: RefObject<HTMLDivElement | null>;
  cards: RefObject<Map<number, HTMLDivElement>>;
  boxes: PageBox[];
  phase: "loading" | "ready" | "error";
  onZoomChange?: (percent: number) => void;
}): ZoomControlApi {
  const { scrollRef, cards, boxes, phase, onZoomChange } = opts;
  // Scale lives in state so it drives PageCard re-render (Story 1.5).
  const [scale, setScale] = useState(1);

  const computeFitScale = useCallback(
    (measured: PageBox[]): number => {
      const widest = measured.reduce((m, b) => Math.max(m, b.width), 0);
      const canvasWidth = scrollRef.current?.clientWidth ?? 0;
      const gutter = readSpacePx("--space-lg", 24);
      return fitToWidthScale(widest, canvasWidth - gutter * 2);
    },
    [scrollRef],
  );

  // Mirror of `scale` readable synchronously from event handlers (avoids stale
  // closures when the wheel/key listeners bind once). A pending focal ANCHOR is
  // stashed when a zoom is triggered, then consumed by the layout effect below
  // once the cards have re-laid-out at the new scale. The anchor is the page card
  // under the focal point + the fraction into it — NOT a uniform scale factor —
  // so fixed chrome (column padding, inter-card gaps) that does not scale can't
  // make the focal point drift on lower pages.
  const scaleRef = useRef(1);
  const pendingAnchor = useRef<
    { page: number; fracX: number; fracY: number; focalX: number; focalY: number } | null
  >(null);

  // Capture the card under `focal` (offset from the scroll-container edge) and
  // where in it the focal point sits, at the CURRENT (pre-zoom) layout.
  const captureAnchor = useCallback(
    (focal: { x: number; y: number }) => {
      const container = scrollRef.current;
      if (!container) return null;
      const crect = container.getBoundingClientRect();
      const fx = crect.left + focal.x;
      const fy = crect.top + focal.y;
      // Nearest card to the focal point (0 distance if it's inside one).
      let best: { page: number; rect: DOMRect } | null = null;
      let bestDist = Infinity;
      for (const [page, el] of cards.current) {
        const rect = el.getBoundingClientRect();
        const dist = fy < rect.top ? rect.top - fy : fy > rect.bottom ? fy - rect.bottom : 0;
        if (dist < bestDist) {
          bestDist = dist;
          best = { page, rect };
        }
      }
      if (!best) return null;
      const { rect } = best;
      return {
        page: best.page,
        fracX: rect.width > 0 ? (fx - rect.left) / rect.width : 0,
        fracY: rect.height > 0 ? (fy - rect.top) / rect.height : 0,
        focalX: focal.x,
        focalY: focal.y,
      };
    },
    [scrollRef, cards],
  );

  // Apply a target scale while keeping `focal` fixed on screen. Records the
  // anchor card+fraction for the post-layout scroll fix in the layout effect.
  const applyScale = useCallback(
    (target: number, focal: { x: number; y: number }) => {
      const old = scaleRef.current;
      if (!Number.isFinite(target) || target <= 0 || target === old) return;
      pendingAnchor.current = captureAnchor(focal);
      setScale(target);
    },
    [captureAnchor],
  );

  // The viewport centre (focal point for keyboard + button zoom, which have no
  // cursor). Falls back to the origin before the container exists.
  const centerFocal = useCallback(() => {
    const c = scrollRef.current;
    return c ? { x: c.clientWidth / 2, y: c.clientHeight / 2 } : { x: 0, y: 0 };
  }, [scrollRef]);

  const zoomIn = useCallback(
    () => applyScale(nextZoom(scaleRef.current, +1, ZOOM_STEP), centerFocal()),
    [applyScale, centerFocal],
  );
  const zoomOut = useCallback(
    () => applyScale(nextZoom(scaleRef.current, -1, ZOOM_STEP), centerFocal()),
    [applyScale, centerFocal],
  );
  const resetZoom = useCallback(
    () => applyScale(computeFitScale(boxes), centerFocal()),
    [applyScale, centerFocal, computeFitScale, boxes],
  );

  // Keep scaleRef in sync AND apply focal-point scroll compensation after the
  // DOM has re-laid-out at the new scale (useLayoutEffect → before paint, no
  // flicker). The browser clamps the assigned scrollLeft/Top to the valid range.
  useLayoutEffect(() => {
    scaleRef.current = scale;
    onZoomChange?.(Math.round(scale * 100));
    const a = pendingAnchor.current;
    pendingAnchor.current = null;
    const container = scrollRef.current;
    if (!a || !container) return;
    const el = cards.current.get(a.page);
    if (!el) return;
    // Re-read the anchor card AFTER the re-layout (new size) and convert its
    // viewport rect to scroll-independent content coordinates, then scroll so the
    // captured fraction sits back under the focal point.
    const crect = container.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    const contentTop = rect.top - crect.top + container.scrollTop;
    const contentLeft = rect.left - crect.left + container.scrollLeft;
    container.scrollTop = focalScroll(contentTop, rect.height, a.fracY, a.focalY);
    container.scrollLeft = focalScroll(contentLeft, rect.width, a.fracX, a.focalX);
  }, [scale, onZoomChange, scrollRef, cards]);

  // Ctrl+scroll (and trackpad pinch, which dispatches `wheel` with ctrlKey) zoom,
  // about the cursor, with the FINER wheel step. Bound at the DOCUMENT level
  // (guarded `phase === "ready"`) so a Ctrl-wheel anywhere over the reader — incl.
  // over the top-bar zoom control, which sits OUTSIDE `.pdf-canvas` — is caught
  // and the browser's native zoom suppressed (the canvas-only listener missed the
  // control). MUST be `{ passive: false }` — React's onWheel is passive in React
  // 19, so preventDefault there is a no-op. Plain (no-Ctrl) scroll is untouched
  // (AC-2); a purely horizontal Ctrl-wheel (`deltaY === 0`) is ignored. Focal
  // point = the cursor when it's over the canvas, else the viewport centre.
  useEffect(() => {
    if (phase !== "ready") return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      if (e.deltaY === 0) return;
      const container = scrollRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const overCanvas =
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom;
      const focal = overCanvas
        ? { x: e.clientX - rect.left, y: e.clientY - rect.top }
        : centerFocal();
      applyScale(nextZoom(scaleRef.current, e.deltaY < 0 ? +1 : -1, ZOOM_WHEEL_STEP), focal);
    };
    document.addEventListener("wheel", onWheel, { passive: false });
    return () => document.removeEventListener("wheel", onWheel);
  }, [phase, applyScale, centerFocal, scrollRef]);

  // Keyboard zoom: Ctrl +/- zoom, Ctrl 0 fit/reset (UX-DR15), at the DOCUMENT
  // level so the shortcuts fire regardless of which reader control has focus —
  // the canvas, the top-bar zoom buttons, anywhere (the High review finding: a
  // canvas-only handler was bypassed once a zoom button took focus). Guarded to
  // when a document is open. Allow Shift for `+` (US layout `+` is `Shift+=`, and
  // `e.key` already resolves to "+"; numpad reports the bare glyph). No Alt/Meta
  // so adjacent chords pass. preventDefault blocks the browser's own page zoom.
  useEffect(() => {
    if (phase !== "ready") return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        zoomIn();
      } else if (e.key === "-") {
        e.preventDefault();
        zoomOut();
      } else if (e.key === "0") {
        e.preventDefault();
        resetZoom();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [phase, zoomIn, zoomOut, resetZoom]);

  return { scale, setScale, computeFitScale, zoomIn, zoomOut, resetZoom };
}
