import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { Doc } from "./api/client";
import {
  loadDocument,
  destroyDocument,
  getPageBox,
  renderPage,
  fitToWidthScale,
  currentPageInView,
  pageNavTarget,
  nextZoom,
  type PageBox,
  type PageExtent,
  type PageRender,
} from "./render";
import ZoomControl from "./ZoomControl";
import "./Reader.css";

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
}: {
  doc: Doc;
  /** Reports the 1-based page currently in view, for the top-bar indicator. */
  onVisiblePageChange?: (page: number) => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Live registry of mounted page cards (1-based) → DOM node, for the
  // page-in-view tracker and PgUp/PgDn scroll targets. All cards mount up front
  // (reserve-geometry), so this is fully populated once `boxes` is set.
  const cardEls = useRef<Map<number, HTMLDivElement>>(new Map());
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [boxes, setBoxes] = useState<PageBox[]>([]);
  // Scale lives in state so Story 1.5 (zoom) can drive it later (don't hardcode).
  const [scale, setScale] = useState(1);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  // 1-based page in view; defaults to 1 so the indicator is stable from load.
  const [currentPage, setCurrentPage] = useState(1);

  const registerCard = useCallback((pageNumber: number, el: HTMLDivElement | null) => {
    if (el) cardEls.current.set(pageNumber, el);
    else cardEls.current.delete(pageNumber);
  }, []);

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

  // Track the page in view. Drive recomputation off IntersectionObserver (which
  // fires only when a card crosses the viewport edge, off the scroll hot path)
  // rather than a per-frame scroll listener (NFR-2). Each fire reads the live
  // card rects and the pure `currentPageInView` picks the top-most visible page.
  useEffect(() => {
    if (phase !== "ready" || typeof IntersectionObserver === "undefined") return;
    const container = scrollRef.current;
    if (!container) return;

    let frame = 0;
    const recompute = () => {
      frame = 0;
      const view = container.getBoundingClientRect();
      const extents: PageExtent[] = [];
      for (const [pageNumber, el] of cardEls.current) {
        const r = el.getBoundingClientRect();
        extents.push({ pageNumber, top: r.top, bottom: r.bottom });
      }
      setCurrentPage(currentPageInView(extents, view.top, view.bottom));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(recompute);
    };

    const io = new IntersectionObserver(schedule, { root: container });
    for (const el of cardEls.current.values()) io.observe(el);
    schedule(); // establish the initial page once cards are laid out

    return () => {
      io.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [phase, boxes.length]);

  // Ctrl+scroll (and trackpad pinch, which dispatches `wheel` with ctrlKey) zoom.
  // MUST be a native listener with { passive: false } — React's onWheel is
  // passive in React 19, so preventDefault there is a no-op and the browser's
  // own Ctrl+wheel page zoom would still fire. Plain (no-Ctrl) scroll is left
  // untouched so normal scrolling still works (AC-2). The `.pdf-canvas` div is
  // always mounted, so this binds once.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setScale((s) => nextZoom(s, e.deltaY < 0 ? +1 : -1));
    };
    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, []);

  // PgUp/PgDn (and Ctrl+Down/Ctrl+Up aliases): move one page. Scroll the target
  // card's top to the canvas top and suppress the browser's native page-scroll
  // so it never double-scrolls (AC-3).
  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    // Zoom: Ctrl +/- to zoom, Ctrl 0 to fit/reset (UX-DR15). Allow Shift for the
    // `+` key — on a US layout `+` is `Shift+=`, and `e.key` already resolves to
    // "+" (numpad `+`/`-`/`0` also report the bare glyph). preventDefault blocks
    // the BROWSER's own Ctrl+/-/0 page zoom. (No Alt/Meta so other chords pass.)
    if (e.ctrlKey && !e.altKey && !e.metaKey) {
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        setScale((s) => nextZoom(s, +1));
        return;
      }
      if (e.key === "-") {
        e.preventDefault();
        setScale((s) => nextZoom(s, -1));
        return;
      }
      if (e.key === "0") {
        e.preventDefault();
        setScale(computeFitScale(boxes));
        return;
      }
    }
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
    const card = cardEls.current.get(target);
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
    <>
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
                register={registerCard}
              />
            ))}
          </div>
        )}
      </div>
      {/* Overlay pill — absolute over the stage, never reflows the canvas (NFR-1). */}
      {phase !== "error" && (
        <ZoomControl
          percent={Math.round(scale * 100)}
          onZoomIn={() => setScale((s) => nextZoom(s, +1))}
          onZoomOut={() => setScale((s) => nextZoom(s, -1))}
          onReset={() => setScale(computeFitScale(boxes))}
        />
      )}
    </>
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
 * Prefetch distance for lazy paint — a behavioral scroll constant (how early a
 * page paints before entering the viewport), not a design dimension, so it lives
 * here rather than in the token layer.
 */
const PREFETCH_MARGIN = 200;

/**
 * One reserved page slot. The card is sized to its final geometry immediately
 * (so scroll height is correct before paint); the canvas + text layer paint
 * lazily once the card scrolls into view (top→down streaming, NFR-2).
 */
function PageCard({
  pdf,
  pageNumber,
  box,
  scale,
  register,
}: {
  pdf: PDFDocumentProxy | null;
  pageNumber: number;
  box: PageBox;
  scale: number;
  register: (pageNumber: number, el: HTMLDivElement | null) => void;
}) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textRef = useRef<HTMLDivElement | null>(null);
  // No IntersectionObserver (e.g. jsdom) → paint eagerly.
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === "undefined");
  const [painted, setPainted] = useState(false);

  // Register this card's node so the Reader can track the page in view and
  // resolve PgUp/PgDn scroll targets; deregister on unmount.
  useEffect(() => {
    register(pageNumber, cardRef.current);
    return () => register(pageNumber, null);
  }, [pageNumber, register]);

  // Reveal when the card nears the viewport; render is gated on this (NFR-2).
  useEffect(() => {
    if (visible || typeof IntersectionObserver === "undefined") return;
    const el = cardRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: `${PREFETCH_MARGIN}px` },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  // Paint into the reserved card; cancel in-flight work on unmount/scale change.
  useEffect(() => {
    if (!visible || !pdf || !canvasRef.current || !textRef.current) return;
    let cancelled = false;
    let handle: PageRender | null = null;
    setPainted(false);
    (async () => {
      try {
        const page = await pdf.getPage(pageNumber);
        if (cancelled || !canvasRef.current || !textRef.current) return;
        textRef.current.replaceChildren();
        handle = renderPage(page, {
          scale,
          canvas: canvasRef.current,
          textLayerDiv: textRef.current,
        });
        await handle.done;
        if (!cancelled) setPainted(true);
      } catch {
        // getPage rejection, render-setup throw, or a cancelled render — leave
        // the skeleton in place; never surface an unhandled promise rejection.
      }
    })();
    return () => {
      cancelled = true;
      handle?.cancel();
    };
  }, [visible, pdf, pageNumber, scale]);

  const width = Math.floor(box.width * scale);
  const height = Math.floor(box.height * scale);

  return (
    <div
      ref={cardRef}
      className="page-surface"
      data-testid="page-surface"
      style={{ width, height }}
    >
      {!painted && <div className="page-surface__skeleton" aria-hidden="true" />}
      <canvas ref={canvasRef} className="page-surface__canvas" />
      <div ref={textRef} className="textLayer" />
    </div>
  );
}
