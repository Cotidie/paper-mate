// render/snapController — the empty-origin gate (Story 8.8) and the snap state
// machine (Story 8.11), kept in ONE object because they share the same
// pointerdown→release lifecycle and the `emptyOrigin` latch.
//
// Story 8.8: a drag whose origin is empty page space with NO nearby line must
// not start a native selection at all — it would anchor at the nearest glyph
// and drag through every span in between. The `emptyOrigin` latch (set at
// pointerdown, cleared on release) drives a `selectstart` suppress.
//
// Story 8.11 SNAP: when the empty origin IS near text, instead of the flat
// no-op we resolve the nearest glyph once (via `nearestTextAnchor`, caret-API-
// free — the caret family is poisoned mid-session, see deferred-work.md
// #Discarded: Story 8.9) and seed a real native selection with
// `setBaseAndExtent` each pointermove (rAF-throttled). Everything downstream
// (create-on-release, copy, quick-box) already reads `window.getSelection()`,
// so it works unchanged. The no-op stays the fallback when no line is near.
//
// AD-9: imports only render/-local modules (nearestTextAnchor, textLayerRegistry
// type); no anchor/annotations/store import, no coordinate math (delegated to
// the resolver).

import { resolveNearestText, resolveOrigin, type OriginContext, type NearestTextPoint } from "./nearestTextAnchor";
import type { TextLayerRegistry } from "./textLayerRegistry";

export class SnapController {
  #registry: TextLayerRegistry;

  #pointerDown = false;
  #emptyOrigin = false;

  // Snap state: on an empty-origin pointerdown that resolves a nearest glyph,
  // `snapLayer` is the origin page's text layer, `snapOrigin` the direction-
  // aware anchor context (paragraph-boundary anchoring in a gap), and
  // `snapFocus` the last resolved drag point. `snapping` gates the drag that
  // drives the native selection.
  #snapping = false;
  #snapLayer: Element | null = null;
  #snapOrigin: OriginContext | null = null;
  // The snap does not paint until the cursor first TOUCHES a text row (Issue
  // #1): `snapEngaged` flips true on the first frame the focus is in a line's
  // vertical band, and only then is `snapAnchor` fixed (by drag direction for a
  // gap origin, or the in-band char for a side origin) and the selection
  // extended. Before engaging, nothing is painted.
  #snapEngaged = false;
  #snapAnchor: NearestTextPoint | null = null;
  #snapFocus: NearestTextPoint | null = null;
  // rAF throttle: an empty-origin snap drives the selection ITSELF (unlike an
  // on-text drag the browser drives natively). Calling setBaseAndExtent on
  // every pointermove fires the selectionchange handler + forces layout
  // synchronously many times per frame, thrashing and starving event delivery
  // (the "laggy from empty space, fast from text" report). Coalesce to one
  // update per animation frame, matching the browser's own native cadence.
  #snapPoint: { x: number; y: number } | null = null;
  #snapRaf = 0;

  constructor(registry: TextLayerRegistry) {
    this.#registry = registry;
  }

