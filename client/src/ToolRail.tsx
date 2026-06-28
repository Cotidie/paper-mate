import { useEffect, useRef, useState } from "react";
import {
  Cursor,
  Hand,
  Selection,
  Highlighter,
  CaretDoubleLeft,
  CaretDoubleRight,
  type Icon,
} from "@phosphor-icons/react";
import { type ActiveTool, type PointerTool, isPointerTool } from "./tools";

/**
 * The cursor-family (pointer) options, in flyout order. `Icon` is the Phosphor
 * (regular) monochrome glyph — it paints with `currentColor`, so it inherits the
 * button's token color (body, or ink when armed). `hint` is the hover tooltip
 * (native `title`); `label` is the accessible name (aria-label). `box` is
 * armable for parity but its drag is Story 2.11 (does nothing this story).
 */
const OPTIONS: { value: PointerTool; label: string; hint: string; Icon: Icon }[] = [
  { value: "cursor", label: "Cursor", hint: "Cursor: select & read text (V)", Icon: Cursor },
  { value: "hand", label: "Hand", hint: "Hand: drag to pan, or hold Space", Icon: Hand },
  { value: "box", label: "Box select", hint: "Box select", Icon: Selection },
];

/**
 * `{component.tool-rail}` — the floating left toolbar (overlay, never reflows the
 * canvas; NFR-1). The shell carries the pointer button + its cursor/hand/box
 * flyout, the Highlight button, and the `[` collapse affordance. The remaining
 * tool buttons (underline/pen/memo/comment/ToC) arrive with their own stories.
 *
 * Presentational, mirroring `ZoomControl`: it owns no tool state — `App` holds
 * the single `activeTool` (AD-11) and `collapsed` and wires the callbacks. The
 * rail reads `activeTool` for its active/armed styling and calls `onSelectTool`
 * to switch (always one click; mutual exclusion is intrinsic to `activeTool`).
 * Pan itself lives in the Reader (it owns the scroll container). The rail's only
 * local state is whether the pointer flyout is open.
 */
export default function ToolRail({
  activeTool,
  onSelectTool,
  collapsed,
  onToggleCollapse,
}: {
  /** The single active tool (App owns it; AD-11). */
  activeTool: ActiveTool;
  /** Commit a tool switch. One click always switches; never opens a sub-toolbox
   *  in place of the switch (AC4), so Story 2.6's arm-time picker is safe. */
  onSelectTool: (t: ActiveTool) => void;
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

  // The pointer button reads ACTIVE when `activeTool` is a pointer tool (cursor/
  // hand/box) — including plain cursor mode, which must show active (the 2.3 #3
  // fix, re-expressed against `activeTool`). When an annotation tool is active,
  // this button is not active; that tool's button is. Exactly one reads active.
  const pointerActive = isPointerTool(activeTool);
  // The pointer sub-mode the button shows + commits to in one click: the active
  // pointer tool when one is active, else cursor (the default, AC4).
  const pointerMode: PointerTool = isPointerTool(activeTool) ? activeTool : "cursor";
  const active = OPTIONS.find((o) => o.value === pointerMode) ?? OPTIONS[0];
  const ActiveIcon = active.Icon;

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
        className={pointerActive ? "tool-button tool-button--armed" : "tool-button"}
        aria-label={`Pointer tool: ${active.label}`}
        title={active.hint}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="tool-cursor-button"
        // Single-click switch (AC4): when a pointer tool is NOT active (e.g.
        // Highlight is armed), one click COMMITS to the pointer sub-mode and
        // opens no flyout. When the pointer tool is already active, the click
        // opens the flyout to choose a different sub-mode (a secondary gesture).
        onClick={() => {
          if (pointerActive) setOpen((o) => !o);
          else onSelectTool(pointerMode);
        }}
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
              className={activeTool === o.value ? "tool-button tool-button--armed" : "tool-button"}
              aria-label={o.label}
              title={o.hint}
              aria-pressed={activeTool === o.value}
              data-testid={`tool-option-${o.value}`}
              onClick={() => {
                onSelectTool(o.value);
                setOpen(false);
              }}
            >
              <o.Icon aria-hidden />
            </button>
          ))}
        </div>
      )}

      {/* Annotation tools (Story 2.3 adds Highlight; later stories add the rest
          below it in DESIGN.md#tool-rail order). One model: arming is just
          `onSelectTool("highlight")`; a second click toggles back to cursor
          (preserving the 2.3 toggle-off feel). */}
      <button
        type="button"
        className={
          activeTool === "highlight" ? "tool-button tool-button--armed" : "tool-button"
        }
        aria-label="Highlight"
        title="Highlight (H)"
        aria-pressed={activeTool === "highlight"}
        data-testid="tool-highlight-button"
        onClick={() => onSelectTool(activeTool === "highlight" ? "cursor" : "highlight")}
      >
        <Highlighter aria-hidden />
      </button>

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
