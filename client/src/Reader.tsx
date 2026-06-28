import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type Ref,
} from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { Doc } from "./api/client";
import {
  loadDocument,
  destroyDocument,
  getPageBox,
  renderPage,
  fitToWidthScale,
  pageNavTarget,
  nextZoom,
  focalScroll,
  ZOOM_STEP,
  ZOOM_WHEEL_STEP,
  type PageBox,
  type PageRender,
} from "./render";
// The single IntersectionObserver lives here (imported by sub-path, NOT the
// `./render` barrel, so `vi.mock("./render")` in the tests leaves it real).
import { usePageViewport } from "./render/usePageViewport";
import "./Reader.css";

/** Imperative zoom API the top-bar `ZoomControl` (owned by `App`) drives. */
export interface ReaderHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
}

/**
 * S1 reader: streams every page of a loaded PDF as stable `page-surface` cards
 * centered on the `pdf-canvas` scroll region (replaces the empty backdrop). The
 * render layer owns all pdf.js work and the AD-4 page box; this component is
 * just the UI shell — it holds no annotation/anchor math (AD-9).
 *
 * NFR-1/2: page geometry is reserved up front (cards laid out at final size
 * before any paint) so streaming pages never shift layout; pages paint lazily
 * as they scroll into view.
 */
export default function Reader({
  doc,
  onVisiblePageChange,
  onZoomChange,
  ref,
}: {
  doc: Doc;
  /** Reports the 1-based page currently in view, for the top-bar indicator. */
  onVisiblePageChange?: (page: number) => void;
  /** Reports the live zoom percent (rounded) for the top-bar zoom control. */
  onZoomChange?: (percent: number) => void;
  /** Imperative zoom handle for the top-bar control (React 19 ref-as-prop). */
  ref?: Ref<ReaderHandle>;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [boxes, setBoxes] = useState<PageBox[]>([]);
  // Scale lives in state so Story 1.5 (zoom) can drive it later (don't hardcode).
  const [scale, setScale] = useState(1);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");

  // Single IntersectionObserver (render/ hook): owns the card registry and drives
  // BOTH the page-in-view indicator (`currentPage`) and the per-card paint/release
  // window (`isLive`). All cards mount up front (reserve-geometry), so `cards` is
  // fully populated once `boxes` is set; the hook is the only observer (AR-9).
  const { registerCard, cards, currentPage, isLive } = usePageViewport(
    scrollRef,
    doc.page_count,
    phase === "ready",
  );

  // Fit-to-width scale for the given page boxes against the LIVE canvas width
  // (read each call, so it refits after a resize). Shared by the initial load
  // and `Ctrl 0` / the zoom-control reset (DRY). Stable identity (no reactive
  // deps): the boxes are passed in, the gutter token + canvas width are read at
  // call time. Subtract the column's horizontal padding (= `--space-lg` each
  // side) so the gutter mirrors the stylesheet rather than a duplicated magic
  // number.
  const computeFitScale = useCallback((measured: PageBox[]): number => {
    const widest = measured.reduce((m, b) => Math.max(m, b.width), 0);
    const canvasWidth = scrollRef.current?.clientWidth ?? 0;
    const gutter = readSpacePx("--space-lg", 24);
    return fitToWidthScale(widest, canvasWidth - gutter * 2);
  }, []);

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
  const captureAnchor = useCallback((focal: { x: number; y: number }) => {
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
  }, []);

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
  }, []);

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

  // Expose the zoom commands to the top-bar control owned by App.
  useImperativeHandle(ref, () => ({ zoomIn, zoomOut, resetZoom }), [zoomIn, zoomOut, resetZoom]);

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
  }, [scale, onZoomChange]);

  useEffect(() => {
    let cancelled = false;
    let loaded: PDFDocumentProxy | null = null;

    (async () => {
      try {
        loaded = await loadDocument(doc.doc_id);
        // If the effect was cleaned up while the load was in flight, the cleanup
        // already ran with loaded === null — destroy here so the worker/network
        // for this now-orphaned document is not leaked.
        if (cancelled) {
          destroyDocument(loaded);
          return;
        }
        // Reserve geometry: read every page's scale-1.0 box up front (NFR-1).
        const nextBoxes: PageBox[] = [];
        for (let i = 1; i <= doc.page_count; i++) {
          const page = await loaded.getPage(i);
          if (cancelled) return;
          nextBoxes.push(getPageBox(page));
        }
        // Fit-to-width once, from the live canvas width and the widest page.
        setPdf(loaded);
        setBoxes(nextBoxes);
        setScale(computeFitScale(nextBoxes));
        setPhase("ready");
      } catch {
        if (!cancelled) setPhase("error");
      }
    })();

    return () => {
      cancelled = true;
      if (loaded) destroyDocument(loaded);
    };
  }, [doc.doc_id, doc.page_count, computeFitScale]);

  // Report the page in view upward (top-bar indicator) whenever it changes.
  useEffect(() => {
    onVisiblePageChange?.(currentPage);
  }, [currentPage, onVisiblePageChange]);

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
  }, [phase, applyScale, centerFocal]);

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

  // PgUp/PgDn (and Ctrl+Down/Ctrl+Up aliases): move one page. Scroll the target
  // card's top to the canvas top and suppress the browser's native page-scroll
  // so it never double-scrolls (AC-3). (Zoom keys are handled document-level
  // above, not here, so they work without canvas focus.)
  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    // Ctrl ONLY (no Shift/Alt/Meta) so adjacent chords aren't swallowed — most
    // notably Ctrl+Shift+Arrow, the extend-text-selection chord over the page's
    // text layer. Matches the app's Ctrl-only keyboard map.
    const ctrlArrow = e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey;
    const forward = e.key === "PageDown" || (ctrlArrow && e.key === "ArrowDown");
    const backward = e.key === "PageUp" || (ctrlArrow && e.key === "ArrowUp");
    if (!forward && !backward) return;
    e.preventDefault();
    const delta = forward ? 1 : -1;
    const target = pageNavTarget(currentPage, delta, doc.page_count);
    const card = cards.current.get(target);
    const container = scrollRef.current;
    if (!card || !container || typeof container.scrollTo !== "function") return;
    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    container.scrollTo({
      top: card.offsetTop,
      behavior: reduceMotion ? "auto" : "smooth",
    });
  }

  return (
    <div
      ref={scrollRef}
      className="pdf-canvas"
      data-testid="reader-backdrop"
      aria-label="PDF canvas region"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      {phase === "error" ? (
        <p className="pdf-canvas__message" role="status">
          Couldn't render this PDF.
        </p>
      ) : (
        <div className="pdf-canvas__column">
          {boxes.map((box, i) => (
            <PageCard
              key={i}
              pdf={pdf}
              pageNumber={i + 1}
              box={box}
              scale={scale}
              live={isLive(i + 1)}
              register={registerCard}
            />
          ))}
        </div>
      )}
    </div>
  );
}

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

