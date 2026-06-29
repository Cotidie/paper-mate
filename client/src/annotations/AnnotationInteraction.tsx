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
import {
  rectsFromSelection,
  denormalizeRect,
  denormalizePoint,
  normalizePoint,
  normalizeRect,
  pickPage,
  type PageCardRef,
} from "../anchor";
import { useAnnotationStore, MEMO_SIZES, type MemoSize } from "../store";
import { newId } from "../uuid";
import { buildAnnotations, buildPenAnnotation, buildMemoAnnotation, buildCommentPin, buildRegionAnnotation } from "./create";
import { strokeOutline, svgPathFromOutline, type StrokeInputPoint } from "./pen";
import { clampToViewport } from "./position";
import { initialOverlayState, overlayReducer, type AnnotationTool } from "./machine";
import ColorSwatchRow from "./ColorSwatchRow";
import StrokeWidthRow from "./StrokeWidthRow";
import SizeRow from "./SizeRow";
import "./Annotations.css";

/** Vertical gap (viewport px) between the marked text and the floating quick-box
 *  anchored below it, so the box clears the run instead of covering it. */
const QUICK_BOX_GAP = 6;

/** Max pointer travel (px) between a comment pointerdown and its release for the
 *  release to still count as a CLICK (drops a pin). Beyond this it was a drag. */
const COMMENT_CLICK_SLOP = 5;

/** Minimum pointer travel (px) for a box-select drag to commit a region. Below
 *  this the drag is treated as a stray click and no mark is created. */
