import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent, act } from "@testing-library/react";
import Reader from "./Reader";
import type { Doc } from "./api/client";
import * as renderLayer from "./render";

// pdf.js can't run under jsdom (canvas/worker), so mock the whole render module
// and assert the Reader's reserve-then-stream behavior against the mock.
vi.mock("./render", () => {
  const fakePage = { _page: true };
  return {
    loadDocument: vi.fn(async () => ({ getPage: vi.fn(async () => fakePage) })),
    destroyDocument: vi.fn(),
    getPageBox: vi.fn(() => ({ width: 600, height: 800 })),
    renderPage: vi.fn(() => ({ done: Promise.resolve(), cancel: vi.fn() })),
    fitToWidthScale: vi.fn(() => 1),
    currentPageInView: vi.fn(() => 1),
    pageNavTarget: vi.fn((c: number, d: number, n: number) => Math.min(n, Math.max(1, c + d))),
    // Deterministic zoom math for the jsdom tests: ×2 in / ÷2 out.
    nextZoom: vi.fn((s: number, dir: number) => (dir >= 0 ? s * 2 : s / 2)),
    focalScrollOffset: vi.fn((scroll: number, focal: number, factor: number) => (scroll + focal) * factor - focal),
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

  it("zooms on Ctrl+wheel, ignores plain wheel and deltaY===0 (AC-2)", async () => {
    const onZoomChange = vi.fn();
    render(<Reader doc={doc} onZoomChange={onZoomChange} />);
    const canvas = await screen.findByTestId("reader-backdrop");
    onZoomChange.mockClear();

    // Plain wheel: no zoom.
    fireEvent.wheel(canvas, { deltaY: -1 });
    // Ctrl+wheel with deltaY === 0 (horizontal): ignored, not zoom-out (LOW fix).
    fireEvent.wheel(canvas, { deltaY: 0, ctrlKey: true });
    expect(onZoomChange).not.toHaveBeenCalled();

    // Ctrl+wheel up → zoom in (mock ×2).
    fireEvent.wheel(canvas, { deltaY: -1, ctrlKey: true });
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
