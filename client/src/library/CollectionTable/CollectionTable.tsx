import { Fragment, useMemo, useState } from "react";
import type { CollectionRow, Folder } from "@/api/client";
import { currentFieldValue, type EditableField, type PendingUpload } from "@/library/row";
import { MOVE_DRAG_MIME, encodeDragIds } from "@/library/moveDrag";
import { COLUMNS, type ColumnDef, type ColumnKey, type SortState } from "@/library/tableView";
import { ColumnGroup, TableHead, sumColumnWidths } from "./ColumnHeader";
import TableSkeleton from "./TableSkeleton";
import { buildDragPreview } from "./dragPreview";
import { useColumnDrag } from "./useColumnDrag";
import { useRowSelection } from "./useRowSelection";
import PaperRow from "./PaperRow";
import PendingRow from "./PendingRow";
import "./CollectionTable.css";

const EMPTY_FOLDERS: Folder[] = [];

type CollectionTableProps =
  | {
      loading: true;
      rows?: never;
      onOpenRow?: never;
      pendingRows?: never;
      onEditField?: never;
      onCommitAuthors?: never;
      selectedIds?: never;
      onSelectionChange?: never;
      /** Defaults to every column (all `COLUMNS`) when omitted - existing
       *  isolated tests that don't care about Display/Sort keep working. */
      visibleColumns?: ColumnDef[];
      sort?: never;
      columnWidths?: Record<ColumnKey, number>;
    }
  | {
      loading?: false;
      rows: CollectionRow[];
      onOpenRow: (docId: string) => void;
      pendingRows?: PendingUpload[];
      onEditField: (docId: string, field: EditableField, value: string | null) => void;
      /** The one selection set (fix request: unifies the old single-armed
       *  `selectedId` and multi-select `checkedIds`, which never synced - see
       *  the component doc comment). Controlled like `<input value onChange>`:
       *  pass `selectedIds` to drive it from outside (LibraryPage does, so
       *  the toolbar's Move button and drag-to-folder see it); omit it and
       *  the table falls back to owning the set itself (used by isolated
       *  arm/edit tests that don't care about the toolbar). */
      selectedIds?: Set<string>;
      onSelectionChange?: (ids: Set<string>) => void;
      visibleColumns?: ColumnDef[];
      sort?: SortState | null;
      /** Column headers become clickable (Sort ASC/DESC, Hide)
       *  when both are supplied; omit for isolated tests that don't care. */
      onSortChange?: (next: SortState | null) => void;
      onToggleColumn?: (key: ColumnKey) => void;
      columnWidths?: Record<ColumnKey, number>;
      /** Column headers grow a drag/keyboard resize handle (fix request) when
       *  both are supplied; omit for isolated tests that don't care. */
      onResizeColumnStart?: (key: ColumnKey, e: React.PointerEvent) => void;
      onResizeColumnKeyDown?: (key: ColumnKey, e: React.KeyboardEvent) => void;
      /** Column headers grow drag-to-reorder (Story 7.10, AC-1) when supplied;
       *  omit for isolated tests that don't exercise reorder (same optional
       *  pattern as the resize callbacks above). */
      onReorderColumn?: (fromKey: ColumnKey, toKey: ColumnKey) => void;
      /** The Author tag editor's commit: the new full author list (AC-4).
       *  Omit for isolated tests that don't exercise the tag editor. */
      onCommitAuthors?: (docId: string, authors: string[]) => void;
      /** True in the Trash lens (Story 7.5): every row drops its Open button
       *  and its drag-to-folder affordance. Restore/Purge live in the
       *  toolbar, bulk over the selection (fix request), not per row. */
      trashLens?: boolean;
      /** Resolves the Location column's folder id -> name (post-review
       *  scope). Omit for isolated tests that don't render that column. */
      folders?: Folder[];
      /** Recent lens date-bucket headers (post-review scope): a `doc_id` ->
       *  bucket label, computed by `LibraryPage` via `recentGroupLabels`. A
       *  header row renders immediately before any row present here. Omit
       *  outside the Recent lens (or once a column sort is active) for a
       *  flat list, same as before this scope was added. */
      groupLabels?: Map<string, string>;
    };

