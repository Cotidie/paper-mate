import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent, act } from "@testing-library/react";
import Reader from "./Reader";
import type { Doc } from "@/api/client";
import * as renderLayer from "@/render";

// pdf.js can't run under jsdom (canvas/worker), so mock the whole render module
// and assert the Reader's reserve-then-stream behavior against the mock.
vi.mock("@/render", () => {
  const fakePage = { _page: true };
  return {
    loadDocument: vi.fn(async () => ({ getPage: vi.fn(async () => fakePage) })),
    destroyDocument: vi.fn(),
    getPageBox: vi.fn(() => ({ width: 600, height: 800 })),
    // ToC outline read (Story 1.9): the Reader imports it, so the mocked barrel
    // must export it or the outline effect throws. Default to no outline.
    getOutline: vi.fn(async () => []),
    renderPage: vi.fn(() => ({ done: Promise.resolve(), cancel: vi.fn() })),
    fitToWidthScale: vi.fn(() => 1),
    currentPageInView: vi.fn(() => 1),
    // usePageViewport (imported via sub-path) is REAL in these tests; under jsdom
    // it takes the no-IntersectionObserver path (all cards live, page 1), but its
    // `useState` initializer still calls pageWindow at render, so the mocked
    // barrel must export it (and WINDOW_RADIUS) or the hook throws.
    pageWindow: vi.fn((c: number, r: number, n: number) => ({
      start: Math.max(1, c - r),
      end: Math.min(n, c + r),
    })),
    WINDOW_RADIUS: 2,
    pageNavTarget: vi.fn((c: number, d: number, n: number) => Math.min(n, Math.max(1, c + d))),
    // Deterministic zoom math for the jsdom tests: ×2 in / ÷2 out.
    nextZoom: vi.fn((s: number, dir: number) => (dir >= 0 ? s * 2 : s / 2)),
    focalScroll: vi.fn((edge: number, size: number, frac: number, focal: number) => edge + frac * size - focal),
    panScroll: vi.fn((start: number, delta: number) => start - delta),
    ZOOM_STEP: 1.25,
    ZOOM_WHEEL_STEP: 1.1,
  };
});

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

const doc: Doc = {
  doc_id: "a".repeat(64),
  filename: "paper.pdf",
  title: "A Paper",
  page_count: 3,
  added: "2026-06-28T00:00:00+00:00",
  last_opened: "2026-06-28T00:00:00+00:00",
  authors_list: [],
  file_type: "pdf",
  status: "ready",
  schema_version: 1,
};

