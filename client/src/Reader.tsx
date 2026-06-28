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
  getOutline,
  renderPage,
  fitToWidthScale,
  pageNavTarget,
  nextZoom,
  focalScroll,
  panScroll,
  ZOOM_STEP,
  ZOOM_WHEEL_STEP,
  type PageBox,
  type PageRender,
  type TocEntry,
} from "./render";
// The single IntersectionObserver lives here (imported by sub-path, NOT the
// `./render` barrel, so `vi.mock("./render")` in the tests leaves it real).
import { usePageViewport } from "./render/usePageViewport";
// Annotation overlay (Epic 2). Reader is the composition root that wires the
// overlay to the live page-card geometry + scale; the overlay lives in
// annotations/ and consumes anchor/ + store/ — render/ stays annotation-free
// (AD-9). Importing the view here does NOT make render/ annotation-aware.
import { AnnotationLayer, AnnotationInteraction } from "./annotations";
import type { PageCardRef } from "./anchor";
import "./Reader.css";

/** Imperative API the top-bar chrome (owned by `App`) drives: zoom buttons +
 *  the ToC panel's jump-to-page. */
export interface ReaderHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  /** Scroll the given 1-based page to the top of the viewport (ToC jump,
   *  Story 1.9). Same no-reflow scroll mechanic as PgUp/PgDn. */
  jumpToPage: (pageNumber: number) => void;
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
  panArmed,
  onVisiblePageChange,
  onZoomChange,
  onOutline,
  ref,
}: {
  doc: Doc;
  /** When true, the hand tool is armed: a drag pans (Story 1.8). Hold-`Space`
   * gives the same temp-pan regardless of this flag. */
  panArmed?: boolean;
  /** Reports the 1-based page currently in view, for the top-bar indicator. */
  onVisiblePageChange?: (page: number) => void;
  /** Reports the live zoom percent (rounded) for the top-bar zoom control. */
  onZoomChange?: (percent: number) => void;
  /** Reports the PDF's embedded outline (flattened, page-resolved) once the
   * document is ready, for the ToC panel (Story 1.9). `[]` when there is none. */
  onOutline?: (entries: TocEntry[]) => void;
  /** Imperative handle (zoom + ToC jump) for the top-bar control (React 19
   * ref-as-prop). */
  ref?: Ref<ReaderHandle>;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [boxes, setBoxes] = useState<PageBox[]>([]);
  // Scale lives in state so Story 1.5 (zoom) can drive it later (don't hardcode).
  const [scale, setScale] = useState(1);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");

  // Pan (Story 1.8): the hand is armed by `panArmed`, OR `Space` is held for a
  // temporary pan that falls back to the armed tool on release (AC-3). `dragging`
  // drives the grab→grabbing cursor; the drag origin lives in a ref so a
  // pointermove never re-renders. Pan moves ONLY scrollLeft/scrollTop — never the
  // scale, card geometry, or page box (NFR-1) — and does no anchor math (AR-9).
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [dragging, setDragging] = useState(false);
  const canPan = (panArmed ?? false) || spaceHeld;
  const dragOrigin = useRef<
    { x: number; y: number; scrollLeft: number; scrollTop: number } | null
  >(null);
  // The captured pointer for the active drag, so an interrupted pan (e.g. Space
  // released mid-drag → no longer pannable) can release capture + stop.
  const dragPointerId = useRef<number | null>(null);

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

  // Scroll a 1-based page to the top of the viewport. The shared mechanic behind
  // BOTH PgUp/PgDn and the ToC jump (Story 1.9): clamp the target, find its card,
  // and `scrollTo` its top — offset-only, so nothing reflows (NFR-1). Honors
  // `prefers-reduced-motion` (smooth → instant). No-ops where layout/scrollTo is
  // unavailable (jsdom). No anchor/coordinate math (AR-9).
  const scrollToPage = useCallback(
    (pageNumber: number) => {
      const target = Math.min(doc.page_count, Math.max(1, pageNumber));
      const card = cards.current.get(target);
      const container = scrollRef.current;
      if (!card || !container || typeof container.scrollTo !== "function") return;
      const reduceMotion =
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      container.scrollTo({ top: card.offsetTop, behavior: reduceMotion ? "auto" : "smooth" });
      // Return keyboard focus to the canvas so PgUp/PgDn nav stays live after a
      // jump (a ToC row click unmounts the panel, dropping focus to <body>).
      // `preventScroll` so the focus call can't fight the smooth scroll above.
      container.focus?.({ preventScroll: true });
    },
    [doc.page_count],
  );

  // Expose zoom + ToC jump to the top-bar chrome owned by App.
  useImperativeHandle(
    ref,
    () => ({ zoomIn, zoomOut, resetZoom, jumpToPage: scrollToPage }),
    [zoomIn, zoomOut, resetZoom, scrollToPage],
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

  // Read the embedded outline for the ToC panel (Story 1.9) once the document is
  // loaded. A separate effect (keyed on `pdf`) so it never gates the page-box
  // reservation (NFR-1) and a changing `onOutline` can't trigger a document
  // reload. getOutline never throws — a missing/broken outline reports `[]`, so
  // the panel shows its empty state rather than erroring (AC-3).
  useEffect(() => {
    if (!pdf) return;
    let cancelled = false;
    getOutline(pdf).then((entries) => {
      if (!cancelled) onOutline?.(entries);
    });
    return () => {
      cancelled = true;
    };
  }, [pdf, onOutline]);

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

  // Hold-`Space` temp-pan (AC-2/AC-3), bound at the DOCUMENT level (guarded
  // `phase === "ready"`) so it arms regardless of which reader element has focus —
  // mirroring the zoom-key effect. Skip editable fields and buttons so Space still
  // activates a focused control (and the rail/flyout buttons keep working). Ignore
  // auto-repeat so a held key doesn't thrash. keydown suppresses the browser's
  // page-scroll-on-Space; keyup drops `spaceHeld` so `canPan` falls back to the
  // armed tool (the active-drag teardown below stops any pan already in flight).
  useEffect(() => {
    if (phase !== "ready") return;
    const isExempt = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      if (!el || !el.tagName) return false;
      const tag = el.tagName;
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        tag === "BUTTON" ||
        el.isContentEditable
      );
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== " " || isExempt(e.target)) return;
      if (!e.repeat) setSpaceHeld(true);
      e.preventDefault();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === " ") setSpaceHeld(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
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
  }, [canPan]);

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
    scrollToPage(pageNavTarget(currentPage, delta, doc.page_count));
  }

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

  // The live page cards for the annotation overlay: element + scale-1.0 box +
  // 0-based index. Read from the card registry at call time so the overlay's
  // selection mapping always sees the current geometry. The render layer owns
  // the box; the overlay normalizes against it (AD-4/AD-9).
  const getPages = useCallback((): PageCardRef[] => {
    const out: PageCardRef[] = [];
    for (const [pageNumber, el] of cards.current) {
      const box = boxes[pageNumber - 1];
      if (box) out.push({ pageIndex: pageNumber - 1, cardEl: el, box });
    }
    return out;
  }, [boxes, cards]);

  return (
    <div
      ref={scrollRef}
      className="pdf-canvas"
      data-testid="reader-backdrop"
      aria-label="PDF canvas region"
      tabIndex={0}
      // grab when pan is available, grabbing mid-drag; also suppresses text
      // selection while pannable (CSS targets [data-pan]). Absent → normal cursor
      // and the Story 1.3 selectable text layer is untouched.
      data-pan={canPan ? (dragging ? "grabbing" : "") : undefined}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
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
      {/* Annotation overlay interaction layer (quick-box + state machine). Renders
          null until a selection pops the quick-box; phase-gated like the other
          document-level handlers. */}
      {phase === "ready" && (
        <AnnotationInteraction
          docId={doc.doc_id}
          getPages={getPages}
          scale={scale}
          enabled={phase === "ready"}
        />
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
      {/* Annotation marks for this page, positioned card-local via the anchor
          service against this card's box + scale (re-derives on every zoom). */}
      <AnnotationLayer pageIndex={pageNumber - 1} box={box} scale={scale} />
    </div>
  );
}
