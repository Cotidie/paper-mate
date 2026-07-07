import { useCallback, useMemo, useState } from "react";
import type { CollectionRow, Folder } from "@/api/client";
import { COLUMNS, sortRows, type ColumnDef, type ColumnKey, type SortState } from "@/library/tableView";

/**
 * Owns the Library table's client-only view-state (Story 7.4, AD-L3): which
 * columns are hidden and the active sort. Never fetches or persists (matches
 * `useFolders`/`useInlineEdit`/`useMovePapers`). `applyTableView` is the one
 * place `LibraryPage` folds the sort onto the already folder-filtered rows;
 * it is `useCallback`-memoized on `[sort, folderNameById]` so `LibraryPage`'s
 * own `useMemo` only recomputes when the view actually changes (LNFR-4).
 * `folders` resolves the `location` column's sort (folder id -> name).
 */
export function useTableView(folders: Folder[] = []) {
  const [hiddenColumns, setHiddenColumns] = useState<Set<ColumnKey>>(new Set());
  const [sort, setSort] = useState<SortState | null>(null);
  const folderNameById = useMemo(() => new Map(folders.map((f) => [f.id, f.name])), [folders]);

  const toggleColumn = useCallback((key: ColumnKey) => {
    const def = COLUMNS.find((c) => c.key === key);
    if (!def?.hideable) return; // Title can never enter the hidden set (AC-1).
    setHiddenColumns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const visibleColumns = useMemo<ColumnDef[]>(
    () => COLUMNS.filter((c) => !hiddenColumns.has(c.key)),
    [hiddenColumns],
  );

  const applyTableView = useCallback(
    (rows: CollectionRow[]) => sortRows(rows, sort, folderNameById),
    [sort, folderNameById],
  );

  return { hiddenColumns, toggleColumn, visibleColumns, sort, setSort, applyTableView };
}
