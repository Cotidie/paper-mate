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
import { Highlighter, TextUnderline, ChatCircle, TextT, Trash } from "@phosphor-icons/react";
import {
  rectsFromSelection,
  denormalizeRect,
  denormalizePoint,
  normalizeRect,
  pickPage,
  type PageCardRef,
  type PageSelection,
} from "../anchor";
import { useAnnotationStore, MEMO_SIZES, type MemoSize } from "../store";
import { newId } from "../uuid";
import { buildAnnotations, buildMemoAnnotation, buildCommentPin } from "./create";
import { strokeOutline, svgPathFromOutline } from "./pen";
import { clampToViewport } from "./position";
import { initialOverlayState, overlayReducer, type AnnotationTool } from "./machine";
import { quickBoxSpec } from "./marks";
import { isExempt, type GestureContext } from "./gestures/shared";
import { usePenGesture } from "./gestures/usePenGesture";
import { useBoxGesture } from "./gestures/useBoxGesture";
import { useMemoPlacement } from "./gestures/useMemoPlacement";
import ColorSwatchRow from "./ColorSwatchRow";
import StrokeWidthRow from "./StrokeWidthRow";
import AlphaRow from "./AlphaRow";
import SizeRow from "./SizeRow";
import "./Annotations.css";

/** Vertical gap (viewport px) between the marked text and the floating quick-box
 *  anchored below it, so the box clears the run instead of covering it. */
const QUICK_BOX_GAP = 6;

/** Max pointer travel (px) between a comment pointerdown and its release for the
 *  release to still count as a CLICK (drops a pin). Beyond this it was a drag. */
const COMMENT_CLICK_SLOP = 5;

