import { Folder as FolderIcon, FolderPlus, PencilSimple, TrashSimple } from "@phosphor-icons/react";
import type { Folder } from "@/api/client";
import FolderNameEditor from "./FolderNameEditor";

/**
 * One row of the folder tree (Story 7.1): the static name, or (while this
 * folder is the one being renamed) the inline `FolderNameEditor`. The three
 * per-folder affordances (rename / add-subfolder / delete) are hover/focus-
 * revealed icon buttons, mirroring `CollectionTable`'s Open-button reveal.
 * The name is a real `<button>` (Story 7.2, L-UX-DR12): clicking or
 * Enter/Space-activating it selects this folder, filtering the table. It is
 * a SIBLING of the action buttons (not a wrapping element), so clicking
 * rename/add-subfolder/delete can never also fire a select. The whole row is
 * ALSO a drag-to-folder drop target (fix request): `FolderPanel` owns the
 * hover-highlight state and the drag-payload decode, this just forwards the
 * three native drag events and renders the hover class.
 */
export default function FolderRow({
  folder,
  depth,
  isEditing,
  isSelected,
  isDropHover,
  onSelect,
  onDragOver,
  onDragLeave,
  onDrop,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onStartSubfolder,
  onRequestDelete,
}: {
  folder: Folder;
  depth: number;
  isEditing: boolean;
  isSelected: boolean;
  isDropHover: boolean;
  onSelect: () => void;
  onDragOver: (e: React.DragEvent<HTMLLIElement>) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent<HTMLLIElement>) => void;
  onStartRename: (id: string) => void;
  onCommitRename: (id: string, name: string) => void;
  onCancelRename: () => void;
  onStartSubfolder: (parentId: string) => void;
  onRequestDelete: (folder: Folder) => void;
}) {
  return (
    <li
      className={
        "folder-panel__row" +
        (isSelected ? " folder-panel__row--active" : "") +
        (isDropHover ? " folder-panel__row--drop-hover" : "")
      }
      style={{ paddingInlineStart: `calc(var(--folder-panel-indent-step) * ${depth})` }}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {isEditing ? (
        <FolderNameEditor
          initialValue={folder.name}
          onCommit={(name) => onCommitRename(folder.id, name)}
          onCancel={onCancelRename}
        />
      ) : (
        <>
          <button type="button" className="folder-panel__name" onClick={onSelect}>
            <FolderIcon aria-hidden />
            {folder.name}
          </button>
          <div className="folder-panel__row-actions">
            <button
              type="button"
              className="folder-panel__action"
              aria-label={`Rename ${folder.name}`}
              title="Rename"
              onClick={(e) => {
                e.stopPropagation();
                onStartRename(folder.id);
              }}
            >
              <PencilSimple aria-hidden />
            </button>
            <button
              type="button"
              className="folder-panel__action"
              aria-label={`Add subfolder to ${folder.name}`}
              title="Add subfolder"
              onClick={(e) => {
                e.stopPropagation();
                onStartSubfolder(folder.id);
              }}
            >
              <FolderPlus aria-hidden />
            </button>
            <button
              type="button"
              className="folder-panel__action"
              aria-label={`Delete ${folder.name}`}
              title="Delete"
              onClick={(e) => {
                e.stopPropagation();
                onRequestDelete(folder);
              }}
            >
              <TrashSimple aria-hidden />
            </button>
          </div>
        </>
      )}
    </li>
  );
}
