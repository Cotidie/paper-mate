// MemoBox — one on-page memo box (Story 2.9): an interactive `<textarea>`
// positioned via the denormalized rect. Extracted from AnnotationLayer (Story 5.0)
// so the layer shell stays thin. Each box owns a ref + a layout effect that re-fits
// its height to the content — auto-grow must re-run on body/scale change (zoom,
// remount), not only on the user's keystroke (`onInput`), or long notes clip after
// a re-render (Codex MED). Height is DERIVED, never persisted (NFR-3).

import { useLayoutEffect, useRef } from "react";
import type { Annotation } from "../api/client";
import type { ScreenRect } from "../anchor";
import "./Annotations.css";

export default function MemoBox({
  anno,
  pos,
  cls,
  selected,
  onRetext,
  onSelect,
  onHover,
  onClearSelection,
  onTextFocus,
  onTextBlur,
}: {
  anno: Annotation;
  pos: ScreenRect;
  cls: string;
  selected: boolean;
  onRetext: (id: string, body: string) => void;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
  onClearSelection: () => void;
  /** Called when the textarea gains focus (start of a text-edit session). */
  onTextFocus?: () => void;
  /** Called when the textarea loses focus (end of a text-edit session). */
  onTextBlur?: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const body = anno.body ?? "";
  // Re-fit height to content whenever the text OR the box geometry changes (the
  // min-height/width ride the scale, so a zoom re-wraps the text). jsdom has no
  // layout (scrollHeight = 0) → the guard keeps it a no-op there.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    if (el.scrollHeight > 0) el.style.height = `${el.scrollHeight}px`;
  }, [body, pos.width, pos.height]);
  return (
    <textarea
      ref={ref}
      className={cls}
      data-testid={`annotation-mark-${anno.id}`}
      aria-label="Memo"
      value={body}
      autoFocus={selected}
      onChange={(e) => onRetext(anno.id, e.target.value)}
      onFocus={onTextFocus}
      onBlur={onTextBlur}
      onKeyDown={(e) => {
        // Esc blurs + deselects the memo from INSIDE the textarea (it is exempt
        // from the document-level tool/selection keys, so Esc would otherwise be
        // swallowed and leave the memo focused — Codex MED). A non-empty memo
        // survives; an empty one is removed by the deselect cleanup.
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          e.currentTarget.blur();
          onClearSelection();
        }
      }}
      onPointerEnter={() => onHover(anno.id)}
      onPointerLeave={() => onHover(null)}
      onClick={() => onSelect(anno.id)}
      // Double-click re-edits the note (Story 3.1, IP-6/UX-DR14): focus the
      // textarea so typing resumes immediately (e.g. after moving the box via its
      // edit frame). Edits still write through onChange -> retextAnnotation (the
      // command path); this only moves focus.
      onDoubleClick={() => ref.current?.focus()}
      style={{
        left: pos.left,
        top: pos.top,
        width: pos.width,
        minHeight: pos.height,
        borderColor: `var(--color-${anno.style.color})`,
      }}
    />
  );
}
