import type { CollectionRow } from "@/api/client";
import { seedFieldValue } from "@/library/row";

/**
 * The Library table's column model + client-only sort transform (Story 7.4,
 * AD-L3: view-state, never persisted, never a route). Mirrors
 * `folderFilter.ts` - pure functions, no React, trivially unit-testable.
 */
export type ColumnKey = "title" | "authors" | "added" | "file_type" | "location" | "venue" | "year" | "doi";

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
  { key: "location", label: "Location", hideable: true, sortable: true },
  { key: "venue", label: "Venue", hideable: true, sortable: true },
  { key: "year", label: "Year", hideable: true, sortable: true },
  { key: "doi", label: "DOI", hideable: true, sortable: true },
];

/** `Uncategorized` mirrors `FolderPanel`'s own copy for a null `folder_id`. */
export const UNCATEGORIZED_LABEL = "Uncategorized";

export type SortDirection = "asc" | "desc";

export interface SortState {
  column: ColumnKey;
  direction: SortDirection;
}

/** The DISPLAYED title (AC-3): reuse `row.ts`'s `seedFieldValue` (a null
 *  title falls back to the filename with its `.pdf` extension stripped) -
 *  single source with `PaperRow`'s own fallback, per CLAUDE.md (adopt stable
 *  solutions) and this story's own Dev Notes ("do NOT re-implement the
 *  fallback logic"). */
function displayTitle(row: CollectionRow): string {
  return seedFieldValue(row, "title");
}

/** The underlying sort key per column (AC-3): `added` is chronological (the
 *  ISO timestamp's epoch millis), never the formatted "Jul 5, 2026" string,
 *  which would sort lexically (wrong month order). `location` sorts by the
 *  DISPLAYED folder name, which needs an id→name lookup the row itself
 *  doesn't carry - `folderNameById` threads that in from `useTableView`. */
function sortKey(row: CollectionRow, column: ColumnKey, folderNameById: Map<string, string>): string | number {
  switch (column) {
    case "added":
      return new Date(row.added).getTime();
    case "title":
      return displayTitle(row);
    case "authors":
      return row.authors ?? "";
    case "file_type":
      return row.file_type;
    case "location":
      return row.folder_id ? (folderNameById.get(row.folder_id) ?? UNCATEGORIZED_LABEL) : UNCATEGORIZED_LABEL;
    case "venue":
      return row.venue ?? "";
    case "year":
      return row.year ?? "";
    case "doi":
      return row.doi ?? "";
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
 *  Never mutates the input. `folderNameById` resolves the `location` column;
 *  omit it for a column that never sorts by folder name. */
export function sortRows(
  rows: CollectionRow[],
  sort: SortState | null,
  folderNameById: Map<string, string> = new Map(),
): CollectionRow[] {
  if (sort === null) return rows;
  const { column, direction } = sort;
  return [...rows].sort((a, b) =>
    compareForSort(sortKey(a, column, folderNameById), sortKey(b, column, folderNameById), direction),
  );
}
