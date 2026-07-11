// AlphaRow — the Opacity picker (Story 2.13, pen; fix request extended it to
// Memo), the alpha twin of StrokeWidthRow. COLLAPSIBLE like SizeRow: an
// ICON-ONLY trigger (an ink disc filled at the current alpha, WRAPPED in a
// hairline ring so the fade reads as opacity — toolrail-glyph sized, no caret,
// no text) that expands a small floating menu to the RIGHT of fixed alpha
// levels as ink squares whose fill-opacity previews the transparency; the
// applied alpha shows the 2px ink armed ring. Keyboard-reachable (it lives
// inside the rail flyout / quick-box `role="menu"`); the meaning lives in the
// aria-label / tooltip (the `label` prop, "Pen opacity" or "Memo opacity"),
// not visible text (the rail stays icon-only).
//
// Alpha values mirror the --pen-alpha-* tokens (no raw numbers in the component;
// the token layer owns them). Shared by the Pen AND Memo rail flyouts, and both
// tools' selection quick-boxes.

import { useState } from "react";
import "./Annotations.css";

interface Step {
  /** Alpha value 0..1 (the value stored on the mark). */
  alpha: number;
  /** Token key — the swatch opacity comes from `--pen-alpha-<key>` via CSS. */
  key: "low" | "mid" | "high" | "full";
  /** Accessible name + hover tooltip (no em-dash; plain word). */
  label: string;
}

const STEPS: Step[] = [
  { alpha: 0.2, key: "low",  label: "Low"  },
  { alpha: 0.4, key: "mid",  label: "Mid"  },
  { alpha: 0.6, key: "high", label: "High" },
  { alpha: 1.0, key: "full", label: "Full" },
];

export default function AlphaRow({
  value,
  onPick,
  label = "Pen opacity",
}: {
  /** The alpha currently applied (its step shows armed; the trigger previews it). */
  value: number;
  /** Called with the chosen alpha when a step is picked. */
  onPick: (alpha: number) => void;
  /** Accessible name / tooltip prefix (fix request: reused for Memo's opacity
   *  row too, "Memo opacity"). Defaults to the original Pen wording. */
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const current = STEPS.find((s) => s.alpha === value) ?? STEPS[1];
  return (
    <div className="alpha-row" role="group" aria-label={label}>
      <button
        type="button"
        className="pen-picker__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${label}: ${current.label}`}
        title={`${label} (${current.label})`}
        data-testid="alpha-trigger"
        onClick={() => setOpen((o) => !o)}
      >
        {/* An ink disc filled at the current alpha, wrapped in a hairline ring, so
            the collapsed control reads as opacity at a glance (icon-only). */}
        <span className="pen-opacity-icon" aria-hidden>
          <span className={`pen-opacity-icon__fill pen-opacity-icon__fill--${current.key}`} />
        </span>
      </button>

      {open && (
        <div className="pen-picker__menu" role="menu" aria-label={label}>
          {STEPS.map((s) => {
            const armed = value === s.alpha;
            return (
              <button
                key={s.alpha}
                type="button"
                role="menuitemradio"
                className={armed ? "alpha-step alpha-step--armed" : "alpha-step"}
                aria-label={s.label}
                aria-checked={armed}
                title={s.label}
                data-testid={`alpha-${s.alpha}`}
                onClick={() => {
                  onPick(s.alpha);
                  setOpen(false);
                }}
              >
                {/* A square swatch whose fill-opacity previews the transparency. */}
                <span className={`alpha-step__swatch alpha-step__swatch--${s.key}`} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
