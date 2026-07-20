import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { ArrowLeft, ListBullets, Cards, Eye, EyeSlash } from "@phosphor-icons/react";
import "@/reader/ReaderPage.css";
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
import { getDoc, getAnnotations, markDocOpened, fetchHealth, type Doc } from "@/api/client";
import { pageNavTarget, type TocEntry } from "@/render";
import { resolveToc } from "@/structure";
import { useDocStructure } from "@/structure/useDocStructure";
import { flashRegionAt } from "@/reader/regionFlash";
import { useAutosave } from "@/hooks/useAutosave";
import SaveIndicator from "@/components/SaveIndicator/SaveIndicator";
import StructureStatusDot from "@/components/StructureStatusDot/StructureStatusDot";
import { matchAction } from "@/settings/keymap";
import { useSettingsStore } from "@/settings/store";
import SettingsModal from "@/settings/SettingsModal";
import { isEditableTarget } from "@/lib/domFocus";

/** Structure-analysis poll cadence (top-bar "analyzing" indicator): matches the
 *  Library's settle poll (1.2s, capped) so a paper opened mid-analysis clears
 *  its indicator + refills its ToC without hammering the backend. */
const STRUCTURE_POLL_INTERVAL_MS = 1200;
const STRUCTURE_POLL_MAX = 60;

/**
 * Reader route (`/reader/:docId`, Story 6.1). Loads its document from the URL
 * param instead of an upload result: the former S0/S1 App split is gone (S0 is
 * now the Library route); this component IS the former S1 body, unchanged.
 * Lightweight React state only; the Zustand annotation store arrives with
 * annotations (Epic 2/3). Chrome is overlay-laid so it never reflows (NFR-1).
 */
