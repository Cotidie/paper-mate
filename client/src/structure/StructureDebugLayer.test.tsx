import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import { getStructure } from "@/api/client";
import type { DocStructure } from "@/api/client";
import StructureDebugLayer, { isStructureDebugEnabled } from "@/structure/StructureDebugLayer";

vi.mock("@/api/client", () => ({ getStructure: vi.fn() }));

const mockGet = vi.mocked(getStructure);

const sample: DocStructure = {
  elements: [
    { id: "1", type: "heading", page_index: 0, rect: { x0: 0.1, y0: 0.05, x1: 0.9, y1: 0.1 }, text: "H", heading_level: 1 },
    { id: "2", type: "figure", page_index: 0, rect: { x0: 0.2, y0: 0.5, x1: 0.8, y1: 0.9 }, text: "", heading_level: null },
    { id: "3", type: "table", page_index: 1, rect: { x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.4 }, text: "", heading_level: null },
  ],
};

const BOX = { width: 600, height: 800 };

function setFlag(on: boolean) {
  window.history.replaceState({}, "", on ? "/?debugStructure=1" : "/");
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGet.mockReturnValue(new Promise<DocStructure>(() => {}));
});
afterEach(() => setFlag(false));

describe("isStructureDebugEnabled", () => {
  it("is true only when ?debugStructure=1", () => {
    setFlag(true);
    expect(isStructureDebugEnabled()).toBe(true);
    setFlag(false);
    expect(isStructureDebugEnabled()).toBe(false);
  });
});

describe("StructureDebugLayer", () => {
  it("renders nothing and does NOT fetch when the flag is off", () => {
    setFlag(false);
    const { container } = render(
      <StructureDebugLayer docId="doc-off" pageIndex={0} box={BOX} scale={1} />,
    );
    expect(container.firstChild).toBeNull();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("draws one box per element on its page when the flag is on", async () => {
    setFlag(true);
    mockGet.mockResolvedValue(sample);
    render(<StructureDebugLayer docId="doc-on-1" pageIndex={0} box={BOX} scale={1} />);
    await waitFor(() => expect(screen.getAllByTestId("structure-debug-el")).toHaveLength(2));
    const types = screen.getAllByTestId("structure-debug-el").map((n) => n.getAttribute("data-type"));
    expect(types.sort()).toEqual(["figure", "heading"]);
  });

  it("scopes boxes to the given page index", async () => {
    setFlag(true);
    mockGet.mockResolvedValue(sample);
    render(<StructureDebugLayer docId="doc-on-2" pageIndex={1} box={BOX} scale={1} />);
    await waitFor(() => expect(screen.getAllByTestId("structure-debug-el")).toHaveLength(1));
    expect(screen.getByTestId("structure-debug-el").getAttribute("data-type")).toBe("table");
  });

  it("positions a box via denormalize (numeric px geometry, rides scale)", async () => {
    setFlag(true);
    mockGet.mockResolvedValue(sample);
    render(<StructureDebugLayer docId="doc-on-3" pageIndex={0} box={BOX} scale={2} />);
    await waitFor(() => expect(screen.getAllByTestId("structure-debug-el").length).toBeGreaterThan(0));
    const heading = screen
      .getAllByTestId("structure-debug-el")
      .find((n) => n.getAttribute("data-type") === "heading")!;
    // rect.x0=0.1 * width(600) * scale(2) = 120px left.
    expect(heading.style.left).toBe("120px");
    expect(heading.style.top).toBe("80px"); // 0.05 * 800 * 2
  });
});
