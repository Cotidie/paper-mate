import { useCallback, useMemo, useState } from "react";
import type { CollectionRow, Folder } from "@/api/client";
import {
  applyTagFilter,
  COLUMNS,
  sortRows,
  type ColumnDef,
  type ColumnKey,
  type SortState,
} from "@/library/tableView";
import { useTableViewPrefs } from "@/library/tableViewPrefs";

/**
 * Owns the Library table's client-only view-state (Story 7.4, AD-L3) plus,
 * as of Story 7.10, the PERSISTED column layout: order + visibility live in
 * `tableViewPrefs` (a `localStorage`-backed Zustand store); the active sort
 * stays local `useState` here and is NOT persisted (re-sort per session).
 * `applyTableView` is the one place `LibraryPage` folds the sort onto the
 * already folder-filtered rows; it is `useCallback`-memoized on `[sort,
 * folderNameById]` so `LibraryPage`'s own `useMemo` only recomputes when the
 * view actually changes (LNFR-4). `folders` resolves the `location`
 * column's sort (folder id -> name).
 */
export function useTableView(folders: Folder[] = []) {
  const order = useTableViewPrefs((s) => s.order);
  const hidden = useTableViewPrefs((s) => s.hidden);
  const toggleHidden = useTableViewPrefs((s) => s.toggleHidden);
  const moveColumn = useTableViewPrefs((s) => s.moveColumn);
  const reorderColumns = useTableViewPrefs((s) => s.reorderColumns);
  const [sort, setSort] = useState<SortState | null>(null);
  // The author-tag filter (Story 7.11, AC-5): a peer of `sort`, ephemeral
  // client view-state (AD-L3, not persisted - unlike order/hidden above).
  const [authorFilter, setAuthorFilter] = useState<string | null>(null);
  const folderNameById = useMemo(() => new Map(folders.map((f) => [f.id, f.name])), [folders]);

  // Title can never enter the hidden set (AC-4): `tableViewPrefs.toggleHidden`
  // itself guards it, so this is a thin passthrough kept for the existing
  // `toggleColumn` call sites (`CollectionTable`, `DisplayMenu`).
  const toggleColumn = useCallback((key: ColumnKey) => toggleHidden(key), [toggleHidden]);

  const hiddenColumns = useMemo(() => new Set(hidden), [hidden]);

  const visibleColumns = useMemo<ColumnDef[]>(
    () => order.filter((k) => !hiddenColumns.has(k)).map((k) => COLUMNS.find((c) => c.key === k)!),
    [order, hiddenColumns],
  );

  const applyTableView = useCallback(
    (rows: CollectionRow[]) => sortRows(applyTagFilter(rows, authorFilter), sort, folderNameById),
    [authorFilter, sort, folderNameById],
  );

  return {
    hiddenColumns,
    toggleColumn,
    visibleColumns,
    sort,
    setSort,
    authorFilter,
    setAuthorFilter,
    applyTableView,
    moveColumn,
    reorderColumns,
  };
}
