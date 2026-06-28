import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import ToolRail from "./ToolRail";

afterEach(cleanup);

describe("ToolRail", () => {
  it("renders the rail shell (data-testid kept stable for App.test)", () => {
    render(<ToolRail activeTool="cursor" onSelectTool={vi.fn()} collapsed={false} onToggleCollapse={vi.fn()} />);
    expect(screen.getByTestId("tool-rail")).toBeTruthy();
    // Flyout is closed until the cursor button is clicked.
    expect(screen.queryByTestId("tool-flyout")).toBeNull();
  });

  it("opens the flyout with cursor / hand / box on the cursor button when a pointer tool is active", () => {
    render(<ToolRail activeTool="cursor" onSelectTool={vi.fn()} collapsed={false} onToggleCollapse={vi.fn()} />);
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
    const onSelectTool = vi.fn();
    render(<ToolRail activeTool="cursor" onSelectTool={onSelectTool} collapsed={false} onToggleCollapse={vi.fn()} />);
    fireEvent.click(screen.getByTestId("tool-cursor-button"));
    fireEvent.click(screen.getByTestId("tool-option-hand"));
    expect(onSelectTool).toHaveBeenCalledWith("hand");
    expect(screen.queryByTestId("tool-flyout")).toBeNull();
  });

  it("reflects the active pointer tool (aria-pressed on the option, armed class on the button)", () => {
    render(<ToolRail activeTool="hand" onSelectTool={vi.fn()} collapsed={false} onToggleCollapse={vi.fn()} />);
    // The rail button shows the armed state for a non-default pointer tool.
    expect(screen.getByTestId("tool-cursor-button").className).toContain("tool-button--armed");
    fireEvent.click(screen.getByTestId("tool-cursor-button"));
    expect(screen.getByTestId("tool-option-hand").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("tool-option-cursor").getAttribute("aria-pressed")).toBe("false");
  });

  it("shows the pointer button active in plain cursor mode (#3)", () => {
    render(
      <ToolRail activeTool="cursor" onSelectTool={vi.fn()} collapsed={false} onToggleCollapse={vi.fn()} />,
    );
    // The selection tool IS the active tool in cursor mode — it must read active.
    expect(screen.getByTestId("tool-cursor-button").className).toContain("tool-button--armed");
  });

  it("pointer button is NOT active when an annotation tool is active (mutual exclusion)", () => {
    render(
      <ToolRail activeTool="highlight" onSelectTool={vi.fn()} collapsed={false} onToggleCollapse={vi.fn()} />,
    );
    expect(screen.getByTestId("tool-cursor-button").className).not.toContain("tool-button--armed");
    expect(screen.getByTestId("tool-highlight-button").className).toContain("tool-button--armed");
  });

  it("single-click switch (AC4): with Highlight active, one click on the pointer button commits to cursor and opens no flyout", () => {
    const onSelectTool = vi.fn();
    render(
      <ToolRail activeTool="highlight" onSelectTool={onSelectTool} collapsed={false} onToggleCollapse={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId("tool-cursor-button"));
    // One click commits the switch...
    expect(onSelectTool).toHaveBeenCalledWith("cursor");
    // ...and never opens a sub-toolbox in its place.
    expect(screen.queryByTestId("tool-flyout")).toBeNull();
  });

  it("closes an open pointer flyout when the active tool switches to an annotation tool (AC4, review MED)", () => {
    // Open the flyout in cursor mode, then re-render as if `H`/Highlight switched
    // activeTool to highlight: the stale pointer sub-toolbox must not remain.
    const { rerender } = render(
      <ToolRail activeTool="cursor" onSelectTool={vi.fn()} collapsed={false} onToggleCollapse={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId("tool-cursor-button"));
    expect(screen.getByTestId("tool-flyout")).toBeTruthy();
    rerender(
      <ToolRail activeTool="highlight" onSelectTool={vi.fn()} collapsed={false} onToggleCollapse={vi.fn()} />,
    );
    expect(screen.queryByTestId("tool-flyout")).toBeNull();
  });

  it("gives every tool a hover tooltip (native title) describing it + its shortcut", () => {
    render(<ToolRail activeTool="cursor" onSelectTool={vi.fn()} collapsed={false} onToggleCollapse={vi.fn()} />);
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
    const onSelectTool = vi.fn();
    render(
      <ToolRail activeTool="cursor" onSelectTool={onSelectTool} collapsed={false} onToggleCollapse={vi.fn()} />,
    );
    const btn = screen.getByTestId("tool-highlight-button");
    expect(btn.className).not.toContain("tool-button--armed");
    expect(btn.getAttribute("title")).toBe("Highlight (H)");
    fireEvent.click(btn);
    expect(onSelectTool).toHaveBeenCalledWith("highlight");
  });

  it("toggles Highlight off back to cursor on a second click (Story 2.3 toggle-off feel)", () => {
    const onSelectTool = vi.fn();
    render(
      <ToolRail activeTool="highlight" onSelectTool={onSelectTool} collapsed={false} onToggleCollapse={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId("tool-highlight-button"));
    expect(onSelectTool).toHaveBeenCalledWith("cursor");
  });

  it("shows the Highlight button armed when activeTool is highlight (Story 2.3)", () => {
    render(
      <ToolRail activeTool="highlight" onSelectTool={vi.fn()} collapsed={false} onToggleCollapse={vi.fn()} />,
    );
    const btn = screen.getByTestId("tool-highlight-button");
    expect(btn.className).toContain("tool-button--armed");
    expect(btn.getAttribute("aria-pressed")).toBe("true");
  });

  it("calls onToggleCollapse from the collapse affordance", () => {
    const onToggleCollapse = vi.fn();
    render(
      <ToolRail activeTool="cursor" onSelectTool={vi.fn()} collapsed={false} onToggleCollapse={onToggleCollapse} />,
    );
    fireEvent.click(screen.getByTestId("tool-rail-collapse"));
    expect(onToggleCollapse).toHaveBeenCalledTimes(1);
  });

  it("when collapsed, renders the minimal rail with an expand affordance", () => {
    const onToggleCollapse = vi.fn();
    render(
      <ToolRail activeTool="cursor" onSelectTool={vi.fn()} collapsed={true} onToggleCollapse={onToggleCollapse} />,
    );
    expect(screen.getByTestId("tool-rail")).toBeTruthy();
    // No cursor button / flyout while collapsed.
    expect(screen.queryByTestId("tool-cursor-button")).toBeNull();
    const expand = screen.getByTestId("tool-rail-collapse");
    expect(expand.getAttribute("aria-label")).toBe("Expand tools");
    fireEvent.click(expand);
    expect(onToggleCollapse).toHaveBeenCalledTimes(1);
  });
});
