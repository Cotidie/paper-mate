import { useState } from "react";
import "./App.css";
import EmptyDropzone from "./EmptyDropzone";
import Toast from "./Toast";
import { uploadDoc, type Doc } from "./api/client";

/**
 * App shell. Holds the current-doc state and switches between:
 *  - S0 (no PDF): `{component.empty-dropzone}` to drop/browse a PDF.
 *  - S1 (loaded): the reader frame (top-bar filename + reader-backdrop canvas +
 *    collapsed tool-rail) — pages render in Story 1.3.
 * Lightweight React state only; the Zustand annotation store arrives with
 * annotations (Epic 2/3). Chrome is overlay-laid so it never reflows (NFR-1).
 */
export default function App() {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleFile(file: File) {
    // Single-flight: ignore a new pick while an upload is in flight, so an
    // overlapping request can't clobber the result or fire a stale toast.
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setDoc(await uploadDoc(file));
    } catch {
      // Any load failure surfaces the same fixed copy; stay in S0 (AC-5).
      setError("Couldn't open this file.");
    } finally {
      setBusy(false);
    }
  }

  const toast = error ? <Toast message={error} onDismiss={() => setError(null)} /> : null;

  if (!doc) {
    return (
      <div className="app">
        <main className="stage" role="main">
          <EmptyDropzone onFile={handleFile} disabled={busy} />
        </main>
        {toast}
      </div>
    );
  }

  return (
    <div className="app">
      <header className="top-bar" role="banner">
        <span className="top-bar__title">{doc.filename}</span>
        <div className="top-bar__actions">
          {/* Focusable placeholders — behavior wired in later stories
              (ToC 1.7, Bank 3.6). Present now so chrome shows the focus ring. */}
          <button type="button" className="pill">
            ToC
          </button>
          <button type="button" className="pill">
            Bank
          </button>
        </div>
      </header>

      <main className="stage" role="main">
        <div className="reader-backdrop" data-testid="reader-backdrop" aria-label="PDF canvas region" />
        <aside className="tool-rail" data-testid="tool-rail" aria-label="Tools (collapsed)">
          {/* Collapsed placeholder. Tool buttons arrive in Epic 2. */}
        </aside>
      </main>
      {toast}
    </div>
  );
}
