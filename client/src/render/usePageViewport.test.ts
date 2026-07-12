// usePageViewport's IO-driven branch (Story 8.7): jsdom has no real
// IntersectionObserver, so this installs a controllable fake to exercise the
// path the app's own no-IntersectionObserver fallback (used everywhere else
// in this suite) never reaches — the `intersecting` Set built from IO entries
// and the `visibilitychange` re-establish listener.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { usePageViewport } from "./usePageViewport";

// "./index" eagerly imports pdfjs-dist, which needs a real canvas backend
// jsdom doesn't provide (DOMMatrix etc.) — mock the barrel down to the pure
// helpers this hook actually uses, same shape as Reader.test.tsx's barrel
// mock, real semantics (not stubs) since these ARE what's under test here.
vi.mock("./index", () => ({
  currentPageInView: (pages: { pageNumber: number; top: number; bottom: number }[], vTop: number, vBottom: number) => {
    let best = pages.length ? pages[0].pageNumber : 1;
    let bestTop = Infinity;
    for (const p of pages) {
      if (p.bottom > vTop && p.top < vBottom && p.top < bestTop) {
        bestTop = p.top;
        best = p.pageNumber;
      }
    }
    return best;
  },
  pageWindow: (current: number, radius: number, pageCount: number) => ({
    start: Math.max(1, Math.min(pageCount, current - radius)),
    end: Math.max(1, Math.min(pageCount, current + radius)),
  }),
  WINDOW_RADIUS: 2,
}));

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  callback: IntersectionObserverCallback;
  observed: Element[] = [];
  disconnected = false;

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    FakeIntersectionObserver.instances.push(this);
  }
  observe(el: Element) {
    this.observed.push(el);
  }
  unobserve() {}
  disconnect() {
    this.disconnected = true;
  }
  takeRecords() {
    return [];
  }
  root = null;
  rootMargin = "";
  thresholds: number[] = [];

  fire(entries: Array<{ target: Element; isIntersecting: boolean }>) {
    this.callback(entries as IntersectionObserverEntry[], this as unknown as IntersectionObserver);
  }
}

function makeCard(rect: { top: number; bottom: number }): HTMLDivElement {
  const el = document.createElement("div");
  el.getBoundingClientRect = vi.fn(() => ({ ...rect, left: 0, right: 0, width: 0, height: 0 })) as never;
  return el;
}

describe("usePageViewport (IntersectionObserver branch)", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    FakeIntersectionObserver.instances = [];
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
    // Runs the callback synchronously so recompute() is observable without
    // waiting a real frame. Must return a falsy id: the hook does
    // `frame = requestAnimationFrame(recompute)`, and recompute() itself
    // resets `frame = 0` as its first line (its own "no pending frame"
    // bookkeeping) — a synchronous stub's return value is assigned AFTER that
    // reset, so a truthy id here would immediately re-clobber it and
    // permanently block every later schedule() call.
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    container = document.createElement("div");
    container.getBoundingClientRect = vi.fn(() => ({
      top: 0,
      bottom: 1000,
      left: 0,
      right: 0,
      width: 0,
      height: 0,
    })) as never;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mount(pageCount = 5) {
    const scrollRef = { current: container };
    // Mount inactive first so registerCard calls land before the IO effect
    // runs (mirrors real mount order: PageCard's own effect registers before
    // the parent's usePageViewport effect activates the observer).
    const { result, rerender, unmount } = renderHook(
      ({ active }: { active: boolean }) => usePageViewport(scrollRef, pageCount, active),
      { initialProps: { active: false } },
    );
    const card1 = makeCard({ top: -500, bottom: -100 });
    const card2 = makeCard({ top: 0, bottom: 400 });
    const card3 = makeCard({ top: 400, bottom: 800 });
    act(() => {
      result.current.registerCard(1, card1);
      result.current.registerCard(2, card2);
      result.current.registerCard(3, card3);
    });
    act(() => rerender({ active: true }));
    const io = FakeIntersectionObserver.instances.at(-1)!;
    return { result, io, card1, card2, card3, unmount };
  }

  it("measures only the cards IO reports as intersecting, not the whole registry", () => {
    const { result, io, card2, card3 } = mount();
    act(() => io.fire([{ target: card2, isIntersecting: true }]));
    expect(result.current.currentPage).toBe(2);
    // card3 was never reported intersecting, so recompute() must never touch it.
    expect(card3.getBoundingClientRect).not.toHaveBeenCalled();
  });

  it("stops considering a card once IO reports it left the viewport", () => {
    const { result, io, card2, card3 } = mount();
    act(() => io.fire([{ target: card2, isIntersecting: true }]));
    expect(result.current.currentPage).toBe(2);
    act(() =>
      io.fire([
        { target: card2, isIntersecting: false },
        { target: card3, isIntersecting: true },
      ]),
    );
    expect(result.current.currentPage).toBe(3);
  });

  it("re-establishes the window on visibilitychange-to-visible", () => {
    const { io, card2 } = mount();
    act(() => io.fire([{ target: card2, isIntersecting: true }]));
    const callsBefore = (card2.getBoundingClientRect as ReturnType<typeof vi.fn>).mock.calls.length;
    vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect((card2.getBoundingClientRect as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(
      callsBefore,
    );
  });

  it("does not re-establish the window on visibilitychange while still hidden", () => {
    const { io, card2 } = mount();
    act(() => io.fire([{ target: card2, isIntersecting: true }]));
    const callsBefore = (card2.getBoundingClientRect as ReturnType<typeof vi.fn>).mock.calls.length;
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect((card2.getBoundingClientRect as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBefore);
  });

  it("disconnects the observer and removes the visibilitychange listener on unmount", () => {
    const removeSpy = vi.spyOn(document, "removeEventListener");
    const { io, unmount } = mount();
    act(() => unmount());
    expect(io.disconnected).toBe(true);
    expect(removeSpy).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
  });
});
