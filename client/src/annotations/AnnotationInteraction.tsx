// AnnotationInteraction — the overlay's interaction layer: the armed-tool /
// quick-box state machine (machine.ts) + the `{component.quick-box}` SHELL.
//
// The shell, position/clamp, focus-in/return, and dismiss-on-pick/outside/Esc
// (plus the `removeAllRanges()` re-pop fix) are the Story 2.2 foundation, reused
// unchanged. What varies is the quick-box CONTENTS and the create timing, keyed
// off the armed tool (`armedTool` prop, single source in App):
//   - Highlight armed → the mark LANDS on drag-release at the default color
//     (create-on-release), then the quick-box shows the color-swatch row to
//     recolor it (Story 2.3).
//   - Cursor (no tool) → the Story 2.2 proof: a single "Highlight" action that
//     creates the mark on click. (The cursor-mode tool-type picker is Story 2.9.)
//
// Document-level handlers (Epic-1 retro AP-1): pointer/key handlers bind on
// `document`, phase-gated (`enabled`), exempting editable fields + buttons — NOT
// on `.pdf-canvas`. Layering (AD-9): this lives in annotations/, consuming
// anchor/ + store/ only; render/ stays annotation-free (geometry via `getPages`).

import { useCallback, useEffect, useLayoutEffect, useReducer, useRef } from "react";
import { rectsFromSelection, type PageCardRef } from "../anchor";
import { useAnnotationStore } from "../store";
import { newId } from "../uuid";
import { buildAnnotations } from "./create";
import { clampToViewport } from "./position";
import { initialOverlayState, overlayReducer, type AnnotationTool } from "./machine";
import ColorSwatchRow from "./ColorSwatchRow";
import "./Annotations.css";

/** The default highlight color token (aliases yellow; DESIGN.md). */
const DEFAULT_COLOR = "annotation-default";

/** Skip editable fields + buttons so the global handlers never eat a control's
 *  own keys/clicks (mirrors the Reader's hold-Space `isExempt`). */
function isExempt(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON" || el.isContentEditable
  );
}

