// marks.ts — the per-mark descriptor registry (Story 5.0, AC-1 / AD-5). The single
// source for the "branch by annotation kind/type" facts that were re-implemented
// as ad-hoc conditionals across the annotation pipeline. Keyed on the mark `type`
// (AnnotationTool); the canonical geometry `kind` rides each descriptor (AD-5:
// geometry-on-kind, style-on-type). Adding a tool becomes one entry here, not an
// edit to every `if (type === ...)` / `if (kind === ...)` chain.
//
// AD-9-clean: imports only the generated contract type + the zero-import tools
// leaf. No store/anchor/render import, no React — pure data, unit-testable.

import type { Annotation } from "@/api/client";
import type { AnnotationTool } from "@/lib/tools";

/** Which selection quick-box rows a selected mark of a given tool offers, plus the
 *  box's aria-label. Replaces the scattered `isPenSelected` / `isMemoSelected` /
 *  `type === "comment"` exclusion checks in `AnnotationInteraction`. */
export interface QuickBoxSpec {
  /** Pen: the stroke-width row (restroke). */
  strokeWidth: boolean;
  /** Pen: the alpha row (realpha). */
  alpha: boolean;
  /** Memo: the size row (resize). */
  size: boolean;
  /** Comment: a selected TEXT-kind or degenerate-point-pin comment shows the
   *  floating bubble in `AnnotationLayer` (recolor + delete there), NOT the
   *  generic selection quick-box — so the shared box is gated off (UX-DR5,
   *  Story 2.10 Decision 4). EXCEPTION (fix request): a BOX comment (real-area
   *  `kind=rect`, `isBoxComment` below) routes through the shared quick-box
   *  instead, rendered as a left-vertical strip beside the highlight — see
   *  `quickBoxSpec`, which resolves this live-kind exception. */
  usesBubble: boolean;
  /** The selection quick-box's aria-label for a mark of this tool. */
  ariaLabel: string;
}

/** A per-mark descriptor (AD-5 dispatch key). `kind` is the canonical anchor
 *  geometry a freshly-created mark of this tool gets; `quickBox` is its selection
 *  affordance. (Note: a `highlight`/`comment` can ALSO be `kind=rect` when made by
 *  a region/click gesture — `kind` here is the default-create geometry, while the
 *  render/store layers branch on the LIVE `anchor.kind`. The quick-box spec keys on
 *  `type` only for every tool EXCEPT comment (fix request): `quickBoxSpec` below
 *  additionally reads the live anchor for a comment, since a box comment and a
 *  pin/text comment need different `usesBubble` values despite sharing one type.) */
export interface MarkDescriptor {
  type: AnnotationTool;
  kind: "text" | "path" | "rect";
  quickBox: QuickBoxSpec;
}

const NO_ROWS = { strokeWidth: false, alpha: false, size: false, usesBubble: false };

/** The registry: one descriptor per annotation tool (AC-1). */
export const MARK_DESCRIPTORS: Record<AnnotationTool, MarkDescriptor> = {
  highlight: { type: "highlight", kind: "text", quickBox: { ...NO_ROWS, ariaLabel: "Highlight actions" } },
  underline: { type: "underline", kind: "text", quickBox: { ...NO_ROWS, ariaLabel: "Highlight actions" } },
  pen: {
    type: "pen",
    kind: "path",
    quickBox: { strokeWidth: true, alpha: true, size: false, usesBubble: false, ariaLabel: "Pen actions" },
  },
  memo: {
    type: "memo",
    kind: "rect",
    // size:false since Story 3.1 — the preset SizeRow chooser was removed; a memo
    // resizes via the edit frame's corner handles. alpha:true (fix request): the
    // memo's own opacity/tint-strength row, the memo twin of pen's alpha. The
    // quick-box is recolor + alpha + delete.
    quickBox: { strokeWidth: false, alpha: true, size: false, usesBubble: false, ariaLabel: "Memo actions" },
  },
  comment: {
    type: "comment",
    kind: "rect",
    // usesBubble:true here is the DEFAULT (text-kind / degenerate-pin comment);
    // quickBoxSpec below overrides it to false for a box comment (fix request).
    quickBox: { ...NO_ROWS, usesBubble: true, ariaLabel: "Highlight actions" },
  },
};

/** A box comment (Story 8.4 box-comment mode, fix request): a `type=comment`
 *  mark whose LIVE anchor is `kind=rect` with REAL area — as opposed to a
 *  click-placed pin (`buildCommentPin`'s degenerate point rect, `x0===x1 &&
 *  y0===y1` exactly, `COMMENT_CLICK_SLOP`-gated in `useCreateQuickBox.ts`) or a
 *  text-drag comment (`kind=text`). Only a box comment routes its selection
 *  actions through the shared quick-box (left-vertical strip) instead of
 *  `CommentBubble`'s own internal chrome. */
export function isBoxComment(anno: Annotation): boolean {
  return (
    anno.type === "comment" &&
    anno.anchor.kind === "rect" &&
    anno.anchor.rect.x1 > anno.anchor.rect.x0 &&
    anno.anchor.rect.y1 > anno.anchor.rect.y0
  );
}

/** Whether a selected mark's quick-box renders as a LEFT-side vertical strip
 *  (mirrors `MemoBox`'s own left-side action strip) instead of the default
 *  horizontal row below the mark. True for a memo, or a box comment (fix
 *  request) — both have their OWN separate text-entry surface floating beside
 *  the strip, so the strip must never steal focus into itself (`useSelection.ts`
 *  reads this same function for that focus-guard). */
export function usesLeftVerticalQuickBox(anno: Annotation | null): boolean {
  if (!anno || anno.anchor.kind !== "rect") return false;
  return anno.type === "memo" || isBoxComment(anno);
}

/** The quick-box spec for a mark (by its `type`, EXCEPT comment which also
 *  reads the live anchor — see `MarkDescriptor`'s doc comment above). The
 *  single source the selection quick-box reads to decide its rows + label,
 *  instead of re-deriving them from `anchor.kind`/`type` booleans at the call
 *  site. */
export function quickBoxSpec(anno: Annotation): QuickBoxSpec {
  const base = MARK_DESCRIPTORS[anno.type as AnnotationTool].quickBox;
  if (anno.type === "comment") return { ...base, usesBubble: !isBoxComment(anno) };
  return base;
}
