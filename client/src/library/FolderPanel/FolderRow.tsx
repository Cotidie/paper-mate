import { Folder as FolderIcon, FolderPlus, PencilSimple, TrashSimple } from "@phosphor-icons/react";
import type { Folder } from "@/api/client";
import FolderNameEditor from "./FolderNameEditor";

/**
 * One row of the folder tree (Story 7.1): the static name, or (while this
 * folder is the one being renamed) the inline `FolderNameEditor`. The three
 * per-folder affordances (rename / add-subfolder / delete) are hover/focus-
 * revealed icon buttons, mirroring `CollectionTable`'s Open-button reveal:
 * the name itself stays a plain, non-interactive label so Story 7.2's
 * click-to-select can be added later without colliding with rename.
 */
export default function FolderRow({
  folder,
  depth,
  isEditing,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onStartSubfolder,
  onRequestDelete,
}: {
  folder: Folder;
  depth: number;
  isEditing: boolean;
  onStartRename: (id: string) => void;
  onCommitRename: (id: string, name: string) => void;
  onCancelRename: () => void;
  onStartSubfolder: (parentId: string) => void;
  onRequestDelete: (folder: Folder) => void;
}) {
  return (
    <li
      className="folder-panel__row"
      style={{ paddingInlineStart: `calc(var(--folder-panel-indent-step) * ${depth})` }}
    >
      {isEditing ? (
        <FolderNameEditor
          initialValue={folder.name}
          onCommit={(name) => onCommitRename(folder.id, name)}
          onCancel={onCancelRename}
        />
      ) : (
        <>
          <span className="folder-panel__name">
            <FolderIcon aria-hidden />
            {folder.name}
          </span>
          <div className="folder-panel__row-actions">
            <button
              type="button"
              className="folder-panel__action"
              aria-label={`Rename ${folder.name}`}
              title="Rename"
              onClick={() => onStartRename(folder.id)}
            >
              <PencilSimple aria-hidden />
            </button>
            <button
              type="button"
              className="folder-panel__action"
              aria-label={`Add subfolder to ${folder.name}`}
              title="Add subfolder"
              onClick={() => onStartSubfolder(folder.id)}
            >
              <FolderPlus aria-hidden />
            </button>
            <button
              type="button"
              className="folder-panel__action"
              aria-label={`Delete ${folder.name}`}
              title="Delete"
              onClick={() => onRequestDelete(folder)}
            >
              <TrashSimple aria-hidden />
            </button>
          </div>
        </>
      )}
    </li>
  );
}
