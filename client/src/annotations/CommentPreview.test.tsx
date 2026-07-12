import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import CommentPreview from "./CommentPreview";
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

function renderPreview(anno: Annotation) {
  return render(
    <CommentPreview
      anno={anno}
      pos={pos}
      hovered={true}
      onRetext={noop}
      onHoverEnter={noop}
      onHoverLeave={noop}
    />,
  );
}

describe("CommentPreview size (Story 8.6: matches the bubble's adjusted full size)", () => {
  it("a resized comment's preview applies its persisted bubble_width/bubble_height and fills the box", () => {
    const anno = { ...comment("p1"), style: { ...comment("p1").style, bubble_width: 320, bubble_height: 200 } };
    renderPreview(anno);
    const box = screen.getByTestId("comment-preview-p1");
    expect(box.style.width).toBe("320px");
    expect(box.style.height).toBe("200px");
    const textarea = screen.getByTestId("comment-preview-body-p1");
    expect(textarea.className).toContain("comment-preview__text--manual-size");
  });

  it("a never-resized comment (both fields null) keeps the compact default: no inline width/height, no manual-size class", () => {
    renderPreview(comment("p2"));
    const box = screen.getByTestId("comment-preview-p2");
    expect(box.style.width).toBe("");
    expect(box.style.height).toBe("");
    const textarea = screen.getByTestId("comment-preview-body-p2");
    expect(textarea.className).not.toContain("comment-preview__text--manual-size");
  });

  it("width-only and height-only null-guards behave independently", () => {
    const widthOnly = { ...comment("p3"), style: { ...comment("p3").style, bubble_width: 300, bubble_height: null } };
    renderPreview(widthOnly);
    const widthBox = screen.getByTestId("comment-preview-p3");
    expect(widthBox.style.width).toBe("300px");
    expect(widthBox.style.height).toBe("");
    expect(screen.getByTestId("comment-preview-body-p3").className).not.toContain("comment-preview__text--manual-size");

    const heightOnly = { ...comment("p4"), style: { ...comment("p4").style, bubble_width: null, bubble_height: 180 } };
    renderPreview(heightOnly);
    const heightBox = screen.getByTestId("comment-preview-p4");
    expect(heightBox.style.width).toBe("");
    expect(heightBox.style.height).toBe("180px");
    expect(screen.getByTestId("comment-preview-body-p4").className).toContain("comment-preview__text--manual-size");
  });

  it("a restored comment (rehydrated style after reload) still reflects the persisted size (AC-2)", () => {
    const restored = { ...comment("p5"), style: { ...comment("p5").style, bubble_width: 280, bubble_height: 150 } };
    renderPreview(restored);
    const box = screen.getByTestId("comment-preview-p5");
    expect(box.style.width).toBe("280px");
    expect(box.style.height).toBe("150px");
  });
});

describe("CommentPreview compact mode (box comment popup layout, fix request)", () => {
  it("renders at pos.left/pos.top with NO pin-offset transform when compact", () => {
    render(
      <CommentPreview
        anno={comment("p10")}
        pos={pos}
        hovered={true}
        onRetext={noop}
        onHoverEnter={noop}
        onHoverLeave={noop}
        compact
      />,
    );
    const box = screen.getByTestId("comment-preview-p10");
    expect(box.style.left).toBe("100px");
    expect(box.style.top).toBe("100px");
    expect(box.style.transform).toBe("");
  });

  it("a non-compact (or omitted) preview keeps the pin-offset transform", () => {
    renderPreview(comment("p11"));
    const box = screen.getByTestId("comment-preview-p11");
    expect(box.style.transform).toContain("translateY(calc(var(--comment-pin-size)");
  });
});