export default function AnnotationInteraction({
  docId,
  getPages,
  scale,
  enabled,
  armedTool = null,
  boxActive = false,
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
  // Story 2.8: the active pen stroke width (default for new strokes) lives in the
  // store next to activeColor — two writers (the rail's stroke-width row AND the
  // pen selection quick-box's restroke) plus the create path reads it.
  const activeStrokeWidth = useAnnotationStore((s) => s.activeStrokeWidth);
  const setActiveStrokeWidth = useAnnotationStore((s) => s.setActiveStrokeWidth);
  const restrokeAnnotation = useAnnotationStore((s) => s.restrokeAnnotation);
  // Story 2.13: the active pen alpha (default transparency) lives in the store
  // next to activeStrokeWidth — two writers (the rail's alpha row AND the pen
  // selection quick-box's realpha) plus the create path reads it.
  const activeAlpha = useAnnotationStore((s) => s.activeAlpha);
  const setActiveAlpha = useAnnotationStore((s) => s.setActiveAlpha);
  const realphaAnnotation = useAnnotationStore((s) => s.realphaAnnotation);
  // Story 2.9: the active memo box size (default for new memos) lives in the store
  // next to activeColor/activeStrokeWidth — two writers (the rail's SizeRow AND
  // the memo selection quick-box's resize) plus the placement gesture reads it.
  const activeMemoSize = useAnnotationStore((s) => s.activeMemoSize);
  const setActiveMemoSize = useAnnotationStore((s) => s.setActiveMemoSize);
  const resizeMemoAnnotation = useAnnotationStore((s) => s.resizeMemoAnnotation);
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
  // Story 5.0: the four active-default mirrors (color, stroke width, alpha, memo
  // size) collapse into ONE object ref the document-level listeners read without
  // re-binding. Same values, refreshed every render exactly like the prior scalar
  // refs — internal-only (the store's public `active*` API is unchanged).
  const defaultsRef = useRef({
    color: activeColor,
    strokeWidth: activeStrokeWidth,
    alpha: activeAlpha,
    memoSize: activeMemoSize,
  });
  defaultsRef.current = {
    color: activeColor,
    strokeWidth: activeStrokeWidth,
    alpha: activeAlpha,
    memoSize: activeMemoSize,
  };
  const rectReaderRef = useRef(rectReader);
  rectReaderRef.current = rectReader;
  // Comment CLICK candidate (Codex MED): the pointerdown origin of a potential
  // comment-pin click, so a FAILED text drag (down, move far, release with an
  // empty selection) does NOT drop an accidental pin — the release must be within
  // click slop of its own pointerdown. Null = no candidate this gesture.
  const commentDownRef = useRef<{ x: number; y: number } | null>(null);

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

  const pending = state.status === "pending" ? state : null;
  // Readable from the disarm effect below without making `pending` a dep.
  const pendingRef = useRef(false);
  pendingRef.current = pending !== null;

  // Shared text-anchor create helper (Story 2.12, Decision 2): builds a
  // text-anchor mark from a selection + tool type, adds it, clears the live
  // selection, and selects the first created annotation. Called by BOTH the
  // armed onPointerUp branch AND commitTool so there is one code path.
  // Defined before the useEffect that references it in deps to avoid TDZ.
  const createTextTool = useCallback(
    (pages: PageSelection[], tool: "highlight" | "underline" | "comment") => {
      const created = buildAnnotations(pages, docId, {
        now: new Date().toISOString(),
        newId,
        type: tool,
        color: defaultsRef.current.color,
        ...(tool === "comment" ? { body: "" } : {}),
      });
      created.forEach(addAnnotation);
      window.getSelection()?.removeAllRanges();
      select(created[0].id);
    },
    [docId, addAnnotation, select],
  );

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
    // Record the comment-click candidate at pointerdown over a valid page spot, so
    // the pointerup click path can reject a release that wandered (a failed drag).
    const onPointerDownCandidate = (e: PointerEvent) => {
      if (armedToolRef.current !== "comment" || e.button !== 0 || isExempt(e.target)) {
        commentDownRef.current = null;
        return;
      }
      const el = e.target as Element | null;
      if (
        !el?.closest?.(".page-surface") ||
        el.closest?.(".quick-box") ||
        el.closest?.(".annotation-comment-pin") ||
        el.closest?.(".comment-bubble") ||
        el.closest?.(".annotation-highlight, .annotation-pen, .annotation-memo")
      ) {
        commentDownRef.current = null;
        return;
      }
      commentDownRef.current = { x: e.clientX, y: e.clientY };
    };
    const onPointerUp = (e: PointerEvent) => {
      if (e.button !== 0 || isExempt(e.target)) return;
      // Pen and memo have their OWN gesture paths (below); neither reads the text
      // selection (pen = a drag, memo = a click-to-place).
      if (armedToolRef.current === "pen" || armedToolRef.current === "memo") return;
      const selection = window.getSelection();
      const pages = rectsFromSelection(
        selection,
        getPagesRef.current(),
        scaleRef.current,
        rectReaderRef.current,
      );
      const tool = armedToolRef.current;
      if (pages.length === 0) {
        // No text selection. For COMMENT (armed): drop a pin at the click point
        // (AD-5: `comment → rect`). For cursor mode (tool=null): pop the
        // Comment+Memo picker (Story 2.12). Other tools do nothing.
        if (tool === "comment") {
          const el = e.target as Element | null;
          // A real CLICK: the release must be within click slop of a pointerdown
          // that started on a valid page spot (Codex MED). A failed/whitespace drag
          // (moved far, empty selection) fails this and drops no pin.
          const down = commentDownRef.current;
          commentDownRef.current = null;
          if (
            !down ||
            Math.hypot(e.clientX - down.x, e.clientY - down.y) > COMMENT_CLICK_SLOP ||
            !el?.closest?.(".page-surface") ||
            el.closest?.(".quick-box") ||
            el.closest?.(".annotation-comment-pin") ||
            el.closest?.(".comment-bubble") ||
            el.closest?.(".annotation-highlight, .annotation-pen, .annotation-memo")
          )
            return;
          const pgs = getPagesRef.current();
          const cardBoxes = pgs.map((p) => p.cardEl.getBoundingClientRect());
          const idx = pickPage(
            { left: e.clientX, top: e.clientY, right: e.clientX, bottom: e.clientY },
            cardBoxes.map((c) => ({ left: c.left, top: c.top, right: c.right, bottom: c.bottom })),
          );
          if (idx < 0) return;
          const page = pgs[idx];
          const cardRect = cardBoxes[idx];
          const x0 = e.clientX - cardRect.left;
          const y0 = e.clientY - cardRect.top;
          // A degenerate (point) rect: the pin renders at its top-left, no box.
          const rect = normalizeRect({ x0, y0, x1: x0, y1: y0 }, page.box, scaleRef.current);
          const created = buildCommentPin({ page_index: page.pageIndex, rect }, docId, {
            now: new Date().toISOString(),
            newId,
            color: defaultsRef.current.color,
          });
          addAnnotation(created);
          select(created.id);
        }
        return;
      }
      if (tool === "highlight" || tool === "underline" || tool === "comment") {
        // Create-on-release for any text-anchor tool via the shared helper
        // (Decision 2, Story 2.12): one code path for armed and picker paths.
        createTextTool(pages, tool);
        return;
      }
      // Any OTHER armed tool (pen/memo — their own gesture paths above) must NOT
      // fall through to the cursor-mode picker: that would pop it as if nothing
      // were armed. Only cursor mode (tool === null) reaches it.
      if (tool !== null) return;
      // Cursor mode with a text drag: pop the H/U/C picker.
      restoreFocusRef.current = document.activeElement as HTMLElement | null;
      dispatch({ type: "present", selection: pages, at: { x: e.clientX, y: e.clientY } });
    };
    // Double-click on empty page area (cursor mode): pop the Comment+Memo picker.
    // Single clicks don't trigger it; double-clicking on text selects a word and
    // the second pointerup's rectsFromSelection produces pages.length>0, which pops
    // the H/U/C picker instead (both behave like text drag — user request).
    const onDblClick = (e: MouseEvent) => {
      if (e.button !== 0 || isExempt(e.target) || armedToolRef.current !== null) return;
      const selection = window.getSelection();
      const pages = rectsFromSelection(
        selection,
        getPagesRef.current(),
        scaleRef.current,
        rectReaderRef.current,
      );
      if (pages.length > 0) return; // text selected — pointerup already handled it
      const el = e.target as Element | null;
      if (
        el?.closest?.(".page-surface") &&
        !el.closest?.(".quick-box") &&
        !el.closest?.(
          ".annotation-highlight, .annotation-pen, .annotation-memo, .annotation-comment-pin, .comment-bubble",
        )
      ) {
        restoreFocusRef.current = document.activeElement as HTMLElement | null;
        dispatch({ type: "present", selection: [], at: { x: e.clientX, y: e.clientY } });
      }
    };
    document.addEventListener("pointerdown", onPointerDownCandidate);
    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("dblclick", onDblClick);
    return () => {
      document.removeEventListener("pointerdown", onPointerDownCandidate);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("dblclick", onDblClick);
    };
  }, [enabled, docId, addAnnotation, select, createTextTool]);

  // Empty-memo cleanup (Story 2.9, Decision 5): a memo placed but never typed into
  // is a no-op, not a stray box — remove it when it loses selection with an empty
  // body. Keyed on DESELECT (not a raw textarea blur): clicking a color/size swatch
  // in the memo's own quick-box blurs the textarea WITHOUT deselecting the memo, so
  // a blur-based delete would nuke the memo mid-recolor. When `selectedId` moves off
  // a memo whose body is still empty, delete it; a memo with text stays.
  const prevSelectedRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevSelectedRef.current;
    prevSelectedRef.current = selectedId;
    if (!prev || prev === selectedId) return;
    const m = annotations.get(prev);
    if (m && m.type === "memo" && (m.body ?? "").trim() === "") deleteAnnotation(prev);
  }, [selectedId, annotations, deleteAnnotation]);

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

  // Cursor-mode tool-type picker action (Story 2.12): creates the chosen mark
  // and routes into the tool's existing affordance. Text drag (selection.length>0):
  // H/U/C via createTextTool (Decision 2). Click (selection.length===0): Comment
  // pin or Memo placed at pending.at (user fix: click-mode shows Comment+Memo).
  // activeTool is unchanged (one-shot create, not a sticky arm — Decision 5).
  const commitTool = useCallback(
    (tool: "highlight" | "underline" | "comment" | "memo") => {
      if (!pending) return;
      if (pending.selection.length > 0) {
        // Text drag: H/U/C only.
        if (tool !== "highlight" && tool !== "underline" && tool !== "comment") return;
        createTextTool(pending.selection, tool);
        dispatch({ type: "commit" });
      } else {
        // Click on empty page: place Comment pin or Memo at the click point.
        const { x, y } = pending.at;
        const pgs = getPagesRef.current();
        const cardBoxes = pgs.map((p) => p.cardEl.getBoundingClientRect());
        const idx = pickPage(
          { left: x, top: y, right: x, bottom: y },
          cardBoxes.map((c) => ({ left: c.left, top: c.top, right: c.right, bottom: c.bottom })),
        );
        if (idx < 0) return;
        const page = pgs[idx];
        const cardRect = cardBoxes[idx];
        const scale = scaleRef.current;
        const x0 = x - cardRect.left;
        const y0 = y - cardRect.top;
        const now = new Date().toISOString();
        if (tool === "comment") {
          const rect = normalizeRect({ x0, y0, x1: x0, y1: y0 }, page.box, scale);
          const created = buildCommentPin({ page_index: page.pageIndex, rect }, docId, {
            now,
            newId,
            color: defaultsRef.current.color,
          });
          addAnnotation(created);
          window.getSelection()?.removeAllRanges();
          dispatch({ type: "commit" });
          select(created.id);
        } else if (tool === "memo") {
          const size = defaultsRef.current.memoSize;
          const rect = normalizeRect(
            { x0, y0, x1: x0 + size.width * scale, y1: y0 + size.height * scale },
            page.box,
            scale,
          );
          const created = buildMemoAnnotation({ page_index: page.pageIndex, rect }, docId, {
            now,
            newId,
            color: defaultsRef.current.color,
          });
          addAnnotation(created);
          window.getSelection()?.removeAllRanges();
          dispatch({ type: "commit" });
          select(created.id);
        }
      }
    },
    [pending, docId, addAnnotation, select, createTextTool],
  );

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
      // A mark is a text rect (.annotation-highlight, incl. underline), a pen path,
      // OR a memo box (.annotation-memo).
      if (t?.closest?.(".annotation-highlight, .annotation-pen, .annotation-memo"))
        setSelectionBoxOpen(true);
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

  // Restroke the selected pen mark to a new width (Story 2.8 — the stroke-width
  // twin of recolorSelected). Also sets the default for the next stroke
  // (last-choice-wins). Unlike recolor, this KEEPS the quick-box open (only the
  // picker's own step menu collapses) so the user can keep tuning thickness/opacity
  // without re-selecting the mark — mirrors the rail pen flyout.
  const restrokeSelected = useCallback(
    (width: number) => {
      restrokeAnnotation(selectedGroupIds(), width, new Date().toISOString());
      setActiveStrokeWidth(width);
    },
    [restrokeAnnotation, selectedGroupIds, setActiveStrokeWidth],
  );

  // Re-alpha the selected pen mark to a new transparency (Story 2.13 — the alpha
  // twin of restrokeSelected). Also sets the default for the next stroke
  // (last-choice-wins). Like restroke, KEEPS the quick-box open (only the picker's
  // step menu collapses).
  const realphaSelected = useCallback(
    (alpha: number) => {
      realphaAnnotation(selectedGroupIds(), alpha, new Date().toISOString());
      setActiveAlpha(alpha);
    },
    [realphaAnnotation, selectedGroupIds, setActiveAlpha],
  );

  // Resize the selected memo to a new box size (Story 2.9 — the size twin of
  // restrokeSelected). The SizeRow gives a scale-1.0 px preset; convert it to a
  // normalized fraction of the memo's page box (scale cancels) so the store stays
  // geometry-free, keeping the top-left anchor. Also sets the session default
  // (last-choice-wins); the pick dismisses the box (the memo stays selected).
  const resizeSelected = useCallback(
    (size: MemoSize) => {
      if (!selectedAnno || selectedAnno.anchor.kind !== "rect") return;
      const page = getPagesRef.current().find((p) => p.pageIndex === selectedAnno.anchor.page_index);
      if (page) {
        const w = page.box.width > 0 ? size.width / page.box.width : 0;
        const h = page.box.height > 0 ? size.height / page.box.height : 0;
        resizeMemoAnnotation(selectedGroupIds(), { w, h }, new Date().toISOString());
      }
      setActiveMemoSize(size);
      setSelectionBoxOpen(false);
    },
    [selectedAnno, resizeMemoAnnotation, selectedGroupIds, setActiveMemoSize],
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
      // A comment's pin (a focusable control) and its bubble are part of the
      // selected mark's affordance, so clicking them must NOT clear the selection.
      const onMark = !!t?.closest?.(
        ".annotation-highlight, .annotation-pen, .annotation-memo, .annotation-comment-pin, .comment-bubble",
      );
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

  // A box needs anchor geometry to position against: a text mark with >=1 rect,
  // a pen path with >=1 point, or a memo/region rect (always present). A real mark
  // always has geometry.
  // A memo owns its own focus (its textarea autofocuses for typing), so the box
  // must not steal focus to the first swatch on open — the focus effect checks this.
  const isMemoSelected = selectedAnno?.anchor.kind === "rect" && selectedAnno.type === "memo";
  // Story 5.0: the selected mark's quick-box capability comes from the descriptor
  // registry (one source per tool), replacing the inline `isPen`/`isMemo`/comment
  // booleans that drove the rows + aria-label + the comment-exclusion gate.
  const selectedSpec = selectedAnno ? quickBoxSpec(selectedAnno) : null;
  // A COMMENT shows the comment-bubble (in AnnotationLayer), NOT the generic
  // selection quick-box (UX-DR5: comment mode → bubble directly; Decision 4). So
  // the shared box is gated off when the descriptor routes to the bubble.
  const showSelectionBox =
    selectionBoxOpen &&
    selectedAnno !== null &&
    selectedSpec !== null &&
    !selectedSpec.usesBubble &&
    ((selectedAnno.anchor.kind === "text" && selectedAnno.anchor.rects.length > 0) ||
      (selectedAnno.anchor.kind === "path" && selectedAnno.anchor.points.length > 0) ||
      selectedAnno.anchor.kind === "rect");

  // Project the selected mark to the box-anchor viewport point, re-derived from
  // the anchor service so it tracks zoom (clamped in layout). Anchored just BELOW
  // the mark (left-aligned to its start) so the floating box never covers it:
  // for text, below the selection's LOWEST line; for a pen stroke, below the
  // stroke's bounding box, left at its leftmost point.
  const selectionPoint = (): { x: number; y: number } => {
    if (!selectedAnno) return { x: 0, y: 0 };
    const page = getPagesRef.current().find((p) => p.pageIndex === selectedAnno.anchor.page_index);
    if (!page) return { x: 0, y: 0 };
    const cardRect = page.cardEl.getBoundingClientRect();
    const scale = scaleRef.current;
    if (selectedAnno.anchor.kind === "text" && selectedAnno.anchor.rects.length > 0) {
      const rects = selectedAnno.anchor.rects;
      const first = denormalizeRect(rects[0], page.box, scale);
      let bottom = first.top + first.height;
      for (const r of rects) {
        const p = denormalizeRect(r, page.box, scale);
        bottom = Math.max(bottom, p.top + p.height);
      }
      return { x: cardRect.left + first.left, y: cardRect.top + bottom + QUICK_BOX_GAP };
    }
    if (selectedAnno.anchor.kind === "path" && selectedAnno.anchor.points.length > 0) {
      let left = Infinity;
      let bottom = -Infinity;
      for (const pt of selectedAnno.anchor.points) {
        const d = denormalizePoint(pt, page.box, scale);
        left = Math.min(left, d.x);
        bottom = Math.max(bottom, d.y);
      }
      return { x: cardRect.left + left, y: cardRect.top + bottom + QUICK_BOX_GAP };
    }
    if (selectedAnno.anchor.kind === "rect") {
      // A memo: anchor below the box, left-aligned to it. The box's on-screen
      // bottom is the denormalized rect bottom (its min-height; typed content can
      // push it lower, but the rect bottom is a stable, zoom-glued anchor).
      const r = denormalizeRect(selectedAnno.anchor.rect, page.box, scale);
      return { x: cardRect.left + r.left, y: cardRect.top + r.top + r.height + QUICK_BOX_GAP };
    }
    return { x: 0, y: 0 };
  };

  // The size step the memo size picker shows ARMED: the SELECTED memo's OWN size
  // (its rect, the single source per AD-5), NOT the session default — otherwise an
  // older memo shows the wrong step after the default changed (Codex LOW). Convert
  // the rect width back to scale-1.0 px against the memo's page box and match the
  // nearest preset; fall back to the active default when the page isn't resolvable.
  const selectedMemoSize = (): MemoSize => {
    if (!selectedAnno || selectedAnno.anchor.kind !== "rect") return activeMemoSize;
    const page = getPagesRef.current().find((p) => p.pageIndex === selectedAnno.anchor.page_index);
    if (!page || page.box.width <= 0) return activeMemoSize;
    const widthPx = (selectedAnno.anchor.rect.x1 - selectedAnno.anchor.rect.x0) * page.box.width;
    let best = MEMO_SIZES[0];
    for (const s of MEMO_SIZES) {
      if (Math.abs(s.width - widthPx) < Math.abs(best.width - widthPx)) best = s;
    }
    return best;
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
      if (!restoreSelectionFocusRef.current && !isMemoSelected) {
        // First open: remember where focus was, move it into the box. EXCEPTION:
        // a memo owns its focus (its textarea is autofocused for typing) — pulling
        // focus to the first swatch would fight that, so the memo box never grabs
        // focus on open. The textarea is the keyboard entry point; the quick-box
        // swatches stay reachable by Tab.
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

  if (!pending && !showSelectionBox && !penPreview && !boxPreview) return null;

  const selInit = showSelectionBox ? selectionPoint() : { x: 0, y: 0 };

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
          <path d={previewPath} fill={`var(--color-${activeColor})`} fillOpacity={activeAlpha} />
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
            borderColor: `var(--color-${activeColor})`,
          }}
        />
      )}
      {pending && (
        // Cursor-mode tool-type picker (Story 2.12). Drag-select → H/U/C (icon
        // only). Click on empty page → Comment+Memo (icon only). Machine, shell,
        // position/clamp, focus-in/return, and dismiss plumbing unchanged.
        <div
          ref={quickBoxRef}
          className="quick-box"
          role="menu"
          aria-label="Annotation tools"
          data-testid="quick-box"
          style={{ left: pending.at.x, top: pending.at.y }}
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
          className="quick-box"
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
          {selectedSpec.size && <SizeRow value={selectedMemoSize()} onPick={resizeSelected} />}
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
