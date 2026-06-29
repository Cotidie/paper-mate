import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import AlphaRow from "./AlphaRow";

afterEach(cleanup);

describe("AlphaRow (Story 2.13)", () => {
  it("renders the four alpha steps", () => {
    render(<AlphaRow value={0.4} onPick={vi.fn()} />);
    expect(screen.getAllByRole("menuitemradio")).toHaveLength(4);
    expect(screen.getByTestId("alpha-0.2")).toBeTruthy();
    expect(screen.getByTestId("alpha-0.4")).toBeTruthy();
    expect(screen.getByTestId("alpha-0.6")).toBeTruthy();
    expect(screen.getByTestId("alpha-1")).toBeTruthy();
  });

  it("arms the step matching value", () => {
    render(<AlphaRow value={0.6} onPick={vi.fn()} />);
    expect(screen.getByTestId("alpha-0.6").className).toContain("alpha-step--armed");
    expect(screen.getByTestId("alpha-0.4").className).not.toContain("alpha-step--armed");
    expect(screen.getByTestId("alpha-0.6").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByTestId("alpha-0.4").getAttribute("aria-checked")).toBe("false");
  });

  it("calls onPick with the chosen alpha", () => {
    const onPick = vi.fn();
    render(<AlphaRow value={0.4} onPick={onPick} />);
    fireEvent.click(screen.getByTestId("alpha-0.2"));
    expect(onPick).toHaveBeenCalledWith(0.2);
  });
});
