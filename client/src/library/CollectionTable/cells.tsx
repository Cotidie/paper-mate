import type { ReactNode } from "react";
import { Folder as FolderIcon, Star } from "@phosphor-icons/react";
import type { CollectionRow } from "@/api/client";
import { formatAdded, seedFieldValue, statusLabel, type EditableField } from "@/library/row";
import type { ColumnKey } from "@/library/tableView";
import EditableCell from "./EditableCell";
import TagCell from "./TagCell";

/**
 * Everything a single cell renderer needs: the row, the shared interaction
 * state (armed/editing/lens), the resolved Location label + display title, and
 * the edit/open callbacks. `CollectionTable` owns the selection set, the
 * editing cursor, and the click-suppression discipline; a renderer only reads
 * this context and reports through the callbacks.
 */
export interface CellContext {
  row: CollectionRow;
  /** `false` while a row is still extracting: no cell is editable yet. */
  editable: boolean;
  armed: boolean;
  /** `"authors"` is a valid cursor even though it left `EditableField` (Story
   *  7.11: the tag editor commits a `string[]`); the arm→edit CURSOR is a UI
   *  concern shared by every editable cell, distinct from the PATCH payload. */
  editingField: EditableField | "authors" | null;
  /** Trash lens: the Title cell drops its Open button (Restore/Purge live in
   *  the toolbar, bulk over the selection - a row carries no action button). */
  trashLens: boolean;
  /** The owning folder's name, or "" for Uncategorized. Resolved by
   *  `CollectionTable` (it holds the folder list; a row only carries `folder_id`). */
  locationLabel: string;
  /** The DISPLAYED title (null title falls back to the filename, `.pdf`
   *  stripped); `Untitled` is the last resort, rendered by the title cell. */
  displayTitle: string | null;
  onArm: () => void;
  onOpen: () => void;
  onStartEdit: (field: EditableField | "authors") => void;
  onCommit: (field: EditableField, value: string, viaBlur: boolean) => void;
  onCancel: () => void;
  onCommitAuthors: (authors: string[]) => void;
}

type CellRenderer = (ctx: CellContext) => ReactNode;

function renderTitleCell({
  row,
  editable,
  armed,
  editingField,
  trashLens,
  displayTitle,
  onArm,
  onOpen,
  onStartEdit,
  onCommit,
  onCancel,
}: CellContext): ReactNode {
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
      <div className="collection-table__title-row">
        <span className="collection-table__title-text">
          {displayTitle ?? <span className="collection-table__untitled">Untitled</span>}
        </span>
        {row.starred && <Star weight="fill" aria-label="Starred" className="collection-table__star" />}
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
      </div>
    </EditableCell>
  );
}

/** The cell-type seam (Story 7.11, AC-1; Story 7.12 registry): Author is the
 *  only `tag` column, dispatched through `TagCell` rather than the plain-string
 *  `EditableCell` every other editable column uses. */
function renderAuthorsCell({
  row,
  editable,
  armed,
  editingField,
  onArm,
  onStartEdit,
  onCommitAuthors,
  onCancel,
}: CellContext): ReactNode {
  return (
    <TagCell
      key="authors"
      authors={row.authors_list}
      editable={editable}
      armed={armed}
      isEditing={editingField === "authors"}
      onStartEdit={() => onStartEdit("authors")}
      onArm={onArm}
      onCommit={onCommitAuthors}
      onCancel={onCancel}
    />
  );
}

function renderVenueCell({
  row,
  editable,
  armed,
  editingField,
  onArm,
  onStartEdit,
  onCommit,
  onCancel,
}: CellContext): ReactNode {
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
}

function renderYearCell({
  row,
  editable,
  armed,
  editingField,
  onArm,
  onStartEdit,
  onCommit,
  onCancel,
}: CellContext): ReactNode {
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
}

function renderLocationCell({ row, locationLabel }: CellContext): ReactNode {
  return (
    <td key="location" className="collection-table__location" title={locationLabel}>
      <div className="collection-table__location-row">
        {row.folder_id && <FolderIcon aria-hidden className="collection-table__location-icon" />}
        <span className="collection-table__location-text">{locationLabel}</span>
      </div>
    </td>
  );
}

function renderAddedCell({ row }: CellContext): ReactNode {
  return (
    <td key="added" className="collection-table__added">
      {formatAdded(row.added)}
    </td>
  );
}

function renderFileTypeCell({ row }: CellContext): ReactNode {
  const label = statusLabel(row.status);
  return (
    <td key="file_type">
      {label ? (
        <span className={row.status === "parse-failed" ? "badge-pill badge-pill--muted" : "badge-pill"}>
          {label}
        </span>
      ) : (
        <span className="badge-pill">{row.file_type === "note" ? "Note" : "PDF"}</span>
      )}
    </td>
  );
}

function renderDoiCell({ row }: CellContext): ReactNode {
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

/**
 * The canonical column-descriptor/renderer seam (Story 7.12, AC-4): a plain
 * map from column key to its cell renderer, so `PaperRow` maps its ORDERED
 * `visibleColumns` straight to cells with NO `switch` (7.11 shipped a
 * `cellType === "tag"` guard before a per-key switch under feature pressure;
 * this consolidates it). `cellType` stays on `ColumnDef` for the coarse class
 * (sort/shared styling); the per-COLUMN markup lives here.
 */
export const CELL_RENDERERS: Record<ColumnKey, CellRenderer> = {
  title: renderTitleCell,
  authors: renderAuthorsCell,
  venue: renderVenueCell,
  year: renderYearCell,
  location: renderLocationCell,
  added: renderAddedCell,
  file_type: renderFileTypeCell,
  doi: renderDoiCell,
};
