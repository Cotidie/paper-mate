import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
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

  it("renders the zoom-control pill with the live percent (fit = 100%) (AC-3)", async () => {
    render(<Reader doc={doc} />);
    await screen.findAllByTestId("page-surface");
    // fitToWidthScale mock = 1 → 100%.
    expect(screen.getByLabelText("Fit to width").textContent).toBe("100%");
  });

  it("zooms in/out via Ctrl +/- and refits via Ctrl 0, updating the percent (AC-1)", async () => {
    render(<Reader doc={doc} />);
    const canvas = await screen.findByTestId("reader-backdrop");
    const percent = () => screen.getByLabelText("Fit to width").textContent;

    // Ctrl + (== "+") → nextZoom ×2 → 200%; preventDefault blocks browser zoom.
    expect(fireEvent.keyDown(canvas, { key: "+", ctrlKey: true })).toBe(false);
    expect(percent()).toBe("200%");
    // Ctrl - → ÷2 → back to 100%.
    expect(fireEvent.keyDown(canvas, { key: "-", ctrlKey: true })).toBe(false);
    expect(percent()).toBe("100%");
    // "=" (the unshifted "+" key) also zooms in.
    expect(fireEvent.keyDown(canvas, { key: "=", ctrlKey: true })).toBe(false);
    expect(percent()).toBe("200%");
    // Ctrl 0 → recompute fit (mock 1) → 100%.
    expect(fireEvent.keyDown(canvas, { key: "0", ctrlKey: true })).toBe(false);
    expect(percent()).toBe("100%");
  });

  it("zooms the pill buttons (AC-3)", async () => {
    render(<Reader doc={doc} />);
    await screen.findAllByTestId("page-surface");
    fireEvent.click(screen.getByLabelText("Zoom in"));
    expect(screen.getByLabelText("Fit to width").textContent).toBe("200%");
    fireEvent.click(screen.getByLabelText("Zoom out"));
    expect(screen.getByLabelText("Fit to width").textContent).toBe("100%");
  });

  it("zooms on Ctrl+wheel and ignores plain wheel (AC-2)", async () => {
    render(<Reader doc={doc} />);
    const canvas = await screen.findByTestId("reader-backdrop");
    const percent = () => screen.getByLabelText("Fit to width").textContent;
    // Plain wheel: no zoom.
    fireEvent.wheel(canvas, { deltaY: -1 });
    expect(percent()).toBe("100%");
    // Ctrl+wheel up → zoom in (×2).
    fireEvent.wheel(canvas, { deltaY: -1, ctrlKey: true });
    expect(percent()).toBe("200%");
    // Ctrl+wheel down → zoom out (÷2).
    fireEvent.wheel(canvas, { deltaY: 1, ctrlKey: true });
    expect(percent()).toBe("100%");
  });
});
