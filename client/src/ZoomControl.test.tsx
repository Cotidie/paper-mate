import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import ZoomControl from "./ZoomControl";

afterEach(cleanup);

describe("ZoomControl", () => {
  it("renders the live percent", () => {
    render(<ZoomControl percent={184} onZoomIn={vi.fn()} onZoomOut={vi.fn()} onReset={vi.fn()} />);
    expect(screen.getByTestId("zoom-percent").textContent).toBe("184%");
  });

  it("exposes the percent to assistive tech (no overriding aria-label; polite live region)", () => {
    render(<ZoomControl percent={184} onZoomIn={vi.fn()} onZoomOut={vi.fn()} onReset={vi.fn()} />);
    const pct = screen.getByTestId("zoom-percent");
    // The visible percent IS the accessible name (was hidden behind a static label).
    expect(screen.getByRole("button", { name: "184%" })).toBe(pct);
    expect(pct.getAttribute("aria-live")).toBe("polite");
  });

  it("fires onZoomIn / onZoomOut from the + / − buttons", () => {
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    render(<ZoomControl percent={100} onZoomIn={onZoomIn} onZoomOut={onZoomOut} onReset={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("Zoom in"));
    fireEvent.click(screen.getByLabelText("Zoom out"));
    expect(onZoomIn).toHaveBeenCalledTimes(1);
    expect(onZoomOut).toHaveBeenCalledTimes(1);
  });

  it("fires onReset when the percent is clicked", () => {
    const onReset = vi.fn();
    render(<ZoomControl percent={100} onZoomIn={vi.fn()} onZoomOut={vi.fn()} onReset={onReset} />);
    fireEvent.click(screen.getByTestId("zoom-percent"));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("uses real, keyboard-reachable buttons", () => {
    render(<ZoomControl percent={100} onZoomIn={vi.fn()} onZoomOut={vi.fn()} onReset={vi.fn()} />);
    expect(screen.getByLabelText("Zoom in").tagName).toBe("BUTTON");
    expect(screen.getByLabelText("Zoom out").tagName).toBe("BUTTON");
    expect(screen.getByTestId("zoom-percent").tagName).toBe("BUTTON");
  });
});
