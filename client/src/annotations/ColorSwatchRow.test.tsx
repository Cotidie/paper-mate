import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import ColorSwatchRow from "./ColorSwatchRow";

afterEach(cleanup);

const TOKENS = [
  "annotation-default",
  "annotation-green",
  "annotation-pink",
  "annotation-blue",
  "annotation-purple",
  "annotation-orange",
];

describe("ColorSwatchRow (Story 2.3)", () => {
  it("renders the 6 accent swatches", () => {
    render(<ColorSwatchRow value="annotation-default" onPick={vi.fn()} />);
    for (const t of TOKENS) {
      expect(screen.getByTestId(`color-swatch-${t}`)).toBeTruthy();
    }
  });

  it("marks the current color's swatch armed (2px ink ring), others not", () => {
    render(<ColorSwatchRow value="annotation-green" onPick={vi.fn()} />);
    expect(screen.getByTestId("color-swatch-annotation-green").className).toContain(
      "color-swatch--armed",
    );
    expect(screen.getByTestId("color-swatch-annotation-green").getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(screen.getByTestId("color-swatch-annotation-pink").className).not.toContain(
      "color-swatch--armed",
    );
  });

  it("calls onPick with the chosen token", () => {
    const onPick = vi.fn();
    render(<ColorSwatchRow value="annotation-default" onPick={onPick} />);
    fireEvent.click(screen.getByTestId("color-swatch-annotation-blue"));
    expect(onPick).toHaveBeenCalledWith("annotation-blue");
  });

  it("gives each swatch an accessible color name (no em-dash)", () => {
    render(<ColorSwatchRow value="annotation-default" onPick={vi.fn()} />);
    expect(screen.getByTestId("color-swatch-annotation-default").getAttribute("aria-label")).toBe(
      "Yellow",
    );
    for (const t of TOKENS) {
      const label = screen.getByTestId(`color-swatch-${t}`).getAttribute("aria-label") ?? "";
      expect(label).not.toContain("—");
    }
  });
});
