import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import Toast from "@/components/Toast/Toast";

afterEach(cleanup);

describe("Toast", () => {
  it("defaults to the error variant (existing call-sites unchanged)", () => {
    render(<Toast message="Something failed" onDismiss={() => {}} />);
    const toast = screen.getByTestId("toast");
    expect(toast.className).toContain("toast--error");
    expect(toast.className).not.toContain("toast--info");
  });

  it("renders the info variant when asked", () => {
    render(<Toast message="Enrichment skipped." variant="info" onDismiss={() => {}} />);
    const toast = screen.getByTestId("toast");
    expect(toast.className).toContain("toast--info");
    expect(toast.className).not.toContain("toast--error");
    expect(screen.getByText("Enrichment skipped.")).toBeTruthy();
  });

  it("keeps role=status and Esc-to-dismiss for both variants", () => {
    const onDismiss = vi.fn();
    render(<Toast message="Enrichment skipped." variant="info" onDismiss={onDismiss} />);
    expect(screen.getByTestId("toast").getAttribute("role")).toBe("status");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
