import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CaretDown, CaretUp, EyeSlash, X } from "@phosphor-icons/react";
import type { CollectionRow } from "@/api/client";
import { currentFieldValue, stripPdfExtension, type EditableField, type PendingUpload } from "@/library/row";
import { MOVE_DRAG_MIME, encodeDragIds } from "@/library/moveDrag";
import { COLUMNS, type ColumnDef, type ColumnKey, type SortState } from "@/library/tableView";
import { usePopover } from "@/library/usePopover";
import PaperRow from "./PaperRow";
import PendingRow from "./PendingRow";
import "./CollectionTable.css";
import "@/library/TableControls/TableControls.css";

const SKELETON_ROW_COUNT = 6;
const EMPTY_SELECTED: Set<string> = new Set();

/** `file_type`'s CSS class suffix drops the underscore (`col-file-type`);
 *  every other key is already a valid class-name segment. */
function columnClassSuffix(key: ColumnKey): string {
  return key === "file_type" ? "file-type" : key;
}

/** `aria-sort` for a sortable column's `<th>` (fix request: the visual caret
 *  was `aria-hidden`, leaving screen readers with no way to tell which
 *  column is sorted or in which direction). */
function ariaSortValue(col: ColumnDef, sort: SortState | null): "ascending" | "descending" | "none" | undefined {
  if (!col.sortable) return undefined;
  if (sort?.column !== col.key) return "none";
  return sort.direction === "asc" ? "ascending" : "descending";
}

/** The table's own width, in `table-layout: fixed` (fix request: resizing
 *  one column was also resizing the others). With `width: 100%` and `<col>`
 *  widths that don't sum to the table's rendered width, the browser treats
 *  each `<col>`'s pixel value as a PROPORTION to rescale, not a literal size
 *  - so narrowing one column visibly widened another even though its own
 *  state never changed. Sizing the table itself to the exact sum makes each
 *  `<col>` width literal (sum == table width, nothing left to redistribute).
 *  Omitted (falls back to the CSS `width: 100%` default) when no explicit
 *  `columnWidths` are supplied. */
function sumColumnWidths(columns: ColumnDef[], widths?: Record<ColumnKey, number>): number | undefined {
  if (!widths) return undefined;
  return columns.reduce((total, col) => total + widths[col.key], 0);
}

/**
 * A compact custom HTML5 drag image (fix request), built fresh per
 * `dragstart` as a detached DOM node: the browser default is to snapshot the
 * WHOLE dragged element, which for a `<tr>` means the full table width -
 * ugly and unreadable. Mirrors Google Drive's small filename chip + a count
 * badge when more than one item is dragged. Appended off-screen (see
 * `.collection-table__drag-preview`'s `position: fixed; top/left: -9999px`)
 * so the browser can rasterize it before `setDragImage` is called; the
 * caller removes it on the next tick (must still exist at the moment
 * `setDragImage` runs, but the OS-level snapshot is captured synchronously).
 */
function buildDragPreview(rows: CollectionRow[], ids: string[]): HTMLElement {
  const byId = new Map(rows.map((r) => [r.doc_id, r]));
  const primary = byId.get(ids[0]);
  const title =
    primary?.title ?? (primary?.filename ? stripPdfExtension(primary.filename) : "Untitled");

  const el = document.createElement("div");
  el.className = "collection-table__drag-preview";
  el.textContent = title;

  if (ids.length > 1) {
    const badge = document.createElement("span");
    badge.className = "collection-table__drag-preview-badge";
    badge.textContent = String(ids.length);
    el.appendChild(badge);
  }

  document.body.appendChild(el);
  return el;
}

/** `widths` overrides each column's CSS-default width (fix request:
 *  drag-to-resize) - omitted, the `<col>` falls back to its
 *  `--collection-table-*-width` CSS token. */
function ColumnGroup({ columns, widths }: { columns: ColumnDef[]; widths?: Record<ColumnKey, number> }) {
  return (
    <colgroup>
      {columns.map((col) => (
        <col
          key={col.key}
          className={`collection-table__col-${columnClassSuffix(col.key)}`}
          style={widths ? { width: widths[col.key] } : undefined}
        />
      ))}
    </colgroup>
  );
}

