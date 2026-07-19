// useCreateQuickBox — the CREATE quick-box's armed-tool / pending state
// machine (Story 5.3 extraction, mirrors `useSelection.ts`'s shape: the
// selected-mark quick-box's Story 5.0 twin). Create timing is keyed off the
// armed tool (single source in App), and BOTH create paths land in the SAME
// selection quick-box (Story 2.5 unification, AD-12):
//   - Highlight armed → the mark LANDS on drag-release at the default color
//     (create-on-release) and is immediately SELECTED → the selection quick-box.
//   - Cursor (no tool) → the Story 2.2 proof: a single "Highlight" action that
//     creates the mark on click, then selects it (the cursor-mode tool-type
//     picker is Story 2.12).
//
// Document-level handlers (Epic-1 retro AP-1): pointer/key handlers bind on
// `document`, phase-gated (`enabled`), exempting editable fields + buttons.

import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState, type RefObject } from "react";
import {
  rectsFromSelection,
  normalizeRect,
  pickPage,
  pendingSelectionGeometry,
  viewportRectsFromPages,
  type PageCardRef,
  type PageSelection,
} from "@/anchor";
import { useAnnotationStore } from "@/store";
import { newId } from "@/lib/uuid";
import { isEditableTarget } from "@/lib/domFocus";
import { buildAnnotations, buildMemoAnnotation, buildCommentPin } from "@/annotations/create";
import type { SelectionRect } from "@/annotations/position";
import { initialOverlayState, overlayReducer, type AnnotationTool, type OverlayState } from "@/annotations/machine";
import { isExempt, type ActiveDefaults } from "./shared";

/** Max pointer travel (px) between a comment pointerdown and its release for the
 *  release to still count as a CLICK (drops a pin). Beyond this it was a drag. */
const COMMENT_CLICK_SLOP = 5;

/** The CREATE quick-box's live viewport geometry, re-derived (not frozen) so it
 *  survives zoom/scroll — see `computePendingGeometry` below. Exactly one of
 *  `selRect`/`boxAt` is set: a text drag exposes its selection BOUNDS
 *  (`selRect`, placed via `placeBesideSelection`); an empty click exposes a
 *  single point (`boxAt`, placed via `clampToViewport`). */
export interface PendingViewportGeometry {
  selRect: SelectionRect | null;
  boxAt: { x: number; y: number } | null;
  previewRects: { left: number; top: number; width: number; height: number }[];
}

type Pending = Extract<OverlayState, { status: "pending" }>;

export interface CreateQuickBoxApi {
  pending: Pending | null;
  pendingGeometry: PendingViewportGeometry | null;
  quickBoxRef: RefObject<HTMLDivElement | null>;
  dismiss: () => void;
  /** Cursor-mode tool-type picker action (Story 2.12): creates the chosen mark
   *  and routes into the tool's existing affordance. Text drag
   *  (`pending.selection.length>0`): H/U/C via the shared create helper
   *  (Decision 2). Click (`selection.length===0`): Comment pin or Memo placed
   *  at the pending anchor. `activeTool` is unchanged (one-shot create, not a
   *  sticky arm — Decision 5). */
  commitTool: (tool: "highlight" | "underline" | "comment" | "memo") => void;
}

