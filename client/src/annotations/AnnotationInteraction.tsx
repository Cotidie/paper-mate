// AnnotationInteraction — the overlay's interaction layer: composes every
// per-gesture hook (Story 5.0/5.3: pen, box-highlight, memo-placement,
// edit/resize, undo-redo, multi-select, the selected-mark quick-box, and the
// CREATE quick-box's armed-tool/pending machine) and renders the previews +
// the two quick-box menus from what they return.
//
// The shell, position/clamp, focus-in/return, and dismiss-on-pick/outside/Esc
// (plus the `removeAllRanges()` re-pop fix) are the Story 2.2 foundation, now
// owned by `useCreateQuickBox` (Story 5.3). Create timing is keyed off the
// armed tool (`armedTool` prop, single source in App), and BOTH create paths
// land in the SAME selection quick-box (Story 2.5 unification, AD-12):
//   - Highlight armed → the mark LANDS on drag-release at the default color
//     (create-on-release) and is immediately SELECTED → the selection quick-box.
//   - Cursor (no tool) → the Story 2.2 proof: a single "Highlight" action that
//     creates the mark on click, then selects it. (The cursor-mode tool-type
//     picker is Story 2.12.)
//
// Document-level handlers (Epic-1 retro AP-1): pointer/key handlers bind on
// `document`, phase-gated (`enabled`), exempting editable fields + buttons —
// NOT on `.pdf-canvas`. Layering (AD-9): this lives in annotations/, consuming
// anchor/ + store/ only; render/ stays annotation-free (geometry via `getPages`).

import { Highlighter, TextUnderline, ChatCircle, TextT, Trash } from "@phosphor-icons/react";
import type { PageCardRef } from "@/anchor";
import { useAnnotationStore } from "@/store";
import { strokeOutline, svgPathFromOutline } from "./pen";
import type { AnnotationTool } from "./machine";
import type { GestureContext } from "./gestures/shared";
import { usePenGesture } from "./gestures/usePenGesture";
import { useBoxGesture } from "./gestures/useBoxGesture";
import { useMemoPlacement } from "./gestures/useMemoPlacement";
import { useEditGesture } from "./gestures/useEditGesture";
import { useSelection } from "./gestures/useSelection";
import { useMultiSelectGesture } from "./gestures/useMultiSelectGesture";
import { useUndoRedo } from "./gestures/useUndoRedo";
import { useCreateQuickBox } from "./gestures/useCreateQuickBox";
import { useLiveRef } from "@/hooks/useLiveRef";
import ColorSwatchRow from "./ColorSwatchRow";
import StrokeWidthRow from "./StrokeWidthRow";
import AlphaRow from "./AlphaRow";
import "./Annotations.css";

