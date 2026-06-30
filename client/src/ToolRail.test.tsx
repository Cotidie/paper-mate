import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import ToolRail from "./ToolRail";
import type { ActiveTool } from "./tools";
import { DEFAULT_MEMO_SIZE, MEMO_SIZES, type MemoSize } from "./store";

afterEach(cleanup);

type RailProps = {
  activeTool: ActiveTool;
  activeColor: string;
  boxHighlight: boolean;
  activeStrokeWidth: number;
  activeAlpha: number;
  activeMemoSize: MemoSize;
  collapsed: boolean;
};

// Render helper: supplies all required props with overridable defaults, keeps the
// spies STABLE across rerenders, and exposes `update(over)` to change props (e.g.
// switch the active tool) so tests can drive the open-on-tool-change behavior.
function renderRail(over: Partial<RailProps> = {}) {
  const onSelectTool = vi.fn();
  const onPickColor = vi.fn();
  const onToggleBoxHighlight = vi.fn();
  const onPickStrokeWidth = vi.fn();
  const onPickAlpha = vi.fn();
  const onPickMemoSize = vi.fn();
  const onToggleCollapse = vi.fn();
  let props: RailProps = {
    activeTool: "cursor",
    activeColor: "annotation-default",
    boxHighlight: false,
    activeStrokeWidth: 4,
    activeAlpha: 0.4,
    activeMemoSize: DEFAULT_MEMO_SIZE,
    collapsed: false,
    ...over,
  };
  const el = (p: RailProps) => (
    <ToolRail
      activeTool={p.activeTool}
      onSelectTool={onSelectTool}
      activeColor={p.activeColor}
      onPickColor={onPickColor}
      boxHighlight={p.boxHighlight}
      onToggleBoxHighlight={onToggleBoxHighlight}
      activeStrokeWidth={p.activeStrokeWidth}
      onPickStrokeWidth={onPickStrokeWidth}
      activeAlpha={p.activeAlpha}
      onPickAlpha={onPickAlpha}
      activeMemoSize={p.activeMemoSize}
      onPickMemoSize={onPickMemoSize}
      collapsed={p.collapsed}
      onToggleCollapse={onToggleCollapse}
    />
  );
  const utils = render(el(props));
  const update = (next: Partial<RailProps>) => {
    props = { ...props, ...next };
    utils.rerender(el(props));
  };
  return { ...utils, onSelectTool, onPickColor, onToggleBoxHighlight, onPickStrokeWidth, onPickAlpha, onPickMemoSize, onToggleCollapse, update };
}

// Arm Pen (Story 2.8): start on cursor, switch to pen so the open-on-tool-change
// effect pops its color + stroke-width sub-toolbox.
function armPen(over: Partial<RailProps> = {}) {
  const r = renderRail({ activeTool: "cursor", ...over });
  r.update({ activeTool: "pen" });
  return r;
}

// Arm Memo (Story 2.9): start on cursor, switch to memo so the open-on-tool-change
// effect pops its color + size sub-toolbox.
function armMemo(over: Partial<RailProps> = {}) {
  const r = renderRail({ activeTool: "cursor", ...over });
  r.update({ activeTool: "memo" });
  return r;
}

// Arm Comment (Story 2.10): start on cursor, switch to comment so the
// open-on-tool-change effect pops its color sub-toolbox.
function armComment(over: Partial<RailProps> = {}) {
  const r = renderRail({ activeTool: "cursor", ...over });
  r.update({ activeTool: "comment" });
  return r;
}

// Arm Highlight the way the app does — start on cursor, then SWITCH to highlight —
// so the open-on-tool-change effect pops the color sub-toolbar (it does NOT open
// on mount). Returns the same stable spies + `update`.
function armHighlight(over: Partial<RailProps> = {}) {
  const r = renderRail({ activeTool: "cursor", ...over });
  r.update({ activeTool: "highlight" });
  return r;
}

// Same for Underline (Story 2.7): start on cursor, switch to underline so the
// open-on-tool-change effect pops its color sub-toolbar.
function armUnderline(over: Partial<RailProps> = {}) {
  const r = renderRail({ activeTool: "cursor", ...over });
  r.update({ activeTool: "underline" });
  return r;
}

