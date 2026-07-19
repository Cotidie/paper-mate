import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import CommentBubble from "./CommentBubble";
import type { Annotation } from "@/api/client";
import type { ScreenRect } from "@/anchor";

function comment(id: string, body = ""): Annotation {
  return {
    id,
    doc_id: "doc-1",
    type: "comment",
    group_id: null,
    anchor: { kind: "rect", page_index: 0, rect: { x0: 0.2, y0: 0.3, x1: 0.2, y1: 0.3 } },
    style: { color: "annotation-default", stroke_width: null, alpha: null },
    body,
    created_at: "2026-06-29T00:00:00+00:00",
    updated_at: "2026-06-29T00:00:00+00:00",
  };
}

/** A `kind=text` (drag-selected) comment, unlike `comment()`'s degenerate
 *  click-placed pin (`kind=rect`, zero-area) — the color toggle is only
 *  present for this kind (fix request: a pin has nothing to tint). */
function textComment(id: string, body = ""): Annotation {
  return { ...comment(id, body), anchor: { kind: "text", page_index: 0, rects: [{ x0: 0.1, y0: 0.1, x1: 0.5, y1: 0.2 }], text: "x" } };
}

const pos: ScreenRect = { left: 100, top: 100, width: 0, height: 0 };
function noop() {}

/** Matches CommentBubble's PIN_OFFSET_TRANSFORM — the base "nudge below the
 *  pin" transform the drag offset is layered on top of. */
const PIN_OFFSET_TRANSFORM = "translateY(calc(var(--comment-pin-size) + var(--space-xxs)))";

function renderBubble(
  id: string,
  overrides: Partial<{
    onDelete: () => void;
    onClearSelection: () => void;
    onResize: (size: { width: number; height: number }) => void;
    onReposition: (offset: { x: number; y: number }) => void;
    onRecolor: (color: string) => void;
    onTextBlur: () => void;
    anno: Annotation;
    scale: number;
  }> = {},
) {
  return render(
    <CommentBubble
      anno={overrides.anno ?? comment(id)}
      pos={pos}
      onRetext={noop}
      onRecolor={overrides.onRecolor ?? noop}
      onConvertToHighlight={noop}
      onDelete={overrides.onDelete ?? noop}
      onClearSelection={overrides.onClearSelection ?? noop}
      onResize={overrides.onResize ?? noop}
      onReposition={overrides.onReposition ?? noop}
      onTextBlur={overrides.onTextBlur ?? noop}
      scale={overrides.scale}
    />,
  );
}

describe("CommentBubble resize (corner-handle, user feature request)", () => {
  it("dragging the corner handle grows the bubble from its persisted size and commits the final size on release", () => {
    const onResize = vi.fn();
    const anno = { ...comment("c6"), style: { ...comment("c6").style, bubble_width: 220, bubble_height: 100 } };
    renderBubble("c6", { onResize, anno });
    const handle = screen.getByTestId("comment-bubble-resize-c6");
    const bubble = screen.getByTestId("comment-bubble-c6");
    fireEvent.pointerDown(handle, { clientX: 300, clientY: 300, button: 0 });
    fireEvent.pointerMove(handle, { clientX: 350, clientY: 340 });
    // The live preview is applied immediately (before release).
    expect(bubble.style.width).toBe("270px");
    expect(bubble.style.height).toBe("140px");
    fireEvent.pointerUp(handle, { clientX: 350, clientY: 340 });
    expect(onResize).toHaveBeenCalledWith({ width: 270, height: 140 });
  });

  it("clamps a shrink drag to the minimum bubble size", () => {
    const onResize = vi.fn();
    const anno = { ...comment("c7"), style: { ...comment("c7").style, bubble_width: 220, bubble_height: 100 } };
    renderBubble("c7", { onResize, anno });
    const handle = screen.getByTestId("comment-bubble-resize-c7");
    fireEvent.pointerDown(handle, { clientX: 300, clientY: 300, button: 0 });
    fireEvent.pointerMove(handle, { clientX: 50, clientY: 50 });
    fireEvent.pointerUp(handle, { clientX: 50, clientY: 50 });
    expect(onResize).toHaveBeenCalledWith({ width: 140, height: 94 });
  });

  it("dragging the corner handle does NOT also move the bubble (excluded like the other buttons)", () => {
    renderBubble("c8");
    const bubble = screen.getByTestId("comment-bubble-c8");
    const handle = screen.getByTestId("comment-bubble-resize-c8");
    fireEvent.pointerDown(handle, { clientX: 300, clientY: 300, button: 0 });
    fireEvent.pointerMove(bubble, { clientX: 350, clientY: 340 });
    fireEvent.pointerUp(bubble, { clientX: 350, clientY: 340 });
    expect(bubble.style.transform).toBe(`${PIN_OFFSET_TRANSFORM} translate(0px, 0px)`);
  });
});

