// ColorSwatchRow — the highlight/underline quick-box recolor row (UX-DR5/DR6,
// DESIGN.md#color-swatch). A row of the 5 annotation accent colors as 20px
// pills; the currently-applied color shows the 2px ink armed ring. Keyboard-
// reachable (it lives inside the quick-box `role="menu"`). Stories 2.4/2.5 reuse
// this same row for underline/pen.
//
// Color tokens are stored as bare names (e.g. "annotation-green"); the layer
// paints them via `var(--color-<name>)`. The first swatch is "annotation-default"
// (aliases yellow, the default highlight color, per DESIGN.md) so a just-landed
// default highlight shows its swatch armed.

import "./Annotations.css";

interface Swatch {
  /** The style.color token name stored on the annotation. */
  token: string;
  /** Accessible name + hover tooltip (no em-dash; plain color word). */
  label: string;
}

const PALETTE: Swatch[] = [
  { token: "annotation-default", label: "Yellow" },
  { token: "annotation-green", label: "Green" },
  { token: "annotation-pink", label: "Pink" },
  { token: "annotation-blue", label: "Blue" },
  { token: "annotation-purple", label: "Purple" },
];

export default function ColorSwatchRow({
  value,
  onPick,
}: {
  /** The color token currently applied to the mark (its swatch shows armed). */
  value: string;
  /** Called with the chosen token when a swatch is picked. */
  onPick: (token: string) => void;
}) {
  return (
    <div className="color-swatch-row" role="group" aria-label="Highlight color">
      {PALETTE.map((s) => {
        const armed = value === s.token;
        return (
          <button
            key={s.token}
            type="button"
            role="menuitemradio"
            className={armed ? "color-swatch color-swatch--armed" : "color-swatch"}
            aria-label={s.label}
            aria-checked={armed}
            title={s.label}
            data-testid={`color-swatch-${s.token}`}
            style={{ backgroundColor: `var(--color-${s.token})` }}
            onClick={() => onPick(s.token)}
          />
        );
      })}
    </div>
  );
}