export default function AnnotationInteraction({
  docId,
  getPages,
  scale,
  enabled,
  armedTool = null,
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
}) {
  const [state, dispatch] = useReducer(overlayReducer, initialOverlayState);
  const addAnnotation = useAnnotationStore((s) => s.addAnnotation);
  const recolorAnnotation = useAnnotationStore((s) => s.recolorAnnotation);
  const quickBoxRef = useRef<HTMLDivElement | null>(null);
  // The element focused before the quick-box opened, restored on dismiss.
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  // Ids of the marks created on the current drag-release (highlight mode), so the
  // swatch row can recolor exactly them (a two-page group recolors together).
  const createdIdsRef = useRef<string[]>([]);

  // Latest values for the document-level listeners (bound once) to read without
  // re-binding on every scale / tool change.
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const getPagesRef = useRef(getPages);
  getPagesRef.current = getPages;
  const armedToolRef = useRef(armedTool);
  armedToolRef.current = armedTool;

  const pending = state.status === "pending" ? state : null;
  // Readable from the disarm effect below without making `pending` a dep.
  const pendingRef = useRef(false);
  pendingRef.current = pending !== null;

  // Sync the armed tool from App into the machine, so `currentTool(state)` (and
  // thus `pending.tool`) reflects it and the machine rests back to armed (sticky)
  // after a mark. App owns the armed tool; the machine just carries it. When a
  // prop-driven disarm (V/Esc clears the tool) drops an OPEN quick-box, clear the
  // live browser selection too — otherwise the stale selection re-pops the
  // quick-box on the next pointerup (the 2.2 re-pop fix, which `dismiss()` does).
  useEffect(() => {
    if (armedTool) {
      dispatch({ type: "arm", tool: armedTool });
    } else {
      if (pendingRef.current) window.getSelection()?.removeAllRanges();
      dispatch({ type: "disarm" });
    }
  }, [armedTool]);

  // Pointer release: if the user just drag-selected text, build the anchor(s).
  // Highlight armed → create the mark NOW (it lands) and pop the swatch row.
  // Cursor mode → pop the proof quick-box (the action creates on click).
  // Bound on document (AP-1), phase-gated.
  useEffect(() => {
    if (!enabled) return;
    const onPointerUp = (e: PointerEvent) => {
      if (e.button !== 0 || isExempt(e.target)) return;
      const selection = window.getSelection();
      const pages = rectsFromSelection(selection, getPagesRef.current(), scaleRef.current);
      if (pages.length === 0) return;
      restoreFocusRef.current = document.activeElement as HTMLElement | null;
      if (armedToolRef.current === "highlight") {
        // Create-on-release: the highlight lands at the default color before any
        // swatch pick (AC-2). The swatch row then recolors these exact ids.
        const created = buildAnnotations(pages, docId, {
          now: new Date().toISOString(),
          newId,
          type: "highlight",
          color: DEFAULT_COLOR,
        });
        created.forEach(addAnnotation);
        createdIdsRef.current = created.map((a) => a.id);
      } else {
        createdIdsRef.current = [];
      }
      dispatch({ type: "present", selection: pages, at: { x: e.clientX, y: e.clientY } });
    };
    document.addEventListener("pointerup", onPointerUp);
    return () => document.removeEventListener("pointerup", onPointerUp);
  }, [enabled, docId, addAnnotation]);

  // Dismiss the quick-box AND clear the browser selection. Clearing is required:
  // otherwise the still-live selection is re-read by the global pointerup handler
  // (or the next click) and immediately re-pops the quick-box (review finding).
  const dismiss = useCallback(() => {
    window.getSelection()?.removeAllRanges();
    dispatch({ type: "dismiss" });
  }, []);

  // Esc dismisses the quick-box; an outside pointer-down dismisses it too — both
  // document-level. Only while pending so we don't shadow other Esc handlers.
  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        dismiss();
      }
    };
    const onPointerDown = (e: PointerEvent) => {
      if (quickBoxRef.current && !quickBoxRef.current.contains(e.target as Node)) {
        dismiss();
      }
    };
    document.addEventListener("keydown", onKey);
    // Capture phase so the dismiss runs before a fresh selection's pointerdown.
    document.addEventListener("pointerdown", onPointerDown, true);
    // The quick-box is a transient popup pinned to the release point (fixed
    // position); once the canvas scrolls it would float detached from its mark,
    // so scrolling dismisses it. Capture-phase: `scroll` does not bubble, and the
    // scrolling element is the pdf-canvas, not window.
    document.addEventListener("scroll", dismiss, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("scroll", dismiss, true);
    };
  }, [pending, dismiss]);

  // Focus moves INTO the quick-box on open and RETURNS to the prior element on
  // dismiss (EXPERIENCE.md accessibility floor). Also nudges the box on-screen
  // once measured (AC-4: positioned at the selection, nudged to stay on-screen).
  useLayoutEffect(() => {
    if (pending) {
      // Focus the first action in the quick-box (proof button or first swatch).
      quickBoxRef.current?.querySelector<HTMLElement>("button")?.focus();
      const el = quickBoxRef.current;
      if (el) {
        const rect = el.getBoundingClientRect();
        const { x, y } = clampToViewport(
          pending.at.x,
          pending.at.y,
          rect.width,
          rect.height,
          window.innerWidth,
          window.innerHeight,
        );
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
      }
    } else if (restoreFocusRef.current) {
      restoreFocusRef.current.focus?.();
      restoreFocusRef.current = null;
    }
    // Re-run when the pending identity changes (open / dismiss / move).
  }, [pending]);

  // Cursor-mode proof action (Story 2.2): create a default text-highlight from
  // the pending selection and store it (AC-3, AC-5). Two-page selections share a
  // group_id (handled in buildAnnotations).
  const commit = useCallback(() => {
    if (!pending) return;
    const created = buildAnnotations(pending.selection, docId, {
      now: new Date().toISOString(),
      newId,
      type: "highlight",
      color: DEFAULT_COLOR,
    });
    created.forEach(addAnnotation);
    window.getSelection()?.removeAllRanges();
    dispatch({ type: "commit" });
  }, [pending, docId, addAnnotation]);

  // Highlight-mode swatch pick: recolor the just-landed mark(s) and dismiss (a
  // pick is a dismiss per the shell contract). Recolors the whole group together.
  const recolor = useCallback(
    (color: string) => {
      recolorAnnotation(createdIdsRef.current, color, new Date().toISOString());
      dismiss();
    },
    [recolorAnnotation, dismiss],
  );

  if (!pending) return null;

  const highlightMode = pending.tool === "highlight";

  return (
    <div
      ref={quickBoxRef}
      className="quick-box"
      role="menu"
      aria-label={highlightMode ? "Highlight color" : "Annotation actions"}
      data-testid="quick-box"
      // Initial position at the release point; the layout effect nudges it
      // on-screen once measured. position:fixed keeps it off the canvas flow.
      style={{ left: pending.at.x, top: pending.at.y }}
    >
      {highlightMode ? (
        // The mark already landed on release; the row recolors it. The first
        // swatch is focusable for the focus-in contract.
        <ColorSwatchRow value={DEFAULT_COLOR} onPick={recolor} />
      ) : (
        <button
          type="button"
          role="menuitem"
          className="quick-box__action"
          data-testid="quick-box-highlight"
          onClick={commit}
        >
          Highlight
        </button>
      )}
    </div>
  );
}
