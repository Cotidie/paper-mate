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
 * Paint a page into `canvas` (HiDPI-correct) and its selectable text into
 * `textLayerDiv`, both at `scale`. Returns a handle whose `cancel()` aborts the
 * in-flight work — call it on unmount / scale change to avoid "canvas already
 * in use" errors and leaks during fast scroll.
 */
export function renderPage(
  page: PDFPageProxy,
  { scale, canvas, textLayerDiv }: { scale: number; canvas: HTMLCanvasElement; textLayerDiv: HTMLElement },
): PageRender {
  const viewport = page.getViewport({ scale });
  const outputScale = window.devicePixelRatio || 1;

  canvas.width = Math.floor(viewport.width * outputScale);
  canvas.height = Math.floor(viewport.height * outputScale);
  canvas.style.width = Math.floor(viewport.width) + "px";
  canvas.style.height = Math.floor(viewport.height) + "px";

  const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined;
  const canvasContext = canvas.getContext("2d");
  if (!canvasContext) throw new Error("2d canvas context unavailable");

  let task: RenderTask | null = page.render({ canvas, canvasContext, transform, viewport });

  const textLayer = new TextLayer({
    textContentSource: page.streamTextContent({
      includeMarkedContent: true,
      disableNormalization: true,
    }),
    container: textLayerDiv,
    viewport,
  });

  const done = (async () => {
    await task!.promise;
    await textLayer.render();
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
