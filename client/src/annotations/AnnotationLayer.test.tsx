import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import AnnotationLayer from "./AnnotationLayer";
import { useAnnotationStore } from "../store";
import type { Annotation } from "../api/client";
import type { PageBox } from "../anchor";

const box: PageBox = { width: 600, height: 800 };

function textMark(id: string, pageIndex: number, docId = "doc-1"): Annotation {
  return {
    id,
    doc_id: docId,
    type: "highlight",
    group_id: null,
    anchor: { kind: "text", page_index: pageIndex, rects: [{ x0: 0.1, y0: 0.1, x1: 0.5, y1: 0.2 }], text: "x" },
    style: { color: "annotation-default", stroke_width: null },
    body: null,
    created_at: "2026-06-29T00:00:00+00:00",
    updated_at: "2026-06-29T00:00:00+00:00",
  };
}

beforeEach(() => useAnnotationStore.setState({ annotations: new Map() }));
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
