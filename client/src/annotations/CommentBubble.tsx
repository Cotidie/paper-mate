// CommentBubble — the comment's note popup (Story 2.10): the twin of `MemoBox`,
// but a floating surface off the pin (not the on-page box). Extracted from
// AnnotationLayer (Story 5.0). A `<textarea>` bound to `body` + a `ColorSwatchRow`
// (recolor tints the fill AND the pin) + a delete. Anchored at the pin's screen
// point (`pos`); CSS nudges it below the pin. Mounts only while the comment is
// selected → mount = open, unmount = close: it focuses its textarea on open (AC2)
// and RETURNS focus to the prior element on close (the unmount cleanup). Owns its
// ref + the auto-grow layout effect (like `MemoBox`).

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Highlighter, Trash } from "@phosphor-icons/react";
import type { Annotation } from "@/api/client";
import type { ScreenRect } from "@/anchor";
import ColorSwatchRow from "./ColorSwatchRow";
import { clampToViewport } from "./position";
import "./Annotations.css";

/** Nudges the bubble below the pin (was a static CSS `transform`, DESIGN.md
 *  tokens unchanged) — now inline because the drag offset (below) shares the
 *  same `transform` property, and only one `transform` can win per element. */
const PIN_OFFSET_TRANSFORM = "translateY(calc(var(--comment-pin-size) + var(--space-xxs)))";

/** Smallest the bubble's corner handle may shrink it to (CSS px) — small enough
 *  to still show a couple of textarea lines + the action row without clipping. */
const MIN_BUBBLE_WIDTH = 160;
const MIN_BUBBLE_HEIGHT = 96;

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
}: {
  anno: Annotation;
  pos: ScreenRect;
  onRetext: (id: string, body: string) => void;
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
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const body = anno.body ?? "";
  // Manual reposition (temporary): a local offset added on top of the anchored
  // `pos`. Resets to {0,0} on every mount — which happens each time the bubble
  // opens (AnnotationLayer only mounts it while selected) — so closing and
  // reopening the box always shows it back at the default position.
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const boxDragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  // Corner-handle resize (user feature request): a LIVE preview while dragging,
  // committed to the store (persisted per comment, AD-8) on release. `null`
  // outside a drag, so the render falls through to the committed
  // `anno.style.bubble_width`/`bubble_height` (or the default CSS size, for a
  // comment never manually resized).
  const [resizeDraft, setResizeDraft] = useState<{ width: number; height: number } | null>(null);
  const resizeRef = useRef<{ startX: number; startY: number; startW: number; startH: number } | null>(null);
  const manualWidth = resizeDraft?.width ?? anno.style.bubble_width ?? null;
  const manualHeight = resizeDraft?.height ?? anno.style.bubble_height ?? null;
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
  // Keep the bubble fully on-screen (Codex MED): the bubble is anchored at the
  // pin's page-local point + a downward transform, so a pin near the right/bottom
  // edge would push the textarea/actions partly out of the viewport. Measure the
  // rendered rect and nudge the inline left/top by the viewport-overflow DELTA
  // (a pure translation, so it works in page-local coords). jsdom has no layout
  // (rect all-zero) → the clamp is a no-op there.
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    el.style.left = `${pos.left}px`;
    el.style.top = `${pos.top}px`;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    const c = clampToViewport(r.left, r.top, r.width, r.height, window.innerWidth, window.innerHeight);
    const dx = c.x - r.left;
    const dy = c.y - r.top;
    if (dx !== 0) el.style.left = `${pos.left + dx}px`;
    if (dy !== 0) el.style.top = `${pos.top + dy}px`;
  }, [body, pos.left, pos.top, manualWidth, manualHeight]);
  return (
    <div
      ref={boxRef}
      className="comment-bubble"
      data-testid={`comment-bubble-${anno.id}`}
      style={{
        left: pos.left,
        top: pos.top,
        transform: `${PIN_OFFSET_TRANSFORM} translate(${dragOffset.x}px, ${dragOffset.y}px)`,
        ...(manualWidth !== null ? { width: `${manualWidth}px` } : {}),
        ...(manualHeight !== null ? { height: `${manualHeight}px` } : {}),
      }}
      // Drag-to-reposition: any EMPTY space inside the bubble starts a drag —
      // excluded by ANCESTRY (closest, not a strict target===boxRef check), so
      // this covers the outer padding AND blank space inside child wrappers
      // (e.g. the gap between the color swatches and the action buttons in
      // .comment-bubble__actions) without hardcoding which wrapper div is
      // "safe." Only the textarea and the swatch/convert/delete controls
      // themselves are excluded, keeping their normal click/focus behavior.
      onPointerDown={(e) => {
        if (e.button !== 0 || (e.target as HTMLElement).closest("textarea, button")) return;
        boxDragRef.current = { startX: e.clientX, startY: e.clientY, originX: dragOffset.x, originY: dragOffset.y };
        try {
          boxRef.current?.setPointerCapture(e.pointerId);
        } catch {
          /* capture refused (e.g. a synthetic test event) — the handlers below still fire on this element */
        }
        e.preventDefault();
      }}
      onPointerMove={(e) => {
        const d = boxDragRef.current;
        if (!d) return;
        setDragOffset({ x: d.originX + (e.clientX - d.startX), y: d.originY + (e.clientY - d.startY) });
      }}
      onPointerUp={() => {
        boxDragRef.current = null;
      }}
      onPointerCancel={() => {
        boxDragRef.current = null;
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
      <textarea
        ref={ref}
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
      <div className="comment-bubble__actions">
        <ColorSwatchRow value={anno.style.color} onPick={onRecolor} ariaLabel="Comment color" />
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
