// render/ — the pdfjs-dist wrapper and the SINGLE source of the rendered page
// box (AD-4). It renders pixels (canvas) + a selectable text layer and reports
// the scale-1.0 page box. It knows NOTHING about annotations: no import from
// anchor/, annotations/, or store/, and no normalize/denormalize math (AD-9).
//
// pdf.js raw, custom overlay — NOT pdf.js's built-in annotation layer (AD-2).

import {
  GlobalWorkerOptions,
  getDocument,
  TextLayer,
  type PDFDocumentProxy,
  type PDFPageProxy,
  type RenderTask,
} from "pdfjs-dist";
// Vite-idiomatic worker wiring: `?url` lets Vite fingerprint/serve the worker.
// A bare node_modules path string breaks in prod builds.
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
// Vendor text-layer CSS (absolute span positioning over the canvas). Imported
// from the package so we never hand-author .textLayer px/colors in src/.
import "pdfjs-dist/web/pdf_viewer.css";

import { docFileUrl } from "../api/client";

// Configure the worker once, at module load.
GlobalWorkerOptions.workerSrc = workerUrl;

/** Logical page dimensions in CSS px (DPR divided out). */
export interface PageBox {
  width: number;
  height: number;
}

/** A render in flight; `cancel()` aborts the canvas + text-layer work. */
export interface PageRender {
  done: Promise<void>;
  cancel(): void;
}

/**
 * Load a document by its durable `doc_id`. Reaches the backend ONLY through the
 * api/ layer (`docFileUrl`), never the filesystem — so a doc imported in a
 * prior session renders given only its id (AD-6).
 */
export function loadDocument(docId: string): Promise<PDFDocumentProxy> {
  return getDocument({ url: docFileUrl(docId) }).promise;
}

/**
 * Tear down a loaded document (aborts its worker/network). `destroy` exists at
 * runtime but is missing from pdfjs-dist 6's bundled types, so the cast is
 * contained here in the render layer rather than leaking to callers.
 */
export function destroyDocument(pdf: PDFDocumentProxy): Promise<void> {
  return (pdf as unknown as { destroy(): Promise<void> }).destroy();
}

/**
 * The AD-4 page box: the PDF.js viewport at scale 1.0. `getViewport` bakes in
 * the CropBox and `/Rotate`, and the result is in CSS px (DPR is NOT applied
 * here — it only scales the canvas backing store). This is the value the anchor
 * service (Epic 2) normalizes against; render only reports it.
 */
export function getPageBox(page: PDFPageProxy): PageBox {
  const vp = page.getViewport({ scale: 1 });
  return { width: vp.width, height: vp.height };
}

/**
 * Pure helper: fit-to-width scale for a page box inside a canvas, capped so a
 * narrow page doesn't blow up. Kept here (DOM-free) so it is unit-testable and
 * Story 1.5 (zoom) can reuse the math. No coordinate/anchor math — just sizing.
 */
export function fitToWidthScale(
  boxWidth: number,
  canvasWidth: number,
  cap = 2,
): number {
  if (boxWidth <= 0 || canvasWidth <= 0) return 1;
  return Math.min(cap, canvasWidth / boxWidth);
}

/**
 * Zoom interaction constants (behavioral, not design dims — so they live here,
 * not in the token layer). `nextZoom` clamps to `[ZOOM_MIN, ZOOM_MAX]`. The
 * keyboard/button step is the coarse `ZOOM_STEP`; the wheel uses the finer
 * `ZOOM_WHEEL_STEP` (~10%/notch) so `Ctrl+scroll` doesn't jump (250%→315%).
 */
export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 4;
export const ZOOM_STEP = 1.25;
export const ZOOM_WHEEL_STEP = 1.1;

/**
 * Pure helper: the scale one step `direction` (+1 in / -1 out) from `current`,
 * multiplicative by `step` and clamped to `[ZOOM_MIN, ZOOM_MAX]`. DOM-free,
 * unit-tested. Plain interaction arithmetic — no anchor/coordinate math (AD-9).
 */
export function nextZoom(current: number, direction: number, step: number = ZOOM_STEP): number {
  const raw = direction >= 0 ? current * step : current / step;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, raw));
}

/**
 * Pure helper: the scroll offset (one axis) that keeps a focal point fixed
 * across a zoom, anchored to the page card under it. `cardEdge` = the anchor
 * card's top/left in CONTENT coordinates (scroll-independent) AFTER the zoom
 * re-layout, `cardSize` = that card's new height/width, `frac` = where in the
 * card the focal point sat (0..1, captured before the zoom), `focal` = the focal
 * point's offset from the scroll-container edge. The content coord to pin under
 * the focal point is `cardEdge + frac * cardSize`, so the new scroll is
 * `that - focal`. Anchoring to the card (not a uniform `factor`) keeps it correct
 * even though fixed chrome — column padding, inter-card gaps — does NOT scale.
 * The browser clamps the assigned value to range. DOM-free, unit-tested. Layout
 * arithmetic, not anchor math (AD-9).
 */
