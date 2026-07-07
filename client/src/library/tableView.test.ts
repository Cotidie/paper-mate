import { describe, it, expect } from "vitest";
import { sortRows, type SortState } from "@/library/tableView";
import type { CollectionRow } from "@/api/client";

function row(overrides: Partial<CollectionRow>): CollectionRow {
  return {
    doc_id: "d",
    title: "T",
    authors: null,
    added: "2026-07-06T00:00:00Z",
    file_type: "pdf",
    status: "ready",
    folder_id: null,
    trashed: false,
    starred: false,
    order: 0,
    ...overrides,
  };
}

describe("sortRows", () => {
  it("returns rows unchanged when sort is null (default response order)", () => {
    const rows = [row({ doc_id: "b", title: "B" }), row({ doc_id: "a", title: "A" })];
    expect(sortRows(rows, null)).toEqual(rows);
  });

  it("does not mutate the input array", () => {
    const rows = [row({ doc_id: "b", title: "B" }), row({ doc_id: "a", title: "A" })];
    const original = [...rows];
    sortRows(rows, { column: "title", direction: "asc" });
    expect(rows).toEqual(original);
  });

  it("sorts Title case-insensitively, ascending and descending", () => {
    const rows = [row({ doc_id: "1", title: "banana" }), row({ doc_id: "2", title: "Apple" })];
    expect(sortRows(rows, { column: "title", direction: "asc" }).map((r) => r.doc_id)).toEqual(["2", "1"]);
    expect(sortRows(rows, { column: "title", direction: "desc" }).map((r) => r.doc_id)).toEqual(["1", "2"]);
  });

  it("sorts Title by the filename fallback when title is null", () => {
    const rows = [
      row({ doc_id: "1", title: "Zebra" }),
      row({ doc_id: "2", title: null, filename: "apple.pdf" }),
    ];
    expect(sortRows(rows, { column: "title", direction: "asc" }).map((r) => r.doc_id)).toEqual(["2", "1"]);
  });

  it("sorts Added chronologically by the ISO timestamp, not lexically by the formatted label", () => {
    // "Jan" sorts after "Feb" lexically, but January is chronologically first.
    const rows = [
      row({ doc_id: "feb", added: "2026-02-01T00:00:00Z" }),
      row({ doc_id: "jan", added: "2026-01-01T00:00:00Z" }),
    ];
    expect(sortRows(rows, { column: "added", direction: "asc" }).map((r) => r.doc_id)).toEqual(["jan", "feb"]);
    expect(sortRows(rows, { column: "added", direction: "desc" }).map((r) => r.doc_id)).toEqual(["feb", "jan"]);
  });

  it("sorts Authors case-insensitively", () => {
    const rows = [row({ doc_id: "1", authors: "Zeta" }), row({ doc_id: "2", authors: "alpha" })];
    expect(sortRows(rows, { column: "authors", direction: "asc" }).map((r) => r.doc_id)).toEqual(["2", "1"]);
  });

  it("sorts File type by the underlying enum value", () => {
    const rows = [row({ doc_id: "1", file_type: "pdf" }), row({ doc_id: "2", file_type: "note" })];
    expect(sortRows(rows, { column: "file_type", direction: "asc" }).map((r) => r.doc_id)).toEqual(["2", "1"]);
  });

  it("a null/empty value sorts last regardless of direction", () => {
    const rows = [
      row({ doc_id: "untitled", title: null, filename: undefined }),
      row({ doc_id: "b", title: "Beta" }),
      row({ doc_id: "a", title: "Alpha" }),
    ];
    const asc: SortState = { column: "title", direction: "asc" };
    expect(sortRows(rows, asc).map((r) => r.doc_id)).toEqual(["a", "b", "untitled"]);
    const desc: SortState = { column: "title", direction: "desc" };
    expect(sortRows(rows, desc).map((r) => r.doc_id)).toEqual(["b", "a", "untitled"]);
  });

  it("keeps equal keys in response order (stable) in both directions", () => {
    const rows = [
      row({ doc_id: "1", authors: "Same" }),
      row({ doc_id: "2", authors: "Same" }),
      row({ doc_id: "3", authors: "Same" }),
    ];
    expect(sortRows(rows, { column: "authors", direction: "asc" }).map((r) => r.doc_id)).toEqual(["1", "2", "3"]);
    expect(sortRows(rows, { column: "authors", direction: "desc" }).map((r) => r.doc_id)).toEqual(["1", "2", "3"]);
  });
});
