// StrokeWidthRow — the pen quick-box stroke-width steps (UX-DR5/DR7,
// DESIGN.md#annotation-pen). The width twin of ColorSwatchRow: a row of fixed
// stroke-width steps (thin/medium/thick) as round dots whose size previews the
// line weight; the currently-applied width shows the 2px ink armed ring.
// Keyboard-reachable (it lives inside the rail flyout / quick-box `role="menu"`).
//
// Widths are scale-1.0 CSS px (the renderer multiplies by zoom). They mirror the
// --pen-stroke-* tokens so the dots and the actual stroke stay in step; kept here
// as the single list the rail flyout AND the pen selection quick-box share.

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
  { width: 2, key: "thin", label: "Thin" },
  { width: 4, key: "medium", label: "Medium" },
  { width: 8, key: "thick", label: "Thick" },
];

export default function StrokeWidthRow({
  value,
  onPick,
}: {
  /** The stroke width currently applied (its step shows armed). */
  value: number;
  /** Called with the chosen width when a step is picked. */
  onPick: (width: number) => void;
}) {
  return (
    <div className="stroke-width-row" role="group" aria-label="Pen stroke width">
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
            onClick={() => onPick(s.width)}
          >
            {/* A black ink dot whose diameter previews the stroke weight. The CELL
                is a uniform footprint (like the color swatch) so the dots align;
                the dot size is the `--pen-stroke-<key>` token (no raw px here). */}
            <span className={`stroke-width-step__dot stroke-width-step__dot--${s.key}`} />
          </button>
        );
      })}
    </div>
  );
}
