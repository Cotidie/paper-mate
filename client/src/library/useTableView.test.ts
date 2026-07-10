import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTableView } from "@/library/useTableView";
import { useTableViewPrefs } from "@/library/tableViewPrefs";
import type { CollectionRow } from "@/api/client";

function row(overrides: Partial<CollectionRow> & { doc_id: string }): CollectionRow {
  return {
    title: null,
    authors: null,
    authors_list: [],
    added: "2026-07-05T00:00:00+00:00",
    file_type: "pdf",
    status: "ready",
    folder_id: null,
    trashed: false,
    starred: false,
    order: 0,
    ...overrides,
  } as CollectionRow;
}

// `tableViewPrefs` is a `localStorage`-persisted Zustand store (Story 7.10),
// which now backs `order`/`hidden` - reset it between cases (mirrors
// `settings/store.test.ts`), or a mutation in one test leaks into the next.
beforeEach(() => {
  localStorage.clear();
  useTableViewPrefs.getState().reset();
});

describe("useTableView (Story 7.9/7.10, AC-7)", () => {
  it("hides File type by default, keeps Venue and Year visible", () => {
    const { result } = renderHook(() => useTableView());
    expect(result.current.hiddenColumns.has("file_type")).toBe(true);
    expect(result.current.hiddenColumns.has("venue")).toBe(false);
    expect(result.current.hiddenColumns.has("year")).toBe(false);
  });

  it("toggling file_type reveals it", () => {
    const { result } = renderHook(() => useTableView());
    act(() => result.current.toggleColumn("file_type"));
    expect(result.current.hiddenColumns.has("file_type")).toBe(false);
    expect(result.current.visibleColumns.some((c) => c.key === "file_type")).toBe(true);
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
      "doi",
      "location",
      "added",
      // file_type hidden by default
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
      "doi",
      "location",
      "added",
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

describe("useTableView author tag filter (Story 7.11, AC-5)", () => {
  const alice = row({ doc_id: "a", title: "Alice's Paper", authors_list: ["Alice"], order: 0 });
  const bob = row({ doc_id: "b", title: "Bob's Paper", authors_list: ["Bob"], order: 1 });
  const both = row({ doc_id: "c", title: "Joint Paper", authors_list: ["Alice", "Bob"], order: 2 });

  it("authorFilter is null by default: applyTableView is a no-op pass-through", () => {
    const { result } = renderHook(() => useTableView());
    expect(result.current.authorFilter).toBeNull();
    expect(result.current.applyTableView([alice, bob, both])).toEqual([alice, bob, both]);
  });

  it("setAuthorFilter narrows applyTableView to rows containing that author", () => {
    const { result } = renderHook(() => useTableView());
    act(() => result.current.setAuthorFilter("Alice"));
    expect(result.current.applyTableView([alice, bob, both]).map((r) => r.doc_id)).toEqual(["a", "c"]);
  });

  it("setAuthorFilter(null) clears the filter", () => {
    const { result } = renderHook(() => useTableView());
    act(() => result.current.setAuthorFilter("Alice"));
    act(() => result.current.setAuthorFilter(null));
    expect(result.current.applyTableView([alice, bob, both])).toEqual([alice, bob, both]);
  });

  it("the filter runs BEFORE sort: a narrowed set still sorts correctly", () => {
    const { result } = renderHook(() => useTableView());
    act(() => result.current.setAuthorFilter("Alice"));
    act(() => result.current.setSort({ column: "title", direction: "desc" }));
    expect(result.current.applyTableView([alice, bob, both]).map((r) => r.doc_id)).toEqual(["c", "a"]);
  });
});
