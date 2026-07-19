// CommentBubble — the comment's note popup (Story 2.10): the twin of `MemoBox`,
// but a floating surface off the pin (not the on-page box). Extracted from
// AnnotationLayer (Story 5.0). A `<textarea>` bound to `body` + a flat top
// control strip (design request): a collapsible color toggle that expands LEFT
// into the 5-swatch row, delete, and convert-to-highlight (kind=text only).
// Anchored at the pin's screen point (`pos`); `besideAnchor` (a real region
// OR a text-drag comment, fix request) skips the pin-nudge and instead relies
// on the caller having already shifted `pos` beside the anchor — only a
// degenerate click-placed pin still nudges below. Mounts only while the
// comment is selected → mount = open, unmount = close: it focuses its textarea
// on open (AC2) and RETURNS focus to the prior element on close (the unmount
// cleanup). Owns its ref + the auto-grow layout effect (like `MemoBox`).

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Highlighter, Trash } from "@phosphor-icons/react";
import type { Annotation } from "@/api/client";
import type { ScreenRect } from "@/anchor";
import { useLiveRef } from "@/hooks/useLiveRef";
import ColorSwatchRow from "./ColorSwatchRow";
import { committedBubbleOffset, bubbleTransform, manualBubbleSize, manualSizeStyle } from "./bubbleGeometry";
import "./Annotations.css";

/** Smallest the bubble's corner handle may shrink it to (CSS px). Fix request:
 *  height floor 94 (border-box) = the card chrome (border 1x2 + padding 12x2 +
 *  strip 20 + strip↔text gap 12 = 58) + a SINGLE textarea line
 *  (--comment-bubble-text-min-height 36), so a comment can be dragged down to
 *  one line (matches the measured resting one-line box). Width floor 140 same. */
const MIN_BUBBLE_WIDTH = 140;
const MIN_BUBBLE_HEIGHT = 94;

/** Client-pixel distance from the pointerdown origin before a bubble drag counts
 *  as "moved" (vs. a plain click) — Story 10.5. Mirrors the codebase's existing
 *  `COMMENT_CLICK_SLOP` (useCreateQuickBox.ts) / `HANDLE_MOVE_SLOP`
 *  (useEditGesture.ts) convention: without it, hand-tremor during a plain click
 *  on the bubble's empty padding would commit a spurious near-zero-delta
 *  position write and a spurious undo step once the drag persists. */
const BUBBLE_MOVE_SLOP = 5;

