import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Plus } from "@phosphor-icons/react";
import "@/library/LibraryPage.css";
import Toast from "@/components/Toast/Toast";
import CollectionTable from "@/library/CollectionTable";
import { getLibrary, uploadDoc, type Library } from "@/api/client";

/**
 * Library route (`/`, Story 6.1 shell + Story 6.3 table): the app's front
 * door. Fetches the collection on mount and renders it as a read-only table
 * (loading skeleton / empty copy / error toast per fetch state). The Add
 * affordance is a temporary single-file bridge (uploadDoc → navigate to the
 * reader) that keeps the app usable end-to-end until Story 6.4 lands bulk
 * optimistic upload + a real dropzone.
 */
export default function LibraryPage() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [library, setLibrary] = useState<Library | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getLibrary()
      .then((lib) => {
        if (!cancelled) setLibrary(lib);
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

  const papers = library?.papers ?? [];
  const isTableLayout = loading || papers.length > 0;

  async function handleAdd(file: File) {
    if (busy) return; // single-flight, mirrors the old dropzone's guard
    setBusy(true);
    setToast(null);
    try {
      const doc = await uploadDoc(file);
      navigate(`/reader/${doc.doc_id}`);
    } catch {
      setToast("Couldn't add this file.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="library">
      <header className="library-top-bar" role="banner">
        <span className="library-top-bar__brand">Paper Mate</span>
        <button
          type="button"
          className="library-add-button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          <Plus aria-hidden />
          Add
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          className="library-add-input"
          data-testid="library-add-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            // Reset so re-picking the same file after a failure refires change.
            e.target.value = "";
            if (file) void handleAdd(file);
          }}
        />
      </header>
      <div className="library-body">
        {/* Static bounded placeholder (folder CRUD + All/Uncategorized are Epic 7). */}
        <aside className="library-folder-panel" aria-label="Folders">
          <span className="library-folder-panel__placeholder">All</span>
        </aside>
        <main className={isTableLayout ? "library-main library-main--table" : "library-main"} role="main">
          {loading ? (
            <CollectionTable loading />
          ) : papers.length > 0 ? (
            <CollectionTable rows={papers} onOpenRow={(docId) => navigate(`/reader/${docId}`)} />
          ) : loadFailed ? null : (
            <p className="library-empty-copy">No papers yet.</p>
          )}
        </main>
      </div>
      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}
