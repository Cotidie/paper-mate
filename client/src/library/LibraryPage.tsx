import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import "@/library/LibraryPage.css";
import Toast from "@/components/Toast/Toast";
import CollectionTable from "@/library/CollectionTable/CollectionTable";
import ConfirmDialog from "@/components/ConfirmDialog/ConfirmDialog";
import EmptyDropzone from "@/components/EmptyDropzone/EmptyDropzone";
import FolderPanel from "@/library/FolderPanel/FolderPanel";
import LibraryToolbar from "@/library/LibraryToolbar";
import { useCollection } from "@/library/useCollection";
import { useInlineEdit } from "@/library/useInlineEdit";
import { useAuthorsEdit } from "@/library/useAuthorsEdit";
import { useMovePapers } from "@/library/useMovePapers";
import { useTrashPapers } from "@/library/useTrashPapers";
import { useStarPapers } from "@/library/useStarPapers";
import { useColumnWidths } from "@/library/useColumnWidths";
import { useResizablePanel } from "@/library/useResizablePanel";
import { useTableView } from "@/library/useTableView";
import {
  filterPapers,
  msUntilNextUtcMidnight,
  recentGroupLabels,
  type FolderSelection,
} from "@/library/folderFilter";
import {
  emptySelectionMessage,
  isPdfFile,
  purgeDialogTitle,
  selectionLabel,
  visibleColumnsForSelection,
} from "@/library/libraryLens";
import { fetchHealth, type CollectionRow } from "@/api/client";

