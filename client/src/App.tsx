import { useEffect, useRef, useState } from "react";
import { ListBullets, Cards, Eye, EyeSlash } from "@phosphor-icons/react";
import "@/App.css";
import EmptyDropzone from "@/components/EmptyDropzone/EmptyDropzone";
import Reader, { type ReaderHandle } from "@/components/Reader/Reader";
import ToolRail from "@/components/ToolRail/ToolRail";
import { type ActiveTool, isAnnotationTool } from "@/lib/tools";
import { useAnnotationStore, openDoc, flashAnnotation } from "@/store";
import ZoomControl from "@/components/ZoomControl/ZoomControl";
import PageIndicator from "@/components/PageIndicator/PageIndicator";
import TocPanel from "@/components/TocPanel/TocPanel";
import BankPanel from "@/components/BankPanel/BankPanel";
import type { BankItem } from "@/lib/bank";
import Toast from "@/components/Toast/Toast";
import { uploadDoc, getAnnotations, fetchHealth, type Doc } from "@/api/client";
import type { TocEntry } from "@/render";
import { useAutosave } from "@/hooks/useAutosave";
import SaveIndicator from "@/components/SaveIndicator/SaveIndicator";
import { matchAction } from "@/settings/keymap";
import { useSettingsStore } from "@/settings/store";
import SettingsModal from "@/settings/SettingsModal";
import { isEditableTarget } from "@/lib/domFocus";

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
  // The active/default annotation color, PER TOOL (Story 2.6, split per-tool by
  // user request), lives in the annotation store, not App state: it is written
  // from two unrelated subtrees (the rail's color sub-toolbox AND the overlay's
  // recolor-a-mark), and the create paths read it. App subscribes only to pass it
  // (and its setter) to the rail; the overlay reads the store directly. Each tool
  // remembers its own last-chosen color for the session.
  const activeColors = useAnnotationStore((s) => s.activeColors);
  const setActiveColor = useAnnotationStore((s) => s.setActiveColor);
  // Story 2.8: the active pen stroke width is store-backed for the same reason as
  // activeColors (the rail's stroke-width row + the pen quick-box's restroke both
  // write it, the create path reads it). App passes it + its setter to the rail.
  const activeStrokeWidth = useAnnotationStore((s) => s.activeStrokeWidth);
  const setActiveStrokeWidth = useAnnotationStore((s) => s.setActiveStrokeWidth);
  // Story 2.13: the active pen alpha is store-backed for the same reason as
  // activeColors/activeStrokeWidth (the rail's AlphaRow + the pen quick-box's
  // realpha both write it, the create path reads it). App threads it down.
  const activeAlpha = useAnnotationStore((s) => s.activeAlpha);
  const setActiveAlpha = useAnnotationStore((s) => s.setActiveAlpha);
  // Hide-all toggle (Story 5.5, FR-23): a view-only flag read here only for the
  // top-bar pill button itself; AnnotationLayer/AnnotationInteraction read it
  // directly from the store (no prop-drilling).
  const hidden = useAnnotationStore((s) => s.hidden);
  const toggleHidden = useAnnotationStore((s) => s.toggleHidden);
  const [railCollapsed, setRailCollapsed] = useState(false);
  // Settings modal (Story 5.1): App owns open/closed, same pattern as
  // tocOpen/bankOpen. Threaded to ToolRail's Gear trigger and SettingsModal.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const keymap = useSettingsStore((s) => s.keymap);
  // ToC panel: open/closed + the PDF's outline (reported up by the Reader once
  // the document is ready). `null` until the Reader reports, so the panel shows
  // a loading note instead of the no-outline empty state mid-load. Lightweight
  // React state (see the header note).
  const [tocOpen, setTocOpen] = useState(false);
  const [toc, setToc] = useState<TocEntry[] | null>(null);
  // Annotation Bank panel (Story 3.6): open/closed only — its row list is
  // store-owned and read directly by BankPanel (unlike ToC's App-owned outline).
  const [bankOpen, setBankOpen] = useState(false);
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

  // Autosave (Story 3.4, doc-scoped per Story 5.8): a passive observer of the
  // annotation store, bound to `store.docId` (not App's own `doc` state).
  // Always called (hooks must be unconditional); it no-ops while no doc is
  // open. `saveErrorDismissed` is local UI state ONLY (hides the toast on
  // dismiss) — it does NOT touch the hook's retry-on-next-change behavior, and
  // resets whenever a NEW failure occurs (status flips back to "error" only
  // after passing through "saving" again).
  const saveStatus = useAutosave();
  const [saveErrorDismissed, setSaveErrorDismissed] = useState(false);
  useEffect(() => {
    if (saveStatus.status === "error") setSaveErrorDismissed(false);
  }, [saveStatus.status]);

  // Document-level tool keys (UX-DR15), unified onto the keymap (Story 5.1,
  // AC-1): ONE effect resolves the pressed key/chord to an action via
  // `matchAction`, replacing the old inline `e.key === "…"` literals AND the
  // separate Ctrl B effect (`toggleBank` is now just another keymap chord).
  // Only active while a doc is open, and entirely suppressed while the
  // Settings modal is open (so a captured rebind key never leaks through to
  // arm a tool behind the modal). `Escape` stays hard-coded and reserved: it
  // always returns to cursor and is never routed through the keymap, so a
  // rebind can never remove it. `Space` is deliberately NOT handled here — it
  // is a Reader-internal temp-pan (a document-level Space handler would fight
  // the scroll container). Alt/Meta chords are ignored (keymap bindings
  // support only a Ctrl modifier) and only EDITABLE targets are exempt, not
  // buttons (see `domFocus.ts`): a plain BUTTON (e.g. the last-clicked
  // tool-rail button, still focused after its click) has no native meaning
  // for a letter/Ctrl chord or Escape to defer to, so hotkeys must still fire
  // — matching `useUndoRedo`'s existing precedent, NOT the click-oriented
  // `isExempt` (bug: a stale focus ring silently ate every hotkey, including
  // Escape, until the user clicked elsewhere).
  const docOpen = doc !== null;
  useEffect(() => {
    if (!docOpen || settingsOpen) return;
    // A hotkey deliberately fires even while a tool-rail button still holds
    // stale DOM focus from its last click (see the header note above), but
    // that leftover focus makes the browser's native `:focus-visible` ring
    // (index.css, UX-DR17) latch onto the button on the very next keypress —
    // the WHATWG heuristic treats a keyboard event on a focused element as
    // "now being used via keyboard" and switches the ring on. Nothing then
    // ever un-focuses the button, so the ring visually outlives whatever
    // tool state it was showing (e.g. a lingering border after Esc disarms
    // it). Blurring on every HANDLED key (Escape or a matched action, never
    // an unrecognized keystroke) drops that stale focus so the ring can't
    // latch on to begin with; hotkeys are unaffected since this listener is
    // document-level and never depended on which element holds focus.
    const clearStaleFocus = () => (document.activeElement as HTMLElement | null)?.blur?.();
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.metaKey) return;
      if (isEditableTarget(e.target)) return;
      if (e.key === "Escape") {
        e.preventDefault();
        clearStaleFocus();
        // Fallback rung only (Story 5.6, layered Esc): defer to a more-local
        // rung (the overlay's selection-clear) when a mark is selected, so a
        // single Esc never both clears the selection AND disarms the tool.
        const { selectedId, multiSelectedIds } = useAnnotationStore.getState();
        if (selectedId || multiSelectedIds.length > 0) return;
        setActiveTool("cursor");
        return;
      }
      const action = matchAction(keymap, e);
      if (!action) return;
      e.preventDefault();
      clearStaleFocus();
      switch (action) {
        case "cursor":
          // Same setter as Escape; no second field to clear.
          setActiveTool("cursor");
          break;
        case "highlight":
          // Mutual exclusion is automatic: setting `activeTool` disarms
          // whatever pointer/annotation tool was active (one tool active), so
          // a still-armed hand/box pan can't eat the highlight drag.
          setActiveTool("highlight");
          break;
        case "underline":
          setActiveTool("underline");
          break;
        case "pen":
          setActiveTool("pen");
          break;
        case "memo":
          setActiveTool("memo");
          break;
        case "comment":
          setActiveTool("comment");
          break;
        case "boxHighlight":
          // Arm Highlight AND switch on its box mode. (Box is a mode of
          // Highlight, not a tool — the reset effect leaves it untouched
          // because activeTool becomes "highlight".)
          setActiveTool("highlight");
          setBoxHighlight(true);
          break;
        case "toggleRail":
          setRailCollapsed((c) => !c);
          break;
        case "toggleBank":
          setBankOpen((o) => !o);
          break;
      }
    };
    // Capture phase (Codex HIGH, Story 5.6): this effect re-registers whenever
    // `settingsOpen`/`keymap` changes (e.g. open then close Settings while a
    // mark stays selected). Bubble-phase order between independently-mounted
    // document listeners follows attachment time, not source order in the
    // tree, so a re-attach here can land this handler in a different relative
    // position vs. the overlay's own bubble-phase selection listeners
    // (`useSelection`/`useMultiSelectGesture`) than the "usual" case this
    // story's Dev Notes assumed — breaking the layered-Esc ladder in ways
    // that ranged from a resurfaced double-action to Esc going fully inert
    // (confirmed by reverting this line locally: the regression test below
    // failed with `selectedId` never clearing at all). Capture always runs
    // before any bubble-phase listener on the same target regardless of
    // attachment order, so this handler is guaranteed to evaluate against
    // PRE-mutation state and defer correctly every time — the ladder no
    // longer depends on registration order at all.
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [docOpen, settingsOpen, keymap]);

  // Annotation Bank row click (Story 3.6, AC-4): jump the canvas to the mark's
  // page + fractional position, then flash it. Flash only — no `select` (that
  // would leave the mark in an edit-frame/quick-box state, heavier than a
  // review click warrants, Open Q2). The panel itself stays open (Open Q1: a
  // review surface, not one-shot navigation like the ToC).
  function handleBankJump(item: BankItem) {
    readerRef.current?.jumpToAnnotation(item.pageIndex, item.topFraction);
    flashAnnotation(item.id);
  }

  async function handleFile(file: File) {
    // Single-flight: ignore a new pick while an upload is in flight, so an
    // overlapping request can't clobber the result or fire a stale toast.
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      // Hydrate-on-open ordering is load-bearing (Story 3.5, AC-4). Both awaits
      // run while `store.docId` is still null, so `useAutosave` (bound to
      // `store.docId`) is inert. openDoc sets `docId` + populates the store
      // atomically + clears undo history BEFORE `setDoc` flips the reader on,
      // so autosave's baseline run captures the ALREADY-restored set — restore
      // is never PUT back and is not undoable. A failure of either await lands
      // in the catch: `doc` stays null, the store stays empty, and the next
      // session can't clobber disk (AC-5). Do NOT move hydration into a Reader
      // effect (baseline would capture the empty set).
      const opened = await uploadDoc(file);
      const restored = await getAnnotations(opened.doc_id);
      openDoc(opened.doc_id, restored);
      setDoc(opened);
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
        {/* Three-column grid: lead cluster (left) / page nav (center) / actions
            (right). The lead's title truncates (min-width:0) so a long filename
            can never overlap the centered page nav. */}
        <div className="top-bar__lead">
          <span className="top-bar__title">{doc.filename}</span>
          <SaveIndicator status={saveStatus.status} />
        </div>
        {/* Centered page nav (grid middle column). Prev/next drive the Reader's
            page jump; the carets disable at the first/last page. */}
        <PageIndicator
          currentPage={currentPage}
          pageCount={doc.page_count}
          onPrev={() => readerRef.current?.jumpToPage(Math.max(1, currentPage - 1))}
          onNext={() => readerRef.current?.jumpToPage(Math.min(doc.page_count, currentPage + 1))}
        />
        <div className="top-bar__actions">
          {/* Zoom control sits left of ToC (UX-DR10 revised 2026-06-28). */}
          <ZoomControl
            percent={zoomPercent}
            onZoomIn={() => readerRef.current?.zoomIn()}
            onZoomOut={() => readerRef.current?.zoomOut()}
            onReset={() => readerRef.current?.resetZoom()}
          />
          {/* ToC toggles the table-of-contents overlay (Story 1.9); Bank toggles
              the Annotation Bank overlay (Story 3.6). Icon-only (Phosphor,
              matching the tool-rail idiom); the aria-label is the accessible
              name and the title is the hover tooltip. */}
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
            aria-pressed={bankOpen}
            onClick={() => setBankOpen((o) => !o)}
          >
            <Cards aria-hidden />
          </button>
          {/* Hide/show ALL annotations (Story 5.5, FR-23): ONE global view-only
              flag, same pill idiom as ToC/Bank. Toggling OFF hides every mark
              (nothing painted, nothing interactive, text stays selectable);
              ON restores everything unchanged. Never mutates annotations. */}
          <button
            type="button"
            className="pill pill--icon"
            aria-label={hidden ? "Show annotations" : "Hide annotations"}
            title={hidden ? "Show annotations" : "Hide annotations"}
            aria-pressed={hidden}
            onClick={() => toggleHidden()}
          >
            {hidden ? <EyeSlash aria-hidden /> : <Eye aria-hidden />}
          </button>
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
          // Box-select (user feature request) is its own POINTER tool (Cursor's
          // flyout, not a mode of another tool); the overlay's marquee gesture
          // gates on this signal.
          multiSelectActive={activeTool === "boxSelect"}
          onVisiblePageChange={setCurrentPage}
          onZoomChange={setZoomPercent}
          onOutline={setToc}
        />
        <ToolRail
          activeTool={activeTool}
          // One setter; the rail commits a tool in a single click. Mutual
          // exclusion is intrinsic to `activeTool`, so no cross-setting closures.
          onSelectTool={setActiveTool}
          // Story 2.6: each tool's color sub-toolbox reads its OWN entry in
          // `activeColors` and sets it via `onPickColor(tool, token)` (the default
          // for that tool's new marks; per-tool split by user request).
          activeColors={activeColors}
          onPickColor={setActiveColor}
          // Box-highlight mode lives under the Highlight tool's flyout (a toggle).
          boxHighlight={boxHighlight}
          onSetBoxHighlight={setBoxHighlight}
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
          onOpenSettings={() => setSettingsOpen(true)}
        />
        <SettingsModal
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          version={version}
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
        <BankPanel
          open={bankOpen}
          docId={doc.doc_id}
          onJump={handleBankJump}
          onClose={() => setBankOpen(false)}
        />
      </main>
      {toast}
    </div>
  );
}
