// AnnotationInteraction — the overlay's interaction layer: the armed-tool /
// quick-box state machine (machine.ts) + the `{component.quick-box}` SHELL.
//
// Story 2.2 wires the shell plus ONE proof action: a cursor-mode text
// drag-selection pops the quick-box, and its single action creates a default
// text-highlight Annotation in the store (which AnnotationLayer then renders).
// Later stories (2.3–2.9) fill the shell's mode-specific contents (swatch row,
// tool picker) and arm real tools; they reuse this shell + machine unchanged.
//
// Document-level handlers (Epic-1 retro AP-1): pointer/key handlers bind on
// `document`, phase-gated (`enabled`), exempting editable fields + buttons — NOT
// on `.pdf-canvas`. Layering (AD-9): this lives in annotations/, consuming
// anchor/ + store/ only; render/ stays annotation-free (the page geometry is
// passed in via `getPages`).

import { useCallback, useEffect, useLayoutEffect, useReducer, useRef } from "react";
import { rectsFromSelection, type PageCardRef } from "../anchor";
import { useAnnotationStore } from "../store";
import { buildAnnotations } from "./create";
import { clampToViewport } from "./position";
import { initialOverlayState, overlayReducer } from "./machine";
import "./Annotations.css";

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
}: {
  docId: string;
  /** Current page cards (element + scale-1.0 box + 0-based index). Called at
   *  interaction time so it always sees the live geometry. */
  getPages: () => PageCardRef[];
  /** Current zoom scale, for normalizing the selection. */
  scale: number;
  /** Phase gate: only live once the reader is ready (`phase === "ready"`). */
  enabled: boolean;
}) {
  const [state, dispatch] = useReducer(overlayReducer, initialOverlayState);
  const addAnnotation = useAnnotationStore((s) => s.addAnnotation);
  const quickBoxRef = useRef<HTMLDivElement | null>(null);
  const firstActionRef = useRef<HTMLButtonElement | null>(null);
  // The element focused before the quick-box opened, restored on dismiss.
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  // Latest values for the document-level listeners (bound once) to read without
  // re-binding on every scale change.
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const getPagesRef = useRef(getPages);
  getPagesRef.current = getPages;

  const pending = state.status === "pending" ? state : null;

  // Pointer release: if the user just drag-selected text, pop the quick-box at
  // the release point (AC-4). Bound on document (AP-1), phase-gated.
  useEffect(() => {
    if (!enabled) return;
    const onPointerUp = (e: PointerEvent) => {
      if (e.button !== 0 || isExempt(e.target)) return;
      const selection = window.getSelection();
      const pages = rectsFromSelection(selection, getPagesRef.current(), scaleRef.current);
      if (pages.length === 0) return;
      restoreFocusRef.current = document.activeElement as HTMLElement | null;
      dispatch({ type: "present", selection: pages, at: { x: e.clientX, y: e.clientY } });
    };
    document.addEventListener("pointerup", onPointerUp);
    return () => document.removeEventListener("pointerup", onPointerUp);
  }, [enabled]);

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
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [pending, dismiss]);

  // Focus moves INTO the quick-box on open and RETURNS to the prior element on
  // dismiss (EXPERIENCE.md accessibility floor). Also nudges the box on-screen
  // once measured (AC-4: positioned at the selection, nudged to stay on-screen).
  useLayoutEffect(() => {
    if (pending) {
      firstActionRef.current?.focus();
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

  // The proof action: create a default text-highlight from the pending
  // selection and store it (AC-3, AC-5). Two-page selections share a group_id
  // (handled in buildAnnotations).
  const commit = useCallback(() => {
    if (!pending) return;
    const created = buildAnnotations(pending.selection, docId, {
      now: new Date().toISOString(),
      newId: () => crypto.randomUUID(),
      type: "highlight",
      color: "annotation-default",
    });
    created.forEach(addAnnotation);
    window.getSelection()?.removeAllRanges();
    dispatch({ type: "commit" });
  }, [pending, docId, addAnnotation]);

  if (!pending) return null;

  return (
    <div
      ref={quickBoxRef}
      className="quick-box"
      role="menu"
      aria-label="Annotation actions"
      data-testid="quick-box"
      // Initial position at the release point; the layout effect nudges it
      // on-screen once measured. position:fixed keeps it off the canvas flow.
      style={{ left: pending.at.x, top: pending.at.y }}
    >
      <button
        ref={firstActionRef}
        type="button"
        role="menuitem"
        className="quick-box__action"
        data-testid="quick-box-highlight"
        onClick={commit}
      >
        Highlight
      </button>
    </div>
  );
}
