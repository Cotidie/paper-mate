import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import "@/library/LibraryPage.css";
import Toast from "@/components/Toast/Toast";
import CollectionTable from "@/library/CollectionTable";
import EmptyDropzone from "@/components/EmptyDropzone/EmptyDropzone";
import AddMenu from "@/library/AddMenu";
import { useBulkUpload } from "@/library/useBulkUpload";
import { getLibrary, fetchHealth, type CollectionRow, type Doc, type Library } from "@/api/client";

const PDF_EXTENSION = /\.pdf$/i;

/** A folder pick returns every file type in the directory tree; this filters
 *  it down to PDFs before handing anything to `uploadFiles` (a folder upload
 *  silently skips non-PDF clutter rather than surfacing a failure toast per
 *  non-PDF file). */
function isPdfFile(file: File): boolean {
  return file.type === "application/pdf" || PDF_EXTENSION.test(file.name);
}

/** Project an upload's `Doc` into the display-cache `CollectionRow` shape
 *  (Story 6.4): a freshly stored paper is never in a folder or trashed, and
 *  sorts after every row currently known — matching the backend's own
 *  append-at-`max(order)+1` semantics (`_upsert_paper_entry`), so the row's
 *  position is stable across the AC-7 post-batch refetch rather than
 *  settling at the top only to jump to the bottom once the authoritative
 *  reconcile lands (client-side re-sort, e.g. newest-first, is Story 7.4's
 *  "display sort/filter controls" — out of scope here). */
function docToRow(doc: Doc, papers: CollectionRow[]): CollectionRow {
  const maxOrder = papers.reduce((max, p) => Math.max(max, p.order), -1);
  return {
    doc_id: doc.doc_id,
    title: doc.title ?? null,
    authors: doc.authors ?? null,
    added: doc.added,
    file_type: doc.file_type,
    status: doc.status,
    folder_id: null,
    trashed: false,
    order: maxOrder + 1,
    filename: doc.filename,
  };
}

/**
 * Library route (`/`, Story 6.1 shell + Story 6.3 table + Story 6.4 bulk
 * upload): the app's front door. Fetches the collection on mount and renders
 * it as a read-only table (loading skeleton / dropzone-empty / error toast
 * per fetch state), with the bulk-upload machine (`useBulkUpload`) streaming
 * optimistic rows in as files upload.
 */
export default function LibraryPage() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [library, setLibrary] = useState<Library | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [version, setVersion] = useState<string | null>(null);
  const mountedRef = useRef(true);
  // Monotonic sequence: only the most-recently-issued `getLibrary()` may
  // apply its result, so a slow initial fetch can't land after (and clobber)
  // a faster post-batch reconcile, or vice versa.
  const fetchSeqRef = useRef(0);

  useEffect(() => {
    // StrictMode dev double-invokes effects (mount, cleanup, re-mount); reset
    // to true on setup, or the fake cleanup permanently latches this false
    // and the post-batch reconcile silently no-ops (see useBulkUpload).
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

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

  useEffect(() => {
    let cancelled = false;
    const seq = ++fetchSeqRef.current;
    getLibrary()
      .then((lib) => {
        if (!cancelled && seq === fetchSeqRef.current) setLibrary(lib);
      })
      .catch(() => {
        if (!cancelled) {
          setLoadFailed(true);
          setToast("Couldn't load your library.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleResolved = useCallback((doc: Doc) => {
    setLibrary((prev) => {
      const papers = prev?.papers ?? [];
      const row = docToRow(doc, papers);
      const existingIndex = papers.findIndex((p) => p.doc_id === doc.doc_id);
      const nextPapers =
        existingIndex >= 0 ? papers.map((p, i) => (i === existingIndex ? row : p)) : [...papers, row];
      return { papers: nextPapers, folders: prev?.folders ?? [] };
    });
  }, []);

  const handleBatchSettled = useCallback(() => {
    // One authoritative reconcile after the batch (AC-7) — not a poll.
    const seq = ++fetchSeqRef.current;
    getLibrary()
      .then((lib) => {
        if (mountedRef.current && seq === fetchSeqRef.current) {
          setLibrary(lib);
          setLoadFailed(false);
        }
      })
      .catch(() => {
        // Best-effort: each resolved upload already landed via handleResolved.
      });
  }, []);

  const handleFailed = useCallback((count: number) => {
    setToast(count === 1 ? "Couldn't add this file." : `Couldn't add ${count} files.`);
  }, []);

  const { pending, uploadFiles } = useBulkUpload({
    onResolved: handleResolved,
    onBatchSettled: handleBatchSettled,
    onFailed: handleFailed,
  });

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
            />
          ) : loadFailed ? null : (
            <EmptyDropzone onFiles={uploadFiles} />
          )}
        </main>
      </div>
      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}