/** A clickable header: opens a per-column dropdown (Sort ASC/DESC,
 *  Hide) mirroring the reference product's column-header menu. Each instance
 *  owns its own `usePopover` so multiple headers can each have (only one at a
 *  time, per-instance) open state. Closes on pick - a one-shot action menu,
 *  like `MoveMenu`, not a stays-open toggle panel like `DisplayMenu`. */
function ColumnHeaderCell({
  col,
  sort,
  onSortChange,
  onToggleColumn,
  onResizeStart,
  onResizeKeyDown,
}: {
  col: ColumnDef;
  sort: SortState | null;
  onSortChange: (next: SortState | null) => void;
  onToggleColumn: (key: ColumnKey) => void;
  onResizeStart?: (key: ColumnKey, e: React.PointerEvent) => void;
  onResizeKeyDown?: (key: ColumnKey, e: React.KeyboardEvent) => void;
}) {
  const { anchor, buttonRef, popoverRef, toggle, close } = usePopover();
  const active = sort?.column === col.key;
  return (
    <th scope="col" className="collection-table__th--interactive" aria-sort={ariaSortValue(col, sort)}>
      <button
        ref={buttonRef}
        type="button"
        className="collection-table__header-button"
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        onClick={(e) => {
          e.stopPropagation();
          toggle();
        }}
        onKeyDown={(e) => {
          if (e.key !== "Escape") e.stopPropagation();
        }}
      >
        {col.label}
        {active &&
          (sort!.direction === "asc" ? (
            <CaretUp aria-hidden className="collection-table__sort-caret" />
          ) : (
            <CaretDown aria-hidden className="collection-table__sort-caret" />
          ))}
      </button>
      {anchor &&
        createPortal(
          <div
            ref={popoverRef}
            className="table-control__popover"
            role="menu"
            style={{ top: anchor.top, left: anchor.left }}
          >
            <button
              type="button"
              role="menuitem"
              className="table-control__item"
              onClick={(e) => {
                e.stopPropagation();
                close();
                onSortChange({ column: col.key, direction: "asc" });
              }}
            >
              <CaretUp aria-hidden />
              Sort ASC
            </button>
            <button
              type="button"
              role="menuitem"
              className="table-control__item"
              onClick={(e) => {
                e.stopPropagation();
                close();
                onSortChange({ column: col.key, direction: "desc" });
              }}
            >
              <CaretDown aria-hidden />
              Sort DESC
            </button>
            {active && (
              <button
                type="button"
                role="menuitem"
                className="table-control__item"
                onClick={(e) => {
                  e.stopPropagation();
                  close();
                  onSortChange(null);
                }}
              >
                <X aria-hidden />
                Clear sort
              </button>
            )}
            {col.hideable && (
              <button
                type="button"
                role="menuitem"
                className="table-control__item"
                onClick={(e) => {
                  e.stopPropagation();
                  close();
                  onToggleColumn(col.key);
                }}
              >
                <EyeSlash aria-hidden />
                Hide
              </button>
            )}
          </div>,
          document.body,
        )}
      {onResizeStart && onResizeKeyDown && (
        <span
          className="collection-table__col-resize-handle"
          role="separator"
          aria-orientation="vertical"
          aria-label={`Resize ${col.label} column`}
          tabIndex={0}
          onPointerDown={(e) => onResizeStart(col.key, e)}
          onKeyDown={(e) => onResizeKeyDown(col.key, e)}
        />
      )}
    </th>
  );
}

/** Renders the active sort column's caret. Headers are clickable
 *  (`ColumnHeaderCell`) when `onSortChange`/`onToggleColumn` are supplied;
 *  otherwise (the loading skeleton) they render as plain static text. */
