import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import "@/library/LibraryPage.css";
import Toast from "@/components/Toast/Toast";
import CollectionTable from "@/library/CollectionTable/CollectionTable";
import EmptyDropzone from "@/components/EmptyDropzone/EmptyDropzone";
import AddMenu from "@/library/AddMenu/AddMenu";
import FolderPanel from "@/library/FolderPanel/FolderPanel";
import MoveMenu from "@/library/MoveMenu";
import DisplayMenu from "@/library/TableControls/DisplayMenu";
import { useCollection } from "@/library/useCollection";
import { useInlineEdit } from "@/library/useInlineEdit";
import { useMovePapers } from "@/library/useMovePapers";
import { useTableView } from "@/library/useTableView";
import { filterPapers, type FolderSelection } from "@/library/folderFilter";
import { fetchHealth, type Folder } from "@/api/client";

const PDF_EXTENSION = /\.pdf$/i;

type ToastState = { message: string; variant: "error" | "info" };

/** The quiet empty-line copy for a filtered-to-nothing selection (Story 7.2:
 *  a small SHOULD, distinct from `EmptyDropzone`'s zero-library state). */
function emptySelectionMessage(selection: FolderSelection): string {
  if (selection.kind === "uncategorized") return "No uncategorized papers.";
  if (selection.kind === "folder") return "No papers in this folder.";
  return "No papers to show.";
}

/** The toolbar count's "in ___" target (fix request: it read "in library" for
 *  every view, even a selected folder). Folders are a flat list keyed by id
 *  (no tree walk needed - a name lookup is a plain find). */
function selectionLabel(selection: FolderSelection, folders: Folder[]): string {
  if (selection.kind === "uncategorized") return "Uncategorized";
  if (selection.kind === "folder") return folders.find((f) => f.id === selection.id)?.name ?? "folder";
  return "library";
}

/** A folder pick returns every file type in the directory tree; this filters
 *  it down to PDFs before handing anything to `uploadFiles` (a folder upload
 *  silently skips non-PDF clutter rather than surfacing a failure toast per
 *  non-PDF file). */
function isPdfFile(file: File): boolean {
  return file.type === "application/pdf" || PDF_EXTENSION.test(file.name);
}

/**
 * Library route (`/`, Story 6.1 shell + Story 6.3 table + Story 6.4 bulk
 * upload + Story 7.1 folder tree): the app's front door. Composition only —
 * `useCollection` owns the fetch / optimistic-row / settle-poll / bulk-upload
 * lifecycle, `useInlineEdit` owns the title/authors optimistic-PATCH
 * lifecycle, `FolderPanel` owns the folder CRUD lifecycle, and this component
 * wires them to the toolbar, the drop target, and the table (loading skeleton
 * / dropzone-empty / error toast per fetch state).
 */
