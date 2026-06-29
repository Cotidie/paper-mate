// AnnotationInteraction — the overlay's interaction layer: the armed-tool /
// quick-box state machine (machine.ts) + the `{component.quick-box}` SHELL.
//
// The shell, position/clamp, focus-in/return, and dismiss-on-pick/outside/Esc
// (plus the `removeAllRanges()` re-pop fix) are the Story 2.2 foundation, reused
// unchanged. Create timing is keyed off the armed tool (`armedTool` prop, single
// source in App), and BOTH create paths land in the SAME selection quick-box
// (Story 2.5 unification — one recolor + delete affordance, AD-12):
//   - Highlight armed → the mark LANDS on drag-release at the default color
//     (create-on-release) and is immediately SELECTED → the selection quick-box.
//   - Cursor (no tool) → the Story 2.2 proof: a single "Highlight" action that
//     creates the mark on click, then selects it. (The cursor-mode tool-type
//     picker is Story 2.12.)
//
// Document-level handlers (Epic-1 retro AP-1): pointer/key handlers bind on
// `document`, phase-gated (`enabled`), exempting editable fields + buttons — NOT
// on `.pdf-canvas`. Layering (AD-9): this lives in annotations/, consuming
// anchor/ + store/ only; render/ stays annotation-free (geometry via `getPages`).

import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import { Trash } from "@phosphor-icons/react";
import { rectsFromSelection, denormalizeRect, type PageCardRef } from "../anchor";
import { useAnnotationStore } from "../store";
import { newId } from "../uuid";
import { buildAnnotations } from "./create";
import { clampToViewport } from "./position";
import { initialOverlayState, overlayReducer, type AnnotationTool } from "./machine";
import ColorSwatchRow from "./ColorSwatchRow";
import "./Annotations.css";

/** Vertical gap (viewport px) between the marked text and the floating quick-box
 *  anchored below it, so the box clears the run instead of covering it. */
