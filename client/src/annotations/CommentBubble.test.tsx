import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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

const pos: ScreenRect = { left: 100, top: 100, width: 0, height: 0 };
function noop() {}

/** Matches CommentBubble's PIN_OFFSET_TRANSFORM — the base "nudge below the
 *  pin" transform the drag offset is layered on top of. */
const PIN_OFFSET_TRANSFORM = "translateY(calc(var(--comment-pin-size) + var(--space-xxs)))";

function renderBubble(
  id: string,
  overrides: Partial<{ onDelete: () => void; onClearSelection: () => void }> = {},
) {
  return render(
    <CommentBubble
      anno={comment(id)}
      pos={pos}
      onRetext={noop}
      onRecolor={noop}
      onConvertToHighlight={noop}
      onDelete={overrides.onDelete ?? noop}
      onClearSelection={overrides.onClearSelection ?? noop}
    />,
  );
}

describe("CommentBubble drag (movable comment box)", () => {
  it("dragging the bubble's own empty padding offsets it via transform", () => {
    renderBubble("c1");
    const bubble = screen.getByTestId("comment-bubble-c1");
    fireEvent.pointerDown(bubble, { clientX: 200, clientY: 200, button: 0 });
    fireEvent.pointerMove(bubble, { clientX: 230, clientY: 215 });
    fireEvent.pointerUp(bubble, { clientX: 230, clientY: 215 });
    expect(bubble.style.transform).toBe(`${PIN_OFFSET_TRANSFORM} translate(30px, 15px)`);
  });

  it("dragging the gap between the swatches and the action buttons ALSO moves the bubble (empty space inside a child wrapper, not just the outer padding)", () => {
    const { container } = renderBubble("c4");
    const bubble = screen.getByTestId("comment-bubble-c4");
    const actionsGap = container.querySelector(".comment-bubble__actions") as HTMLElement;
    fireEvent.pointerDown(actionsGap, { clientX: 200, clientY: 200, button: 0 });
    fireEvent.pointerMove(bubble, { clientX: 230, clientY: 215 });
    fireEvent.pointerUp(bubble, { clientX: 230, clientY: 215 });
    expect(bubble.style.transform).toBe(`${PIN_OFFSET_TRANSFORM} translate(30px, 15px)`);
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

  it("a fresh mount always starts at zero offset (temporary — resets when the box reopens)", () => {
    const { unmount } = renderBubble("c3");
    const bubble = screen.getByTestId("comment-bubble-c3");
    fireEvent.pointerDown(bubble, { clientX: 200, clientY: 200, button: 0 });
    fireEvent.pointerMove(bubble, { clientX: 260, clientY: 260 });
    fireEvent.pointerUp(bubble, { clientX: 260, clientY: 260 });
    expect(bubble.style.transform).toBe(`${PIN_OFFSET_TRANSFORM} translate(60px, 60px)`);
    unmount();
    renderBubble("c3");
    expect(screen.getByTestId("comment-bubble-c3").style.transform).toBe(`${PIN_OFFSET_TRANSFORM} translate(0px, 0px)`);
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
