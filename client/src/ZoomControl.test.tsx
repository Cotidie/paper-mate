import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import ZoomControl from "./ZoomControl";

afterEach(cleanup);

describe("ZoomControl", () => {
  it("renders the live percent", () => {
    render(<ZoomControl percent={184} onZoomIn={vi.fn()} onZoomOut={vi.fn()} onReset={vi.fn()} />);
    expect(screen.getByText("184%")).toBeTruthy();
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
    fireEvent.click(screen.getByLabelText("Fit to width"));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("uses real, keyboard-reachable buttons", () => {
    render(<ZoomControl percent={100} onZoomIn={vi.fn()} onZoomOut={vi.fn()} onReset={vi.fn()} />);
    expect(screen.getByLabelText("Zoom in").tagName).toBe("BUTTON");
    expect(screen.getByLabelText("Zoom out").tagName).toBe("BUTTON");
    expect(screen.getByLabelText("Fit to width").tagName).toBe("BUTTON");
  });
});
