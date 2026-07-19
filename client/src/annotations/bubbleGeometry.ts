// bubbleGeometry — the box geometry shared by the comment's two floating
// surfaces, `CommentBubble` (selected, editable) and `CommentPreview` (hover,
// read-only). These drifted into near-twins through Stories 10.5/10.6 (each
// carried its own copy of the pin-nudge transform, the scale-1.0-independent
// offset read, the manual-size read, and the transform composition); Story 10.9
// unifies that math here as a pure, DOM-free leaf both consume. What stays in
// each component is only what genuinely differs: CommentBubble's live drag
// draft + resize draft + scroll/resize re-anchor, CommentPreview's static read.
//
// Dependency-clean (AD-9): imports only `api/` types + React's CSSProperties. No
// coordinate math leaves `anchor/` here — these are viewport/CSS-px chrome
// values (offsets and sizes), not page-fraction anchor geometry.

import type { CSSProperties } from "react";
import type { Annotation } from "@/api/client";

/** Nudges a bubble below its pin (was a static CSS `transform` on
 *  `.comment-bubble`/`.comment-preview`, DESIGN.md tokens unchanged) — inline
 *  because the persisted drag offset shares the same `transform` property, and
 *  only one `transform` can win per element. */
export const PIN_OFFSET_TRANSFORM = "translateY(calc(var(--comment-pin-size) + var(--space-xxs)))";

/** Screen (CSS-px) offset. */
export interface BubbleOffset {
  x: number;
  y: number;
}

/**
 * The committed, persisted drag offset (Story 10.5) rescaled to the CURRENT
 * zoom's CSS px. `bubble_offset_x/y` is stored scale-1.0-independent (mirrors
 * `normalizeRect`/`denormalizeRect`'s divide/multiply-by-scale idiom, AD-4 —
 * every other piece of anchor geometry is scale-independent at rest), so `*
 * scale` yields the current zoom's pixels. Without it, a dragged bubble's gap
 * from its anchor would stay a fixed pixel amount while the anchor itself
 * shrank/grew with the page. CommentBubble overlays a raw-px LIVE `dragDraft`
 * on top of this while actually dragging; the preview reads it directly.
 */
export function committedBubbleOffset(anno: Annotation, scale: number): BubbleOffset {
  return {
    x: (anno.style.bubble_offset_x ?? 0) * scale,
    y: (anno.style.bubble_offset_y ?? 0) * scale,
  };
}

/**
 * The bubble's `transform`: the persisted drag offset, preceded by the below-pin
 * nudge UNLESS `besideAnchor` (the caller has already positioned `pos` beside the
 * anchor — a box comment, or a text-drag comment). Both compose into one string
 * because only one `transform` can win per element.
 */
export function bubbleTransform(offset: BubbleOffset, besideAnchor: boolean): string {
  const translate = `translate(${offset.x}px, ${offset.y}px)`;
  return besideAnchor ? translate : `${PIN_OFFSET_TRANSFORM} ${translate}`;
}

/** A manually corner-resized box size; `null` on an axis means "unset" (the box
 *  keeps its default CSS size and, for height, its auto-grow). */
export interface ManualBubbleSize {
  width: number | null;
  height: number | null;
}

/** The persisted manual box size (Story 10.5 resize handle), or `null` per axis
 *  when never resized. CommentBubble overlays a live `resizeDraft` on top while
 *  dragging the handle; the preview reads the committed values directly. */
export function manualBubbleSize(anno: Annotation): ManualBubbleSize {
  return {
    width: anno.style.bubble_width ?? null,
    height: anno.style.bubble_height ?? null,
  };
}

/** Inline width/height style for a manual size — spread into the element's
 *  `style`; an unset axis contributes nothing (the CSS default wins). */
export function manualSizeStyle(size: ManualBubbleSize): CSSProperties {
  return {
    ...(size.width !== null ? { width: `${size.width}px` } : {}),
    ...(size.height !== null ? { height: `${size.height}px` } : {}),
  };
}
