import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import BankPanel from "./BankPanel";
import { useAnnotationStore } from "@/store";
import type { Annotation } from "@/api/client";
import { BANK_FILTER_TYPES, type BankItem } from "@/lib/bank";

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

function commentMark(id: string, body: string | null = null, overrides: Partial<Annotation> = {}): Annotation {
  return {
    id,
    doc_id: "doc-1",
    type: "comment",
    group_id: null,
    anchor: { kind: "rect", page_index: 0, rect: { x0: 0.2, y0: 0.3, x1: 0.2, y1: 0.3 } },
    style: { color: "annotation-default", stroke_width: null, alpha: null },
    body,
    created_at: "2026-06-29T00:00:01Z",
    updated_at: "2026-06-29T00:00:01Z",
    ...overrides,
  };
}

beforeEach(() => useAnnotationStore.setState({ annotations: new Map() }));
afterEach(cleanup);

describe("BankPanel (Story 3.6, AC #1, #2, #3, #5)", () => {
  it("renders nothing when closed", () => {
    useAnnotationStore.getState().addAnnotation(commentMark("a", "reply"));
    const { container } = render(<BankPanel open={false} docId="doc-1" onJump={vi.fn()} onClose={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the empty state when the doc has no annotations", () => {
    render(<BankPanel open docId="doc-1" onJump={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByTestId("bank-empty").textContent).toBe("No comments yet.");
  });

  it("renders one row per annotation with snippet + page", () => {
    useAnnotationStore.getState().addAnnotation(commentMark("a", "Theorem 1"));
    render(<BankPanel open docId="doc-1" onJump={vi.fn()} onClose={vi.fn()} />);
    const row = screen.getByTestId("bank-row-a");
    expect(row.textContent).toContain("Theorem 1");
    expect(row.textContent).toContain("1");
  });

  it("collapses a two-page group into ONE row (the earliest sibling)", () => {
    useAnnotationStore.getState().addAnnotation(commentMark("a", "note", { group_id: "g1" }));
    useAnnotationStore
      .getState()
      .addAnnotation(commentMark("b", "note", { group_id: "g1", created_at: "2026-06-29T00:00:02Z" }));
    render(<BankPanel open docId="doc-1" onJump={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByTestId("bank-row-a")).toBeTruthy();
    expect(screen.queryByTestId("bank-row-b")).toBeNull();
  });

  it("only lists the current document's marks", () => {
    useAnnotationStore.getState().addAnnotation(commentMark("mine", "note", { doc_id: "doc-1" }));
    useAnnotationStore.getState().addAnnotation(commentMark("other", "note", { doc_id: "doc-2" }));
    render(<BankPanel open docId="doc-1" onJump={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByTestId("bank-row-mine")).toBeTruthy();
    expect(screen.queryByTestId("bank-row-other")).toBeNull();
  });

  it("clicking a row calls onJump with that row's BankItem", () => {
    useAnnotationStore.getState().addAnnotation(commentMark("a", "Theorem 1"));
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
    useAnnotationStore.getState().addAnnotation(commentMark("a", "note"));
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
    fireEvent.click(screen.getByTestId("bank-filter-highlight"));
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
    fireEvent.click(screen.getByTestId("bank-filter-highlight"));
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
    fireEvent.click(screen.getByTestId("bank-filter-memo"));
    expect(screen.getByTestId("bank-row-m1").getAttribute("aria-label")).toBe("Memo, page 1");
  });
});

describe("BankPanel type filter (Story 8.2, AC #1, #2, #3, #4, #5)", () => {
  function seedOneOfEach() {
    const store = useAnnotationStore.getState();
    store.addAnnotation(textMark("highlight1", { type: "highlight", created_at: "2026-06-29T00:00:01Z" }));
    store.addAnnotation(textMark("underline1", { type: "underline", created_at: "2026-06-29T00:00:02Z" }));
    store.addAnnotation({
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
      created_at: "2026-06-29T00:00:03Z",
      updated_at: "2026-06-29T00:00:03Z",
    });
    store.addAnnotation({
      id: "memo1",
      doc_id: "doc-1",
      type: "memo",
      group_id: null,
      anchor: { kind: "rect", page_index: 0, rect: { x0: 0.1, y0: 0.2, x1: 0.3, y1: 0.3 } },
      style: { color: "annotation-pink", stroke_width: null, alpha: null },
      body: "a note",
      created_at: "2026-06-29T00:00:04Z",
      updated_at: "2026-06-29T00:00:04Z",
    });
    store.addAnnotation(commentMark("comment1", "a reply", { created_at: "2026-06-29T00:00:05Z" }));
  }

  it("AC-1: lists all five types once each type is active in the filter", () => {
    seedOneOfEach();
    render(<BankPanel open docId="doc-1" onJump={vi.fn()} onClose={vi.fn()} />);
    for (const type of BANK_FILTER_TYPES.filter((t) => t !== "comment")) {
      fireEvent.click(screen.getByTestId(`bank-filter-${type}`));
    }
    expect(screen.getByTestId("bank-row-highlight1")).toBeTruthy();
    expect(screen.getByTestId("bank-row-underline1")).toBeTruthy();
    expect(screen.getByTestId("bank-row-pen1")).toBeTruthy();
    expect(screen.getByTestId("bank-row-memo1")).toBeTruthy();
    expect(screen.getByTestId("bank-row-comment1")).toBeTruthy();
  });

  it("AC-2: default open shows comments only", () => {
    seedOneOfEach();
    render(<BankPanel open docId="doc-1" onJump={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByTestId("bank-row-comment1")).toBeTruthy();
    expect(screen.queryByTestId("bank-row-highlight1")).toBeNull();
    expect(screen.queryByTestId("bank-row-underline1")).toBeNull();
    expect(screen.queryByTestId("bank-row-pen1")).toBeNull();
    expect(screen.queryByTestId("bank-row-memo1")).toBeNull();
    expect(screen.getByTestId("bank-filter-comment").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("bank-filter-highlight").getAttribute("aria-pressed")).toBe("false");
  });

  it("toggling a type chip reveals that type's rows without hiding the others", () => {
    seedOneOfEach();
    render(<BankPanel open docId="doc-1" onJump={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId("bank-filter-highlight"));
    expect(screen.getByTestId("bank-row-highlight1")).toBeTruthy();
    expect(screen.getByTestId("bank-row-comment1")).toBeTruthy();
    expect(screen.getByTestId("bank-filter-highlight").getAttribute("aria-pressed")).toBe("true");
  });

  it("toggling comment off hides comment rows", () => {
    seedOneOfEach();
    render(<BankPanel open docId="doc-1" onJump={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId("bank-filter-highlight"));
    fireEvent.click(screen.getByTestId("bank-filter-comment"));
    expect(screen.queryByTestId("bank-row-comment1")).toBeNull();
    expect(screen.getByTestId("bank-row-highlight1")).toBeTruthy();
  });

  it("AC-3: comments-only default with no comments in the doc shows the comments empty state", () => {
    useAnnotationStore.getState().addAnnotation(textMark("highlight1", { type: "highlight" }));
    render(<BankPanel open docId="doc-1" onJump={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByTestId("bank-empty").textContent).toBe("No comments yet.");
  });

  it("AC-3: a non-default filter matching nothing shows the generic adaptive empty state", () => {
    seedOneOfEach();
    render(<BankPanel open docId="doc-1" onJump={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId("bank-filter-comment"));
    expect(screen.getByTestId("bank-empty").textContent).toBe("No annotations match this filter.");
  });

  it("filter chips are real, keyboard-operable buttons with aria-pressed", () => {
    render(<BankPanel open docId="doc-1" onJump={vi.fn()} onClose={vi.fn()} />);
    const chip = screen.getByTestId("bank-filter-highlight");
    expect(chip.tagName.toLowerCase()).toBe("button");
    expect(chip.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(chip);
    expect(chip.getAttribute("aria-pressed")).toBe("true");
  });

  it("no filter label contains an em-dash (AC #5)", () => {
    render(<BankPanel open docId="doc-1" onJump={vi.fn()} onClose={vi.fn()} />);
    for (const type of BANK_FILTER_TYPES) {
      const chip = screen.getByTestId(`bank-filter-${type}`);
      expect(chip.getAttribute("aria-label")).not.toContain("—");
      expect(chip.getAttribute("title")).not.toContain("—");
    }
    expect(screen.getByTestId("bank-empty").textContent).not.toContain("—");
  });

  it("AC-4: toggling filter chips never calls any store mutator", () => {
    seedOneOfEach();
    render(<BankPanel open docId="doc-1" onJump={vi.fn()} onClose={vi.fn()} />);
    const setState = vi.spyOn(useAnnotationStore, "setState");
    fireEvent.click(screen.getByTestId("bank-filter-highlight"));
    fireEvent.click(screen.getByTestId("bank-filter-comment"));
    fireEvent.click(screen.getByTestId("bank-filter-pen"));
    expect(setState).not.toHaveBeenCalled();
    setState.mockRestore();
  });

  it("reopening resets the filter back to comments only (AC-2, component stays mounted across close/reopen)", () => {
    seedOneOfEach();
    const onClose = vi.fn();
    const { rerender } = render(<BankPanel open docId="doc-1" onJump={vi.fn()} onClose={onClose} />);
    fireEvent.click(screen.getByTestId("bank-filter-highlight"));
    expect(screen.getByTestId("bank-row-highlight1")).toBeTruthy();

    rerender(<BankPanel open={false} docId="doc-1" onJump={vi.fn()} onClose={onClose} />);
    rerender(<BankPanel open docId="doc-1" onJump={vi.fn()} onClose={onClose} />);

    expect(screen.queryByTestId("bank-row-highlight1")).toBeNull();
    expect(screen.getByTestId("bank-row-comment1")).toBeTruthy();
    expect(screen.getByTestId("bank-filter-comment").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("bank-filter-highlight").getAttribute("aria-pressed")).toBe("false");
  });
});