/**
 * Library collection table: rows in, DOM out. Owns no fetch (AD-9:
 * `LibraryPage` fetches, this renders). Rendered in the response's `order`
 * (client sort is Story 7.4), with optimistic `pendingRows` (Story 6.4) above
 * them, newest batch first. A pending row is not yet a stored paper: no
 * `doc_id`, so it is not selectable, openable, or editable (see `PendingRow`).
 *
 * This shell composes the extracted concerns (Story 7.12): `useRowSelection`
 * (the one `selectedIds` set + the plain/Ctrl/Shift click model + the anchor +
 * the blur-vs-click suppression), `useColumnDrag` (the frozen-geometry
 * column-drag machine + the live-preview `displayColumns`), `TableHead`/
 * `TableSkeleton`/`ColumnGroup` (`ColumnHeader.tsx`), the `CELL_RENDERERS`
 * registry (`PaperRow`), and the row-move drag preview (`dragPreview.ts`). It
 * keeps only the editing cursor, the folder-name lookup, and the row-move
 * drag start, which read across two of those concerns at once.
 *
 * Selection detail lives in `useRowSelection`; the two views the shell derives
 * per row are `armed` (`selectedIds.size === 1 && selectedIds.has(id)`, gating
 * the inline-edit affordance) and `checked` (`selectedIds.has(id)`, the
 * highlight + drag payload). Opening a paper is a dedicated Open button in the
 * Title cell (`onOpenRow`, independent of selection). Inline editing reports
 * through `onEditField`; `LibraryPage` owns the `PATCH` + optimistic state.
 */
