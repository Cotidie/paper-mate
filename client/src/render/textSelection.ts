// render/textSelection — reproduces pdf.js `TextLayerBuilder`'s post-render
// selection machinery (the `endOfContent` bound + the shared global
// `.selecting` listener; `pdf_viewer.mjs:6195-6403`) over OUR persistent,
// atomically-swapped text-layer divs (`renderPage` in `render/index.ts`).
//
// Two bugs this fixes (Story 4.1): without `endOfContent` bounding the live
// selection, a drag that ends on a short trailing run (e.g. a line-ending
// period) extends unbounded into the text layer's remaining height, painting
// a tall `::selection` band; and the `<br role="presentation">` pdf.js emits
// per line must stay selectable (never `user-select: none`) for its `\n` to
// reach `selection.toString()`, which is how inter-line whitespace survives
// copy.
//
// Adopt-stable-solutions (Epic-1 retro / AD-2 applied under the custom-
// overlay choice): this ports the reference implementation's algorithm
// rather than re-deriving selection-bounding math from scratch. Imported by
// `render/index.ts` directly (sub-path, like `usePageViewport`), NOT
// re-exported from the `render/` barrel — `renderPage` is what Reader/App
// tests mock, so this stays a real, isolated, unit-testable module (AD-9: no
// import from anchor/, annotations/, or store/).
//
// Story 8.1 adds one more `{ signal }`-scoped listener here: `copy`, which
// rewrites the clipboard so a soft-wrapped paragraph pastes as one line (see
// `paragraphCopy.ts`). It reuses this controller's registry/lifecycle rather
// than standing up a second global listener manager.
//
// Story 8.11 adds the empty-origin SNAP: instead of Story 8.8's flat no-op, a
// drag starting in blank space next to text resolves the nearest glyph once
// (via `nearestTextAnchor`, caret-API-free — the caret family is poisoned
// mid-session, see deferred-work.md#Discarded: Story 8.9) and seeds a real
// native selection with `setBaseAndExtent` each `pointermove`. Everything
// downstream (create-on-release, copy, quick-box) already reads
// `window.getSelection()`, so it works unchanged. The no-op stays as the
// fallback when no line is near (a far, truly-empty margin).

import { joinParagraphLines, measureSelectedLines } from "./paragraphCopy";
import { resolveNearestText, resolveOrigin, type OriginContext, type NearestTextPoint } from "./nearestTextAnchor";

/**
 * True when `target` is empty page space in a registered text layer: the
 * `.textLayer` container element itself, or its `endOfContent` bound child.
 * False for a glyph `<span>` (or any other descendant) and for anything
 * outside a registered layer. Target classification only, no layout reads
 * (Story 8.8 AC-4) — pointerdown over empty space must not start a native
 * selection that then grabs whatever text the drag wanders across.
 */
export function isEmptyLayerSpace(target: EventTarget | null, textLayers: ReadonlyMap<Element, HTMLElement>): boolean {
  if (!(target instanceof Element)) return false;
  if (textLayers.has(target)) return true;
  for (const endOfContent of textLayers.values()) {
    if (target === endOfContent) return true;
  }
  return false;
}

/**
 * Shared across every live page card (mirrors `TextLayerBuilder`'s static
 * registry): one `document`-level `selectionchange`/pointer listener set,
 * enabled on the first `register` and torn down when the last card
 * unregisters, so scrolling/zooming a long paper never accumulates listeners.
 */
class TextSelectionController {
  #textLayers = new Map<Element, HTMLElement>();
  #selectionChangeAbort: AbortController | null = null;

  /**
   * Wire the live selection machinery onto `div` (a rendered `.textLayer`):
   * append its `endOfContent` bound, toggle `.selecting` on mousedown, and
   * ensure the shared global listener is running. Returns the cleanup to run
   * on cancel/re-render so the div never stays registered past its content.
   */
  register(div: HTMLElement): () => void {
    const endOfContent = document.createElement("div");
    endOfContent.className = "endOfContent";
    div.append(endOfContent);
    div.addEventListener("mousedown", () => div.classList.add("selecting"));
    this.#textLayers.set(div, endOfContent);
    this.#enableGlobalListener();
    return () => this.#unregister(div);
  }