describe("CommentBubble drag (movable comment box)", () => {
  it("dragging the bubble's own empty padding offsets it via transform (live preview, mirrors the resize handle's draft-vs-committed shape)", () => {
    const onReposition = vi.fn();
    renderBubble("c1", { onReposition });
    const bubble = screen.getByTestId("comment-bubble-c1");
    fireEvent.pointerDown(bubble, { clientX: 200, clientY: 200, button: 0 });
    fireEvent.pointerMove(bubble, { clientX: 230, clientY: 215 });
    // The live preview is applied immediately (before release) — mirrors the
    // resize handle's own "live preview, commit on release" test shape.
    expect(bubble.style.transform).toBe(`${PIN_OFFSET_TRANSFORM} translate(30px, 15px)`);
    fireEvent.pointerUp(bubble, { clientX: 230, clientY: 215 });
    expect(onReposition).toHaveBeenCalledWith({ x: 30, y: 15 });
  });

  it("dragging from the textarea does NOT move the bubble (only empty padding drags)", () => {
    renderBubble("c2");
    const bubble = screen.getByTestId("comment-bubble-c2");
    const textarea = screen.getByTestId("comment-body-c2");
    fireEvent.pointerDown(textarea, { clientX: 200, clientY: 200, button: 0 });
    fireEvent.pointerMove(bubble, { clientX: 230, clientY: 215 });
    fireEvent.pointerUp(bubble, { clientX: 230, clientY: 215 });
    expect(bubble.style.transform).toBe(`${PIN_OFFSET_TRANSFORM} translate(0px, 0px)`);
  });

  it("dragging from an action button (e.g. delete) does NOT move the bubble", () => {
    renderBubble("c5");
    const bubble = screen.getByTestId("comment-bubble-c5");
    const deleteButton = screen.getByTestId("comment-delete-c5");
    fireEvent.pointerDown(deleteButton, { clientX: 200, clientY: 200, button: 0 });
    fireEvent.pointerMove(bubble, { clientX: 230, clientY: 215 });
    fireEvent.pointerUp(bubble, { clientX: 230, clientY: 215 });
    expect(bubble.style.transform).toBe(`${PIN_OFFSET_TRANSFORM} translate(0px, 0px)`);
  });

  it("a fresh mount with NO persisted offset starts at zero (legacy fallback)", () => {
    const onReposition = vi.fn();
    const { unmount } = renderBubble("c3", { onReposition });
    const bubble = screen.getByTestId("comment-bubble-c3");
    fireEvent.pointerDown(bubble, { clientX: 200, clientY: 200, button: 0 });
    fireEvent.pointerMove(bubble, { clientX: 260, clientY: 260 });
    expect(bubble.style.transform).toBe(`${PIN_OFFSET_TRANSFORM} translate(60px, 60px)`);
    fireEvent.pointerUp(bubble, { clientX: 260, clientY: 260 });
    expect(onReposition).toHaveBeenCalledWith({ x: 60, y: 60 });
    unmount();
    renderBubble("c3");
    expect(screen.getByTestId("comment-bubble-c3").style.transform).toBe(`${PIN_OFFSET_TRANSFORM} translate(0px, 0px)`);
  });

  it("reflects a store-driven change (e.g. undo) WHILE the bubble stays open, not just on the next mount", () => {
    // Regression test for a real bug found in live smoke (Story 10.5): the
    // drag offset must not be a plain useState mirror frozen at mount, or an
    // undo (or any other external revert) while the SAME bubble instance
    // stays open would render a stale position until the box is closed and
    // reopened. Mirrors the resize handle's draft-vs-committed shape so a
    // prop change (not just a local drag) is picked up immediately.
    const anno = comment("c19");
    const { rerender } = render(
      <CommentBubble
        anno={anno}
        pos={pos}
        onRetext={noop}
        onRecolor={noop}
        onConvertToHighlight={noop}
        onDelete={noop}
        onClearSelection={noop}
        onResize={noop}
        onReposition={noop}
      />,
    );
    const bubble = screen.getByTestId("comment-bubble-c19");
    fireEvent.pointerDown(bubble, { clientX: 200, clientY: 200, button: 0 });
    fireEvent.pointerMove(bubble, { clientX: 240, clientY: 220 });
    expect(bubble.style.transform).toBe(`${PIN_OFFSET_TRANSFORM} translate(40px, 20px)`);
    fireEvent.pointerUp(bubble, { clientX: 240, clientY: 220 });
    // Simulate the store reverting the offset (e.g. an undo) while the bubble
    // stays mounted: the SAME component instance re-renders with a NEW `anno`
    // whose style no longer carries the moved offset.
    rerender(
      <CommentBubble
        anno={{ ...anno, style: { ...anno.style, bubble_offset_x: undefined, bubble_offset_y: undefined } }}
        pos={pos}
        onRetext={noop}
        onRecolor={noop}
        onConvertToHighlight={noop}
        onDelete={noop}
        onClearSelection={noop}
        onResize={noop}
        onReposition={noop}
      />,
    );
    expect(screen.getByTestId("comment-bubble-c19").style.transform).toBe(`${PIN_OFFSET_TRANSFORM} translate(0px, 0px)`);
  });

  it("a fresh mount WITH a persisted bubble_offset_x/y renders at that offset immediately, no drag needed (Story 10.5)", () => {
    const anno = { ...comment("c14"), style: { ...comment("c14").style, bubble_offset_x: 40, bubble_offset_y: -8 } };
    renderBubble("c14", { anno });
    expect(screen.getByTestId("comment-bubble-c14").style.transform).toBe(`${PIN_OFFSET_TRANSFORM} translate(40px, -8px)`);
  });

  it("a persisted offset rescales with the CURRENT zoom (fix request: the offset is stored scale-1.0-independent, mirrors normalizeRect/denormalizeRect) — was a fixed px amount regardless of zoom, reading as detached from its anchor", () => {
    const anno = { ...comment("c14b"), style: { ...comment("c14b").style, bubble_offset_x: 40, bubble_offset_y: -8 } };
    renderBubble("c14b", { anno, scale: 2 });
    expect(screen.getByTestId("comment-bubble-c14b").style.transform).toBe(`${PIN_OFFSET_TRANSFORM} translate(80px, -16px)`);
  });
});

