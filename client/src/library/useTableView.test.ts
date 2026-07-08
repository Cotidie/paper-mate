import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTableView } from "@/library/useTableView";
import { useTableViewPrefs } from "@/library/tableViewPrefs";

// `tableViewPrefs` is a `localStorage`-persisted Zustand store (Story 7.10),
// which now backs `order`/`hidden` - reset it between cases (mirrors
// `settings/store.test.ts`), or a mutation in one test leaks into the next.
beforeEach(() => {
  localStorage.clear();
  useTableViewPrefs.getState().reset();
});

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

describe("useTableView persisted order (Story 7.10, AC-3/AC-4)", () => {
  it("visibleColumns reflects a persisted reorder", () => {
    act(() => useTableViewPrefs.getState().moveColumn("venue", "left"));
    const { result } = renderHook(() => useTableView());
    expect(result.current.visibleColumns.map((c) => c.key)).toEqual([
      "title",
      "venue",
      "authors",
      "year",
      "location",
      "added",
      // doi hidden by default
      "file_type",
    ]);
  });

  it("moveColumn updates visibleColumns order", () => {
    const { result } = renderHook(() => useTableView());
    act(() => result.current.moveColumn("venue", "left"));
    expect(result.current.visibleColumns.map((c) => c.key)[1]).toBe("venue");
  });

  it("reorderColumns updates visibleColumns order", () => {
    const { result } = renderHook(() => useTableView());
    act(() => result.current.reorderColumns("year", "authors"));
    expect(result.current.visibleColumns.map((c) => c.key)).toEqual([
      "title",
      "year",
      "authors",
      "venue",
      "location",
      "added",
      "file_type",
    ]);
  });

  it("Title is always first in visibleColumns, even after a reorder attempt", () => {
    const { result } = renderHook(() => useTableView());
    act(() => result.current.reorderColumns("doi", "title"));
    expect(result.current.visibleColumns[0].key).toBe("title");
  });

  it("sort stays local (ephemeral), independent of the persisted store", () => {
    const { result } = renderHook(() => useTableView());
    expect(result.current.sort).toBeNull();
    act(() => result.current.setSort({ column: "added", direction: "asc" }));
    expect(result.current.sort).toEqual({ column: "added", direction: "asc" });
  });
});
