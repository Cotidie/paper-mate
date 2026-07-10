import type { CollectionRow } from "@/api/client";
import { rowStatusClass, stripPdfExtension, type EditableField } from "@/library/row";
import type { ColumnDef } from "@/library/tableView";
import { CELL_RENDERERS, type CellContext } from "./cells";

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
 * dispatched through the `CELL_RENDERERS` registry (Story 7.12, AC-4) keyed
 * by column key, so a persisted column order that differs from the default
 * can never desync a cell from the `<th>` above it (the cell-order trap - see
 * the story's Dev Notes), and there is no per-key `switch` to drift.
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
  onCommitAuthors,
  trashLens = false,
  locationLabel,
}: {
  row: CollectionRow;
  visibleColumns: ColumnDef[];
  armed: boolean;
  /** `"authors"` is a valid cursor value even though it left `EditableField`
   *  (Story 7.11: the tag editor commits a `string[]`, not a plain-string
   *  `EditableCell` edit) - the arm→edit CURSOR tracking is a UI concern
   *  shared by every editable cell type, distinct from the PATCH payload
   *  shape `EditableField` describes. */
  editingField: EditableField | "authors" | null;
  checked: boolean;
  onRowClick: () => void;
  onRowClickCapture: (e: React.MouseEvent<HTMLTableRowElement>) => void;
  onArm: () => void;
  onOpen: () => void;
  onDragStart: (e: React.DragEvent<HTMLTableRowElement>) => void;
  onStartEdit: (field: EditableField | "authors") => void;
  onCommit: (field: EditableField, value: string, viaBlur: boolean) => void;
  onCancel: () => void;
  /** The tag editor's commit (Story 7.11, AC-4): the NEW FULL author list. */
  onCommitAuthors: (authors: string[]) => void;
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
  const cellContext: CellContext = {
    row,
    editable: row.status !== "extracting",
    armed,
    editingField,
    trashLens,
    locationLabel,
    displayTitle,
    onArm,
    onOpen,
    onStartEdit,
    onCommit,
    onCancel,
    onCommitAuthors,
  };

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
      {visibleColumns.map((col) => CELL_RENDERERS[col.key](cellContext))}
    </tr>
  );
}
