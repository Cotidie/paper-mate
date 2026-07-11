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

import { joinParagraphLines, measureSelectedLines } from "./paragraphCopy";

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
    let isFirefox: boolean | undefined;
    let prevRange: Range | null = null;

    document.addEventListener("pointerdown", () => { pointerDown = true; }, { signal });
    document.addEventListener(
      "pointerup",
      () => {
        pointerDown = false;
        this.#textLayers.forEach(reset);
      },
      { signal },
    );
    window.addEventListener(
      "blur",
      () => {
        pointerDown = false;
        this.#textLayers.forEach(reset);
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

        // AC-5: only act when every range is entirely within OUR registered
        // text layers. Anything else (a memo/comment editor, Bank text, app
        // chrome, or a mixed selection spanning one of those) falls through
        // to native copy untouched — no preventDefault.
        for (let i = 0; i < selection.rangeCount; i++) {
          const range = selection.getRangeAt(i);
          for (const container of [range.startContainer, range.endContainer]) {
            const element = container.nodeType === Node.TEXT_NODE ? container.parentElement : (container as Element);
            const layer = element?.closest<HTMLElement>(".textLayer");
            if (!layer || !this.#textLayers.has(layer)) return;
          }
        }

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
