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
// The single home for pdf.js asset URLs (decoders/cmaps/iccs/standard fonts).
import { PDFJS_ASSET_CONFIG } from "./config";
// Selection/copy fidelity over the live text layer (Story 4.1); not
// re-exported from this barrel, see textSelection.ts header.
import { textSelectionController } from "./textSelection";

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
  // Spread the asset config so the worker can fetch the bundled WASM image
  // decoders (JPEG2000/JBIG2), CMaps, ICC profiles, and standard-font data —
  // otherwise figures fail to decode and the console floods with JpxError.
  return getDocument({ url: docFileUrl(docId), ...PDFJS_ASSET_CONFIG }).promise;
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
 * One flattened Table-of-Contents row, resolved to a 1-based page. `depth`
 * (0-based) drives the panel's indentation; only entries that resolve to a page
 * are included (url-only / broken bookmarks are dropped). ToC is a viewport
 * concern (FR-3 lives in render/) — no anchor/normalize math (AD-9).
 */
export interface TocEntry {
  title: string;
  pageNumber: number;
  depth: number;
}

/** A pdf.js explicit destination: `[pageRef, {name}, ...args]`. The first
 *  element is either a page reference object or a 0-based page index. */
type PdfDest = unknown[];
interface OutlineNode {
  title: string;
  dest: string | PdfDest | null;
  items?: OutlineNode[];
}
// The slice of PDFDocumentProxy this reader needs; pdfjs-dist 6's bundled types
// give getOutline a wide inline shape, so we narrow to what we consume.
interface OutlineCapableDoc {
  numPages: number;
  getOutline(): Promise<OutlineNode[] | null>;
  getDestination(id: string): Promise<PdfDest | null>;
  getPageIndex(ref: object): Promise<number>;
}

/**
 * Read the PDF's embedded outline (bookmarks) as a flat, page-resolved list for
 * the Table-of-Contents panel (FR-3). Recurses the outline tree carrying depth,
 * and resolves each node's `dest` to a 1-based page number, tolerating every
 * destination shape (named string, explicit array, RefProxy or numeric first
 * element). Entries with no resolvable page (url-only, null, or a throwing
 * lookup) are skipped, so one broken bookmark never aborts the outline. Returns
 * `[]` when the PDF has no outline — the panel renders its empty state from that.
 *
 * Pure pdf.js read: touches only the document proxy, no DOM and no normalize/
 * screen math — ToC stays a render/ (viewport) concern (AD-9, AR-9).
 */
export async function getOutline(pdf: PDFDocumentProxy): Promise<TocEntry[]> {
  const doc = pdf as unknown as OutlineCapableDoc;
  let roots: OutlineNode[] | null;
  try {
    roots = await doc.getOutline();
  } catch {
    return [];
  }
  if (!roots || roots.length === 0) return [];

  const out: TocEntry[] = [];
  const walk = async (nodes: OutlineNode[], depth: number): Promise<void> => {
    for (const node of nodes) {
      const title = (node.title ?? "").trim();
      if (title) {
        const pageNumber = await resolveDestPage(doc, node.dest);
        if (pageNumber !== null) out.push({ title, pageNumber, depth });
      }
      if (node.items && node.items.length > 0) await walk(node.items, depth + 1);
    }
  };
  await walk(roots, 0);
  return out;
}

/** Resolve an outline node's `dest` to a clamped 1-based page, or `null` when it
 *  is missing, url-only, or unresolvable. Each lookup is guarded so a single bad
 *  bookmark yields `null` rather than rejecting the whole outline. */
async function resolveDestPage(doc: OutlineCapableDoc, dest: string | PdfDest | null): Promise<number | null> {
  try {
    const explicit = typeof dest === "string" ? await doc.getDestination(dest) : dest;
    if (!explicit || explicit.length === 0) return null;
    const target = explicit[0];
    let pageIndex: number;
    if (typeof target === "number") {
      pageIndex = target; // already a 0-based page index
    } else if (target && typeof target === "object") {
      pageIndex = await doc.getPageIndex(target); // a RefProxy {num, gen}
    } else {
      return null;
    }
    if (!Number.isInteger(pageIndex)) return null;
    return Math.min(doc.numPages, Math.max(1, pageIndex + 1));
  } catch {
    return null;
  }
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

/**
 * Pure helper: the new scroll offset (one axis) for a hand-drag pan. `startScroll`
 * = the container's scrollLeft/scrollTop captured at pointer-down, `pointerDelta`
 * = how far the pointer has moved on that axis since (current - start). Subtracting
 * makes the content follow the pointer (grab-and-drag a sheet of paper): dragging
 * right → positive delta → smaller scrollLeft → content moves right. The browser
 * clamps the assigned value to the valid scroll range. DOM-free, unit-tested.
 * Plain scroll-offset arithmetic — no anchor/coordinate math (AR-9).
 */
export function panScroll(startScroll: number, pointerDelta: number): number {
  return startScroll - pointerDelta;
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
 * Live-canvas window radius: the number of pages painted on EACH side of the
 * page in view. `2*WINDOW_RADIUS + 1` bounds the simultaneously-painted hi-DPI
 * canvases (cost scales with zoom²), so a long paper never accumulates them.
 * A perf tuning constant — NOT a design dimension — so it lives here, not in the
 * token layer (mirrors `ZOOM_*`).
 */
export const WINDOW_RADIUS = 2;

/** An inclusive 1-based page range. `start > end` means the range is empty. */
export interface PageWindow {
  start: number;
  end: number;
}

/**
 * Pure helper: the inclusive 1-based page range `[current-radius, current+radius]`
 * clamped to `[1, pageCount]` — the set of pages that should hold a painted
 * canvas/text layer; pages outside it release their bitmaps. For an empty
 * document the range is empty (`start > end`). DOM-free, unit-tested. Plain
 * layout arithmetic — no anchor math (AD-9).
 */
export function pageWindow(current: number, radius: number, pageCount: number): PageWindow {
  if (pageCount < 1) return { start: 1, end: 0 };
  return {
    start: Math.max(1, Math.min(pageCount, current - radius)),
    end: Math.max(1, Math.min(pageCount, current + radius)),
  };
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
  // Set once the swapped-in div is registered with the shared selection
  // controller (Story 4.1); `cancel()` below unregisters it.
  let unregisterSelection: (() => void) | null = null;

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
    // BOTH scale vars are the CSS-px zoom (`scale`), NOT scale*DPR. The text
    // layer lays out in CSS px (the canvas is CSS-sized to viewport.width px;
    // DPR only inflates the canvas backing store, not layout). pdf.js's
    // `.textLayer` CSS sizes glyph font/position by `--total-scale-factor`, so
    // multiplying it by the device-pixel-ratio stretched the (left-anchored)
    // text ~DPR× too wide — selection/highlight rects then overshot each line
    // into the right margin on any HiDPI display (DPR>1). Keep both = `scale`.
    textLayerDiv.style.setProperty("--scale-factor", String(scale));
    textLayerDiv.style.setProperty("--total-scale-factor", String(scale));
    textLayerDiv.replaceChildren(...offText.childNodes);
    // Reproduce pdf.js TextLayerBuilder's post-render selection handling over
    // the now-live div: appends `endOfContent` + binds the shared listener.
    unregisterSelection = textSelectionController.register(textLayerDiv);
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
      unregisterSelection?.();
      unregisterSelection = null;
    },
  };
}
