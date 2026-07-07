import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTableView } from "@/library/useTableView";

describe("useTableView (Story 7.9, AC-7)", () => {
  it("hides DOI by default, keeps Venue and Year visible", () => {
    const { result } = renderHook(() => useTableView());
    expect(result.current.hiddenColumns.has("doi")).toBe(true);
    expect(result.current.hiddenColumns.has("venue")).toBe(false);
    expect(result.current.hiddenColumns.has("year")).toBe(false);
  });

  it("toggling doi reveals it", () => {
    const { result } = renderHook(() => useTableView());
    act(() => result.current.toggleColumn("doi"));
    expect(result.current.hiddenColumns.has("doi")).toBe(false);
    expect(result.current.visibleColumns.some((c) => c.key === "doi")).toBe(true);
  });

  it("Title can never enter the hidden set", () => {
    const { result } = renderHook(() => useTableView());
    act(() => result.current.toggleColumn("title"));
    expect(result.current.hiddenColumns.has("title")).toBe(false);
  });
});
