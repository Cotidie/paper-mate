import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Plus } from "@phosphor-icons/react";
import "@/library/LibraryPage.css";
import Toast from "@/components/Toast/Toast";
import { uploadDoc } from "@/api/client";

/**
 * Library route (`/`, Story 6.1 risk gate): the app's new front door. A
 * structural shell only, no table/folders/upload orchestration (those are
 * 6.2-6.7): a top bar, a static folder-panel placeholder, and the empty-
 * collection copy. The Add affordance is a temporary single-file bridge
 * (uploadDoc → navigate to the reader) that keeps the app usable end-to-end
 * until Story 6.4 lands bulk optimistic upload + a real dropzone.
 */
export default function LibraryPage() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd(file: File) {
    if (busy) return; // single-flight, mirrors the old dropzone's guard
    setBusy(true);
    setError(null);
    try {
      const doc = await uploadDoc(file);
      navigate(`/reader/${doc.doc_id}`);
    } catch {
      setError("Couldn't add this file.");
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
        <main className="library-main" role="main">
          <p className="library-empty-copy">No papers yet.</p>
        </main>
      </div>
      {error && <Toast message={error} onDismiss={() => setError(null)} />}
    </div>
  );
}
