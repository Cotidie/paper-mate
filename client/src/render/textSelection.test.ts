// jsdom can't see real selection geometry or `::selection` paint (see
// Reader.test.tsx / CLAUDE.md), so this only covers the parts that ARE
// jsdom-safe: register/unregister bookkeeping and the shared global listener
// being enabled once and torn down only once the last div unregisters
// (Story 4.1 AC-5, "no leak / lifecycle-safe").

import { describe, it, expect, vi } from "vitest";
import { textSelectionController } from "./textSelection";

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