export function focalScroll(cardEdge: number, cardSize: number, frac: number, focal: number): number {
  return cardEdge + frac * cardSize - focal;
}

/** A page card's vertical extent (top/bottom) in any single coordinate space. */
export interface PageExtent {
  pageNumber: number;
  top: number;
  bottom: number;
}

/**
 * Pure helper: the page currently "in view" = the TOP-MOST card whose vertical
 * extent intersects the viewport band [viewportTop, viewportBottom]. `top`/
 * `bottom` and the viewport must share one coordinate space (e.g. client px).
 * Defaults to page 1 when nothing intersects or the list is empty. DOM-free so
 * it is unit-testable without layout (jsdom reports zeroed rects). No anchor
 * math — plain layout arithmetic.
 */
export function currentPageInView(
  pages: PageExtent[],
  viewportTop: number,
  viewportBottom: number,
): number {
  let best = pages.length ? pages[0].pageNumber : 1;
  let bestTop = Infinity;
  for (const p of pages) {
    const intersects = p.bottom > viewportTop && p.top < viewportBottom;
    if (intersects && p.top < bestTop) {
      bestTop = p.top;
      best = p.pageNumber;
    }
  }
  return best;
}

/**
 * Pure helper: the page number `delta` pages away from `current`, clamped to
 * `[1, pageCount]` (and to 1 for an empty document). Used by `PgUp`/`PgDn` nav.
 */
export function pageNavTarget(current: number, delta: number, pageCount: number): number {
  if (pageCount < 1) return 1;
  return Math.min(pageCount, Math.max(1, current + delta));
}

/**
 * Paint a page into `canvas` (HiDPI-correct) and its selectable text into
 * `textLayerDiv`, both at `scale`. Returns a handle whose `cancel()` aborts the
 * in-flight work — call it on unmount / scale change to avoid "canvas already
 * in use" errors and leaks during fast scroll.
 *
 * Flicker-free re-render (zoom): the page is rendered into an OFFSCREEN canvas
 * and the selectable text into a DETACHED container, then both are swapped onto
 * the live nodes in one synchronous block at the end. The visible canvas is
 * therefore never resized-to-blank mid-render and the old text never clears
 * early — so a zoom re-paint shows the previous frame until the crisp one is
 * ready (PageCard CSS-stretches it in the meantime), no strobe.
 */
export function renderPage(
  page: PDFPageProxy,
  { scale, canvas, textLayerDiv }: { scale: number; canvas: HTMLCanvasElement; textLayerDiv: HTMLElement },
): PageRender {
  const viewport = page.getViewport({ scale });
  const outputScale = window.devicePixelRatio || 1;

  // Render into an offscreen canvas so the live one keeps its pixels until swap.
  const offscreen = document.createElement("canvas");
  offscreen.width = Math.floor(viewport.width * outputScale);
  offscreen.height = Math.floor(viewport.height * outputScale);
  const offCtx = offscreen.getContext("2d");
  if (!offCtx) throw new Error("2d canvas context unavailable");

  const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined;
  let task: RenderTask | null = page.render({
    canvas: offscreen,
    canvasContext: offCtx,
    transform,
    viewport,
  });

  // Render text into a detached container, then swap it in atomically.
  const offText = document.createElement("div");
  const textLayer = new TextLayer({
    textContentSource: page.streamTextContent({
      includeMarkedContent: true,
      disableNormalization: true,
    }),
    container: offText,
    viewport,
  });

  const done = (async () => {
    await task!.promise;
    await textLayer.render();
    // Atomic swap (one synchronous block → composited in a single frame):
    // size the live canvas to match and blit the finished bitmap...
    canvas.width = offscreen.width;
    canvas.height = offscreen.height;
    canvas.style.width = Math.floor(viewport.width) + "px";
    canvas.style.height = Math.floor(viewport.height) + "px";
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.drawImage(offscreen, 0, 0);
    // ...and move the new text nodes in, carrying the container's inline style,
    // then explicitly (re)assert the scale factors the `.textLayer` CSS positions
    // spans against — pdf.js sets these on the container it renders into, so they
    // must be carried over to the live node on the swap or the selection layer
    // drifts out of alignment with the canvas.
    textLayerDiv.style.cssText = offText.style.cssText;
    textLayerDiv.style.setProperty("--scale-factor", String(scale));
    textLayerDiv.style.setProperty("--total-scale-factor", String(scale * outputScale));
    textLayerDiv.replaceChildren(...offText.childNodes);
  })();
  // Swallow the cancel rejection so an aborted render never surfaces as an
  // unhandled rejection; real failures still reject `done` for the caller.
  done.catch(() => {});

  return {
    done,
    cancel() {
      task?.cancel();
      task = null;
      textLayer.cancel();
    },
  };
}
