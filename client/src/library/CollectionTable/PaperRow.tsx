import type { CollectionRow } from "@/api/client";
import {
  formatAdded,
  rowStatusClass,
  seedFieldValue,
  statusLabel,
  stripPdfExtension,
  type EditableField,
} from "@/library/row";
import type { ColumnKey } from "@/library/tableView";
import EditableCell from "./EditableCell";

/**
 * One settled row of the collection table. A plain row click selects only
 * this row (`armed`, purely visual, `aria-selected`); the Title cell reveals
 * an Open button on hover/focus (independent of selection). Title/Authors
 * cells inline-edit once the row is armed (see `EditableCell`) - armed is
 * exclusive to a LONE selection (`CollectionTable` derives it as
 * `selectedIds.size === 1`). Ctrl/Cmd+click instead toggles this row into the
 * shared multi-select set, and Shift+click replaces the set with the
 * contiguous range from the selection anchor to this row (`checked`, no
 * dedicated checkbox column - a space-saving fix request): `onClickCapture`
 * intercepts a Ctrl/Cmd+click or Shift+click BEFORE it reaches the
 * Title/Authors cells' own click handlers (capture fires first), so neither
 * ever arms or opens an editor (Shift+click also suppresses the browser's
 * native text-selection sweep). A checked row gets
 * the SAME highlight as an armed row (left ink bar + `{colors.surface-strong}`,
 * fix request: no separate check-mark affordance - both states read as "this
 * row is selected"). Dragging a selected row carries the whole selection;
 * dragging an unselected row carries just itself. Every gesture is reported
 * up via a callback - `CollectionTable` owns the one selection set, the
 * editing state, and the click-suppression discipline; this component only
 * renders and reports.
 */
export default function PaperRow({
  row,
  visibleColumns,
  armed,
  editingField,
  checked,
  onRowClick,
  onRowClickCapture,
  onArm,
  onOpen,
  onDragStart,
  onStartEdit,
  onCommit,
  onCancel,
  onRestore,
  onPurge,
}: {
  row: CollectionRow;
  visibleColumns: Set<ColumnKey>;
  armed: boolean;
  editingField: EditableField | null;
  checked: boolean;
  onRowClick: () => void;
  onRowClickCapture: (e: React.MouseEvent<HTMLTableRowElement>) => void;
  onArm: () => void;
  onOpen: () => void;
  onDragStart: (e: React.DragEvent<HTMLTableRowElement>) => void;
  onStartEdit: (field: EditableField) => void;
  onCommit: (field: EditableField, value: string, viaBlur: boolean) => void;
  onCancel: () => void;
  /** Present only in the Trash lens (Story 7.5, AC-2): a trashed row is not
   *  opened, so the Title cell's Open button is replaced with these two. */
  onRestore?: () => void;
  onPurge?: () => void;
}) {
  // A null title falls back to the filename, extension stripped (still
  // recognizable); `Untitled` is the last resort when neither is known.
  const displayTitle = row.title ?? (row.filename ? stripPdfExtension(row.filename) : null);
  const label = statusLabel(row.status);
  const editable = row.status !== "extracting";
  // Trash lens (Story 7.5 scope: "Moving a trashed paper into a folder" is
  // out of scope) - a trashed row must not be draggable onto a folder-panel
  // drop target, so drag is disabled at the source whenever Restore/Purge
  // are present (the same signal PaperRow already uses to detect the lens).
  const dragDisabled = Boolean(onRestore || onPurge);
  return (
    <tr
      aria-selected={armed}
      data-checked={checked || undefined}
      onClickCapture={onRowClickCapture}
      onClick={onRowClick}
      className={rowStatusClass(row.status)}
      draggable={!dragDisabled}
      onDragStart={dragDisabled ? undefined : onDragStart}
    >
      {visibleColumns.has("title") && (
        <EditableCell
          className="collection-table__title"
          title={displayTitle ?? undefined}
          field="title"
          editable={editable}
          armed={armed}
          isEditing={editingField === "title"}
          seedValue={seedFieldValue(row, "title")}
          onStartEdit={() => onStartEdit("title")}
          onArm={onArm}
          onCommit={(value, viaBlur) => onCommit("title", value, viaBlur)}
          onCancel={onCancel}
        >
          <span className="collection-table__title-text">
            {displayTitle ?? <span className="collection-table__untitled">Untitled</span>}
          </span>
          {onRestore && onPurge ? (
            <span className="collection-table__trash-actions">
              <button
                type="button"
                className="collection-table__row-action-button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRestore();
                }}
                onKeyDown={(e) => e.stopPropagation()}
              >
                Restore
              </button>
              <button
                type="button"
                className="collection-table__row-action-button"
                onClick={(e) => {
                  e.stopPropagation();
                  onPurge();
                }}
                onKeyDown={(e) => e.stopPropagation()}
              >
                Purge
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="collection-table__open-button"
              onClick={(e) => {
                e.stopPropagation();
                onOpen();
              }}
              onKeyDown={(e) => e.stopPropagation()}
            >
              Open
            </button>
          )}
        </EditableCell>
      )}
      {visibleColumns.has("authors") && (
        <EditableCell
          className="collection-table__authors"
          title={row.authors ?? undefined}
          field="authors"
          editable={editable}
          armed={armed}
          isEditing={editingField === "authors"}
          seedValue={seedFieldValue(row, "authors")}
          onStartEdit={() => onStartEdit("authors")}
          onArm={onArm}
          onCommit={(value, viaBlur) => onCommit("authors", value, viaBlur)}
          onCancel={onCancel}
        >
          {row.authors ?? ""}
        </EditableCell>
      )}
      {visibleColumns.has("added") && (
        <td className="collection-table__added">{formatAdded(row.added)}</td>
      )}
      {visibleColumns.has("file_type") && (
        <td>
          {label ? (
            <span
              className={
                row.status === "parse-failed" ? "badge-pill badge-pill--muted" : "badge-pill"
              }
            >
              {label}
            </span>
          ) : (
            <span className="badge-pill">{row.file_type === "note" ? "Note" : "PDF"}</span>
          )}
        </td>
      )}
    </tr>
  );
}
