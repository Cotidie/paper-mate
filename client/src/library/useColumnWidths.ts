import { useDragResize } from "@/library/useDragResize";
import { useTableViewPrefs } from "@/library/tableViewPrefs";
import { MAX_COLUMN_WIDTH, MIN_COLUMN_WIDTH, type ColumnKey } from "@/library/tableView";

/** Matches the `--collection-table-*-width` tokens (each column's default,
 *  pre-resize, width) - the fallback used when a column has no persisted
 *  width yet (Story 7.10 AC-3/AC-5: `tableViewPrefs.widths` seeds instead,
 *  once a resize has settled). */
const DEFAULT_WIDTHS: Record<ColumnKey, number> = {
  title: 320,
  authors: 220,
  added: 120,
  file_type: 96,
  location: 140,
  venue_short: 120,
  venue: 200,
  year: 80,
  doi: 200,
};
const KEYBOARD_STEP = 16;

/**
 * Drag-to-resize for the Library table's columns (fix request), persisted as
 * of Story 7.10: each column's initial value seeds from the persisted
 * `tableViewPrefs.widths[key]` when present, else `DEFAULT_WIDTHS[key]`; a
 * SETTLED resize (drag pointerup, or each keyboard step) writes the value
 * back via `tableViewPrefs.setWidth` (`useDragResize`'s `onCommit`, never a
 * per-frame drag value). `COLUMNS` is a small, fixed, compile-time-known set,
 * so one `useDragResize` call per column key is a static call count
 * (satisfies the rules of hooks) rather than a loop. The store is read via
 * `getState()` (not the subscribing hook form) because it only needs to seed
 * each `useDragResize`'s ONE-TIME initial value - `useState(initial)` ignores
 * the argument on every render after the first, so there is nothing to
 * subscribe to here.
 */
export function useColumnWidths() {
  const persisted = useTableViewPrefs.getState().widths;
  const setWidth = useTableViewPrefs((s) => s.setWidth);

  const title = useDragResize(
    persisted.title ?? DEFAULT_WIDTHS.title,
    MIN_COLUMN_WIDTH,
    MAX_COLUMN_WIDTH,
    KEYBOARD_STEP,
    (v) => setWidth("title", v),
  );
  const authors = useDragResize(
    persisted.authors ?? DEFAULT_WIDTHS.authors,
    MIN_COLUMN_WIDTH,
    MAX_COLUMN_WIDTH,
    KEYBOARD_STEP,
    (v) => setWidth("authors", v),
  );
  const added = useDragResize(
    persisted.added ?? DEFAULT_WIDTHS.added,
    MIN_COLUMN_WIDTH,
    MAX_COLUMN_WIDTH,
    KEYBOARD_STEP,
    (v) => setWidth("added", v),
  );
  const fileType = useDragResize(
    persisted.file_type ?? DEFAULT_WIDTHS.file_type,
    MIN_COLUMN_WIDTH,
    MAX_COLUMN_WIDTH,
    KEYBOARD_STEP,
    (v) => setWidth("file_type", v),
  );
  const location = useDragResize(
    persisted.location ?? DEFAULT_WIDTHS.location,
    MIN_COLUMN_WIDTH,
    MAX_COLUMN_WIDTH,
    KEYBOARD_STEP,
    (v) => setWidth("location", v),
  );
  const venueShort = useDragResize(
    persisted.venue_short ?? DEFAULT_WIDTHS.venue_short,
    MIN_COLUMN_WIDTH,
    MAX_COLUMN_WIDTH,
    KEYBOARD_STEP,
    (v) => setWidth("venue_short", v),
  );
  const venue = useDragResize(
    persisted.venue ?? DEFAULT_WIDTHS.venue,
    MIN_COLUMN_WIDTH,
    MAX_COLUMN_WIDTH,
    KEYBOARD_STEP,
    (v) => setWidth("venue", v),
  );
  const year = useDragResize(
    persisted.year ?? DEFAULT_WIDTHS.year,
    MIN_COLUMN_WIDTH,
    MAX_COLUMN_WIDTH,
    KEYBOARD_STEP,
    (v) => setWidth("year", v),
  );
  const doi = useDragResize(
    persisted.doi ?? DEFAULT_WIDTHS.doi,
    MIN_COLUMN_WIDTH,
    MAX_COLUMN_WIDTH,
    KEYBOARD_STEP,
    (v) => setWidth("doi", v),
  );

  const byKey: Record<ColumnKey, ReturnType<typeof useDragResize>> = {
    title,
    authors,
    added,
    file_type: fileType,
    location,
    venue_short: venueShort,
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
    venue_short: venueShort.value,
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
