// jsdom can't see real selection geometry or `::selection` paint (see
// Reader.test.tsx / CLAUDE.md), so this only covers the parts that ARE
// jsdom-safe: register/unregister bookkeeping and the shared global listener
// being enabled once and torn down only once the last div unregisters
// (Story 4.1 AC-5, "no leak / lifecycle-safe").

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { isEmptyLayerSpace, textSelectionController } from "./textSelection";
import * as nearest from "./nearestTextAnchor";

// Story 8.11: the controller resolves the origin anchor context + the live
// focus through this module. jsdom has no real layout, so mock it and assert
// the CONTROLLER's gate + direction logic. The resolver's own geometry is
// covered in nearestTextAnchor.test.ts.
vi.mock("./nearestTextAnchor", () => ({ resolveOrigin: vi.fn(), resolveNearestText: vi.fn() }));
const mockOrigin = vi.mocked(nearest.resolveOrigin);
const mockFocus = vi.mocked(nearest.resolveNearestText);
// A drag drives the selection through requestAnimationFrame. Queue frames and
// flush them explicitly (via `flushRaf`) rather than running the callback
// inline — running inline would reset the controller's `snapRaf` guard BEFORE
// the `snapRaf = requestAnimationFrame(...)` assignment, corrupting the
// coalescing guard the way real (async) rAF never does.
let rafQueue: FrameRequestCallback[] = [];
let rafId = 0;
function flushRaf() {
  const q = rafQueue;
  rafQueue = [];
  for (const cb of q) cb(0);
}
beforeEach(() => {
  rafQueue = [];
  rafId = 0;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb: FrameRequestCallback) => {
    rafQueue.push(cb);
    return ++rafId;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {
    rafQueue = [];
  });
});

describe("isEmptyLayerSpace", () => {
  it("is true for the registered .textLayer container element itself", () => {
    const div = document.createElement("div");
    const endOfContent = document.createElement("div");
    const textLayers = new Map([[div, endOfContent]]);
    expect(isEmptyLayerSpace(div, textLayers)).toBe(true);
  });

  it("is true for the layer's endOfContent child", () => {
    const div = document.createElement("div");
    const endOfContent = document.createElement("div");
    endOfContent.className = "endOfContent";
    div.append(endOfContent);
    const textLayers = new Map([[div, endOfContent]]);
    expect(isEmptyLayerSpace(endOfContent, textLayers)).toBe(true);
  });

  it("is false for a glyph span descendant of the layer", () => {
    const div = document.createElement("div");
    const endOfContent = document.createElement("div");
    const span = document.createElement("span");
    span.textContent = "NYU v2.";
    div.append(span, endOfContent);
    const textLayers = new Map([[div, endOfContent]]);
    expect(isEmptyLayerSpace(span, textLayers)).toBe(false);
  });

  it("is false for an unrelated/unregistered element", () => {
    const div = document.createElement("div");
    const endOfContent = document.createElement("div");
    const textLayers = new Map([[div, endOfContent]]);
    const other = document.createElement("div");
    expect(isEmptyLayerSpace(other, textLayers)).toBe(false);
  });

  it("is false for a null target", () => {
    expect(isEmptyLayerSpace(null, new Map())).toBe(false);
  });
});

describe("TextSelectionController — empty-origin selectstart suppression", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("suppresses selectstart after a pointerdown on empty layer space", () => {
    const div = document.createElement("div");
    div.className = "textLayer";
    document.body.append(div);
    const unregister = textSelectionController.register(div);
    const endOfContent = div.querySelector(".endOfContent")!;

    endOfContent.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    const selectstart = new Event("selectstart", { cancelable: true, bubbles: true });
    document.dispatchEvent(selectstart);
    expect(selectstart.defaultPrevented).toBe(true);

    unregister();
  });

  it("clears the empty-origin latch on pointercancel, so a later selectstart is not suppressed", () => {
    const div = document.createElement("div");
    div.className = "textLayer";
    document.body.append(div);
    const unregister = textSelectionController.register(div);
    const endOfContent = div.querySelector(".endOfContent")!;

    endOfContent.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    document.dispatchEvent(new Event("pointercancel"));

    const selectstart = new Event("selectstart", { cancelable: true, bubbles: true });
    document.dispatchEvent(selectstart);
    expect(selectstart.defaultPrevented).toBe(false);

    unregister();
  });
});