function TableHead({
  columns,
  sort,
  onSortChange,
  onToggleColumn,
  onResizeStart,
  onResizeKeyDown,
}: {
  columns: ColumnDef[];
  sort: SortState | null;
  onSortChange?: (next: SortState | null) => void;
  onToggleColumn?: (key: ColumnKey) => void;
  onResizeStart?: (key: ColumnKey, e: React.PointerEvent) => void;
  onResizeKeyDown?: (key: ColumnKey, e: React.KeyboardEvent) => void;
}) {
  return (
    <thead>
      <tr>
        {columns.map((col) =>
          onSortChange && onToggleColumn ? (
            <ColumnHeaderCell
              key={col.key}
              col={col}
              sort={sort}
              onSortChange={onSortChange}
              onToggleColumn={onToggleColumn}
              onResizeStart={onResizeStart}
              onResizeKeyDown={onResizeKeyDown}
            />
          ) : (
            <th key={col.key} scope="col" aria-sort={ariaSortValue(col, sort)}>
              {col.label}
              {sort?.column === col.key &&
                (sort.direction === "asc" ? (
                  <CaretUp aria-hidden className="collection-table__sort-caret" />
                ) : (
                  <CaretDown aria-hidden className="collection-table__sort-caret" />
                ))}
            </th>
          ),
        )}
      </tr>
    </thead>
  );
}

