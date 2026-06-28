import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import ToolRail from "./ToolRail";

afterEach(cleanup);

describe("ToolRail", () => {
  it("renders the rail shell (data-testid kept stable for App.test)", () => {
    render(<ToolRail mode="cursor" onMode={vi.fn()} collapsed={false} onToggleCollapse={vi.fn()} />);
    expect(screen.getByTestId("tool-rail")).toBeTruthy();
    // Flyout is closed until the cursor button is clicked.
    expect(screen.queryByTestId("tool-flyout")).toBeNull();
  });

  it("opens the flyout with cursor / hand / box-select on the cursor button", () => {
    render(<ToolRail mode="cursor" onMode={vi.fn()} collapsed={false} onToggleCollapse={vi.fn()} />);
    const btn = screen.getByTestId("tool-cursor-button");
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("tool-flyout")).toBeTruthy();
    expect(screen.getByTestId("tool-option-cursor")).toBeTruthy();
    expect(screen.getByTestId("tool-option-hand")).toBeTruthy();
    expect(screen.getByTestId("tool-option-box-select")).toBeTruthy();
  });

  it("calls onMode('hand') and closes the flyout when hand is picked", () => {
    const onMode = vi.fn();
    render(<ToolRail mode="cursor" onMode={onMode} collapsed={false} onToggleCollapse={vi.fn()} />);
    fireEvent.click(screen.getByTestId("tool-cursor-button"));
    fireEvent.click(screen.getByTestId("tool-option-hand"));
    expect(onMode).toHaveBeenCalledWith("hand");
    expect(screen.queryByTestId("tool-flyout")).toBeNull();
  });

  it("reflects the armed mode (aria-pressed on the option, armed class on the button)", () => {
    render(<ToolRail mode="hand" onMode={vi.fn()} collapsed={false} onToggleCollapse={vi.fn()} />);
    // The rail button shows the armed state for a non-default tool.
    expect(screen.getByTestId("tool-cursor-button").className).toContain("tool-button--armed");
    fireEvent.click(screen.getByTestId("tool-cursor-button"));
    expect(screen.getByTestId("tool-option-hand").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("tool-option-cursor").getAttribute("aria-pressed")).toBe("false");
  });

  it("cursor mode does not show the rail button as armed", () => {
    render(<ToolRail mode="cursor" onMode={vi.fn()} collapsed={false} onToggleCollapse={vi.fn()} />);
    expect(screen.getByTestId("tool-cursor-button").className).not.toContain("tool-button--armed");
  });

  it("gives every tool a hover tooltip (native title) describing it + its shortcut", () => {
    render(<ToolRail mode="cursor" onMode={vi.fn()} collapsed={false} onToggleCollapse={vi.fn()} />);
    // Rail button + collapse have tooltips.
    expect(screen.getByTestId("tool-cursor-button").getAttribute("title")).toBeTruthy();
    expect(screen.getByTestId("tool-rail-collapse").getAttribute("title")).toBeTruthy();
    // Each flyout option has a descriptive tooltip.
    fireEvent.click(screen.getByTestId("tool-cursor-button"));
    for (const v of ["cursor", "hand", "box-select"]) {
      expect(screen.getByTestId(`tool-option-${v}`).getAttribute("title")).toBeTruthy();
    }
    // The hand tooltip mentions panning + the Space shortcut.
    expect(screen.getByTestId("tool-option-hand").getAttribute("title")).toMatch(/pan/i);
  });

  it("calls onToggleCollapse from the collapse affordance", () => {
    const onToggleCollapse = vi.fn();
    render(
      <ToolRail mode="cursor" onMode={vi.fn()} collapsed={false} onToggleCollapse={onToggleCollapse} />,
    );
    fireEvent.click(screen.getByTestId("tool-rail-collapse"));
    expect(onToggleCollapse).toHaveBeenCalledTimes(1);
  });

  it("when collapsed, renders the minimal rail with an expand affordance", () => {
    const onToggleCollapse = vi.fn();
    render(
      <ToolRail mode="cursor" onMode={vi.fn()} collapsed={true} onToggleCollapse={onToggleCollapse} />,
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