  // The anchor fixed at ENGAGE (first row-touch): a side origin (pointer beside
  // a line) uses that line's in-band char; a gap origin uses the paragraph
  // boundary in the drag's direction — dragging up anchors at the end of the
  // line above the gap, dragging down at the start of the line below.
  #anchorAtEngage(ctx: OriginContext, pointerY: number): NearestTextPoint | null {
    if (ctx.inBand) return ctx.inBand;
    if (pointerY < ctx.originY) return ctx.aboveEnd ?? ctx.belowStart;
    return ctx.belowStart ?? ctx.aboveEnd;
  }

  // Apply one snap frame. Re-resolve the focus LIVE (nearest text to the
  // current pointer; re-measuring keeps it correct as the page scrolls under
  // the drag). Until the cursor first reaches a text row (focus.onRow), paint
  // nothing (Issue #1). On that first touch, ENGAGE: fix the anchor once (so it
  // can't flip mid-drag) and start extending. Once engaged: while the cursor is
  // on a row, extend the selection to it — no horizontal gate, so a cursor deep
  // in the side margin (same row) keeps tracking (Issue #2); while the cursor
  // sits in a blank vertical gap between paragraphs (off-row), COLLAPSE to the
  // anchor so no stale selection lingers at a point with no text.
  #applySnapFrame = (): void => {
    this.#snapRaf = 0;
    if (!this.#snapping || !this.#snapOrigin || !this.#snapLayer || !this.#snapPoint) return;
    // The origin layer can be unregistered mid-drag (a scroll/zoom re-render
    // detaches it) while other pages stay registered. Its glyph rects then read
    // as zero and its anchor nodes are detached, so bail rather than call
    // setBaseAndExtent with detached nodes.
    if (!this.#snapLayer.isConnected) return;
    const focus = resolveNearestText(this.#snapLayer, this.#snapPoint.x, this.#snapPoint.y);
    const onRow = !!focus && focus.onRow;
    if (!this.#snapEngaged) {
      if (!onRow) return; // still in blank space — paint nothing
      this.#snapEngaged = true;
      this.#snapAnchor = this.#anchorAtEngage(this.#snapOrigin, this.#snapPoint.y);
    }
    // On a row → extend to it; off a row (blank gap) → collapse to the anchor.
    this.#snapFocus = onRow ? { node: focus!.node, offset: focus!.offset } : this.#snapAnchor;
    const a = this.#snapAnchor;
    const f = this.#snapFocus ?? this.#snapAnchor;
    if (a && f) document.getSelection()?.setBaseAndExtent(a.node, a.offset, f.node, f.offset);
  };

  #scheduleSnapFrame(): void {
    if (this.#snapping && this.#snapRaf === 0) this.#snapRaf = requestAnimationFrame(this.#applySnapFrame);
  }

  onPointerDown(event: PointerEvent): void {
    this.#pointerDown = true;
    this.#emptyOrigin = this.#registry.isEmptyLayerSpace(event.target);
    this.#snapping = false;
    this.#snapLayer = null;
    this.#snapOrigin = null;
    this.#snapEngaged = false;
    this.#snapAnchor = null;
    this.#snapFocus = null;
    this.#snapPoint = null;
    if (!this.#emptyOrigin) return;
    // Story 8.11: resolve the origin's direction-aware anchor context ONCE. If
    // the pointer is near enough to text (the proximity gate = the accepted
    // "start border"; a far, truly-empty margin does NOT snap), arm the snap;
    // the drag paints only once the cursor touches a row (see #applySnapFrame).
    // Otherwise fall through to Story 8.8's selectstart-suppress no-op.
    // Only the PRIMARY button drives a text selection; a middle/right-button
    // empty-space press must not arm the snap or preventDefault (that would
    // interfere with middle-button autoscroll and the right-click place-a-
    // comment/memo picker).
    if (event.button !== 0) return;
    const layer = this.#registry.originLayerOf(event.target);
    const origin = layer ? resolveOrigin(layer, event.clientX, event.clientY) : null;
    const seed = origin && (origin.inBand ?? origin.belowStart ?? origin.aboveEnd);
    if (layer && origin && seed) {
      // We DRIVE the native selection per-frame (rAF-throttled) here — a
      // deliberate crossing of Story 8.9's spike-budget "no per-move selection
      // driving" guard. That guard's rationale was the reverted attempts'
      // column-band CLIPPING; we never clip. `setBaseAndExtent` yields the
      // plain native contiguous range, identical to an on-text drag between the
      // same two points — so a snap drag behaves exactly like a text drag (it
      // can extend across columns as the pointer moves), only with its START
      // snapped to the nearest text. preventDefault stops the browser's
      // click-to-collapse on release, which would otherwise wipe the built
      // selection before pointerup reads it (deferred-work.md#Discarded: Story
      // 4.2 Part B).
      event.preventDefault();
      // Clear any pre-existing selection when arming: the snap paints nothing
      // until the cursor first touches a row, so a stale range left over from
      // an earlier gesture must not linger on screen or be consumed on release
      // if this drag never engages.
      document.getSelection()?.removeAllRanges();
      this.#snapping = true;
      this.#snapLayer = layer;
      this.#snapOrigin = origin;
    }
  }

  onPointerMove(event: PointerEvent): void {
    if (!this.#snapping) return;
    this.#snapPoint = { x: event.clientX, y: event.clientY };
    this.#scheduleSnapFrame();
  }

  // Scrolling mid-drag (the user wheel-scrolls while holding the button) fires
  // no pointermove, but the content under the cursor changes — re-resolve from
  // the last pointer position against the new (scrolled) geometry so the
  // selection tracks. The composing controller binds this to `scroll` in the
  // capture phase (the pdf-canvas scrolls, and `scroll` does not bubble).
  onScroll(): void {
    this.#scheduleSnapFrame();
  }

  // The rAF throttle means the LAST pointermove of a drag may still be queued
  // (or a whole quick drag may fit within one frame) when the button releases.
  // Flush it synchronously in the CAPTURE phase — before the bubble-phase
  // create-on-release consumer (`useCreateQuickBox`) reads `window.getSelection()`
  // — so the mark is built from the final range, not a stale one (and a
  // single-frame drag still forms its selection). Runs before `release` clears
  // the state.
  flush(): void {
    if (!this.#snapping || !this.#snapPoint) return;
    if (this.#snapRaf !== 0) {
      cancelAnimationFrame(this.#snapRaf);
      this.#snapRaf = 0;
    }
    this.#applySnapFrame();
  }

  release(): void {
    this.#pointerDown = false;
    this.#emptyOrigin = false;
    this.#snapping = false;
    this.#snapLayer = null;
    this.#snapOrigin = null;
    this.#snapEngaged = false;
    this.#snapAnchor = null;
    this.#snapFocus = null;
    this.#snapPoint = null;
    if (this.#snapRaf !== 0) {
      cancelAnimationFrame(this.#snapRaf);
      this.#snapRaf = 0;
    }
    this.#registry.resetAll();
  }

  // A drag whose origin is empty page space with NO nearby line must not start
  // a native selection at all (Story 8.8 AC-1). `emptyOrigin` is latched at
  // pointerdown so this also covers a drag that starts blank and wanders onto
  // text. On-text origins are untouched (AC-2). When the snap is active
  // (`snapping`), the selection is intentional, so do NOT suppress it.
  suppressSelectStart(event: Event): void {
    if (this.#emptyOrigin && !this.#snapping) event.preventDefault();
  }

  onKeyup(): void {
    if (!this.#pointerDown) this.#registry.resetAll();
  }

  // Teardown of the whole controller (last text layer unregisters) removes the
  // document listeners but cannot clear a rAF already queued for a snap frame —
  // cancel it so no orphaned frame fires against detached geometry.
  abort(): void {
    if (this.#snapRaf !== 0) {
      cancelAnimationFrame(this.#snapRaf);
      this.#snapRaf = 0;
    }
    this.#snapping = false;
  }
}
