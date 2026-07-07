import { Fragment, useState, type Dispatch, type SetStateAction } from "react";
import {
  ClockCounterClockwise,
  Files,
  FolderDashed,
  Plus,
  Star,
  Trash,
  TrashSimple,
} from "@phosphor-icons/react";
import ConfirmDialog from "@/components/ConfirmDialog/ConfirmDialog";
import type { Folder, Library } from "@/api/client";
import { isSelected, type FolderSelection } from "@/library/folderFilter";
import { MOVE_DRAG_MIME, decodeDragIds } from "@/library/moveDrag";
import { useFolders } from "./useFolders";
import FolderRow from "./FolderRow";
import FolderNameEditor from "./FolderNameEditor";
import "./FolderPanel.css";

/** A folder plus its pre-order depth (root = 0), for flat indented rendering
 *  (mirrors `TocPanel`'s flat `entry.depth` rows rather than a recursive
 *  nested `<ul>` per level). */
function flattenTree(folders: Folder[]): Array<{ folder: Folder; depth: number }> {
  const childrenByParent = new Map<string | null, Folder[]>();
  for (const folder of folders) {
    const parentId = folder.parent_id ?? null;
    const list = childrenByParent.get(parentId) ?? [];
    list.push(folder);
    childrenByParent.set(parentId, list);
  }
  const out: Array<{ folder: Folder; depth: number }> = [];
  function visit(parentId: string | null, depth: number) {
    for (const folder of childrenByParent.get(parentId) ?? []) {
      out.push({ folder, depth });
      visit(folder.id, depth + 1);
    }
  }
  visit(null, 0);
  return out;
}

/**
 * The Library's left panel (Story 7.1): replaces the static aside
 * `LibraryPage` rendered through Story 6.1. Two areas, divider between: a
 * fixed Library section (`All`/`Recent`/`Uncategorized`/`Trash`, always
 * present, never CRUD-able, icon-led) and a Folder section (a "Folder"
 * header + create button, then the nested user folder tree built from the
 * flat `folders` list, with create/rename/delete affordances). `useFolders`
 * owns the CRUD lifecycle against `/api/library/folders`; this component
 * owns only the local UI state (which folder is being renamed, which parent
 * has a new-folder draft open, which folder is pending a delete confirm).
 *
 * `All`/`Uncategorized`/a folder row/`Trash` are selectable (Story 7.2/7.5,
 * LFR-14, L-UX-DR4): `selection` + `onSelect` are lifted to `LibraryPage`
 * (shared with the table's filter), so this component only renders the
 * highlight and forwards clicks/keyboard activation. `Recent`/`Starred` stay
 * inert visual placeholders (`Starred` is an unimplemented mock per user
 * request). `Uncategorized` and every folder row are ALSO drop targets for
 * drag-to-folder (fix request): a drag carrying the `MOVE_DRAG_MIME` payload
 * (set by a `CollectionTable` row's `dragstart`) reports the dropped doc ids
 * + target folder up via `onDropMove`. `Trash` is NOT a drop target (Story
 * 7.5 scope: drag-to-Trash is out of scope). The `Trash` entry also reveals
 * an Empty Trash icon on hover/focus (fix request), mirroring `FolderRow`'s
 * action reveal - shown only when the trash holds papers, gated behind its
 * own confirm (`onRequestEmptyTrash` opens it; this component owns neither
 * the count nor the purge call, both live in `LibraryPage`).
 */
