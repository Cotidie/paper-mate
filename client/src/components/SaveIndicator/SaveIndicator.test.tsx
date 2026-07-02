import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import SaveIndicator from "./SaveIndicator";

afterEach(cleanup);

describe("SaveIndicator (Story 3.4, AC-4)", () => {
  it("renders nothing visible when idle", () => {
    render(<SaveIndicator status="idle" />);
    expect(screen.getByTestId("save-indicator").textContent).toBe("");
  });

  it("shows 'Saving…' (ellipsis character, no three dots) while saving", () => {
    render(<SaveIndicator status="saving" />);
    const el = screen.getByTestId("save-indicator");
    expect(el.textContent).toBe("Saving…");
    expect(el.textContent).not.toContain("...");
  });

  it("shows 'Saved' once a save completes", () => {
    render(<SaveIndicator status="saved" />);
    expect(screen.getByTestId("save-indicator").textContent).toBe("Saved");
  });

  it("renders nothing visible on error (the toast carries the failure copy)", () => {
    render(<SaveIndicator status="error" />);
    expect(screen.getByTestId("save-indicator").textContent).toBe("");
  });

  it("never contains an em-dash, in any status", () => {
    for (const status of ["idle", "saving", "saved", "error"] as const) {
      cleanup();
      render(<SaveIndicator status={status} />);
      expect(screen.getByTestId("save-indicator").textContent).not.toContain("—");
    }
  });

  it("is a polite status live region for assistive tech", () => {
    render(<SaveIndicator status="saving" />);
    const el = screen.getByTestId("save-indicator");
    expect(el.getAttribute("role")).toBe("status");
    expect(el.getAttribute("aria-live")).toBe("polite");
  });
});