describe("Reader", () => {
  it("loads the document by doc_id through the render layer (AC-1/AC-5)", async () => {
    render(<Reader doc={doc} />);
    await waitFor(() =>
      expect(renderLayer.loadDocument).toHaveBeenCalledWith("a".repeat(64)),
    );
  });

  it("reserves one page-surface card per page at final geometry before paint (AC-3)", async () => {
    render(<Reader doc={doc} />);
    const cards = await screen.findAllByTestId("page-surface");
    expect(cards).toHaveLength(doc.page_count);
    // Geometry is reserved up front: each card is sized (600×800 box × scale 1).
    for (const card of cards) {
      expect((card as HTMLElement).style.width).toBe("600px");
      expect((card as HTMLElement).style.height).toBe("800px");
    }
  });

  it("streams each reserved page into the render layer (AC-1)", async () => {
    render(<Reader doc={doc} />);
    await screen.findAllByTestId("page-surface");
    await waitFor(() =>
      expect(renderLayer.renderPage).toHaveBeenCalledTimes(doc.page_count),
    );
    // Each paint targets a real canvas + text-layer div inside its card.
    const [, opts] = (renderLayer.renderPage as unknown as { mock: { calls: unknown[][] } })
      .mock.calls[0];
    expect((opts as { canvas: HTMLCanvasElement }).canvas).toBeInstanceOf(HTMLCanvasElement);
    expect((opts as { scale: number }).scale).toBe(1);
  });

  it("exposes the pdf-canvas scroll region (reader-backdrop)", async () => {
    render(<Reader doc={doc} />);
    expect(screen.getByTestId("reader-backdrop")).toBeTruthy();
  });

  it("makes the canvas keyboard-focusable for page nav (AC-3/UX-DR17)", async () => {
    render(<Reader doc={doc} />);
    const canvas = screen.getByTestId("reader-backdrop");
    expect((canvas as HTMLElement).tabIndex).toBe(0);
  });

  it("reports the page in view to the parent, defaulting to page 1 (AC-2)", async () => {
    const onVisiblePageChange = vi.fn();
    render(<Reader doc={doc} onVisiblePageChange={onVisiblePageChange} />);
    await screen.findAllByTestId("page-surface");
    await waitFor(() => expect(onVisiblePageChange).toHaveBeenCalledWith(1));
  });

  it("intercepts PgUp/PgDn and the Ctrl-only Arrow aliases, but not bare or extra-modifier arrows", async () => {
    render(<Reader doc={doc} />);
    const canvas = await screen.findByTestId("reader-backdrop");
    // fireEvent.keyDown returns false when the handler called preventDefault.
    expect(fireEvent.keyDown(canvas, { key: "PageDown" })).toBe(false);
    expect(fireEvent.keyDown(canvas, { key: "PageUp" })).toBe(false);
    expect(fireEvent.keyDown(canvas, { key: "ArrowDown", ctrlKey: true })).toBe(false);
    expect(fireEvent.keyDown(canvas, { key: "ArrowUp", ctrlKey: true })).toBe(false);
    // A bare arrow (no Ctrl) is left to the browser — not a page-nav alias.
    expect(fireEvent.keyDown(canvas, { key: "ArrowDown" })).toBe(true);
    // Ctrl ONLY: adjacent chords must pass through (Ctrl+Shift+Arrow extends the
    // text selection; Meta+Arrow is not in our keyboard map).
    expect(fireEvent.keyDown(canvas, { key: "ArrowDown", ctrlKey: true, shiftKey: true })).toBe(true);
    expect(fireEvent.keyDown(canvas, { key: "ArrowDown", ctrlKey: true, altKey: true })).toBe(true);
    expect(fireEvent.keyDown(canvas, { key: "ArrowDown", metaKey: true })).toBe(true);
  });

  it("maps forward/backward nav keys to the right direction delta", async () => {
    const { pageNavTarget } = renderLayer as unknown as { pageNavTarget: ReturnType<typeof vi.fn> };
    render(<Reader doc={doc} />);
    const canvas = await screen.findByTestId("reader-backdrop");
    // pageNavTarget(current, delta, pageCount) — assert the delta, not the scroll
    // (jsdom has no real layout/scrollTo). Down → +1, Up → -1.
    pageNavTarget.mockClear();
    fireEvent.keyDown(canvas, { key: "ArrowDown", ctrlKey: true });
    expect(pageNavTarget.mock.calls.at(-1)?.[1]).toBe(1);
    fireEvent.keyDown(canvas, { key: "ArrowUp", ctrlKey: true });
    expect(pageNavTarget.mock.calls.at(-1)?.[1]).toBe(-1);
    fireEvent.keyDown(canvas, { key: "PageDown" });
    expect(pageNavTarget.mock.calls.at(-1)?.[1]).toBe(1);
  });

  it("hold-Space arms a temp pan: keydown is preventDefaulted + sets the grab cursor, keyup clears (AC-2/AC-3)", async () => {
    render(<Reader doc={doc} />);
    await screen.findAllByTestId("page-surface"); // phase === "ready" (Space is ready-gated)
    const canvas = screen.getByTestId("reader-backdrop");
    // Not pannable by default (cursor tool, no Space).
    expect(canvas.hasAttribute("data-pan")).toBe(false);
    // Space keydown suppresses the browser's page-scroll (returns false) and arms.
    expect(fireEvent.keyDown(canvas, { key: " " })).toBe(false);
    expect(canvas.hasAttribute("data-pan")).toBe(true);
    // Release falls back to the armed tool (cursor here) → no longer pannable.
    fireEvent.keyUp(canvas, { key: " " });
    expect(canvas.hasAttribute("data-pan")).toBe(false);
  });

  it("releases a stuck Space-pan on window blur (missed keyup → not stranded in pan mode)", async () => {
    render(<Reader doc={doc} />);
    await screen.findAllByTestId("page-surface");
    const canvas = screen.getByTestId("reader-backdrop");
    // Hold Space (keydown, no keyup) → pannable.
    fireEvent.keyDown(canvas, { key: " " });
    expect(canvas.hasAttribute("data-pan")).toBe(true);
    // Window loses focus before the keyup arrives (alt-tab / OS shortcut): the
    // held flag must reset so the reader is not stranded in pan mode (which would
    // keep the grab cursor and kill text selection / highlighting).
    fireEvent.blur(window);
    await waitFor(() => expect(canvas.hasAttribute("data-pan")).toBe(false));
  });

  it("releases a stuck Space-pan on document visibilitychange (tab hidden)", async () => {
    render(<Reader doc={doc} />);
    await screen.findAllByTestId("page-surface");
    const canvas = screen.getByTestId("reader-backdrop");
    fireEvent.keyDown(canvas, { key: " " });
    expect(canvas.hasAttribute("data-pan")).toBe(true);
    fireEvent(document, new Event("visibilitychange"));
    await waitFor(() => expect(canvas.hasAttribute("data-pan")).toBe(false));
  });

  it("arms hold-Space from the document, regardless of which element has focus (focus-independent)", async () => {
    render(<Reader doc={doc} />);
    await screen.findAllByTestId("page-surface");
    const canvas = screen.getByTestId("reader-backdrop");
    // Space dispatched on document.body (focus NOT on the canvas) still arms pan.
    const e = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
    document.body.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    await waitFor(() => expect(canvas.hasAttribute("data-pan")).toBe(true));
    document.body.dispatchEvent(new KeyboardEvent("keyup", { key: " ", bubbles: true }));
    await waitFor(() => expect(canvas.hasAttribute("data-pan")).toBe(false));
  });

  it("stops an in-flight Space pan the moment Space is released (cursor tool) (AC-3)", async () => {
    render(<Reader doc={doc} />);
    await screen.findAllByTestId("page-surface");
    const canvas = screen.getByTestId("reader-backdrop");
    // Hold Space → pannable; start a drag.
    fireEvent.keyDown(canvas, { key: " " });
    await waitFor(() => expect(canvas.getAttribute("data-pan")).toBe(""));
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 7, clientX: 10, clientY: 10 });
    expect(canvas.getAttribute("data-pan")).toBe("grabbing");
    // Release Space mid-drag (button still down): the pan must stop, not continue.
    fireEvent.keyUp(canvas, { key: " " });
    await waitFor(() => expect(canvas.hasAttribute("data-pan")).toBe(false));
  });

  it("keeps a hand-armed drag going when Space is released (hand stays armed)", async () => {
    render(<Reader doc={doc} panArmed />);
    await screen.findAllByTestId("page-surface");
    const canvas = screen.getByTestId("reader-backdrop");
    fireEvent.keyDown(canvas, { key: " " });
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 8, clientX: 10, clientY: 10 });
    expect(canvas.getAttribute("data-pan")).toBe("grabbing");
    // Space release → canPan still true via panArmed → drag continues.
    fireEvent.keyUp(canvas, { key: " " });
    await waitFor(() => expect(canvas.getAttribute("data-pan")).toBe("grabbing"));
  });

  it("does not swallow Space when no doc is ready / leaves nav keys intact", async () => {
    render(<Reader doc={doc} />);
    const canvas = await screen.findByTestId("reader-backdrop");
    // PgUp/PgDn nav still preventDefaults (Space must not have broken the map).
    expect(fireEvent.keyDown(canvas, { key: "PageDown" })).toBe(false);
    expect(fireEvent.keyDown(canvas, { key: "ArrowDown", ctrlKey: true })).toBe(false);
  });

  it("pointer-drag with the hand armed sets the grabbing cursor and clears on pointerup (AC-2)", async () => {
    render(<Reader doc={doc} panArmed />);
    const canvas = await screen.findByTestId("reader-backdrop");
    // Armed but idle → grab (empty data-pan).
    expect(canvas.getAttribute("data-pan")).toBe("");
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
    expect(canvas.getAttribute("data-pan")).toBe("grabbing");
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 40, clientY: 30 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    // Back to grab (still armed), no longer dragging.
    expect(canvas.getAttribute("data-pan")).toBe("");
  });

  it("does not arm a pointer drag when nothing is pannable (cursor tool)", async () => {
    render(<Reader doc={doc} />);
    const canvas = await screen.findByTestId("reader-backdrop");
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
    expect(canvas.hasAttribute("data-pan")).toBe(false);
  });

  it("reports the live zoom percent up, defaulting to fit (100%) (AC-3)", async () => {
    const onZoomChange = vi.fn();
    render(<Reader doc={doc} onZoomChange={onZoomChange} />);
    await screen.findAllByTestId("page-surface");
    // fitToWidthScale mock = 1 → 100%.
    await waitFor(() => expect(onZoomChange).toHaveBeenLastCalledWith(100));
  });

  it("zooms via Ctrl +/-/0 from the DOCUMENT, not only the focused canvas (AC-1, HIGH fix)", async () => {
    const onZoomChange = vi.fn();
    render(<Reader doc={doc} onZoomChange={onZoomChange} />);
    await screen.findAllByTestId("page-surface");
    onZoomChange.mockClear();

    // Keydown on document.body (NOT the canvas) — shortcuts are focus-independent.
    // nextZoom mock = ×2 in / ÷2 out; preventDefault blocks the browser's zoom.
    const press = (key: string) => {
      const e = new KeyboardEvent("keydown", { key, ctrlKey: true, cancelable: true, bubbles: true });
      document.body.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(press("+")).toBe(true);
    await waitFor(() => expect(onZoomChange).toHaveBeenLastCalledWith(200));
    expect(press("-")).toBe(true);
    await waitFor(() => expect(onZoomChange).toHaveBeenLastCalledWith(100));
    expect(press("=")).toBe(true); // unshifted "+" key
    await waitFor(() => expect(onZoomChange).toHaveBeenLastCalledWith(200));
    expect(press("0")).toBe(true); // fit → mock 1 → 100%
    await waitFor(() => expect(onZoomChange).toHaveBeenLastCalledWith(100));
  });

  it("exposes an imperative zoom handle for the top-bar control (AC-3)", async () => {
    const ref = { current: null as null | import("./Reader").ReaderHandle };
    const onZoomChange = vi.fn();
    render(<Reader ref={ref} doc={doc} onZoomChange={onZoomChange} />);
    await screen.findAllByTestId("page-surface");
    onZoomChange.mockClear();
    expect(typeof ref.current?.zoomIn).toBe("function");
    ref.current!.zoomIn();
    await waitFor(() => expect(onZoomChange).toHaveBeenLastCalledWith(200));
    ref.current!.zoomOut();
    await waitFor(() => expect(onZoomChange).toHaveBeenLastCalledWith(100));
  });

  it("reports the embedded outline up once the document is ready (Story 1.9)", async () => {
    const entries = [{ title: "Intro", pageNumber: 1, depth: 0 }];
    (renderLayer.getOutline as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(entries);
    const onOutline = vi.fn();
    render(<Reader doc={doc} onOutline={onOutline} />);
    await screen.findAllByTestId("page-surface");
    await waitFor(() => expect(onOutline).toHaveBeenCalledWith(entries));
  });

  it("exposes jumpToPage on the handle, scrolling the target card to the top (Story 1.9 AC-2)", async () => {
    const ref = { current: null as null | import("./Reader").ReaderHandle };
    render(<Reader ref={ref} doc={doc} />);
    await screen.findAllByTestId("page-surface");
    const canvas = screen.getByTestId("reader-backdrop") as HTMLElement;
    // jsdom has no real scrollTo; stub it to capture the jump (offsetTop is 0
    // under jsdom — assert the call + instant behavior, not pixels). Page-step
    // nav is instant (fix request: no per-step glide), so behavior is "auto".
    const scrollTo = vi.fn();
    canvas.scrollTo = scrollTo as unknown as typeof canvas.scrollTo;
    expect(typeof ref.current?.jumpToPage).toBe("function");
    // Retry the call: the last page's card registers on a deferred effect under
    // React 19 + jsdom, so a single immediate jump can race it (the PgUp/PgDn
    // tests dodge this by asserting the delta, not the scroll).
    await waitFor(() => {
      ref.current!.jumpToPage(2);
      expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: "auto" }));
    });
  });

  it("clamps an out-of-range jumpToPage target into [1, page_count]", async () => {
    const ref = { current: null as null | import("./Reader").ReaderHandle };
    render(<Reader ref={ref} doc={doc} />);
    await screen.findAllByTestId("page-surface");
    const canvas = screen.getByTestId("reader-backdrop") as HTMLElement;
    const scrollTo = vi.fn();
    canvas.scrollTo = scrollTo as unknown as typeof canvas.scrollTo;
    // page_count = 3; page 99 clamps to a real card (3) so it still scrolls.
    // Retry until the page-3 card has registered (see the note above).
    await waitFor(() => {
      ref.current!.jumpToPage(99);
      expect(scrollTo).toHaveBeenCalled();
    });
  });

  it("exposes jumpToAnnotation on the handle, scrolling by page offset + a fractional offset within it (Story 3.6 AC-4)", async () => {
    const ref = { current: null as null | import("./Reader").ReaderHandle };
    render(<Reader ref={ref} doc={doc} />);
    await screen.findAllByTestId("page-surface");
    const canvas = screen.getByTestId("reader-backdrop") as HTMLElement;
    const scrollTo = vi.fn();
    canvas.scrollTo = scrollTo as unknown as typeof canvas.scrollTo;
    expect(typeof ref.current?.jumpToAnnotation).toBe("function");
    // 0-based pageIndex 1 (page 2); jsdom cards have 0 clientHeight, so the
    // fractional term is 0 — assert the call shape (offset scroll + smooth),
    // not pixels (the DPR/live-layout math is covered by the live smoke).
    await waitFor(() => {
      ref.current!.jumpToAnnotation(1, 0.5);
      expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: "smooth" }));
    });
  });

  it("jumpToAnnotation's top margin is a fraction of the VIEWPORT, not the page card (Codex review fix)", async () => {
    const ref = { current: null as null | import("./Reader").ReaderHandle };
    render(<Reader ref={ref} doc={doc} />);
    const cards = await screen.findAllByTestId("page-surface");
    const canvas = screen.getByTestId("reader-backdrop") as HTMLElement;
    const scrollTo = vi.fn();
    canvas.scrollTo = scrollTo as unknown as typeof canvas.scrollTo;
    // Deliberately mismatched heights: a card-relative margin (the pre-fix bug)
    // and a viewport-relative one (the fix) land on different `top` values —
    // this distinguishes them where jsdom's real (always-0) layout could not.
    Object.defineProperty(canvas, "clientHeight", { value: 1000, configurable: true });
    const targetCard = cards[1];
    Object.defineProperty(targetCard, "clientHeight", { value: 200, configurable: true });
    Object.defineProperty(targetCard, "offsetTop", { value: 500, configurable: true });
    await waitFor(() => {
      ref.current!.jumpToAnnotation(1, 0.5);
      expect(scrollTo).toHaveBeenCalled();
    });
    // top = card.offsetTop + topFraction * card.clientHeight - viewport.clientHeight * 0.15
    //     = 500 + 0.5*200 - 1000*0.15 = 500 + 100 - 150 = 450.
    const { top } = scrollTo.mock.calls.at(-1)![0] as { top: number };
    expect(top).toBeCloseTo(450, 5);
  });

  it("clamps an out-of-range jumpToAnnotation pageIndex into the document's page range", async () => {
    const ref = { current: null as null | import("./Reader").ReaderHandle };
    render(<Reader ref={ref} doc={doc} />);
    await screen.findAllByTestId("page-surface");
    const canvas = screen.getByTestId("reader-backdrop") as HTMLElement;
    const scrollTo = vi.fn();
    canvas.scrollTo = scrollTo as unknown as typeof canvas.scrollTo;
    // page_count = 3; a wildly out-of-range 0-based index clamps to the last card.
    await waitFor(() => {
      ref.current!.jumpToAnnotation(99, 0.2);
      expect(scrollTo).toHaveBeenCalled();
    });
  });

  it("jumpToAnnotation no-ops (does not throw) when scrollTo is unavailable (jsdom guard)", async () => {
    const ref = { current: null as null | import("./Reader").ReaderHandle };
    render(<Reader ref={ref} doc={doc} />);
    await screen.findAllByTestId("page-surface");
    // No scrollTo stub: same "layout/scrollTo unavailable" guard jumpToPage has.
    expect(() => ref.current!.jumpToAnnotation(0, 0.5)).not.toThrow();
  });

  it("ignores plain wheel, and a Ctrl+wheel with deltaY===0 (no zoom-out) (AC-2 / LOW fix)", async () => {
    const onZoomChange = vi.fn();
    render(<Reader doc={doc} onZoomChange={onZoomChange} />);
    await screen.findAllByTestId("page-surface");
    // Flush the document-level wheel-binding useEffect before dispatching
    // synthetic wheel events below — the effect is passive and can otherwise
    // still be pending when findAllByTestId resolves, making the following
    // synchronous `defaultPrevented` assertions flaky (Story 4.1 de-flake).
    await act(async () => {});
    onZoomChange.mockClear();
    const wheel = (init: WheelEventInit) => {
      const e = new WheelEvent("wheel", { bubbles: true, cancelable: true, ...init });
      document.body.dispatchEvent(e);
      return e;
    };

    // Plain wheel (no Ctrl): not zoom, and not preventDefaulted (normal scroll).
    expect(wheel({ deltaY: -1 }).defaultPrevented).toBe(false);
    // Ctrl+wheel with deltaY === 0 (horizontal): browser zoom still blocked, but
    // it must NOT be treated as zoom-out.
    expect(wheel({ deltaY: 0, ctrlKey: true }).defaultPrevented).toBe(true);
    await Promise.resolve();
    expect(onZoomChange).not.toHaveBeenCalled();
  });

  it("zooms on Ctrl+wheel even when the pointer is off the canvas (over top-bar control) — HIGH fix", async () => {
    const onZoomChange = vi.fn();
    render(<Reader doc={doc} onZoomChange={onZoomChange} />);
    await screen.findAllByTestId("page-surface");
    onZoomChange.mockClear();
    // Listener is document-level, so a Ctrl+wheel dispatched OUTSIDE .pdf-canvas
    // (e.g. over the relocated top-bar zoom control) is still caught + prevented.
    const e = new WheelEvent("wheel", { deltaY: -1, ctrlKey: true, cancelable: true, bubbles: true });
    document.body.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    await waitFor(() => expect(onZoomChange).toHaveBeenLastCalledWith(200));
  });

  it("CSS pre-scales the canvas on zoom instead of blanking it, and never re-flashes the skeleton (no flicker)", async () => {
    render(<Reader doc={doc} />);
    await screen.findAllByTestId("page-surface");
    // Wait for the first paint to complete (skeletons clear).
    await waitFor(() => expect(document.querySelector(".page-surface__skeleton")).toBeNull());
    const canvas = document.querySelector(".page-surface__canvas") as HTMLCanvasElement;
    expect(canvas.style.transform).toBe("");

    // Freeze the debounced crisp re-render so the transient pre-scale is stable.
    vi.useFakeTimers();
    try {
      act(() => {
        document.body.dispatchEvent(
          new KeyboardEvent("keydown", { key: "+", ctrlKey: true, bubbles: true }),
        );
      });
      // Instant CSS pre-scale (nextZoom mock ×2 → scale 2 / rendered 1), and the
      // skeleton must NOT come back (the old code blanked + re-skeletoned here).
      expect(canvas.style.transform).toBe("scale(2)");
      expect(document.querySelector(".page-surface__skeleton")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
