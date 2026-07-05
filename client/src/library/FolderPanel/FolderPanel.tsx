import { Fragment, useState, type Dispatch, type SetStateAction } from "react";
import { ClockCounterClockwise, Files, FolderDashed, Plus, TrashSimple } from "@phosphor-icons/react";
import ConfirmDialog from "@/components/ConfirmDialog/ConfirmDialog";
import type { Folder, Library } from "@/api/client";
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
 * Selecting a nav item or folder to filter the table is Story 7.2 (`All`
 * stays the visually "active" resting default); `Recent`/`Trash` are visual
 * placeholders only (Trash's real lens is Story 7.5). Nothing here wires a
 * click to a filter.
 */
export default function FolderPanel({
  folders,
  setLibrary,
  onToast,
  version,
}: {
  folders: Folder[];
  setLibrary: Dispatch<SetStateAction<Library | null>>;
  onToast: (message: string, variant: "error" | "info") => void;
  version: string | null;
}) {
  const { createFolder, renameFolder, deleteFolder } = useFolders({ folders, setLibrary, onToast });

  const [editingId, setEditingId] = useState<string | null>(null);
  // `undefined` = no draft in progress; `null` = a root-level draft;
  // a folder id = a subfolder draft nested under that folder.
  const [draftParentId, setDraftParentId] = useState<string | null | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<Folder | null>(null);

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
    <aside className="library-folder-panel" aria-label="Folders">
      <span className="library-folder-panel__label">Library</span>

      <ul className="folder-panel__pseudo-list">
        <li className="library-folder-panel__item library-folder-panel__item--active">
          <Files aria-hidden />
          All
        </li>
        <li className="library-folder-panel__item">
          <ClockCounterClockwise aria-hidden />
          Recent
        </li>
        <li className="library-folder-panel__item">
          <FolderDashed aria-hidden />
          Uncategorized
        </li>
        <li className="library-folder-panel__item">
          <TrashSimple aria-hidden />
          Trash
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
