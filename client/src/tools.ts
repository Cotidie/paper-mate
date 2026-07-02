// The single canonical tool model (AD-11). One `ActiveTool` value is the sole
// source of truth for which tool is active across BOTH the pointer tools
// (cursor/hand, which drive pan) and the annotation tools (highlight/…, which
// drive marks). Because there is one field, mutual exclusion is true by
// construction — no second field can hold a stale tool (this replaces the Story
// 2.3 `mode`+`armedTool` pair and its hand-written cross-setter).
//
// Box-highlight (drag a rectangle → region highlight) is NOT a tool value here:
// it is a MODE of the Highlight tool (a `boxHighlight` flag App threads down),
// not a competing tool, so it never breaks the one-active-tool invariant.
//
// This is a ZERO-IMPORT leaf so both the App/ToolRail pointer-tool layer AND the
// annotations/ overlay can import it without an upward dependency (AD-9 layering).
// `annotations/machine.ts` re-exports `AnnotationTool` from here so this file is
// the single definition.

/** The annotation tools (mirror `Annotation.type`); a text-drag lands one. */
export const ANNOTATION_TOOLS = ["highlight", "underline", "pen", "memo", "comment"] as const;
export type AnnotationTool = (typeof ANNOTATION_TOOLS)[number];

/** The pointer tools: cursor reads/selects text, hand pans, boxSelect marquee-
 *  selects multiple existing annotations (a sub-mode of Cursor's flyout, not a
 *  competing top-level tool; user feature request). */
export const POINTER_TOOLS = ["cursor", "hand", "boxSelect"] as const;
export type PointerTool = (typeof POINTER_TOOLS)[number];

/** The one tool that is active. Setting it implicitly disarms the previous. */
export type ActiveTool = PointerTool | AnnotationTool;

/** Membership test used to derive the overlay's armed annotation tool from the
 *  single `activeTool` (annotation tool → carry it; pointer tool → null). */
export function isAnnotationTool(t: ActiveTool): t is AnnotationTool {
  return (ANNOTATION_TOOLS as readonly string[]).includes(t);
}

/** Membership test used to derive the Reader's pan flag and the rail's
 *  pointer-button active styling (`true` for cursor/hand/boxSelect; pan itself
 *  stays gated on exactly `"hand"`, App.tsx computes that separately). */
export function isPointerTool(t: ActiveTool): t is PointerTool {
  return (POINTER_TOOLS as readonly string[]).includes(t);
}
