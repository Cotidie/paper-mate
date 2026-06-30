// marks.ts — the per-mark descriptor registry (Story 5.0, AC-1 / AD-5). The single
// source for the "branch by annotation kind/type" facts that were re-implemented
// as ad-hoc conditionals across the annotation pipeline. Keyed on the mark `type`
// (AnnotationTool); the canonical geometry `kind` rides each descriptor (AD-5:
// geometry-on-kind, style-on-type). Adding a tool becomes one entry here, not an
// edit to every `if (type === ...)` / `if (kind === ...)` chain.
//
// AD-9-clean: imports only the generated contract type + the zero-import tools
// leaf. No store/anchor/render import, no React — pure data, unit-testable.

import type { Annotation } from "../api/client";
import type { AnnotationTool } from "../tools";

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
  /** Comment: a selected comment shows the floating bubble in `AnnotationLayer`
   *  (recolor + delete there), NOT the generic selection quick-box — so the shared
   *  box is gated off (UX-DR5, Story 2.10 Decision 4). */
  usesBubble: boolean;
  /** The selection quick-box's aria-label for a mark of this tool. */
  ariaLabel: string;
}

/** A per-mark descriptor (AD-5 dispatch key). `kind` is the canonical anchor
 *  geometry a freshly-created mark of this tool gets; `quickBox` is its selection
 *  affordance. (Note: a `highlight`/`comment` can ALSO be `kind=rect` when made by
 *  a region/click gesture — `kind` here is the default-create geometry, while the
 *  render/store layers branch on the LIVE `anchor.kind`. The quick-box spec keys on
 *  `type` only, which is sufficient: pen⟺path, memo⟺rect-memo, so no live-kind
 *  read is needed to pick the rows.) */
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
    quickBox: { strokeWidth: false, alpha: false, size: true, usesBubble: false, ariaLabel: "Memo actions" },
  },
  comment: {
    type: "comment",
    kind: "rect",
    quickBox: { ...NO_ROWS, usesBubble: true, ariaLabel: "Highlight actions" },
  },
};

/** The quick-box spec for a mark (by its `type`). The single source the selection
 *  quick-box reads to decide its rows + label, instead of re-deriving them from
 *  `anchor.kind`/`type` booleans at the call site. */
export function quickBoxSpec(anno: Annotation): QuickBoxSpec {
  return MARK_DESCRIPTORS[anno.type as AnnotationTool].quickBox;
}
