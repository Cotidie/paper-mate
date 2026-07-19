// CommentPreview — the comment's HOVER-triggered compact preview (user feature
// request): a lightweight glance-and-edit surface shown while a comment's pin
// is hovered and NOT selected. Selecting the comment opens the full
// `CommentBubble` instead (recolor/convert/delete) — the split is deliberate:
// hover is for reading + quick text edits, click-to-select is for restyling.
// Anchored at the pin's screen point exactly like `CommentBubble` (the SAME
// pin-nudge transform, no viewport clamp), but stripped down: no drag, no
// color row, no convert/delete, no autofocus-on-open — hovering must never
// steal focus or block the pointer from moving on.
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
  onSelect,
  scale = 1,
  compact = false,
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
  /** Click-to-select (fix request): any click on the preview — padding or the
   *  textarea itself — promotes it to the full `CommentBubble` (recolor/
   *  delete/resize), matching this component's own doc comment: hover is for
   *  reading + quick edits, click-to-select is for restyling. */
  onSelect?: (id: string) => void;
  /** Current zoom scale (fix request: `bubble_offset_x/y` is persisted
   *  scale-1.0-independent, mirrors `CommentBubble`'s own `* scale` read — see
   *  its comment). Not itself position-critical for a static (non-dragging)
   *  preview, but needed to rescale the persisted offset correctly. */
  scale?: number;
  /** True for a BOX comment (fix request): the caller has already positioned
   *  `pos` beside the highlight, so no pin-offset shift is applied here. This
   *  component never had color/delete chrome, so `compact` only affects
   *  positioning (unlike `CommentBubble`'s `compact`). */
  compact?: boolean;
}) {
  // Mirrors CommentBubble's persisted drag offset (Story 10.5): a static read,
  // no drag of its own — without this, a moved comment's hover-glance preview
  // would visibly snap back to the stale pin-relative spot while the real
  // (selected) bubble shows the moved position. Declared before the close-timer
  // effect below (Codex MED): it needs the pin-to-box DISTANCE to size the
  // grace window correctly for a comment moved far from its pin. Scaled up
  // from its scale-1.0-independent storage (fix request, see CommentBubble).
  const offsetX = (anno.style.bubble_offset_x ?? 0) * scale;
  const offsetY = (anno.style.bubble_offset_y ?? 0) * scale;
  const [visible, setVisible] = useState(hovered);
  // Fade-in on direct hover (fix request): the box opens at the pin's own idle
  // opacity (the SAME token .annotation-comment-pin uses when not hovered/
  // selected) while the pointer is still just crossing from the pin, so it
  // reads as a light preview rather than a fully-present box — then snaps to
  // full opacity the moment the pointer actually enters it (the same
  // pointerenter that already keeps `hoveredId` alive below).
  const [pointerOverBox, setPointerOverBox] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Fix request: the grace window exists ONLY to bridge the pin→box gap on
  // the way IN — once the pointer has actually reached the box at least once
  // this open cycle, there is nothing left to bridge, so leaving (to neither
  // pin nor box) closes immediately instead of lingering (visibly, now that
  // the opacity fade above makes the wait visible) for the same window.
  const enteredBoxRef = useRef(false);
  useEffect(() => {
    if (hovered) {
      if (closeTimer.current) {
        clearTimeout(closeTimer.current);
        closeTimer.current = null;
      }
      setVisible(true);
      return;
    }
    if (enteredBoxRef.current) {
      enteredBoxRef.current = false;
      setVisible(false);
      return;
    }
    // Codex MED: `HOVER_CLOSE_DELAY_MS` alone assumes a SHORT pin-to-box gap
    // (true when the box always sat just below the pin) — now that Story 10.5
    // lets the box persist anywhere the user dragged it, a large offset can
    // leave a gap the pointer physically can't cross before the fixed window
    // elapses, closing the preview before it's ever reached. Scale the delay
    // by the actual pin-to-box distance, floored at the base delay so a
    // never-moved (or barely-moved) comment is completely unaffected. The
    // 2 px/ms assumption is a generous, unhurried pointer speed for a drag
    // offset, which in practice stays within a viewport or two.
    const dist = Math.hypot(offsetX, offsetY);
    const closeDelay = Math.max(HOVER_CLOSE_DELAY_MS, dist / 2);
    closeTimer.current = setTimeout(() => setVisible(false), closeDelay);
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, [hovered, offsetX, offsetY]);

  const boxRef = useRef<HTMLDivElement | null>(null);
  const body = anno.body ?? "";
  // Mirrors CommentBubble's own manualWidth/manualHeight read (CommentBubble.tsx:73-74),
  // minus the live resizeDraft — the preview has no resize handle of its own.
  const manualWidth = anno.style.bubble_width ?? null;
  const manualHeight = anno.style.bubble_height ?? null;
  // Positions from the live anchor point (fix request: no viewport clamp,
  // mirrors CommentBubble — a note the user may be reading/editing is allowed
  // to overflow the viewport rather than jump to an unrelated spot).
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el || !visible) return;
    el.style.left = `${pos.left}px`;
    el.style.top = `${pos.top}px`;
  }, [visible, body, pos.left, pos.top, manualWidth, manualHeight, offsetX, offsetY]);

  if (!visible) return null;
  return (
    <div
      ref={boxRef}
      className="comment-preview"
      data-testid={`comment-preview-${anno.id}`}
      style={{
        left: pos.left,
        top: pos.top,
        opacity: pointerOverBox ? 1 : "var(--comment-pin-opacity)",
        transform: compact
          ? `translate(${offsetX}px, ${offsetY}px)`
          : `${PIN_OFFSET_TRANSFORM} translate(${offsetX}px, ${offsetY}px)`,
        ...(manualWidth !== null ? { width: `${manualWidth}px` } : {}),
        ...(manualHeight !== null ? { height: `${manualHeight}px` } : {}),
      }}
      onPointerEnter={() => {
        setPointerOverBox(true);
        enteredBoxRef.current = true;
        onHoverEnter();
      }}
      onPointerLeave={() => {
        setPointerOverBox(false);
        onHoverLeave();
      }}
      onClick={() => onSelect?.(anno.id)}
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
