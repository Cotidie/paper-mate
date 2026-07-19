// useSelection — the selected-mark quick-box (Story 2.5, AD-12), encapsulated
// (Story 5.0). Separate from the create machine (Decision B): driven by the store's
// `selectedId`, not `machine.ts`. Owns the selection-box visibility + focus refs,
// the open/close + key + dismiss effects, the recolor/restroke/realpha/resize/
// delete actions (each group-aware, AR-4), and the box's anchor geometry. The
// component renders the box from what this returns. Document-level handlers bind on
// `document`, phase-gated (AP-1); editable/buttons exempt.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { denormalizeRect, denormalizePoint, type PageCardRef } from "@/anchor";
import { useAnnotationStore, MEMO_SIZES, type MemoSize } from "@/store";
import type { Annotation } from "@/api/client";
import { clampToViewport, placeBesideSelection, QUICK_BOX_GAP, type SelectionRect } from "@/annotations/position";
import { quickBoxSpec, usesLeftVerticalQuickBox, hasOwnTextEntry, type QuickBoxSpec } from "@/annotations/marks";
import { isExempt } from "./shared";
import { isEditableTarget } from "@/lib/domFocus";

/** Blur whatever's focused if it's inside a memo (its textarea, the collapse
 *  toggle, or — while editable — a move/resize handle), before clearSelection
 *  drops the `--selected` ring. A plain click on a non-focusable page area does
 *  NOT blur the previously-focused element (the HTML focus-fixup rule: focus
 *  only changes if the new click target is itself focusable), so without this,
 *  DOM focus lingers on a memo control the user clicked or tabbed to — keeping
 *  its `:focus-visible` ring AND any `:focus-within`-gated chrome (the collapse
 *  toggle, Story 10.3) visible after the mark is no longer selected, making
 *  deselect look like a no-op. Matches `.closest(".annotation-memo")`, not an
 *  exact classname, so it covers every focusable descendant, not just the
 *  (never-focusable) outer wrapper. */
function blurMemoFocus(): void {
  const active = document.activeElement;
  if (active instanceof HTMLElement && active.closest(".annotation-memo")) active.blur();
}

export interface SelectionApi {
  /** The selected mark, scoped to THIS doc (null if nothing/other-doc selected). */
  selectedAnno: Annotation | null;
  /** The selected mark's quick-box capability (rows + label), or null. */
  selectedSpec: QuickBoxSpec | null;
  /** Whether the selection quick-box should render now. */
  showSelectionBox: boolean;
  /** Ref for the selection quick-box element (focus + outside-click + clamp). */
  selectionBoxRef: RefObject<HTMLDivElement | null>;
  /** The selected mark's viewport BOUNDS, re-derived so it tracks zoom. */
  selectionBounds: () => SelectionRect;
  /** The size step the memo size picker shows armed (the memo's OWN size). */
  selectedMemoSize: () => MemoSize;
  recolorSelected: (color: string) => void;
  restrokeSelected: (width: number) => void;
  realphaSelected: (alpha: number) => void;
  resizeSelected: (size: MemoSize) => void;
  /** Turn the selected text highlight into a text comment (Story 3.7). Group-aware;
   *  does NOT clear the selection so the comment's bubble opens for the same mark. */
  convertSelected: () => void;
  deleteSelected: () => void;
}

