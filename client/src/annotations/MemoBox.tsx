// MemoBox — one on-page memo box (Story 2.9): an interactive `<textarea>`
// positioned via the denormalized rect. Extracted from AnnotationLayer (Story 5.0)
// so the layer shell stays thin. Each box owns a ref + a layout effect that re-fits
// its height to the content — auto-grow must re-run on body/scale change (zoom,
// remount), not only on the user's keystroke (`onInput`), or long notes clip after
// a re-render (Codex MED). Height is DERIVED, never persisted (NFR-3).
//
// Collapse/expand (user feature request, persisted on style.collapsed, AD-8): a
// small chevron toggle, ALWAYS nested INSIDE the `.annotation-memo` outer box (not
// a sibling) so every existing `.closest(".annotation-memo")` check across the
// codebase (useSelection's deselect guard, useMultiSelectGesture's onMark check,
// the gesture exclusion lists) keeps recognizing a click on the toggle — or its
// own icon child — as landing "on the mark," not empty space (see memory
// [[icon-button-swallowed-by-exempt-check]], the exact bug this dodges). Collapsed
// swaps the editable textarea for a plain, non-editable one-line preview; the
// outer box (testid, position, hover/select) stays the SAME element either way —
// only its CHILD changes. Must expand first, then edit (user decision): a
// collapsed memo has no textarea to type into until the toggle expands it.

import { useLayoutEffect, useRef } from "react";
import { CaretDown, CaretUp } from "@phosphor-icons/react";
import type { Annotation } from "@/api/client";
import type { ScreenRect } from "@/anchor";
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
  onToggleCollapse,
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
  /** Called with the NEXT collapsed value when the toggle chevron is clicked. */
  onToggleCollapse: (id: string, collapsed: boolean) => void;
  /** Called when the textarea gains focus (start of a text-edit session). */
  onTextFocus?: () => void;
  /** Called when the textarea loses focus (end of a text-edit session). */
  onTextBlur?: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const body = anno.body ?? "";
  const collapsed = anno.style.collapsed ?? false;
  // Re-fit height to content whenever the text OR the box geometry changes (the
  // min-height/width ride the scale, so a zoom re-wraps the text). jsdom has no
  // layout (scrollHeight = 0) → the guard keeps it a no-op there. No-ops while
  // collapsed too (ref.current is null — no textarea mounted).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    if (el.scrollHeight > 0) el.style.height = `${el.scrollHeight}px`;
  }, [body, pos.width, pos.height, collapsed]);
  // First line only, always with a literal "(...)" marker while collapsed (user's
  // exact wording) — a plain "collapsed" tell, not conditioned on real overflow.
  const firstLine = body.split(/\r?\n/)[0] ?? "";
  return (
    <div
      className={cls}
      data-testid={`annotation-mark-${anno.id}`}
      // Drag-to-move from empty space, even while UNSELECTED (user feature
      // request): carries the SAME data-edit-handle/data-edit-id pair the
      // rendered edit-frame's own move grip uses (mirrors the movable comment
      // pin), so useEditGesture's document-level handler drives it unchanged —
      // click still selects (native click fires below slop), drag moves. Unlike
      // the pin, a memo nests a rich `.annotation-memo__body` textarea, so
      // useEditGesture additionally checks WHERE inside the wrapper the press
      // landed: on real text, it bails and lets the textarea's own click/select
      // behavior proceed; only genuinely empty space starts a move.
      data-edit-handle="move"
      data-edit-id={anno.id}
      onPointerEnter={() => onHover(anno.id)}
      onPointerLeave={() => onHover(null)}
      onClick={() => onSelect(anno.id)}
      style={{
        left: pos.left,
        top: pos.top,
        width: pos.width,
        ...(collapsed ? {} : { minHeight: pos.height }),
        borderColor: `var(--color-${anno.style.color})`,
        // Background also carries the mark's accent (user request: border-only
        // made too little difference). style.alpha (fix request, the memo twin
        // of pen's alpha) is TRUE transparency, not a lighten-toward-white tint:
        // color-mix toward `transparent` (not `--color-surface-card`) yields the
        // alpha-channel equivalent of `rgba(color, alpha)`, so the page content
        // underneath actually shows through at low alpha (a fix request itself —
        // an earlier version mixed toward white, which only desaturated the box,
        // never let anything behind it show). The border stays full-strength
        // (unaffected) for contrast/legibility; `.annotation-memo__body`'s own
        // `background: transparent` (Annotations.css) means the textarea zone
        // shows through identically to the padding/border zone. `?? 0.35` is the
        // fallback for a memo created before this feature existed.
        backgroundColor: `color-mix(in srgb, var(--color-${anno.style.color}) ${(anno.style.alpha ?? 0.35) * 100}%, transparent)`,
      }}
    >
      <button
        type="button"
        className="memo-collapse-toggle"
        data-testid={`memo-collapse-toggle-${anno.id}`}
        aria-label={collapsed ? "Expand memo" : "Collapse memo"}
        title={collapsed ? "Expand memo" : "Collapse memo"}
        // Stop the click from ALSO bubbling into the box's own onSelect above —
        // toggling is independent of selection (works whether selected or not).
        onClick={(e) => {
          e.stopPropagation();
          onToggleCollapse(anno.id, !collapsed);
        }}
      >
        {collapsed ? <CaretDown aria-hidden /> : <CaretUp aria-hidden />}
      </button>
      {collapsed ? (
        <div className="annotation-memo__preview" data-testid={`memo-preview-${anno.id}`}>
          {firstLine} (...)
        </div>
      ) : (
        <textarea
          ref={ref}
          className="annotation-memo__body"
          data-testid={`memo-body-${anno.id}`}
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
          // Double-click re-edits the note (Story 3.1, IP-6/UX-DR14): focus the
          // textarea so typing resumes immediately (e.g. after moving the box via its
          // edit frame). Edits still write through onChange -> retextAnnotation (the
          // command path); this only moves focus.
          onDoubleClick={() => ref.current?.focus()}
        />
      )}
    </div>
  );
}
