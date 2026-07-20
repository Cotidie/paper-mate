import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import RegionFlashLayer from "./RegionFlashLayer";
import { useRegionFlashStore } from "./regionFlash";

const BOX = { width: 600, height: 800 };
const rect = { x0: 0.1, y0: 0.2, x1: 0.9, y1: 0.3 };

afterEach(() => {
  cleanup();
  useRegionFlashStore.getState().clear();
});

describe("RegionFlashLayer", () => {
  it("renders nothing when no region is flashed", () => {
    const { container } = render(<RegionFlashLayer pageIndex={0} box={BOX} scale={1} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the flash box when the store's region matches this page", () => {
    useRegionFlashStore.getState().flash({ pageIndex: 0, rect });
    render(<RegionFlashLayer pageIndex={0} box={BOX} scale={1} />);
    expect(screen.getByTestId("region-flash")).toBeTruthy();
  });

  it("renders nothing when the flashed region is on a DIFFERENT page", () => {
    useRegionFlashStore.getState().flash({ pageIndex: 5, rect });
    const { container } = render(<RegionFlashLayer pageIndex={0} box={BOX} scale={1} />);
    expect(container.firstChild).toBeNull();
  });
});
