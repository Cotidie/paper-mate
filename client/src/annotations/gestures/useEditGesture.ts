// useEditGesture — drag-handle MOVE/RESIZE of a selected pen or rect mark
// (Story 3.1), PLUS the group-MOVE-only twin for a box-select multi-selection
// (user feature request). The edit frame (AnnotationLayer) renders a move grip +
// 4 corner handles tagged with `data-edit-handle` + `data-edit-id`; this hook
// turns a drag on one of them into a geometry edit. The live drag previews
// through the transient store `dragPreview` (no per-pointermove commit); the ONE
// `setAnnotationGeometry` lands on release, so Story 3.2's zundo records a single
// undo step. Document-level handlers (AP-1); abort on Esc / pointercancel / blur
// WITHOUT committing, so an interrupted drag never strands a preview (the
// recurring held-state bug).
//
// kind=text marks are NOT edited here (no frame is rendered for them): moving a
// text rect would desync `anchor.text` from the glyphs (Story 3.8 re-resolves the
// run instead). This serves kind=rect (memo / region) + kind=path (pen).
// Coordinate math lives in `anchor/` (AD-9); the store does none — the gesture
// computes the next anchor and hands it to `setAnnotationGeometry`.
//
// Group move: the multi-select group frame's move grip carries `data-edit-group`
// (no `data-edit-id` — it targets the whole `multiSelectedIds` set, read live at
// pointerdown) instead of the single-mark path. It is MOVE-ONLY (no resize; the
// group frame exposes no corner handles) and previews through the PARALLEL
// `groupDragPreview` store field, committing via the batched
// `setAnnotationGeometries` (one undo step for the whole group). The two drag
// states (`dragRef`/`groupDragRef`) are mutually exclusive by construction — only
// one branch of `onDown` ever starts a gesture per pointerdown.

import { useEffect, useRef, type RefObject } from "react";
import {
  translateRect,
  translatePoints,
  scalePoints,
  pointsBounds,
  type PageCardRef,
  type RectCorner,
} from "@/anchor";
import { useAnnotationStore } from "@/store";
import type { Annotation } from "@/api/client";
import { moveMemoRect, resizeMemoRect, reseedMemoResizeRect } from "./memoBoxGeometry";

/** A handle on the edit frame: the move grip or one of the four resize corners. */
export type EditHandle = "move" | RectCorner;

/** Smallest scale factor a pen resize may collapse to, so an overshooting drag
 *  can't scale a stroke to a zero/negative (flipped) size. */
const MIN_PEN_SCALE = 0.05;

/** Client-pixel distance from the pointerdown origin before a handle drag counts
 *  as "moved" (vs. a plain click). Mirrors the existing COMMENT_CLICK_SLOP
 *  convention (AnnotationInteraction.tsx) — needed here because the comment pin
 *  is a dual-purpose handle: click selects, drag moves. Without this, hand-tremor
 *  during a plain click would commit a spurious geometry write. */
const HANDLE_MOVE_SLOP = 5;

/** Whether a pointerdown inside a memo's OWN textarea landed BELOW its natural
 *  (wrapped) text content — i.e., genuinely empty box space, not on/near a
 *  character (user feature request: drag empty space to move the memo, even
 *  unselected, without disturbing normal text click/select). Reuses MemoBox's
 *  own auto-grow measurement trick (reset height to auto, read scrollHeight,
 *  restore): a manually-resized box's RENDERED height can exceed its content's
 *  natural height (the textarea's `min-height:100%` stretches it to fill the
 *  wrapper), so reading `scrollHeight` without the reset would report the
 *  stretched height, not the content's — masking real empty space below short
 *  text in a resized box. Vertical-only (no horizontal empty-space detection):
 *  a textarea has no visual cue for "past the end of a short line," so treating
 *  every in-line click as text keeps the heuristic simple and matches what a
 *  reader can actually see. */
function isBelowMemoText(ta: HTMLTextAreaElement, clientY: number): boolean {
  const prevHeight = ta.style.height;
  ta.style.height = "auto";
  const naturalHeight = ta.scrollHeight;
  ta.style.height = prevHeight;
  const rect = ta.getBoundingClientRect();
  return clientY - rect.top + ta.scrollTop > naturalHeight;
}

