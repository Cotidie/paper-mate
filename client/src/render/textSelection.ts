// render/textSelection — the composing controller for the live-selection
// machinery over OUR persistent, atomically-swapped text-layer divs
// (`renderPage` in `render/index.ts`). It owns ONE shared `document`-level
// listener set (enabled on the first `register`, torn down when the last card
// unregisters, so scrolling/zooming a long paper never accumulates listeners)
// and wires the four cohesive concerns to it:
//
//   - `TextLayerRegistry`   — the live layer↔bound map + its queries.
//   - `SelectionBounder`    — Story 4.1 `endOfContent` bounding (selectionchange).
//   - `interceptParagraphCopy` — Story 8.1 soft-wrap-joining copy.
//   - `SnapController`      — Story 8.8 empty-origin gate + Story 8.11 snap.
//
// This is the pdf.js `TextLayerBuilder` selection port (the `endOfContent`
// bound + shared `.selecting` listener; `pdf_viewer.mjs:6195-6403`), split
// along OOP lines. Imported by `render/index.ts` directly (sub-path, like
// `usePageViewport`), NOT re-exported from the `render/` barrel — `renderPage`
// is what Reader/App tests mock, so this stays a real, isolated, unit-testable
// module (AD-9: no import from anchor/, annotations/, or store/).

import { interceptParagraphCopy } from "./copyJoiner";
import { SelectionBounder } from "./selectionBounder";
import { SnapController } from "./snapController";
import { TextLayerRegistry } from "./textLayerRegistry";

export { isEmptyLayerSpace } from "./textLayerRegistry";

class TextSelectionController {
  // The registry PERSISTS across enable cycles (it holds the live layer map,
  // and is empty at teardown so it carries no stale refs). The snap gate and the
  // selection-bounder, by contrast, are built FRESH per enable cycle (see
  // `#enableGlobalListener`) — matching the pre-refactor closure-local state, so
  // an interrupted gesture cannot leave `emptyOrigin`/`prevRange` stale for the
  // next document's cycle.
  #registry = new TextLayerRegistry();
  #abort: AbortController | null = null;

  /**
   * Wire the live selection machinery onto `div` (a rendered `.textLayer`) and
   * ensure the shared global listener is running. Returns the cleanup to run on
   * cancel/re-render so the div never stays registered past its content.
   */
  register(div: HTMLElement): () => void {
    this.#registry.register(div);
    this.#enableGlobalListener();
    return () => this.#unregister(div);
  }

  #unregister(div: Element): void {
    this.#registry.unregister(div);
    if (this.#registry.size === 0) {
      this.#abort?.abort();
      this.#abort = null;
    }
  }

  #enableGlobalListener(): void {
    if (this.#abort) return;
    const controller = new AbortController();
    this.#abort = controller;
    const { signal } = controller;
    const registry = this.#registry;
    // Fresh per enable cycle (last-layer teardown aborts + discards these; a
    // re-register rebuilds them), so a gesture interrupted by a full teardown
    // can't carry `emptyOrigin`/`prevRange`/Firefox-detection into the next one.
    const snap = new SnapController(registry);
    const bounder = new SelectionBounder();

    signal.addEventListener("abort", () => snap.abort());

    document.addEventListener("pointerdown", (event) => snap.onPointerDown(event), { signal });
    document.addEventListener("pointermove", (event) => snap.onPointerMove(event), { signal });
    // Capture phase: the pdf-canvas scrolls, and `scroll` does not bubble.
    document.addEventListener("scroll", () => snap.onScroll(), { signal, capture: true });
    // Capture-phase flush BEFORE the bubble-phase create-on-release consumer.
    document.addEventListener("pointerup", () => snap.flush(), { signal, capture: true });
    document.addEventListener("pointerup", () => snap.release(), { signal });
    // A cancelled gesture (e.g. the browser revoking pointer capture) skips
    // pointerup entirely; without this, emptyOrigin stays latched and blocks
    // an unrelated later selectstart until the next pointerdown/blur.
    document.addEventListener("pointercancel", () => snap.release(), { signal });
    window.addEventListener("blur", () => snap.release(), { signal });
    document.addEventListener("selectstart", (event) => snap.suppressSelectStart(event), { signal });
    document.addEventListener("keyup", () => snap.onKeyup(), { signal });
    document.addEventListener("copy", (event) => interceptParagraphCopy(event, registry), { signal });
    document.addEventListener("selectionchange", () => bounder.handleSelectionChange(registry), { signal });
  }
}

/** One instance for the whole app — every page card's text layer shares it. */
export const textSelectionController = new TextSelectionController();
