import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import TocPanel from "./TocPanel";
import type { TocEntry } from "../../render";

afterEach(cleanup);

const entries: TocEntry[] = [
  { title: "1 Intro", pageNumber: 1, depth: 0 },
  { title: "1.1 Background", pageNumber: 2, depth: 1 },
  { title: "2 Methods", pageNumber: 5, depth: 0 },
];

describe("TocPanel", () => {
  it("renders nothing when closed", () => {
    render(<TocPanel open={false} entries={entries} onJump={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByTestId("toc-panel")).toBeNull();
  });

  it("lists the outline rows when open", () => {
    render(<TocPanel open entries={entries} onJump={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByTestId("toc-panel")).toBeTruthy();
    expect(screen.getByText("1 Intro")).toBeTruthy();
    expect(screen.getByText("1.1 Background")).toBeTruthy();
    expect(screen.getByText("2 Methods")).toBeTruthy();
  });

  it("jumps to a row's page on click", () => {
    const onJump = vi.fn();
    render(<TocPanel open entries={entries} onJump={onJump} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("2 Methods"));
    expect(onJump).toHaveBeenCalledWith(5);
  });

  it("shows a loading note (not the empty state) while the outline is null", () => {
    render(<TocPanel open entries={null} onJump={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByTestId("toc-loading")).toBeTruthy();
    expect(screen.queryByTestId("toc-empty")).toBeNull();
    expect(screen.queryByTestId("toc-row-0")).toBeNull();
  });

  it("shows the empty state (not a list) when there is no outline", () => {
    render(<TocPanel open entries={[]} onJump={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByTestId("toc-empty").textContent).toContain("no table of contents");
    expect(screen.queryByTestId("toc-row-0")).toBeNull();
  });

  it("closes via the close button and Escape", () => {
    const onClose = vi.fn();
    render(<TocPanel open entries={entries} onJump={vi.fn()} onClose={onClose} />);
    fireEvent.click(screen.getByTestId("toc-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("uses real, keyboard-reachable buttons for rows + close", () => {
    render(<TocPanel open entries={entries} onJump={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByTestId("toc-row-0").tagName).toBe("BUTTON");
    expect(screen.getByTestId("toc-close").tagName).toBe("BUTTON");
  });
});