export function useSelection(opts: {
  enabled: boolean;
  docId: string;
  scale: number;
  getPagesRef: RefObject<() => PageCardRef[]>;
  scaleRef: RefObject<number>;
}): SelectionApi {
  const { enabled, docId, scale, getPagesRef, scaleRef } = opts;

  const annotations = useAnnotationStore((s) => s.annotations);
  const selectedId = useAnnotationStore((s) => s.selectedId);
  const dragPreview = useAnnotationStore((s) => s.dragPreview);
  const groupDragPreview = useAnnotationStore((s) => s.groupDragPreview);
  const clearSelection = useAnnotationStore((s) => s.clearSelection);
  const deleteAnnotation = useAnnotationStore((s) => s.deleteAnnotation);
  const recolorAnnotation = useAnnotationStore((s) => s.recolorAnnotation);
  const restrokeAnnotation = useAnnotationStore((s) => s.restrokeAnnotation);
  const realphaAnnotation = useAnnotationStore((s) => s.realphaAnnotation);
  const resizeMemoAnnotation = useAnnotationStore((s) => s.resizeMemoAnnotation);
  const retypeAnnotation = useAnnotationStore((s) => s.retypeAnnotation);
  const setActiveColor = useAnnotationStore((s) => s.setActiveColor);
  const setActiveStrokeWidth = useAnnotationStore((s) => s.setActiveStrokeWidth);
  const setActiveAlpha = useAnnotationStore((s) => s.setActiveAlpha);
  const setActiveMemoSize = useAnnotationStore((s) => s.setActiveMemoSize);
  const activeMemoSize = useAnnotationStore((s) => s.activeMemoSize);

  const selectionBoxRef = useRef<HTMLDivElement | null>(null);
  const restoreSelectionFocusRef = useRef<HTMLElement | null>(null);
  const [selectionBoxOpen, setSelectionBoxOpen] = useState(false);

  // Scope the resolved mark to THIS doc: the store is global and not cleared on doc
  // switch (Epic 3), so a stale `selectedId` from another document must not render a
  // box or be mutated here. (The clear-on-doc-switch effect is the primary guard.)
  const selectedRaw = selectedId ? annotations.get(selectedId) ?? null : null;
  const selectedAnno = selectedRaw && selectedRaw.doc_id === docId ? selectedRaw : null;

  // The selected mark's LIVE anchor (bug fix: moving/resizing it via the edit
  // frame's drag handles only commits to `annotations` on release — the quick-box
  // used to keep computing its position from the stale pre-drag anchor, which
  // never updated because neither `selectedId` nor `scale` change during a move,
  // so it landed on top of the mark's NEW spot after the drag. Mirrors
  // AnnotationLayer's own `effAnchor`: prefer the transient drag/group-drag
  // preview over the committed anchor, tracking the mark live during the drag too.
  const effectiveAnchor: Annotation["anchor"] | null = selectedAnno
    ? (dragPreview && dragPreview.id === selectedAnno.id
        ? dragPreview.anchor
        : (groupDragPreview?.find((g) => g.id === selectedAnno.id)?.anchor ?? selectedAnno.anchor))
    : null;

  // A doc switch (the singleton store survives it) must drop any prior selection so
  // it can't be recolored/deleted from the new reader. Runs once on mount too.
  useEffect(() => {
    clearSelection();
  }, [docId, clearSelection]);

  // Clicking ANY mark (re)opens its quick-box. Bound always-on (phase-gated) so the
  // FIRST selection opens it too, and re-clicking the same mark reopens it after a
  // pick/scroll closed it. Capture phase, before the click selects it.
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

  // Open the box on a new selection; close it when nothing is selected (e.g. after
  // a delete). A pick/scroll closes it WITHOUT changing `selectedId`, so this effect
  // won't re-run and reopen it; re-clicking the mark does (above). Also re-run on a
  // `type` change (Story 3.7 convert): a reverse convert keeps the SAME `selectedId`
  // but flips the mark off the bubble route onto this generic box, so a stale
  // `false` left by an earlier scroll must not suppress it (Codex review finding).
  useEffect(() => {
    setSelectionBoxOpen(selectedId !== null);
  }, [selectedId, selectedAnno?.type]);

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
      // the next new mark OF THE SAME TOOL (Story 2.6 request 3 — last-choice-wins,
      // either path; per-tool split so recoloring a pen never touches the
      // highlight/memo/etc default).
      if (selectedAnno) setActiveColor(selectedAnno.type, color);
      // KEEPS the box open (user fix request), matching restrokeSelected/
      // realphaSelected below: the mark is still selected, so the user may want to
      // try another color (or another row) without re-opening the box each time.
    },
    [recolorAnnotation, selectedGroupIds, setActiveColor, selectedAnno],
  );

  // Restroke the selected pen mark to a new width (Story 2.8). Also sets the default
  // (last-choice-wins). Unlike recolor, KEEPS the quick-box open (only the picker's
  // step menu collapses) so the user can keep tuning — mirrors the rail pen flyout.
  const restrokeSelected = useCallback(
    (width: number) => {
      restrokeAnnotation(selectedGroupIds(), width, new Date().toISOString());
      setActiveStrokeWidth(width);
    },
    [restrokeAnnotation, selectedGroupIds, setActiveStrokeWidth],
  );

  // Re-alpha the selected pen or memo mark (Story 2.13; memo added by fix
  // request). Also sets that tool's OWN default (per-tool, mirrors recolor);
  // KEEPS the box open (only the picker's step menu collapses).
  const realphaSelected = useCallback(
    (alpha: number) => {
      if (!selectedAnno || (selectedAnno.type !== "pen" && selectedAnno.type !== "memo")) return;
      realphaAnnotation(selectedGroupIds(), alpha, new Date().toISOString());
      setActiveAlpha(selectedAnno.type, alpha);
    },
    [selectedAnno, realphaAnnotation, selectedGroupIds, setActiveAlpha],
  );

  // Resize the selected memo (Story 2.9). The SizeRow gives a scale-1.0 px preset;
  // convert it to a normalized fraction of the memo's page box (scale cancels) so
  // the store stays geometry-free, keeping the top-left anchor. Also sets the
  // session default; the pick dismisses the box (the memo stays selected).
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
    [selectedAnno, resizeMemoAnnotation, selectedGroupIds, setActiveMemoSize, getPagesRef],
  );

  // Turn the selected text highlight into a text comment (Story 3.7, AC1): one
  // retypeAnnotation command, group-aware. Unlike recolor/resize, does NOT close
  // the box or clear the selection — the mark stays selected so the comment
  // descriptor (usesBubble=true) takes over and its bubble opens for it.
  const convertSelected = useCallback(() => {
    retypeAnnotation(selectedGroupIds(), "comment", "", new Date().toISOString());
  }, [retypeAnnotation, selectedGroupIds]);

  // Delete via the store (removes id + group siblings AND clears `selectedId`).
  // Uses the doc-scoped mark so a stale cross-doc id can never be deleted here.
  const deleteSelected = useCallback(() => {
    if (selectedAnno) deleteAnnotation(selectedAnno.id);
  }, [selectedAnno, deleteAnnotation]);

  // Selection keys + dismiss, document-level + phase-gated (AP-1). Live only while a
  // current-doc mark is selected so we don't shadow other handlers.
  useEffect(() => {
    if (!enabled || !selectedAnno) return;
    const onKey = (e: KeyboardEvent) => {
      // Skip chords first. Then exempt only EDITABLE fields (INPUT/TEXTAREA/
      // contentEditable) via the NARROW `isEditableTarget`, NOT buttons: Delete/
      // Escape are not a button's own activation keys (Enter/Space are), so a
      // focused control must never swallow them. The broad `isExempt`/
      // `isControlTarget` used here before silently ate the user's first Del/Esc
      // after clicking ANY button that kept focus (a tool-rail button, an Annotation
      // Bank pill, or the selection box's own auto-focused first swatch) until they
      // clicked elsewhere. `domFocus.ts` documents exactly this split: keyboard
      // handlers want `isEditableTarget`, pointer handlers (the deselect one below)
      // want `isExempt`.
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      // The one editable field we DO still act through: the selected memo's OWN
      // textarea, so Delete removes the memo even mid-typing (user bug report),
      // unlike a normal input where Delete is a text edit. Scoped by the exact
      // data-testid MemoBox's inner textarea carries (the OUTER box keeps
      // `annotation-mark-${id}`; the textarea child is `memo-body-${id}`), so this
      // can only ever match the currently selected memo's own textarea, never a
      // bystander field (mirrors CommentBubble's own Delete override for its bubble
      // textarea). A COLLAPSED memo has no textarea, so this naturally never matches.
      const inOwnMemoTextarea =
        selectedAnno.type === "memo" &&
        (e.target as HTMLElement | null)?.getAttribute?.("data-testid") ===
          `memo-body-${selectedAnno.id}`;
      if (!inOwnMemoTextarea && isEditableTarget(e.target)) return;
      if (e.key === "Escape") {
        // Esc clears the selection (the App-level Esc->cursor also runs). Blur
        // first (see the pointerdown handler below for why).
        blurMemoFocus();
        clearSelection();
        return;
      }
      if (e.key === "Delete") {
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
        ".annotation-highlight, .annotation-pen, .annotation-memo, .annotation-comment-pin, .comment-bubble, .comment-preview",
      );
      const inBox = selectionBoxRef.current?.contains(t as Node) ?? false;
      if (!onMark && !inBox) {
        blurMemoFocus();
        clearSelection();
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [enabled, selectedAnno, clearSelection, deleteAnnotation]);

  // Left-vertical layout (memo, box comment, or box highlight — fix request)
  // vs. the "owns its own focus" subset (memo or box comment only — a box
  // highlight has no textarea, so it keeps the default first-swatch autofocus
  // the effect below applies). Two DIFFERENT sets — see marks.ts.
  const isVerticalQuickBox = usesLeftVerticalQuickBox(selectedAnno);
  const ownsOwnFocus = hasOwnTextEntry(selectedAnno);
  // Story 5.0: the selected mark's quick-box capability comes from the descriptor
  // registry (one source per tool).
  const selectedSpec = selectedAnno ? quickBoxSpec(selectedAnno) : null;
  // A COMMENT shows the comment-bubble (in AnnotationLayer), NOT the generic
  // selection quick-box (UX-DR5; Decision 4). So the shared box is gated off when
  // the descriptor routes to the bubble.
  const showSelectionBox =
    selectionBoxOpen &&
    selectedAnno !== null &&
    selectedSpec !== null &&
    !selectedSpec.usesBubble &&
    ((selectedAnno.anchor.kind === "text" && selectedAnno.anchor.rects.length > 0) ||
      (selectedAnno.anchor.kind === "path" && selectedAnno.anchor.points.length > 0) ||
      selectedAnno.anchor.kind === "rect");

  // Project the selected mark to its box-anchor viewport BOUNDS (Story 10.6:
  // `repositionBox` now needs the full rect, not just a point, to feed
  // `placeBesideSelection`'s right/flip-left decision for text marks), re-
  // derived from the anchor service so it tracks zoom (clamped in layout).
  // Reads `effectiveAnchor` (not `selectedAnno.anchor` directly) so a
  // move/resize drag — live preview OR just-committed — is reflected
  // immediately (bug fix above). `useCallback` (not a plain function):
  // `repositionBox` below is ALSO a `useCallback` that calls this one,
  // memoized separately on `isVerticalQuickBox` — if this were a plain
  // function (redefined fresh every render, the old shape), `repositionBox`
  // would close over whichever `selectionBounds` existed the last time
  // `isVerticalQuickBox` actually changed, not the latest one, since
  // `useCallback` discards a new closure whenever its deps compare equal. That
  // stale closure kept its `effectiveAnchor` frozen from an EARLIER selection
  // (or from mount, `null`), so re-anchoring on scroll (or even the plain
  // open/zoom layout effect below, which also calls through `repositionBox`)
  // recomputed the OLD mark's position instead of the newly selected one — a
  // Bank jump to a highlight on another page landed the box at the stale
  // point, clamped to the viewport's top-left corner (bug fix). Depend on
  // every value actually read inside.
  const selectionBounds = useCallback((): SelectionRect => {
    const zero: SelectionRect = { left: 0, top: 0, right: 0, bottom: 0 };
    if (!selectedAnno || !effectiveAnchor) return zero;
    const page = getPagesRef.current().find((p) => p.pageIndex === effectiveAnchor.page_index);
    if (!page) return zero;
    const cardRect = page.cardEl.getBoundingClientRect();
    const s = scaleRef.current;
    if (effectiveAnchor.kind === "text" && effectiveAnchor.rects.length > 0) {
      const rects = effectiveAnchor.rects;
      const first = denormalizeRect(rects[0], page.box, s);
      let right = first.left + first.width;
      let bottom = first.top + first.height;
      for (const r of rects) {
        const p = denormalizeRect(r, page.box, s);
        right = Math.max(right, p.left + p.width);
        bottom = Math.max(bottom, p.top + p.height);
      }
      return {
        left: cardRect.left + first.left,
        top: cardRect.top + first.top,
        right: cardRect.left + right,
        bottom: cardRect.top + bottom,
      };
    }
    if (effectiveAnchor.kind === "path" && effectiveAnchor.points.length > 0) {
      let left = Infinity;
      let top = Infinity;
      let right = -Infinity;
      let bottom = -Infinity;
      for (const pt of effectiveAnchor.points) {
        const d = denormalizePoint(pt, page.box, s);
        left = Math.min(left, d.x);
        top = Math.min(top, d.y);
        right = Math.max(right, d.x);
        bottom = Math.max(bottom, d.y);
      }
      return {
        left: cardRect.left + left,
        top: cardRect.top + top,
        right: cardRect.left + right,
        bottom: cardRect.top + bottom,
      };
    }
    if (effectiveAnchor.kind === "rect") {
      const r = denormalizeRect(effectiveAnchor.rect, page.box, s);
      return {
        left: cardRect.left + r.left,
        top: cardRect.top + r.top,
        right: cardRect.left + r.left + r.width,
        bottom: cardRect.top + r.top + r.height,
      };
    }
    return zero;
  }, [selectedAnno, effectiveAnchor, getPagesRef, scaleRef]);

  // The size step the memo size picker shows ARMED: the SELECTED memo's OWN size
  // (its rect, the single source per AD-5), NOT the session default — otherwise an
  // older memo shows the wrong step after the default changed (Codex LOW).
  const selectedMemoSize = (): MemoSize => {
    if (!selectedAnno || selectedAnno.anchor.kind !== "rect") return activeMemoSize;
    const page = getPagesRef.current().find((p) => p.pageIndex === selectedAnno.anchor.page_index);
    if (!page || page.box.width <= 0) return activeMemoSize;
    const widthPx = (selectedAnno.anchor.rect.x1 - selectedAnno.anchor.rect.x0) * page.box.width;
    let best = MEMO_SIZES[0];
    for (const sz of MEMO_SIZES) {
      if (Math.abs(sz.width - widthPx) < Math.abs(best.width - widthPx)) best = sz;
    }
    return best;
  };

  // Re-clamp the box's position from the mark's LIVE screen point (position:
  // fixed, so it needs re-anchoring on anything that moves it: open, zoom, a
  // move/resize drag, OR a scroll — shared by the layout effect below and the
  // scroll/resize tracking effect after it).
  const repositionBox = useCallback(() => {
    const el = selectionBoxRef.current;
    if (!el) return;
    const b = selectionBounds();
    const rect = el.getBoundingClientRect();
    let c: { x: number; y: number };
    if (isVerticalQuickBox) {
      // Memo, box comment, or box highlight: LEFT shift by the box's own
      // (measured) width + gap — unchanged from before Story 10.6.
      c = clampToViewport(b.left - rect.width - QUICK_BOX_GAP, b.top, rect.width, rect.height, window.innerWidth, window.innerHeight);
    } else if (effectiveAnchor?.kind === "text") {
      // A selected text mark (highlight/underline): beside the selection —
      // right by default, flip-left/below on overflow (Story 10.6, AC #1/#2).
      c = placeBesideSelection(b, rect.width, rect.height, window.innerWidth, window.innerHeight);
    } else {
      // Pen (path): BELOW anchor — unchanged from before Story 10.6.
      c = clampToViewport(b.left, b.bottom + QUICK_BOX_GAP, rect.width, rect.height, window.innerWidth, window.innerHeight);
    }
    el.style.left = `${c.x}px`;
    el.style.top = `${c.y}px`;
  }, [isVerticalQuickBox, effectiveAnchor, selectionBounds]);

  // Tracks the scale this effect last ran at, so it can tell "the scale just
  // changed" apart from "opened/selection changed at the same scale" (fix
  // request, below).
  const prevRepositionScaleRef = useRef(scale);

  // Focus moves INTO the selection box on open and RETURNS to the prior element on
  // close (same accessibility floor as the create box). Also nudges the box on-screen
  // once measured. Focus only on the OPEN transition (guarded by
  // `restoreSelectionFocusRef`), so a re-run (zoom) re-clamps without stealing focus.
  useLayoutEffect(() => {
    const scaleJustChanged = prevRepositionScaleRef.current !== scale;
    prevRepositionScaleRef.current = scale;
    if (showSelectionBox) {
      const el = selectionBoxRef.current;
      if (!el) return;
      if (!restoreSelectionFocusRef.current && !ownsOwnFocus) {
        // First open: remember where focus was, move it into the box. EXCEPTION: a
        // memo or a box comment owns its own focus (its textarea is autofocused for
        // typing) — pulling focus to the first swatch would fight that, so their
        // quick-box never grabs focus on open. The textarea is the keyboard entry
        // point; the swatches stay reachable by Tab. A box highlight has no
        // textarea of its own (fix request), so it's NOT in this set — it still
        // gets the default first-swatch autofocus, same as any other highlight.
        restoreSelectionFocusRef.current = (document.activeElement as HTMLElement | null) ?? document.body;
        el.querySelector<HTMLElement>("button")?.focus();
      }
      if (scaleJustChanged) {
        // Fix request (oscillating quick-box on zoom): zooming also changes
        // `scale`, which `useZoomControl` (a PARENT hook, so ITS layout effect
        // runs AFTER this one — React fires child effects before parent ones)
        // reacts to by re-centering the scroll container on the same focal
        // point. Repositioning synchronously here reads the PRE-recenter
        // scroll position — a transitional spot that paints, gets corrected
        // a frame later when that recentering's native `scroll` event reaches
        // the listener below, and reads as the box jumping/oscillating.
        // Deferring this one call to the next animation frame lets the
        // recentering (and browser layout) settle first, so it reads the
        // FINAL position and paints once. Any resulting `scroll` event still
        // fires the listener below too — redundant (same settled value) but
        // harmless.
        const raf = requestAnimationFrame(repositionBox);
        return () => cancelAnimationFrame(raf);
      }
      repositionBox();
    } else if (restoreSelectionFocusRef.current) {
      restoreSelectionFocusRef.current.focus?.();
      restoreSelectionFocusRef.current = null;
    }
    // Re-run on open/close, on zoom (rect re-derives), and whenever the mark's
    // effective position changes — a move/resize drag, live (preview) or just
    // committed (bug fix: the box used to stay frozen at its pre-drag spot since
    // neither `selectedId` nor `scale` change from a plain move/resize).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSelectionBox, selectedId, scale, effectiveAnchor]);

  // Keep the box glued to the mark on scroll instead of closing it (mirrors
  // `useCreateQuickBox`'s own Story 4.x fix for the sibling create popup, never
  // backported here): the box is `position: fixed`, so without this it floats
  // detached once the canvas scrolls. Closing on scroll (the old behavior) also
  // self-closed the box the Annotation Bank jump had *just* opened, since
  // `jumpToAnnotation`'s own smooth scroll fires 'scroll' events for its whole
  // glide — the box opened and closed within a frame, reading as a blink, and
  // the jump itself looked like it barely moved. Reposition fixes both.
  useEffect(() => {
    if (!showSelectionBox) return;
    document.addEventListener("scroll", repositionBox, true);
    window.addEventListener("resize", repositionBox);
    return () => {
      document.removeEventListener("scroll", repositionBox, true);
      window.removeEventListener("resize", repositionBox);
    };
  }, [showSelectionBox, repositionBox]);

  return {
    selectedAnno,
    selectedSpec,
    showSelectionBox,
    selectionBoxRef,
    selectionBounds,
    selectedMemoSize,
    recolorSelected,
    restrokeSelected,
    realphaSelected,
    resizeSelected,
    convertSelected,
    deleteSelected,
  };
}