describe("TextSelectionController — empty-origin snap (Story 8.11 Method A)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    mockOrigin.mockReset();
    mockFocus.mockReset();
    vi.restoreAllMocks();
  });

  function setupLayer() {
    const div = document.createElement("div");
    div.className = "textLayer";
    const glyph = document.createElement("span");
    glyph.append(document.createTextNode("nearest text"));
    div.append(glyph);
    document.body.append(div);
    const unregister = textSelectionController.register(div);
    return { div, glyph, unregister };
  }
  // A gap origin: no inBand, distinct above/below anchors so direction is visible.
  function gapOrigin(node: Text) {
    return {
      originY: 100,
      inBand: null,
      aboveEnd: { node, offset: 11 },
      belowStart: { node, offset: 0 },
    };
  }

  it("does NOT suppress selectstart when an origin resolves (snap active)", () => {
    const { div, glyph, unregister } = setupLayer();
    mockOrigin.mockReturnValue(gapOrigin(glyph.firstChild as Text));

    div.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 100, clientY: 100 }));
    const selectstart = new Event("selectstart", { cancelable: true, bubbles: true });
    document.dispatchEvent(selectstart);
    expect(selectstart.defaultPrevented).toBe(false);

    unregister();
  });

  it("keeps the Story 8.8 selectstart suppression when NO origin resolves", () => {
    const { div, unregister } = setupLayer();
    mockOrigin.mockReturnValue(null);

    div.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 100, clientY: 100 }));
    const selectstart = new Event("selectstart", { cancelable: true, bubbles: true });
    document.dispatchEvent(selectstart);
    expect(selectstart.defaultPrevented).toBe(true);

    unregister();
  });

  it("does NOT paint until the cursor touches a text row (Issue #1: engage on inBand)", () => {
    const { div, glyph, unregister } = setupLayer();
    const node = glyph.firstChild as Text;
    mockOrigin.mockReturnValue(gapOrigin(node));
    // Focus resolves a nearest point but the cursor is NOT in its band yet.
    mockFocus.mockReturnValue({ node, offset: 8, inBand: false });
    const setBaseAndExtent = vi.fn();
    vi.spyOn(document, "getSelection").mockReturnValue({ setBaseAndExtent } as unknown as Selection);

    div.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 100, clientY: 100 }));
    document.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 100, clientY: 130 }));
    flushRaf();
    expect(setBaseAndExtent).not.toHaveBeenCalled(); // still in blank space -> no paint

    unregister();
  });

  it("dragging DOWN from a gap anchors at the line-below START once a row is touched", () => {
    const { div, glyph, unregister } = setupLayer();
    const node = glyph.firstChild as Text;
    mockOrigin.mockReturnValue(gapOrigin(node)); // originY 100, belowStart offset 0
    mockFocus.mockReturnValue({ node, offset: 8, inBand: true });
    const setBaseAndExtent = vi.fn();
    vi.spyOn(document, "getSelection").mockReturnValue({ setBaseAndExtent } as unknown as Selection);

    div.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 100, clientY: 100 }));
    // Move DOWN (clientY 140 > originY 100) onto a row: anchor = belowStart (offset 0).
    document.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 100, clientY: 140 }));
    flushRaf();
    expect(setBaseAndExtent).toHaveBeenCalledWith(node, 0, node, 8);

    unregister();
  });

  it("dragging UP from a gap anchors at the line-above END once a row is touched", () => {
    const { div, glyph, unregister } = setupLayer();
    const node = glyph.firstChild as Text;
    mockOrigin.mockReturnValue(gapOrigin(node)); // aboveEnd offset 11
    mockFocus.mockReturnValue({ node, offset: 3, inBand: true });
    const setBaseAndExtent = vi.fn();
    vi.spyOn(document, "getSelection").mockReturnValue({ setBaseAndExtent } as unknown as Selection);

    div.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 100, clientY: 100 }));
    // Move UP (clientY 60 < originY 100) onto a row: anchor = aboveEnd (offset 11).
    document.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 100, clientY: 60 }));
    flushRaf();
    expect(setBaseAndExtent).toHaveBeenCalledWith(node, 11, node, 3);

    unregister();
  });

  it("keeps tracking after engage even when the focus stays at the same row (Issue #2: no proximity gate)", () => {
    const { div, glyph, unregister } = setupLayer();
    const node = glyph.firstChild as Text;
    mockOrigin.mockReturnValue(gapOrigin(node));
    // Engage on a row, then a later frame whose focus is deep in the margin
    // (the resolver has no horizontal gate, so it still returns inBand at that Y).
    mockFocus.mockReturnValueOnce({ node, offset: 4, inBand: true }).mockReturnValue({ node, offset: 9, inBand: true });
    const setBaseAndExtent = vi.fn();
    vi.spyOn(document, "getSelection").mockReturnValue({ setBaseAndExtent } as unknown as Selection);

    div.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 100, clientY: 100 }));
    document.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 100, clientY: 140 }));
    flushRaf();
    setBaseAndExtent.mockClear();
    document.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 900, clientY: 140 }));
    flushRaf();
    expect(setBaseAndExtent).toHaveBeenCalledWith(node, 0, node, 9); // still tracking in the margin

    unregister();
  });

  it("re-resolves the focus on scroll mid-drag (tracks the pointer under scroll)", () => {
    const { div, glyph, unregister } = setupLayer();
    const node = glyph.firstChild as Text;
    mockOrigin.mockReturnValue(gapOrigin(node));
    mockFocus.mockReturnValue({ node, offset: 5, inBand: true });
    const setBaseAndExtent = vi.fn();
    vi.spyOn(document, "getSelection").mockReturnValue({ setBaseAndExtent } as unknown as Selection);

    div.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 100, clientY: 140 }));
    document.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 100, clientY: 140 }));
    flushRaf();
    setBaseAndExtent.mockClear();
    // A scroll with no pointer motion must still re-apply the snap frame.
    document.dispatchEvent(new Event("scroll"));
    flushRaf();
    expect(setBaseAndExtent).toHaveBeenCalledWith(node, 0, node, 5); // down-drag anchor

    unregister();
  });

  it("clears the snap latch on pointerup, so a later empty-origin drag re-evaluates", () => {
    const { div, glyph, unregister } = setupLayer();
    mockOrigin.mockReturnValue(gapOrigin(glyph.firstChild as Text));
    div.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 100, clientY: 100 }));
    document.dispatchEvent(new Event("pointerup"));

    // After release, resolve nothing: the next empty-origin drag must fall back
    // to the Story 8.8 suppression (snap latch cleared, not stuck on).
    mockOrigin.mockReturnValue(null);
    div.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 100, clientY: 100 }));
    const selectstart = new Event("selectstart", { cancelable: true, bubbles: true });
    document.dispatchEvent(selectstart);
    expect(selectstart.defaultPrevented).toBe(true);

    unregister();
  });
});

