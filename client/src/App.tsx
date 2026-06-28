import { useEffect, useRef, useState } from "react";
import { ListBullets, Cards } from "@phosphor-icons/react";
import "./App.css";
import EmptyDropzone from "./EmptyDropzone";
import Reader, { type ReaderHandle } from "./Reader";
import ToolRail from "./ToolRail";
import { type ActiveTool, isAnnotationTool } from "./tools";
import ZoomControl from "./ZoomControl";
import TocPanel from "./TocPanel";
import Toast from "./Toast";
import { uploadDoc, fetchHealth, type Doc } from "./api/client";
import type { TocEntry } from "./render";

/**
 * App shell. Holds the current-doc state and switches between:
 *  - S0 (no PDF): `{component.empty-dropzone}` to drop/browse a PDF.
 *  - S1 (loaded): the reader frame (top-bar filename + the Reader's pdf-canvas +
 *    collapsed tool-rail). The Reader streams the PDF pages (Story 1.3).
 * Lightweight React state only; the Zustand annotation store arrives with
 * annotations (Epic 2/3). Chrome is overlay-laid so it never reflows (NFR-1).
 */
export default function App() {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 1-based page in view, reported by the Reader for the top-bar indicator.
  const [currentPage, setCurrentPage] = useState(1);
  // Live zoom percent, reported by the Reader for the top-bar zoom control.
  const [zoomPercent, setZoomPercent] = useState(100);
  // The single active tool (AD-11): ONE field that is the source of truth across
  // both the pointer tools (cursor/hand/box, which drive pan) and the annotation
  // tools (highlight/…, which drive marks). Because there is one field, mutual
  // exclusion is by construction — setting it disarms the previous, so a still-
  // armed hand can never eat an annotation drag (the Story 2.3 bug, now removed
  // at the cause). `panArmed` and the overlay's `armedTool` are pure derivations
  // of this (below), never stored siblings. Lives in App state (not the store,
  // which is the annotation working copy, AD-9). Sticky until V/Esc/another tool.
  const [activeTool, setActiveTool] = useState<ActiveTool>("cursor");
  const [railCollapsed, setRailCollapsed] = useState(false);
  // ToC panel: open/closed + the PDF's outline (reported up by the Reader once
  // the document is ready). `null` until the Reader reports, so the panel shows
  // a loading note instead of the no-outline empty state mid-load. Lightweight
  // React state (see the header note).
  const [tocOpen, setTocOpen] = useState(false);
  const [toc, setToc] = useState<TocEntry[] | null>(null);
  // Imperative zoom handle into the Reader (it owns `scale` + the scroll
  // container needed for focal-point zoom); the top-bar control drives it.
  const readerRef = useRef<ReaderHandle>(null);
  // App version for the top-bar badge. Single source = the backend
  // (server/pyproject.toml → GET /api/health); fetched once on mount. Stays
  // null on failure so the badge simply doesn't render.
  const [version, setVersion] = useState<string | null>(null);
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

  // Document-level tool keys (UX-DR15), mirroring the Reader's zoom-key effect:
  // `V`/`Esc` → cursor, `[` → toggle the rail. Only active while a doc is open.
  // `Space` is deliberately NOT handled here — it is a Reader-internal temp-pan
  // (a document-level Space handler would fight the scroll container). Ctrl/Alt/
  // Meta chords and editable targets are ignored so adjacent shortcuts pass.
  const docOpen = doc !== null;
  useEffect(() => {
    if (!docOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      // Exempt editable fields AND controls (SELECT/BUTTON) so a focused control
      // keeps its own keys — matches the annotations-layer `isExempt` convention
      // and AC1's document-level handler requirement (Epic-1 retro AP-1).
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.tagName === "BUTTON" ||
          t.isContentEditable)
      )
        return;
      if (e.key === "v" || e.key === "V" || e.key === "Escape") {
        e.preventDefault();
        // V/Esc → plain cursor. One setter; no second field to clear.
        setActiveTool("cursor");
      } else if (e.key === "h" || e.key === "H") {
        e.preventDefault();
        // Arm highlight. Mutual exclusion is automatic: setting `activeTool`
        // disarms whatever pointer/annotation tool was active (one tool active),
        // so a still-armed hand/box pan can't eat the highlight drag.
        setActiveTool("highlight");
      } else if (e.key === "[") {
        e.preventDefault();
        setRailCollapsed((c) => !c);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [docOpen]);

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
        <span className="top-bar__page-status" role="status" aria-live="polite">
          Page {currentPage} of {doc.page_count}
        </span>
        <div className="top-bar__actions">
          {/* Zoom control sits left of ToC (UX-DR10 revised 2026-06-28). */}
          <ZoomControl
            percent={zoomPercent}
            onZoomIn={() => readerRef.current?.zoomIn()}
            onZoomOut={() => readerRef.current?.zoomOut()}
            onReset={() => readerRef.current?.resetZoom()}
          />
          {/* ToC toggles the table-of-contents overlay (Story 1.9). Bank is
              still a focusable placeholder — behavior arrives with Story 3.6.
              Icon-only (Phosphor, matching the tool-rail idiom); the aria-label
              is the accessible name and the title is the hover tooltip. */}
          <button
            type="button"
            className="pill pill--icon"
            aria-label="Table of contents"
            title="Table of contents"
            aria-pressed={tocOpen}
            onClick={() => setTocOpen((o) => !o)}
          >
            <ListBullets aria-hidden />
          </button>
          <button
            type="button"
            className="pill pill--icon"
            aria-label="Annotation bank"
            title="Annotation bank"
          >
            <Cards aria-hidden />
          </button>
          {version && (
            <span className="top-bar__version" title="Paper Mate version">
              v{version}
            </span>
          )}
        </div>
      </header>

      <main className="stage" role="main">
        <Reader
          ref={readerRef}
          doc={doc}
          // Pan and the overlay's armed tool are pure derivations of the single
          // `activeTool` (AD-11) — no stored siblings to keep in sync.
          panArmed={activeTool === "hand"}
          armedTool={isAnnotationTool(activeTool) ? activeTool : null}
          onVisiblePageChange={setCurrentPage}
          onZoomChange={setZoomPercent}
          onOutline={setToc}
        />
        <ToolRail
          activeTool={activeTool}
          // One setter; the rail commits a tool in a single click. Mutual
          // exclusion is intrinsic to `activeTool`, so no cross-setting closures.
          onSelectTool={setActiveTool}
          collapsed={railCollapsed}
          onToggleCollapse={() => setRailCollapsed((c) => !c)}
        />
        <TocPanel
          open={tocOpen}
          entries={toc}
          onJump={(p) => {
            readerRef.current?.jumpToPage(p);
            setTocOpen(false);
          }}
          onClose={() => setTocOpen(false)}
        />
      </main>
      {toast}
    </div>
  );
}