export function useCreateQuickBox(opts: {
  enabled: boolean;
  docId: string;
  scale: number;
  getPagesRef: RefObject<() => PageCardRef[]>;
  scaleRef: RefObject<number>;
  defaultsRef: RefObject<ActiveDefaults>;
  /** Reactive: drives the arm/disarm sync effect below. */
  armedTool: AnnotationTool | null;
  /** Stable mirror of `armedTool`, for the document listeners (bound once,
   *  read live) so switching tools never re-binds them. */
  armedToolRef: RefObject<AnnotationTool | null>;
  rectReaderRef: RefObject<((r: Range) => ArrayLike<DOMRect>) | undefined>;
  /** True while ANY box mode (box-highlight or box-comment, Story 8.4) is
   *  active: `useBoxGesture` owns mark creation for the drag/click while this
   *  is true, so this hook must NOT also create (Design D3). */
  boxActive: boolean;
}): CreateQuickBoxApi {
  const { enabled, docId, scale, getPagesRef, scaleRef, defaultsRef, armedTool, armedToolRef, rectReaderRef, boxActive } =
    opts;
  // Stable mirror of `boxActive` for the document-level listeners (bound once,
  // read live), same pattern as `armedToolRef` — a box-mode toggle never
  // re-binds the listeners below.
  const boxActiveRef = useRef(boxActive);
  boxActiveRef.current = boxActive;

  const [state, dispatch] = useReducer(overlayReducer, initialOverlayState);
  const addAnnotation = useAnnotationStore((s) => s.addAnnotation);
  const addAnnotations = useAnnotationStore((s) => s.addAnnotations);
  const annotations = useAnnotationStore((s) => s.annotations);
  const selectedId = useAnnotationStore((s) => s.selectedId);
  const select = useAnnotationStore((s) => s.select);
  const deleteAnnotation = useAnnotationStore((s) => s.deleteAnnotation);

  const quickBoxRef = useRef<HTMLDivElement | null>(null);
  // The element focused before the create quick-box opened, restored on dismiss.
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  // Comment CLICK candidate (Codex MED): the pointerdown origin of a potential
  // comment-pin click, so a FAILED text drag (down, move far, release with an
  // empty selection) does NOT drop an accidental pin — the release must be within
  // click slop of its own pointerdown. Null = no candidate this gesture.
  const commentDownRef = useRef<{ x: number; y: number } | null>(null);

  const pending = state.status === "pending" ? state : null;
  // Readable from the disarm effect below without making `pending` a dep.
  const pendingRef = useRef(false);
  pendingRef.current = pending !== null;

  // Where the CREATE quick-box's release-point anchors, as a page index +
  // fraction (not a frozen viewport point) — captured ONLY for the empty-click
  // case (Comment+Memo picker); a text-drag selection already carries its own
  // normalized rects (`pending.selection`), reprojected directly on every
  // recompute. Mirrors Reader's own zoom focal-point pattern (page + fraction,
  // re-derived from the LIVE card rect at read time) — the fix for the
  // selection "resetting" on zoom/scroll: the OLD frozen `pending.at` viewport
  // point went stale on zoom and the popup was unconditionally dismissed on
  // any scroll at all.
  const pendingClickAnchorRef = useRef<{ pageIndex: number; fracX: number; fracY: number } | null>(null);
  const [pendingGeometry, setPendingGeometry] = useState<PendingViewportGeometry | null>(null);

  // Re-derive the popup position + preview-highlight rects from LIVE page-card
  // geometry (`getBoundingClientRect`, which naturally reflects the current
  // scroll position) + the CURRENT scale. Called on open, on every
  // scroll/resize, and on every scale change (see the effects below) — so the
  // popup + preview track the actual text instead of the old dismiss-on-scroll/
  // stale-on-zoom behavior.
  const computePendingGeometry = useCallback((): PendingViewportGeometry | null => {
    if (state.status !== "pending") return null;
    const pgs = getPagesRef.current();
    const cardOf = (pageIndex: number): PageCardRef | null =>
      pgs.find((p) => p.pageIndex === pageIndex) ?? null;

    if (state.selection.length > 0) {
      const geom = pendingSelectionGeometry(
        state.selection,
        (pageIndex) => cardOf(pageIndex)?.box ?? null,
        scaleRef.current,
      );
      if (!geom) return null;
      // Clip each row to the reader's visible viewport: the preview is
      // `position: fixed` (it must span two page cards), so it does not
      // inherit `.pdf-canvas`'s scroll-clipping the way a real AnnotationLayer
      // mark does — a row scrolled past the top/bottom of the reader would
      // otherwise paint over the top-bar/other chrome instead of going hidden.
      const readerViewport = document.querySelector(".pdf-canvas")?.getBoundingClientRect() ?? null;
      const previewRects = viewportRectsFromPages(
        geom.pages,
        cardOf,
        readerViewport ? { top: readerViewport.top, bottom: readerViewport.bottom } : null,
      );
      const anchorCard = cardOf(geom.anchor.pageIndex);
      if (!anchorCard) return null;
      const anchorRect = anchorCard.cardEl.getBoundingClientRect();
      const { rect } = geom.anchor;
      return {
        selRect: {
          left: anchorRect.left + rect.left,
          top: anchorRect.top + rect.top,
          right: anchorRect.left + rect.right,
          bottom: anchorRect.top + rect.bottom,
        },
        boxAt: null,
        previewRects,
      };
    }

    // Click (empty selection): re-derive from the captured page + fraction.
    const clickAnchor = pendingClickAnchorRef.current;
    if (!clickAnchor) return null;
    const card = cardOf(clickAnchor.pageIndex);
    if (!card) return null;
    const cardRect = card.cardEl.getBoundingClientRect();
    return {
      selRect: null,
      boxAt: {
        x: cardRect.left + clickAnchor.fracX * cardRect.width,
        y: cardRect.top + clickAnchor.fracY * cardRect.height,
      },
      previewRects: [],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- getPagesRef/scaleRef are refs (stable, read live)
  }, [state]);

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
        color: defaultsRef.current.colors[tool],
        ...(tool === "comment" ? { body: "" } : {}),
      });
      addAnnotations(created);
      window.getSelection()?.removeAllRanges();
      select(created[0].id);
    },
    [docId, defaultsRef, addAnnotations, select],
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
      if (
        armedToolRef.current !== "comment" ||
        boxActiveRef.current ||
        e.button !== 0 ||
        isExempt(e.target)
      ) {
        commentDownRef.current = null;
        return;
      }
      // First-click-deselects (mirrors useMemoPlacement's user fix): if a mark is
      // currently selected, this click's job is to DESELECT it (useSelection's own
      // empty-space pointerdown handler does that, capture-phase) — not drop a new
      // pin under it. Read the pre-clear value via `.getState()`: this listener is
      // registered once at mount (stable deps below), so it fires before
      // useSelection's per-selection listener, which re-registers later in the
      // capture queue every time the selection changes. A second, fresh click
      // (nothing selected) creates normally.
      if (useAnnotationStore.getState().selectedId !== null) {
        commentDownRef.current = null;
        return;
      }
      const el = e.target as Element | null;
      if (
        !el?.closest?.(".page-surface") ||
        el.closest?.(".quick-box") ||
        el.closest?.(".annotation-comment-pin") ||
        el.closest?.(".comment-bubble") ||
        el.closest?.(".comment-preview") ||
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
      // A box mode (box-highlight or box-comment, Story 8.4) is active:
      // `useBoxGesture` owns this drag/click's create, so this path must not
      // ALSO fall through to the text-comment create or the click-pin below
      // (Design D3 — the single most likely double-create seam). Also clear any
      // candidate recorded by a pointerdown that landed BEFORE box mode turned
      // on (mid-gesture toggle) — otherwise it survives as a stale coordinate
      // for whichever pointerup next reads it (Codex 8.4 review, Low finding 4).
      if (boxActiveRef.current) {
        commentDownRef.current = null;
        return;
      }
      const selection = window.getSelection();
      const pages = rectsFromSelection(selection, getPagesRef.current(), scaleRef.current, rectReaderRef.current);
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
            el.closest?.(".comment-preview") ||
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
            color: defaultsRef.current.colors.comment,
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
      // Cursor mode with a text drag: pop the H/U/C picker. The native Selection
      // is deliberately LEFT ALIVE (bug fix) so Ctrl+C still copies the dragged
      // text — the picker's own preview highlight is denormalized from `pages`
      // and tracked through zoom/scroll by `computePendingGeometry`, so it never
      // reads the native Selection back. `dismiss()` still clears it on Esc/
      // outside-click, and any outside pointerdown runs (capture phase) before
      // this handler's own next pointerup, so a stale selection can never
      // re-pop the picker.
      restoreFocusRef.current = document.activeElement as HTMLElement | null;
      dispatch({ type: "present", selection: pages, at: { x: e.clientX, y: e.clientY } });
    };
    // Right-click (context menu) on a page in cursor mode: pop the Comment+Memo
    // place-at-point picker at the click, and suppress the native browser menu.
    // This is the deliberate "place a comment/memo here" gesture; a text DRAG still
    // pops the H/U/C picker (act-on-text), so the two are cleanly separated. Right-
    // click works over text too (place-at-point, not on a word). Replaces the old
    // empty-area double-click trigger, which a dense PDF's text layer made
    // unreachable — almost every double-click selected a word and popped H/U/C.
    const onContextMenu = (e: MouseEvent) => {
      if (isExempt(e.target) || armedToolRef.current !== null) return;
      const el = e.target as Element | null;
      if (
        !el?.closest?.(".page-surface") ||
        el.closest?.(".quick-box") ||
        el.closest?.(
          ".annotation-highlight, .annotation-pen, .annotation-memo, .annotation-comment-pin, .comment-bubble, .comment-preview",
        )
      )
        return;
      // Suppress the native menu + any lingering selection (so the pointerup text
      // path can't also fire), then present the picker at the click point.
      e.preventDefault();
      window.getSelection()?.removeAllRanges();
      restoreFocusRef.current = document.activeElement as HTMLElement | null;
      dispatch({ type: "present", selection: [], at: { x: e.clientX, y: e.clientY } });
    };
    // Capture phase (registered at mount): must read `selectedId` BEFORE
    // useSelection's own capture-phase deselect listener clears it (see the
    // comment above) — mirrors useMemoPlacement's same ordering requirement.
    document.addEventListener("pointerdown", onPointerDownCandidate, true);
    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("contextmenu", onContextMenu);
    return () => {
      document.removeEventListener("pointerdown", onPointerDownCandidate, true);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("contextmenu", onContextMenu);
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
  // Scrolling no longer dismisses (Story 4.x fix): the popup + preview now
  // TRACK scroll/zoom instead (the effects below), rather than treating any
  // canvas scroll — including the zoom feature's own focal-point-preserving
  // programmatic scroll adjustment — as "the user navigated away."
  useEffect(() => {
    if (!pending) return;
    // Story 5.6 (layered Esc, rung 1a): capture phase + stopImmediatePropagation
    // so this consumes its own Esc BEFORE App's fallback `Esc -> cursor` runs.
    // This effect re-registers on every `pending` flip, landing AFTER App's
    // already-mounted bubble listener — a bubble-phase stop would fire too late,
    // but capture always precedes bubble regardless of registration order.
    // Exempt editable targets so a focused editor's own Esc handler still runs.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (isEditableTarget(e.target)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      dismiss();
    };
    const onPointerDown = (e: PointerEvent) => {
      if (quickBoxRef.current && !quickBoxRef.current.contains(e.target as Node)) {
        dismiss();
      }
    };
    document.addEventListener("keydown", onKey, true);
    // Capture phase so the dismiss runs before a fresh selection's pointerdown.
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [pending, dismiss]);

  // Capture the click-to-place anchor (page + fraction) on a fresh open, set
  // the initial geometry before paint, and move focus INTO the quick-box —
  // returning it to the prior element on dismiss (EXPERIENCE.md accessibility
  // floor). Re-runs only when the pending IDENTITY changes (open/dismiss/
  // commit), not on every geometry recompute below.
  useLayoutEffect(() => {
    if (!pending) {
      pendingClickAnchorRef.current = null;
      setPendingGeometry(null);
      if (restoreFocusRef.current) {
        restoreFocusRef.current.focus?.();
        restoreFocusRef.current = null;
      }
      return;
    }
    if (pending.selection.length === 0) {
      const pgs = getPagesRef.current();
      const cardBoxes = pgs.map((p) => p.cardEl.getBoundingClientRect());
      const idx = pickPage(
        { left: pending.at.x, top: pending.at.y, right: pending.at.x, bottom: pending.at.y },
        cardBoxes.map((c) => ({ left: c.left, top: c.top, right: c.right, bottom: c.bottom })),
      );
      if (idx >= 0) {
        const cr = cardBoxes[idx];
        pendingClickAnchorRef.current = {
          pageIndex: pgs[idx].pageIndex,
          fracX: cr.width > 0 ? (pending.at.x - cr.left) / cr.width : 0,
          fracY: cr.height > 0 ? (pending.at.y - cr.top) / cr.height : 0,
        };
      }
    }
    setPendingGeometry(computePendingGeometry());
    // Focus the first action in the quick-box (proof button or first swatch).
    quickBoxRef.current?.querySelector<HTMLElement>("button")?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run on the pending IDENTITY change
  }, [pending]);

  // Keep the popup + preview glued to the actual text: re-derive geometry on
  // every scroll/resize while pending, and whenever `scale` changes (zoom).
  // This is what makes the selection survive zoom/scroll instead of going
  // stale or being dismissed.
  useEffect(() => {
    if (!pending) return;
    const reposition = () => setPendingGeometry(computePendingGeometry());
    reposition();
    // Capture phase: `scroll` does not bubble, and the scrolling element is
    // the pdf-canvas, not window.
    document.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      document.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [pending, scale, computePendingGeometry]);

  const commitTool = useCallback(
    (tool: "highlight" | "underline" | "comment" | "memo") => {
      if (!pending) return;
      if (pending.selection.length > 0) {
        // Text drag: H/U/C only.
        if (tool !== "highlight" && tool !== "underline" && tool !== "comment") return;
        createTextTool(pending.selection, tool);
        dispatch({ type: "commit" });
      } else {
        // Click on empty page: place Comment pin or Memo at the click point,
        // re-derived from the captured page + fraction anchor (NOT the frozen
        // `pending.at`) so it lands where the popup is actually showing now —
        // after any zoom/scroll since the click — not the stale release point.
        const anchor = pendingClickAnchorRef.current;
        if (!anchor) return;
        const pgs = getPagesRef.current();
        const page = pgs.find((p) => p.pageIndex === anchor.pageIndex);
        if (!page) return;
        const cardRect = page.cardEl.getBoundingClientRect();
        const s = scaleRef.current;
        const x0 = anchor.fracX * cardRect.width;
        const y0 = anchor.fracY * cardRect.height;
        const now = new Date().toISOString();
        if (tool === "comment") {
          const rect = normalizeRect({ x0, y0, x1: x0, y1: y0 }, page.box, s);
          const created = buildCommentPin({ page_index: page.pageIndex, rect }, docId, {
            now,
            newId,
            color: defaultsRef.current.colors.comment,
          });
          addAnnotation(created);
          window.getSelection()?.removeAllRanges();
          dispatch({ type: "commit" });
          select(created.id);
        } else if (tool === "memo") {
          const size = defaultsRef.current.memoSize;
          const rect = normalizeRect(
            { x0, y0, x1: x0 + size.width * s, y1: y0 + size.height * s },
            page.box,
            s,
          );
          const created = buildMemoAnnotation({ page_index: page.pageIndex, rect }, docId, {
            now,
            newId,
            color: defaultsRef.current.colors.memo,
            alpha: defaultsRef.current.alpha.memo,
          });
          addAnnotation(created);
          window.getSelection()?.removeAllRanges();
          dispatch({ type: "commit" });
          select(created.id);
        }
      }
    },
    [pending, docId, getPagesRef, scaleRef, defaultsRef, addAnnotation, select, createTextTool],
  );

  return { pending, pendingGeometry, quickBoxRef, dismiss, commitTool };
}
