// render/selectionBounder — Story 4.1's live-selection bounding, ported from
// pdf.js `TextLayerBuilder`'s `selectionchange` handling. Moves each layer's
// `endOfContent` bound to sit right after the selection's trailing edge, so a
// drag that extends past the last glyph can't paint a tall `::selection` band
// into the layer's full remaining height. Depends only on the registry + the
// current native selection (AD-9: no anchor/annotations/store import).

import type { TextLayerRegistry } from "./textLayerRegistry";

/**
 * Holds the small amount of state the bounding algorithm carries across
 * `selectionchange` events: the one-time Firefox detection (Firefox bounds
 * `::selection` natively, so we skip the manual move there) and the previous
 * range, used to tell whether the selection grew from its start or its end.
 */
export class SelectionBounder {
  #isFirefox: boolean | undefined;
  #prevRange: Range | null = null;

  handleSelectionChange(registry: TextLayerRegistry): void {
    const selection = document.getSelection();
    if (!selection || selection.rangeCount === 0) {
      registry.resetAll();
      return;
    }

    const active = new Set<Element>();
    for (let i = 0; i < selection.rangeCount; i++) {
      const range = selection.getRangeAt(i);
      for (const div of registry.layers()) {
        if (!active.has(div) && range.intersectsNode(div)) active.add(div);
      }
    }
    for (const [div, endOfContent] of registry.entries()) {
      if (active.has(div)) div.classList.add("selecting");
      else registry.resetBound(div, endOfContent);
    }

    // Firefox reports the vendor-prefixed property back from getComputedStyle;
    // other browsers don't recognize `-moz-user-select` and return "". The
    // endOfContent div always has `user-select: none` set (vendor
    // pdf_viewer.css), so this detects Firefox without a UA sniff (mirrors
    // pdf.js).
    const [firstEndOfContent] = registry.bounds();
    this.#isFirefox ??=
      firstEndOfContent !== undefined &&
      getComputedStyle(firstEndOfContent).getPropertyValue("-moz-user-select") === "none";
    if (this.#isFirefox) return;

    // Bound the selection: move `endOfContent` to sit right after the
    // selection's trailing edge within its text layer, so a drag that
    // extends past the last glyph can't paint into the layer's full
    // remaining height.
    const range = selection.getRangeAt(0);
    const modifyStart =
      this.#prevRange !== null &&
      (range.compareBoundaryPoints(Range.END_TO_END, this.#prevRange) === 0 ||
        range.compareBoundaryPoints(Range.START_TO_END, this.#prevRange) === 0);
    let anchor: Node | null = modifyStart ? range.startContainer : range.endContainer;
    if (anchor.nodeType === Node.TEXT_NODE) anchor = anchor.parentNode;
    if (!modifyStart && range.endOffset === 0) {
      do {
        while (anchor && !anchor.previousSibling) anchor = anchor.parentNode;
        anchor = anchor ? anchor.previousSibling : null;
      } while (anchor && anchor.childNodes.length === 0);
    }

    const parentTextLayer = anchor?.parentElement?.closest<HTMLElement>(".textLayer") ?? null;
    const boundDiv = parentTextLayer ? registry.get(parentTextLayer) : undefined;
    if (anchor && parentTextLayer && boundDiv) {
      boundDiv.style.width = parentTextLayer.style.width;
      boundDiv.style.height = parentTextLayer.style.height;
      boundDiv.style.userSelect = "text";
      anchor.parentElement?.insertBefore(boundDiv, modifyStart ? anchor : anchor.nextSibling);
    }
    this.#prevRange = range.cloneRange();
  }
}
