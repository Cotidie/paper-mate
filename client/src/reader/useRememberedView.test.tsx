import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { RefObject } from "react";
import { useRememberedView } from "./useRememberedView";
import { usePageNav } from "./usePageNav";
import { useLastViewStore } from "./lastView";

// usePageNav imports `pageNavTarget` from the `@/render` barrel (pdf.js),
// which needs `DOMMatrix` (unavailable under jsdom). Stub the barrel exactly
// like `ReaderPage.pageNav.test.tsx` does — `restoreView` itself never calls
// `pageNavTarget`, only `handleKeyDown` does.
vi.mock("@/render", () => ({
  pageNavTarget: (current: number, delta: number, pageCount: number) =>
    Math.min(pageCount, Math.max(1, current + delta)),
}));

type Opts = Parameters<typeof useRememberedView>[0];

function makeOpts(overrides: Partial<Opts> = {}): Opts {
  const scrollRef: RefObject<HTMLDivElement | null> = { current: document.createElement("div") };
  const cards: RefObject<Map<number, HTMLDivElement>> = {
    current: new Map([[1, document.createElement("div")]]),
  };
  return {
    scrollRef,
    cards,
    currentPage: 1,
    pageCount: 10,
    docId: "doc-1",
    active: false,
    restoreView: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  useLastViewStore.setState({ positions: {} });
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useRememberedView restore ordering (AC #2/#3/#5)", () => {
  it("does not call restoreView when there is no stored position for this doc (first-time open, AC #3)", () => {
    const opts = makeOpts({ active: true });
    renderHook((o: Opts) => useRememberedView(o), { initialProps: opts });
    expect(opts.restoreView).not.toHaveBeenCalled();
  });

  it("calls restoreView(page, frac) exactly once when active flips true, and not again on re-render (AC #2)", () => {
    useLastViewStore.getState().remember("doc-1", { page: 4, frac: 0.3 });
    const opts = makeOpts({ active: false });
    const { rerender } = renderHook((o: Opts) => useRememberedView(o), { initialProps: opts });
    expect(opts.restoreView).not.toHaveBeenCalled();

    const next = { ...opts, active: true };
    rerender(next);
    expect(next.restoreView).toHaveBeenCalledTimes(1);
    expect(next.restoreView).toHaveBeenCalledWith(4, 0.3);

    rerender({ ...next });
    expect(next.restoreView).toHaveBeenCalledTimes(1);
  });

  it("capture does not fire while still loading, before restore has run (AC #5)", () => {
    const opts = makeOpts({ active: false });
    renderHook((o: Opts) => useRememberedView(o), { initialProps: opts });
    opts.scrollRef.current!.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(1000);
    expect(useLastViewStore.getState().positions["doc-1"]).toBeUndefined();
  });

  it("captures after restore, on scroll + debounce (assert call shape, jsdom has no layout so pixels are untestable)", () => {
    const opts = makeOpts({ active: true, currentPage: 1, docId: "doc-1" });
    renderHook((o: Opts) => useRememberedView(o), { initialProps: opts });
    opts.scrollRef.current!.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(400);
    expect(useLastViewStore.getState().positions["doc-1"]).toEqual({ page: 1, frac: 0 });
  });

  it("flushes a final synchronous capture on unmount (Back to Library / switch documents, AC #1)", () => {
    const opts = makeOpts({ active: true, docId: "doc-1" });
    const { unmount } = renderHook((o: Opts) => useRememberedView(o), { initialProps: opts });
    unmount();
    expect(useLastViewStore.getState().positions["doc-1"]).toEqual({ page: 1, frac: 0 });
  });

  it("re-arms restore on a doc switch without unmounting (active stays true)", () => {
    useLastViewStore.getState().remember("doc-2", { page: 7, frac: 0.6 });
    const opts = makeOpts({ active: true, docId: "doc-1" });
    const { rerender } = renderHook((o: Opts) => useRememberedView(o), { initialProps: opts });
    expect(opts.restoreView).not.toHaveBeenCalled();

    const next: Opts = {
      ...opts,
      docId: "doc-2",
      cards: { current: new Map([[7, document.createElement("div")]]) },
    };
    rerender(next);
    expect(next.restoreView).toHaveBeenCalledWith(7, 0.6);
  });
});

describe("usePageNav.restoreView (Story 10.7, AC #2/#3/#4)", () => {
  function makeContainer() {
    const scrollTo = vi.fn();
    const container = document.createElement("div");
    (container as unknown as { scrollTo: typeof scrollTo }).scrollTo = scrollTo;
    return { container, scrollTo };
  }

  function makeCard(offsetTop: number, clientHeight: number) {
    const card = document.createElement("div");
    Object.defineProperty(card, "offsetTop", { value: offsetTop, configurable: true });
    Object.defineProperty(card, "clientHeight", { value: clientHeight, configurable: true });
    return card;
  }

  it("scrolls instantly to offsetTop + frac*clientHeight, no margin (AC #2/#4)", () => {
    const { container, scrollTo } = makeContainer();
    const cards = { current: new Map([[5, makeCard(500, 800)]]) };
    const scrollRef = { current: container };
    const { result } = renderHook(() => usePageNav({ scrollRef, cards, pageCount: 10, currentPage: 1 }));
    result.current.restoreView(5, 0.25);
    expect(scrollTo).toHaveBeenCalledWith({ top: 500 + 0.25 * 800, behavior: "auto" });
  });

  it("clamps a page beyond pageCount down to pageCount (AC #3)", () => {
    const { container, scrollTo } = makeContainer();
    const cards = { current: new Map([[10, makeCard(100, 200)]]) };
    const scrollRef = { current: container };
    const { result } = renderHook(() => usePageNav({ scrollRef, cards, pageCount: 10, currentPage: 1 }));
    result.current.restoreView(9999, 0.5);
    expect(scrollTo).toHaveBeenCalledWith({ top: 100 + 0.5 * 200, behavior: "auto" });
  });

  it("clamps a page below 1 up to 1", () => {
    const { container, scrollTo } = makeContainer();
    const cards = { current: new Map([[1, makeCard(0, 200)]]) };
    const scrollRef = { current: container };
    const { result } = renderHook(() => usePageNav({ scrollRef, cards, pageCount: 10, currentPage: 1 }));
    result.current.restoreView(-3, 0.5);
    expect(scrollTo).toHaveBeenCalledWith({ top: 0.5 * 200, behavior: "auto" });
  });

  it("no-ops when the target card is not registered", () => {
    const { container, scrollTo } = makeContainer();
    const cards = { current: new Map<number, HTMLDivElement>() };
    const scrollRef = { current: container };
    const { result } = renderHook(() => usePageNav({ scrollRef, cards, pageCount: 10, currentPage: 1 }));
    result.current.restoreView(3, 0.5);
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