describe("CommentBubble reposition commit (persisted position, Story 10.5)", () => {
  it("dragging past BUBBLE_MOVE_SLOP and releasing commits the final offset via onReposition", () => {
    const onReposition = vi.fn();
    renderBubble("c15", { onReposition });
    const bubble = screen.getByTestId("comment-bubble-c15");
    fireEvent.pointerDown(bubble, { clientX: 200, clientY: 200, button: 0 });
    fireEvent.pointerMove(bubble, { clientX: 230, clientY: 215 });
    fireEvent.pointerUp(bubble, { clientX: 230, clientY: 215 });
    expect(onReposition).toHaveBeenCalledTimes(1);
    expect(onReposition).toHaveBeenCalledWith({ x: 30, y: 15 });
  });

  it("commits the offset DIVIDED by the current zoom (fix request: persists scale-1.0-independent px, not raw viewport px)", () => {
    const onReposition = vi.fn();
    renderBubble("c15b", { onReposition, scale: 2 });
    const bubble = screen.getByTestId("comment-bubble-c15b");
    fireEvent.pointerDown(bubble, { clientX: 200, clientY: 200, button: 0 });
    fireEvent.pointerMove(bubble, { clientX: 260, clientY: 230 });
    fireEvent.pointerUp(bubble, { clientX: 260, clientY: 230 });
    // Dragged 60/30 raw px at scale=2 -> persisted as 30/15 (scale-1.0-equivalent).
    expect(onReposition).toHaveBeenCalledWith({ x: 30, y: 15 });
  });

  it("a sub-slop press-and-jiggle (click) commits nothing — no onReposition call", () => {
    const onReposition = vi.fn();
    renderBubble("c16", { onReposition });
    const bubble = screen.getByTestId("comment-bubble-c16");
    fireEvent.pointerDown(bubble, { clientX: 200, clientY: 200, button: 0 });
    fireEvent.pointerMove(bubble, { clientX: 202, clientY: 201 }); // within BUBBLE_MOVE_SLOP (5px)
    fireEvent.pointerUp(bubble, { clientX: 202, clientY: 201 });
    expect(onReposition).not.toHaveBeenCalled();
  });

  it("dragging from the textarea/an action button never calls onReposition (the drag never starts)", () => {
    const onReposition = vi.fn();
    renderBubble("c17", { onReposition });
    const textarea = screen.getByTestId("comment-body-c17");
    fireEvent.pointerDown(textarea, { clientX: 200, clientY: 200, button: 0 });
    fireEvent.pointerMove(screen.getByTestId("comment-bubble-c17"), { clientX: 260, clientY: 260 });
    fireEvent.pointerUp(screen.getByTestId("comment-bubble-c17"), { clientX: 260, clientY: 260 });
    expect(onReposition).not.toHaveBeenCalled();
  });

  it("resize (corner handle) does NOT also commit a reposition", () => {
    const onReposition = vi.fn();
    const onResize = vi.fn();
    const anno = { ...comment("c18"), style: { ...comment("c18").style, bubble_width: 220, bubble_height: 100 } };
    renderBubble("c18", { onReposition, onResize, anno });
    const handle = screen.getByTestId("comment-bubble-resize-c18");
    fireEvent.pointerDown(handle, { clientX: 300, clientY: 300, button: 0 });
    fireEvent.pointerMove(handle, { clientX: 350, clientY: 340 });
    fireEvent.pointerUp(handle, { clientX: 350, clientY: 340 });
    expect(onResize).toHaveBeenCalledWith({ width: 270, height: 140 });
    expect(onReposition).not.toHaveBeenCalled();
  });

  it("blurs the auto-focused textarea when a padding drag STARTS (Codex HIGH fix): ends any active text-edit session before the reposition commits, so it lands as its own undoable step instead of merging with useTextEditSession's paused zundo window", () => {
    const onTextBlur = vi.fn();
    renderBubble("c20", { onTextBlur });
    const bubble = screen.getByTestId("comment-bubble-c20");
    expect(onTextBlur).not.toHaveBeenCalled();
    fireEvent.pointerDown(bubble, { clientX: 200, clientY: 200, button: 0 });
    expect(onTextBlur).toHaveBeenCalledTimes(1);
  });

  it("commits a real drag on release even with NO intervening pointermove event (Codex MED fix): a fast flick or a down+up-only dispatch is not mistaken for a click", () => {
    const onReposition = vi.fn();
    renderBubble("c21", { onReposition });
    const bubble = screen.getByTestId("comment-bubble-c21");
    fireEvent.pointerDown(bubble, { clientX: 200, clientY: 200, button: 0 });
    // No pointerMove at all — release straight past the slop.
    fireEvent.pointerUp(bubble, { clientX: 240, clientY: 220 });
    expect(onReposition).toHaveBeenCalledWith({ x: 40, y: 20 });
  });

  it("a second pointer's move/up cannot hijack an in-progress drag from a different pointer (Codex LOW fix)", () => {
    const onReposition = vi.fn();
    renderBubble("c22", { onReposition });
    const bubble = screen.getByTestId("comment-bubble-c22");
    fireEvent.pointerDown(bubble, { clientX: 200, clientY: 200, button: 0, pointerId: 1 });
    fireEvent.pointerMove(bubble, { clientX: 500, clientY: 500, pointerId: 2 }); // a different pointer
    fireEvent.pointerUp(bubble, { clientX: 500, clientY: 500, pointerId: 2 }); // a different pointer
    expect(onReposition).not.toHaveBeenCalled();
    // The ORIGINAL pointer can still finish its own drag afterward.
    fireEvent.pointerMove(bubble, { clientX: 230, clientY: 215, pointerId: 1 });
    fireEvent.pointerUp(bubble, { clientX: 230, clientY: 215, pointerId: 1 });
    expect(onReposition).toHaveBeenCalledWith({ x: 30, y: 15 });
  });

  it("pointercancel rolls back to the committed offset without calling onReposition (Codex LOW test gap)", () => {
    const onReposition = vi.fn();
    const anno = { ...comment("c23"), style: { ...comment("c23").style, bubble_offset_x: 10, bubble_offset_y: 5 } };
    renderBubble("c23", { onReposition, anno });
    const bubble = screen.getByTestId("comment-bubble-c23");
    fireEvent.pointerDown(bubble, { clientX: 200, clientY: 200, button: 0 });
    fireEvent.pointerMove(bubble, { clientX: 260, clientY: 260 });
    expect(bubble.style.transform).toBe(`${PIN_OFFSET_TRANSFORM} translate(70px, 65px)`); // live preview: 10+60, 5+60
    fireEvent.pointerCancel(bubble);
    expect(bubble.style.transform).toBe(`${PIN_OFFSET_TRANSFORM} translate(10px, 5px)`); // rolled back to committed
    expect(onReposition).not.toHaveBeenCalled();
  });
});

