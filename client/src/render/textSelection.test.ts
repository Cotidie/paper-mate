// jsdom can't see real selection geometry or `::selection` paint (see
// Reader.test.tsx / CLAUDE.md), so this only covers the parts that ARE
// jsdom-safe: register/unregister bookkeeping and the shared global listener
// being enabled once and torn down only once the last div unregisters
// (Story 4.1 AC-5, "no leak / lifecycle-safe").

import { describe, it, expect, vi, afterEach } from "vitest";
import { isEmptyLayerSpace, textSelectionController } from "./textSelection";

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
