import { useEffect, useRef, useState } from "react";
import { ListBullets, Cards } from "@phosphor-icons/react";
import "./App.css";
import EmptyDropzone from "./EmptyDropzone";
import Reader, { type ReaderHandle } from "./Reader";
import ToolRail from "./ToolRail";
import { type ActiveTool, isAnnotationTool } from "./tools";
import { useAnnotationStore } from "./store";
import ZoomControl from "./ZoomControl";
import TocPanel from "./TocPanel";
import Toast from "./Toast";
import { uploadDoc, fetchHealth, type Doc } from "./api/client";
import type { TocEntry } from "./render";
import { useAutosave } from "./useAutosave";
import SaveIndicator from "./SaveIndicator";

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
  // Box-highlight is a MODE of the Highlight tool, not its own tool (AD-11 stays
  // intact — one active tool). When true AND Highlight is active, a rectangle drag
  // makes a region highlight instead of a text-run highlight. Reset whenever the
  // active tool leaves Highlight (below) so re-arming Highlight always starts in
  // plain text mode; the Highlight flyout's toggle (or M) turns it back on.
  const [boxHighlight, setBoxHighlight] = useState(false);
  useEffect(() => {
    if (activeTool !== "highlight") setBoxHighlight(false);
  }, [activeTool]);
  // The active/default annotation color (Story 2.6) lives in the annotation store,
  // not App state: it is written from two unrelated subtrees (the rail's color
  // sub-toolbox AND the overlay's recolor-a-mark), and the create path reads it.
  // App subscribes only to pass it (and its setter) to the rail; the overlay reads
  // the store directly. It remembers the last color chosen for the session.
  const activeColor = useAnnotationStore((s) => s.activeColor);
  const setActiveColor = useAnnotationStore((s) => s.setActiveColor);
  // Story 2.8: the active pen stroke width is store-backed for the same reason as
  // activeColor (the rail's stroke-width row + the pen quick-box's restroke both
  // write it, the create path reads it). App passes it + its setter to the rail.
  const activeStrokeWidth = useAnnotationStore((s) => s.activeStrokeWidth);
  const setActiveStrokeWidth = useAnnotationStore((s) => s.setActiveStrokeWidth);
  // Story 2.13: the active pen alpha is store-backed for the same reason as
  // activeColor/activeStrokeWidth (the rail's AlphaRow + the pen quick-box's
  // realpha both write it, the create path reads it). App threads it down.
  const activeAlpha = useAnnotationStore((s) => s.activeAlpha);
  const setActiveAlpha = useAnnotationStore((s) => s.setActiveAlpha);
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

  // Autosave (Story 3.4): a passive observer of the annotation store, keyed on
  // the open doc. Always called (hooks must be unconditional); it no-ops while
  // `doc` is null (empty docId). `saveErrorDismissed` is local UI state ONLY
  // (hides the toast on dismiss) — it does NOT touch the hook's retry-on-next-
  // change behavior, and resets whenever a NEW failure occurs (status flips
  // back to "error" only after passing through "saving" again).
  const saveStatus = useAutosave(doc?.doc_id ?? "");
  const [saveErrorDismissed, setSaveErrorDismissed] = useState(false);
  useEffect(() => {
    if (saveStatus.status === "error") setSaveErrorDismissed(false);
  }, [saveStatus.status]);

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
      } else if (e.key === "u" || e.key === "U") {
        e.preventDefault();
        // Arm underline (UX-DR15). Same single-field switch as highlight.
        setActiveTool("underline");
      } else if (e.key === "d" || e.key === "D") {
        e.preventDefault();
        // Arm pen (UX-DR15: D = pen). Same single-field switch.
        setActiveTool("pen");
      } else if (e.key === "t" || e.key === "T") {
        e.preventDefault();
        // Arm memo (UX-DR15: T = memo). Same single-field switch.
        setActiveTool("memo");
      } else if (e.key === "c" || e.key === "C") {
        e.preventDefault();
        // Arm comment (UX-DR15: C = comment). Same single-field switch.
        setActiveTool("comment");
      } else if (e.key === "m" || e.key === "M") {
        e.preventDefault();
        // M = box-highlight: arm Highlight AND switch on its box mode. (Box is a
        // mode of Highlight, not a tool — the reset effect leaves it untouched
        // because activeTool becomes "highlight".)
        setActiveTool("highlight");
        setBoxHighlight(true);
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

  // One Toast at a time: load error (S0-only) takes precedence over a save
  // error (S1-only) — they never actually coexist (load-failure keeps `doc`
  // null, and autosave can't fire without a `doc_id`), but precedence is
  // explicit so that invariant isn't load-bearing.
  const toast = error ? (
    <Toast message={error} onDismiss={() => setError(null)} />
  ) : saveStatus.status === "error" && !saveErrorDismissed ? (
    <Toast
      message="Couldn't save. Changes kept in this session."
      onDismiss={() => setSaveErrorDismissed(true)}
    />
  ) : null;

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
        <SaveIndicator status={saveStatus.status} />
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
          // Box-highlight is a mode of Highlight; the overlay's box-drag gesture
          // gates on this signal (true only while Highlight is active + box mode on).
          boxActive={activeTool === "highlight" && boxHighlight}
          onVisiblePageChange={setCurrentPage}
          onZoomChange={setZoomPercent}
          onOutline={setToc}
        />
        <ToolRail
          activeTool={activeTool}
          // One setter; the rail commits a tool in a single click. Mutual
          // exclusion is intrinsic to `activeTool`, so no cross-setting closures.
          onSelectTool={setActiveTool}
          // Story 2.6: the Highlight tool's color sub-toolbox reads `activeColor`
          // and sets it via `onPickColor` (the default for new marks).
          activeColor={activeColor}
          onPickColor={setActiveColor}
          // Box-highlight mode lives under the Highlight tool's flyout (a toggle).
          boxHighlight={boxHighlight}
          onToggleBoxHighlight={() => setBoxHighlight((b) => !b)}
          // Story 2.8: the Pen tool's sub-toolbox reads activeStrokeWidth and
          // sets it via onPickStrokeWidth (the default new strokes land in).
          activeStrokeWidth={activeStrokeWidth}
          onPickStrokeWidth={setActiveStrokeWidth}
          // Story 2.13: the Pen tool's sub-toolbox reads activeAlpha and sets
          // it via onPickAlpha (the default new strokes land in).
          activeAlpha={activeAlpha}
          onPickAlpha={setActiveAlpha}
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
