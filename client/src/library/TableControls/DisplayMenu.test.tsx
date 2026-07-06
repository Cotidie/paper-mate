import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import DisplayMenu from "./DisplayMenu";
import type { ColumnKey } from "@/library/tableView";

afterEach(cleanup);

describe("DisplayMenu (Story 7.4, AC-1)", () => {
  it("is closed by default", () => {
    render(<DisplayMenu hiddenColumns={new Set()} onToggleColumn={vi.fn()} />);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens listing only the hideable columns (never Title)", () => {
    render(<DisplayMenu hiddenColumns={new Set()} onToggleColumn={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Display" }));
    expect(screen.getByRole("checkbox", { name: "Authors" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Added" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "File type" })).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: "Title" })).toBeNull();
  });

  it("checks a column's box when it is visible, unchecks when hidden", () => {
    const hiddenColumns = new Set<ColumnKey>(["authors"]);
    render(<DisplayMenu hiddenColumns={hiddenColumns} onToggleColumn={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Display" }));
    expect((screen.getByRole("checkbox", { name: "Authors" }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("checkbox", { name: "Added" }) as HTMLInputElement).checked).toBe(true);
  });

  it("toggling a checkbox reports the column key", () => {
    const onToggleColumn = vi.fn();
    render(<DisplayMenu hiddenColumns={new Set()} onToggleColumn={onToggleColumn} />);
    fireEvent.click(screen.getByRole("button", { name: "Display" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Authors" }));
    expect(onToggleColumn).toHaveBeenCalledWith("authors");
  });

  it("stays open after toggling a checkbox (so multiple columns can be flipped in one pass)", () => {
    render(<DisplayMenu hiddenColumns={new Set()} onToggleColumn={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Display" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Authors" }));
    expect(screen.getByRole("menu")).toBeTruthy();
  });

  it("Escape closes the popover and returns focus to the trigger", () => {
    render(<DisplayMenu hiddenColumns={new Set()} onToggleColumn={vi.fn()} />);
    const button = screen.getByRole("button", { name: "Display" });
    fireEvent.click(button);
    fireEvent.keyDown(button, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("closes on an outside pointerdown", () => {
    render(<DisplayMenu hiddenColumns={new Set()} onToggleColumn={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Display" }));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
