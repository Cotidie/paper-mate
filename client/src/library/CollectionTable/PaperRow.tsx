import type { CollectionRow } from "@/api/client";
import {
  formatAdded,
  rowStatusClass,
  seedFieldValue,
  statusLabel,
  stripPdfExtension,
  type EditableField,
} from "@/library/row";
import EditableCell from "./EditableCell";

/**
 * One settled row of the collection table. A plain row click arms/selects it
 * (purely visual, `aria-selected`); the Title cell reveals an Open button on
 * hover/focus (independent of arm state). Title/Authors cells inline-edit once
 * the row is armed (see `EditableCell`). Ctrl/Cmd+click instead toggles this
 * row into the MULTI-select set (`checked`, no dedicated checkbox column - a
 * space-saving fix request) that drives the toolbar's bulk "Move" and
 * drag-to-folder: `onClickCapture` intercepts a Ctrl/Cmd+click BEFORE it
 * reaches the Title/Authors cells' own click handlers (capture fires first),
 * so it never also arms or opens an editor. A checked row gets the SAME
 * highlight as an armed row (left ink bar + `{colors.surface-strong}`, fix
 * request: no separate check-mark affordance - both states read as "this
 * row is the active one"). Dragging a CHECKED row carries the whole checked
 * set; dragging an unchecked row carries just itself. Every gesture is
 * reported up via a callback — `CollectionTable` owns the
 * selection/editing/checked state and the click-suppression discipline;
 * this component only renders and reports.
 */
export default function PaperRow({
  row,
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
}: {
  row: CollectionRow;
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
}) {
  // A null title falls back to the filename, extension stripped (still
  // recognizable); `Untitled` is the last resort when neither is known.
  const displayTitle = row.title ?? (row.filename ? stripPdfExtension(row.filename) : null);
  const label = statusLabel(row.status);
  const editable = row.status !== "extracting";
  return (
    <tr
      aria-selected={armed}
      data-checked={checked || undefined}
      onClickCapture={onRowClickCapture}
      onClick={onRowClick}
      className={rowStatusClass(row.status)}
      draggable
      onDragStart={onDragStart}
    >
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
      </EditableCell>
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
      <td className="collection-table__added">{formatAdded(row.added)}</td>
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
    </tr>
  );
}
