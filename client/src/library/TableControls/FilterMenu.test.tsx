import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import FilterMenu from "./FilterMenu";

afterEach(cleanup);

describe("FilterMenu (Story 7.4, AC-4)", () => {
  it("is closed by default", () => {
    render(<FilterMenu filter={null} onChange={vi.fn()} />);
    expect(screen.queryByLabelText("Filter value")).toBeNull();
  });

  it("opens with Title selected and an empty value by default", () => {
    render(<FilterMenu filter={null} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    expect((screen.getByLabelText("Filter column") as HTMLSelectElement).value).toBe("title");
    expect((screen.getByLabelText("Filter value") as HTMLInputElement).value).toBe("");
  });

  it("seeds the column and value from an existing filter", () => {
    render(<FilterMenu filter={{ column: "authors", query: "vaswani" }} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    expect((screen.getByLabelText("Filter column") as HTMLSelectElement).value).toBe("authors");
    expect((screen.getByLabelText("Filter value") as HTMLInputElement).value).toBe("vaswani");
  });

  it("typing a value emits {column, query}", () => {
    const onChange = vi.fn();
    render(<FilterMenu filter={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    fireEvent.change(screen.getByLabelText("Filter value"), { target: { value: "attention" } });
    expect(onChange).toHaveBeenCalledWith({ column: "title", query: "attention" });
  });

  it("clearing the value emits null", () => {
    const onChange = vi.fn();
    render(<FilterMenu filter={{ column: "title", query: "attention" }} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    fireEvent.change(screen.getByLabelText("Filter value"), { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("a whitespace-only value emits null", () => {
    const onChange = vi.fn();
    render(<FilterMenu filter={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    fireEvent.change(screen.getByLabelText("Filter value"), { target: { value: "   " } });
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("changing the column while a value is present re-emits with the new column", () => {
    const onChange = vi.fn();
    render(<FilterMenu filter={{ column: "title", query: "attention" }} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    fireEvent.change(screen.getByLabelText("Filter column"), { target: { value: "authors" } });
    expect(onChange).toHaveBeenCalledWith({ column: "authors", query: "attention" });
  });

  it("changing the column with no value yet does not emit a filter", () => {
    const onChange = vi.fn();
    render(<FilterMenu filter={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    fireEvent.change(screen.getByLabelText("Filter column"), { target: { value: "authors" } });
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("Escape closes the popover and returns focus to the trigger", () => {
    render(<FilterMenu filter={null} onChange={vi.fn()} />);
    const button = screen.getByRole("button", { name: "Filter" });
    fireEvent.click(button);
    fireEvent.keyDown(button, { key: "Escape" });
    expect(screen.queryByLabelText("Filter value")).toBeNull();
    expect(document.activeElement).toBe(button);
  });
});
