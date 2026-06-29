import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import ToolRail from "./ToolRail";
import type { ActiveTool } from "./tools";

afterEach(cleanup);

// Render helper: supplies all required props (incl. the Story 2.6 color props)
// with overridable defaults, and hands back the spies for assertions.
function renderRail(
  over: Partial<{
    activeTool: ActiveTool;
    activeColor: string;
    collapsed: boolean;
  }> = {},
) {
  const onSelectTool = vi.fn();
  const onPickColor = vi.fn();
  const onToggleCollapse = vi.fn();
  const utils = render(
    <ToolRail
      activeTool={over.activeTool ?? "cursor"}
      onSelectTool={onSelectTool}
      activeColor={over.activeColor ?? "annotation-default"}
      onPickColor={onPickColor}
      collapsed={over.collapsed ?? false}
      onToggleCollapse={onToggleCollapse}
    />,
  );
  return { ...utils, onSelectTool, onPickColor, onToggleCollapse };
}

describe("ToolRail", () => {
  it("renders the rail shell (data-testid kept stable for App.test)", () => {
    renderRail();
    expect(screen.getByTestId("tool-rail")).toBeTruthy();
    // Flyout is closed until the cursor button is clicked.
    expect(screen.queryByTestId("tool-flyout")).toBeNull();
  });

  it("opens the flyout with cursor / hand / box on the cursor button when a pointer tool is active", () => {
    renderRail({ activeTool: "cursor" });
    const btn = screen.getByTestId("tool-cursor-button");
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("tool-flyout")).toBeTruthy();
    expect(screen.getByTestId("tool-option-cursor")).toBeTruthy();
    expect(screen.getByTestId("tool-option-hand")).toBeTruthy();
    expect(screen.getByTestId("tool-option-box")).toBeTruthy();
  });

  it("calls onSelectTool('hand') and closes the flyout when hand is picked", () => {
    const { onSelectTool } = renderRail({ activeTool: "cursor" });
    fireEvent.click(screen.getByTestId("tool-cursor-button"));
    fireEvent.click(screen.getByTestId("tool-option-hand"));
    expect(onSelectTool).toHaveBeenCalledWith("hand");
    expect(screen.queryByTestId("tool-flyout")).toBeNull();
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

  it("single-click switch (AC4): with Highlight active, one click on the pointer button commits to cursor and opens no flyout", () => {
    const { onSelectTool } = renderRail({ activeTool: "highlight" });
    fireEvent.click(screen.getByTestId("tool-cursor-button"));
    // One click commits the switch...
    expect(onSelectTool).toHaveBeenCalledWith("cursor");
    // ...and never opens a sub-toolbox in its place.
    expect(screen.queryByTestId("tool-flyout")).toBeNull();
  });

  it("closes an open pointer flyout when the active tool switches to an annotation tool (AC4, review MED)", () => {
    // Open the flyout in cursor mode, then re-render as if `H`/Highlight switched
    // activeTool to highlight: the stale pointer sub-toolbox must not remain.
    const { rerender } = renderRail({ activeTool: "cursor" });
    fireEvent.click(screen.getByTestId("tool-cursor-button"));
    expect(screen.getByTestId("tool-flyout")).toBeTruthy();
    rerender(
      <ToolRail
        activeTool="highlight"
        onSelectTool={vi.fn()}
        activeColor="annotation-default"
        onPickColor={vi.fn()}
        collapsed={false}
        onToggleCollapse={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("tool-flyout")).toBeNull();
  });

  it("gives every tool a hover tooltip (native title) describing it + its shortcut", () => {
    renderRail({ activeTool: "cursor" });
    // Rail button + collapse have tooltips.
    expect(screen.getByTestId("tool-cursor-button").getAttribute("title")).toBeTruthy();
    expect(screen.getByTestId("tool-rail-collapse").getAttribute("title")).toBeTruthy();
    // Each flyout option has a descriptive tooltip.
    fireEvent.click(screen.getByTestId("tool-cursor-button"));
    for (const v of ["cursor", "hand", "box"]) {
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

  // ── Story 2.6: arm = one-click switch; active transition opens the picker ───
  it("arming highlight from another tool requests the switch in one click", () => {
    const { onSelectTool } = renderRail({ activeTool: "cursor" });
    fireEvent.click(screen.getByTestId("tool-highlight-button"));
    expect(onSelectTool).toHaveBeenCalledWith("highlight");
    // The parent owns activeTool; this click only requests the switch. The flyout
    // opens after the parent rerenders with activeTool="highlight".
    expect(screen.queryByTestId("highlight-color-flyout")).toBeNull();
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
        collapsed={false}
        onToggleCollapse={vi.fn()}
      />,
    );
    expect(screen.getByTestId("highlight-color-flyout")).toBeTruthy();
    expect(screen.getByTestId("tool-highlight-button").getAttribute("aria-expanded")).toBe("true");
  });

  it("re-clicking the ALREADY-active Highlight tool toggles its color sub-toolbox, never disarms (Story 2.6)", () => {
    const { onSelectTool } = renderRail({ activeTool: "highlight" });
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
    renderRail({ activeTool: "highlight", activeColor: "annotation-green" });
    const flyout = screen.getByTestId("highlight-color-flyout");
    expect(flyout).toBeTruthy();
    // Exactly 5 swatches (trimmed palette); the active color is armed.
    expect(flyout.querySelectorAll(".color-swatch")).toHaveLength(5);
    expect(screen.getByTestId("color-swatch-annotation-green").className).toContain(
      "color-swatch--armed",
    );
  });

  it("picking a swatch sets the active color (onPickColor) and closes the flyout (Story 2.6 AC4)", () => {
    const { onPickColor } = renderRail({ activeTool: "highlight", activeColor: "annotation-default" });
    fireEvent.click(screen.getByTestId("color-swatch-annotation-blue"));
    expect(onPickColor).toHaveBeenCalledWith("annotation-blue");
    expect(screen.queryByTestId("highlight-color-flyout")).toBeNull();
  });

  it("Escape closes the open color sub-toolbox (Story 2.6)", () => {
    renderRail({ activeTool: "highlight" });
    expect(screen.getByTestId("highlight-color-flyout")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("highlight-color-flyout")).toBeNull();
  });

  it("an outside pointer-down closes the open color sub-toolbox (Story 2.6)", () => {
    renderRail({ activeTool: "highlight" });
    expect(screen.getByTestId("highlight-color-flyout")).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByTestId("highlight-color-flyout")).toBeNull();
  });

  it("the color sub-toolbox closes when the active tool switches away from highlight (AC3 inverse path)", () => {
    const { rerender } = renderRail({ activeTool: "highlight" });
    expect(screen.getByTestId("highlight-color-flyout")).toBeTruthy();
    rerender(
      <ToolRail
        activeTool="cursor"
        onSelectTool={vi.fn()}
        activeColor="annotation-default"
        onPickColor={vi.fn()}
        collapsed={false}
        onToggleCollapse={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("highlight-color-flyout")).toBeNull();
  });

  it("clears an open color sub-toolbox when the rail collapses (Codex review MED)", () => {
    const { rerender } = renderRail({ activeTool: "highlight" });
    expect(screen.getByTestId("highlight-color-flyout")).toBeTruthy();
    // Collapse, then expand: the flyout must NOT resurrect without a new gesture.
    rerender(
      <ToolRail
        activeTool="highlight"
        onSelectTool={vi.fn()}
        activeColor="annotation-default"
        onPickColor={vi.fn()}
        collapsed={true}
        onToggleCollapse={vi.fn()}
      />,
    );
    rerender(
      <ToolRail
        activeTool="highlight"
        onSelectTool={vi.fn()}
        activeColor="annotation-default"
        onPickColor={vi.fn()}
        collapsed={false}
        onToggleCollapse={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("highlight-color-flyout")).toBeNull();
  });

  it("shows the Highlight button armed when activeTool is highlight (Story 2.3)", () => {
    renderRail({ activeTool: "highlight" });
    const btn = screen.getByTestId("tool-highlight-button");
    expect(btn.className).toContain("tool-button--armed");
    expect(btn.getAttribute("aria-pressed")).toBe("true");
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