describe("CommentBubble keyboard (Esc/Delete, bug fix)", () => {
  it("Delete on the auto-focused textarea deletes the comment (the reported bug: pressing Del right after selecting a comment did nothing)", () => {
    const onDelete = vi.fn();
    renderBubble("c6", { onDelete });
    const textarea = screen.getByTestId("comment-body-c6");
    fireEvent.keyDown(textarea, { key: "Delete" });
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("Delete on a focused action button (e.g. the delete button itself) also deletes the comment", () => {
    const onDelete = vi.fn();
    renderBubble("c7", { onDelete });
    const deleteButton = screen.getByTestId("comment-delete-c7");
    fireEvent.keyDown(deleteButton, { key: "Delete" });
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("Escape still clears the selection from the textarea (no regression)", () => {
    const onClearSelection = vi.fn();
    renderBubble("c8", { onClearSelection });
    const textarea = screen.getByTestId("comment-body-c8");
    fireEvent.keyDown(textarea, { key: "Escape" });
    expect(onClearSelection).toHaveBeenCalledTimes(1);
  });

  it("other keys (e.g. a regular character) do not trigger delete", () => {
    const onDelete = vi.fn();
    renderBubble("c9", { onDelete });
    const textarea = screen.getByTestId("comment-body-c9");
    fireEvent.keyDown(textarea, { key: "a" });
    expect(onDelete).not.toHaveBeenCalled();
  });
});

describe("CommentBubble compact mode (box comment popup layout, fix request)", () => {
  it("renders no convert or delete button when compact", () => {
    render(
      <CommentBubble
        anno={comment("c10")}
        pos={pos}
        onRetext={noop}
        onRecolor={noop}
        onConvertToHighlight={noop}
        onDelete={noop}
        onClearSelection={noop}
        onResize={noop}
        onReposition={noop}
        compact
      />,
    );
    expect(screen.queryByTestId("comment-delete-c10")).toBeNull();
    expect(screen.queryByTestId("comment-convert-highlight-c10")).toBeNull();
    // The textarea and the resize handle are still there.
    expect(screen.getByTestId("comment-body-c10")).toBeTruthy();
    expect(screen.getByTestId("comment-bubble-resize-c10")).toBeTruthy();
  });

  it("renders at pos.left/pos.top with NO pin-offset transform when besideAnchor (always true alongside compact in production)", () => {
    renderBubble("c11");
    const nonCompact = screen.getByTestId("comment-bubble-c11");
    expect(nonCompact.style.transform).toContain("translateY(calc(var(--comment-pin-size)");
    cleanup();

    render(
      <CommentBubble
        anno={comment("c12")}
        pos={pos}
        onRetext={noop}
        onRecolor={noop}
        onConvertToHighlight={noop}
        onDelete={noop}
        onClearSelection={noop}
        onResize={noop}
        onReposition={noop}
        compact
        besideAnchor
      />,
    );
    const bubble = screen.getByTestId("comment-bubble-c12");
    expect(bubble.style.left).toBe("100px");
    expect(bubble.style.top).toBe("100px");
    expect(bubble.style.transform).toBe("translate(0px, 0px)");
  });

  it("a non-compact (or omitted) bubble is unchanged: delete is present", () => {
    renderBubble("c13");
    expect(screen.getByTestId("comment-delete-c13")).toBeTruthy();
  });
});

describe("CommentBubble collapsible color toggle (design request)", () => {
  it("starts collapsed: the color toggle shows but the swatch row does not", () => {
    renderBubble("c30", { anno: textComment("c30") });
    expect(screen.getByTestId("comment-color-toggle-c30")).toBeTruthy();
    expect(screen.queryByTestId("color-swatch-annotation-default")).toBeNull();
  });

  it("clicking the color toggle expands the full swatch row", () => {
    renderBubble("c31", { anno: textComment("c31") });
    fireEvent.click(screen.getByTestId("comment-color-toggle-c31"));
    expect(screen.getByTestId("color-swatch-annotation-default")).toBeTruthy();
    expect(screen.getByTestId("color-swatch-annotation-blue")).toBeTruthy();
  });

  it("picking a swatch calls onRecolor and collapses the row again", () => {
    const onRecolor = vi.fn();
    renderBubble("c32", { onRecolor, anno: textComment("c32") });
    fireEvent.click(screen.getByTestId("comment-color-toggle-c32"));
    fireEvent.click(screen.getByTestId("color-swatch-annotation-green"));
    expect(onRecolor).toHaveBeenCalledWith("annotation-green");
    expect(screen.queryByTestId("color-swatch-annotation-green")).toBeNull();
  });

  it("re-clicking the current (armed) color collapses the row without recoloring", () => {
    const onRecolor = vi.fn();
    renderBubble("c33", { onRecolor, anno: textComment("c33") });
    fireEvent.click(screen.getByTestId("comment-color-toggle-c33"));
    expect(screen.getByTestId("color-swatch-annotation-default")).toBeTruthy();
    // The expanded row has no separate toggle button; re-clicking the armed
    // (current) swatch dismisses it without recoloring.
    fireEvent.click(screen.getByTestId("color-swatch-annotation-default"));
    expect(screen.queryByTestId("color-swatch-annotation-default")).toBeNull();
    expect(onRecolor).not.toHaveBeenCalled();
  });

  it("fix request: a plain click-placed PIN comment (kind=rect, degenerate) never shows the color toggle — nothing to tint", () => {
    renderBubble("c30b");
    expect(screen.queryByTestId("comment-color-toggle-c30b")).toBeNull();
    // Convert (text-only) is also absent, but delete stays.
    expect(screen.queryByTestId("comment-convert-highlight-c30b")).toBeNull();
    expect(screen.getByTestId("comment-delete-c30b")).toBeTruthy();
  });

  it("keeps convert + delete visible while the swatch row is expanded (fix request: color is at the LEFT, row grows rightward into the middle, not over them)", () => {
    const textAnno: Annotation = {
      ...comment("c35"),
      anchor: { kind: "text", page_index: 0, rects: [{ x0: 0.1, y0: 0.1, x1: 0.5, y1: 0.2 }], text: "x" },
    };
    renderBubble("c35", { anno: textAnno });
    // The color control is the FIRST child (left); convert + delete sit in the
    // right group, after it in DOM order.
    const toggle = screen.getByTestId("comment-color-toggle-c35");
    const del = screen.getByTestId("comment-delete-c35");
    expect(toggle.compareDocumentPosition(del) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(toggle);
    // Expanded: convert AND delete stay visible (no longer hidden).
    expect(screen.getByTestId("comment-convert-highlight-c35")).toBeTruthy();
    expect(screen.getByTestId("comment-delete-c35")).toBeTruthy();
    // The swatch row is the first child, before the right-pinned group.
    expect(
      screen.getByTestId("color-swatch-annotation-default").compareDocumentPosition(del) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("does not render the color toggle when compact (box comments recolor via the shared quick-box)", () => {
    render(
      <CommentBubble
        anno={comment("c34")}
        pos={pos}
        onRetext={noop}
        onRecolor={noop}
        onConvertToHighlight={noop}
        onDelete={noop}
        onClearSelection={noop}
        onResize={noop}
        onReposition={noop}
        compact
      />,
    );
    expect(screen.queryByTestId("comment-color-toggle-c34")).toBeNull();
  });
});

describe("CommentBubble live re-anchoring (fix request: survive scroll/zoom)", () => {
  function renderTracking(id: string, getPoint: () => ScreenRect) {
    return render(
      <CommentBubble
        anno={comment(id)}
        pos={getPoint()}
        getScreenPoint={getPoint}
        scale={1}
        onRetext={noop}
        onRecolor={noop}
        onConvertToHighlight={noop}
        onDelete={noop}
        onClearSelection={noop}
        onResize={noop}
        onReposition={noop}
      />,
    );
  }

  it("re-derives its position from the LIVE screen point on scroll (position:fixed must track the pin, which the stale `pos` prop never sees)", () => {
    let point: ScreenRect = { left: 100, top: 100, width: 0, height: 0 };
    renderTracking("c50", () => point);
    const bubble = screen.getByTestId("comment-bubble-c50");
    expect(bubble.style.left).toBe("100px");
    // Canvas scrolls: the pin's live viewport point moves, but no React
    // re-render fires — only the scroll listener can re-anchor the bubble.
    point = { left: 40, top: 30, width: 0, height: 0 };
    fireEvent.scroll(document);
    expect(bubble.style.left).toBe("40px");
    expect(bubble.style.top).toBe("30px");
  });

  it("re-derives its position on window resize too", () => {
    let point: ScreenRect = { left: 100, top: 100, width: 0, height: 0 };
    renderTracking("c51", () => point);
    const bubble = screen.getByTestId("comment-bubble-c51");
    point = { left: 55, top: 66, width: 0, height: 0 };
    fireEvent(window, new Event("resize"));
    expect(bubble.style.left).toBe("55px");
    expect(bubble.style.top).toBe("66px");
  });
});
