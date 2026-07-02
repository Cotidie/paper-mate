// The transient-overlay state machine (Epic-1 retro PREP-3): designed ONCE here
// so every tool story (2.3–2.9) reuses the same armed-tool / annotating /
// pending-quick-box / empty states rather than re-inventing overlay state.
//
// Story 2.2 exercises the cursor-drag path (no armed tool): empty → annotating
// → pending → (commit|dismiss) → empty. Later stories arm a tool first, so the
// machine carries the armed `tool` through and returns to it after a mark
// (sticky tool).

import type { PageSelection } from "../anchor";
// `AnnotationTool` is defined ONCE in the zero-import `tools.ts` leaf (AD-11) and
// re-exported here so existing `import { AnnotationTool } from "./annotations"`
// sites keep working. Single writer of "which annotation tool is armed": App's
// `activeTool`, mirrored down via the `armedTool` prop and the prop-sync effect
// in AnnotationInteraction — the machine never self-arms (it only carries the
// armed tool through its transient states).
import type { AnnotationTool } from "../lib/tools";

export type { AnnotationTool };

/** Where the quick-box sits — the drag-release point in viewport (fixed) px. */
export interface QuickBoxAt {
  x: number;
  y: number;
}

export type OverlayState =
  | { status: "empty" }
  | { status: "armed"; tool: AnnotationTool }
  | { status: "annotating"; tool: AnnotationTool | null }
  | { status: "pending"; tool: AnnotationTool | null; selection: PageSelection[]; at: QuickBoxAt };

export type OverlayAction =
  | { type: "arm"; tool: AnnotationTool }
  | { type: "disarm" }
  | { type: "begin" }
  | { type: "present"; selection: PageSelection[]; at: QuickBoxAt }
  | { type: "dismiss" }
  | { type: "commit" };

export const initialOverlayState: OverlayState = { status: "empty" };

/** The tool currently in play, across whichever state we're in (`null` = none). */
function currentTool(state: OverlayState): AnnotationTool | null {
  return state.status === "empty" ? null : (state.tool ?? null);
}

/** The resting state a tool returns to after a mark or a dismiss: the armed tool
 *  stays armed (sticky), otherwise empty. */
function rest(tool: AnnotationTool | null): OverlayState {
  return tool ? { status: "armed", tool } : { status: "empty" };
}

export function overlayReducer(state: OverlayState, action: OverlayAction): OverlayState {
  switch (action.type) {
    case "arm":
      return { status: "armed", tool: action.tool };
    case "disarm":
      return { status: "empty" };
    case "begin":
      // A pointer-drag started over the page: enter annotating, carrying any
      // armed tool. Ignored once a quick-box is already pending.
      if (state.status === "pending") return state;
      return { status: "annotating", tool: currentTool(state) };
    case "present":
      // The drag released with a usable selection: pop the quick-box.
      return {
        status: "pending",
        tool: currentTool(state),
        selection: action.selection,
        at: action.at,
      };
    case "commit":
    case "dismiss":
      // Pick or dismiss: fall back to the resting (armed|empty) state.
      return rest(currentTool(state));
    default:
      return state;
  }
}
