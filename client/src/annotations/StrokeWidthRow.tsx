// StrokeWidthRow — the pen Thickness picker (UX-DR5/DR7, DESIGN.md#annotation-pen).
// COLLAPSIBLE like SizeRow: an ICON-ONLY trigger (a horizontal ink weight-bar whose
// thickness previews the current width — toolrail-glyph sized, no caret, no text)
// that expands a small floating menu to the RIGHT of the three width steps
// (thin/medium/thick) as round dots whose size previews the line weight; the applied
// width shows the 2px ink armed ring. Keyboard-reachable (it lives inside the rail
// flyout / quick-box `role="menu"`); the meaning lives in the aria-label / tooltip,
// not visible text (the rail stays icon-only).
//
// Widths are scale-1.0 CSS px (the renderer multiplies by zoom). They mirror the
// --pen-stroke-* tokens so the dots and the actual stroke stay in step; kept here
// as the single list the rail flyout AND the pen selection quick-box share.

import { useState } from "react";
import "./Annotations.css";

interface Step {
  /** Stroke diameter in scale-1.0 CSS px (the value stored on the mark). */
  width: number;
  /** Token key — the dot size comes from `--pen-stroke-<key>` via a CSS class, so
   *  no raw px lives in this component (the token layer owns the px). */
  key: "thin" | "medium" | "thick";
  /** Accessible name + hover tooltip (no em-dash; plain word). */
  label: string;
}

const STEPS: Step[] = [
  { width: 4, key: "thin", label: "Thin" },
  { width: 8, key: "medium", label: "Medium" },
  { width: 16, key: "thick", label: "Thick" },
];

export default function StrokeWidthRow({
  value,
  onPick,
}: {
  /** The stroke width currently applied (its step shows armed; the trigger previews it). */
  value: number;
  /** Called with the chosen width when a step is picked. */
  onPick: (width: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = STEPS.find((s) => s.width === value) ?? STEPS[1];
  return (
    <div className="stroke-width-row" role="group" aria-label="Pen stroke width">
      <button
        type="button"
        className="pen-picker__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Pen thickness: ${current.label}`}
        title={`Pen thickness (${current.label})`}
        data-testid="stroke-width-trigger"
        onClick={() => setOpen((o) => !o)}
      >
        {/* A horizontal ink bar whose thickness IS the current width, so the
            collapsed control reads as line weight at a glance (icon-only). */}
        <span className={`pen-thickness-icon pen-thickness-icon--${current.key}`} aria-hidden />
      </button>

      {open && (
        <div className="pen-picker__menu" role="menu" aria-label="Pen stroke width">
          {STEPS.map((s) => {
            const armed = value === s.width;
            return (
              <button
                key={s.width}
                type="button"
                role="menuitemradio"
                className={armed ? "stroke-width-step stroke-width-step--armed" : "stroke-width-step"}
                aria-label={s.label}
                aria-checked={armed}
                title={s.label}
                data-testid={`stroke-width-${s.width}`}
                onClick={() => {
                  onPick(s.width);
                  setOpen(false);
                }}
              >
                {/* A black ink dot whose diameter previews the stroke weight; the
                    cell is a uniform footprint so the dots align. */}
                <span className={`stroke-width-step__dot stroke-width-step__dot--${s.key}`} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
