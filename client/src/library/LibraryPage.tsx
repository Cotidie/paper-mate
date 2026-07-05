import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import "@/library/LibraryPage.css";
import Toast from "@/components/Toast/Toast";
import CollectionTable from "@/library/CollectionTable/CollectionTable";
import EmptyDropzone from "@/components/EmptyDropzone/EmptyDropzone";
import AddMenu from "@/library/AddMenu/AddMenu";
import { useCollection } from "@/library/useCollection";
import { useInlineEdit } from "@/library/useInlineEdit";
import { fetchHealth } from "@/api/client";

const PDF_EXTENSION = /\.pdf$/i;

type ToastState = { message: string; variant: "error" | "info" };

/** A folder pick returns every file type in the directory tree; this filters
 *  it down to PDFs before handing anything to `uploadFiles` (a folder upload
 *  silently skips non-PDF clutter rather than surfacing a failure toast per
 *  non-PDF file). */
function isPdfFile(file: File): boolean {
  return file.type === "application/pdf" || PDF_EXTENSION.test(file.name);
}

/**
 * Library route (`/`, Story 6.1 shell + Story 6.3 table + Story 6.4 bulk
 * upload): the app's front door. Composition only — `useCollection` owns the
 * fetch / optimistic-row / settle-poll / bulk-upload lifecycle, `useInlineEdit`
 * owns the title/authors optimistic-PATCH lifecycle, and this component wires
 * them to the toolbar, the drop target, and the table (loading skeleton /
 * dropzone-empty / error toast per fetch state).
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
  const isTableLayout = loading || papers.length > 0 || pending.length > 0;
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
        <aside className="library-folder-panel" aria-label="Folders">
          <span className="library-folder-panel__label">Library</span>
          <span className="library-folder-panel__item library-folder-panel__item--active">All</span>
          {version && (
            <span className="library-folder-panel__version" data-testid="library-version">
              v{version}
            </span>
          )}
        </aside>
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
                <p className="library-toolbar__count">{papers.length} files in library</p>
              )}
              <AddMenu
                onFileUpload={() => fileInputRef.current?.click()}
                onFolderUpload={() => folderInputRef.current?.click()}
              />
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
            <CollectionTable loading />
          ) : papers.length > 0 || pending.length > 0 ? (
            <CollectionTable
              rows={papers}
              pendingRows={pending}
              onOpenRow={(docId) => navigate(`/reader/${docId}`)}
              onEditField={handleEditField}
            />
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
