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

/** A text mark on page 0 carrying a shared `group_id` (a two-page highlight's
 *  per-page slice; both slices render on this layer in tests to assert grouping). */
function groupMark(id: string, groupId: string, createdAt = "2026-06-29T00:00:00+00:00"): Annotation {
  const m = textMark(id, 0, "doc-1", createdAt);
  return { ...m, group_id: groupId };
}

/** A pen mark (kind=path) on the given page. */
function penMark(
  id: string,
  pageIndex: number,
  docId = "doc-1",
  createdAt = "2026-06-29T00:00:00+00:00",
): Annotation {
  return {
    id,
    doc_id: docId,
    type: "pen",
    group_id: null,
    anchor: {
      kind: "path",
      page_index: pageIndex,
      points: [
        { x: 0.1, y: 0.1 },
        { x: 0.2, y: 0.15 },
        { x: 0.3, y: 0.2 },
      ],
    },
    style: { color: "annotation-blue", stroke_width: 4 },
    body: null,
    created_at: createdAt,
    updated_at: createdAt,
  };
}

/** A memo mark (kind=rect, type=memo) on the given page. */
function memoMark(
  id: string,
  pageIndex: number,
  body = "",
  docId = "doc-1",
  createdAt = "2026-06-29T00:00:00+00:00",
): Annotation {
  return {
    id,
    doc_id: docId,
    type: "memo",
    group_id: null,
    anchor: { kind: "rect", page_index: pageIndex, rect: { x0: 0.1, y0: 0.2, x1: 0.5, y1: 0.4 } },
    style: { color: "annotation-pink", stroke_width: null },
    body,
    created_at: createdAt,
    updated_at: createdAt,
  };
}

