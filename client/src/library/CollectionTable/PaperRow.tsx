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
 * One settled row of the collection table. A row click arms/selects it (purely
 * visual, `aria-selected`); the Title cell reveals an Open button on
 * hover/focus (independent of arm state). Title/Authors cells inline-edit once
 * the row is armed (see `EditableCell`). Every gesture is reported up via a
 * callback — `CollectionTable` owns the selection/editing state and the
 * click-suppression discipline; this component only renders and reports.
 */
export default function PaperRow({
  row,
  armed,
  editingField,
  onRowClick,
  onArm,
  onOpen,
  onStartEdit,
  onCommit,
  onCancel,
}: {
  row: CollectionRow;
  armed: boolean;
  editingField: EditableField | null;
  onRowClick: () => void;
  onArm: () => void;
  onOpen: () => void;
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
    <tr aria-selected={armed} onClick={onRowClick} className={rowStatusClass(row.status)}>
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