interface DragState {
  id: string;
  handle: EditHandle;
  startAnchor: Annotation["anchor"];
  /** The dragged mark's type (Story 10.2): `computeAnchor` needs it to know
   *  whether to floor a corner-resize at the memo minimum. */
  type: Annotation["type"];
  /** Whether the dragged memo was COLLAPSED at pointerdown (Story 10.4):
   *  `computeAnchor`/`onUp` route a collapsed memo's corner-resize to the
   *  collapsed size (`resizeCollapsedMemo`) instead of `anchor.rect`
   *  (`setAnnotationGeometry`), keeping the two sizes distinct (AC #2).
   *  Captured once at `onDown` from `anno.style.collapsed ?? false`; harmless
   *  (always false) for a non-memo mark. */
  collapsed: boolean;
  /** The collapsed box's own persisted WIDTH (Story 10.4 review fix), when
   *  known: a SIZED collapsed memo's `style.collapsed_width`, else `null` (a
   *  non-memo mark, an expanded memo, or a never-resized/legacy collapsed memo
   *  — its collapsed width already equals the expanded width, nothing extra to
   *  clamp against). Collapsed HEIGHT is always one intrinsic CSS line and
   *  never varies, so only width needs this. A MOVE clamps against whichever
   *  footprint (expanded or collapsed) is WIDER, so a collapsed box resized
   *  wider than its own expanded default can never be dragged off the page
   *  even though only the (narrower) expanded rect is what actually commits. */
  collapsedWidth: number | null;
  box: { width: number; height: number };
  scale: number;
  startX: number;
  startY: number;
  lastAnchor: Annotation["anchor"] | null;
  moved: boolean;
}

/** Group-move state (box-select multi-selection, move-only — no resize). */
interface GroupDragState {
  members: { id: string; startAnchor: Annotation["anchor"] }[];
  box: { width: number; height: number };
  scale: number;
  startX: number;
  startY: number;
  lastPreview: { id: string; anchor: Annotation["anchor"] }[] | null;
  moved: boolean;
}

