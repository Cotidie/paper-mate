import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { Doc } from "../../api/client";
import { loadDocument, destroyDocument, getPageBox, getOutline, type PageBox, type TocEntry } from "../../render";
// The single IntersectionObserver lives here (imported by sub-path, NOT the
// render barrel, so `vi.mock("../../render")` in the tests leaves it real).
import { usePageViewport } from "../../render/usePageViewport";
// Annotation overlay (Epic 2). Reader is the composition root that wires the
// overlay to the live page-card geometry + scale; the overlay lives in
// annotations/ and consumes anchor/ + store/ — render/ stays annotation-free
// (AD-9). Importing the view here does NOT make render/ annotation-aware.
import { AnnotationInteraction, type AnnotationTool } from "../../annotations";
import type { PageCardRef } from "../../anchor";
// Reader's own interaction concerns (Story 5.3 extraction, mirrors the Story
// 5.0 `annotations/gestures/*` pattern): zoom, pan, and page-nav each own
// their synchronous refs/effects in their own hook so Reader itself stays a
// composition root.
import { useZoomControl } from "../../reader/useZoomControl";
import { usePanControl } from "../../reader/usePanControl";
import { usePageNav } from "../../reader/usePageNav";
import PageCard from "../../reader/PageCard";
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
  /** Scroll to a fractional position within a page (Annotation Bank jump,
   *  Story 3.6): `pageIndex` is 0-based, `topFraction` a `[0,1]` fraction of
   *  that page's rendered height. Same no-reflow scroll mechanic as
   *  `jumpToPage`, offset by the fraction. */
  jumpToAnnotation: (pageIndex: number, topFraction: number) => void;
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
  armedTool,
  boxActive,
  multiSelectActive,
  onVisiblePageChange,
  onZoomChange,
  onOutline,
  ref,
}: {
  doc: Doc;
  /** When true, the hand tool is armed: a drag pans (Story 1.8). Hold-`Space`
   * gives the same temp-pan regardless of this flag. */
  panArmed?: boolean;
  /** The armed annotation tool (App owns it; null = cursor). Passed straight to
   * the overlay interaction; the Reader itself does no annotation logic (AD-9). */
  armedTool?: AnnotationTool | null;
  /** True when box-highlight mode is on (Highlight active + box mode). Box is a
   * MODE of Highlight, not its own tool; this is the explicit signal the overlay's
   * box-drag gesture gates on. Passed straight to the overlay. */
  boxActive?: boolean;
  /** True when the Box-select pointer tool is armed (user feature request): a
   * marquee drag selects existing annotations for bulk Move/Delete. Passed
   * straight to the overlay's `useMultiSelectGesture`. */
  multiSelectActive?: boolean;
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

  const { scale, setScale, computeFitScale, zoomIn, zoomOut, resetZoom } = useZoomControl({
    scrollRef,
    cards,
    boxes,
    phase,
    onZoomChange,
  });
  const { canPan, dragging, handlePointerDown, handlePointerMove, endDrag } = usePanControl({
    scrollRef,
    panArmed,
    phase,
  });
  const { scrollToPage, jumpToAnnotation, handleKeyDown } = usePageNav({
    scrollRef,
    cards,
    pageCount: doc.page_count,
    currentPage,
  });

  // Expose zoom + ToC jump + Bank jump to the top-bar chrome owned by App.
  useImperativeHandle(
    ref,
    () => ({ zoomIn, zoomOut, resetZoom, jumpToPage: scrollToPage, jumpToAnnotation }),
    [zoomIn, zoomOut, resetZoom, scrollToPage, jumpToAnnotation],
  );

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
  }, [doc.doc_id, doc.page_count, computeFitScale, setScale]);

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
      // Pen armed (Story 2.8): suppress native text selection + show a crosshair
      // so a freehand drag draws instead of selecting. Derived from armedTool; the
      // draw GESTURE itself lives in the overlay (AnnotationInteraction), not here.
      data-draw={armedTool === "pen" ? "" : undefined}
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
              docId={doc.doc_id}
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
          armedTool={armedTool ?? null}
          boxActive={boxActive ?? false}
          multiSelectActive={multiSelectActive ?? false}
        />
      )}
    </div>
  );
}
