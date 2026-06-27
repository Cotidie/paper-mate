import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import App from "./App";

afterEach(cleanup);

describe("S1 reader frame", () => {
  it("renders the top-bar with the app title", () => {
    render(<App />);
    expect(screen.getByRole("banner")).toBeTruthy();
    expect(screen.getByText("Paper Mate")).toBeTruthy();
  });

  it("renders the reader-backdrop canvas region", () => {
    render(<App />);
    expect(screen.getByTestId("reader-backdrop")).toBeTruthy();
  });

  it("renders the collapsed tool-rail placeholder", () => {
    render(<App />);
    expect(screen.getByTestId("tool-rail")).toBeTruthy();
  });

  it("exposes keyboard-focusable chrome (focus-ring target, AC-5)", () => {
    render(<App />);
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(0);
    buttons[0].focus();
    expect(document.activeElement).toBe(buttons[0]);
  });
});