export default function FolderPanel({
  folders,
  setLibrary,
  onToast,
  version,
  selection,
  onSelect,
  onDropMove,
  width,
  trashCount,
  onRequestEmptyTrash,
}: {
  folders: Folder[];
  setLibrary: Dispatch<SetStateAction<Library | null>>;
  onToast: (message: string, variant: "error" | "info") => void;
  version: string | null;
  selection: FolderSelection;
  onSelect: (selection: FolderSelection) => void;
  onDropMove: (docIds: string[], folderId: string | null) => void;
  /** Drag-to-resize (fix request): overrides the CSS default `--toc-panel-width`. */
  width: number;
  /** How many papers are currently trashed - gates the Empty Trash reveal. */
  trashCount: number;
  onRequestEmptyTrash: () => void;
}) {
  const { createFolder, renameFolder, deleteFolder } = useFolders({ folders, setLibrary, onToast });

  const [editingId, setEditingId] = useState<string | null>(null);
  // `undefined` = no draft in progress; `null` = a root-level draft;
  // a folder id = a subfolder draft nested under that folder.
  const [draftParentId, setDraftParentId] = useState<string | null | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<Folder | null>(null);
  // "uncategorized" | a folder id | null - which drop target is hovered.
  const [dropHoverKey, setDropHoverKey] = useState<string | null>(null);

  function handleDragOver(e: React.DragEvent, key: string) {
    if (!e.dataTransfer.types.includes(MOVE_DRAG_MIME)) return;
    e.preventDefault();
    setDropHoverKey(key);
  }
  function handleDragLeave(key: string) {
    setDropHoverKey((prev) => (prev === key ? null : prev));
  }
  function handleDrop(e: React.DragEvent, folderId: string | null) {
    if (!e.dataTransfer.types.includes(MOVE_DRAG_MIME)) return;
    e.preventDefault();
    setDropHoverKey(null);
    const ids = decodeDragIds(e.dataTransfer.getData(MOVE_DRAG_MIME));
    if (ids.length > 0) onDropMove(ids, folderId);
  }

  function startDraft(parentId: string | null) {
    setEditingId(null);
    setDraftParentId(parentId);
  }
  function commitDraft(parentId: string | null, name: string) {
    createFolder(name, parentId);
    setDraftParentId(undefined);
  }
  function cancelDraft() {
    setDraftParentId(undefined);
  }

  function commitRename(id: string, name: string) {
    renameFolder(id, name);
    setEditingId(null);
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    deleteFolder(deleteTarget.id);
    setDeleteTarget(null);
  }

  const rows = flattenTree(folders);

  return (
    <aside className="library-folder-panel" aria-label="Folders" style={{ width }}>
      <span className="library-folder-panel__label">Library</span>

      <ul className="folder-panel__pseudo-list">
        <li>
          <button
            type="button"
            className={
              "library-folder-panel__item" +
              (isSelected(selection, { kind: "all" }) ? " library-folder-panel__item--active" : "")
            }
            onClick={() => onSelect({ kind: "all" })}
          >
            <Files aria-hidden />
            All
          </button>
        </li>
        <li className="library-folder-panel__item" aria-disabled="true">
          <ClockCounterClockwise aria-hidden />
          Recent
        </li>
        <li>
          <button
            type="button"
            className={
              "library-folder-panel__item" +
              (isSelected(selection, { kind: "uncategorized" }) ? " library-folder-panel__item--active" : "") +
              (dropHoverKey === "uncategorized" ? " library-folder-panel__item--drop-hover" : "")
            }
            onClick={() => onSelect({ kind: "uncategorized" })}
            onDragOver={(e) => handleDragOver(e, "uncategorized")}
            onDragLeave={() => handleDragLeave("uncategorized")}
            onDrop={(e) => handleDrop(e, null)}
          >
            <FolderDashed aria-hidden />
            Uncategorized
          </button>
        </li>
        <li className="library-folder-panel__item" aria-disabled="true">
          <Star aria-hidden />
          Starred
        </li>
        <li className="library-folder-panel__trash-row">
          <button
            type="button"
            className={
              "library-folder-panel__item" +
              (isSelected(selection, { kind: "trash" }) ? " library-folder-panel__item--active" : "")
            }
            onClick={() => onSelect({ kind: "trash" })}
          >
            <TrashSimple aria-hidden />
            Trash
          </button>
          {trashCount > 0 && (
            <button
              type="button"
              className="library-folder-panel__trash-action"
              aria-label="Empty Trash"
              title="Empty Trash"
              onClick={(e) => {
                e.stopPropagation();
                onRequestEmptyTrash();
              }}
            >
              <Trash aria-hidden />
            </button>
          )}
        </li>
      </ul>

      <hr className="folder-panel__divider" />

      <div className="folder-panel__header">
        <span className="folder-panel__header-label">Folder</span>
        <button
          type="button"
          className="folder-panel__new-root"
          aria-label="New folder"
          title="New folder"
          onClick={() => startDraft(null)}
        >
          <Plus aria-hidden />
        </button>
      </div>

      <ul className="folder-panel__tree">
        {draftParentId === null && (
          <li className="folder-panel__row">
            <FolderNameEditor
              placeholder="New folder"
              initialValue=""
              onCommit={(name) => commitDraft(null, name)}
              onCancel={cancelDraft}
            />
          </li>
        )}
        {rows.map(({ folder, depth }) => (
          <Fragment key={folder.id}>
            <FolderRow
              folder={folder}
              depth={depth}
              isEditing={editingId === folder.id}
              isSelected={isSelected(selection, { kind: "folder", id: folder.id })}
              isDropHover={dropHoverKey === folder.id}
              onSelect={() => onSelect({ kind: "folder", id: folder.id })}
              onDragOver={(e) => handleDragOver(e, folder.id)}
              onDragLeave={() => handleDragLeave(folder.id)}
              onDrop={(e) => handleDrop(e, folder.id)}
              onStartRename={setEditingId}
              onCommitRename={commitRename}
              onCancelRename={() => setEditingId(null)}
              onStartSubfolder={startDraft}
              onRequestDelete={setDeleteTarget}
            />
            {draftParentId === folder.id && (
              <li
                className="folder-panel__row"
                style={{ paddingInlineStart: `calc(var(--folder-panel-indent-step) * ${depth + 1})` }}
              >
                <FolderNameEditor
                  placeholder="New folder"
                  initialValue=""
                  onCommit={(name) => commitDraft(folder.id, name)}
                  onCancel={cancelDraft}
                />
              </li>
            )}
          </Fragment>
        ))}
      </ul>

      {version && (
        <span className="library-folder-panel__version" data-testid="library-version">
          v{version}
        </span>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title={deleteTarget ? `Delete "${deleteTarget.name}"` : ""}
        message="Papers inside move to Uncategorized. No paper is deleted."
        confirmLabel="Delete"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </aside>
  );
}
