import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import SizeRow from "./SizeRow";
import { MEMO_SIZES, DEFAULT_MEMO_SIZE } from "@/store";

afterEach(cleanup);

const small = MEMO_SIZES.find((s) => s.key === "small")!;

describe("SizeRow (Story 2.9) — collapsible memo size picker", () => {
  it("renders a collapsed trigger; the step list is hidden until opened", () => {
    render(<SizeRow value={DEFAULT_MEMO_SIZE} onPick={vi.fn()} />);
    expect(screen.getByTestId("memo-size-trigger")).toBeTruthy();
    // The steps are not in the DOM while collapsed.
    expect(screen.queryByTestId("memo-size-small")).toBeNull();
    expect(screen.getByTestId("memo-size-trigger").getAttribute("aria-expanded")).toBe("false");
  });

  it("opening the trigger reveals the three size steps", () => {
    render(<SizeRow value={DEFAULT_MEMO_SIZE} onPick={vi.fn()} />);
    fireEvent.click(screen.getByTestId("memo-size-trigger"));
    expect(screen.getAllByRole("menuitemradio")).toHaveLength(3);
    expect(screen.getByTestId("memo-size-small")).toBeTruthy();
    expect(screen.getByTestId("memo-size-medium")).toBeTruthy();
    expect(screen.getByTestId("memo-size-large")).toBeTruthy();
  });

  it("arms the step matching value", () => {
    render(<SizeRow value={small} onPick={vi.fn()} />);
    fireEvent.click(screen.getByTestId("memo-size-trigger"));
    expect(screen.getByTestId("memo-size-small").className).toContain("size-row__step--armed");
    expect(screen.getByTestId("memo-size-large").className).not.toContain("size-row__step--armed");
    expect(screen.getByTestId("memo-size-small").getAttribute("aria-checked")).toBe("true");
  });

  it("picking a step calls onPick with that size and collapses the list", () => {
    const onPick = vi.fn();
    render(<SizeRow value={DEFAULT_MEMO_SIZE} onPick={onPick} />);
    fireEvent.click(screen.getByTestId("memo-size-trigger"));
    fireEvent.click(screen.getByTestId("memo-size-small"));
    expect(onPick).toHaveBeenCalledWith(small);
    // Collapsed again after the pick.
    expect(screen.queryByTestId("memo-size-small")).toBeNull();
  });
});
