import { useEffect, useRef, useState } from "react";
import {
  Cursor,
  Hand,
  Selection,
  BoundingBox,
  Highlighter,
  TextUnderline,
  PencilSimple,
  TextT,
  ChatCircle,
  CaretDoubleLeft,
  CaretDoubleRight,
  type Icon,
} from "@phosphor-icons/react";
import { type ActiveTool, type AnnotationTool, type PointerTool, isPointerTool } from "./tools";
import { ColorSwatchRow, StrokeWidthRow, AlphaRow } from "./annotations";
import ToolFlyout from "./ToolFlyout";

/**
 * The cursor-family (pointer) options, in flyout order. `Icon` is the Phosphor
 * (regular) monochrome glyph — it paints with `currentColor`, so it inherits the
 * button's token color (body, or ink when armed). `hint` is the hover tooltip
 * (native `title`); `label` is the accessible name (aria-label). `boxSelect`
 * (user feature request): a marquee drag selects existing annotations for bulk
 * Move/Delete — see `useMultiSelectGesture`.
 */
const OPTIONS: { value: PointerTool; label: string; hint: string; Icon: Icon }[] = [
  { value: "cursor", label: "Cursor", hint: "Cursor: select & read text (V)", Icon: Cursor },
  { value: "hand", label: "Hand", hint: "Hand: drag to pan, or hold Space", Icon: Hand },
  {
    value: "boxSelect",
    label: "Box select",
    hint: "Box select: drag to select multiple annotations",
    Icon: Selection,
  },
];

/**
 * `{component.tool-rail}` — the floating left toolbar (overlay, never reflows the
 * canvas; NFR-1). The shell carries the pointer button + its cursor/hand flyout,
 * the Highlight button (its flyout holds the color row AND the box-highlight mode
 * toggle), and the `[` collapse affordance. The remaining tool buttons
 * (underline/pen/memo/comment/ToC) arrive with their own stories.
 *
 * Presentational, mirroring `ZoomControl`: `App` holds the single `activeTool`
 * (AD-11), subscribes to the store-backed per-tool `activeColors`, and wires the
 * callbacks.
 * The rail reads `activeTool` for its active/armed styling and calls
 * `onSelectTool` to switch (always one click; mutual exclusion is intrinsic to
 * `activeTool`). Pan itself lives in the Reader (it owns the scroll container).
 * The rail's only local state is which flyout (pointer / highlight color) is open.
 */
