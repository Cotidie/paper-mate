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
import ToolFlyout from "./ToolFlyout";

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
  // ONE open/close bit for the active tool's sub-toolbar — whichever tool is
  // active, its flyout (pointer cursor/hand/box, or the Highlight color row) is
  // the one shown. Since exactly one tool is active (AD-11), one boolean suffices.
  const [flyoutOpen, setFlyoutOpen] = useState(false);
  const rootRef = useRef<HTMLElement | null>(null);

  const pointerActive = isPointerTool(activeTool);
  const highlightActive = activeTool === "highlight";

  // ONE consistent mechanism (Story 2.6 refinement): switching to ANY tool opens
  // that tool's sub-toolbar by default. Detect a real CHANGE of `activeTool`
  // (compare to the previous value) so it does NOT fire on mount — the initial
  // cursor default must not pop a flyout at load — and is StrictMode-safe (a
  // double-invoked effect with an unchanged tool is a no-op).
  const prevTool = useRef(activeTool);
  useEffect(() => {
    if (prevTool.current !== activeTool) setFlyoutOpen(true);
    prevTool.current = activeTool;
  }, [activeTool]);

  // Esc / outside-click close the open flyout (it lives inside the rail, so an
  // outside pointer-down or Esc dismisses it).
  useEffect(() => {
    if (!flyoutOpen) return;
    const close = () => setFlyoutOpen(false);
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [flyoutOpen]);

  // Collapsing the rail unmounts the buttons; close the flyout so expanding later
  // never resurrects it without a fresh switch/gesture (Codex review).
  useEffect(() => {
    if (collapsed) setFlyoutOpen(false);
  }, [collapsed]);

  // The pointer sub-mode the button shows: the active pointer tool when one is
  // active, else cursor (the default).
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
      {/* Every tool sits in a `.tool-rail__item` wrapper so its `ToolFlyout`
          sub-toolrail anchors to ITS button identically (same horizontal origin,
          same vertical alignment) — the one shared shell for all tools. */}
      <div className="tool-rail__item">
        <button
          type="button"
          className={pointerActive ? "tool-button tool-button--armed" : "tool-button"}
          aria-label={`Pointer tool: ${active.label}`}
          title={active.hint}
          aria-haspopup="menu"
          aria-expanded={pointerActive && flyoutOpen}
          data-testid="tool-cursor-button"
          // When the pointer tool is already active, the click toggles its flyout.
          // Otherwise it switches to the pointer tool; the activeTool-change effect
          // then opens that flyout by default (one consistent mechanism).
          onClick={() => {
            if (pointerActive) setFlyoutOpen((o) => !o);
            else onSelectTool(pointerMode);
          }}
        >
          <ActiveIcon aria-hidden />
        </button>

        {pointerActive && flyoutOpen && (
          <ToolFlyout testId="tool-flyout">
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
                // Picking a sub-mode switches the tool; the change-effect keeps the
                // flyout open showing the new armed sub-mode (consistent mechanism).
                onClick={() => onSelectTool(o.value)}
              >
                <o.Icon aria-hidden />
              </button>
            ))}
          </ToolFlyout>
        )}
      </div>

      {/* Annotation tools (Story 2.3 adds Highlight; later stories add the rest
          below it in DESIGN.md#tool-rail order). Same model as the pointer button:
          switching TO Highlight opens its color sub-toolbar by default (the
          activeTool-change effect); a click on the ALREADY-active button toggles
          it. Re-clicking an active tool never disarms it. To leave Highlight, pick
          another tool or press V/Esc. */}
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
          aria-expanded={highlightActive && flyoutOpen}
          data-testid="tool-highlight-button"
          onClick={() => {
            if (highlightActive) setFlyoutOpen((o) => !o);
            else onSelectTool("highlight");
          }}
        >
          <Highlighter aria-hidden />
        </button>

        {highlightActive && flyoutOpen && (
          <ToolFlyout testId="highlight-color-flyout">
            {/* The shared swatch row (DESIGN.md#color-swatch): the armed swatch
                (= activeColor) shows the 2px ink ring. Picking sets the default
                color for new marks and closes the flyout (pick-is-dismiss; color is
                not a tool change, so the open-on-switch effect won't reopen). */}
            <ColorSwatchRow
              value={activeColor}
              onPick={(token) => {
                onPickColor(token);
                setFlyoutOpen(false);
              }}
            />
          </ToolFlyout>
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