export default function AnnotationInteraction({
  docId,
  getPages,
  scale,
  enabled,
  armedTool = null,
  boxActive = false,
  multiSelectActive = false,
  rectReader,
}: {
  docId: string;
  /** Current page cards (element + scale-1.0 box + 0-based index). Called at
   *  interaction time so it always sees the live geometry. */
  getPages: () => PageCardRef[];
  /** Current zoom scale, for normalizing the selection. */
  scale: number;
  /** Phase gate: only live once the reader is ready (`phase === "ready"`). */
  enabled: boolean;
  /** The armed annotation tool (single source in App; null = cursor mode). The
   *  machine carries it through so the quick-box knows its mode and stays sticky. */
  armedTool?: AnnotationTool | null;
  /** True when box-highlight mode is on (Highlight active + box mode). Box is a
   *  MODE of Highlight, not its own tool; this separate signal lets the box-drag
   *  gesture gate on it (the armed tool is "highlight", but a box drag, not text). */
  boxActive?: boolean;
  /** True when the Box-select pointer tool is armed (user feature request): lets
   *  `useMultiSelectGesture`'s marquee drag gate on it. A pointer tool (like
   *  cursor/hand), not a mode of an annotation tool — `armedTool` stays null while
   *  it's active. */
  multiSelectActive?: boolean;
  /** Test seam: how a text-node sub-range yields client rects. Omit in
   *  production (uses the real `getClientRects`); jsdom tests inject a reader
   *  since they have no layout. */
  rectReader?: (r: Range) => ArrayLike<DOMRect>;
}) {
  const addAnnotation = useAnnotationStore((s) => s.addAnnotation);
  const select = useAnnotationStore((s) => s.select);
  // The active-tool defaults the CREATE paths read (Story 2.6/2.8/2.9/2.13). The
  // selection quick-box reads its own copies inside `useSelection`; these feed the
  // create gestures (via `defaultsRef`) and the live previews. The store keeps the
  // single public `active*` API (two writers: the rail + the selection box).
  const activeColors = useAnnotationStore((s) => s.activeColors);
  const activeStrokeWidth = useAnnotationStore((s) => s.activeStrokeWidth);
  const activeAlpha = useAnnotationStore((s) => s.activeAlpha);
  const activeMemoSize = useAnnotationStore((s) => s.activeMemoSize);

  // Latest values for the document-level listeners (bound once) to read without
  // re-binding on every scale / tool change.
  const scaleRef = useLiveRef(scale);
  const getPagesRef = useLiveRef(getPages);
  const armedToolRef = useLiveRef(armedTool);
  const rectReaderRef = useLiveRef(rectReader);
  // Story 5.0: the four active-default mirrors (per-tool colors, stroke width,
  // alpha, memo size) collapse into ONE object ref the document-level listeners
  // read without re-binding. Same values, refreshed every render exactly like the
  // prior scalar refs — internal-only (the store's public `active*` API is
  // unchanged).
  const defaultsRef = useLiveRef({
    colors: activeColors,
    strokeWidth: activeStrokeWidth,
    alpha: activeAlpha,
    memoSize: activeMemoSize,
  });

  // The shared, synchronously-readable context every per-gesture hook (Story 5.0)
  // consumes. The dynamic values are reached through stable refs, so a fresh ctx
  // object each render is safe (the hooks' effects don't depend on its identity).
  const gestureCtx: GestureContext = {
    enabled,
    docId,
    armedToolRef,
    getPagesRef,
    scaleRef,
    defaultsRef,
    addAnnotation,
    select,
  };
  // Pen freehand gesture (Story 2.8) + box-highlight drag (Story 2.11), each
  // encapsulated as its own hook (Story 5.0). The hooks own their synchronous
  // draft refs + live-preview state and bind their own document handlers.
  const { penPreview } = usePenGesture(gestureCtx, armedTool);
  const { boxPreview } = useBoxGesture(gestureCtx, boxActive);
  useMemoPlacement(gestureCtx);
  // Drag-handle move/resize of a selected pen/rect mark (Story 3.1), PLUS the
  // group-move path for a box-select multi-selection (user feature request). A
  // document-level gesture (the edit frame(s) render in AnnotationLayer); it
  // commits ONE setAnnotationGeometry (or the batched setAnnotationGeometries for
  // a group) via the transient dragPreview/groupDragPreview.
  useEditGesture({ enabled, getPagesRef, scaleRef, multiSelectActive });
  useUndoRedo({ enabled });
  // Box-select marquee gesture (user feature request): drag to select existing
  // annotations for bulk Move/Delete. A SEPARATE selection mode from the
  // single-mark quick-box below (AD-12 extended) — its own group frame renders in
  // AnnotationLayer, and it owns its own Del/Esc handling internally.
  const { multiSelectPreview } = useMultiSelectGesture({
    enabled,
    docId,
    getPagesRef,
    scaleRef,
    active: multiSelectActive,
  });
  // The selected-mark quick-box (Story 2.5/AD-12), encapsulated as its own hook
  // (Story 5.0). Owns selection state + effects + the recolor/restroke/realpha/
  // resize/delete actions; the component renders the box from what it returns.
  const selection = useSelection({ enabled, docId, scale, getPagesRef, scaleRef });
  const {
    selectedAnno,
    selectedSpec,
    showSelectionBox,
    selectionBoxRef,
    recolorSelected,
    restrokeSelected,
    realphaSelected,
    convertSelected,
    deleteSelected,
  } = selection;
  // The CREATE quick-box's armed-tool / pending machine (Story 2.2 foundation),
  // encapsulated as its own hook (Story 5.3), mirroring `useSelection`'s shape.
  const { pending, pendingGeometry, quickBoxRef, commitTool } = useCreateQuickBox({
    enabled,
    docId,
    scale,
    getPagesRef,
    scaleRef,
    defaultsRef,
    armedTool,
    armedToolRef,
    rectReaderRef,
  });

  if (!pending && !showSelectionBox && !penPreview && !boxPreview && !multiSelectPreview) return null;

  const selInit = showSelectionBox ? selection.selectionPoint() : { x: 0, y: 0 };

  // The live pen preview, drawn in fixed/client space (the same engine the mark
  // uses, so what-you-draw-is-what-you-get). Width = activeStrokeWidth * scale so
  // it matches the stored mark, which denormalizes at the current scale.
  const previewPath =
    penPreview && penPreview.length > 0
      ? svgPathFromOutline(strokeOutline(penPreview, activeStrokeWidth * scale))
      : "";

  return (
    <>
      {penPreview && previewPath && (
        <svg className="pen-preview" data-testid="pen-preview" aria-hidden="true">
          <path d={previewPath} fill={`var(--color-${activeColors.pen})`} fillOpacity={activeAlpha} />
        </svg>
      )}
      {boxPreview && (
        <div
          className="box-preview"
          data-testid="box-preview"
          aria-hidden="true"
          style={{
            left: Math.min(boxPreview.x0, boxPreview.x1),
            top: Math.min(boxPreview.y0, boxPreview.y1),
            width: Math.abs(boxPreview.x1 - boxPreview.x0),
            height: Math.abs(boxPreview.y1 - boxPreview.y0),
            borderColor: `var(--color-${activeColors.highlight})`,
          }}
        />
      )}
      {multiSelectPreview && (
        // The marquee rubber-band, neutral (ink) styling — not tinted to any
        // annotation-tool accent, since this drag SELECTS existing marks rather
        // than creating a colored one (unlike box-highlight's boxPreview above).
        <div
          className="multi-select-preview"
          data-testid="multi-select-preview"
          aria-hidden="true"
          style={{
            left: Math.min(multiSelectPreview.x0, multiSelectPreview.x1),
            top: Math.min(multiSelectPreview.y0, multiSelectPreview.y1),
            width: Math.abs(multiSelectPreview.x1 - multiSelectPreview.x0),
            height: Math.abs(multiSelectPreview.y1 - multiSelectPreview.y0),
          }}
        />
      )}
      {pending &&
        pendingGeometry?.previewRects.map((r, i) => (
          // Stands in for the native browser selection (cleared on present,
          // Story 4.x fix) while the CREATE quick-box is open: re-derived from
          // the stored, scale-independent selection on every scroll/resize/
          // zoom, so it survives what the native Selection can't. Tinted by
          // the CSS class with the neutral selection token, NOT the active
          // tool color — nothing has been chosen as highlight/underline/
          // comment yet.
          <div
            key={i}
            className="pending-selection-preview"
            data-testid="pending-selection-preview"
            aria-hidden="true"
            style={{ left: r.left, top: r.top, width: r.width, height: r.height }}
          />
        ))}
      {pending && (
        // Cursor-mode tool-type picker (Story 2.12). Drag-select → H/U/C (icon
        // only). Click on empty page → Comment+Memo (icon only). Machine, shell,
        // and focus-in/return plumbing unchanged; position/clamp/dismiss-on-
        // scroll replaced by the live-tracking geometry above (Story 4.x fix).
        <div
          ref={quickBoxRef}
          className="quick-box"
          role="menu"
          aria-label="Annotation tools"
          data-testid="quick-box"
          style={{ left: pendingGeometry?.boxAt.x ?? pending.at.x, top: pendingGeometry?.boxAt.y ?? pending.at.y }}
        >
          {pending.selection.length > 0 ? (
            // Text drag: Highlight / Underline / Comment
            <>
              <button
                type="button"
                role="menuitem"
                className="quick-box__action"
                data-testid="quick-box-highlight"
                aria-label="Highlight"
                title="Highlight"
                onClick={() => commitTool("highlight")}
              >
                <Highlighter aria-hidden />
              </button>
              <button
                type="button"
                role="menuitem"
                className="quick-box__action"
                data-testid="quick-box-underline"
                aria-label="Underline"
                title="Underline"
                onClick={() => commitTool("underline")}
              >
                <TextUnderline aria-hidden />
              </button>
              <button
                type="button"
                role="menuitem"
                className="quick-box__action"
                data-testid="quick-box-comment"
                aria-label="Comment"
                title="Comment"
                onClick={() => commitTool("comment")}
              >
                <ChatCircle aria-hidden />
              </button>
            </>
          ) : (
            // Click on empty page area: Comment pin + Memo
            <>
              <button
                type="button"
                role="menuitem"
                className="quick-box__action"
                data-testid="quick-box-comment"
                aria-label="Comment"
                title="Comment"
                onClick={() => commitTool("comment")}
              >
                <ChatCircle aria-hidden />
              </button>
              <button
                type="button"
                role="menuitem"
                className="quick-box__action"
                data-testid="quick-box-memo"
                aria-label="Memo"
                title="Memo"
                onClick={() => commitTool("memo")}
              >
                <TextT aria-hidden />
              </button>
            </>
          )}
        </div>
      )}

      {showSelectionBox && selectedAnno && selectedSpec && (
        <div
          ref={selectionBoxRef}
          className={selectedAnno.type === "memo" ? "quick-box quick-box--vertical" : "quick-box"}
          role="menu"
          aria-label={selectedSpec.ariaLabel}
          data-testid="selection-quick-box"
          style={{ left: selInit.x, top: selInit.y }}
        >
          {/* Recolor the selected mark (reuses 2.3's row + store.recolorAnnotation);
              the row shows the mark's CURRENT color armed. For a memo it tints the
              box accent (border). */}
          <ColorSwatchRow value={selectedAnno.style.color} onPick={recolorSelected} />
          {/* Rows come from the mark's descriptor (Story 5.0): pen → stroke-width +
              alpha, memo → size, text marks → none. Armed to each mark's current
              value (memos store size as their rect, not a style field). */}
          {selectedSpec.strokeWidth && (
            <StrokeWidthRow value={selectedAnno.style.stroke_width ?? activeStrokeWidth} onPick={restrokeSelected} />
          )}
          {selectedSpec.alpha && (
            <AlphaRow value={selectedAnno.style.alpha ?? activeAlpha} onPick={realphaSelected} />
          )}
          <span className="quick-box__divider" aria-hidden="true" />
          {/* Turn into comment (Story 3.7, AC1): text-highlight only — a region
              highlight/underline/pen has no comment counterpart via this action. */}
          {selectedAnno.type === "highlight" && selectedAnno.anchor.kind === "text" && (
            <button
              type="button"
              role="menuitem"
              className="quick-box__action quick-box__action--icon"
              data-testid="quick-box-convert-comment"
              aria-label="Turn into comment"
              title="Turn into comment"
              onClick={convertSelected}
            >
              <ChatCircle aria-hidden />
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            className="quick-box__action quick-box__action--icon"
            data-testid="quick-box-delete"
            aria-label="Delete"
            title="Delete (Del)"
            onClick={deleteSelected}
          >
            <Trash aria-hidden />
          </button>
        </div>
      )}
    </>
  );
}
