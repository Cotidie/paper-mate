import { describe, it, expect } from "vitest";
import { applyColumnFilter, sortRows, type ColumnFilter, type SortState } from "@/library/tableView";
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

describe("applyColumnFilter", () => {
  it("returns rows unchanged when filter is null", () => {
    const rows = [row({ doc_id: "a" })];
    expect(applyColumnFilter(rows, null)).toEqual(rows);
  });

  it("returns rows unchanged when the query is empty or whitespace-only", () => {
    const rows = [row({ doc_id: "a" })];
    expect(applyColumnFilter(rows, { column: "title", query: "" })).toEqual(rows);
    expect(applyColumnFilter(rows, { column: "title", query: "   " })).toEqual(rows);
  });

  it("matches Title case-insensitively by substring", () => {
    const rows = [row({ doc_id: "1", title: "Attention Is All You Need" }), row({ doc_id: "2", title: "Other" })];
    const filter: ColumnFilter = { column: "title", query: "attention" };
    expect(applyColumnFilter(rows, filter).map((r) => r.doc_id)).toEqual(["1"]);
  });

  it("matches Authors case-insensitively by substring", () => {
    const rows = [row({ doc_id: "1", authors: "Vaswani et al." }), row({ doc_id: "2", authors: "Other" })];
    expect(applyColumnFilter(rows, { column: "authors", query: "VASWANI" }).map((r) => r.doc_id)).toEqual(["1"]);
  });

  it("matches Added against the formatted display date, not the raw ISO string", () => {
    const rows = [row({ doc_id: "1", added: "2026-07-05T12:00:00+00:00" })];
    expect(applyColumnFilter(rows, { column: "added", query: "jul" }).map((r) => r.doc_id)).toEqual(["1"]);
  });

  it("matches File type against the PDF/Note display label", () => {
    const rows = [row({ doc_id: "1", file_type: "pdf" }), row({ doc_id: "2", file_type: "note" })];
    expect(applyColumnFilter(rows, { column: "file_type", query: "note" }).map((r) => r.doc_id)).toEqual(["2"]);
    expect(applyColumnFilter(rows, { column: "file_type", query: "pdf" }).map((r) => r.doc_id)).toEqual(["1"]);
  });

  it("clearing the value (empty query) returns all rows", () => {
    const rows = [row({ doc_id: "1", title: "Match" }), row({ doc_id: "2", title: "Other" })];
    const narrowed = applyColumnFilter(rows, { column: "title", query: "match" });
    expect(narrowed.map((r) => r.doc_id)).toEqual(["1"]);
    expect(applyColumnFilter(rows, { column: "title", query: "" }).map((r) => r.doc_id)).toEqual(["1", "2"]);
  });

  it("matches File type against the status chip text when one is shown, not the underlying PDF/Note (code-review fix)", () => {
    const rows = [
      row({ doc_id: "extracting", file_type: "pdf", status: "extracting" }),
      row({ doc_id: "parse-failed", file_type: "pdf", status: "parse-failed" }),
      row({ doc_id: "ready", file_type: "pdf", status: "ready" }),
    ];
    expect(applyColumnFilter(rows, { column: "file_type", query: "extracting" }).map((r) => r.doc_id)).toEqual([
      "extracting",
    ]);
    expect(applyColumnFilter(rows, { column: "file_type", query: "no metadata" }).map((r) => r.doc_id)).toEqual([
      "parse-failed",
    ]);
    // A row showing a status chip does not also match "pdf" (the chip, not
    // "PDF", is what's on screen for that row).
    expect(applyColumnFilter(rows, { column: "file_type", query: "pdf" }).map((r) => r.doc_id)).toEqual(["ready"]);
  });
});
