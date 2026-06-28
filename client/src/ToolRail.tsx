import { useEffect, useRef, useState } from "react";
import {
  Cursor,
  Hand,
  Selection,
  CaretDoubleLeft,
  CaretDoubleRight,
  type Icon,
} from "@phosphor-icons/react";

/**
 * The active pointer tool. Shared by `App` (owner), `Reader` (reads `hand` to
 * arm panning), and `ToolRail` (the picker). One definition lives here so the
 * three agree. `box-select` is selectable for visual parity but its drag is
 * Story 2.6 — it does nothing this story.
 */
export type ToolMode = "cursor" | "hand" | "box-select";

/**
 * The cursor-family options, in flyout order. `Icon` is the Phosphor (regular)
 * monochrome glyph — it paints with `currentColor`, so it inherits the button's
 * token color (body, or ink when armed). `hint` is the hover tooltip (native
 * `title`); `label` is the accessible name (aria-label).
 */
const OPTIONS: { value: ToolMode; label: string; hint: string; Icon: Icon }[] = [
  { value: "cursor", label: "Cursor", hint: "Cursor: select & read text (V)", Icon: Cursor },
  { value: "hand", label: "Hand", hint: "Hand: drag to pan, or hold Space", Icon: Hand },
  { value: "box-select", label: "Box select", hint: "Box select", Icon: Selection },
];

/**
 * `{component.tool-rail}` — the floating left toolbar (overlay, never reflows the
 * canvas; NFR-1). This first tool-rail story stands up an extensible shell with
 * just the cursor button + its cursor/hand/box-select flyout and the `[` collapse
 * affordance. The other tool buttons (highlight/underline/pen/memo/comment/ToC)
 * arrive with their own stories.
 *
 * Presentational, mirroring `ZoomControl`: it owns no scroll/scale/mode state —
 * `App` holds `mode`/`collapsed` and wires the callbacks. Pan itself lives in the
 * Reader (it owns the scroll container); the rail only picks the armed tool.
 */
export default function ToolRail({
  mode,
  onMode,
  collapsed,
  onToggleCollapse,
}: {
  mode: ToolMode;
  onMode: (m: ToolMode) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLElement | null>(null);

  // Close the flyout on outside-click and Escape (Escape also returns to cursor
  // via the App-level handler — that's fine; here it just dismisses the flyout).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // The icon shown on the rail button reflects the armed sub-mode.
  const active = OPTIONS.find((o) => o.value === mode) ?? OPTIONS[0];
  const ActiveIcon = active.Icon;
  // A non-default tool (hand / box-select) shows the armed state on the button.
  const armed = mode !== "cursor";

  if (collapsed) {
    // Minimal rail: a single affordance to expand again (`[` or click round-trips).
    return (
      <aside className="tool-rail tool-rail--collapsed" data-testid="tool-rail" aria-label="Tools">
        <button
          type="button"
          className="tool-button"
          aria-label="Expand tools"
          title="Expand tools ([)"
          data-testid="tool-rail-collapse"
          onClick={onToggleCollapse}
        >
          <CaretDoubleRight aria-hidden />
        </button>
      </aside>
    );
  }

  return (
    <aside className="tool-rail" data-testid="tool-rail" aria-label="Tools" ref={rootRef}>
      <button
        type="button"
        className={armed ? "tool-button tool-button--armed" : "tool-button"}
        aria-label={`Pointer tool: ${active.label}`}
        title={active.hint}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="tool-cursor-button"
        onClick={() => setOpen((o) => !o)}
      >
        <ActiveIcon aria-hidden />
      </button>

      {open && (
        <div className="tool-flyout" role="menu" data-testid="tool-flyout">
          {OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              role="menuitemradio"
              className={mode === o.value ? "tool-button tool-button--armed" : "tool-button"}
              aria-label={o.label}
              title={o.hint}
              aria-pressed={mode === o.value}
              data-testid={`tool-option-${o.value}`}
              onClick={() => {
                onMode(o.value);
                setOpen(false);
              }}
            >
              <o.Icon aria-hidden />
            </button>
          ))}
        </div>
      )}

      <button
        type="button"
        className="tool-button tool-rail__collapse"
        aria-label="Collapse tools"
        title="Collapse tools ([)"
        data-testid="tool-rail-collapse"
        onClick={onToggleCollapse}
      >
        <CaretDoubleLeft aria-hidden />
      </button>
    </aside>
  );
}
