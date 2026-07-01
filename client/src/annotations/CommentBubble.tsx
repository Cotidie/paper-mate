// CommentBubble — the comment's note popup (Story 2.10): the twin of `MemoBox`,
// but a floating surface off the pin (not the on-page box). Extracted from
// AnnotationLayer (Story 5.0). A `<textarea>` bound to `body` + a `ColorSwatchRow`
// (recolor tints the fill AND the pin) + a delete. Anchored at the pin's screen
// point (`pos`); CSS nudges it below the pin. Mounts only while the comment is
// selected → mount = open, unmount = close: it focuses its textarea on open (AC2)
// and RETURNS focus to the prior element on close (the unmount cleanup). Owns its
// ref + the auto-grow layout effect (like `MemoBox`).

import { useEffect, useLayoutEffect, useRef } from "react";
import { Highlighter, Trash } from "@phosphor-icons/react";
import type { Annotation } from "../api/client";
import type { ScreenRect } from "../anchor";
import ColorSwatchRow from "./ColorSwatchRow";
import { clampToViewport } from "./position";
import "./Annotations.css";

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
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const body = anno.body ?? "";
  // Focus moves INTO the textarea on open; on close (unmount) it RETURNS to the
  // element focused before the bubble opened (UX-DR8/DR17). Runs once per open.
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => prev?.focus?.();
  }, []);
  // Auto-grow the textarea to its content whenever the text OR position changes
  // (zoom re-anchors it). jsdom has no layout (scrollHeight 0) → guarded no-op.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    if (el.scrollHeight > 0) el.style.height = `${el.scrollHeight}px`;
  }, [body, pos.left, pos.top]);
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
  }, [body, pos.left, pos.top]);
  return (
    <div
      ref={boxRef}
      className="comment-bubble"
      data-testid={`comment-bubble-${anno.id}`}
      style={{ left: pos.left, top: pos.top }}
      // Esc dismisses from ANY control in the bubble, not just the textarea
      // (Codex MED): the swatch/delete buttons are exempt from the document-level
      // selection keys, so Esc on them would otherwise do nothing. Handling it on
      // the container catches every focused child.
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          (document.activeElement as HTMLElement | null)?.blur?.();
          onClearSelection();
        }
      }}
    >
      <textarea
        ref={ref}
        className="comment-bubble__text"
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
    </div>
  );
}
