// AlphaRow — the pen transparency steps (Story 2.13), the alpha twin of
// StrokeWidthRow. A row of fixed alpha levels as ink squares whose fill-opacity
// previews the transparency; the currently-applied alpha shows the 2px ink
// armed ring. Keyboard-reachable (it lives inside the rail flyout / quick-box
// `role="menu"`).
//
// Alpha values mirror the --pen-alpha-* tokens (no raw numbers in the
// component; the token layer owns them). Shared by the Pen rail flyout AND the
// pen selection quick-box.

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
}: {
  /** The alpha currently applied (its step shows armed). */
  value: number;
  /** Called with the chosen alpha when a step is picked. */
  onPick: (alpha: number) => void;
}) {
  return (
    <div className="alpha-row" role="group" aria-label="Pen opacity">
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
            onClick={() => onPick(s.alpha)}
          >
            {/* A square swatch whose fill-opacity previews the transparency.
                The cell is a uniform footprint (like the color swatch) so the
                steps align; opacity is the `--pen-alpha-<key>` token. */}
            <span className={`alpha-step__swatch alpha-step__swatch--${s.key}`} />
          </button>
        );
      })}
    </div>
  );
}
