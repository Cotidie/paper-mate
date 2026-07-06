import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import SortMenu from "./SortMenu";

afterEach(cleanup);

describe("SortMenu (Story 7.4, AC-2)", () => {
  it("is closed by default", () => {
    render(<SortMenu sort={null} onChange={vi.fn()} />);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens listing Default order + every sortable column", () => {
    render(<SortMenu sort={null} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Sort" }));
    expect(screen.getByRole("menuitem", { name: "Default order" })).toBeTruthy();
    for (const label of ["Title", "Authors", "Added", "File type"]) {
      expect(screen.getByRole("menuitem", { name: new RegExp(`^${label}`) })).toBeTruthy();
    }
  });

  it("picking an unsorted column sorts it ascending", () => {
    const onChange = vi.fn();
    render(<SortMenu sort={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Sort" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^Added/ }));
    expect(onChange).toHaveBeenCalledWith({ column: "added", direction: "asc" });
  });

  it("picking the active ascending column toggles it to descending", () => {
    const onChange = vi.fn();
    render(<SortMenu sort={{ column: "added", direction: "asc" }} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Sort" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^Added/ }));
    expect(onChange).toHaveBeenCalledWith({ column: "added", direction: "desc" });
  });

  it("picking the active descending column toggles it back to ascending", () => {
    const onChange = vi.fn();
    render(<SortMenu sort={{ column: "added", direction: "desc" }} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Sort" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^Added/ }));
    expect(onChange).toHaveBeenCalledWith({ column: "added", direction: "asc" });
  });

  it("picking a different column resets it to ascending regardless of the prior direction", () => {
    const onChange = vi.fn();
    render(<SortMenu sort={{ column: "added", direction: "desc" }} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Sort" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^Title/ }));
    expect(onChange).toHaveBeenCalledWith({ column: "title", direction: "asc" });
  });

  it("Default order clears the sort", () => {
    const onChange = vi.fn();
    render(<SortMenu sort={{ column: "added", direction: "asc" }} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Sort" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Default order" }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("stays open after picking a column (so direction can be toggled without reopening)", () => {
    render(<SortMenu sort={null} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Sort" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^Added/ }));
    expect(screen.getByRole("menu")).toBeTruthy();
  });

  it("Escape closes the popover and returns focus to the trigger", () => {
    render(<SortMenu sort={null} onChange={vi.fn()} />);
    const button = screen.getByRole("button", { name: "Sort" });
    fireEvent.click(button);
    fireEvent.keyDown(button, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(button);
  });
});
