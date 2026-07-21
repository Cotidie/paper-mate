import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/api/client";
import StructureModeToggle from "./StructureModeToggle";

function state(over: Partial<api.StructureModeState> = {}): api.StructureModeState {
  return { mode: "local", transition: "idle", error: null, ...over };
}

describe("StructureModeToggle", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the active mode once loaded", async () => {
    vi.spyOn(api, "fetchStructureMode").mockResolvedValue(state({ mode: "hybrid" }));
    render(<StructureModeToggle />);
    expect(await screen.findByText("Hybrid")).toBeTruthy();
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true");
  });

  it("flips to hybrid when clicked", async () => {
    vi.spyOn(api, "fetchStructureMode").mockResolvedValue(state());
    const put = vi
      .spyOn(api, "setStructureMode")
      .mockResolvedValue(state({ transition: "starting" }));

    render(<StructureModeToggle />);
    await screen.findByText("Local");
    fireEvent.click(screen.getByRole("switch"));

    expect(put).toHaveBeenCalledWith("hybrid");
    expect(await screen.findByText("Starting hybrid...")).toBeTruthy();
  });

  it("flips back to local from hybrid", async () => {
    vi.spyOn(api, "fetchStructureMode").mockResolvedValue(state({ mode: "hybrid" }));
    const put = vi
      .spyOn(api, "setStructureMode")
      .mockResolvedValue(state({ mode: "local", transition: "stopping" }));

    render(<StructureModeToggle />);
    await screen.findByText("Hybrid");
    fireEvent.click(screen.getByRole("switch"));

    expect(put).toHaveBeenCalledWith("local");
  });

  it("disables the switch while a change is in flight", async () => {
    vi.spyOn(api, "fetchStructureMode").mockResolvedValue(state({ transition: "starting" }));
    render(<StructureModeToggle />);
    await waitFor(() =>
      expect((screen.getByRole("switch") as HTMLButtonElement).disabled).toBe(true),
    );
  });

  it("shows a failed start and leaves the switch off", async () => {
    vi.spyOn(api, "fetchStructureMode").mockResolvedValue(
      state({ mode: "local", error: "The hybrid structure server did not start." }),
    );
    render(<StructureModeToggle />);
    expect(await screen.findByText("Hybrid failed")).toBeTruthy();
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");
  });

  it("renders nothing when the mode cannot be read", async () => {
    vi.spyOn(api, "fetchStructureMode").mockRejectedValue(new Error("offline"));
    const { container } = render(<StructureModeToggle />);
    await waitFor(() => expect(container.innerHTML).toBe(""));
  });

  it("keeps every user-facing string free of em-dashes", async () => {
    vi.spyOn(api, "fetchStructureMode").mockResolvedValue(state());
    const { container } = render(<StructureModeToggle />);
    await screen.findByText("Local");
    expect(container.innerHTML).not.toContain("—");
    expect(screen.getByRole("switch").getAttribute("title") ?? "").not.toContain("—");
  });
});