export default function LibraryPage() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [version, setVersion] = useState<string | null>(null);

  const onToast = useCallback(
    (message: string, variant: ToastState["variant"]) => setToast({ message, variant }),
    [],
  );

  const { library, setLibrary, loading, loadFailed, pending, uploadFiles } = useCollection({
    onToast,
  });
  const handleEditField = useInlineEdit({ library, setLibrary, onToast });
  const { movePapers } = useMovePapers({ setLibrary, onToast });
  const tableView = useTableView();
  const [selection, setSelection] = useState<FolderSelection>({ kind: "all" });
  // The one selection set driving BOTH a plain-click single row and a
  // Ctrl/Cmd+click multi-select (fix request: they were two disjoint pieces
  // of state - a table-local `selectedId` and this lifted `checkedIds` -
  // which never synced, so a plain click after a multi-select left the old
  // rows highlighted, and the toolbar Move button never saw a single armed
  // row at all. `CollectionTable` reports every change (plain click, toggle,
  // arm) through its one `onSelectionChange` callback, so this is a plain
  // mirror - see its own comment for how "armed"/"checked" derive from it.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // A folder switch clears the selection: ids from a prior view could
  // otherwise silently carry into a Move/drop the user can no longer see.
  const handleSelect = useCallback((next: FolderSelection) => {
    setSelection(next);
    setSelectedIds(new Set());
  }, []);

  const handleMoveRequest = useCallback(
    (docIds: string[], folderId: string | null) => {
      if (docIds.length === 0) return;
      movePapers(docIds, folderId);
      setSelectedIds(new Set());
    },
    [movePapers],
  );

  useEffect(() => {
    let live = true;
    fetchHealth()
      .then((h) => {
        if (live) setVersion(h.version);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    folderInputRef.current?.setAttribute("webkitdirectory", "");
    folderInputRef.current?.setAttribute("directory", "");
  }, []);

  const papers = library?.papers ?? [];
  const folders = library?.folders ?? [];
  const isTableLayout = loading || papers.length > 0 || pending.length > 0;
  // The column filter + sort (Story 7.4) fold onto the folder-filtered array
  // HERE, so the same array CollectionTable paints is the one Story 7.3's
  // Shift+click range indexes (its range math is index-based over `rows`).
  const { applyTableView } = tableView;
  const visiblePapers = useMemo(
    () => applyTableView(filterPapers(papers, selection)),
    [papers, selection, applyTableView],
  );
  // A just-uploaded paper lands Uncategorized; it should not appear under an
  // unrelated selected folder (Dev Notes: gate pending rows on selection kind).
  const visiblePending = selection.kind === "folder" ? [] : pending;
  const mainClassName = [
    "library-main",
    isTableLayout && "library-main--table",
    dragOver && "library-main--drag-over",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="library">
      <div className="library-body">
        <FolderPanel
          folders={folders}
          setLibrary={setLibrary}
          onToast={onToast}
          version={version}
          selection={selection}
          onSelect={handleSelect}
          onDropMove={handleMoveRequest}
        />
        <main
          className={mainClassName}
          role="main"
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const files = Array.from(e.dataTransfer.files);
            if (files.length > 0) uploadFiles(files);
          }}
        >
          {isTableLayout && (
            <div className="library-toolbar">
              {loading && papers.length === 0 && pending.length === 0 ? (
                <span
                  className="collection-table__skeleton-cell library-toolbar__count-skeleton"
                  aria-hidden="true"
                />
              ) : (
                <p className="library-toolbar__count">
                  {visiblePapers.length} files in {selectionLabel(selection, folders)}
                </p>
              )}
              <div className="library-toolbar__actions">
                <DisplayMenu hiddenColumns={tableView.hiddenColumns} onToggleColumn={tableView.toggleColumn} />
                <MoveMenu
                  folders={folders}
                  onMove={(folderId) => handleMoveRequest(Array.from(selectedIds), folderId)}
                  label="Move"
                  disabled={selectedIds.size === 0}
                />
                <AddMenu
                  onFileUpload={() => fileInputRef.current?.click()}
                  onFolderUpload={() => folderInputRef.current?.click()}
                />
              </div>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            multiple
            className="library-add-input"
            data-testid="library-add-input"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              // Reset so re-picking the same file(s) after a failure refires change.
              e.target.value = "";
              if (files.length > 0) uploadFiles(files);
            }}
          />
          <input
            ref={folderInputRef}
            type="file"
            multiple
            className="library-add-input"
            data-testid="library-folder-input"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []).filter(isPdfFile);
              e.target.value = "";
              if (files.length > 0) uploadFiles(files);
            }}
          />
          {loading && papers.length === 0 && pending.length === 0 ? (
            <CollectionTable loading visibleColumns={tableView.visibleColumns} />
          ) : papers.length > 0 || pending.length > 0 ? (
            visiblePapers.length === 0 && visiblePending.length === 0 ? (
              <p className="library-empty-line">{emptySelectionMessage(selection)}</p>
            ) : (
              <CollectionTable
                rows={visiblePapers}
                pendingRows={visiblePending}
                onOpenRow={(docId) => navigate(`/reader/${docId}`)}
                onEditField={handleEditField}
                selectedIds={selectedIds}
                onSelectionChange={setSelectedIds}
                visibleColumns={tableView.visibleColumns}
                sort={tableView.sort}
                onSortChange={tableView.setSort}
                onToggleColumn={tableView.toggleColumn}
              />
            )
          ) : loadFailed ? null : (
            <EmptyDropzone onFiles={uploadFiles} />
          )}
        </main>
      </div>
      {toast && (
        <Toast message={toast.message} variant={toast.variant} onDismiss={() => setToast(null)} />
      )}
    </div>
  );
}