describe("TextSelectionController", () => {
  it("appends an endOfContent div to the registered text layer", () => {
    const div = document.createElement("div");
    const unregister = textSelectionController.register(div);
    expect(div.querySelector(".endOfContent")).not.toBeNull();
    unregister();
  });

  it("enables the shared global listener once, across multiple registrations", () => {
    const divA = document.createElement("div");
    const divB = document.createElement("div");
    const addSpy = vi.spyOn(document, "addEventListener");

    const unregisterA = textSelectionController.register(divA);
    const callsAfterFirst = addSpy.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    const unregisterB = textSelectionController.register(divB);
    // A second live registration must not add a second set of listeners.
    expect(addSpy.mock.calls.length).toBe(callsAfterFirst);

    unregisterA();
    unregisterB();
    addSpy.mockRestore();
  });

  it("tears the global listener down only once the LAST div unregisters", () => {
    const divA = document.createElement("div");
    const divB = document.createElement("div");
    const abortSpy = vi.spyOn(AbortController.prototype, "abort");

    const unregisterA = textSelectionController.register(divA);
    const unregisterB = textSelectionController.register(divB);

    unregisterA();
    expect(abortSpy).not.toHaveBeenCalled();

    unregisterB();
    expect(abortSpy).toHaveBeenCalledTimes(1);

    abortSpy.mockRestore();
  });

  it("re-enables the global listener after a full teardown (no stale AbortController)", () => {
    const divA = document.createElement("div");
    const divB = document.createElement("div");

    const unregisterA = textSelectionController.register(divA);
    unregisterA();

    const addSpy = vi.spyOn(document, "addEventListener");
    const unregisterB = textSelectionController.register(divB);
    expect(addSpy.mock.calls.length).toBeGreaterThan(0);

    unregisterB();
    addSpy.mockRestore();
  });

  it("unregister is idempotent (calling it twice does not throw or double-abort)", () => {
    const div = document.createElement("div");
    const unregister = textSelectionController.register(div);
    unregister();
    expect(unregister).not.toThrow();
  });
});