export function useEditGesture(opts: {
  enabled: boolean;
  getPagesRef: RefObject<() => PageCardRef[]>;
  scaleRef: RefObject<number>;
  /** True when the Box-select pointer tool is armed. A memo's wrapper now
   *  carries data-edit-handle unconditionally (empty-space drag-to-move, user
   *  feature request), so without this gate a marquee drag STARTING on top of a
   *  memo would race useMultiSelectGesture's own onDown for the same pointerdown
   *  — that hook explicitly allows starting a marquee over an existing mark, so
   *  edit-drag must yield the gesture entirely while box-select is active. */
  multiSelectActive?: boolean;
}): void {
  const { enabled, getPagesRef, scaleRef, multiSelectActive = false } = opts;
  const setDragPreview = useAnnotationStore((s) => s.setDragPreview);
  const setAnnotationGeometry = useAnnotationStore((s) => s.setAnnotationGeometry);
  const resizeCollapsedMemo = useAnnotationStore((s) => s.resizeCollapsedMemo);
  const setGroupDragPreview = useAnnotationStore((s) => s.setGroupDragPreview);
  const setAnnotationGeometries = useAnnotationStore((s) => s.setAnnotationGeometries);
  const setActiveMemoSize = useAnnotationStore((s) => s.setActiveMemoSize);
  const dragRef = useRef<DragState | null>(null);
  const groupDragRef = useRef<GroupDragState | null>(null);
  const multiSelectActiveRef = useRef(multiSelectActive);
  multiSelectActiveRef.current = multiSelectActive;

  useEffect(() => {
    if (!enabled) return;
    const abort = () => {
      if (dragRef.current) {
        dragRef.current = null;
        setDragPreview(null);
      }
      if (groupDragRef.current) {
        groupDragRef.current = null;
        setGroupDragPreview(null);
      }
    };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      // Box-select owns the pointer entirely — see the multiSelectActive doc
      // above.
      if (multiSelectActiveRef.current) return;
      const handleEl = (e.target as HTMLElement | null)?.closest?.(
        "[data-edit-handle]",
      ) as HTMLElement | null;
      if (!handleEl) return;
      const handle = handleEl.dataset.editHandle as EditHandle | undefined;
      if (!handle) return;
      // A memo's wrapper carries data-edit-handle UNCONDITIONALLY (even
      // unselected, user feature request) and nests both the collapse toggle and
      // a rich `.annotation-memo__body` textarea — neither of which should ever
      // start a move. The toggle has its own click behavior; a press on real
      // TEXT must place the cursor / extend a selection like any normal
      // textarea, only a press on genuinely empty space (below the wrapped
      // content) may proceed as a move.
      const pressTarget = e.target as HTMLElement | null;
      if (pressTarget?.closest?.(".memo-collapse-toggle")) return;
      const textarea = pressTarget?.closest?.(".annotation-memo__body") as HTMLTextAreaElement | null;
      if (textarea && !isBelowMemoText(textarea, e.clientY)) return;
      if (handleEl.dataset.editGroup !== undefined) {
        // Group-move path: the frame exposes only a move grip (no resize corners).
        if (handle !== "move") return;
        const ids = useAnnotationStore.getState().multiSelectedIds;
        const members = ids
          .map((id) => useAnnotationStore.getState().annotations.get(id))
          .filter((a): a is Annotation => !!a && a.anchor.kind !== "text")
          .map((a) => ({ id: a.id, startAnchor: a.anchor }));
        if (members.length === 0) return;
        const firstAnno = useAnnotationStore.getState().annotations.get(members[0].id);
        const page = getPagesRef.current().find((p) => p.pageIndex === firstAnno?.anchor.page_index);
        if (!page) return;
        groupDragRef.current = {
          members,
          box: page.box,
          scale: scaleRef.current,
          startX: e.clientX,
          startY: e.clientY,
          lastPreview: null,
          moved: false,
        };
        e.preventDefault();
        try {
          handleEl.setPointerCapture?.(e.pointerId);
        } catch {
          /* capture refused (e.g. synthetic event) — document listeners still drive it */
        }
        return;
      }
      const id = handleEl.dataset.editId;
      if (!id) return;
      const anno = useAnnotationStore.getState().annotations.get(id);
      if (!anno) return;
      const page = getPagesRef.current().find((p) => p.pageIndex === anno.anchor.page_index);
      if (!page) return;
      let startAnchor = anno.anchor;
      // Memo-only, corner-resize only (Story 10.2/10.4): re-seed the resize
      // baseline from the box's REAL rendered size — a memo's rendered height (and,
      // collapsed, width) can differ from its stored anchor rect, so a corner-drag
      // delta must land on where the user visually grabbed the handle. jsdom has no
      // layout (measured rect zeroed) → a no-op there. See `reseedMemoResizeRect`.
      if (anno.type === "memo" && handle !== "move" && startAnchor.kind === "rect") {
        const memoEl = handleEl.closest(".annotation-memo") as HTMLElement | null;
        const rendered = memoEl?.getBoundingClientRect();
        const rect = reseedMemoResizeRect(
          startAnchor.rect,
          rendered,
          page.box,
          scaleRef.current,
          anno.style.collapsed ?? false,
        );
        startAnchor = { ...startAnchor, rect };
      }
      const collapsedWidth =
        anno.type === "memo" && anno.style.collapsed && anno.style.collapsed_width != null
          ? anno.style.collapsed_width
          : null;
      dragRef.current = {
        id,
        handle,
        startAnchor,
        type: anno.type,
        collapsed: anno.style.collapsed ?? false,
        collapsedWidth,
        box: page.box,
        scale: scaleRef.current,
        startX: e.clientX,
        startY: e.clientY,
        lastAnchor: null,
        moved: false,
      };
      // Suppress the native text-selection/drag the pointerdown would otherwise
      // start; the document listeners drive the gesture from here.
      e.preventDefault();
      try {
        handleEl.setPointerCapture?.(e.pointerId);
      } catch {
        /* capture refused (e.g. synthetic event) — document listeners still drive it */
      }
    };
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (d) {
        if (!d.moved) {
          const dist = Math.hypot(e.clientX - d.startX, e.clientY - d.startY);
          if (dist < HANDLE_MOVE_SLOP) return; // still within slop: let a plain click fire on release
          d.moved = true;
        }
        const w = d.box.width * d.scale;
        const h = d.box.height * d.scale;
        const dx = w > 0 ? (e.clientX - d.startX) / w : 0;
        const dy = h > 0 ? (e.clientY - d.startY) / h : 0;
        const next = computeAnchor(d, dx, dy);
        if (!next) return;
        d.lastAnchor = next;
        setDragPreview({ id: d.id, anchor: next, handle: d.handle });
        e.preventDefault();
        return;
      }
      const g = groupDragRef.current;
      if (!g) return;
      if (!g.moved) {
        const dist = Math.hypot(e.clientX - g.startX, e.clientY - g.startY);
        if (dist < HANDLE_MOVE_SLOP) return;
        g.moved = true;
      }
      const w = g.box.width * g.scale;
      const h = g.box.height * g.scale;
      const dx = w > 0 ? (e.clientX - g.startX) / w : 0;
      const dy = h > 0 ? (e.clientY - g.startY) / h : 0;
      const preview = g.members.map((m) => ({ id: m.id, anchor: computeGroupAnchor(m.startAnchor, dx, dy) }));
      g.lastPreview = preview;
      setGroupDragPreview(preview);
      e.preventDefault();
    };
    const onUp = () => {
      const d = dragRef.current;
      if (d) {
        dragRef.current = null;
        setDragPreview(null);
        // Commit ONE geometry mutation (so 3.2's zundo records one step). A handle
        // press with no real drag changes nothing → no commit, no updated_at bump.
        if (d.moved && d.lastAnchor) {
          const isCollapsedResize = d.collapsed && d.type === "memo" && d.handle !== "move";
          if (isCollapsedResize && d.lastAnchor.kind === "rect") {
            // Collapsed memo corner-resize (Story 10.4): commit the WIDTH to
            // `style.collapsed_width`, not `anchor.rect` (that stays the
            // expanded size, AC #2). Height is discarded — always one
            // intrinsic CSS line while collapsed, never persisted. One
            // command-path call → one undoable zundo step (AR-7).
            const r = d.lastAnchor.rect;
            resizeCollapsedMemo(d.id, r.x1 - r.x0, new Date().toISOString());
          } else {
            setAnnotationGeometry(d.id, d.lastAnchor, new Date().toISOString());
          }
          // A real move (moved beyond slop) never fires the wrapper's own click
          // (browsers suppress "click" after pointer movement), so an UNSELECTED
          // memo dragged from empty space (user feature request) would otherwise
          // land with no selection ring/quick-box feedback. Already a no-op for
          // every pre-existing path (its mark is already selected to expose a
          // handle at all) — EXCEPT skip it while an unrelated multi-selection is
          // active (AD-12: selectedId/multiSelectedIds are mutually exclusive, so
          // select() would silently clear the user's OTHER, unrelated bulk
          // selection; a mark reachable only via its own edit-frame handle is
          // never in this position, since that requires it to already BE
          // selectedId, which the mutual-exclusion invariant already guarantees
          // means multiSelectedIds is empty).
          if (useAnnotationStore.getState().multiSelectedIds.length === 0) {
            useAnnotationStore.getState().select(d.id);
          }
          // Remember a memo's last RESIZED size as the session default, so the next
          // new memo lands at it (user request: last-adjusted-size-wins). Only on an
          // EXPANDED corner resize (not a move, not a collapsed resize — Story 10.4:
          // a shared default COLLAPSED size is out of scope, see Dev Notes); size is
          // scale-1.0 px = normalized rect * the page box (which is the scale-1.0 box).
          const anno = useAnnotationStore.getState().annotations.get(d.id);
          if (!isCollapsedResize && d.handle !== "move" && anno?.type === "memo" && d.lastAnchor.kind === "rect") {
            const r = d.lastAnchor.rect;
            setActiveMemoSize({
              key: "medium",
              width: (r.x1 - r.x0) * d.box.width,
              height: (r.y1 - r.y0) * d.box.height,
            });
          }
        }
        return;
      }
      const g = groupDragRef.current;
      if (!g) return;
      groupDragRef.current = null;
      setGroupDragPreview(null);
      // Commit the WHOLE group in ONE batched write (one undo step). A grip press
      // with no real drag changes nothing.
      if (g.moved && g.lastPreview) {
        setAnnotationGeometries(g.lastPreview, new Date().toISOString());
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && (dragRef.current || groupDragRef.current)) abort();
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
      // `enabled` going false (e.g. the hide-all toggle, Story 5.5) tears down these
      // listeners mid-drag same as any other disable path: abort WITHOUT committing
      // here too, not just remove listeners — otherwise a physical pointerup landing
      // with no listener bound leaves dragRef/groupDragRef stale, and the next
      // enable's fresh onMove/onUp would silently resume + commit a geometry edit
      // from an unrelated later pointer event (the recurring held-state bug).
      abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
}

/** Compute the dragged mark's next anchor from the normalized delta (page
 *  fractions). Returns null for a kind that is not editable here (text marks are
 *  never given a frame). All math is in `anchor/` (AD-9). */
function computeAnchor(d: DragState, dx: number, dy: number): Annotation["anchor"] | null {
  const a = d.startAnchor;
  if (a.kind === "rect") {
    // The memo box's move/resize rules (min floor, collapsed width-only, wider-
    // footprint move clamp) live in `memoBoxGeometry`; a region rect passes
    // `isMemo=false`/`collapsedWidth=null` and gets the plain translate/resize.
    const rect =
      d.handle === "move"
        ? moveMemoRect(a.rect, dx, dy, d.collapsedWidth)
        : resizeMemoRect(a.rect, d.handle, dx, dy, d.type === "memo", d.collapsed, d.box);
    return { ...a, rect };
  }
  if (a.kind === "path") {
    if (d.handle === "move") return { ...a, points: translatePoints(a.points, dx, dy) };
    // Resize: scale the points about the FIXED corner opposite the dragged one,
    // PER AXIS. A zero-extent axis (a perfectly horizontal/vertical stroke) keeps
    // scale 1 on that axis instead of no-op-ing the whole resize; the scale is
    // clamped so the moving edge lands within [0,1], so an overscale drag clamps
    // the FACTOR (shape preserved) rather than clipping points flat at the edge.
    const b = pointsBounds(a.points);
    const ox = d.handle === "ne" || d.handle === "se" ? b.x0 : b.x1;
    const oy = d.handle === "sw" || d.handle === "se" ? b.y0 : b.y1;
    const movingX = d.handle === "ne" || d.handle === "se" ? b.x1 : b.x0;
    const movingY = d.handle === "sw" || d.handle === "se" ? b.y1 : b.y0;
    const sx = axisScale(movingX, ox, dx);
    const sy = axisScale(movingY, oy, dy);
    if (sx === 1 && sy === 1) return a; // a true dot (both extents ~0): nothing to scale
    return { ...a, points: scalePoints(a.points, sx, sy, ox, oy) };
  }
  return null; // text marks are not moved here (Story 3.8 re-resolves their run)
}

/** Compute one group member's next anchor from the shared normalized delta.
 *  MOVE-ONLY (the group frame exposes no resize corners): each kind still clamps
 *  independently to the page (translateRect/translatePoints), so a member near
 *  an edge can lag the rest of the group rather than the whole group stopping —
 *  an accepted v1 limitation, not a bug. Text marks are filtered out before a
 *  group drag starts (see `onDown`), so this never sees `kind === "text"`. */
function computeGroupAnchor(a: Annotation["anchor"], dx: number, dy: number): Annotation["anchor"] {
  if (a.kind === "rect") return { ...a, rect: translateRect(a.rect, dx, dy) };
  if (a.kind === "path") return { ...a, points: translatePoints(a.points, dx, dy) };
  return a;
}

/**
 * The per-axis scale factor for a pen corner-resize: drag the moving edge by
 * `delta`, then clamp it to the page [0,1] AND to at least `MIN_PEN_SCALE` of the
 * original extent from the fixed `origin` (so the stroke can't collapse or flip).
 * The scale is derived from the CLAMPED edge, so an overscale drag limits the
 * FACTOR (the stroke keeps its shape) instead of pushing points past the edge to
 * be clipped flat. A zero-extent axis returns 1 (don't scale that axis) so a 1-D
 * stroke still resizes on its other axis.
 */
function axisScale(moving: number, origin: number, delta: number): number {
  const extent = moving - origin;
  if (Math.abs(extent) < 1e-9) return 1;
  const minEdge = origin + extent * MIN_PEN_SCALE; // closest the edge may get to origin
  let edge = Math.min(1, Math.max(0, moving + delta)); // keep the edge on the page
  // Keep the edge on the original side of the origin (no collapse/flip past minEdge).
  edge = extent > 0 ? Math.max(edge, minEdge) : Math.min(edge, minEdge);
  return (edge - origin) / extent;
}