export default function ReaderPage() {
  const { docId } = useParams<{ docId: string }>();
  const navigate = useNavigate();
  const [doc, setDoc] = useState<Doc | null>(null);
  // 1-based page in view, reported by the Reader for the top-bar indicator.
  const [currentPage, setCurrentPage] = useState(1);
  // The page last REQUESTED via Prev/Next, tracked separately from the
  // observed `currentPage` above. `currentPage` only advances once the
  // Reader's smooth-scroll animation has visibly crossed a page boundary
  // (IntersectionObserver + rAF), which lags a fast click. Deriving the next
  // target from `currentPage` meant a second Prev/Next click fired mid-animation
  // recomputed the SAME target the first click already requested (the scroll
  // was already animating there, so the repeat call was a no-op) — clicking
  // twice during the animation silently only advanced one page. Kept in sync
  // with `currentPage` below for jumps that don't originate from these
  // buttons (manual scroll, ToC, Bank).
  const pendingPageRef = useRef(1);
  useEffect(() => {
    pendingPageRef.current = currentPage;
  }, [currentPage]);
  // Live zoom percent, reported by the Reader for the top-bar zoom control.
  const [zoomPercent, setZoomPercent] = useState(100);
  // The single active tool (AD-11): ONE field that is the source of truth across
  // both the pointer tools (cursor/hand/box, which drive pan) and the annotation
  // tools (highlight/…, which drive marks). Because there is one field, mutual
  // exclusion is by construction — setting it disarms the previous, so a still-
  // armed hand can never eat an annotation drag (the Story 2.3 bug, now removed
  // at the cause). `panArmed` and the overlay's `armedTool` are pure derivations
  // of this (below), never stored siblings. Lives in ReaderPage state (not the
  // store, which is the annotation working copy, AD-9). Sticky until V/Esc/another tool.
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
  // Box-comment (Story 8.4) is the Comment tool's twin of box-highlight: a MODE,
  // not its own tool. When true AND Comment is active, a rectangle drag makes a
  // region comment instead of a text-run comment / click pin. Reset whenever the
  // active tool leaves Comment (below) so re-arming Comment always starts in
  // plain text mode; the Comment flyout's Text/Box picker turns it back on (no
  // hotkey, D4).
  const [boxComment, setBoxComment] = useState(false);
  useEffect(() => {
    if (activeTool !== "comment") setBoxComment(false);
  }, [activeTool]);
  // The active/default annotation color, PER TOOL (Story 2.6, split per-tool by
  // user request), lives in the annotation store, not ReaderPage state: it is
  // written from two unrelated subtrees (the rail's color sub-toolbox AND the
  // overlay's recolor-a-mark), and the create paths read it. ReaderPage
  // subscribes only to pass it (and its setter) to the rail; the overlay reads
  // the store directly. Each tool remembers its own last-chosen color for the
  // session.
  const activeColors = useAnnotationStore((s) => s.activeColors);
  const setActiveColor = useAnnotationStore((s) => s.setActiveColor);
  // Story 2.8: the active pen stroke width is store-backed for the same reason as
  // activeColors (the rail's stroke-width row + the pen quick-box's restroke both
  // write it, the create path reads it). ReaderPage passes it + its setter to
  // the rail.
  const activeStrokeWidth = useAnnotationStore((s) => s.activeStrokeWidth);
  const setActiveStrokeWidth = useAnnotationStore((s) => s.setActiveStrokeWidth);
  // Story 2.13: the active pen alpha is store-backed for the same reason as
  // activeColors/activeStrokeWidth (the rail's AlphaRow + the pen quick-box's
  // realpha both write it, the create path reads it). ReaderPage threads it down.
  const activeAlpha = useAnnotationStore((s) => s.activeAlpha);
  const setActiveAlpha = useAnnotationStore((s) => s.setActiveAlpha);
  // Hide-all toggle (Story 5.5, FR-23): a view-only flag read here only for the
  // top-bar pill button itself; AnnotationLayer/AnnotationInteraction read it
  // directly from the store (no prop-drilling).
  const hidden = useAnnotationStore((s) => s.hidden);
  const toggleHidden = useAnnotationStore((s) => s.toggleHidden);
  const select = useAnnotationStore((s) => s.select);
  const [railCollapsed, setRailCollapsed] = useState(false);
  // Settings modal (Story 5.1): ReaderPage owns open/closed, same pattern as
  // tocOpen/bankOpen. Threaded to ToolRail's Gear trigger and SettingsModal.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const keymap = useSettingsStore((s) => s.keymap);
  // ToC panel: open/closed + the PDF's outline (reported up by the Reader once
  // the document is ready). `null` until the Reader reports, so the panel shows
  // a loading note instead of the no-outline empty state mid-load. Lightweight
  // React state (see the header note).
  const [tocOpen, setTocOpen] = useState(false);
  const [toc, setToc] = useState<TocEntry[] | null>(null);
  // Story 10.2: the structure layer's headings feed the synthesized-ToC
  // fallback (embedded outline wins when present, FR-35). Fetched independently
  // of `toc` (the embedded outline); `resolveToc` below decides which source
  // the panel actually shows.
  const { structure, loading: structureLoading, refetch: refetchStructure } =
    useDocStructure(docId ?? null);
  // The doc_id whose ToC we've already refilled once after it settled to
  // "ready" (a one-shot guard so a genuinely-empty structure never loops a
  // refetch, and a cross-doc late response can't retrigger it). Compared to the
  // current docId, so a new doc is naturally eligible again.
  const structureRefilledRef = useRef<string | null>(null);
  // The panel's actual entries: `null` (the loading state) only while a source
  // could still resolve AND nothing is renderable yet — `toc` itself loading,
  // or `toc` empty with the structure fetch in flight and NO held structure to
  // show. A same-doc refetch (the post-analysis ToC refill) keeps the held
  // structure, so we must NOT blank a populated ToC back to "loading" just
  // because `structureLoading` is briefly true again. Once settled, `resolveToc`
  // picks embedded (if non-empty) else the synthesized fallback (may be `[]`,
  // the existing empty state).
  const tocEntries: TocEntry[] | null =
    toc === null || (toc.length === 0 && structureLoading && structure.elements.length === 0)
      ? null
      : resolveToc(toc, structure, doc?.title);
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
  // annotation store, bound to `store.docId` (not this component's own `doc`
  // state). Always called (hooks must be unconditional); it no-ops while no doc
  // is open. `saveErrorDismissed` is local UI state ONLY (hides the toast on
  // dismiss) — it does NOT touch the hook's retry-on-next-change behavior, and
  // resets whenever a NEW failure occurs (status flips back to "error" only
  // after passing through "saving" again).
  const saveStatus = useAutosave();
  const [saveErrorDismissed, setSaveErrorDismissed] = useState(false);
  useEffect(() => {
    if (saveStatus.status === "error") setSaveErrorDismissed(false);
  }, [saveStatus.status]);

  // Param-driven load (Story 6.1, replaces the old upload-driven `handleFile`).
  // The hydrate-before-mount ordering is load-bearing (Story 3.5 anti-clobber,
  // AC-4): both awaits run while `store.docId` is still null, so `useAutosave`
  // is inert; `openDoc` sets `docId` + populates the store atomically + clears
  // undo history BEFORE `setDoc` flips the reader on, so autosave's baseline
  // run captures the ALREADY-restored set (restore is never PUT back and is
  // not undoable). Do NOT move hydration into a Reader child effect (its
  // baseline would capture the empty set). On failure (bad/unknown `:docId`,
  // or a `getAnnotations` failure), keep the store empty and navigate back to
  // the Library rather than clobbering it (AC-5 equivalent).
  useEffect(() => {
    if (!docId) return;
    let live = true;
    setDoc(null);
    // Reset the embedded outline on a direct `:docId` change (Codex review):
    // doc A's non-empty outline must not stay authoritative until B's Reader
    // reports its own — else A's ToC briefly renders for B. `null` = loading.
    setToc(null);
    (async () => {
      try {
        const [meta, restored] = await Promise.all([getDoc(docId), getAnnotations(docId)]);
        if (!live) return;
        openDoc(docId, restored);
        setDoc(meta);
        // Best-effort last_opened touch (Story 6.7, AC-4/AC-8): fire-and-forget,
        // never gates the reader or reaches the redirect-on-hydrate-failure catch.
        if (live) markDocOpened(docId).catch(() => {});
      } catch {
        if (live) navigate("/", { replace: true });
      }
    })();
    return () => {
      live = false;
    };
  }, [docId, navigate]);

  // Structure-analysis poll (the top-bar "analyzing" indicator). A paper opened
  // right after import can still be running its opendataloader structure pass;
  // `getDoc` reports `structure_status: "analyzing"` until `structure.json`
  // lands. Poll the doc while analyzing so (a) the indicator clears on its own
  // and (b) the ToC/consumers refill the moment analysis finishes.
  //
  // SINGLE-FLIGHT + generation-guarded (Codex review): a self-scheduling
  // `setTimeout` that AWAITS each `getDoc` before scheduling the next, so two
  // requests never overlap and an older `analyzing` response can't land after a
  // newer `ready` and regress the dot. The `cancelled` flag (set on cleanup,
  // i.e. a docId/status change or unmount) makes any in-flight response a no-op,
  // so a late response for a doc we've switched away from never calls `setDoc`
  // or `refetchStructure`. Depends on the STRING status, so a poll returning an
  // unchanged `analyzing` doesn't restart the loop.
  const structureStatus = doc?.structure_status;
  useEffect(() => {
    if (!docId || structureStatus !== "analyzing") return;
    let cancelled = false;
    let polls = 0;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const fresh = await getDoc(docId);
        if (cancelled) return; // switched docs / unmounted mid-request
        setDoc((prev) => (prev && prev.doc_id === fresh.doc_id ? fresh : prev));
        if (fresh.structure_status === "ready") {
          if (structureRefilledRef.current !== docId) {
            structureRefilledRef.current = docId;
            refetchStructure(); // refill the ToC now that structure.json exists
          }
          return; // settled -> stop polling
        }
      } catch {
        // Transient; keep polling until it resolves or the cap is hit.
      }
      if (!cancelled && polls++ < STRUCTURE_POLL_MAX) {
        timer = setTimeout(tick, STRUCTURE_POLL_INTERVAL_MS);
      }
    };
    timer = setTimeout(tick, STRUCTURE_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [docId, structureStatus, refetchStructure]);

  // Initial-ready refill (Codex review M3): a paper can be opened just AFTER its
  // analysis finished — `useDocStructure` may have fetched an empty structure
  // while the pass was still running, then `getDoc` returns "ready", so the poll
  // above never runs and the ToC would stay empty until a reload. When the doc
  // is settled "ready" but the held structure is empty, refetch it ONCE (the
  // ref guards against a genuinely-empty paper looping).
  useEffect(() => {
    if (!docId || structureStatus !== "ready" || structureLoading) return;
    if (structure.elements.length > 0) return; // already have it
    if (structureRefilledRef.current === docId) return; // one-shot per doc
    structureRefilledRef.current = docId;
    refetchStructure();
  }, [docId, structureStatus, structureLoading, structure.elements.length, refetchStructure]);

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

  // Annotation Bank row click (Story 3.6, AC-4, revised by user fix request):
  // jump the canvas to the mark's page + fractional position, flash it, AND
  // select it, same as clicking the mark directly on the page — its quick-box
  // opens and Delete/recolor/etc. all work from the Bank click, not just a
  // direct on-page click. The panel itself stays open (Open Q1: a review
  // surface, not one-shot navigation like the ToC).
  function handleBankJump(item: BankItem) {
    readerRef.current?.jumpToAnnotation(item.pageIndex, item.topFraction);
    flashAnnotation(item.id);
    select(item.id);
  }

  // Save-failure toast only (Story 3.4, AC-5): an open FAILURE no longer stays
  // on this route to show a toast, it redirects to the Library (see the load
  // effect above), so there is only ever the save-error case to surface here.
  const toast =
    saveStatus.status === "error" && !saveErrorDismissed ? (
      <Toast
        message="Couldn't save. Changes kept in this session."
        onDismiss={() => setSaveErrorDismissed(true)}
      />
    ) : null;

  if (!doc) return null;

  return (
    <div className="app">
      <header className="top-bar" role="banner">
        {/* Three-column grid: lead cluster (left) / page nav (center) / actions
            (right). The lead's title truncates (min-width:0) so a long filename
            can never overlap the centered page nav. */}
        <div className="top-bar__lead">
          {/* Back-to-Library (Story 6.1, LFR-20): far left of the lead cluster. */}
          <button
            type="button"
            className="pill pill--icon"
            aria-label="Back to library"
            title="Back to library"
            onClick={() => navigate("/")}
          >
            <ArrowLeft aria-hidden />
          </button>
          <span className="top-bar__title">{doc.filename}</span>
          {/* Persistent structure-state dot trailing the filename: grey (absent)
              -> amber pulsing (analyzing) -> green (analyzed). The poll above
              flips it to green and refills the ToC when analysis lands. */}
          <StructureStatusDot status={doc.structure_status} className="top-bar__structure-dot" />
          <SaveIndicator status={saveStatus.status} />
        </div>
        {/* Centered page nav (grid middle column). Prev/next drive the Reader's
            page jump; the carets disable at the first/last page. */}
        <PageIndicator
          currentPage={currentPage}
          pageCount={doc.page_count}
          onPrev={() => {
            const target = pageNavTarget(pendingPageRef.current, -1, doc.page_count);
            pendingPageRef.current = target;
            readerRef.current?.jumpToPage(target);
          }}
          onNext={() => {
            const target = pageNavTarget(pendingPageRef.current, 1, doc.page_count);
            pendingPageRef.current = target;
            readerRef.current?.jumpToPage(target);
          }}
          onJump={(page) => {
            const target = pageNavTarget(page, 0, doc.page_count);
            pendingPageRef.current = target;
            readerRef.current?.jumpToPage(target);
          }}
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
          // Box mode is a mode of its tool (Highlight's box-highlight or Comment's
          // box-comment, Story 8.4); the overlay's box-drag gesture gates on this
          // single derived signal. Both are modes of DIFFERENT tools, so they are
          // mutually exclusive for free (only one `activeTool` is ever active).
          boxMode={
            activeTool === "highlight" && boxHighlight
              ? "highlight"
              : activeTool === "comment" && boxComment
                ? "comment"
                : null
          }
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
          // Box-comment mode (Story 8.4) lives under the Comment tool's flyout,
          // the same toggle pattern as box-highlight.
          boxComment={boxComment}
          onSetBoxComment={setBoxComment}
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
          entries={tocEntries}
          onJump={(entry) => {
            // A synthesized entry (Story 10.2) carries a region: land on the
            // exact heading and flash it, the same jump+flash mechanic the
            // Annotation Bank uses. An embedded-outline entry has no region
            // (Story 1.9, unchanged) and keeps the plain page-top jump.
            if (entry.rect) {
              const pageIndex = entry.pageNumber - 1;
              readerRef.current?.jumpToAnnotation(pageIndex, entry.rect.y0);
              flashRegionAt(pageIndex, entry.rect);
            } else {
              readerRef.current?.jumpToPage(entry.pageNumber);
            }
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
