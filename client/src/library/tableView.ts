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
  /** The cell-type dispatch seam (Story 7.11, AC-1): `PaperRow.renderCell`
   *  dispatches its `"tag"` case (Author, the only one this story) through a
   *  dedicated `TagCell`. Every other column keeps its bespoke per-key markup
   *  (Title's Open button, DOI's link, Location's folder icon, File type's
   *  badge) - this is the MINIMAL seam Story 7.12's consolidation formalizes,
   *  not a general column registry yet. */
  cellType: "text" | "number" | "badge" | "tag";
}

/** Column-width clamp range (Story 7.10, AC-5, code-review fix): shared by
 *  `useColumnWidths` (the live drag/keyboard resize clamp) AND
 *  `tableViewPrefs`'s reconcile (rejecting a corrupt/hand-edited persisted
 *  width outside this range, e.g. `-500` or `1000000`, which would otherwise
 *  survive reconcile and render before any resize interaction ever clamps
 *  it). Homed here (not in either of those two modules) so both can import
 *  it without a circular dependency (`useColumnWidths` already imports
 *  `tableViewPrefs`). */
export const MIN_COLUMN_WIDTH = 80;
export const MAX_COLUMN_WIDTH = 640;

// Order (Story 7.10 fix request): Title -> Authors -> Venue -> Year -> DOI ->
// Location -> Added -> File type (File type last, unlisted in the request;
// it's hidden by default now instead of DOI, AC-7/story 7.10 fix request).
// Position here is display order only - it has no bearing on
// `visibleColumns`/hidden-state or the Location per-lens suppression in
// `LibraryPage.tsx`, which filter this array, not reorder it.
export const COLUMNS: ColumnDef[] = [
  { key: "title", label: "Title", hideable: false, sortable: true, cellType: "text" },
  { key: "authors", label: "Authors", hideable: true, sortable: true, cellType: "tag" },
  { key: "venue", label: "Venue", hideable: true, sortable: true, cellType: "text" },
  { key: "year", label: "Year", hideable: true, sortable: true, cellType: "number" },
  { key: "doi", label: "DOI", hideable: true, sortable: true, cellType: "text" },
  { key: "location", label: "Location", hideable: true, sortable: true, cellType: "text" },
  { key: "added", label: "Added", hideable: true, sortable: true, cellType: "text" },
  { key: "file_type", label: "File type", hideable: true, sortable: true, cellType: "badge" },
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

/** Set-membership filter over `authors_list` (Story 7.11, AC-5): a row passes
 *  when its `authors_list` CONTAINS `author`, never a substring match on the
 *  joined display string (LFR-6). `null` is a no-op (returns `rows`
 *  unchanged, same reference, mirroring `sortRows`'s own null-sort
 *  short-circuit); never mutates `rows`. Runs BEFORE `sortRows` in
 *  `useTableView.applyTableView` (filter, then sort) so the folder-filtered
 *  array Story 7.3's range-select indexes stays the one array threaded
 *  through, just narrowed. */
export function applyTagFilter(rows: CollectionRow[], author: string | null): CollectionRow[] {
  if (author === null) return rows;
  return rows.filter((row) => row.authors_list.includes(author));
}

/** Pins Title to index 0 (Story 7.10, AC-4 - a store invariant, not just a UI
 *  check, Dev Notes: "no code path... can strand it"). A well-formed `order`
 *  (Title already first) is returned as-is, so `moveColumn`/`reorderColumns`
 *  don't allocate on the common path; a malformed one (e.g. adversarial
 *  `localStorage`, or a caller passing an arbitrary array straight into
 *  these exported pure functions) is defensively re-pinned BEFORE any index
 *  math runs, so a swap/splice computed against a bad input can never
 *  further displace Title. */
function pinTitleFirst(order: ColumnKey[]): ColumnKey[] {
  if (order[0] === "title") return order;
  return ["title", ...order.filter((k) => k !== "title")];
}

/** Moves `key` one slot toward `dir` in `order` (Story 7.10, AC-1/AC-2/AC-4).
 *  Title is pinned at index 0: moving Title is a no-op, and a move that would
 *  cross Title (the column immediately right of it moving left) or run off
 *  either end is also a no-op. Always returns a NEW array, never mutates
 *  `order` - the single source `tableViewPrefs`'s store actions delegate to. */
export function moveColumn(order: ColumnKey[], key: ColumnKey, dir: "left" | "right"): ColumnKey[] {
  const pinned = pinTitleFirst(order);
  if (key === "title") return [...pinned];
  const idx = pinned.indexOf(key);
  if (idx === -1) return [...pinned];
  const targetIdx = dir === "left" ? idx - 1 : idx + 1;
  if (targetIdx <= 0 || targetIdx >= pinned.length) return [...pinned];
  const next = [...pinned];
  [next[idx], next[targetIdx]] = [next[targetIdx], next[idx]];
  return next;
}

/** Moves `fromKey` to occupy `toKey`'s original slot (standard array-move
 *  reorder semantics, Story 7.10 AC-1/AC-4, fix request: matches
 *  dnd-kit/react-beautiful-dnd's convention). `toKey`'s ORIGINAL index (in
 *  `order`, before `fromKey` is removed) is used as the insertion point -
 *  NOT its post-removal index - so a FORWARD drag (fromKey left of toKey)
 *  lands `fromKey` AFTER toKey, while a BACKWARD drag (fromKey right of
 *  toKey) lands it BEFORE. This is what makes dragging a column onto its
 *  immediate neighbor a real swap in EITHER direction; the "insert before,
 *  post-removal index" definition this replaced degenerated to a no-op for
 *  the single most common gesture - dragging a column onto the neighbor
 *  directly to its right, which is already "before" that neighbor. Title
 *  never moves (a `fromKey` of "title" is a no-op) and nothing is ever
 *  inserted before Title - a drop onto/before Title clamps to "just after
 *  Title" (index 1). Always returns a NEW array. */
export function reorderColumns(order: ColumnKey[], fromKey: ColumnKey, toKey: ColumnKey): ColumnKey[] {
  const pinned = pinTitleFirst(order);
  if (fromKey === "title" || fromKey === toKey || !pinned.includes(fromKey)) return [...pinned];
  const toIdx = pinned.indexOf(toKey);
  const next = [...pinned];
  next.splice(pinned.indexOf(fromKey), 1);
  const insertAt = Math.max(toIdx, 1);
  next.splice(insertAt, 0, fromKey);
  return next;
}
