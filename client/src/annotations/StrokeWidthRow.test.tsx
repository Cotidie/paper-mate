import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import StrokeWidthRow from "./StrokeWidthRow";

afterEach(cleanup);

describe("StrokeWidthRow (Story 2.8) — collapsible pen thickness picker", () => {
  it("renders a collapsed trigger; the width steps are hidden until opened", () => {
    render(<StrokeWidthRow value={8} onPick={vi.fn()} />);
    expect(screen.getByTestId("stroke-width-trigger")).toBeTruthy();
    expect(screen.queryByTestId("stroke-width-8")).toBeNull();
    expect(screen.getByTestId("stroke-width-trigger").getAttribute("aria-expanded")).toBe("false");
  });

  it("opening the trigger reveals the three width steps (4/8/16)", () => {
    render(<StrokeWidthRow value={8} onPick={vi.fn()} />);
    fireEvent.click(screen.getByTestId("stroke-width-trigger"));
    expect(screen.getAllByRole("menuitemradio")).toHaveLength(3);
    expect(screen.getByTestId("stroke-width-4")).toBeTruthy();
    expect(screen.getByTestId("stroke-width-8")).toBeTruthy();
    expect(screen.getByTestId("stroke-width-16")).toBeTruthy();
  });

  it("arms the step matching value", () => {
    render(<StrokeWidthRow value={16} onPick={vi.fn()} />);
    fireEvent.click(screen.getByTestId("stroke-width-trigger"));
    expect(screen.getByTestId("stroke-width-16").className).toContain("stroke-width-step--armed");
    expect(screen.getByTestId("stroke-width-4").className).not.toContain("stroke-width-step--armed");
    expect(screen.getByTestId("stroke-width-16").getAttribute("aria-checked")).toBe("true");
  });

  it("picking a step calls onPick with the chosen width and collapses", () => {
    const onPick = vi.fn();
    render(<StrokeWidthRow value={8} onPick={onPick} />);
    fireEvent.click(screen.getByTestId("stroke-width-trigger"));
    fireEvent.click(screen.getByTestId("stroke-width-4"));
    expect(onPick).toHaveBeenCalledWith(4);
    // Collapsed again after the pick.
    expect(screen.queryByTestId("stroke-width-4")).toBeNull();
  });
});
