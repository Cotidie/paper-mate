import { ArrowCounterClockwise, Star, Trash, TrashSimple } from "@phosphor-icons/react";
import type { Folder } from "@/api/client";
import type { ColumnKey } from "@/library/tableView";
import AddMenu from "@/library/AddMenu/AddMenu";
import MoveMenu from "@/library/MoveMenu";
import DisplayMenu from "@/library/TableControls/DisplayMenu";

/**
 * The Library table's toolbar (Story 7.12 AC-2, extracted from `LibraryPage`):
 * the count line + `DisplayMenu` + the trash-vs-non-trash action branch +
 * `AddMenu`. A pure presentation component - every action is a callback
 * `LibraryPage` wires to its selection/op handlers; the trash lens shows
 * Restore/Purge, every other lens shows Move/Star/Delete. Styles live in
 * `LibraryPage.css` (the page owns the toolbar chrome).
 */
export default function LibraryToolbar({
  showCountSkeleton,
  count,
  countLabel,
  hiddenColumns,
  onToggleColumn,
  isTrash,
  hasSelection,
  allStarred,
  folders,
  onMove,
  onStar,
  onDelete,
  onRestore,
  onPurge,
  onFileUpload,
  onFolderUpload,
}: {
  /** The count line is a shimmer while the first fetch is still loading. */
  showCountSkeleton: boolean;
  count: number;
  countLabel: string;
  hiddenColumns: Set<ColumnKey>;
  onToggleColumn: (key: ColumnKey) => void;
  isTrash: boolean;
  hasSelection: boolean;
  allStarred: boolean;
  folders: Folder[];
  onMove: (folderId: string | null) => void;
  onStar: () => void;
  onDelete: () => void;
  onRestore: () => void;
  onPurge: () => void;
  onFileUpload: () => void;
  onFolderUpload: () => void;
}) {
  return (
    <div className="library-toolbar">
      {showCountSkeleton ? (
        <span
          className="collection-table__skeleton-cell library-toolbar__count-skeleton"
          aria-hidden="true"
        />
      ) : (
        <p className="library-toolbar__count">
          {count} files in {countLabel}
        </p>
      )}
      <div className="library-toolbar__actions">
        <DisplayMenu hiddenColumns={hiddenColumns} onToggleColumn={onToggleColumn} />
        {isTrash ? (
          <>
            <button type="button" className="toolbar-button" disabled={!hasSelection} onClick={onRestore}>
              <ArrowCounterClockwise aria-hidden />
              Restore
            </button>
            <button type="button" className="toolbar-button" disabled={!hasSelection} onClick={onPurge}>
              <Trash aria-hidden />
              Purge
            </button>
          </>
        ) : (
          <>
            <MoveMenu folders={folders} onMove={onMove} label="Move" disabled={!hasSelection} />
            <button
              type="button"
              className="toolbar-button"
              disabled={!hasSelection}
              aria-pressed={allStarred}
              onClick={onStar}
            >
              <Star aria-hidden weight={allStarred ? "fill" : "regular"} />
              {allStarred ? "Unstar" : "Star"}
            </button>
            <button type="button" className="toolbar-button" disabled={!hasSelection} onClick={onDelete}>
              <TrashSimple aria-hidden />
              Delete
            </button>
          </>
        )}
        <AddMenu onFileUpload={onFileUpload} onFolderUpload={onFolderUpload} />
      </div>
    </div>
  );
}
