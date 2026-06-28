import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
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
});
