import { describe, it, expect } from "vitest";
import { COLUMNS, moveColumn, reorderColumns, sortRows, type ColumnKey, type SortState } from "@/library/tableView";
import type { CollectionRow } from "@/api/client";

describe("COLUMNS order (fix request)", () => {
  it("Title, Authors, Venue, Year, Location, Added, File type, DOI", () => {
    expect(COLUMNS.map((c) => c.key)).toEqual([
      "title",
      "authors",
      "venue",
      "year",
      "location",
      "added",
      "file_type",
      "doi",
    ]);
  });
});

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

  it("sorts Venue case-insensitively, empty last in either direction", () => {
    const rows = [
      row({ doc_id: "1", venue: "Zeta Journal" }),
      row({ doc_id: "2", venue: "alpha journal" }),
      row({ doc_id: "3", venue: null }),
    ];
    expect(sortRows(rows, { column: "venue", direction: "asc" }).map((r) => r.doc_id)).toEqual(["2", "1", "3"]);
    expect(sortRows(rows, { column: "venue", direction: "desc" }).map((r) => r.doc_id)).toEqual(["1", "2", "3"]);
  });

  it("sorts Year numerically, not lexically, empty last in either direction", () => {
    const rows = [
      row({ doc_id: "a", year: 2009 }),
      row({ doc_id: "b", year: 2017 }),
      row({ doc_id: "c", year: 1998 }),
      row({ doc_id: "d", year: null }),
    ];
    expect(sortRows(rows, { column: "year", direction: "asc" }).map((r) => r.doc_id)).toEqual([
      "c",
      "a",
      "b",
      "d",
    ]);
    expect(sortRows(rows, { column: "year", direction: "desc" }).map((r) => r.doc_id)).toEqual([
      "b",
      "a",
      "c",
      "d",
    ]);
  });

  it("sorts DOI as a string, empty last in either direction", () => {
    const rows = [
      row({ doc_id: "1", doi: "10.5/zzz" }),
      row({ doc_id: "2", doi: "10.5/aaa" }),
      row({ doc_id: "3", doi: null }),
    ];
    expect(sortRows(rows, { column: "doi", direction: "asc" }).map((r) => r.doc_id)).toEqual(["2", "1", "3"]);
    expect(sortRows(rows, { column: "doi", direction: "desc" }).map((r) => r.doc_id)).toEqual(["1", "2", "3"]);
  });
});

const DEFAULT_ORDER: ColumnKey[] = [
  "title",
  "authors",
  "venue",
  "year",
  "location",
  "added",
  "file_type",
  "doi",
];

describe("moveColumn (Story 7.10, AC-1/AC-2/AC-4)", () => {
  it("moves a column left", () => {
    expect(moveColumn(DEFAULT_ORDER, "venue", "left")).toEqual([
      "title",
      "venue",
      "authors",
      "year",
      "location",
      "added",
      "file_type",
      "doi",
    ]);
  });

  it("moves a column right", () => {
    expect(moveColumn(DEFAULT_ORDER, "authors", "right")).toEqual([
      "title",
      "venue",
      "authors",
      "year",
      "location",
      "added",
      "file_type",
      "doi",
    ]);
  });

  it("Title never moves (no-op)", () => {
    expect(moveColumn(DEFAULT_ORDER, "title", "right")).toEqual(DEFAULT_ORDER);
    expect(moveColumn(DEFAULT_ORDER, "title", "left")).toEqual(DEFAULT_ORDER);
  });

  it("the column immediately right of Title cannot move left (would displace Title)", () => {
    expect(moveColumn(DEFAULT_ORDER, "authors", "left")).toEqual(DEFAULT_ORDER);
  });

  it("the rightmost column cannot move right", () => {
    expect(moveColumn(DEFAULT_ORDER, "doi", "right")).toEqual(DEFAULT_ORDER);
  });

  it("returns a new array and never mutates the input", () => {
    const original = [...DEFAULT_ORDER];
    const next = moveColumn(DEFAULT_ORDER, "venue", "left");
    expect(DEFAULT_ORDER).toEqual(original);
    expect(next).not.toBe(DEFAULT_ORDER);
  });

  it("an unknown key is a no-op", () => {
    expect(moveColumn(DEFAULT_ORDER, "nope" as ColumnKey, "left")).toEqual(DEFAULT_ORDER);
  });

  it("a malformed input order (Title not at index 0) is pinned first before the move, never further displaced (code-review fix)", () => {
    const malformed: ColumnKey[] = ["authors", "title", "venue"];
    expect(moveColumn(malformed, "venue", "left")).toEqual(["title", "venue", "authors"]);
  });
});

describe("reorderColumns (Story 7.10, AC-1/AC-4)", () => {
  it("inserts fromKey at toKey's position (drop-onto semantics)", () => {
    expect(reorderColumns(DEFAULT_ORDER, "authors", "doi")).toEqual([
      "title",
      "venue",
      "year",
      "location",
      "added",
      "file_type",
      "authors",
      "doi",
    ]);
  });

  it("dragging a later column onto an earlier one inserts it before the target", () => {
    expect(reorderColumns(DEFAULT_ORDER, "doi", "venue")).toEqual([
      "title",
      "authors",
      "doi",
      "venue",
      "year",
      "location",
      "added",
      "file_type",
    ]);
  });

  it("Title never moves (fromKey title is a no-op)", () => {
    expect(reorderColumns(DEFAULT_ORDER, "title", "doi")).toEqual(DEFAULT_ORDER);
  });

  it("a drop onto/before Title clamps to just after Title", () => {
    expect(reorderColumns(DEFAULT_ORDER, "doi", "title")).toEqual([
      "title",
      "doi",
      "authors",
      "venue",
      "year",
      "location",
      "added",
      "file_type",
    ]);
  });

  it("dropping a column onto itself is a no-op", () => {
    expect(reorderColumns(DEFAULT_ORDER, "venue", "venue")).toEqual(DEFAULT_ORDER);
  });

  it("returns a new array and never mutates the input", () => {
    const original = [...DEFAULT_ORDER];
    const next = reorderColumns(DEFAULT_ORDER, "authors", "doi");
    expect(DEFAULT_ORDER).toEqual(original);
    expect(next).not.toBe(DEFAULT_ORDER);
  });

  it("an unknown fromKey is a no-op", () => {
    expect(reorderColumns(DEFAULT_ORDER, "nope" as ColumnKey, "doi")).toEqual(DEFAULT_ORDER);
  });

  it("a malformed input order (Title not at index 0) is pinned first before the reorder (code-review fix)", () => {
    const malformed: ColumnKey[] = ["authors", "title", "venue"];
    expect(reorderColumns(malformed, "venue", "authors")).toEqual(["title", "venue", "authors"]);
  });
});
