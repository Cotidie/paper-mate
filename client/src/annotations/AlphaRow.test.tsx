import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import AlphaRow from "./AlphaRow";

afterEach(cleanup);

describe("AlphaRow (Story 2.13) — collapsible pen opacity picker", () => {
  it("renders a collapsed trigger; the alpha steps are hidden until opened", () => {
    render(<AlphaRow value={0.4} onPick={vi.fn()} />);
    expect(screen.getByTestId("alpha-trigger")).toBeTruthy();
    expect(screen.queryByTestId("alpha-0.4")).toBeNull();
    expect(screen.getByTestId("alpha-trigger").getAttribute("aria-expanded")).toBe("false");
  });

  it("opening the trigger reveals the four alpha steps", () => {
    render(<AlphaRow value={0.4} onPick={vi.fn()} />);
    fireEvent.click(screen.getByTestId("alpha-trigger"));
    expect(screen.getAllByRole("menuitemradio")).toHaveLength(4);
    expect(screen.getByTestId("alpha-0.2")).toBeTruthy();
    expect(screen.getByTestId("alpha-0.4")).toBeTruthy();
    expect(screen.getByTestId("alpha-0.6")).toBeTruthy();
    expect(screen.getByTestId("alpha-1")).toBeTruthy();
  });

  it("arms the step matching value", () => {
    render(<AlphaRow value={0.6} onPick={vi.fn()} />);
    fireEvent.click(screen.getByTestId("alpha-trigger"));
    expect(screen.getByTestId("alpha-0.6").className).toContain("alpha-step--armed");
    expect(screen.getByTestId("alpha-0.4").className).not.toContain("alpha-step--armed");
    expect(screen.getByTestId("alpha-0.6").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByTestId("alpha-0.4").getAttribute("aria-checked")).toBe("false");
  });

  it("picking a step calls onPick with the chosen alpha and collapses", () => {
    const onPick = vi.fn();
    render(<AlphaRow value={0.4} onPick={onPick} />);
    fireEvent.click(screen.getByTestId("alpha-trigger"));
    fireEvent.click(screen.getByTestId("alpha-0.2"));
    expect(onPick).toHaveBeenCalledWith(0.2);
    // Collapsed again after the pick.
    expect(screen.queryByTestId("alpha-0.2")).toBeNull();
  });
});