const QUICK_BOX_GAP = 6;

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
  /** Test seam: how a text-node sub-range yields client rects. Omit in
   *  production (uses the real `getClientRects`); jsdom tests inject a reader
   *  since they have no layout. */
  rectReader?: (r: Range) => ArrayLike<DOMRect>;
}) {
  const [state, dispatch] = useReducer(overlayReducer, initialOverlayState);
  const addAnnotation = useAnnotationStore((s) => s.addAnnotation);
  const recolorAnnotation = useAnnotationStore((s) => s.recolorAnnotation);
  // Story 2.5 selection seam (AD-12): selection lives in the store; this layer
  // reads it to render the selected-mark quick-box (recolor + delete).
  const annotations = useAnnotationStore((s) => s.annotations);
  const selectedId = useAnnotationStore((s) => s.selectedId);
  // Story 2.6: the active/default color lives in the store (two writers — this
  // overlay's recolor AND the rail's color sub-toolbox — plus the create path
  // reads it). Recoloring a mark also updates this default (remember-last-choice).
  const activeColor = useAnnotationStore((s) => s.activeColor);
  const setActiveColor = useAnnotationStore((s) => s.setActiveColor);
  const select = useAnnotationStore((s) => s.select);
  const clearSelection = useAnnotationStore((s) => s.clearSelection);
  const deleteAnnotation = useAnnotationStore((s) => s.deleteAnnotation);
  const quickBoxRef = useRef<HTMLDivElement | null>(null);
  // The selection quick-box (separate render path off `selectedId`, Decision B).
  const selectionBoxRef = useRef<HTMLDivElement | null>(null);
  // The element focused before the selection box opened, restored on close.
  const restoreSelectionFocusRef = useRef<HTMLElement | null>(null);
  // The selection quick-box opens when a NEW mark is selected and closes on a
  // pick (the 2.3 pick-is-dismiss feel) while the ring stays — so its visibility
  // is its own bit, not just `selectedId != null`.
  const [selectionBoxOpen, setSelectionBoxOpen] = useState(false);
  // The element focused before the quick-box opened, restored on dismiss.
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  // Latest values for the document-level listeners (bound once) to read without
  // re-binding on every scale / tool change.
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const getPagesRef = useRef(getPages);
  getPagesRef.current = getPages;
  const armedToolRef = useRef(armedTool);
  armedToolRef.current = armedTool;
  const activeColorRef = useRef(activeColor);
  activeColorRef.current = activeColor;
  const rectReaderRef = useRef(rectReader);
  rectReaderRef.current = rectReader;

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
  // Highlight armed → create the mark NOW (it lands) and SELECT it, so the one
  // selection quick-box (recolor + delete) takes over — no separate create box
  // (unified with the select-an-existing-mark path, AD-12). Cursor mode → pop the
  // proof quick-box (the action creates on click). Bound on document (AP-1).
  useEffect(() => {
    if (!enabled) return;
    const onPointerUp = (e: PointerEvent) => {
      if (e.button !== 0 || isExempt(e.target)) return;
      const selection = window.getSelection();
      const pages = rectsFromSelection(
        selection,
        getPagesRef.current(),
        scaleRef.current,
        rectReaderRef.current,
      );
      if (pages.length === 0) return;
      const tool = armedToolRef.current;
      if (tool === "highlight" || tool === "underline") {
        // Create-on-release for either text-anchor tool: same path, the tool's
        // `type` is the only difference (highlight paints a fill, underline a 2px
        // line — that branch lives in AnnotationLayer, keyed off `type` per AD-5).
        // Color is the active color (Story 2.6 — chosen via the tool's color
        // sub-toolbox, not a hardcode). Then select the new mark so the selection
        // quick-box recolors/deletes it (the whole group together). Clear the live
        // text selection so it cannot re-pop on the next pointerup.
        const created = buildAnnotations(pages, docId, {
          now: new Date().toISOString(),
          newId,
          type: tool,
          color: activeColorRef.current,
        });
        created.forEach(addAnnotation);
        selection?.removeAllRanges();
        select(created[0].id);
        return;
      }
      // Any OTHER armed tool (pen/memo/comment — future stories) must NOT fall
      // through to the cursor-mode proof box: that would pop the highlight proof
      // as if nothing were armed. Only cursor mode (tool === null) reaches it.
      if (tool !== null) return;
      // Cursor mode (no tool): the 2.2 proof — a single action that creates the
      // highlight on click (the cursor-mode tool picker is Story 2.12).
      restoreFocusRef.current = document.activeElement as HTMLElement | null;
      dispatch({ type: "present", selection: pages, at: { x: e.clientX, y: e.clientY } });
    };
    document.addEventListener("pointerup", onPointerUp);
    return () => document.removeEventListener("pointerup", onPointerUp);
  }, [enabled, docId, addAnnotation, select]);

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
  // the pending selection, store it, then SELECT it so the unified selection
  // quick-box takes over (same as the highlight-armed path). Two-page selections
  // share a group_id (handled in buildAnnotations).
  const commit = useCallback(() => {
    if (!pending) return;
    const created = buildAnnotations(pending.selection, docId, {
      now: new Date().toISOString(),
      newId,
      type: "highlight",
      color: activeColorRef.current,
    });
    created.forEach(addAnnotation);
    window.getSelection()?.removeAllRanges();
    dispatch({ type: "commit" });
    select(created[0].id);
  }, [pending, docId, addAnnotation, select]);

  // ── Selection (Story 2.5, AD-12) ─────────────────────────────────────────
  // Separate from the create machine (Decision B): the selection quick-box is
  // driven by the store's `selectedId`, not `machine.ts`. Scope the resolved mark
  // to THIS doc: the store is global and not cleared on doc switch (Epic 3), so a
  // stale `selectedId` from another document must not render a box or be mutated
  // here. (The clear-on-doc-switch effect below is the primary guard; this keeps
  // every downstream read consistent even within the same render.)
  const selectedRaw = selectedId ? annotations.get(selectedId) ?? null : null;
  const selectedAnno = selectedRaw && selectedRaw.doc_id === docId ? selectedRaw : null;

  // A doc switch (the singleton store survives it) must drop any prior selection
  // so it can't be recolored/deleted from the new reader. Runs once on mount too
  // (no-op: nothing selected).
  useEffect(() => {
    clearSelection();
  }, [docId, clearSelection]);

  // Clicking ANY mark (re)opens its quick-box. Bound always-on (phase-gated) so
  // the FIRST selection opens it too, and re-clicking the same mark reopens it
  // after a pick/scroll closed it. Capture phase, before the click selects it.
  useEffect(() => {
    if (!enabled) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.(".annotation-highlight")) setSelectionBoxOpen(true);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [enabled]);

  // Open the box on a new selection; close it when nothing is selected (e.g.
  // after a delete). A pick/scroll closes it WITHOUT changing `selectedId`, so
  // this effect won't re-run and reopen it; re-clicking the mark does (above).
  useEffect(() => {
    setSelectionBoxOpen(selectedId !== null);
  }, [selectedId]);

  // The ids a selection action touches: the selected mark + its group siblings
  // (a two-page highlight recolors/deletes together, AR-4).
  const selectedGroupIds = useCallback((): string[] => {
    if (!selectedAnno) return [];
    if (!selectedAnno.group_id) return [selectedAnno.id];
    const ids: string[] = [];
    for (const a of annotations.values()) if (a.group_id === selectedAnno.group_id) ids.push(a.id);
    return ids;
  }, [selectedAnno, annotations]);

  const recolorSelected = useCallback(
    (color: string) => {
      recolorAnnotation(selectedGroupIds(), color, new Date().toISOString());
      // Remember the choice: recoloring an existing mark also sets the default for
      // the next new mark (Story 2.6 request 3 — last-choice-wins, either path).
      setActiveColor(color);
      setSelectionBoxOpen(false); // pick dismisses the box; the mark stays selected/ringed
    },
    [recolorAnnotation, selectedGroupIds, setActiveColor],
  );

  // Delete via the store (removes id + group siblings AND clears `selectedId`).
  // Uses the doc-scoped mark so a stale cross-doc id can never be deleted here.
  const deleteSelected = useCallback(() => {
    if (selectedAnno) deleteAnnotation(selectedAnno.id);
  }, [selectedAnno, deleteAnnotation]);

  // Selection keys + dismiss, document-level + phase-gated (AP-1). Live only
  // while a current-doc mark is selected so we don't shadow other handlers.
  useEffect(() => {
    if (!enabled || !selectedAnno) return;
    const onKey = (e: KeyboardEvent) => {
      // Same exemption order as the other document-level handlers: skip chords
      // and editable/button targets BEFORE acting on any key (incl. Esc).
      if (e.ctrlKey || e.altKey || e.metaKey || isExempt(e.target)) return;
      if (e.key === "Escape") {
        // Esc clears the selection (the App-level Esc->cursor also runs).
        clearSelection();
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteAnnotation(selectedAnno.id);
      }
    };
    // Empty-space deselect: a pointerdown on empty page content (NOT a mark, the
    // selection box, or a control) clears the selection. Exempting buttons/inputs
    // means using the chrome (toolbar, zoom) keeps the selection (AC1).
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (isExempt(t)) return;
      const onMark = !!t?.closest?.(".annotation-highlight");
      const inBox = selectionBoxRef.current?.contains(t as Node) ?? false;
      if (!onMark && !inBox) clearSelection();
    };
    // The box is position:fixed; once the canvas scrolls (incl. zoom recenters)
    // it floats detached, so scrolling CLOSES the box — but the selection (ring)
    // stays, since it rides the denormalized rect and re-derives glued (NFR-3).
    const onScroll = () => setSelectionBoxOpen(false);
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [enabled, selectedAnno, clearSelection, deleteAnnotation]);

  // Require at least one anchor rect: the box anchors at the mark's first rect,
  // and a text anchor with an empty `rects` array (the generated type allows it)
  // would crash `denormalizeRect`. A real highlight always has rects.
  const showSelectionBox =
    selectionBoxOpen &&
    selectedAnno !== null &&
    selectedAnno.anchor.kind === "text" &&
    selectedAnno.anchor.rects.length > 0;

  // Project the selected mark to the box-anchor viewport point, re-derived from
  // the anchor service so it tracks zoom (clamped in layout). Anchored just BELOW
  // the selection's LOWEST line (left-aligned to the first line) so the floating
  // box never covers the marked text — it sits in the gap under the run.
  const selectionPoint = (): { x: number; y: number } => {
    if (!selectedAnno || selectedAnno.anchor.kind !== "text" || selectedAnno.anchor.rects.length === 0) {
      return { x: 0, y: 0 };
    }
    const page = getPagesRef.current().find((p) => p.pageIndex === selectedAnno.anchor.page_index);
    if (!page) return { x: 0, y: 0 };
    const cardRect = page.cardEl.getBoundingClientRect();
    const scale = scaleRef.current;
    const rects = selectedAnno.anchor.rects;
    const first = denormalizeRect(rects[0], page.box, scale);
    let bottom = first.top + first.height;
    for (const r of rects) {
      const p = denormalizeRect(r, page.box, scale);
      bottom = Math.max(bottom, p.top + p.height);
    }
    return { x: cardRect.left + first.left, y: cardRect.top + bottom + QUICK_BOX_GAP };
  };

  // Focus moves INTO the selection box on open and RETURNS to the prior element
  // on close (same accessibility floor as the create box). Also nudges the box
  // on-screen once measured. Focus only on the OPEN transition (guarded by
  // `restoreSelectionFocusRef`), so a re-run (zoom) re-clamps without stealing
  // focus back to the first swatch.
  useLayoutEffect(() => {
    if (showSelectionBox) {
      const el = selectionBoxRef.current;
      if (!el) return;
      if (!restoreSelectionFocusRef.current) {
        // First open: remember where focus was, move it into the box.
        restoreSelectionFocusRef.current = (document.activeElement as HTMLElement | null) ?? document.body;
        el.querySelector<HTMLElement>("button")?.focus();
      }
      const { x, y } = selectionPoint();
      const rect = el.getBoundingClientRect();
      const c = clampToViewport(x, y, rect.width, rect.height, window.innerWidth, window.innerHeight);
      el.style.left = `${c.x}px`;
      el.style.top = `${c.y}px`;
    } else if (restoreSelectionFocusRef.current) {
      restoreSelectionFocusRef.current.focus?.();
      restoreSelectionFocusRef.current = null;
    }
    // Re-run on open/close and on zoom (rect re-derives).
  }, [showSelectionBox, selectedId, scale]);

  if (!pending && !showSelectionBox) return null;

  const selInit = showSelectionBox ? selectionPoint() : { x: 0, y: 0 };

  return (
    <>
      {pending && (
        // Cursor-mode proof box only: a single action that creates the highlight
        // on click (then selects it). The highlight-armed path never opens this —
        // it lands + selects straight into the selection quick-box below.
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
            type="button"
            role="menuitem"
            className="quick-box__action"
            data-testid="quick-box-highlight"
            onClick={commit}
          >
            Highlight
          </button>
        </div>
      )}

      {showSelectionBox && selectedAnno && (
        <div
          ref={selectionBoxRef}
          className="quick-box"
          role="menu"
          aria-label="Highlight actions"
          data-testid="selection-quick-box"
          style={{ left: selInit.x, top: selInit.y }}
        >
          {/* Recolor the selected mark (reuses 2.3's row + store.recolorAnnotation);
              the row shows the mark's CURRENT color armed. */}
          <ColorSwatchRow value={selectedAnno.style.color} onPick={recolorSelected} />
          <span className="quick-box__divider" aria-hidden="true" />
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
