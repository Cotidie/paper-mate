import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import BankPanel from "./BankPanel";
import { useAnnotationStore } from "./store";
import type { Annotation } from "./api/client";
import type { BankItem } from "./bank";

function textMark(id: string, overrides: Partial<Annotation> = {}, text = "Selected run"): Annotation {
  return {
    id,
    doc_id: "doc-1",
    type: "highlight",
    group_id: null,
    anchor: { kind: "text", page_index: 0, rects: [{ x0: 0.1, y0: 0.1, x1: 0.5, y1: 0.15 }], text },
    style: { color: "annotation-default", stroke_width: null, alpha: null },
    body: null,
    created_at: "2026-06-29T00:00:01Z",
    updated_at: "2026-06-29T00:00:01Z",
    ...overrides,
  };
}

beforeEach(() => useAnnotationStore.setState({ annotations: new Map() }));
afterEach(cleanup);

describe("BankPanel (Story 3.6, AC #1, #2, #3, #5)", () => {
  it("renders nothing when closed", () => {
    useAnnotationStore.getState().addAnnotation(textMark("a"));
    const { container } = render(<BankPanel open={false} docId="doc-1" onJump={vi.fn()} onClose={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the empty state when the doc has no annotations", () => {
    render(<BankPanel open docId="doc-1" onJump={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByTestId("bank-empty").textContent).toBe("No annotations yet.");
  });

  it("renders one row per annotation with snippet + page", () => {
    useAnnotationStore.getState().addAnnotation(textMark("a", {}, "Theorem 1"));
    render(<BankPanel open docId="doc-1" onJump={vi.fn()} onClose={vi.fn()} />);
    const row = screen.getByTestId("bank-row-a");
    expect(row.textContent).toContain("Theorem 1");
    expect(row.textContent).toContain("1");
  });

  it("collapses a two-page group into ONE row (the earliest sibling)", () => {
    useAnnotationStore.getState().addAnnotation(textMark("a", { group_id: "g1" }));
    useAnnotationStore
      .getState()
      .addAnnotation(textMark("b", { group_id: "g1", created_at: "2026-06-29T00:00:02Z" }));
    render(<BankPanel open docId="doc-1" onJump={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByTestId("bank-row-a")).toBeTruthy();
    expect(screen.queryByTestId("bank-row-b")).toBeNull();
  });

  it("only lists the current document's marks", () => {
    useAnnotationStore.getState().addAnnotation(textMark("mine", { doc_id: "doc-1" }));
    useAnnotationStore.getState().addAnnotation(textMark("other", { doc_id: "doc-2" }));
    render(<BankPanel open docId="doc-1" onJump={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByTestId("bank-row-mine")).toBeTruthy();
    expect(screen.queryByTestId("bank-row-other")).toBeNull();
  });

  it("clicking a row calls onJump with that row's BankItem", () => {
    useAnnotationStore.getState().addAnnotation(textMark("a", {}, "Theorem 1"));
    const onJump = vi.fn();
    render(<BankPanel open docId="doc-1" onJump={onJump} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId("bank-row-a"));
    expect(onJump).toHaveBeenCalledTimes(1);
    const [item] = onJump.mock.calls[0] as [BankItem];
    expect(item.id).toBe("a");
    expect(item.snippet).toBe("Theorem 1");
  });

  it("Esc closes the panel while open", () => {
    const onClose = vi.fn();
    render(<BankPanel open docId="doc-1" onJump={vi.fn()} onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not listen for Esc while closed", () => {
    const onClose = vi.fn();
    render(<BankPanel open={false} docId="doc-1" onJump={vi.fn()} onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("clicking the close button calls onClose", () => {
    const onClose = vi.fn();
    render(<BankPanel open docId="doc-1" onJump={vi.fn()} onClose={onClose} />);
    fireEvent.click(screen.getByTestId("bank-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("rows and the close button are real <button>s", () => {
    useAnnotationStore.getState().addAnnotation(textMark("a"));
    render(<BankPanel open docId="doc-1" onJump={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByTestId("bank-row-a").tagName.toLowerCase()).toBe("button");
    expect(screen.getByTestId("bank-close").tagName.toLowerCase()).toBe("button");
  });

  it("a placeholder snippet (e.g. a region highlight) is still clickable and carries the label", () => {
    useAnnotationStore.getState().addAnnotation({
      id: "r1",
      doc_id: "doc-1",
      type: "highlight",
      group_id: null,
      anchor: { kind: "rect", page_index: 0, rect: { x0: 0.1, y0: 0.2, x1: 0.5, y1: 0.6 } },
      style: { color: "annotation-default", stroke_width: null, alpha: null },
      body: null,
      created_at: "2026-06-29T00:00:01Z",
      updated_at: "2026-06-29T00:00:01Z",
    });
    render(<BankPanel open docId="doc-1" onJump={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByTestId("bank-row-r1").textContent).toContain("Region");
  });

  it("a placeholder's accessible name still leads with the TYPE, not just the placeholder label (Codex review fix)", () => {
    useAnnotationStore.getState().addAnnotation({
      id: "r1",
      doc_id: "doc-1",
      type: "highlight",
      group_id: null,
      anchor: { kind: "rect", page_index: 0, rect: { x0: 0.1, y0: 0.2, x1: 0.5, y1: 0.6 } },
      style: { color: "annotation-default", stroke_width: null, alpha: null },
      body: null,
      created_at: "2026-06-29T00:00:01Z",
      updated_at: "2026-06-29T00:00:01Z",
    });
    render(<BankPanel open docId="doc-1" onJump={vi.fn()} onClose={vi.fn()} />);
    // "Region" (the placeholder snippet) is not the word "Highlight" (the type),
    // so the accessible name must say BOTH, not just the placeholder.
    expect(screen.getByTestId("bank-row-r1").getAttribute("aria-label")).toBe("Highlight, page 1: Region");
  });

  it("a placeholder whose snippet already equals its type label isn't repeated (e.g. an empty memo)", () => {
    useAnnotationStore.getState().addAnnotation({
      id: "m1",
      doc_id: "doc-1",
      type: "memo",
      group_id: null,
      anchor: { kind: "rect", page_index: 0, rect: { x0: 0.1, y0: 0.2, x1: 0.3, y1: 0.3 } },
      style: { color: "annotation-pink", stroke_width: null, alpha: null },
      body: "",
      created_at: "2026-06-29T00:00:01Z",
      updated_at: "2026-06-29T00:00:01Z",
    });
    render(<BankPanel open docId="doc-1" onJump={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByTestId("bank-row-m1").getAttribute("aria-label")).toBe("Memo, page 1");
  });

  it("excludes pen strokes and underlines from the panel (fix request)", () => {
    useAnnotationStore.getState().addAnnotation({
      id: "pen1",
      doc_id: "doc-1",
      type: "pen",
      group_id: null,
      anchor: {
        kind: "path",
        page_index: 0,
        points: [
          { x: 0.1, y: 0.1 },
          { x: 0.2, y: 0.2 },
        ],
      },
      style: { color: "annotation-blue", stroke_width: 4, alpha: null },
      body: null,
      created_at: "2026-06-29T00:00:01Z",
      updated_at: "2026-06-29T00:00:01Z",
    });
    useAnnotationStore.getState().addAnnotation(textMark("underline1", { type: "underline" }));
    render(<BankPanel open docId="doc-1" onJump={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByTestId("bank-empty")).toBeTruthy();
    expect(screen.queryByTestId("bank-row-pen1")).toBeNull();
    expect(screen.queryByTestId("bank-row-underline1")).toBeNull();
  });
});