// Story 8.1 code-review fix: the AC-5 copy guard originally checked only a
// range's start/end containers, which misses content interposed BETWEEN
// them in document order. These tests exercise the fix (a full text-node
// walk over the range) through the public `copy` event, not the private
// `#rangeStaysWithinTextLayers` method directly.
describe("TextSelectionController copy handler — full-range AC-5 guard", () => {
  function makeTextLayerDiv(text: string): HTMLDivElement {
    const div = document.createElement("div");
    div.className = "textLayer";
    const span = document.createElement("span");
    span.textContent = text;
    div.append(span);
    return div;
  }

  function selectAcross(startEl: HTMLElement, endEl: HTMLElement): void {
    const range = document.createRange();
    range.setStart(startEl.firstChild!.firstChild!, 0);
    range.setEnd(endEl.firstChild!.firstChild!, 3);
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function fireCopy(): Event {
    const event = new Event("copy", { cancelable: true, bubbles: true });
    document.dispatchEvent(event);
    return event;
  }

  afterEach(() => {
    document.getSelection()?.removeAllRanges();
    document.body.innerHTML = "";
  });

  it("does NOT intercept a range that starts/ends inside registered layers but crosses unregistered content in between", () => {
    const layerA = makeTextLayerDiv("start of selection");
    const between = document.createElement("div"); // deliberately NOT registered
    between.textContent = "unregistered content in between";
    const layerB = makeTextLayerDiv("end of selection");
    document.body.append(layerA, between, layerB);

    const unregisterA = textSelectionController.register(layerA);
    const unregisterB = textSelectionController.register(layerB);
    selectAcross(layerA, layerB);

    const event = fireCopy();
    expect(event.defaultPrevented).toBe(false);

    unregisterA();
    unregisterB();
  });

  it("DOES intercept a legitimate selection spanning two ADJACENT registered text layers (no regression)", () => {
    const layerA = makeTextLayerDiv("start of selection");
    const layerB = makeTextLayerDiv("end of selection");
    document.body.append(layerA, layerB);

    const unregisterA = textSelectionController.register(layerA);
    const unregisterB = textSelectionController.register(layerB);
    selectAcross(layerA, layerB);

    const event = fireCopy();
    expect(event.defaultPrevented).toBe(true);

    unregisterA();
    unregisterB();
  });
});
