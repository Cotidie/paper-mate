// PageCard — one reserved page slot (Story 5.3 extraction, moved as-is out of
// Reader.tsx: already fully self-contained). The card is sized to its final
// geometry immediately (so scroll height is correct before paint); the canvas
// + text layer paint lazily once the card enters the live window (`live`,
// driven by the single `usePageViewport` observer) and RELEASE their bitmaps
// once it leaves, so the painted hi-DPI canvas count stays bounded on a long
// paper (NFR-2). The card is purely presentational: it owns no observer and
// no window/visibility decision.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { renderPage, type PageBox, type PageRender } from "@/render";
import { AnnotationLayer } from "@/annotations";
import "@/components/Reader/Reader.css";

/**
 * Idle delay before a zoomed page re-renders crisply (ms). During a continuous
 * `Ctrl+scroll` the CSS pre-scale gives instant feedback; the sharp re-render
 * fires once the gesture settles, so we render once per gesture, not per notch.
 * Behavioral timing constant, not a design dim — lives here, not the token layer.
 */
const REPAINT_DEBOUNCE = 150;

export default function PageCard({
  docId,
  pdf,
  pageNumber,
  box,
  scale,
  live,
  register,
}: {
  docId: string;
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
  // resolve PgUp/PgDn scroll targets; deregister on unmount. A LAYOUT effect
  // (not passive): Story 10.7's restore runs in the PARENT's own layout
  // effect at initial mount, before any passive effect has fired — a passive
  // registration effect would still leave `cards` empty at that point (child
  // passive effects run after ALL layout effects in the tree, parent
  // included, not before). Layout effects run children-before-parent, so a
  // layout-effect registration here guarantees the registry is populated by
  // the time an ancestor's own layout effect reads it. No DOM read/write here
  // (just a Map mutation), so promoting it off the passive phase is free.
  useLayoutEffect(() => {
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
      <AnnotationLayer docId={docId} pageIndex={pageNumber - 1} box={box} scale={scale} />
    </div>
  );
}
