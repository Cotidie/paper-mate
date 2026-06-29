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
import { ColorSwatchRow } from "./annotations";

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
 * Presentational, mirroring `ZoomControl`: `App` holds the single `activeTool`
 * (AD-11), subscribes to the store-backed `activeColor`, and wires the callbacks.
 * The rail reads `activeTool` for its active/armed styling and calls
 * `onSelectTool` to switch (always one click; mutual exclusion is intrinsic to
 * `activeTool`). Pan itself lives in the Reader (it owns the scroll container).
 * The rail's only local state is which flyout (pointer / highlight color) is open.
 */
export default function ToolRail({
  activeTool,
  onSelectTool,
  activeColor,
  onPickColor,
  collapsed,
  onToggleCollapse,
}: {
  /** The single active tool (App owns it; AD-11). */
  activeTool: ActiveTool;
  /** Commit a tool switch. One click always switches; Story 2.6 opens the
   *  Highlight color picker after the parent makes Highlight active. */
  onSelectTool: (t: ActiveTool) => void;
  /** The active annotation color (store-backed; App subscribes and passes it down).
   *  The Highlight tool's color sub-toolbox shows this armed and sets it via
   *  `onPickColor`. */
  activeColor: string;
  /** Set the active color (the default new marks land in). */
  onPickColor: (token: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}) {
  const [open, setOpen] = useState(false);
  // Story 2.6: the Highlight tool's color sub-toolbox — the twin of the pointer
  // flyout. Opens as a SECONDARY gesture (a click on the already-active Highlight
  // button), never on the arming switch itself (AC4 / pointer-button symmetry).
  const [colorOpen, setColorOpen] = useState(false);
  const rootRef = useRef<HTMLElement | null>(null);

  // Close whichever flyout is open on outside-click and Escape (Escape also
  // returns to cursor via the App-level handler — that's fine; here it just
  // dismisses the flyout). One effect serves both the pointer and the highlight
  // color flyout: both live inside the rail (`rootRef`), so an outside pointer-
  // down or Esc closes both.
  useEffect(() => {
    if (!open && !colorOpen) return;
    const closeAll = () => {
      setOpen(false);
      setColorOpen(false);
    };
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) closeAll();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeAll();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, colorOpen]);

  // The pointer button reads ACTIVE when `activeTool` is a pointer tool (cursor/
  // hand/box) — including plain cursor mode, which must show active (the 2.3 #3
  // fix, re-expressed against `activeTool`). When an annotation tool is active,
  // this button is not active; that tool's button is. Exactly one reads active.
  const pointerActive = isPointerTool(activeTool);

  // Switching to an annotation tool (via `H` or the Highlight button while the
  // pointer flyout is open) must not leave the pointer sub-toolbox visible —
  // AC4: a switch never leaves another tool's flyout in its place. Close it
  // whenever the active tool is no longer a pointer tool.
  useEffect(() => {
    if (!pointerActive) setOpen(false);
  }, [pointerActive]);

  // The highlight color flyout opens automatically when highlight becomes the
  // active tool (switching to a tool reveals its sub-toolbox by default — user
  // request) and closes when highlight is no longer active (the inverse path the
  // 2.4 review flagged). Keyed on the highlight-active TRANSITION, so a later
  // pick / re-click / collapse that closes it does not re-open on re-render.
  const highlightActive = activeTool === "highlight";
  useEffect(() => {
    setColorOpen(highlightActive);
  }, [highlightActive]);

  // Collapsing the rail unmounts the buttons; clear both flyouts so expanding
  // later never resurrects a flyout without a fresh secondary gesture (Codex review).
  useEffect(() => {
    if (collapsed) {
      setOpen(false);
      setColorOpen(false);
    }
  }, [collapsed]);
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
          `onSelectTool("highlight")`. Re-clicking an already-active tool does NOT
          cancel it — it stays armed (idempotent). Story 2.6: ARMING highlight (from
          another tool) auto-opens its color sub-toolbox (the effect above, on the
          active transition); a click on the ALREADY-active button toggles that
          sub-toolbox. To leave Highlight, pick another tool or press V/Esc. */}
      {/* Relative wrapper so the color flyout aligns to the Highlight button
          (not the rail's top like the pointer flyout). */}
      <div className="tool-rail__item">
        <button
          type="button"
          className={
            activeTool === "highlight" ? "tool-button tool-button--armed" : "tool-button"
          }
          aria-label="Highlight"
          title="Highlight (H)"
          aria-pressed={activeTool === "highlight"}
          aria-haspopup="menu"
          aria-expanded={colorOpen}
          data-testid="tool-highlight-button"
          onClick={() => {
            if (highlightActive) setColorOpen((o) => !o);
            else onSelectTool("highlight");
          }}
        >
          <Highlighter aria-hidden />
        </button>

        {colorOpen && (
          <div className="tool-flyout" role="menu" data-testid="highlight-color-flyout">
            {/* Reuse the shared swatch row (DESIGN.md#color-swatch): the armed
                swatch (= activeColor) shows the 2px ink ring. Picking sets the
                default color for new marks and closes the flyout (pick-is-dismiss,
                matching the recolor row's feel). */}
            <ColorSwatchRow
              value={activeColor}
              onPick={(token) => {
                onPickColor(token);
                setColorOpen(false);
              }}
            />
          </div>
        )}
      </div>

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
