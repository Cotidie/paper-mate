import type { CollectionRow } from "@/api/client";
import { formatAdded, seedFieldValue, statusLabel } from "@/library/row";

/**
 * The Library table's column model + client-only sort/filter transforms
 * (Story 7.4, AD-L3: view-state, never persisted, never a route). Mirrors
 * `folderFilter.ts` - pure functions, no React, trivially unit-testable.
 */
export type ColumnKey = "title" | "authors" | "added" | "file_type";

export interface ColumnDef {
  key: ColumnKey;
  label: string;
  /** Title is never hideable (AC-1): it carries the Open button + inline-edit
   *  affordance, so hiding it would strand the only way to open/rename a paper. */
  hideable: boolean;
  sortable: boolean;
}

export const COLUMNS: ColumnDef[] = [
  { key: "title", label: "Title", hideable: false, sortable: true },
  { key: "authors", label: "Authors", hideable: true, sortable: true },
  { key: "added", label: "Added", hideable: true, sortable: true },
  { key: "file_type", label: "File type", hideable: true, sortable: true },
];

export type SortDirection = "asc" | "desc";

export interface SortState {
  column: ColumnKey;
  direction: SortDirection;
}

export interface ColumnFilter {
  column: ColumnKey;
  query: string;
}

/** The DISPLAYED title (AC-3): reuse `row.ts`'s `seedFieldValue` (a null
 *  title falls back to the filename with its `.pdf` extension stripped) -
 *  single source with `PaperRow`'s own fallback, per CLAUDE.md (adopt stable
 *  solutions) and this story's own Dev Notes ("do NOT re-implement the
 *  fallback logic"). */
function displayTitle(row: CollectionRow): string {
  return seedFieldValue(row, "title");
}

/** The displayed File-type cell text: a status chip ("Extracting", "No
 *  metadata") takes over the cell for those rows (`PaperRow`'s `label ? ... :
 *  PDF/Note`), so the filter must match THAT text, not always "PDF"/"Note" -
 *  otherwise filtering "no metadata" would find nothing despite it being
 *  literally on screen. */
function displayFileType(row: CollectionRow): string {
  return statusLabel(row.status) ?? (row.file_type === "note" ? "Note" : "PDF");
}

/** The underlying sort key per column (AC-3): `added` is chronological (the
 *  ISO timestamp's epoch millis), never the formatted "Jul 5, 2026" string,
 *  which would sort lexically (wrong month order). */
function sortKey(row: CollectionRow, column: ColumnKey): string | number {
  switch (column) {
    case "added":
      return new Date(row.added).getTime();
    case "title":
      return displayTitle(row);
    case "authors":
      return row.authors ?? "";
    case "file_type":
      return row.file_type;
  }
}

/** An empty string (untitled/no authors) always sorts last, in either
 *  direction, so an untitled row doesn't jump to the top on a descending
 *  sort. Non-empty keys compare per `direction`, case-insensitively for
 *  strings; ties keep the original (response) order in BOTH directions
 *  (`Array.prototype.sort` is stable - direction is a comparator sign flip,
 *  never a post-hoc `.reverse()`, which would undo that stability). */
function compareForSort(a: string | number, b: string | number, direction: SortDirection): number {
  const aEmpty = a === "";
  const bEmpty = b === "";
  if (aEmpty || bEmpty) {
    if (aEmpty && bEmpty) return 0;
    return aEmpty ? 1 : -1;
  }
  if (typeof a === "number" && typeof b === "number") {
    return direction === "asc" ? a - b : b - a;
  }
  const cmp = String(a).localeCompare(String(b), undefined, { sensitivity: "base" });
  return direction === "asc" ? cmp : -cmp;
}

/** Sort rows by the column's underlying value (AC-2/AC-3). Returns `rows`
 *  unchanged when `sort` is null (default: the backend response order).
 *  Never mutates the input. */
export function sortRows(rows: CollectionRow[], sort: SortState | null): CollectionRow[] {
  if (sort === null) return rows;
  const { column, direction } = sort;
  return [...rows].sort((a, b) => compareForSort(sortKey(a, column), sortKey(b, column), direction));
}

/** The displayed text for a column (AC-4's filter matches against this, not
 *  the underlying value - e.g. File type matches "PDF"/"Note", not "pdf"/"note"). */
function displayValue(row: CollectionRow, column: ColumnKey): string {
  switch (column) {
    case "title":
      return displayTitle(row);
    case "authors":
      return row.authors ?? "";
    case "added":
      return formatAdded(row.added);
    case "file_type":
      return displayFileType(row);
  }
}

/** Keep only rows whose displayed column text contains `filter.query`,
 *  case-insensitively (AC-4). Returns `rows` unchanged when `filter` is null
 *  or its query is empty/whitespace-only. */
export function applyColumnFilter(rows: CollectionRow[], filter: ColumnFilter | null): CollectionRow[] {
  if (filter === null) return rows;
  const query = filter.query.trim().toLowerCase();
  if (query === "") return rows;
  return rows.filter((row) => displayValue(row, filter.column).toLowerCase().includes(query));
}
