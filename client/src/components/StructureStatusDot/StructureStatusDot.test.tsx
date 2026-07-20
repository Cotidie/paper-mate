import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import StructureStatusDot from "./StructureStatusDot";

afterEach(cleanup);

describe("StructureStatusDot", () => {
  it("reflects each state via data-status (grey absent / amber analyzing / green ready)", () => {
    for (const status of ["absent", "analyzing", "ready"] as const) {
      const { unmount } = render(<StructureStatusDot status={status} />);
      expect(screen.getByTestId("structure-status-dot").getAttribute("data-status")).toBe(status);
      unmount();
    }
  });

  it("carries an accessible, em-dash-free label per state (no extractor name)", () => {
    const labels: Record<string, string> = {
      absent: "Not analyzed",
      analyzing: "Analyzing document structure",
      ready: "Structure analyzed",
    };
    for (const [status, expected] of Object.entries(labels)) {
      const { unmount } = render(<StructureStatusDot status={status as never} />);
      const el = screen.getByTestId("structure-status-dot");
      expect(el.getAttribute("aria-label")).toBe(expected);
      expect(el.getAttribute("title")).toBe(expected);
      expect(expected).not.toContain("—");
      expect(expected.toLowerCase()).not.toContain("opendataloader");
      unmount();
    }
  });

  it("is not a live region (many rows each carry one)", () => {
    render(<StructureStatusDot status="ready" />);
    expect(screen.getByTestId("structure-status-dot").getAttribute("aria-live")).toBeNull();
  });

  it("forwards a placement className", () => {
    render(<StructureStatusDot status="ready" className="top-bar__structure-dot" />);
    expect(
      screen.getByTestId("structure-status-dot").classList.contains("top-bar__structure-dot"),
    ).toBe(true);
  });
});