export default function CommentBubble({
  anno,
  pos,
  onRetext,
  onRecolor,
  onConvertToHighlight,
  onDelete,
  onClearSelection,
  onTextFocus,
  onTextBlur,
  onResize,
  onReposition,
  getScreenPoint,
  scale = 1,
  compact = false,
  besideAnchor = false,
}: {
  anno: Annotation;
  pos: ScreenRect;
  onRetext: (id: string, body: string) => void;
  /** Recolors the comment (design request: collapsed by default behind the
   *  corner color-toggle badge, expands to the full swatch row on click). */
  onRecolor: (color: string) => void;
  /** Turn this comment back into a highlight (Story 3.7, AC2). Only rendered
   *  for a `kind=text` comment (the reverse revert has no rect counterpart). */
  onConvertToHighlight: () => void;
  onDelete: () => void;
  onClearSelection: () => void;
  /** Called when the textarea gains focus (start of a text-edit session). */
  onTextFocus?: () => void;
  /** Called when the textarea loses focus (end of a text-edit session). */
  onTextBlur?: () => void;
  /** Commits a corner-handle resize (user feature request): persisted on
   *  `anno.style.bubble_width`/`bubble_height` so it survives reselect/reload. */
  onResize: (size: { width: number; height: number }) => void;
  /** Commits a drag-to-reposition (Story 10.5): persisted on
   *  `anno.style.bubble_offset_x`/`bubble_offset_y` so it survives reselect/
   *  reload. Only called once a drag crosses `BUBBLE_MOVE_SLOP` — a plain click
   *  never fires this. */
  onReposition: (offset: { x: number; y: number }) => void;
  /** Live deriver of the bubble's CURRENT viewport anchor point (the pin's
   *  screen position). The bubble is `position: fixed`, so it must re-read this
   *  on scroll/resize/zoom to stay glued to the pin — `pos` is only the render-
   *  time snapshot (goes stale on scroll, which fires no React re-render).
   *  Defaults to `() => pos` (tests / any caller that doesn't move). */
  getScreenPoint?: () => ScreenRect | null;
  /** Current zoom scale. A change re-clamps the position one frame late (like
   *  the selection quick-box) so the parent zoom re-centering settles first. */
  scale?: number;
  /** True for a BOX comment (fix request, `isBoxComment` in `marks.ts`): the
   *  caller has already positioned `pos` beside the highlight (no pin-offset
   *  shift needed here) and owns recolor/delete via the shared quick-box, so
   *  this renders only the textarea + resize handle, no internal chrome. */
  compact?: boolean;
  /** True whenever the caller has positioned `pos` BESIDE the anchor (a box
   *  comment OR, fix request, a text-drag comment) rather than AT the pin's
   *  own point — skips the below-pin nudge transform. Distinct from `compact`:
   *  a text comment now positions like a box comment but keeps its own full
   *  internal chrome (color/convert/delete), so this can be true while
   *  `compact` is false. */
  besideAnchor?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const body = anno.body ?? "";
  // Manual reposition (Story 10.5, persisted): mirrors the corner-handle
  // resize's OWN draft-vs-committed shape (`resizeDraft`/`manualWidth` below)
  // rather than a plain local mirror — a `dragDraft` LIVE preview while
  // dragging, `null` outside a drag, so the render otherwise falls through to
  // the committed `anno.style.bubble_offset_x/y` (or {0,0} for a comment never
  // moved). This matters even though the bubble remounts per selection: an
  // UNDO (or any other external change) while the SAME bubble stays open must
  // still show the reverted position immediately, not just on the next
  // reopen — a plain `useState` initializer only reads the prop once at mount
  // and would otherwise go stale the instant a drag ever ran.
  //
  // Fix request (root cause of "doesn't survive zoom"): `bubble_offset_x/y` is
  // persisted SCALE-1.0-independent (mirrors `normalizeRect`/`denormalizeRect`'s
  // own divide/multiply-by-scale idiom, AD-4 — every OTHER piece of anchor
  // geometry in this app is scale-independent at rest), so `* scale` here
  // rescales it to the CURRENT zoom's CSS px. Without this, a manually-dragged
  // bubble's gap from its anchor stayed a FIXED pixel amount regardless of
  // zoom, while the anchor itself (correctly) shrank/grew with the page —
  // reading as the bubble drifting away from/into its own selection. `dragDraft`
  // (the LIVE in-progress preview) stays raw CSS px the whole drag (1:1 with the
  // cursor); only the COMMITTED, persisted value needs the scale conversion.
  const [dragDraft, setDragDraft] = useState<{ x: number; y: number } | null>(null);
  const dragOffset = dragDraft ?? committedBubbleOffset(anno, scale);
  const boxDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);
  // Corner-handle resize (user feature request): a LIVE preview while dragging,
  // committed to the store (persisted per comment, AD-8) on release. `null`
  // outside a drag, so the render falls through to the committed
  // `anno.style.bubble_width`/`bubble_height` (or the default CSS size, for a
  // comment never manually resized).
  const [resizeDraft, setResizeDraft] = useState<{ width: number; height: number } | null>(null);
  const resizeRef = useRef<{ startX: number; startY: number; startW: number; startH: number } | null>(null);
  const committedSize = manualBubbleSize(anno);
  const manualWidth = resizeDraft?.width ?? committedSize.width;
  const manualHeight = resizeDraft?.height ?? committedSize.height;
  // Design request: the recolor row is collapsed by default behind a small
  // color-circle toggle in the top control strip; clicking it swaps the strip's
  // middle slot from that single dot to the full 5-swatch row, which grows
  // LEFTWARD in place (the strip is right-aligned, delete pinned at the right).
  // Collapses again the instant a color is picked (or the current color is
  // re-clicked). `false` on every fresh mount (matches the resize/reposition
  // drafts resetting per open) — there is no persisted "was the picker left
  // open" state to restore.
  const [colorOpen, setColorOpen] = useState(false);
  // Focus moves INTO the textarea on open; on close (unmount) it RETURNS to the
  // element focused before the bubble opened (UX-DR8/DR17). Runs once per open.
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => prev?.focus?.();
  }, []);
  // Auto-grow the textarea to its content whenever the text OR position changes
  // (zoom re-anchors it). jsdom has no layout (scrollHeight 0) → guarded no-op.
  // Skipped once the bubble has a MANUAL height (the corner-handle resize, live
  // or committed): the box height is then user-controlled, and the textarea
  // fills it via flex + its own scroll (`comment-bubble__text--manual-size`)
  // instead of forcing the box taller to fit every line.
  useLayoutEffect(() => {
    if (manualHeight !== null) return;
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    if (el.scrollHeight > 0) el.style.height = `${el.scrollHeight}px`;
  }, [body, pos.left, pos.top, manualHeight]);
  // Live viewport anchor: the pin's CURRENT screen point. `getScreenPoint` re-
  // derives it from the live page card + scale on demand; falls back to the
  // render-time `pos` snapshot when no deriver is passed (tests). Mirrored into
  // a ref so the once-bound scroll/resize listeners below always read the latest
  // deriver without re-subscribing (useLiveRef idiom).
  const getPointRef = useLiveRef<() => ScreenRect | null>(getScreenPoint ?? (() => pos));

  // Re-anchor the bubble from its LIVE screen point. The bubble is `position:
  // fixed`, so it needs re-anchoring on ANYTHING that moves the pin: open,
  // zoom, a move/resize drag, OR a scroll — scroll fires no React re-render,
  // so without this the popup floats detached once the canvas scrolls (fix
  // request). Mirrors useSelection.ts's `repositionBox` for the sibling
  // selection quick-box, MINUS its viewport clamp (fix request): unlike the
  // icon-only quick-box, this is a note the user is actively reading/typing —
  // pinning it fully on-screen fought a selection near the edge (Codex MED's
  // original clamp), so it is now allowed to overflow the viewport rather than
  // jump to an unrelated spot.
  const reposition = useCallback(() => {
    const el = boxRef.current;
    if (!el) return;
    const p = getPointRef.current() ?? pos;
    el.style.left = `${p.left}px`;
    el.style.top = `${p.top}px`;
  }, [getPointRef, pos.left, pos.top]);

  // Re-anchor on the render path: open, a zoom (scale change), the note growing,
  // a resize, or a drag-offset change (all can move the pin or the box). On a
  // SCALE change, defer one frame — the parent zoom hook re-centers the scroll
  // container AFTER this child effect runs (React fires child effects before
  // parent), so a synchronous reposition would read the pre-recenter scroll and
  // oscillate (the same fix useSelection.ts applies to the selection box).
  const prevScaleRef = useRef(scale);
  useLayoutEffect(() => {
    const scaleChanged = prevScaleRef.current !== scale;
    prevScaleRef.current = scale;
    if (scaleChanged) {
      const raf = requestAnimationFrame(reposition);
      return () => cancelAnimationFrame(raf);
    }
    reposition();
  }, [reposition, body, manualWidth, manualHeight, dragOffset.x, dragOffset.y, scale]);

  // Keep the bubble glued to the pin while the canvas scrolls or the window
  // resizes (mirrors useSelection.ts / useCreateQuickBox — the sibling popups
  // already do this; the bubble never got it). Capture-phase scroll so it fires
  // for the inner scroll container, not only a bubbling document scroll.
  useEffect(() => {
    document.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      document.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [reposition]);
  return (
    <div
      ref={boxRef}
      className="comment-bubble"
      data-testid={`comment-bubble-${anno.id}`}
      style={{
        left: pos.left,
        top: pos.top,
        transform: bubbleTransform(dragOffset, besideAnchor),
        ...manualSizeStyle({ width: manualWidth, height: manualHeight }),
      }}
      // Drag-to-reposition: any EMPTY space inside the bubble starts a drag —
      // excluded by ANCESTRY (closest, not a strict target===boxRef check).
      // Only the textarea and the convert/color/delete/resize controls (buttons
      // in the top strip / the bottom-right handle) are excluded, keeping their
      // normal click/focus behavior.
      onPointerDown={(e) => {
        if (e.button !== 0 || (e.target as HTMLElement).closest("textarea, button")) return;
        // Codex HIGH: blur the textarea BEFORE starting the drag. The textarea
        // auto-focuses on open (below) and nothing else blurs it during a plain
        // padding drag (unlike a button click, which natively steals focus) —
        // while it's focused, `useTextEditSession`'s `onTextFocus` has zundo's
        // temporal store PAUSED (a text-edit session groups keystrokes into one
        // undo step). Left unblurred, the reposition commit at `onPointerUp`
        // would land inside that paused window and get folded into the SAME
        // undo step as any in-progress (or absent) text edit, instead of being
        // its own independently-undoable step (AC #3, AR-7). Blurring first
        // ends any active session (flushing it as its own step if it changed
        // anything) so the reposition commits cleanly on its own afterward.
        ref.current?.blur();
        boxDragRef.current = {
          pointerId: e.pointerId,
          startX: e.clientX,
          startY: e.clientY,
          originX: dragOffset.x,
          originY: dragOffset.y,
          moved: false,
        };
        try {
          boxRef.current?.setPointerCapture(e.pointerId);
        } catch {
          /* capture refused (e.g. a synthetic test event) — the handlers below still fire on this element */
        }
        e.preventDefault();
      }}
      onPointerMove={(e) => {
        const d = boxDragRef.current;
        if (!d || e.pointerId !== d.pointerId) return;
        if (!d.moved) {
          const dist = Math.hypot(e.clientX - d.startX, e.clientY - d.startY);
          if (dist < BUBBLE_MOVE_SLOP) return; // still within slop: let a plain click fire on release
          d.moved = true;
        }
        setDragDraft({ x: d.originX + (e.clientX - d.startX), y: d.originY + (e.clientY - d.startY) });
      }}
      onPointerUp={(e) => {
        const d = boxDragRef.current;
        if (!d || e.pointerId !== d.pointerId) return;
        boxDragRef.current = null;
        // Commit on a real drag past the slop — a plain click on the bubble's
        // empty padding never persists a position / never records an undo step
        // (AC #5). Codex MED: recheck the final distance here too, not just
        // `d.moved` — a release can land with NO intervening pointermove event
        // (a very fast physical flick, or a down+up-only synthetic dispatch),
        // which would otherwise discard a real drag as a click. Clear the draft
        // either way: on a real commit the render falls through to the
        // (about-to-update) committed offset; on a plain click it was never set.
        const dx = e.clientX - d.startX;
        const dy = e.clientY - d.startY;
        if (d.moved || Math.hypot(dx, dy) >= BUBBLE_MOVE_SLOP) {
          // Persist SCALE-1.0-independent (divide out the current zoom, mirrors
          // the `* scale` read above) so the stored offset means "this many px
          // at 100%," not "this many px at whatever zoom I happened to drag at."
          onReposition({ x: (d.originX + dx) / scale, y: (d.originY + dy) / scale });
        }
        setDragDraft(null);
      }}
      onPointerCancel={(e) => {
        const d = boxDragRef.current;
        if (!d || e.pointerId !== d.pointerId) return;
        boxDragRef.current = null;
        setDragDraft(null);
      }}
      // Esc/Delete act from ANY control in the bubble, not just the textarea
      // (Codex MED, extended for Delete): the swatch/delete buttons are exempt
      // from the document-level selection keys (useSelection.ts), and the
      // textarea autofocuses on open (below) — outside `selectionBoxRef`, the
      // ONLY element that handler's `inSelectionBox` carve-out recognizes — so
      // neither key would otherwise reach the annotation at all (bug: the
      // "Delete (Del)" tooltip on the trash button below promised a shortcut
      // that silently did nothing). Handling both on the container catches
      // every focused child, INCLUDING the textarea while typing: Delete here
      // always removes the comment, never forward-deletes a character (unlike
      // Backspace, untouched) — a deliberate object-vs-text-edit split, the
      // same shortcut convention as the generic mark quick-box.
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          (document.activeElement as HTMLElement | null)?.blur?.();
          onClearSelection();
        } else if (e.key === "Delete") {
          e.preventDefault();
          e.stopPropagation();
          onDelete();
        }
      }}
    >
      {/* Top control strip (design request): flat, borderless icon controls
          that read as PART of the card — not floating badges whose own outline
          overlapped the note. The color control sits at the LEFT and the
          convert/delete group is pinned at the RIGHT (justify: space-between),
          so expanding the color toggle grows the 5-swatch row RIGHTWARD into the
          strip's empty middle and never covers the other options (fix request).
          Absent in `compact` (box comment): that path owns recolor/delete via
          the shared quick-box. The color control itself is ALSO absent for a
          plain click-placed pin comment (fix request: a pin has no colored
          region/text to tint, so recoloring it has no visible effect worth a
          control) — `anno.anchor.kind === "rect"` here is guaranteed to mean a
          degenerate pin, never a real box comment (that path is `compact` and
          never reaches this branch). */}
      {!compact && (
        <div className="comment-bubble__controls">
          {anno.anchor.kind !== "rect" &&
            (colorOpen ? (
              <ColorSwatchRow
                value={anno.style.color}
                // Picking a DIFFERENT color recolors; re-clicking the current
                // (armed) color just dismisses — the expanded row has no separate
                // toggle button to collapse it, so re-clicking the armed color is
                // the no-change collapse path. Either way the row closes.
                onPick={(color) => {
                  if (color !== anno.style.color) onRecolor(color);
                  setColorOpen(false);
                }}
                ariaLabel="Comment color"
              />
            ) : (
              <button
                type="button"
                className="comment-bubble__action comment-bubble__action--toggle"
                data-testid={`comment-color-toggle-${anno.id}`}
                aria-label="Comment color"
                aria-expanded={colorOpen}
                title="Comment color"
                onClick={() => setColorOpen(true)}
              >
                <span className="color-swatch__dot" style={{ backgroundColor: `var(--color-${anno.style.color})` }} />
              </button>
            ))}
          <div className="comment-bubble__controls-right">
            {anno.anchor.kind === "text" && (
              <button
                type="button"
                role="menuitem"
                className="comment-bubble__action"
                data-testid={`comment-convert-highlight-${anno.id}`}
                aria-label="Turn into highlight"
                title="Turn into highlight"
                onClick={onConvertToHighlight}
              >
                <Highlighter aria-hidden />
              </button>
            )}
            <button
              type="button"
              className="comment-bubble__action"
              data-testid={`comment-delete-${anno.id}`}
              aria-label="Delete"
              title="Delete (Del)"
              onClick={onDelete}
            >
              <Trash aria-hidden />
            </button>
          </div>
        </div>
      )}
      <textarea
        ref={ref}
        // rows=1 (fix request): a bare <textarea> defaults to rows=2, which
        // forced the empty/minimum box to two lines regardless of min-height.
        // One row + the auto-grow effect makes the resting height a single line;
        // it still grows to content as the user types.
        rows={1}
        className={
          manualHeight !== null ? "comment-bubble__text comment-bubble__text--manual-size" : "comment-bubble__text"
        }
        data-testid={`comment-body-${anno.id}`}
        aria-label="Comment"
        value={body}
        onChange={(e) => onRetext(anno.id, e.target.value)}
        onFocus={onTextFocus}
        onBlur={onTextBlur}
      />
      {/* Corner-handle resize (user feature request): reuses the on-page edit
          frame's `.edit-handle`/`.edit-handle--se` visual (ink-bordered nub,
          half outside the corner) for the SAME affordance language, but drives
          its OWN local drag here — this is chrome (CSS px) geometry, not a
          page-anchored `anchor` the shared `useEditGesture`/`data-edit-handle`
          wiring understands, so it must NOT carry those data attributes. */}
      <button
        type="button"
        className="edit-handle edit-handle--se"
        data-testid={`comment-bubble-resize-${anno.id}`}
        aria-label="Resize comment"
        title="Resize comment"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          e.preventDefault();
          const rect = boxRef.current?.getBoundingClientRect();
          const startW = manualWidth ?? rect?.width ?? MIN_BUBBLE_WIDTH;
          const startH = manualHeight ?? rect?.height ?? MIN_BUBBLE_HEIGHT;
          resizeRef.current = { startX: e.clientX, startY: e.clientY, startW, startH };
          setResizeDraft({ width: startW, height: startH });
          try {
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
          } catch {
            /* capture refused (e.g. a synthetic test event) — the handlers below still fire on this element */
          }
        }}
        onPointerMove={(e) => {
          const r = resizeRef.current;
          if (!r) return;
          setResizeDraft({
            width: Math.max(MIN_BUBBLE_WIDTH, r.startW + (e.clientX - r.startX)),
            height: Math.max(MIN_BUBBLE_HEIGHT, r.startH + (e.clientY - r.startY)),
          });
        }}
        onPointerUp={() => {
          if (!resizeRef.current) return;
          resizeRef.current = null;
          if (resizeDraft) onResize(resizeDraft);
          setResizeDraft(null);
        }}
        onPointerCancel={() => {
          resizeRef.current = null;
          setResizeDraft(null);
        }}
      />
    </div>
  );
}