beforeEach(() => useAnnotationStore.setState({ annotations: new Map(), selectedId: null, hoveredId: null }));
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

  it("hover is group-aware: hovering one mark outlines its group sibling too (two-page highlight)", () => {
    // Two annotations sharing a group_id (a two-page highlight). On the page this
    // layer renders, BOTH must outline when the store's hoveredId names either —
    // proving the layer reads the shared store hover + matches by group, so the
    // sibling on another page's layer lights together.
    useAnnotationStore.getState().addAnnotation(
      groupMark("g-a", "grp1"),
    );
    useAnnotationStore.getState().addAnnotation(
      groupMark("g-b", "grp1", "2026-06-29T00:00:01+00:00"),
    );
    render(<AnnotationLayer docId="doc-1" pageIndex={0} box={box} scale={1} />);
    act(() => useAnnotationStore.getState().setHovered("g-a"));
    expect(screen.getByTestId("annotation-mark-g-a").className).toContain("annotation-highlight--hovered");
    expect(screen.getByTestId("annotation-mark-g-b").className).toContain("annotation-highlight--hovered");
    act(() => useAnnotationStore.getState().setHovered(null));
    expect(screen.getByTestId("annotation-mark-g-a").className).not.toContain("annotation-highlight--hovered");
  });

  it("selection is group-aware: the selected mark's group sibling also gets --selected", () => {
    useAnnotationStore.getState().addAnnotation(groupMark("g-a", "grp1"));
    useAnnotationStore.getState().addAnnotation(groupMark("g-b", "grp1", "2026-06-29T00:00:01+00:00"));
    // A non-grouped mark must NOT light up.
    useAnnotationStore.getState().addAnnotation(textMark("solo", 0, "doc-1", "2026-06-29T00:00:02+00:00"));
    render(<AnnotationLayer docId="doc-1" pageIndex={0} box={box} scale={1} />);
    act(() => useAnnotationStore.getState().select("g-a"));
    expect(screen.getByTestId("annotation-mark-g-a").className).toContain("annotation-highlight--selected");
    expect(screen.getByTestId("annotation-mark-g-b").className).toContain("annotation-highlight--selected");
    expect(screen.getByTestId("annotation-mark-solo").className).not.toContain("annotation-highlight--selected");
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

  it("renders a type=underline mark in the underline group with the underline paint class (Story 2.7)", () => {
    const u = { ...textMark("u1", 0), type: "underline" as const, style: { color: "annotation-green", stroke_width: null } };
    useAnnotationStore.getState().addAnnotation(u);
    useAnnotationStore.getState().addAnnotation(textMark("h1", 0)); // a highlight, for contrast
    const { container } = render(<AnnotationLayer docId="doc-1" pageIndex={0} box={box} scale={1} />);

    const mark = screen.getByTestId("annotation-mark-u1");
    // Style-on-type (AD-5): underline paints a line, not a fill.
    expect(mark.className).toContain("annotation-highlight--underline");
    expect(mark.style.borderBottomColor).toBe("var(--color-annotation-green)");
    expect(mark.style.backgroundColor).toBe(""); // no fill
    // It lives in the full-opacity underline group, NOT the 0.4 highlight group.
    expect(container.querySelector(".annotation-underlines")!.contains(mark)).toBe(true);
    expect(container.querySelector(".annotation-highlights")!.contains(mark)).toBe(false);
    // The highlight is unchanged: fill, in the highlight group, no underline class.
    const h = screen.getByTestId("annotation-mark-h1");
    expect(h.className).not.toContain("annotation-highlight--underline");
    expect(h.style.backgroundColor).toBe("var(--color-annotation-default)");
    expect(container.querySelector(".annotation-highlights")!.contains(h)).toBe(true);
  });

  it("an underline mark keeps the 2.5 hit surface: click selects, hover/selected classes apply", () => {
    const u = { ...textMark("u1", 0), type: "underline" as const };
    useAnnotationStore.getState().addAnnotation(u);
    render(<AnnotationLayer docId="doc-1" pageIndex={0} box={box} scale={1} />);
    const mark = screen.getByTestId("annotation-mark-u1");
    fireEvent.click(mark);
    expect(useAnnotationStore.getState().selectedId).toBe("u1");
    act(() => useAnnotationStore.getState().select("u1"));
    expect(screen.getByTestId("annotation-mark-u1").className).toContain("annotation-highlight--selected");
    fireEvent.pointerEnter(screen.getByTestId("annotation-mark-u1"));
    expect(screen.getByTestId("annotation-mark-u1").className).toContain("annotation-highlight--hovered");
  });

  it("renders a kind=path mark as a filled SVG path inside the pen group (Story 2.8)", () => {
    useAnnotationStore.getState().addAnnotation(penMark("p1", 0));
    const { container } = render(<AnnotationLayer docId="doc-1" pageIndex={0} box={box} scale={1} />);
    const mark = screen.getByTestId("annotation-mark-p1");
    expect(mark.tagName.toLowerCase()).toBe("path");
    expect(mark.getAttribute("fill")).toBe("var(--color-annotation-blue)");
    // A non-empty path d (geometry from pen.ts).
    expect((mark.getAttribute("d") ?? "").length).toBeGreaterThan(0);
    // It lives in the pen SVG sheet, not the highlight/underline rect groups.
    expect(container.querySelector(".annotation-pens")!.contains(mark)).toBe(true);
    expect(container.querySelector(".annotation-highlights")!.contains(mark)).toBe(false);
  });

  it("a pen mark is the 2.5 hit surface: click selects, hover/selected classes apply", () => {
    useAnnotationStore.getState().addAnnotation(penMark("p1", 0));
    render(<AnnotationLayer docId="doc-1" pageIndex={0} box={box} scale={1} />);
    const mark = screen.getByTestId("annotation-mark-p1");
    fireEvent.click(mark);
    expect(useAnnotationStore.getState().selectedId).toBe("p1");
    act(() => useAnnotationStore.getState().select("p1"));
    // SVG className is an SVGAnimatedString — read the class attribute as a string.
    expect(screen.getByTestId("annotation-mark-p1").getAttribute("class")).toContain("annotation-pen--selected");
    fireEvent.pointerEnter(screen.getByTestId("annotation-mark-p1"));
    expect(screen.getByTestId("annotation-mark-p1").getAttribute("class")).toContain("annotation-pen--hovered");
  });

  it("does not render the pen group when there are no pen marks", () => {
    useAnnotationStore.getState().addAnnotation(textMark("h1", 0));
    const { container } = render(<AnnotationLayer docId="doc-1" pageIndex={0} box={box} scale={1} />);
    expect(container.querySelector(".annotation-pens")).toBeNull();
  });

  it("renders a type=memo mark as a <textarea> in the memos group, not the highlight/pen groups (Story 2.9)", () => {
    useAnnotationStore.getState().addAnnotation(memoMark("m1", 0, "a note"));
    const { container } = render(<AnnotationLayer docId="doc-1" pageIndex={0} box={box} scale={1} />);
    const mark = screen.getByTestId("annotation-mark-m1");
    expect(mark.tagName.toLowerCase()).toBe("textarea");
    // value reflects body; accent (border) from style.color.
    expect((mark as HTMLTextAreaElement).value).toBe("a note");
    expect(mark.style.borderColor).toBe("var(--color-annotation-pink)");
    // denormalize at scale 1: left=0.1*600=60, top=0.2*800=160, w=0.4*600=240, minHeight=0.2*800=160.
    expect(mark.style.left).toBe("60px");
    expect(mark.style.top).toBe("160px");
    expect(mark.style.width).toBe("240px");
    expect(mark.style.minHeight).toBe("160px");
    // Lives in the memos group, outside the decorative aria-hidden mark groups.
    expect(container.querySelector(".annotation-memos")!.contains(mark)).toBe(true);
    expect(container.querySelector(".annotation-highlights")!.contains(mark)).toBe(false);
  });

  it("a memo re-derives position on zoom (NFR-3)", () => {
    useAnnotationStore.getState().addAnnotation(memoMark("m1", 0));
    const { rerender } = render(<AnnotationLayer docId="doc-1" pageIndex={0} box={box} scale={1} />);
    expect(screen.getByTestId("annotation-mark-m1").style.left).toBe("60px");
    rerender(<AnnotationLayer docId="doc-1" pageIndex={0} box={box} scale={2} />);
    const mark = screen.getByTestId("annotation-mark-m1");
    expect(mark.style.left).toBe("120px");
    expect(mark.style.width).toBe("480px");
  });

  it("a memo is the 2.5 hit surface: click selects, typing writes through retext, selected class applies", () => {
    useAnnotationStore.getState().addAnnotation(memoMark("m1", 0));
    render(<AnnotationLayer docId="doc-1" pageIndex={0} box={box} scale={1} />);
    const mark = screen.getByTestId("annotation-mark-m1");
    fireEvent.click(mark);
    expect(useAnnotationStore.getState().selectedId).toBe("m1");
    fireEvent.change(mark, { target: { value: "typed" } });
    expect(useAnnotationStore.getState().annotations.get("m1")!.body).toBe("typed");
    act(() => useAnnotationStore.getState().select("m1"));
    expect(screen.getByTestId("annotation-mark-m1").className).toContain("annotation-memo--selected");
    fireEvent.pointerEnter(screen.getByTestId("annotation-mark-m1"));
    expect(screen.getByTestId("annotation-mark-m1").className).toContain("annotation-memo--hovered");
  });

  it("Esc inside the memo textarea blurs + clears the selection (Codex MED)", () => {
    useAnnotationStore.getState().addAnnotation(memoMark("m1", 0, "a note"));
    render(<AnnotationLayer docId="doc-1" pageIndex={0} box={box} scale={1} />);
    act(() => useAnnotationStore.getState().select("m1"));
    const mark = screen.getByTestId("annotation-mark-m1") as HTMLTextAreaElement;
    mark.focus();
    fireEvent.keyDown(mark, { key: "Escape" });
    // Selection cleared; the (non-empty) memo survives.
    expect(useAnnotationStore.getState().selectedId).toBeNull();
    expect(useAnnotationStore.getState().annotations.has("m1")).toBe(true);
  });

  it("does not render the memos group when there are no memo marks", () => {
    useAnnotationStore.getState().addAnnotation(textMark("h1", 0));
    const { container } = render(<AnnotationLayer docId="doc-1" pageIndex={0} box={box} scale={1} />);
    expect(container.querySelector(".annotation-memos")).toBeNull();
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

describe("AnnotationLayer comment (Story 2.10 — AC1,2,4,6)", () => {
  /** A kind=text comment (drag) on page 0. */
  function textComment(id: string, body = "", color = "annotation-default"): Annotation {
    return {
      id,
      doc_id: "doc-1",
      type: "comment",
      group_id: null,
      anchor: { kind: "text", page_index: 0, rects: [{ x0: 0.1, y0: 0.1, x1: 0.5, y1: 0.2 }], text: "x" },
      style: { color, stroke_width: null },
      body,
      created_at: "2026-06-29T00:00:01+00:00",
      updated_at: "2026-06-29T00:00:01+00:00",
    };
  }
  /** A kind=rect comment (click) on page 0 — a point anchor. */
  function rectComment(id: string, body = "", color = "annotation-default"): Annotation {
    return {
      id,
      doc_id: "doc-1",
      type: "comment",
      group_id: null,
      anchor: { kind: "rect", page_index: 0, rect: { x0: 0.2, y0: 0.3, x1: 0.2, y1: 0.3 } },
      style: { color, stroke_width: null },
      body,
      created_at: "2026-06-29T00:00:01+00:00",
      updated_at: "2026-06-29T00:00:01+00:00",
    };
  }

  it("a kind=text comment paints a FILL in .annotation-highlights AND a pin in the NOT-aria-hidden .annotation-comments group", () => {
    useAnnotationStore.getState().addAnnotation(textComment("c1", "", "annotation-pink"));
    const { container } = render(<AnnotationLayer docId="doc-1" pageIndex={0} box={box} scale={1} />);
    // The free highlight fill (type !== underline) lives in the highlight group.
    const fill = screen.getByTestId("annotation-mark-c1");
    expect(container.querySelector(".annotation-highlights")!.contains(fill)).toBe(true);
    expect(fill.style.backgroundColor).toBe("var(--color-annotation-pink)");
    // The pin lives in the comments group, OUTSIDE the aria-hidden mark sheet.
    const pin = screen.getByTestId("annotation-comment-pin-c1");
    expect(pin.tagName.toLowerCase()).toBe("button");
    const group = container.querySelector(".annotation-comments")!;
    expect(group.contains(pin)).toBe(true);
    expect(group.getAttribute("aria-hidden")).toBeNull();
    expect(pin.style.backgroundColor).toBe("var(--color-annotation-pink)");
  });

  it("a kind=rect comment paints ONLY a pin (no fill)", () => {
    useAnnotationStore.getState().addAnnotation(rectComment("c2"));
    const { container } = render(<AnnotationLayer docId="doc-1" pageIndex={0} box={box} scale={1} />);
    expect(screen.getByTestId("annotation-comment-pin-c2")).toBeTruthy();
    // No fill mark for a rect comment (it never enters the highlight group, which
    // renders but stays empty).
    expect(screen.queryByTestId("annotation-mark-c2")).toBeNull();
    expect(container.querySelector(".annotation-highlights")!.children).toHaveLength(0);
  });

  it("clicking the pin selects the comment; selecting renders the bubble with value=body", () => {
    useAnnotationStore.getState().addAnnotation(rectComment("c3", "a note"));
    render(<AnnotationLayer docId="doc-1" pageIndex={0} box={box} scale={1} />);
    fireEvent.click(screen.getByTestId("annotation-comment-pin-c3"));
    expect(useAnnotationStore.getState().selectedId).toBe("c3");
    const body = screen.getByTestId("comment-body-c3") as HTMLTextAreaElement;
    expect(body.tagName.toLowerCase()).toBe("textarea");
    expect(body.value).toBe("a note");
  });

  it("typing in the bubble writes body through retextAnnotation; recolor + delete fire", () => {
    useAnnotationStore.getState().addAnnotation(rectComment("c4", "", "annotation-default"));
    render(<AnnotationLayer docId="doc-1" pageIndex={0} box={box} scale={1} />);
    act(() => useAnnotationStore.getState().select("c4"));
    fireEvent.change(screen.getByTestId("comment-body-c4"), { target: { value: "typed" } });
    expect(useAnnotationStore.getState().annotations.get("c4")!.body).toBe("typed");
    // Recolor tints the comment (fill + pin) AND sets the default (last-choice-wins).
    fireEvent.click(screen.getByTestId("color-swatch-annotation-green"));
    expect(useAnnotationStore.getState().annotations.get("c4")!.style.color).toBe("annotation-green");
    expect(useAnnotationStore.getState().activeColor).toBe("annotation-green");
    // Delete removes the comment.
    fireEvent.click(screen.getByTestId("comment-delete-c4"));
    expect(useAnnotationStore.getState().annotations.has("c4")).toBe(false);
  });

  it("the pin re-derives position on zoom (NFR-3)", () => {
    useAnnotationStore.getState().addAnnotation(textComment("c5"));
    const { rerender } = render(<AnnotationLayer docId="doc-1" pageIndex={0} box={box} scale={1} />);
    // first rect start: 0.1*600=60, 0.1*800=80
    expect(screen.getByTestId("annotation-comment-pin-c5").style.left).toBe("60px");
    rerender(<AnnotationLayer docId="doc-1" pageIndex={0} box={box} scale={2} />);
    expect(screen.getByTestId("annotation-comment-pin-c5").style.left).toBe("120px");
  });

  it("a non-selected comment renders no bubble; an empty comment is NOT auto-removed by the layer", () => {
    useAnnotationStore.getState().addAnnotation(rectComment("c6", ""));
    render(<AnnotationLayer docId="doc-1" pageIndex={0} box={box} scale={1} />);
    expect(screen.queryByTestId("comment-body-c6")).toBeNull();
    // The layer only renders; it never deletes. The empty comment stays.
    expect(useAnnotationStore.getState().annotations.has("c6")).toBe(true);
  });

  it("does not render the comments group when there are no comment marks", () => {
    useAnnotationStore.getState().addAnnotation(textMark("h1", 0));
    const { container } = render(<AnnotationLayer docId="doc-1" pageIndex={0} box={box} scale={1} />);
    expect(container.querySelector(".annotation-comments")).toBeNull();
  });
});