type ToastState = { message: string; variant: "error" | "info" };

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
  // ONE `now` shared by the Recent lens's filter AND its date-bucket header
  // labels (Codex review, second pass): two independent `Date.now()` calls
  // could disagree right at a UTC-midnight boundary, desyncing row
  // membership from the headers painted over it. Rescheduled at exactly the
  // next UTC midnight so a long-lived mounted session re-buckets across a
  // day rollover without the user touching anything.
  const [recentNow, setRecentNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setTimeout(() => setRecentNow(Date.now()), msUntilNextUtcMidnight(recentNow));
    return () => clearTimeout(timer);
  }, [recentNow]);

  const onToast = useCallback(
    (message: string, variant: ToastState["variant"]) => setToast({ message, variant }),
    [],
  );

  const { library, setLibrary, loading, loadFailed, pending, uploadFiles } = useCollection({
    onToast,
  });
  const folders = library?.folders ?? [];
  const handleEditField = useInlineEdit({ library, setLibrary, onToast });
  const handleEditAuthors = useAuthorsEdit({ library, setLibrary, onToast });
  const { movePapers } = useMovePapers({ setLibrary, onToast });
  const trash = useTrashPapers({ setLibrary, onToast });
  const star = useStarPapers({ setLibrary, onToast });
  // Bulk purge target (fix request: toolbar Purge over the selection, and
  // the sidebar's Empty Trash both funnel here) - one or many rows, the
  // ConfirmDialog copy adapts to the count. Empty = closed.
  const [purgeTargets, setPurgeTargets] = useState<CollectionRow[]>([]);
  const tableView = useTableView(folders);
  const folderPanelResize = useResizablePanel();
  const columnWidths = useColumnWidths();
  const [selection, setSelection] = useState<FolderSelection>({ kind: "recent" });
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

  const handleDeleteRequest = useCallback(() => {
    if (selectedIds.size === 0) return;
    trash.trashPapers(Array.from(selectedIds));
    setSelectedIds(new Set());
  }, [trash, selectedIds]);

  const handleRestoreRequest = useCallback(() => {
    if (selectedIds.size === 0) return;
    trash.restorePapers(Array.from(selectedIds));
    setSelectedIds(new Set());
  }, [trash, selectedIds]);

  function confirmPurge() {
    for (const target of purgeTargets) trash.purge(target.doc_id);
    setPurgeTargets([]);
    setSelectedIds(new Set());
  }

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
  const trashedPapers = useMemo(() => papers.filter((p) => p.trashed), [papers]);
  const handleEmptyTrashRequest = useCallback(() => {
    if (trashedPapers.length === 0) return;
    setPurgeTargets(trashedPapers);
  }, [trashedPapers]);
  // Fix request: an upload made while a folder is open should land there, not
  // always Uncategorized. Every `uploadFiles` call site below passes this.
  const uploadFolderId = selection.kind === "folder" ? selection.id : null;
  const isTableLayout = loading || papers.length > 0 || pending.length > 0;
  // The column filter + sort (Story 7.4) fold onto the folder-filtered array
  // HERE, so the same array CollectionTable paints is the one Story 7.3's
  // Shift+click range indexes (its range math is index-based over `rows`).
  const { applyTableView } = tableView;
  const visiblePapers = useMemo(
    () => applyTableView(filterPapers(papers, selection, recentNow)),
    [papers, selection, applyTableView, recentNow],
  );
  // Folder view hides the redundant Location column (see `visibleColumnsForSelection`).
  const visibleColumns = useMemo(
    () => visibleColumnsForSelection(tableView.visibleColumns, selection),
    [tableView.visibleColumns, selection],
  );
  // Toolbar Star state derives from the selection (AC-6): a mixed selection
  // toggles all -> starred; a fully-starred selection toggles all -> unstarred.
  const selectedRows = useMemo(
    () => visiblePapers.filter((p) => selectedIds.has(p.doc_id)),
    [visiblePapers, selectedIds],
  );
  const allStarred = selectedRows.length > 0 && selectedRows.every((p) => p.starred);
  const handleStarRequest = useCallback(() => {
    if (selectedIds.size === 0) return;
    if (allStarred) star.unstarPapers(Array.from(selectedIds));
    else star.starPapers(Array.from(selectedIds));
    setSelectedIds(new Set());
  }, [star, selectedIds, allStarred]);
  // Recent lens date-bucket headers (post-review scope): only meaningful in
  // the default recency order - a manual column sort scrambles it, so no
  // headers render then (same "sort still works, membership/order doesn't
  // pretend to be locked" precedent as the original 50-cap Dev Notes). Shares
  // `recentNow` with `visiblePapers`'s own filter (see its declaration) so
  // membership and header boundaries never disagree.
  const recentGroups = useMemo(
    () =>
      selection.kind === "recent" && tableView.sort === null
        ? recentGroupLabels(visiblePapers, recentNow)
        : undefined,
    [selection, tableView.sort, visiblePapers, recentNow],
  );
  // A just-uploaded paper lands Uncategorized; it should not appear under an
  // unrelated selected folder or the Trash lens. The Recent lens DOES show it:
  // an upload in progress is the most-recent item, and Recent is the default
  // landing view (see the initial `selection`), so its pending "Extracting" row
  // is the user's only upload feedback on the front door.
  const visiblePending =
    selection.kind === "folder" || selection.kind === "trash" || selection.kind === "starred"
      ? []
      : pending;
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
          width={folderPanelResize.width}
          trashCount={trashedPapers.length}
          onRequestEmptyTrash={handleEmptyTrashRequest}
        />
        <div
          className="library-resize-handle"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize folder panel"
          aria-valuenow={folderPanelResize.width}
          aria-valuemin={folderPanelResize.minWidth}
          aria-valuemax={folderPanelResize.maxWidth}
          tabIndex={0}
          onPointerDown={folderPanelResize.startResize}
          onKeyDown={folderPanelResize.handleKeyDown}
        />
        <main
          className={mainClassName}
          role="main"
          onDragOver={(e) => {
            // Story 7.10 fix: this dropzone highlight is for an OS file drag
            // only. A same-page drag (row-move, column-reorder) also fires
            // dragover on every ancestor it passes over, including `<main>`
            // - without this check the dashed "drop a file" border flashed
            // on screen while just dragging a column header. `types` (not
            // `files`, which is empty until the actual `drop`) is readable
            // during dragover.
            if (!e.dataTransfer.types.includes("Files")) return;
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            const files = Array.from(e.dataTransfer.files);
            if (files.length === 0) return;
            e.preventDefault();
            setDragOver(false);
            uploadFiles(files, uploadFolderId);
          }}
        >
          {isTableLayout && (
            <LibraryToolbar
              showCountSkeleton={loading && papers.length === 0 && pending.length === 0}
              count={visiblePapers.length}
              countLabel={selectionLabel(selection, folders)}
              hiddenColumns={tableView.hiddenColumns}
              onToggleColumn={tableView.toggleColumn}
              isTrash={selection.kind === "trash"}
              hasSelection={selectedIds.size > 0}
              allStarred={allStarred}
              folders={folders}
              onMove={(folderId) => handleMoveRequest(Array.from(selectedIds), folderId)}
              onStar={handleStarRequest}
              onDelete={handleDeleteRequest}
              onRestore={handleRestoreRequest}
              onPurge={() => setPurgeTargets(visiblePapers.filter((p) => selectedIds.has(p.doc_id)))}
              onFileUpload={() => fileInputRef.current?.click()}
              onFolderUpload={() => folderInputRef.current?.click()}
            />
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
              if (files.length > 0) uploadFiles(files, uploadFolderId);
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
              if (files.length > 0) uploadFiles(files, uploadFolderId);
            }}
          />
          {loading && papers.length === 0 && pending.length === 0 ? (
            <CollectionTable
              loading
              visibleColumns={visibleColumns}
              columnWidths={columnWidths.widths}
            />
          ) : papers.length > 0 || pending.length > 0 ? (
            visiblePapers.length === 0 && visiblePending.length === 0 ? (
              <p className="library-empty-line">{emptySelectionMessage(selection)}</p>
            ) : (
              <CollectionTable
                rows={visiblePapers}
                pendingRows={visiblePending}
                onOpenRow={(docId) => navigate(`/reader/${docId}`)}
                onEditField={handleEditField}
                onCommitAuthors={handleEditAuthors}
                selectedIds={selectedIds}
                onSelectionChange={setSelectedIds}
                visibleColumns={visibleColumns}
                sort={tableView.sort}
                onSortChange={tableView.setSort}
                onToggleColumn={tableView.toggleColumn}
                onReorderColumn={tableView.reorderColumns}
                columnWidths={columnWidths.widths}
                onResizeColumnStart={columnWidths.startResize}
                onResizeColumnKeyDown={columnWidths.handleKeyDown}
                trashLens={selection.kind === "trash"}
                folders={folders}
                groupLabels={recentGroups}
              />
            )
          ) : loadFailed ? null : (
            <EmptyDropzone onFiles={(files) => uploadFiles(files, uploadFolderId)} />
          )}
        </main>
      </div>
      {toast && (
        <Toast message={toast.message} variant={toast.variant} onDismiss={() => setToast(null)} />
      )}
      <ConfirmDialog
        open={purgeTargets.length > 0}
        title={purgeDialogTitle(purgeTargets)}
        message={
          purgeTargets.length === 1
            ? "This permanently deletes the paper and its annotations. This cannot be undone."
            : "This permanently deletes these papers and their annotations. This cannot be undone."
        }
        confirmLabel="Purge"
        onConfirm={confirmPurge}
        onCancel={() => setPurgeTargets([])}
      />
    </div>
  );
}
