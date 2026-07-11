// CommentPreview — the comment's HOVER-triggered compact preview (user feature
// request): a lightweight glance-and-edit surface shown while a comment's pin
// is hovered and NOT selected. Selecting the comment opens the full
// `CommentBubble` instead (recolor/convert/delete) — the split is deliberate:
// hover is for reading + quick text edits, click-to-select is for restyling.
// Anchored at the pin's screen point exactly like `CommentBubble` (the SAME
// pin-nudge transform + viewport clamp), but stripped down: no drag, no color
// row, no convert/delete, no autofocus-on-open — hovering must never steal
// focus or block the pointer from moving on.
//
// Hover-intent: `hovered` flips instantly (pin pointerenter/leave, group-aware
// via AnnotationLayer's `markState`), but closing on the FIRST flip-false would
// make the box unusable — the pointer has to cross the real gap between the pin
// and the box, and during that crossing NEITHER element is hovered. This
// component stays mounted per comment and keeps itself visible for a short
// grace window after `hovered` goes false, cancelled the moment it goes true
// again (the box's own pointerenter re-affirms it) — the same debounced-clear
// shape as the store's `flashAnnotation` auto-clear timer.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Annotation } from "@/api/client";
import type { ScreenRect } from "@/anchor";
import { clampToViewport } from "./position";
import "./Annotations.css";

/** Grace window (ms) the preview stays open after the pointer leaves the pin,
 *  so it survives the gap to reach the box itself. Exported so tests assert
 *  against the real value instead of a duplicated magic number. */
export const HOVER_CLOSE_DELAY_MS = 200;

/** Mirrors CommentBubble's own pin-nudge transform: both float the SAME
 *  distance below the pin, off the same anchor point. */
const PIN_OFFSET_TRANSFORM = "translateY(calc(var(--comment-pin-size) + var(--space-xxs)))";

export default function CommentPreview({
  anno,
  pos,
  hovered,
  onRetext,
  onHoverEnter,
  onHoverLeave,
  onTextFocus,
  onTextBlur,
}: {
  anno: Annotation;
  pos: ScreenRect;
  /** True while the pin (or this box) is hovered, group-aware (AnnotationLayer's
   *  `markState`) — the OPEN trigger; closing lags it by `HOVER_CLOSE_DELAY_MS`. */
  hovered: boolean;
  onRetext: (id: string, body: string) => void;
  /** Keeps `hoveredId` alive while the pointer sits on the box itself (not just
   *  the pin), so the hover ring and this box stay in sync. */
  onHoverEnter: () => void;
  onHoverLeave: () => void;
  /** Called when the textarea gains focus (start of a text-edit session). */
  onTextFocus?: () => void;
  /** Called when the textarea loses focus (end of a text-edit session). */
  onTextBlur?: () => void;
}) {
  const [visible, setVisible] = useState(hovered);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (hovered) {
      if (closeTimer.current) {
        clearTimeout(closeTimer.current);
        closeTimer.current = null;
      }
      setVisible(true);
      return;
    }
    closeTimer.current = setTimeout(() => setVisible(false), HOVER_CLOSE_DELAY_MS);
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, [hovered]);

  const boxRef = useRef<HTMLDivElement | null>(null);
  const body = anno.body ?? "";
  // Mirrors CommentBubble's own manualWidth/manualHeight read (CommentBubble.tsx:73-74),
  // minus the live resizeDraft — the preview has no resize handle of its own.
  const manualWidth = anno.style.bubble_width ?? null;
  const manualHeight = anno.style.bubble_height ?? null;
  // Auto-position clamp: the same treatment as CommentBubble (nudged back
  // on-screen near a viewport edge). jsdom has no layout (rect all-zero) → a
  // no-op there, matching CommentBubble's own guard.
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el || !visible) return;
    el.style.left = `${pos.left}px`;
    el.style.top = `${pos.top}px`;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    const c = clampToViewport(r.left, r.top, r.width, r.height, window.innerWidth, window.innerHeight);
    const dx = c.x - r.left;
    const dy = c.y - r.top;
    if (dx !== 0) el.style.left = `${pos.left + dx}px`;
    if (dy !== 0) el.style.top = `${pos.top + dy}px`;
  }, [visible, body, pos.left, pos.top, manualWidth, manualHeight]);

  if (!visible) return null;
  return (
    <div
      ref={boxRef}
      className="comment-preview"
      data-testid={`comment-preview-${anno.id}`}
      style={{
        left: pos.left,
        top: pos.top,
        transform: PIN_OFFSET_TRANSFORM,
        ...(manualWidth !== null ? { width: `${manualWidth}px` } : {}),
        ...(manualHeight !== null ? { height: `${manualHeight}px` } : {}),
      }}
      onPointerEnter={onHoverEnter}
      onPointerLeave={onHoverLeave}
    >
      <textarea
        className={
          manualHeight !== null ? "comment-preview__text comment-preview__text--manual-size" : "comment-preview__text"
        }
        data-testid={`comment-preview-body-${anno.id}`}
        aria-label="Comment"
        value={body}
        onChange={(e) => onRetext(anno.id, e.target.value)}
        onFocus={onTextFocus}
        onBlur={onTextBlur}
      />
    </div>
  );
}
