import { useDragResize } from "@/library/useDragResize";
import type { ColumnKey } from "@/library/tableView";

/** Matches the `--collection-table-*-width` tokens (each column's default,
 *  pre-resize, width) - kept in sync manually since these are now client
 *  view-state overrides, not the CSS defaults themselves. */
const DEFAULT_WIDTHS: Record<ColumnKey, number> = {
  title: 320,
  authors: 220,
  added: 120,
  file_type: 96,
  location: 140,
  venue: 200,
  year: 80,
  doi: 200,
};
const MIN_COLUMN_WIDTH = 80;
const MAX_COLUMN_WIDTH = 640;

/**
 * Drag-to-resize for the Library table's columns (fix request): client-only
 * view-state, resets to the default widths on reload (AD-L3, same footing as
 * Story 7.4's other view-state). `COLUMNS` is a small, fixed, compile-time-
 * known set, so one `useDragResize` call per column key is a static call
 * count (satisfies the rules of hooks) rather than a loop.
 */
export function useColumnWidths() {
  const title = useDragResize(DEFAULT_WIDTHS.title, MIN_COLUMN_WIDTH, MAX_COLUMN_WIDTH);
  const authors = useDragResize(DEFAULT_WIDTHS.authors, MIN_COLUMN_WIDTH, MAX_COLUMN_WIDTH);
  const added = useDragResize(DEFAULT_WIDTHS.added, MIN_COLUMN_WIDTH, MAX_COLUMN_WIDTH);
  const fileType = useDragResize(DEFAULT_WIDTHS.file_type, MIN_COLUMN_WIDTH, MAX_COLUMN_WIDTH);
  const location = useDragResize(DEFAULT_WIDTHS.location, MIN_COLUMN_WIDTH, MAX_COLUMN_WIDTH);
  const venue = useDragResize(DEFAULT_WIDTHS.venue, MIN_COLUMN_WIDTH, MAX_COLUMN_WIDTH);
  const year = useDragResize(DEFAULT_WIDTHS.year, MIN_COLUMN_WIDTH, MAX_COLUMN_WIDTH);
  const doi = useDragResize(DEFAULT_WIDTHS.doi, MIN_COLUMN_WIDTH, MAX_COLUMN_WIDTH);

  const byKey: Record<ColumnKey, ReturnType<typeof useDragResize>> = {
    title,
    authors,
    added,
    file_type: fileType,
    location,
    venue,
    year,
    doi,
  };

  const widths: Record<ColumnKey, number> = {
    title: title.value,
    authors: authors.value,
    added: added.value,
    file_type: fileType.value,
    location: location.value,
    venue: venue.value,
    year: year.value,
    doi: doi.value,
  };

  function startResize(key: ColumnKey, e: React.PointerEvent) {
    byKey[key].startResize(e);
  }

  function handleKeyDown(key: ColumnKey, e: React.KeyboardEvent) {
    byKey[key].handleKeyDown(e);
  }

  return { widths, startResize, handleKeyDown };
}