  /**
   * True only if EVERY text node `range` touches sits inside one of our
   * registered text layers. Checking just the range's start/end containers
   * (as an earlier version did) misses content interposed between them in
   * document order — a range can start and end inside registered layers
   * while still covering non-layer content along the way. Bounding the walk
   * to `range.commonAncestorContainer` keeps this cheap (proportional to the
   * selection, not the document).
   */
  #rangeStaysWithinTextLayers(range: Range): boolean {
    const walker = document.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => (range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
    });
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const layer = node.parentElement?.closest<HTMLElement>(".textLayer");
      if (!layer || !this.#textLayers.has(layer)) return false;
    }
    return true;
  }

  #unregister(div: Element): void {
    this.#textLayers.delete(div);
    if (this.#textLayers.size === 0) {
      this.#selectionChangeAbort?.abort();
      this.#selectionChangeAbort = null;
    }
  }

  #enableGlobalListener(): void {
    if (this.#selectionChangeAbort) return;
    const controller = new AbortController();
    this.#selectionChangeAbort = controller;
    const { signal } = controller;

    const reset = (endOfContent: HTMLElement, div: Element): void => {
      div.append(endOfContent);
      endOfContent.style.width = "";
      endOfContent.style.height = "";
      div.classList.remove("selecting");
    };

    let pointerDown = false;
    let emptyOrigin = false;
    // Story 8.11 snap state: on an empty-origin pointerdown that resolves a
    // nearest glyph, `snapLayer` is the origin page's text layer, `snapOrigin`
    // the direction-aware anchor context (paragraph-boundary anchoring in a
    // gap), and `snapFocus` the last resolved drag point. `snapping` gates the
    // drag that drives the native selection.
    let snapping = false;
    let snapLayer: Element | null = null;
    let snapOrigin: OriginContext | null = null;
    let snapFocus: NearestTextPoint | null = null;
    // rAF throttle: an empty-origin snap drives the selection ITSELF (unlike an
    // on-text drag the browser drives natively). Calling setBaseAndExtent on
    // every pointermove fires the selectionchange handler + forces layout
    // synchronously many times per frame, thrashing and starving event delivery
    // (the "laggy from empty space, fast from text" report). Coalesce to one
    // update per animation frame, matching the browser's own native cadence.
    let snapPoint: { x: number; y: number } | null = null;
    let snapRaf = 0;
    let isFirefox: boolean | undefined;
    let prevRange: Range | null = null;

    // The registered `.textLayer` the pointer target is (or is inside): the
    // target IS a layer, or is a layer's `endOfContent` bound child.
    const originLayerOf = (target: EventTarget | null): Element | null => {
      if (!(target instanceof Element)) return null;
      if (this.#textLayers.has(target)) return target;
      for (const [div, endOfContent] of this.#textLayers) if (target === endOfContent) return div;
      return null;
    };

    // The anchor for the CURRENT drag direction: inside a line band it is the
    // fixed nearest character; in a vertical gap it is the end of the line above
    // (dragging up) or the start of the line below (dragging down), so a gap
    // origin anchors on a paragraph boundary.
    const anchorForDirection = (ctx: OriginContext, pointerY: number): NearestTextPoint | null => {
      if (ctx.inBand) return ctx.inBand;
      if (pointerY < ctx.originY) return ctx.aboveEnd ?? ctx.belowStart;
      return ctx.belowStart ?? ctx.aboveEnd;
    };

    // Apply one snap frame: re-resolve the focus LIVE (nearest text to the
    // current pointer; re-measuring keeps it correct as the page scrolls under
    // the drag), pick the direction-aware anchor, and extend the native
    // selection from the anchor to the focus.
    const applySnapFrame = (): void => {
      snapRaf = 0;
      if (!snapping || !snapOrigin || !snapLayer || !snapPoint) return;
      const focus = resolveNearestText(snapLayer, snapPoint.x, snapPoint.y);
      // Keep the last good focus when the pointer is momentarily off any text;
      // falling back to the anchor would COLLAPSE the selection mid-drag.
      if (focus) snapFocus = focus;
      const anchor = anchorForDirection(snapOrigin, snapPoint.y);
      const f = snapFocus ?? anchor;
      if (anchor && f) document.getSelection()?.setBaseAndExtent(anchor.node, anchor.offset, f.node, f.offset);
    };
    const scheduleSnapFrame = (): void => {
      if (snapping && snapRaf === 0) snapRaf = requestAnimationFrame(applySnapFrame);
    };

    document.addEventListener(
      "pointerdown",
      (event) => {
        pointerDown = true;
        emptyOrigin = isEmptyLayerSpace(event.target, this.#textLayers);
        snapping = false;
        snapLayer = null;
        snapOrigin = null;
        snapFocus = null;
        snapPoint = null;
        if (!emptyOrigin) return;
        // Story 8.11: resolve the origin's direction-aware anchor context ONCE.
        // If a nearest line is found, seed the native selection at gesture start
        // and let the drag extend it (the snap); if not (a far, truly-empty
        // margin), fall through to Story 8.8's selectstart-suppress no-op below.
        const layer = originLayerOf(event.target);
        const origin = layer ? resolveOrigin(layer, event.clientX, event.clientY) : null;
        const seed = origin && (origin.inBand ?? origin.belowStart ?? origin.aboveEnd);
        if (layer && origin && seed) {
          // We DRIVE the native selection per-frame (rAF-throttled) here — a
          // deliberate crossing of Story 8.9's spike-budget "no per-move
          // selection driving" guard. That guard's rationale was the reverted
          // attempts' column-band CLIPPING; we never clip. `setBaseAndExtent`
          // yields the plain native contiguous range, identical to an on-text
          // drag between the same two points — so a snap drag behaves exactly
          // like a text drag (it can extend across columns as the pointer moves),
          // only with its START snapped to the nearest text. preventDefault stops
          // the browser's click-to-collapse on release, which would otherwise
          // wipe the built selection before pointerup reads it
          // (deferred-work.md#Discarded: Story 4.2 Part B).
          event.preventDefault();
          snapping = true;
          snapLayer = layer;
          snapOrigin = origin;
          snapFocus = seed;
        }
      },
      { signal },
    );
    document.addEventListener(
      "pointermove",
      (event) => {
        if (!snapping) return;
        snapPoint = { x: event.clientX, y: event.clientY };
        scheduleSnapFrame();
      },
      { signal },
    );
    // Scrolling mid-drag (the user wheel-scrolls while holding the button) fires
    // no pointermove, but the content under the cursor changes — re-resolve from
    // the last pointer position against the new (scrolled) geometry so the
    // selection tracks. Capture phase: the pdf-canvas scrolls, and `scroll` does
    // not bubble.
    document.addEventListener("scroll", scheduleSnapFrame, { signal, capture: true });
    const releasePointer = (): void => {
      pointerDown = false;
      emptyOrigin = false;
      snapping = false;
      snapLayer = null;
      snapOrigin = null;
      snapFocus = null;
      snapPoint = null;
      if (snapRaf !== 0) {
        cancelAnimationFrame(snapRaf);
        snapRaf = 0;
      }
      this.#textLayers.forEach(reset);
    };
    document.addEventListener("pointerup", releasePointer, { signal });
    // A cancelled gesture (e.g. the browser revoking pointer capture) skips
    // pointerup entirely; without this, emptyOrigin stays latched and blocks
    // an unrelated later selectstart until the next pointerdown/blur.
    document.addEventListener("pointercancel", releasePointer, { signal });
    window.addEventListener("blur", releasePointer, { signal });
    // A drag whose origin is empty page space with NO nearby line must not
    // start a native selection at all (Story 8.8 AC-1): it would anchor at the
    // nearest glyph and drag through every span in between. `emptyOrigin` is
    // latched at pointerdown so this also covers a drag that starts blank and
    // wanders onto text. On-text origins are untouched (AC-2). When the snap is
    // active (`snapping`), the selection is intentional, so do NOT suppress it.
    document.addEventListener(
      "selectstart",
      (event) => {
        if (emptyOrigin && !snapping) event.preventDefault();
      },
      { signal },
    );
    document.addEventListener(
      "keyup",
      () => {
        if (!pointerDown) this.#textLayers.forEach(reset);
      },
      { signal },
    );

    document.addEventListener(
      "copy",
      (event: ClipboardEvent) => {
        const selection = document.getSelection();
        if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
        // A discontiguous multi-range selection (e.g. Firefox ctrl+drag) is
        // rare, and the join heuristic operates over a single contiguous
        // range's lines. Rather than silently keep only the first range,
        // fall through to native copy so nothing is dropped.
        if (selection.rangeCount !== 1) return;
        const range = selection.getRangeAt(0);

        // AC-5: only act when the range is entirely within OUR registered
        // text layers. Anything else (a memo/comment editor, Bank text, app
        // chrome, or a mixed selection spanning one of those) falls through
        // to native copy untouched — no preventDefault.
        if (!this.#rangeStaysWithinTextLayers(range)) return;

        const lines = measureSelectedLines(selection);
        if (lines.length === 0) return;
        const joined = joinParagraphLines(lines);
        if (!joined) return;

        event.clipboardData?.setData("text/plain", joined);
        event.preventDefault();
      },
      { signal },
    );

    document.addEventListener(
      "selectionchange",
      () => {
        const selection = document.getSelection();
        if (!selection || selection.rangeCount === 0) {
          this.#textLayers.forEach(reset);
          return;
        }

        const active = new Set<Element>();
        for (let i = 0; i < selection.rangeCount; i++) {
          const range = selection.getRangeAt(i);
          for (const div of this.#textLayers.keys()) {
            if (!active.has(div) && range.intersectsNode(div)) active.add(div);
          }
        }
        for (const [div, endOfContent] of this.#textLayers) {
          if (active.has(div)) div.classList.add("selecting");
          else reset(endOfContent, div);
        }

        // Firefox reports the vendor-prefixed property back from
        // getComputedStyle; other browsers don't recognize `-moz-user-select`
        // and return "". The endOfContent div always has `user-select: none`
        // set (vendor pdf_viewer.css), so this detects Firefox without a UA
        // sniff (mirrors pdf.js).
        const [firstEndOfContent] = this.#textLayers.values();
        isFirefox ??=
          firstEndOfContent !== undefined &&
          getComputedStyle(firstEndOfContent).getPropertyValue("-moz-user-select") === "none";
        if (isFirefox) return;

        // Bound the selection: move `endOfContent` to sit right after the
        // selection's trailing edge within its text layer, so a drag that
        // extends past the last glyph can't paint into the layer's full
        // remaining height.
        const range = selection.getRangeAt(0);
        const modifyStart =
          prevRange !== null &&
          (range.compareBoundaryPoints(Range.END_TO_END, prevRange) === 0 ||
            range.compareBoundaryPoints(Range.START_TO_END, prevRange) === 0);
        let anchor: Node | null = modifyStart ? range.startContainer : range.endContainer;
        if (anchor.nodeType === Node.TEXT_NODE) anchor = anchor.parentNode;
        if (!modifyStart && range.endOffset === 0) {
          do {
            while (anchor && !anchor.previousSibling) anchor = anchor.parentNode;
            anchor = anchor ? anchor.previousSibling : null;
          } while (anchor && anchor.childNodes.length === 0);
        }

        const parentTextLayer = anchor?.parentElement?.closest<HTMLElement>(".textLayer") ?? null;
        const boundDiv = parentTextLayer ? this.#textLayers.get(parentTextLayer) : undefined;
        if (anchor && parentTextLayer && boundDiv) {
          boundDiv.style.width = parentTextLayer.style.width;
          boundDiv.style.height = parentTextLayer.style.height;
          boundDiv.style.userSelect = "text";
          anchor.parentElement?.insertBefore(boundDiv, modifyStart ? anchor : anchor.nextSibling);
        }
        prevRange = range.cloneRange();
      },
      { signal },
    );
  }
}

/** One instance for the whole app — every page card's text layer shares it. */
export const textSelectionController = new TextSelectionController();