const BOX_DRAG_THRESHOLD = 8;

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

  // ── Pen freehand gesture (Story 2.8) ─────────────────────────────────────
  // The in-progress stroke's CLIENT-space points. `penDraftRef` is the
  // authoritative list (read at pointerup to build the mark); `penPreview` mirrors
  // it as state so the live preview SVG re-renders as the pointer moves. Both clear
  // on pointerup/abort. Client space is safe for one stroke: the pointer is
  // captured for the gesture, so the canvas can't scroll mid-draw.
  const penDraftRef = useRef<StrokeInputPoint[]>([]);
  const penDrawingRef = useRef(false);
  const [penPreview, setPenPreview] = useState<StrokeInputPoint[] | null>(null);

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
  const activeStrokeWidthRef = useRef(activeStrokeWidth);
  activeStrokeWidthRef.current = activeStrokeWidth;
  const activeMemoSizeRef = useRef(activeMemoSize);
  activeMemoSizeRef.current = activeMemoSize;
  const rectReaderRef = useRef(rectReader);
  rectReaderRef.current = rectReader;
  // Box-select gesture (Story 2.11): gates on boxActive (a pointer tool), NOT
  // armedTool (which is null while box is active, Decision 5).
  const boxActiveRef = useRef(boxActive);
  boxActiveRef.current = boxActive;
  const boxDrawingRef = useRef(false);
  const boxStartRef = useRef<{ x: number; y: number } | null>(null);
  // Client-space rubber-band preview rect, cleared on commit/abort.
  const [boxPreview, setBoxPreview] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  // Comment CLICK candidate (Codex MED): the pointerdown origin of a potential
  // comment-pin click, so a FAILED text drag (down, move far, release with an
  // empty selection) does NOT drop an accidental pin — the release must be within
  // click slop of its own pointerdown. Null = no candidate this gesture.
  const commentDownRef = useRef<{ x: number; y: number } | null>(null);

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
        // No text selection on release. For COMMENT this is the CLICK gesture
        // (AD-5: `comment → rect`): drop a pin at the click point — the memo
        // click-to-place twin, but in pointerup branched on `pages.length` (drag
        // vs click) instead of a separate pointerdown. Only over a real page card,
        // and never on the quick-box, an existing pin/bubble, or another mark
        // (that click selects/opens it, not places a new pin). Other tools do
        // nothing on an empty release.
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
            color: activeColorRef.current,
          });
          addAnnotation(created);
          select(created.id);
        }
        return;
      }
      if (tool === "highlight" || tool === "underline" || tool === "comment") {
        // Create-on-release for any text-anchor tool: same path, the tool's `type`
        // is the only difference (highlight paints a fill, underline a 2px line,
        // comment paints the same ~0.4 fill + a pin — those branches live in
        // AnnotationLayer, keyed off `type` per AD-5). The comment DRAG also carries
        // a non-null `body` (`""`, the bubble edits it) — the ONLY delta from the
        // highlight path. Color is the active color (Story 2.6). Then select the new
        // mark (the selection quick-box for highlight/underline; the comment-bubble
        // for comment) and clear the live text selection so it cannot re-pop.
        const created = buildAnnotations(pages, docId, {
          now: new Date().toISOString(),
          newId,
          type: tool,
          color: activeColorRef.current,
          ...(tool === "comment" ? { body: "" } : {}),
        });
        created.forEach(addAnnotation);
        selection?.removeAllRanges();
        select(created[0].id);
        return;
      }
      // Any OTHER armed tool (pen/memo — their own gesture paths above) must NOT
      // fall through to the cursor-mode proof box: that would pop the highlight
      // proof as if nothing were armed. Only cursor mode (tool === null) reaches it.
      if (tool !== null) return;
      // Cursor mode (no tool): the 2.2 proof — a single action that creates the
      // highlight on click (the cursor-mode tool picker is Story 2.12).
      restoreFocusRef.current = document.activeElement as HTMLElement | null;
      dispatch({ type: "present", selection: pages, at: { x: e.clientX, y: e.clientY } });
    };
    document.addEventListener("pointerdown", onPointerDownCandidate);
    document.addEventListener("pointerup", onPointerUp);
    return () => {
      document.removeEventListener("pointerdown", onPointerDownCandidate);
      document.removeEventListener("pointerup", onPointerUp);
    };
  }, [enabled, docId, addAnnotation, select]);

  // Pen freehand gesture (Story 2.8, Decision A): a pointer DRAG (not a text
  // selection) while pen is armed. pointerdown over a page starts a draft,
  // pointermove accumulates client points (and drives the preview), pointerup
  // resolves the page, normalizes the points, and stores ONE kind=path mark. Bound
  // on document (AP-1), phase-gated; only acts while pen is armed. `preventDefault`
  // on down/move suppresses native text-selection + image drag. Document-level
  // move/up catch the whole in-window drag; pointercancel/blur abort a half-stroke
  // so an interrupted gesture can't strand a draft (the recurring held-state bug).
  useEffect(() => {
    if (!enabled) return;
    const abort = () => {
      penDrawingRef.current = false;
      penDraftRef.current = [];
      setPenPreview(null);
    };
    const onDown = (e: PointerEvent) => {
      if (armedToolRef.current !== "pen" || e.button !== 0 || isExempt(e.target)) return;
      const el = e.target as Element | null;
      // Only start over an actual page CARD (not the gutter/margin/chrome or the
      // quick-box): a draft over empty canvas would show a preview + suppress
      // default, then drop the mark on release (pickPage = -1). Require a page.
      if (!el?.closest?.(".page-surface") || el.closest?.(".quick-box")) return;
      penDrawingRef.current = true;
      penDraftRef.current = [{ x: e.clientX, y: e.clientY }];
      setPenPreview([{ x: e.clientX, y: e.clientY }]);
      e.preventDefault();
      // Best-effort capture so a drag leaving the canvas still finishes (mirrors
      // the Reader pan); document listeners are the real mechanism either way.
      try {
        (el as Element & { setPointerCapture?: (id: number) => void }).setPointerCapture?.(e.pointerId);
      } catch {
        /* capture refused (e.g. synthetic event) — the drag still works */
      }
    };
    const onMove = (e: PointerEvent) => {
      if (!penDrawingRef.current) return;
      penDraftRef.current.push({ x: e.clientX, y: e.clientY });
      setPenPreview([...penDraftRef.current]);
      e.preventDefault();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && penDrawingRef.current) abort();
    };
    const onUp = () => {
      if (!penDrawingRef.current) return;
      penDrawingRef.current = false;
      const pts = penDraftRef.current;
      penDraftRef.current = [];
      setPenPreview(null);
      // Inverse path (Codex HIGH): if the pen was disarmed mid-drag (V/Esc → tool
      // switch), do NOT persist a stroke after pen is no longer the armed tool.
      if (armedToolRef.current !== "pen") return;
      // A click with no real drag (< 2 points) makes no mark.
      if (pts.length < 2) return;
      const pages = getPagesRef.current();
      const cardBoxes = pages.map((p) => p.cardEl.getBoundingClientRect());
      // The stroke binds to the page its pointerdown landed on (single-page, AD-5).
      const startIdx = pickPage(
        { left: pts[0].x, top: pts[0].y, right: pts[0].x, bottom: pts[0].y },
        cardBoxes.map((c) => ({ left: c.left, top: c.top, right: c.right, bottom: c.bottom })),
      );
      if (startIdx < 0) return;
      const page = pages[startIdx];
      const cardRect = cardBoxes[startIdx];
      const scale = scaleRef.current;
      const points = pts.map((p) =>
        normalizePoint({ x: p.x - cardRect.left, y: p.y - cardRect.top }, page.box, scale),
      );
      const created = buildPenAnnotation({ page_index: page.pageIndex, points }, docId, {
        now: new Date().toISOString(),
        newId,
        color: activeColorRef.current,
        strokeWidth: activeStrokeWidthRef.current,
      });
      addAnnotation(created);
      select(created.id);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", abort);
    document.addEventListener("keydown", onKey);
    window.addEventListener("blur", abort);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", abort);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", abort);
    };
  }, [enabled, docId, addAnnotation, select]);

  // Abort an in-progress pen draft the moment the pen tool is switched away (V/Esc
  // or another tool) — so a stranded draft can't keep a stale preview on screen and
  // the next pointerup can't persist a mark after disarm (Codex HIGH; the twin of
  // the Reader's canPan tear-down). Pure cleanup of the draft state.
  useEffect(() => {
    if (armedTool !== "pen" && penDrawingRef.current) {
      penDrawingRef.current = false;
      penDraftRef.current = [];
      setPenPreview(null);
    }
  }, [armedTool]);

  // Memo placement gesture (Story 2.9, Decision 1): with memo armed, a single
  // primary-button pointerdown on a page CARD places a default-size box at that
  // point (NOT a drag, NOT a text selection), selects it, and the layer focuses
  // its textarea. Document-level (AP-1), phase-gated; only acts while memo is
  // armed. The box rect = the activeMemoSize preset (scale-1.0 px) at the click,
  // normalized against the page. Clicking an EXISTING memo selects it (handled by
  // the layer + selection seam) — gate placement off `.annotation-memo` so a
  // second overlapping box isn't dropped on it.
  useEffect(() => {
    if (!enabled) return;
    const onDown = (e: PointerEvent) => {
      if (armedToolRef.current !== "memo" || e.button !== 0 || isExempt(e.target)) return;
      const el = e.target as Element | null;
      // Only over an actual page card; never the gutter/chrome, the quick-box, or
      // an existing memo (that click selects/edits it, not places a new one).
      if (!el?.closest?.(".page-surface") || el.closest?.(".quick-box") || el.closest?.(".annotation-memo"))
        return;
      const pages = getPagesRef.current();
      const cardBoxes = pages.map((p) => p.cardEl.getBoundingClientRect());
      const idx = pickPage(
        { left: e.clientX, top: e.clientY, right: e.clientX, bottom: e.clientY },
        cardBoxes.map((c) => ({ left: c.left, top: c.top, right: c.right, bottom: c.bottom })),
      );
      if (idx < 0) return;
      const page = pages[idx];
      const cardRect = cardBoxes[idx];
      const scale = scaleRef.current;
      const size = activeMemoSizeRef.current;
      // Card-local px at the CURRENT scale (size is scale-1.0 px, so multiply by
      // scale); normalizeRect divides by box*scale → a scale-independent rect.
      const x0 = e.clientX - cardRect.left;
      const y0 = e.clientY - cardRect.top;
      const rect = normalizeRect(
        { x0, y0, x1: x0 + size.width * scale, y1: y0 + size.height * scale },
        page.box,
        scale,
      );
      const created = buildMemoAnnotation({ page_index: page.pageIndex, rect }, docId, {
        now: new Date().toISOString(),
        newId,
        color: activeColorRef.current,
      });
      addAnnotation(created);
      select(created.id);
      // Don't let the click start a text selection / fall through to another path.
      e.preventDefault();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [enabled, docId, addAnnotation, select]);

  // Box-highlight drag gesture (Story 2.11): a pointer DRAG while box-highlight
  // mode is on (Highlight active + box mode). Gates on `boxActiveRef.current` (the
  // armed tool is "highlight", but this is a rectangle drag, not a text selection,
  // so it needs the explicit `boxActive` signal). Clone of the pen gesture:
  // document-level (AP-1), page-gated, draft→preview→commit, abort. On commit:
  // canonicalized rect → normalizeRect → buildRegionAnnotation → addAnnotation →
  // select (the 2.5 selection quick-box takes over — recolor + delete).
  useEffect(() => {
    if (!enabled) return;
    const abort = () => {
      boxDrawingRef.current = false;
      boxStartRef.current = null;
      setBoxPreview(null);
    };
    const onDown = (e: PointerEvent) => {
      if (!boxActiveRef.current || e.button !== 0 || isExempt(e.target)) return;
      const el = e.target as Element | null;
      // Reject chrome, quick-box, and existing marks (a click on a mark selects it,
      // not starts a new region). Require a real page card.
      if (
        !el?.closest?.(".page-surface") ||
        el.closest?.(".quick-box") ||
        el.closest?.(".annotation-highlight, .annotation-pen, .annotation-memo, .annotation-comment-pin")
      )
        return;
      boxDrawingRef.current = true;
      boxStartRef.current = { x: e.clientX, y: e.clientY };
      setBoxPreview({ x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY });
      e.preventDefault();
      try {
        (el as Element & { setPointerCapture?: (id: number) => void }).setPointerCapture?.(e.pointerId);
      } catch {
        /* capture refused on synthetic events */
      }
    };
    const onMove = (e: PointerEvent) => {
      if (!boxDrawingRef.current || !boxStartRef.current) return;
      const { x, y } = boxStartRef.current;
      setBoxPreview({ x0: x, y0: y, x1: e.clientX, y1: e.clientY });
      e.preventDefault();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && boxDrawingRef.current) abort();
    };
    const onUp = (e: PointerEvent) => {
      if (!boxDrawingRef.current || !boxStartRef.current) return;
      boxDrawingRef.current = false;
      const start = boxStartRef.current;
      boxStartRef.current = null;
      setBoxPreview(null);
      // Disarm mid-drag (tool switched): do not persist.
      if (!boxActiveRef.current) return;
      // Below-threshold drag → stray click, no region.
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < BOX_DRAG_THRESHOLD) return;
      const pages = getPagesRef.current();
      const cardBoxes = pages.map((p) => p.cardEl.getBoundingClientRect());
      const startIdx = pickPage(
        { left: start.x, top: start.y, right: start.x, bottom: start.y },
        cardBoxes.map((c) => ({ left: c.left, top: c.top, right: c.right, bottom: c.bottom })),
      );
      if (startIdx < 0) return;
      const page = pages[startIdx];
      const cardRect = cardBoxes[startIdx];
      const scale = scaleRef.current;
      // Card-local corners; normalizeRect canonicalizes (x0≤x1, y0≤y1) and clamps
      // to [0,1] — handles an up-left drag (negative delta) and off-card overshoot.
      const rect = normalizeRect(
        {
          x0: start.x - cardRect.left,
          y0: start.y - cardRect.top,
          x1: e.clientX - cardRect.left,
          y1: e.clientY - cardRect.top,
        },
        page.box,
        scale,
      );
      const created = buildRegionAnnotation({ page_index: page.pageIndex, rect }, docId, {
        now: new Date().toISOString(),
        newId,
        color: activeColorRef.current,
      });
      addAnnotation(created);
      select(created.id);
      e.preventDefault();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", abort);
    document.addEventListener("keydown", onKey);
    window.addEventListener("blur", abort);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", abort);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", abort);
    };
  }, [enabled, docId, addAnnotation, select]);

  // Abort an in-progress box draft the moment box mode is switched off —
  // so a stranded draft can't keep a stale preview or persist after disarm
  // (mirrors the pen abort-on-disarm pattern, Codex HIGH).
  useEffect(() => {
    if (!boxActive && boxDrawingRef.current) {
      boxDrawingRef.current = false;
      boxStartRef.current = null;
      setBoxPreview(null);
    }
  }, [boxActive]);

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
  // (last-choice-wins), and the pick dismisses the box (the mark stays selected).
  const restrokeSelected = useCallback(
    (width: number) => {
      restrokeAnnotation(selectedGroupIds(), width, new Date().toISOString());
      setActiveStrokeWidth(width);
      setSelectionBoxOpen(false);
    },
    [restrokeAnnotation, selectedGroupIds, setActiveStrokeWidth],
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
  const isPenSelected = selectedAnno?.anchor.kind === "path";
  const isMemoSelected = selectedAnno?.anchor.kind === "rect" && selectedAnno.type === "memo";
  // A COMMENT shows the comment-bubble (in AnnotationLayer), NOT the generic
  // selection quick-box (UX-DR5: comment mode → bubble directly; Decision 4). So
  // the shared box is gated to exclude `type === "comment"` — both kinds.
  const showSelectionBox =
    selectionBoxOpen &&
    selectedAnno !== null &&
    selectedAnno.type !== "comment" &&
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
          <path d={previewPath} fill={`var(--color-${activeColor})`} />
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
          aria-label={isMemoSelected ? "Memo actions" : isPenSelected ? "Pen actions" : "Highlight actions"}
          data-testid="selection-quick-box"
          style={{ left: selInit.x, top: selInit.y }}
        >
          {/* Recolor the selected mark (reuses 2.3's row + store.recolorAnnotation);
              the row shows the mark's CURRENT color armed. For a memo it tints the
              box accent (border). */}
          <ColorSwatchRow value={selectedAnno.style.color} onPick={recolorSelected} />
          {/* A pen mark also gets the stroke-width row (restroke), armed to its
              current width. Text marks (highlight/underline) have no width. */}
          {isPenSelected && (
            <StrokeWidthRow value={selectedAnno.style.stroke_width ?? activeStrokeWidth} onPick={restrokeSelected} />
          )}
          {/* A memo gets the collapsible size row (resize), armed to the session
              default (memos store size as their rect, not a style field). */}
          {isMemoSelected && <SizeRow value={selectedMemoSize()} onPick={resizeSelected} />}
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