export default function CollectionTable(props: CollectionTableProps) {
  const visibleColumns = props.visibleColumns ?? COLUMNS;
  if (props.loading) {
    return <TableSkeleton visibleColumns={visibleColumns} columnWidths={props.columnWidths} />;
  }
  const {
    rows,
    onOpenRow,
    pendingRows = [],
    onEditField,
    sort = null,
    onSortChange,
    onToggleColumn,
    columnWidths,
    onResizeColumnStart,
    onResizeColumnKeyDown,
    onReorderColumn,
    onCommitAuthors = () => {},
    trashLens = false,
    folders = EMPTY_FOLDERS,
    groupLabels,
  } = props;
  const folderNameById = useMemo(() => new Map(folders.map((f) => [f.id, f.name])), [folders]);
  // Uncategorized (no folder, or a stale folder reference) renders an empty
  // cell (fix request) - `UNCATEGORIZED_LABEL` still names the sidebar's own
  // "Uncategorized" folder-panel entry and the sort key, just not this cell.
  function locationLabel(row: CollectionRow): string {
    return row.folder_id ? (folderNameById.get(row.folder_id) ?? "") : "";
  }

  const { selectedIds, commitSelected, handleRowClick, handleRowClickCapture, consumeSuppressedClick, suppressNextClick } =
    useRowSelection({ rows, selectedIds: props.selectedIds, onSelectionChange: props.onSelectionChange });

  const { tableRef, displayColumns, dropIndicator, handleColumnDragStart, handleColumnDragOverAt, handleColumnDragEnd, commitColumnDrop } =
    useColumnDrag({ visibleColumns, onReorderColumn });

  const [editing, setEditing] = useState<{ docId: string; field: EditableField | "authors" } | null>(null);

  function startEdit(docId: string, field: EditableField | "authors") {
    if (consumeSuppressedClick()) return;
    setEditing({ docId, field });
  }

  function openRow(docId: string) {
    if (consumeSuppressedClick()) return;
    onOpenRow(docId);
  }

  function commitEdit(row: CollectionRow, field: EditableField, value: string, viaBlur: boolean) {
    setEditing(null);
    if (viaBlur) suppressNextClick();
    const trimmed = value.trim();
    if (trimmed === currentFieldValue(row, field)) return; // AC-6: no-op guard
    onEditField(row.doc_id, field, trimmed || null); // AC-7: empty -> null
  }

  // The tag editor's commit (Story 7.11, AC-4): the no-op/never-lost guard
  // lives in `useAuthorsEdit` itself (it already has the prior list to
  // compare against). Unlike `commitEdit`, `TagEditor` only ever commits via
  // its own blur (Enter just appends a chip, it never closes the editor) -
  // so this is UNCONDITIONALLY a blur-commit, and must set the same
  // suppress-click guard `commitEdit(..., viaBlur=true)` does (Codex review,
  // Med): otherwise the very click that closes the editor also lands on
  // whatever it closed onto, re-arming/opening/toggling it (the documented
  // "click that finishes an edit shouldn't also chain into a new action"
  // class of bug - see `suppressClickRef`'s own doc comment).
  function commitAuthors(row: CollectionRow, authors: string[]) {
    setEditing(null);
    suppressNextClick();
    onCommitAuthors(row.doc_id, authors);
  }

  // The whole <tr> is draggable, so a drag gesture starting on the Open
  // button or an inline-edit input would otherwise still fire this (native
  // buttons/inputs don't block an ancestor's `draggable` by themselves) -
  // preventDefault bails out of the drag entirely rather than starting a
  // bogus row-move over a click/text-select gesture (code-review fix).
  function handleDragStart(e: React.DragEvent<HTMLTableRowElement>, docId: string) {
    if ((e.target as HTMLElement).closest("input, textarea, button, a, [contenteditable=true]")) {
      e.preventDefault();
      return;
    }
    const ids = selectedIds.has(docId) ? Array.from(selectedIds) : [docId];
    e.dataTransfer.setData(MOVE_DRAG_MIME, encodeDragIds(ids));
    e.dataTransfer.effectAllowed = "move";
    const preview = buildDragPreview(rows, ids);
    e.dataTransfer.setDragImage(preview, 12, 16);
    setTimeout(() => preview.remove(), 0);
  }

  return (
    <div className="collection-table-wrap">
      <table
        ref={tableRef}
        className="collection-table"
        style={{ width: sumColumnWidths(visibleColumns, columnWidths) }}
      >
        <ColumnGroup columns={displayColumns} widths={columnWidths} />
        <TableHead
          columns={displayColumns}
          sort={sort}
          onSortChange={onSortChange}
          onToggleColumn={onToggleColumn}
          onResizeStart={onResizeColumnStart}
          onResizeKeyDown={onResizeColumnKeyDown}
          onReorderColumn={onReorderColumn}
          dropIndicator={dropIndicator}
          onColumnDragStart={handleColumnDragStart}
          onColumnDragEnd={handleColumnDragEnd}
          onColumnDragOverAt={handleColumnDragOverAt}
          onColumnDrop={commitColumnDrop}
        />
        <tbody>
          {pendingRows.map((pending) => (
            <PendingRow key={pending.tempId} filename={pending.filename} visibleColumns={displayColumns} />
          ))}
          {rows.map((row) => {
            const groupLabel = groupLabels?.get(row.doc_id);
            return (
              <Fragment key={row.doc_id}>
                {groupLabel !== undefined && (
                  <tr className="collection-table__group-header">
                    <td colSpan={visibleColumns.length}>{groupLabel}</td>
                  </tr>
                )}
                <PaperRow
                  row={row}
                  visibleColumns={displayColumns}
                  armed={selectedIds.size === 1 && selectedIds.has(row.doc_id)}
                  editingField={editing?.docId === row.doc_id ? editing.field : null}
                  checked={selectedIds.has(row.doc_id)}
                  onRowClick={() => handleRowClick(row.doc_id)}
                  onRowClickCapture={(e) => handleRowClickCapture(e, row.doc_id)}
                  onArm={() => commitSelected(new Set([row.doc_id]))}
                  onOpen={() => openRow(row.doc_id)}
                  onDragStart={(e) => handleDragStart(e, row.doc_id)}
                  onStartEdit={(field) => startEdit(row.doc_id, field)}
                  onCommit={(field, value, viaBlur) => commitEdit(row, field, value, viaBlur)}
                  onCancel={() => setEditing(null)}
                  onCommitAuthors={(authors) => commitAuthors(row, authors)}
                  trashLens={trashLens}
                  locationLabel={locationLabel(row)}
                />
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