function TableSkeleton({
  visibleColumns,
  columnWidths,
}: {
  visibleColumns: ColumnDef[];
  columnWidths?: Record<ColumnKey, number>;
}) {
  return (
    <div className="collection-table-wrap">
      <table
        className="collection-table"
        aria-busy="true"
        style={{ width: sumColumnWidths(visibleColumns, columnWidths) }}
      >
        <ColumnGroup columns={visibleColumns} widths={columnWidths} />
        <TableHead columns={visibleColumns} sort={null} />
        <tbody>
          {Array.from({ length: SKELETON_ROW_COUNT }, (_, i) => (
            <tr key={i} className="collection-table__skeleton-row">
              {visibleColumns.map((col) => (
                <td key={col.key}>
                  <span className="collection-table__skeleton-cell" />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type CollectionTableProps =
  | {
      loading: true;
      rows?: never;
      onOpenRow?: never;
      pendingRows?: never;
      onEditField?: never;
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
      /** True in the Trash lens (Story 7.5): every row drops its Open button
       *  and its drag-to-folder affordance. Restore/Purge live in the
       *  toolbar, bulk over the selection (fix request), not per row. */
      trashLens?: boolean;
    };

/**
 * Library collection table: rows in, DOM out. Owns no fetch (AD-9:
 * `LibraryPage` fetches, this renders). Rendered in the response's `order`
 * (client sort is Story 7.4), with optimistic `pendingRows` (Story 6.4) above
 * them, newest batch first. A pending row is not yet a stored paper: no
 * `doc_id`, so it is not selectable, openable, or editable (see `PendingRow`).
 *
 * Selection is ONE set, `selectedIds` (fix request: this used to be two
 * disjoint pieces of state - a table-local single `selectedId` for a
 * plain-click arm, and a lifted `checkedIds` for Ctrl/Cmd+click multi-select -
 * that never synced. A plain click after a multi-select only ever touched
 * `selectedId`, so the old checked rows stayed highlighted; and the
 * toolbar's Move button only ever read `checkedIds`, so a single armed row
 * could never be moved). Two views derive from the one set per row: `armed`
 * (`selectedIds.size === 1 && selectedIds.has(id)`) gates the Title/Authors
 * inline-edit affordance and is exclusive to a lone selection; `checked`
 * (`selectedIds.has(id)`) drives the highlight (shared CSS rule, both read as
 * "this row is selected") and the drag-to-folder payload. Three gestures
 * write the set: a plain row click REPLACES it with just that row (or clears
 * it, if that row was already the sole selection - a toggle-off), and moves
 * the selection anchor to that row; Ctrl/Cmd+click toggles ONE row's
 * membership (moving the anchor only on a toggle-ON); Shift+click REPLACES
 * the set with the inclusive range between the anchor and the clicked row
 * (by index into the rendered `rows` order), without moving the anchor, so
 * successive Shift+clicks re-range from the same pivot (Finder/Explorer
 * semantics). All three are intercepted at the row's CAPTURE phase so they
 * never also arm/edit/open the row; Shift+click also `preventDefault`s to
 * suppress the browser's native shift-extends-text-selection sweep. The
 * anchor resets to `null` whenever the set is emptied from outside (folder
 * switch, post-move clear) so a stale pivot can't leak a range across views.
 * Opening a paper is a dedicated Open button in the Title cell (calls
 * `onOpenRow` directly, independent of selection). Inline editing reports
 * through `onEditField`; `LibraryPage` owns the `PATCH` + optimistic state
 * (same split as `onOpenRow`). The editing cursor and the selection anchor
 * both stay local UI state since nothing outside the table needs them.
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
    trashLens = false,
  } = props;
  const visibleKeys = new Set(visibleColumns.map((c) => c.key));
  // Controlled-or-uncontrolled (like `<input value onChange>`): when the
  // caller doesn't pass `selectedIds`, the table owns the set itself so
  // isolated tests of the arm/edit flow don't need to wire a selection
  // controller they don't care about.
  const [internalSelected, setInternalSelected] = useState<Set<string>>(EMPTY_SELECTED);
  const selectedIds = props.selectedIds ?? internalSelected;
  function commitSelected(next: Set<string>) {
    if (props.selectedIds === undefined) setInternalSelected(next);
    props.onSelectionChange?.(next);
  }
  // The Shift+click range pivot: the row last plain-clicked or Ctrl/Cmd
  // toggled-on. A ref, not state - read synchronously inside the click
  // handler and never needs to trigger its own render (the visible selection
  // re-renders via `selectedIds`). Table-local because a range is defined
  // over the CURRENTLY RENDERED `rows` order, which only the table has.
  const anchorRef = useRef<string | null>(null);
  // `LibraryPage` clears `selectedIds` from outside (folder switch, post-move)
  // - the table can't know to drop its pivot except by observing the
  // emptied set, so without a stale anchor could range from a paper that is
  // no longer where the user thinks it is.
  useEffect(() => {
    if (selectedIds.size === 0) anchorRef.current = null;
  }, [selectedIds]);
  const [editing, setEditing] = useState<{ docId: string; field: EditableField } | null>(null);
  // A click that lands elsewhere while a cell is being edited blurs the
  // InlineEditor (auto-committing it) BEFORE the click event itself is
  // dispatched — without a guard, the SAME click that closes one field's
  // edit would immediately arm/edit/open whatever it landed on (fix
  // request: clicking away should only finish editing, not chain into a
  // new action). Set true only inside the actual blur-commit path
  // (`commitEdit(..., viaBlur=true)`) — never on a bare mousedown, which
  // would also fire for an unrelated mousedown *inside* the still-focused
  // input (e.g. repositioning the caret) and could then wrongly swallow a
  // later, unrelated keyboard-triggered action (no mousedown precedes a
  // keyboard Enter/Space activation, so a mousedown-based guard could go
  // stale and eat it). Consumed (checked-and-reset) by the gesture handlers.
  const suppressClickRef = useRef(false);

  // Consume a pending blur-commit suppression: true means "this gesture is the
  // click that just finished an edit; swallow it once". Returns whether it was
  // suppressed so the caller can bail.
  function consumeSuppressedClick(): boolean {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return true;
    }
    return false;
  }

  // A plain click always REPLACES the selection with just this row (fix
  // request: previously this only updated a separate `selectedId`, leaving
  // any Ctrl/Cmd-checked rows from a prior multi-select still highlighted).
  // Clicking the row that is already the sole selection toggles it off.
  function handleRowClick(docId: string) {
    if (consumeSuppressedClick()) return;
    const isSoleSelected = selectedIds.size === 1 && selectedIds.has(docId);
    if (isSoleSelected) {
      anchorRef.current = null;
      commitSelected(new Set());
    } else {
      anchorRef.current = docId;
      commitSelected(new Set([docId]));
    }
  }

  // Ctrl/Cmd+click toggles multi-select; Shift+click replaces the selection
  // with the inclusive range from the anchor. Both fire in the CAPTURE phase
  // (before the Title/Authors cells' own bubble-phase click handlers), so
  // `stopPropagation` here keeps them from ALSO arming the row, entering edit
  // mode, or opening the reader.
  function handleRowClickCapture(e: React.MouseEvent<HTMLTableRowElement>, docId: string) {
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      // The Title/Authors <td> is tabIndex=0 (EditableCell's Enter-to-edit
      // keyboard path). The browser's native mousedown default already
      // focused it, if the click landed there, before this click handler
      // ever runs - preventDefault/stopPropagation on the click event can't
      // retroactively undo a mousedown-time focus change. Left alone, a
      // modifier-click leaves a stray focus ring on the cell, and a later
      // bare Enter on it would fire onArm() and collapse the whole
      // selection back to one row (armed is false during a multi-select, so
      // EditableCell's onKeyDown treats Enter as "arm", not "edit"). Blur
      // it back off, scoped to this row so an unrelated focused element
      // elsewhere on the page is never touched.
      const active = document.activeElement;
      if (active instanceof HTMLElement && e.currentTarget.contains(active)) active.blur();
    }
    if (e.shiftKey) {
      e.stopPropagation();
      // Browser default: Shift+click extends the native text selection to
      // the click point, which across table cells paints an ugly blue sweep.
      // `stopPropagation` doesn't stop it (it's the browser default action,
      // not a React handler) - `preventDefault` does.
      e.preventDefault();
      const anchorIdx =
        anchorRef.current === null ? -1 : rows.findIndex((r) => r.doc_id === anchorRef.current);
      if (anchorIdx === -1) {
        // No pivot, or the pivot was filtered out of the current view:
        // degrade to a plain single-select rather than a no-op.
        anchorRef.current = docId;
        commitSelected(new Set([docId]));
        return;
      }
      const targetIdx = rows.findIndex((r) => r.doc_id === docId);
      const [start, end] =
        anchorIdx <= targetIdx ? [anchorIdx, targetIdx] : [targetIdx, anchorIdx];
      // Anchor never moves here (AC-2): successive Shift+clicks re-range
      // from the same pivot.
      commitSelected(new Set(rows.slice(start, end + 1).map((r) => r.doc_id)));
      return;
    }
    if (!e.ctrlKey && !e.metaKey) return;
    e.stopPropagation();
    const next = new Set(selectedIds);
    if (next.has(docId)) {
      next.delete(docId);
    } else {
      next.add(docId);
      anchorRef.current = docId;
    }
    commitSelected(next);
  }

  function startEdit(docId: string, field: EditableField) {
    if (consumeSuppressedClick()) return;
    setEditing({ docId, field });
  }

  function openRow(docId: string) {
    if (consumeSuppressedClick()) return;
    onOpenRow(docId);
  }

  function commitEdit(row: CollectionRow, field: EditableField, value: string, viaBlur: boolean) {
    setEditing(null);
    if (viaBlur) suppressClickRef.current = true;
    const trimmed = value.trim();
    if (trimmed === currentFieldValue(row, field)) return; // AC-6: no-op guard
    onEditField(row.doc_id, field, trimmed || null); // AC-7: empty -> null
  }

  // The whole <tr> is draggable, so a drag gesture starting on the Open
  // button or an inline-edit input would otherwise still fire this (native
  // buttons/inputs don't block an ancestor's `draggable` by themselves) -
  // preventDefault bails out of the drag entirely rather than starting a
  // bogus row-move over a click/text-select gesture (code-review fix).
  function handleDragStart(e: React.DragEvent<HTMLTableRowElement>, docId: string) {
    if ((e.target as HTMLElement).closest("input, textarea, button, [contenteditable=true]")) {
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
      <table className="collection-table" style={{ width: sumColumnWidths(visibleColumns, columnWidths) }}>
        <ColumnGroup columns={visibleColumns} widths={columnWidths} />
        <TableHead
          columns={visibleColumns}
          sort={sort}
          onSortChange={onSortChange}
          onToggleColumn={onToggleColumn}
          onResizeStart={onResizeColumnStart}
          onResizeKeyDown={onResizeColumnKeyDown}
        />
        <tbody>
          {pendingRows.map((pending) => (
            <PendingRow key={pending.tempId} filename={pending.filename} visibleColumns={visibleKeys} />
          ))}
          {rows.map((row) => (
            <PaperRow
              key={row.doc_id}
              row={row}
              visibleColumns={visibleKeys}
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
              trashLens={trashLens}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
