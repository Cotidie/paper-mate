import type { ReactNode } from "react";
import { Folder as FolderIcon, Star } from "@phosphor-icons/react";
import type { CollectionRow } from "@/api/client";
import {
  formatAdded,
  rowStatusClass,
  seedFieldValue,
  statusLabel,
  stripPdfExtension,
  type EditableField,
} from "@/library/row";
import type { ColumnDef } from "@/library/tableView";
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
 *
 * `visibleColumns` is the ORDERED column list (Story 7.10, AC-6), not a
 * membership `Set`: the `<td>`s render via `.map` in that order, each
 * dispatched by `renderCell`'s `switch`, so a persisted column order that
 * differs from the default can never desync a cell from the `<th>` above it
 * (the cell-order trap - see the story's Dev Notes).
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
  trashLens = false,
  locationLabel,
}: {
  row: CollectionRow;
  visibleColumns: ColumnDef[];
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
  /** Trash lens (fix request: Restore/Purge moved to the toolbar, bulk over
   *  the selection - a row itself carries no action button). A trashed row
   *  still isn't opened, and isn't draggable onto a folder drop target. */
  trashLens?: boolean;
  /** The owning folder's name, or "Uncategorized" (post-review scope: a
   *  Location column). Resolved by `CollectionTable` (it holds the folder
   *  list; a row only carries `folder_id`), so this component stays a plain
   *  string, no id lookup of its own. */
  locationLabel: string;
}) {
  // A null title falls back to the filename, extension stripped (still
  // recognizable); `Untitled` is the last resort when neither is known.
  const displayTitle = row.title ?? (row.filename ? stripPdfExtension(row.filename) : null);
  const label = statusLabel(row.status);
  const editable = row.status !== "extracting";

  // A plain inline switch (Story 7.10 Dev Notes: this is the ordered-render
  // seam, not the general cellType registry - that's Story 7.11's job).
  function renderCell(col: ColumnDef): ReactNode {
    switch (col.key) {
      case "title":
        return (
          <EditableCell
            key="title"
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
            {row.starred && (
              <Star weight="fill" aria-label="Starred" className="collection-table__star" />
            )}
            {!trashLens && (
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
        );
      case "authors":
        return (
          <EditableCell
            key="authors"
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
        );
      case "venue":
        return (
          <EditableCell
            key="venue"
            className="collection-table__venue"
            title={row.venue ?? undefined}
            field="venue"
            editable={editable}
            armed={armed}
            isEditing={editingField === "venue"}
            seedValue={seedFieldValue(row, "venue")}
            onStartEdit={() => onStartEdit("venue")}
            onArm={onArm}
            onCommit={(value, viaBlur) => onCommit("venue", value, viaBlur)}
            onCancel={onCancel}
          >
            {row.venue ?? ""}
          </EditableCell>
        );
      case "year":
        return (
          <EditableCell
            key="year"
            className="collection-table__year"
            field="year"
            editable={editable}
            armed={armed}
            isEditing={editingField === "year"}
            seedValue={seedFieldValue(row, "year")}
            onStartEdit={() => onStartEdit("year")}
            onArm={onArm}
            onCommit={(value, viaBlur) => onCommit("year", value, viaBlur)}
            onCancel={onCancel}
          >
            {row.year ?? ""}
          </EditableCell>
        );
      case "location":
        return (
          <td key="location" className="collection-table__location" title={locationLabel}>
            {row.folder_id && <FolderIcon aria-hidden className="collection-table__location-icon" />}
            <span className="collection-table__location-text">{locationLabel}</span>
          </td>
        );
      case "added":
        return (
          <td key="added" className="collection-table__added">
            {formatAdded(row.added)}
          </td>
        );
      case "file_type":
        return (
          <td key="file_type">
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
        );
      case "doi":
        return (
          <td key="doi" className="collection-table__doi">
            {row.doi && (
              <a
                href={`https://doi.org/${row.doi}`}
                target="_blank"
                rel="noreferrer"
                className="collection-table__doi-link"
                title={row.doi}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              >
                {row.doi}
              </a>
            )}
          </td>
        );
    }
  }

  return (
    <tr
      aria-selected={armed}
      data-checked={checked || undefined}
      onClickCapture={onRowClickCapture}
      onClick={onRowClick}
      className={rowStatusClass(row.status)}
      draggable={!trashLens}
      onDragStart={trashLens ? undefined : onDragStart}
    >
      {visibleColumns.map((col) => renderCell(col))}
    </tr>
  );
}