/**
 * Idle delay before a zoomed page re-renders crisply (ms). During a continuous
 * `Ctrl+scroll` the CSS pre-scale gives instant feedback; the sharp re-render
 * fires once the gesture settles, so we render once per gesture, not per notch.
 * Behavioral timing constant, not a design dim — lives here, not the token layer.
 */
const REPAINT_DEBOUNCE = 150;

/**
 * One reserved page slot. The card is sized to its final geometry immediately
 * (so scroll height is correct before paint); the canvas + text layer paint
 * lazily once the card enters the live window (`live`, driven by the single
 * `usePageViewport` observer) and RELEASE their bitmaps once it leaves, so the
 * painted hi-DPI canvas count stays bounded on a long paper (NFR-2). The card is
 * purely presentational: it owns no observer and no window/visibility decision.
 */
function PageCard({
  pdf,
  pageNumber,
  box,
  scale,
  live,
  register,
}: {
  pdf: PDFDocumentProxy | null;
  pageNumber: number;
  box: PageBox;
  scale: number;
  live: boolean;
  register: (pageNumber: number, el: HTMLDivElement | null) => void;
}) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textRef = useRef<HTMLDivElement | null>(null);
  const [painted, setPainted] = useState(false);
  // The scale the canvas/text bitmap was last painted at (0 = never painted).
  // Drives the live CSS pre-scale below and lets a zoom re-paint debounce-and-
  // swap instead of blanking — no skeleton flash, no strobe (NFR-2).
  const renderedScaleRef = useRef(0);

  // Register this card's node so the Reader can track the page in view and
  // resolve PgUp/PgDn scroll targets; deregister on unmount.
  useEffect(() => {
    register(pageNumber, cardRef.current);
    return () => register(pageNumber, null);
  }, [pageNumber, register]);

  // Instant, flicker-free zoom feedback: when the target scale differs from what
  // the bitmap was painted at, CSS-stretch the existing canvas to fill the
  // resized card (transform-origin top-left, set in CSS). The debounced re-render
  // below then sharpens it and clears the transform. Only the canvas is scaled —
  // the text layer is a transparent selection overlay (the visible glyphs live on
  // the canvas), so a momentarily-stale text layer during a gesture is invisible.
  // No-op before the first paint.
  useLayoutEffect(() => {
    const rs = renderedScaleRef.current;
    const canvas = canvasRef.current;
    if (!rs || !canvas) return;
    canvas.style.transform = scale === rs ? "" : `scale(${scale / rs})`;
  }, [scale]);

  // Release the painted bitmaps when the card leaves the live window (NFR-2:
  // bounded live canvases). Zero the canvas to drop its hi-DPI backing store and
  // clear the text-layer DOM; reset the rendered-scale so a re-entry repaints
  // crisply from scratch. The reserved card geometry (width/height) is NOT
  // touched, so layout never shifts on release or re-entry (NFR-1).
  useEffect(() => {
    if (live) return;
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
      canvas.style.transform = "";
    }
    textRef.current?.replaceChildren();
    renderedScaleRef.current = 0;
    setPainted(false);
  }, [live]);

  // Paint the page into the reserved card. The first paint (card newly live) is
  // immediate; a re-paint after a zoom is DEBOUNCED — the CSS pre-scale above
  // already shows the new size, so this just swaps in the crisp bitmap once the
  // gesture settles (once per gesture, not once per wheel notch). renderPage
  // renders offscreen and swaps atomically, so the visible canvas never blanks
  // and `painted` never drops back to the skeleton on zoom. Cancels in-flight
  // work on unmount / scale change / scroll-away (when `live` drops to false).
  useEffect(() => {
    if (!live || !pdf || !canvasRef.current || !textRef.current) return;
    let cancelled = false;
    let handle: PageRender | null = null;
    const paint = async () => {
      try {
        const page = await pdf.getPage(pageNumber);
        if (cancelled || !canvasRef.current || !textRef.current) return;
        handle = renderPage(page, {
          scale,
          canvas: canvasRef.current,
          textLayerDiv: textRef.current,
        });
        await handle.done;
        if (cancelled) return;
        renderedScaleRef.current = scale;
        canvasRef.current.style.transform = "";
        setPainted(true);
      } catch {
        // getPage rejection, render-setup throw, or a cancelled render — leave
        // the prior frame in place; never surface an unhandled promise rejection.
      }
    };
    // First paint (never rendered) or already at this scale → immediate. A new
    // scale → debounce so a continuous wheel zoom re-renders once it settles.
    const rs = renderedScaleRef.current;
    if (rs === 0 || rs === scale) {
      paint();
      return () => {
        cancelled = true;
        handle?.cancel();
      };
    }
    const id = setTimeout(paint, REPAINT_DEBOUNCE);
    return () => {
      cancelled = true;
      clearTimeout(id);
      handle?.cancel();
    };
  }, [live, pdf, pageNumber, scale]);

  const width = Math.floor(box.width * scale);
  const height = Math.floor(box.height * scale);

  return (
    <div
      ref={cardRef}
      className="page-surface"
      data-testid="page-surface"
      // `content-visibility: auto` (Reader.css) skips off-screen layout/paint;
      // feed it the reserved geometry so a skipped card reserves the right size
      // and never collapses (NFR-1). Computed inline like width/height so no raw
      // px literal lands in the stylesheet (no-raw-values rule).
      style={{ width, height, containIntrinsicSize: `${width}px ${height}px` }}
    >
      {!painted && live && <div className="page-surface__skeleton" aria-hidden="true" />}
      <canvas ref={canvasRef} className="page-surface__canvas" />
      <div ref={textRef} className="textLayer" />
    </div>
  );
}
