import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import StrokeWidthRow from "./StrokeWidthRow";

afterEach(cleanup);

describe("StrokeWidthRow (Story 2.8)", () => {
  it("renders the three width steps", () => {
    render(<StrokeWidthRow value={4} onPick={vi.fn()} />);
    expect(screen.getAllByRole("menuitemradio")).toHaveLength(3);
    expect(screen.getByTestId("stroke-width-2")).toBeTruthy();
    expect(screen.getByTestId("stroke-width-4")).toBeTruthy();
    expect(screen.getByTestId("stroke-width-8")).toBeTruthy();
  });

  it("arms the step matching value", () => {
    render(<StrokeWidthRow value={8} onPick={vi.fn()} />);
    expect(screen.getByTestId("stroke-width-8").className).toContain("stroke-width-step--armed");
    expect(screen.getByTestId("stroke-width-2").className).not.toContain("stroke-width-step--armed");
    expect(screen.getByTestId("stroke-width-8").getAttribute("aria-checked")).toBe("true");
  });

  it("calls onPick with the chosen width", () => {
    const onPick = vi.fn();
    render(<StrokeWidthRow value={4} onPick={onPick} />);
    fireEvent.click(screen.getByTestId("stroke-width-2"));
    expect(onPick).toHaveBeenCalledWith(2);
  });
});
