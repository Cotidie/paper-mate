// render/textLayerRegistry — the shared map of live `.textLayer` divs to their
// `endOfContent` bound, plus the queries every selection concern runs against
// it. Mirrors pdf.js `TextLayerBuilder`'s static registry: one set of live
// page cards, registered as they render and dropped as they re-render, so a
// long paper never accumulates stale layers. No imports from anchor/,
// annotations/, or store/ (AD-9); no coordinate math (target classification
// and DOM-order walks only).

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
 * Owns the `layer div → endOfContent` map and the pure queries the selection
 * machinery runs against it. Registration appends the `endOfContent` bound and
 * arms the per-layer `.selecting` toggle; the shared `document`-level listener
 * lifecycle is the composing controller's job, not the registry's.
 */
export class TextLayerRegistry {
  #layers = new Map<Element, HTMLElement>();

  /** Live count; the composing controller enables listeners on 0→1 and tears
   *  them down on 1→0. */
  get size(): number {
    return this.#layers.size;
  }

  /**
   * Wire the live selection machinery onto `div` (a rendered `.textLayer`):
   * append its `endOfContent` bound and toggle `.selecting` on mousedown.
   * Returns the appended bound so the caller can enable the shared listener.
   */
  register(div: HTMLElement): HTMLElement {
    const endOfContent = document.createElement("div");
    endOfContent.className = "endOfContent";
    div.append(endOfContent);
    div.addEventListener("mousedown", () => div.classList.add("selecting"));
    this.#layers.set(div, endOfContent);
    return endOfContent;
  }

  unregister(div: Element): void {
    this.#layers.delete(div);
  }

  get(div: Element): HTMLElement | undefined {
    return this.#layers.get(div);
  }

  layers(): IterableIterator<Element> {
    return this.#layers.keys();
  }

  entries(): IterableIterator<[Element, HTMLElement]> {
    return this.#layers.entries();
  }

  bounds(): IterableIterator<HTMLElement> {
    return this.#layers.values();
  }

  /** Is `target` empty space in a registered layer (the container or its bound)? */
  isEmptyLayerSpace(target: EventTarget | null): boolean {
    return isEmptyLayerSpace(target, this.#layers);
  }

  /** The registered `.textLayer` the pointer target is (or is inside): the
   *  target IS a layer, or is a layer's `endOfContent` bound child. */
  originLayerOf(target: EventTarget | null): Element | null {
    if (!(target instanceof Element)) return null;
    if (this.#layers.has(target)) return target;
    for (const [div, endOfContent] of this.#layers) if (target === endOfContent) return div;
    return null;
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
  rangeStaysWithinTextLayers(range: Range): boolean {
    const walker = document.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => (range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
    });
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const layer = node.parentElement?.closest<HTMLElement>(".textLayer");
      if (!layer || !this.#layers.has(layer)) return false;
    }
    return true;
  }

  /** Move a layer's bound back inside it and clear the selection-bounding
   *  styles + `.selecting` state (pdf.js's post-selection reset). */
  resetBound(div: Element, endOfContent: HTMLElement): void {
    div.append(endOfContent);
    endOfContent.style.width = "";
    endOfContent.style.height = "";
    div.classList.remove("selecting");
  }

  /** Reset every registered layer's bound (selection ended / cleared). */
  resetAll(): void {
    for (const [div, endOfContent] of this.#layers) this.resetBound(div, endOfContent);
  }
}
