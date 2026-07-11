import { createPortal } from "react-dom";
import { CaretDown, CaretUp, EyeSlash, X } from "@phosphor-icons/react";
import { usePopover } from "@/library/usePopover";
import type { ColumnDef, ColumnKey, SortState } from "@/library/tableView";
import { COLUMN_DRAG_MIME, buildColumnDragPreview } from "./dragPreview";
import "./CollectionTable.css";
import "@/library/TableControls/TableControls.css";

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
export function sumColumnWidths(columns: ColumnDef[], widths?: Record<ColumnKey, number>): number | undefined {
  if (!widths) return undefined;
  return columns.reduce((total, col) => total + widths[col.key], 0);
}

/** `widths` overrides each column's CSS-default width (fix request:
 *  drag-to-resize) - omitted, the `<col>` falls back to its
 *  `--collection-table-*-width` CSS token. */
export function ColumnGroup({ columns, widths }: { columns: ColumnDef[]; widths?: Record<ColumnKey, number> }) {
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

/** A clickable header: opens a per-column dropdown (Sort ASC/DESC, Hide)
 *  mirroring the reference product's column-header menu. Each instance owns
 *  its own `usePopover` so multiple headers can each have (only one at a time,
 *  per-instance) open state. Closes on pick - a one-shot action menu, like
 *  `MoveMenu`, not a stays-open toggle panel like `DisplayMenu`.
 *
 *  Drag-to-reorder (Story 7.10, AC-1): every column except Title is
 *  `draggable`, using a dedicated `COLUMN_DRAG_MIME` payload (mirrors the
 *  row-move drag) and a compact drag preview. Dragging one header over
 *  another shows a drop indicator (`data-drop-target`, "before" or "after"
 *  depending on drag direction - matches `reorderColumns`'s array-move
 *  semantics, see `CollectionTable`'s `dropIndicator` memo) and calls
 *  `onReorderColumn` on drop - the drag affordance is omitted when
 *  `onReorderColumn` isn't supplied (same optional-prop pattern as
 *  `onResizeStart`), so isolated tests that don't exercise reorder see no new
 *  draggable surface. Title is never a drag source or a drop target: nothing
 *  drops before it (the reorder helpers also clamp this, but excluding Title
 *  here keeps the affordance honest - hovering it never implies a drop
 *  there). */
function ColumnHeaderCell({
  col,
  sort,
  onSortChange,
  onToggleColumn,
  onResizeStart,
  onResizeKeyDown,
  onReorderColumn,
  dropIndicator,
  onColumnDragStart,
  onColumnDragEnd,
  onColumnDragOverAt,
  onColumnDrop,
}: {
  col: ColumnDef;
  sort: SortState | null;
  onSortChange: (next: SortState | null) => void;
  onToggleColumn: (key: ColumnKey) => void;
  onResizeStart?: (key: ColumnKey, e: React.PointerEvent) => void;
  onResizeKeyDown?: (key: ColumnKey, e: React.KeyboardEvent) => void;
  onReorderColumn?: (fromKey: ColumnKey, toKey: ColumnKey) => void;
  /** Set when `CollectionTable` has resolved THIS column as the live-preview
   *  drop target (fix request: driven by lifted state, not local "did
   *  dragover fire on me" tracking - see the module doc comment above for
   *  why element-based hit-testing oscillates), and which SIDE the dragged
   *  column will land on - "after" for a forward drag, "before" for a
   *  backward one, matching `reorderColumns`'s own array-move semantics
   *  exactly (fix request: this used to always render "before", which
   *  visibly pointed at the wrong edge for a forward drag). */
  dropIndicator: "before" | "after" | null;
  onColumnDragStart?: (key: ColumnKey) => void;
  onColumnDragEnd?: () => void;
  /** Reports the pointer's raw `clientX`, NOT this header's own key -
   *  `CollectionTable` resolves the actual target itself against a frozen
   *  geometry snapshot (fix request, see module doc comment). */
  onColumnDragOverAt?: (clientX: number) => void;
  /** The actual reorder commit (fix request): fires with no args - the
   *  fromKey/toKey are already known to `CollectionTable` from its own
   *  lifted drag state, which is the single source of truth the live
   *  preview already rendered from. */
  onColumnDrop?: () => void;
}) {
  const { anchor, buttonRef, popoverRef, toggle, close } = usePopover();
  const active = sort?.column === col.key;
  const reorderable = col.key !== "title";

  function handleColumnDragStart(e: React.DragEvent<HTMLTableCellElement>) {
    e.dataTransfer.setData(COLUMN_DRAG_MIME, col.key);
    e.dataTransfer.effectAllowed = "move";
    const preview = buildColumnDragPreview(col.label);
    e.dataTransfer.setDragImage(preview, 12, 16);
    setTimeout(() => preview.remove(), 0);
    onColumnDragStart?.(col.key);
  }

  function handleColumnDragOver(e: React.DragEvent<HTMLTableCellElement>) {
    if (!e.dataTransfer.types.includes(COLUMN_DRAG_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    onColumnDragOverAt?.(e.clientX);
  }

  function handleColumnDrop(e: React.DragEvent<HTMLTableCellElement>) {
    e.preventDefault();
    onColumnDrop?.();
  }

  const dragEnabled = reorderable && Boolean(onReorderColumn);
  return (
    <th
      scope="col"
      className="collection-table__th--interactive"
      aria-sort={ariaSortValue(col, sort)}
      draggable={dragEnabled}
      data-column-key={col.key}
      data-drop-target={dropIndicator ?? undefined}
      onDragStart={dragEnabled ? handleColumnDragStart : undefined}
      onDragOver={dragEnabled ? handleColumnDragOver : undefined}
      onDragEnter={dragEnabled ? handleColumnDragOver : undefined}
      onDragEnd={dragEnabled ? onColumnDragEnd : undefined}
      onDrop={dragEnabled ? handleColumnDrop : undefined}
    >
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
export function TableHead({
  columns,
  sort,
  onSortChange,
  onToggleColumn,
  onResizeStart,
  onResizeKeyDown,
  onReorderColumn,
  dropIndicator,
  onColumnDragStart,
  onColumnDragEnd,
  onColumnDragOverAt,
  onColumnDrop,
}: {
  columns: ColumnDef[];
  sort: SortState | null;
  onSortChange?: (next: SortState | null) => void;
  onToggleColumn?: (key: ColumnKey) => void;
  onResizeStart?: (key: ColumnKey, e: React.PointerEvent) => void;
  onResizeKeyDown?: (key: ColumnKey, e: React.KeyboardEvent) => void;
  onReorderColumn?: (fromKey: ColumnKey, toKey: ColumnKey) => void;
  dropIndicator?: { key: ColumnKey; side: "before" | "after" } | null;
  onColumnDragStart?: (key: ColumnKey) => void;
  onColumnDragEnd?: () => void;
  onColumnDragOverAt?: (clientX: number) => void;
  onColumnDrop?: () => void;
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
              onReorderColumn={onReorderColumn}
              dropIndicator={dropIndicator?.key === col.key ? dropIndicator.side : null}
              onColumnDragStart={onColumnDragStart}
              onColumnDragEnd={onColumnDragEnd}
              onColumnDragOverAt={onColumnDragOverAt}
              onColumnDrop={onColumnDrop}
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