describe("ToolRail", () => {
  it("renders the rail shell (data-testid kept stable for App.test)", () => {
    renderRail();
    expect(screen.getByTestId("tool-rail")).toBeTruthy();
    // Flyout is closed until the cursor button is clicked.
    expect(screen.queryByTestId("tool-flyout")).toBeNull();
  });

  it("opens the flyout with cursor / hand on the cursor button when a pointer tool is active", () => {
    renderRail({ activeTool: "cursor" });
    const btn = screen.getByTestId("tool-cursor-button");
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("tool-flyout")).toBeTruthy();
    expect(screen.getByTestId("tool-option-cursor")).toBeTruthy();
    expect(screen.getByTestId("tool-option-hand")).toBeTruthy();
    // Box-select is no longer a pointer sub-mode — it moved under Highlight.
    expect(screen.queryByTestId("tool-option-box")).toBeNull();
  });

  it("picking a pointer sub-mode switches the tool; the flyout stays open showing it (unified mechanism)", () => {
    const r = renderRail({ activeTool: "cursor" });
    fireEvent.click(screen.getByTestId("tool-cursor-button")); // open the flyout
    fireEvent.click(screen.getByTestId("tool-option-hand"));
    expect(r.onSelectTool).toHaveBeenCalledWith("hand");
    // The parent applies the switch; the flyout stays open showing hand armed
    // (switching to a tool keeps its sub-toolbar shown — the one consistent rule).
    r.update({ activeTool: "hand" });
    expect(screen.getByTestId("tool-flyout")).toBeTruthy();
    expect(screen.getByTestId("tool-option-hand").getAttribute("aria-pressed")).toBe("true");
  });

  it("reflects the active pointer tool (aria-pressed on the option, armed class on the button)", () => {
    renderRail({ activeTool: "hand" });
    // The rail button shows the armed state for a non-default pointer tool.
    expect(screen.getByTestId("tool-cursor-button").className).toContain("tool-button--armed");
    fireEvent.click(screen.getByTestId("tool-cursor-button"));
    expect(screen.getByTestId("tool-option-hand").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("tool-option-cursor").getAttribute("aria-pressed")).toBe("false");
  });

  it("shows the pointer button active in plain cursor mode (#3)", () => {
    renderRail({ activeTool: "cursor" });
    // The selection tool IS the active tool in cursor mode — it must read active.
    expect(screen.getByTestId("tool-cursor-button").className).toContain("tool-button--armed");
  });

  it("pointer button is NOT active when an annotation tool is active (mutual exclusion)", () => {
    renderRail({ activeTool: "highlight" });
    expect(screen.getByTestId("tool-cursor-button").className).not.toContain("tool-button--armed");
    expect(screen.getByTestId("tool-highlight-button").className).toContain("tool-button--armed");
  });

  // (Removed the old "single-click switch opens no flyout (AC4)" unit test: that
  // rule is superseded — switching to a tool now opens its sub-toolbar. The
  // one-click switch itself is covered end-to-end in App.test.)

  it("closes an open pointer flyout when the active tool switches to an annotation tool", () => {
    // Open the flyout in cursor mode, then switch to highlight: the stale pointer
    // sub-toolbar must not remain (the highlight color flyout replaces it).
    const r = renderRail({ activeTool: "cursor" });
    fireEvent.click(screen.getByTestId("tool-cursor-button"));
    expect(screen.getByTestId("tool-flyout")).toBeTruthy();
    r.update({ activeTool: "highlight" });
    expect(screen.queryByTestId("tool-flyout")).toBeNull();
  });

  it("gives every tool a hover tooltip (native title) describing it + its shortcut", () => {
    renderRail({ activeTool: "cursor" });
    // Rail button + collapse have tooltips.
    expect(screen.getByTestId("tool-cursor-button").getAttribute("title")).toBeTruthy();
    expect(screen.getByTestId("tool-rail-collapse").getAttribute("title")).toBeTruthy();
    // Each flyout option has a descriptive tooltip.
    fireEvent.click(screen.getByTestId("tool-cursor-button"));
    for (const v of ["cursor", "hand"]) {
      expect(screen.getByTestId(`tool-option-${v}`).getAttribute("title")).toBeTruthy();
    }
    // The hand tooltip mentions panning + the Space shortcut.
    expect(screen.getByTestId("tool-option-hand").getAttribute("title")).toMatch(/pan/i);
  });

  it("arms highlight from the Highlight button (Story 2.3)", () => {
    const { onSelectTool } = renderRail({ activeTool: "cursor" });
    const btn = screen.getByTestId("tool-highlight-button");
    expect(btn.className).not.toContain("tool-button--armed");
    expect(btn.getAttribute("title")).toBe("Highlight (H)");
    fireEvent.click(btn);
    expect(onSelectTool).toHaveBeenCalledWith("highlight");
  });

  it("the highlight color flyout opens when highlight becomes active", () => {
    const { rerender } = renderRail({ activeTool: "cursor" });
    expect(screen.queryByTestId("highlight-color-flyout")).toBeNull();
    rerender(
      <ToolRail
        activeTool="highlight"
        onSelectTool={vi.fn()}
        activeColor="annotation-default"
        onPickColor={vi.fn()}
        boxHighlight={false}
        onToggleBoxHighlight={vi.fn()}
        activeStrokeWidth={4}
        onPickStrokeWidth={vi.fn()}
        activeAlpha={0.4}
        onPickAlpha={vi.fn()}
        activeMemoSize={DEFAULT_MEMO_SIZE}
        onPickMemoSize={vi.fn()}
        collapsed={false}
        onToggleCollapse={vi.fn()}
      />,
    );
    expect(screen.getByTestId("highlight-color-flyout")).toBeTruthy();
    expect(screen.getByTestId("tool-highlight-button").getAttribute("aria-expanded")).toBe("true");
  });

  // ── Story 2.6 refinement: ONE mechanism — switching to ANY tool opens its bar ─
  it("switching to a POINTER tool also opens the pointer flyout (unified mechanism)", () => {
    // Start on highlight (color flyout open), switch to cursor: the pointer flyout
    // opens by default, the color flyout is gone. Same rule for every tool.
    const r = armHighlight();
    expect(screen.getByTestId("highlight-color-flyout")).toBeTruthy();
    r.update({ activeTool: "cursor" });
    expect(screen.queryByTestId("highlight-color-flyout")).toBeNull();
    expect(screen.getByTestId("tool-flyout")).toBeTruthy();
  });

  it("re-clicking the ALREADY-active Highlight tool toggles its color sub-toolbox, never disarms (Story 2.6)", () => {
    const { onSelectTool } = armHighlight();
    const btn = screen.getByTestId("tool-highlight-button");
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("highlight-color-flyout")).toBeTruthy();
    fireEvent.click(btn);
    // Closes the color flyout; does NOT call onSelectTool (stays armed, idempotent).
    expect(screen.queryByTestId("highlight-color-flyout")).toBeNull();
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(onSelectTool).not.toHaveBeenCalled();
    // A second click opens it again.
    fireEvent.click(btn);
    expect(screen.getByTestId("highlight-color-flyout")).toBeTruthy();
  });

  // ── Story 2.6: the color sub-toolbox itself ────────────────────────────────
  it("the highlight color sub-toolbox shows the 5-color swatch row with activeColor armed", () => {
    armHighlight({ activeColor: "annotation-green" });
    const flyout = screen.getByTestId("highlight-color-flyout");
    expect(flyout).toBeTruthy();
    // Exactly 5 swatches (trimmed palette); the active color is armed.
    expect(flyout.querySelectorAll(".color-swatch")).toHaveLength(5);
    expect(screen.getByTestId("color-swatch-annotation-green").className).toContain(
      "color-swatch--armed",
    );
  });

  it("picking a swatch sets the active color (onPickColor) and closes the flyout (Story 2.6)", () => {
    const { onPickColor } = armHighlight({ activeColor: "annotation-default" });
    fireEvent.click(screen.getByTestId("color-swatch-annotation-blue"));
    expect(onPickColor).toHaveBeenCalledWith("annotation-blue");
    expect(screen.queryByTestId("highlight-color-flyout")).toBeNull();
  });

  it("Escape closes the open color sub-toolbox (Story 2.6)", () => {
    armHighlight();
    expect(screen.getByTestId("highlight-color-flyout")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("highlight-color-flyout")).toBeNull();
  });

  it("an outside pointer-down closes the open color sub-toolbox (Story 2.6)", () => {
    armHighlight();
    expect(screen.getByTestId("highlight-color-flyout")).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByTestId("highlight-color-flyout")).toBeNull();
  });

  // ── Box-highlight: a MODE toggle under the Highlight tool (relocated 2.11) ──
  it("the highlight flyout carries a box-highlight toggle reflecting boxHighlight", () => {
    armHighlight({ boxHighlight: false });
    const toggle = screen.getByTestId("highlight-box-toggle");
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(toggle.className).not.toContain("tool-button--armed");
    // Lives inside the highlight color flyout, not as a top-level rail tool.
    expect(screen.getByTestId("highlight-color-flyout").contains(toggle)).toBe(true);
    expect(screen.queryByTestId("tool-option-box")).toBeNull();
  });

  it("shows the box-highlight toggle armed when boxHighlight is on", () => {
    armHighlight({ boxHighlight: true });
    const toggle = screen.getByTestId("highlight-box-toggle");
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(toggle.className).toContain("tool-button--armed");
  });

  it("clicking the box-highlight toggle calls onToggleBoxHighlight and keeps the flyout open", () => {
    const { onToggleBoxHighlight } = armHighlight({ boxHighlight: false });
    fireEvent.click(screen.getByTestId("highlight-box-toggle"));
    expect(onToggleBoxHighlight).toHaveBeenCalledTimes(1);
    // A mode toggle, NOT a pick — the flyout stays open (unlike a color swatch).
    expect(screen.getByTestId("highlight-color-flyout")).toBeTruthy();
  });

  it("the color sub-toolbox closes when the active tool switches away from highlight", () => {
    const r = armHighlight();
    expect(screen.getByTestId("highlight-color-flyout")).toBeTruthy();
    r.update({ activeTool: "cursor" });
    expect(screen.queryByTestId("highlight-color-flyout")).toBeNull();
  });

  it("clears an open color sub-toolbox when the rail collapses (Codex review MED)", () => {
    const r = armHighlight();
    expect(screen.getByTestId("highlight-color-flyout")).toBeTruthy();
    // Collapse, then expand: the flyout must NOT resurrect without a new switch.
    r.update({ collapsed: true });
    r.update({ collapsed: false });
    expect(screen.queryByTestId("highlight-color-flyout")).toBeNull();
  });

  it("shows the Highlight button armed when activeTool is highlight (Story 2.3)", () => {
    renderRail({ activeTool: "highlight" });
    const btn = screen.getByTestId("tool-highlight-button");
    expect(btn.className).toContain("tool-button--armed");
    expect(btn.getAttribute("aria-pressed")).toBe("true");
  });

  // ── Story 2.7: the Underline tool (twin of Highlight) ──────────────────────
  it("arms underline in ONE click from another tool; switching to it opens its color sub-toolbox", () => {
    const r = renderRail({ activeTool: "cursor" });
    const btn = screen.getByTestId("tool-underline-button");
    expect(btn.getAttribute("title")).toBe("Underline (U)");
    expect(btn.className).not.toContain("tool-button--armed");
    expect(screen.queryByTestId("underline-color-flyout")).toBeNull();
    fireEvent.click(btn);
    expect(r.onSelectTool).toHaveBeenCalledWith("underline");
    // The parent applies the switch → the underline color sub-toolbox opens.
    r.update({ activeTool: "underline" });
    expect(btn.className).toContain("tool-button--armed");
    expect(screen.getByTestId("underline-color-flyout")).toBeTruthy();
    expect(btn.getAttribute("aria-expanded")).toBe("true");
  });

  it("re-clicking the active Underline button toggles its color sub-toolbox, never disarms", () => {
    const { onSelectTool } = armUnderline();
    const btn = screen.getByTestId("tool-underline-button");
    expect(screen.getByTestId("underline-color-flyout")).toBeTruthy();
    fireEvent.click(btn);
    expect(screen.queryByTestId("underline-color-flyout")).toBeNull();
    expect(onSelectTool).not.toHaveBeenCalled();
    fireEvent.click(btn);
    expect(screen.getByTestId("underline-color-flyout")).toBeTruthy();
  });

  it("the underline color sub-toolbox shows the 5-swatch row with activeColor armed; picking sets it + closes", () => {
    const { onPickColor } = armUnderline({ activeColor: "annotation-green" });
    const flyout = screen.getByTestId("underline-color-flyout");
    expect(flyout.querySelectorAll(".color-swatch")).toHaveLength(5);
    expect(screen.getByTestId("color-swatch-annotation-green").className).toContain("color-swatch--armed");
    fireEvent.click(screen.getByTestId("color-swatch-annotation-blue"));
    expect(onPickColor).toHaveBeenCalledWith("annotation-blue");
    expect(screen.queryByTestId("underline-color-flyout")).toBeNull();
  });

  it("the underline sub-toolbox closes on Escape / switch-away", () => {
    const r = armUnderline();
    expect(screen.getByTestId("underline-color-flyout")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("underline-color-flyout")).toBeNull();
    // Re-arm, then switch away to highlight: gone.
    r.update({ activeTool: "cursor" });
    r.update({ activeTool: "underline" });
    expect(screen.getByTestId("underline-color-flyout")).toBeTruthy();
    r.update({ activeTool: "highlight" });
    expect(screen.queryByTestId("underline-color-flyout")).toBeNull();
  });

  // ── Story 2.8: the Pen tool (color + stroke-width sub-toolbox) ─────────────
  it("arms pen in ONE click from another tool; switching to it opens its sub-toolbox", () => {
    const r = renderRail({ activeTool: "cursor" });
    const btn = screen.getByTestId("tool-pen-button");
    expect(btn.getAttribute("title")).toBe("Pen (D)");
    expect(btn.className).not.toContain("tool-button--armed");
    expect(screen.queryByTestId("pen-flyout")).toBeNull();
    fireEvent.click(btn);
    expect(r.onSelectTool).toHaveBeenCalledWith("pen");
    r.update({ activeTool: "pen" });
    expect(btn.className).toContain("tool-button--armed");
    expect(screen.getByTestId("pen-flyout")).toBeTruthy();
    expect(btn.getAttribute("aria-expanded")).toBe("true");
  });

  it("the pen sub-toolbox shows the color row + collapsible thickness and opacity pickers (Story 2.13)", () => {
    armPen({ activeColor: "annotation-green", activeStrokeWidth: 8, activeAlpha: 0.4 });
    const flyout = screen.getByTestId("pen-flyout");
    expect(flyout.querySelectorAll(".color-swatch")).toHaveLength(5);
    expect(screen.getByTestId("color-swatch-annotation-green").className).toContain("color-swatch--armed");
    // Thickness + Opacity are collapsed triggers; their steps appear only on expand.
    expect(screen.getByTestId("stroke-width-trigger")).toBeTruthy();
    expect(screen.getByTestId("alpha-trigger")).toBeTruthy();
    expect(flyout.querySelectorAll(".stroke-width-step")).toHaveLength(0);
    // Expand Thickness: three width steps, the active width armed.
    fireEvent.click(screen.getByTestId("stroke-width-trigger"));
    expect(flyout.querySelectorAll(".stroke-width-step")).toHaveLength(3);
    expect(screen.getByTestId("stroke-width-8").className).toContain("stroke-width-step--armed");
    // Expand Opacity: four alpha steps, the active alpha armed.
    fireEvent.click(screen.getByTestId("alpha-trigger"));
    expect(flyout.querySelectorAll(".alpha-step")).toHaveLength(4);
    expect(screen.getByTestId("alpha-0.4").className).toContain("alpha-step--armed");
  });

  it("picking a stroke width calls onPickStrokeWidth, KEEPS the flyout open, and collapses the step menu", () => {
    const { onPickStrokeWidth } = armPen({ activeStrokeWidth: 4 });
    fireEvent.click(screen.getByTestId("stroke-width-trigger"));
    fireEvent.click(screen.getByTestId("stroke-width-8"));
    expect(onPickStrokeWidth).toHaveBeenCalledWith(8);
    // The pen flyout stays open (so the user can keep tuning); only the inner
    // thickness step menu collapses.
    expect(screen.getByTestId("pen-flyout")).toBeTruthy();
    expect(screen.queryByTestId("stroke-width-8")).toBeNull();
  });

  it("picking an alpha calls onPickAlpha, KEEPS the flyout open, and collapses the step menu (Story 2.13)", () => {
    const { onPickAlpha } = armPen({ activeAlpha: 0.4 });
    fireEvent.click(screen.getByTestId("alpha-trigger"));
    fireEvent.click(screen.getByTestId("alpha-0.6"));
    expect(onPickAlpha).toHaveBeenCalledWith(0.6);
    // Flyout stays open; only the inner opacity step menu collapses.
    expect(screen.getByTestId("pen-flyout")).toBeTruthy();
    expect(screen.queryByTestId("alpha-0.6")).toBeNull();
  });

  it("picking a pen color calls onPickColor and closes the flyout", () => {
    const { onPickColor } = armPen({ activeColor: "annotation-default" });
    fireEvent.click(screen.getByTestId("color-swatch-annotation-pink"));
    expect(onPickColor).toHaveBeenCalledWith("annotation-pink");
    expect(screen.queryByTestId("pen-flyout")).toBeNull();
  });

  it("re-clicking the active Pen button toggles its sub-toolbox, never disarms", () => {
    const { onSelectTool } = armPen();
    const btn = screen.getByTestId("tool-pen-button");
    expect(screen.getByTestId("pen-flyout")).toBeTruthy();
    fireEvent.click(btn);
    expect(screen.queryByTestId("pen-flyout")).toBeNull();
    expect(onSelectTool).not.toHaveBeenCalled();
    fireEvent.click(btn);
    expect(screen.getByTestId("pen-flyout")).toBeTruthy();
  });

  it("the pen sub-toolbox closes on Escape / switch-away", () => {
    const r = armPen();
    expect(screen.getByTestId("pen-flyout")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("pen-flyout")).toBeNull();
    r.update({ activeTool: "cursor" });
    r.update({ activeTool: "pen" });
    expect(screen.getByTestId("pen-flyout")).toBeTruthy();
    r.update({ activeTool: "highlight" });
    expect(screen.queryByTestId("pen-flyout")).toBeNull();
  });

  // ── Story 2.9: the Memo tool (color + collapsible size sub-toolbox) ─────────
  it("arms memo in ONE click from another tool; switching to it opens its sub-toolbox", () => {
    const r = renderRail({ activeTool: "cursor" });
    const btn = screen.getByTestId("tool-memo-button");
    expect(btn.getAttribute("title")).toBe("Memo (T)");
    expect(btn.className).not.toContain("tool-button--armed");
    expect(screen.queryByTestId("memo-flyout")).toBeNull();
    fireEvent.click(btn);
    expect(r.onSelectTool).toHaveBeenCalledWith("memo");
    r.update({ activeTool: "memo" });
    expect(btn.className).toContain("tool-button--armed");
    expect(screen.getByTestId("memo-flyout")).toBeTruthy();
    expect(btn.getAttribute("aria-expanded")).toBe("true");
  });

  it("the memo sub-toolbox shows the color swatch row AND the collapsible size picker", () => {
    armMemo({ activeColor: "annotation-green" });
    const flyout = screen.getByTestId("memo-flyout");
    expect(flyout.querySelectorAll(".color-swatch")).toHaveLength(5);
    expect(screen.getByTestId("color-swatch-annotation-green").className).toContain("color-swatch--armed");
    // The size control is collapsed (a single trigger), not a 3-step row.
    expect(screen.getByTestId("memo-size-trigger")).toBeTruthy();
    expect(screen.queryByTestId("memo-size-small")).toBeNull();
  });

  it("picking a memo size calls onPickMemoSize and closes the flyout", () => {
    const { onPickMemoSize } = armMemo({ activeMemoSize: DEFAULT_MEMO_SIZE });
    fireEvent.click(screen.getByTestId("memo-size-trigger"));
    const large = MEMO_SIZES.find((s) => s.key === "large")!;
    fireEvent.click(screen.getByTestId("memo-size-large"));
    expect(onPickMemoSize).toHaveBeenCalledWith(large);
    expect(screen.queryByTestId("memo-flyout")).toBeNull();
  });

  it("picking a memo color calls onPickColor and closes the flyout", () => {
    const { onPickColor } = armMemo({ activeColor: "annotation-default" });
    fireEvent.click(screen.getByTestId("color-swatch-annotation-pink"));
    expect(onPickColor).toHaveBeenCalledWith("annotation-pink");
    expect(screen.queryByTestId("memo-flyout")).toBeNull();
  });

  it("re-clicking the active Memo button toggles its sub-toolbox, never disarms; Esc / switch-away close it", () => {
    const r = armMemo();
    const btn = screen.getByTestId("tool-memo-button");
    expect(screen.getByTestId("memo-flyout")).toBeTruthy();
    fireEvent.click(btn);
    expect(screen.queryByTestId("memo-flyout")).toBeNull();
    expect(r.onSelectTool).not.toHaveBeenCalled();
    fireEvent.click(btn);
    expect(screen.getByTestId("memo-flyout")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("memo-flyout")).toBeNull();
    // Switch away then back so the open-on-tool-change effect re-pops it.
    r.update({ activeTool: "cursor" });
    r.update({ activeTool: "memo" });
    expect(screen.getByTestId("memo-flyout")).toBeTruthy();
    r.update({ activeTool: "highlight" });
    expect(screen.queryByTestId("memo-flyout")).toBeNull();
  });

  it("arms comment in ONE click from another tool; switching to it opens its sub-toolbox", () => {
    const r = renderRail({ activeTool: "cursor" });
    const btn = screen.getByTestId("tool-comment-button");
    expect(btn.getAttribute("title")).toBe("Comment (C)");
    expect(btn.className).not.toContain("tool-button--armed");
    expect(screen.queryByTestId("comment-flyout")).toBeNull();
    fireEvent.click(btn);
    expect(r.onSelectTool).toHaveBeenCalledWith("comment");
    r.update({ activeTool: "comment" });
    expect(btn.className).toContain("tool-button--armed");
    expect(screen.getByTestId("comment-flyout")).toBeTruthy();
    expect(btn.getAttribute("aria-expanded")).toBe("true");
  });

  it("the comment sub-toolbox shows ONLY the color swatch row (no width/size)", () => {
    armComment({ activeColor: "annotation-green" });
    const flyout = screen.getByTestId("comment-flyout");
    expect(flyout.querySelectorAll(".color-swatch")).toHaveLength(5);
    expect(screen.getByTestId("color-swatch-annotation-green").className).toContain("color-swatch--armed");
    expect(flyout.querySelector(".stroke-width-row")).toBeNull();
    expect(flyout.querySelector(".size-row")).toBeNull();
  });

  it("picking a comment color calls onPickColor and closes the flyout", () => {
    const { onPickColor } = armComment({ activeColor: "annotation-default" });
    fireEvent.click(screen.getByTestId("color-swatch-annotation-pink"));
    expect(onPickColor).toHaveBeenCalledWith("annotation-pink");
    expect(screen.queryByTestId("comment-flyout")).toBeNull();
  });

  it("re-clicking the active Comment button toggles its sub-toolbox, never disarms; Esc / switch-away close it", () => {
    const r = armComment();
    const btn = screen.getByTestId("tool-comment-button");
    expect(screen.getByTestId("comment-flyout")).toBeTruthy();
    fireEvent.click(btn);
    expect(screen.queryByTestId("comment-flyout")).toBeNull();
    expect(r.onSelectTool).not.toHaveBeenCalled();
    fireEvent.click(btn);
    expect(screen.getByTestId("comment-flyout")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("comment-flyout")).toBeNull();
    r.update({ activeTool: "cursor" });
    r.update({ activeTool: "comment" });
    expect(screen.getByTestId("comment-flyout")).toBeTruthy();
    r.update({ activeTool: "highlight" });
    expect(screen.queryByTestId("comment-flyout")).toBeNull();
  });

  it("calls onToggleCollapse from the collapse affordance", () => {
    const { onToggleCollapse } = renderRail({ activeTool: "cursor" });
    fireEvent.click(screen.getByTestId("tool-rail-collapse"));
    expect(onToggleCollapse).toHaveBeenCalledTimes(1);
  });

  it("when collapsed, renders the minimal rail with an expand affordance", () => {
    const { onToggleCollapse } = renderRail({ activeTool: "cursor", collapsed: true });
    expect(screen.getByTestId("tool-rail")).toBeTruthy();
    // No cursor button / flyout while collapsed.
    expect(screen.queryByTestId("tool-cursor-button")).toBeNull();
    const expand = screen.getByTestId("tool-rail-collapse");
    expect(expand.getAttribute("aria-label")).toBe("Expand tools");
    fireEvent.click(expand);
    expect(onToggleCollapse).toHaveBeenCalledTimes(1);
  });
});
