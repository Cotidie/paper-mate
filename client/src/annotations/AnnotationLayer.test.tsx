import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import AnnotationLayer from "./AnnotationLayer";
import { useAnnotationStore } from "../store";
import type { Annotation } from "../api/client";
import type { PageBox } from "../anchor";

const box: PageBox = { width: 600, height: 800 };

function textMark(
  id: string,
  pageIndex: number,
  docId = "doc-1",
  createdAt = "2026-06-29T00:00:00+00:00",
  rects = [{ x0: 0.1, y0: 0.1, x1: 0.5, y1: 0.2 }],
): Annotation {
  return {
    id,
    doc_id: docId,
    type: "highlight",
    group_id: null,
    anchor: { kind: "text", page_index: pageIndex, rects, text: "x" },
    style: { color: "annotation-default", stroke_width: null },
    body: null,
    created_at: createdAt,
    updated_at: createdAt,
  };
}

beforeEach(() => useAnnotationStore.setState({ annotations: new Map(), selectedId: null }));
afterEach(cleanup);

describe("AnnotationLayer (AC-3, AC-4, AC-6)", () => {
  it("renders a stored text annotation as a positioned highlight mark", () => {
    useAnnotationStore.getState().addAnnotation(textMark("a1", 0));
    render(<AnnotationLayer docId="doc-1" pageIndex={0} box={box} scale={1} />);
    const mark = screen.getByTestId("annotation-mark-a1");
    // denormalize at scale 1: left=0.1*600=60, top=0.1*800=80, w=0.4*600=240, h=0.1*800=80.
    expect(mark.style.left).toBe("60px");
    expect(mark.style.top).toBe("80px");
    expect(mark.style.width).toBe("240px");
    expect(mark.style.height).toBe("80px");
    expect(mark.style.backgroundColor).toBe("var(--color-annotation-default)");
  });

  it("re-derives screen position from the anchor when scale changes (AC-6)", () => {
    useAnnotationStore.getState().addAnnotation(textMark("a1", 0));
    const { rerender } = render(<AnnotationLayer docId="doc-1" pageIndex={0} box={box} scale={1} />);
    expect(screen.getByTestId("annotation-mark-a1").style.left).toBe("60px");
    rerender(<AnnotationLayer docId="doc-1" pageIndex={0} box={box} scale={2} />);
    // Same normalized anchor → exactly doubled at 2x zoom.
    const mark = screen.getByTestId("annotation-mark-a1");
    expect(mark.style.left).toBe("120px");
    expect(mark.style.width).toBe("480px");
  });

  it("only renders annotations anchored to its own page", () => {
    useAnnotationStore.getState().addAnnotation(textMark("p0", 0));
    useAnnotationStore.getState().addAnnotation(textMark("p1", 1));
    render(<AnnotationLayer docId="doc-1" pageIndex={0} box={box} scale={1} />);
    expect(screen.queryByTestId("annotation-mark-p0")).toBeTruthy();
    expect(screen.queryByTestId("annotation-mark-p1")).toBeNull();
  });

  it("does not bleed another document's marks onto a same page index (AC-3/AC-8)", () => {
    useAnnotationStore.getState().addAnnotation(textMark("mine", 0, "doc-1"));
    useAnnotationStore.getState().addAnnotation(textMark("other", 0, "doc-2"));
    render(<AnnotationLayer docId="doc-1" pageIndex={0} box={box} scale={1} />);
    expect(screen.queryByTestId("annotation-mark-mine")).toBeTruthy();
    expect(screen.queryByTestId("annotation-mark-other")).toBeNull();
  });
});

describe("AnnotationLayer selection + hover (Story 2.5 — AC1, AC2, AC3)", () => {
  it("clicking a mark sets it as the selected annotation (select via store)", () => {
    useAnnotationStore.getState().addAnnotation(textMark("a1", 0));
    render(<AnnotationLayer docId="doc-1" pageIndex={0} box={box} scale={1} />);
    fireEvent.click(screen.getByTestId("annotation-mark-a1"));
    expect(useAnnotationStore.getState().selectedId).toBe("a1");
  });

  it("pointer enter/leave toggles the --hovered class on every rect of that annotation", () => {
    // Two rects on one annotation (a multi-line mark) so we prove the WHOLE
    // annotation outlines as one.
    useAnnotationStore.getState().addAnnotation(
      textMark("a1", 0, "doc-1", "2026-06-29T00:00:00+00:00", [
        { x0: 0.1, y0: 0.1, x1: 0.5, y1: 0.2 },
        { x0: 0.1, y0: 0.2, x1: 0.4, y1: 0.3 },
      ]),
    );
    const { container } = render(<AnnotationLayer docId="doc-1" pageIndex={0} box={box} scale={1} />);
    const rects = () => container.querySelectorAll('[data-testid="annotation-mark-a1"]');
    expect(rects()).toHaveLength(2);
    fireEvent.pointerEnter(rects()[0]);
    rects().forEach((r) => expect(r.className).toContain("annotation-highlight--hovered"));
    fireEvent.pointerLeave(rects()[0]);
    rects().forEach((r) => expect(r.className).not.toContain("annotation-highlight--hovered"));
  });

  it("the selectedId annotation's rects get --selected; others do not; clearing removes it", () => {
    useAnnotationStore.getState().addAnnotation(textMark("a1", 0));
    useAnnotationStore.getState().addAnnotation(textMark("a2", 0, "doc-1", "2026-06-29T00:00:01+00:00"));
    render(<AnnotationLayer docId="doc-1" pageIndex={0} box={box} scale={1} />);
    act(() => useAnnotationStore.getState().select("a1"));
    expect(screen.getByTestId("annotation-mark-a1").className).toContain("annotation-highlight--selected");
    expect(screen.getByTestId("annotation-mark-a2").className).not.toContain("annotation-highlight--selected");
    act(() => useAnnotationStore.getState().clearSelection());
    expect(screen.getByTestId("annotation-mark-a1").className).not.toContain("annotation-highlight--selected");
  });

  it("renders marks sorted by created_at (newest last in DOM, recent-wins)", () => {
    useAnnotationStore.getState().addAnnotation(textMark("late", 0, "doc-1", "2026-06-29T00:00:09+00:00"));
    useAnnotationStore.getState().addAnnotation(textMark("early", 0, "doc-1", "2026-06-29T00:00:01+00:00"));
    const { container } = render(<AnnotationLayer docId="doc-1" pageIndex={0} box={box} scale={1} />);
    const ids = [...container.querySelectorAll("[data-testid^='annotation-mark-']")].map(
      (el) => el.getAttribute("data-testid"),
    );
    expect(ids).toEqual(["annotation-mark-early", "annotation-mark-late"]);
  });
});