export default function ToolRail({
  activeTool,
  onSelectTool,
  activeColors,
  onPickColor,
  boxHighlight,
  onSetBoxHighlight,
  activeStrokeWidth,
  onPickStrokeWidth,
  activeAlpha,
  onPickAlpha,
  collapsed,
  onToggleCollapse,
}: {
  /** The single active tool (App owns it; AD-11). */
  activeTool: ActiveTool;
  /** Commit a tool switch. One click always switches; Story 2.6 opens the
   *  Highlight color picker after the parent makes Highlight active. */
  onSelectTool: (t: ActiveTool) => void;
  /** The active annotation color, PER TOOL (store-backed; App subscribes and
   *  passes it down). Each tool's color sub-toolbox shows its OWN entry armed and
   *  sets it via `onPickColor`. */
  activeColors: Record<AnnotationTool, string>;
  /** Set the active color for ONE tool (the default that tool's new marks land in). */
  onPickColor: (tool: AnnotationTool, token: string) => void;
  /** Whether box-highlight mode is on (a mode of the Highlight tool): false = a
   *  drag highlights the TEXT it crosses (the default), true = a drag makes a
   *  rectangular region highlight instead. The Highlight flyout shows both as an
   *  explicit two-option picker (text vs box), not just a single box checkbox. */
  boxHighlight: boolean;
  /** Set box-highlight mode explicitly (the Highlight flyout's text/box pair). */
  onSetBoxHighlight: (value: boolean) => void;
  /** The active pen stroke width (store-backed; Story 2.8). The Pen tool's
   *  sub-toolbox shows this armed and sets it via `onPickStrokeWidth`. */
  activeStrokeWidth: number;
  /** Set the active pen stroke width (the default new strokes land in). */
  onPickStrokeWidth: (width: number) => void;
  /** The active pen stroke alpha (store-backed; Story 2.13). The Pen tool's
   *  sub-toolbox shows this armed and sets it via `onPickAlpha`. */
  activeAlpha: number;
  /** Set the active pen alpha (the default new strokes land in). */
  onPickAlpha: (alpha: number) => void;
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
  const underlineActive = activeTool === "underline";
  const penActive = activeTool === "pen";
  const memoActive = activeTool === "memo";
  const commentActive = activeTool === "comment";

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
            {/* Highlight mode (Story 2.11, relocated + extended): an explicit TWO-OPTION
                picker under the Highlight tool, not its own rail tool. Text (default) vs
                Box are mutually exclusive (`menuitemradio`, mirroring the pointer-tool
                picker above) so both modes are visible/selectable, not just a single box
                checkbox. They sit FIRST, above the colors, with a divider between. A mode
                PICK, so it does NOT close the flyout (the user may still pick a color). */}
            <button
              type="button"
              role="menuitemradio"
              aria-checked={!boxHighlight}
              className={!boxHighlight ? "tool-button tool-button--armed" : "tool-button"}
              aria-label="Text highlight"
              title="Text highlight: drag over text"
              data-testid="highlight-text-toggle"
              onClick={() => onSetBoxHighlight(false)}
            >
              <Highlighter aria-hidden />
            </button>
            <button
              type="button"
              role="menuitemradio"
              aria-checked={boxHighlight}
              className={boxHighlight ? "tool-button tool-button--armed" : "tool-button"}
              aria-label="Box highlight"
              title="Box highlight: drag a region (M)"
              data-testid="highlight-box-toggle"
              onClick={() => onSetBoxHighlight(true)}
            >
              <BoundingBox aria-hidden />
            </button>
            <div className="tool-flyout__divider" data-testid="highlight-box-divider" />
            {/* The shared swatch row (DESIGN.md#color-swatch): the armed swatch
                (= this tool's own activeColors entry) shows the 2px ink ring.
                Picking sets the default color for new HIGHLIGHT marks only and
                closes the flyout (pick-is-dismiss; color is not a tool change, so
                the open-on-switch effect won't reopen). */}
            <ColorSwatchRow
              value={activeColors.highlight}
              onPick={(token) => {
                onPickColor("highlight", token);
                setFlyoutOpen(false);
              }}
            />
          </ToolFlyout>
        )}
      </div>

      {/* Underline — twin of Highlight: a text-anchor color tool. Switching to it
          arms in one click and opens its color sub-toolbox (the activeTool-change
          effect); a click on the already-active button toggles it. Its own entry in
          `activeColors` (per-tool default, split from Highlight by user request). */}
      <div className="tool-rail__item">
        <button
          type="button"
          className={
            activeTool === "underline" ? "tool-button tool-button--armed" : "tool-button"
          }
          aria-label="Underline"
          title="Underline (U)"
          aria-pressed={activeTool === "underline"}
          aria-haspopup="menu"
          aria-expanded={underlineActive && flyoutOpen}
          data-testid="tool-underline-button"
          onClick={() => {
            if (underlineActive) setFlyoutOpen((o) => !o);
            else onSelectTool("underline");
          }}
        >
          <TextUnderline aria-hidden />
        </button>

        {underlineActive && flyoutOpen && (
          <ToolFlyout testId="underline-color-flyout">
            <ColorSwatchRow
              value={activeColors.underline}
              onPick={(token) => {
                onPickColor("underline", token);
                setFlyoutOpen(false);
              }}
            />
          </ToolFlyout>
        )}
      </div>

      {/* Pen — a freehand kind=path tool (Story 2.8). Same arm-in-one-click model;
          its sub-toolbox carries BOTH a color row AND a stroke-width row (UX-DR5).
          Color is Pen's own activeColors entry; width is the shared activeStrokeWidth. */}
      <div className="tool-rail__item">
        <button
          type="button"
          className={activeTool === "pen" ? "tool-button tool-button--armed" : "tool-button"}
          aria-label="Pen"
          title="Pen (D)"
          aria-pressed={activeTool === "pen"}
          aria-haspopup="menu"
          aria-expanded={penActive && flyoutOpen}
          data-testid="tool-pen-button"
          onClick={() => {
            if (penActive) setFlyoutOpen((o) => !o);
            else onSelectTool("pen");
          }}
        >
          <PencilSimple aria-hidden />
        </button>

        {penActive && flyoutOpen && (
          <ToolFlyout testId="pen-flyout">
            <ColorSwatchRow
              value={activeColors.pen}
              onPick={(token) => {
                onPickColor("pen", token);
                setFlyoutOpen(false);
              }}
            />
            {/* Hairline between the color picks and the thickness/opacity pickers,
                so the two control groups read as distinct (same divider the
                Highlight flyout uses above its color row). */}
            <div className="tool-flyout__divider" data-testid="pen-picker-divider" />
            {/* Thickness / Opacity pickers keep the pen flyout OPEN on pick (only
                their own step menu collapses), so the user can adjust both axes
                without re-opening the flyout. Color, like every other tool, closes
                it. */}
            <StrokeWidthRow value={activeStrokeWidth} onPick={onPickStrokeWidth} />
            <AlphaRow value={activeAlpha} onPick={onPickAlpha} />
          </ToolFlyout>
        )}
      </div>

      {/* Memo — a click-to-place kind=rect text box (Story 2.9), below Pen in the
          DESIGN.md#tool-rail order. Same arm-in-one-click model; its sub-toolbox is
          a color row (the box accent) only. Story 3.1 removed the size picker — a
          memo lands at a small default square and resizes via its corner handles. */}
      <div className="tool-rail__item">
        <button
          type="button"
          className={activeTool === "memo" ? "tool-button tool-button--armed" : "tool-button"}
          aria-label="Memo"
          title="Memo (T)"
          aria-pressed={activeTool === "memo"}
          aria-haspopup="menu"
          aria-expanded={memoActive && flyoutOpen}
          data-testid="tool-memo-button"
          onClick={() => {
            if (memoActive) setFlyoutOpen((o) => !o);
            else onSelectTool("memo");
          }}
        >
          <TextT aria-hidden />
        </button>

        {memoActive && flyoutOpen && (
          <ToolFlyout testId="memo-flyout">
            <ColorSwatchRow
              value={activeColors.memo}
              onPick={(token) => {
                onPickColor("memo", token);
                setFlyoutOpen(false);
              }}
            />
          </ToolFlyout>
        )}
      </div>

      {/* Comment — a text+pin annotation (Story 2.10), below Memo in the
          DESIGN.md#tool-rail order. Same arm-in-one-click model; its sub-toolbox
          carries a color row only (no width/size). A drag highlights the run + a
          pin; a click drops a pin only. Its own entry in activeColors. */}
      <div className="tool-rail__item">
        <button
          type="button"
          className={activeTool === "comment" ? "tool-button tool-button--armed" : "tool-button"}
          aria-label="Comment"
          title="Comment (C)"
          aria-pressed={activeTool === "comment"}
          aria-haspopup="menu"
          aria-expanded={commentActive && flyoutOpen}
          data-testid="tool-comment-button"
          onClick={() => {
            if (commentActive) setFlyoutOpen((o) => !o);
            else onSelectTool("comment");
          }}
        >
          <ChatCircle aria-hidden />
        </button>

        {commentActive && flyoutOpen && (
          <ToolFlyout testId="comment-flyout">
            <ColorSwatchRow
              value={activeColors.comment}
              onPick={(token) => {
                onPickColor("comment", token);
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
