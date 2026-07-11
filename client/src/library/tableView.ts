/**
 * The Library table's column DESCRIPTOR model (Story 7.4, AD-L3: view-state,
 * never persisted, never a route). Mirrors `folderFilter.ts` - a pure, no-React
 * leaf. The two client-only transforms over this descriptor are its sibling
 * leaves: sort in `columnSort.ts`, reorder in `columnReorder.ts` (Story 7.12
 * AC-4: the column model reads as a coherent set of leaves, not one fused file).
 */
export type ColumnKey =
  | "title"
  | "authors"
  | "added"
  | "file_type"
  | "location"
  | "venue_short"
  | "venue"
  | "year"
  | "doi";

export interface ColumnDef {
  key: ColumnKey;
  label: string;
  /** Title is never hideable (AC-1): it carries the Open button + inline-edit
   *  affordance, so hiding it would strand the only way to open/rename a paper. */
  hideable: boolean;
  sortable: boolean;
  /** The cell-type dispatch class (Story 7.11, AC-1): a COARSE class used for
   *  shared styling/sort grouping (tag vs text vs badge vs number). The
   *  per-COLUMN cell markup lives in `CollectionTable/cells.tsx`'s
   *  `CELL_RENDERERS` registry (Story 7.12, AC-4), NOT a per-key `switch`. */
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
  { key: "venue_short", label: "Venue (Short)", hideable: true, sortable: true, cellType: "text" },
  { key: "venue", label: "Venue (Full)", hideable: true, sortable: true, cellType: "text" },
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
