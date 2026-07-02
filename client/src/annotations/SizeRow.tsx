// SizeRow — the memo box-size picker (Story 2.9, UX-DR5; DESIGN.md#annotation-memo).
// The size twin of ColorSwatchRow/StrokeWidthRow, but COLLAPSIBLE: a single
// compact trigger showing the current size with a caret, that expands a short
// vertical list of the size steps (small/medium/large). One control keeps the
// rail flyout / quick-box narrow (the step ROW widened the pen flyout — the memo
// picker avoids that from the start; the pen row is converted separately).
//
// Sizes are scale-1.0 CSS px (the placement bakes them into the rect, the
// renderer multiplies by zoom). The step list comes from MEMO_SIZES so the
// preview boxes and the actual memo box stay in step. Keyboard-reachable: it
// lives inside the rail flyout / quick-box `role="menu"`.

import { useState } from "react";
import { CaretDown } from "@phosphor-icons/react";
import { MEMO_SIZES, type MemoSize } from "@/store";
import "./Annotations.css";

/** Plain accessible names (no em-dash). */
const LABELS: Record<MemoSize["key"], string> = {
  small: "Small",
  medium: "Medium",
  large: "Large",
};

export default function SizeRow({
  value,
  onPick,
}: {
  /** The size currently applied (its step shows armed; the trigger previews it). */
  value: MemoSize;
  /** Called with the chosen size when a step is picked. */
  onPick: (size: MemoSize) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = MEMO_SIZES.find((s) => s.key === value.key) ?? MEMO_SIZES[1];
  return (
    <div className="size-row" role="group" aria-label="Memo size">
      <button
        type="button"
        className="size-row__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Memo size: ${LABELS[current.key]}`}
        title={`Memo size (${LABELS[current.key]})`}
        data-testid="memo-size-trigger"
        onClick={() => setOpen((o) => !o)}
      >
        {/* A mini memo-box previewing the current size; the caret signals it opens. */}
        <span className={`size-row__preview size-row__preview--${current.key}`} aria-hidden />
        <CaretDown className="size-row__caret" aria-hidden />
      </button>

      {open && (
        <div className="size-row__menu" role="menu" aria-label="Memo size">
          {MEMO_SIZES.map((s) => {
            const armed = s.key === value.key;
            return (
              <button
                key={s.key}
                type="button"
                role="menuitemradio"
                className={armed ? "size-row__step size-row__step--armed" : "size-row__step"}
                aria-label={LABELS[s.key]}
                aria-checked={armed}
                title={LABELS[s.key]}
                data-testid={`memo-size-${s.key}`}
                onClick={() => {
                  onPick(s);
                  setOpen(false);
                }}
              >
                <span className={`size-row__preview size-row__preview--${s.key}`} aria-hidden />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
