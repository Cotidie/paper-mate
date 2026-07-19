// annotations/gestures/useLiveSelectionPreview — the live (pre-release) half
// of the CREATE quick-box's text-selection preview (Story 10.1). Native
// `::selection` is suppressed (Reader.css): a pdf.js glyph span can overlap
// its neighbor's client rect by a sub-pixel amount (most often a
// sentence/word-ending punctuation span followed by its trailing whitespace
// span), and the browser paints `::selection` PER SPAN, so two overlapping
// translucent backgrounds compound into a visibly darker patch this app's
// CSS cannot merge or flatten. This hook replaces the visual entirely with
// the SAME `anchor/` geometry pipeline (`rectsFromSelection` -> `mergeRects`
// via `pendingSelectionGeometry` -> `viewportRectsFromPages`) the post-
// release pending preview already uses, so mid-drag and just-after-release
// paint pixel-identically (AC-1: one uniform tint, no release "thickening").
//
// Mirrors `useCreateQuickBox`'s `computePendingGeometry` split (bug fix: an
// earlier version re-read raw `window.getSelection()` pixel rects on every
// tick, which broke two ways a plain "read fresh every render" cannot avoid):
//   - Zoom mid-drag: pdf.js swaps the text-layer DOM at the new scale
//     ASYNCHRONOUSLY, so there is a window where `scale` has already updated
//     but the glyph spans on screen still reflect the OLD scale. Normalizing
//     old-scale pixels against the new scale produces a WRONG position/size,
//     not just a stale one (live-verified: a single zoom tick jumped the
//     preview to a garbage position before the selection even collapsed).
//   - Scroll mid-drag during a SnapController-driven empty-space drag
//     (Story 8.8/8.11): `SnapController.onScroll` ALSO reacts to the same
//     `scroll` event, asynchronously (rAF-throttled) re-resolving the
//     selection via `setBaseAndExtent` against the new scroll position — which
//     itself fires a genuine `selectionchange`. A second, independent raw-pixel
//     recompute driven directly off `scroll` raced this: it painted the
//     pre-resolve position immediately, then the corrected one a frame later,
//     reading as the selection oscillating up and down while scrolling.
//
// The fix for both: convert the LIVE selection's raw pixel rects into
// normalized (scale-independent) fractions via `rectsFromSelection` ONLY on
// `selectionchange` — the one moment the Selection object itself is known to
// have just changed, which is the only place a raw-pixel read is safe (an
// empty result there just means "nothing selected," never a mis-scaled
// garbage rect). Store that snapshot; every OTHER render (scroll/resize/a
// `scale` prop change propagating down from a re-rendering parent) just
// RE-PROJECTS the stored snapshot against the CURRENT card positions/scale —
// the exact same two-step split `computePendingGeometry` already uses for the
// post-release phase, which has none of these races because it never re-reads
// raw DOM pixels after the initial capture either.

import { useEffect, useState, type RefObject } from "react";
import {
  rectsFromSelection,
  pendingSelectionGeometry,
  viewportRectsFromPages,
  type PageCardRef,
  type PageSelection,
  type ScreenRect,
} from "@/anchor";
import { useLiveRef } from "@/hooks/useLiveRef";

/** Whether `selection` is entirely inside a rendered PDF text layer — i.e.
 *  this is a selection of PAPER text, not some other selectable UI text (a
 *  comment's textarea, a memo body) whose rendered position might still
 *  happen to overlap a page card's screen bounds (code review finding:
 *  `pickPage` filters by geometry, not by DOM origin, so a false positive
 *  there would otherwise paint a spurious tint over unrelated chrome).
 *  Checks the FIRST range's `commonAncestorContainer` — the deepest node
 *  containing the WHOLE range — rather than just `selection.anchorNode`
 *  (only one endpoint, and direction-dependent): a selection that starts
 *  inside the text layer but is dragged out past it must NOT pass. `.textLayer`
 *  alone (not `.pdf-canvas .textLayer`) is enough: every real text layer is
 *  always inside a `.pdf-canvas`, so the ancestor adds no discriminating
 *  power here, only a second class name to require. */
function isPdfTextSelection(selection: Selection): boolean {
  const container = selection.getRangeAt(0).commonAncestorContainer;
  const el = container instanceof Element ? container : container.parentElement;
  return !!el?.closest(".textLayer");
}

export function useLiveSelectionPreview(opts: {
  /** Off while a gesture other than a plain text drag owns the selection
   *  (the pending quick-box is already open, a box-mode drag, pen/memo
   *  armed) or the overlay itself is inactive/hidden. */
  enabled: boolean;
  /** True while a takeover gesture (pen/memo/box-mode/multi-select) owns the
   *  pointer instead of a plain text drag — see the caller
   *  (`AnnotationInteraction.tsx`) for why this is a SEPARATE signal from
   *  `enabled` rather than derived from it: `enabled` also goes false on the
   *  `pending` transition (cursor-mode release), which must NOT clear the
   *  selection (Ctrl+C preservation), whereas a genuine takeover should —
   *  its gesture has its own path and never reads the selection, so a
   *  lingering one would otherwise sit stale (invisible, since native
   *  `::selection` is suppressed) until the user switches back and sees an
   *  out-of-date preview (code review finding). */
  takeoverActive: boolean;
  getPagesRef: RefObject<() => PageCardRef[]>;
  scaleRef: RefObject<number>;
  /** Test seam: how a text-node sub-range yields client rects (mirrors
   *  `rectsFromSelection`'s own `rectReader` param; jsdom has no layout). */
  rectReaderRef?: RefObject<((r: Range) => ArrayLike<DOMRect>) | undefined>;
}): ScreenRect[] {
  const { enabled, takeoverActive, getPagesRef, scaleRef, rectReaderRef } = opts;
  const takeoverActiveRef = useLiveRef(takeoverActive);
  // The normalized snapshot, captured ONLY on a genuine `selectionchange`
  // (never re-derived from raw DOM pixels anywhere else in this hook).
  const [snapshot, setSnapshot] = useState<PageSelection[] | null>(null);
  const snapshotRef = useLiveRef(snapshot);
  // A pure re-render trigger for scroll/resize: the rects it produces are
  // computed fresh below from `snapshot` + the CURRENT card positions, not
  // from any state this bump writes.
  const [, bumpReposition] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setSnapshot(null);
      // A takeover (not the `pending` transition — see the param doc above)
      // clears the now-orphaned selection so it can't linger stale.
      if (takeoverActiveRef.current) window.getSelection()?.removeAllRanges();
      return;
    }
    // Coalesce to one capture per animation frame (mirrors `SnapController`'s
    // OWN rAF throttle for its per-pointermove `setBaseAndExtent` calls, for
    // the identical reason: a fast drag can fire `selectionchange` far more
    // often than the screen repaints, and each capture walks every selected
    // text node's client rects — code review finding).
    let raf = 0;
    const captureFromLiveSelection = () => {
      raf = 0;
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0 || !isPdfTextSelection(selection)) {
        setSnapshot(null);
        return;
      }
      const pages = rectsFromSelection(selection, getPagesRef.current(), scaleRef.current, rectReaderRef?.current);
      setSnapshot(pages.length > 0 ? pages : null);
    };
    const scheduleCapture = () => {
      if (raf === 0) raf = requestAnimationFrame(captureFromLiveSelection);
    };
    // Seed immediately (not throttled): a selection may already exist the
    // instant this becomes enabled (e.g. re-enabling mid-gesture), before any
    // NEW `selectionchange` fires for this hook to observe.
    captureFromLiveSelection();
    document.addEventListener("selectionchange", scheduleCapture);
    // Skip the reposition entirely when nothing is currently selected — a
    // scroll/resize with no active preview has nothing to re-project (code
    // review finding: this fired, and re-rendered the whole overlay, on
    // every scroll regardless).
    const reposition = () => {
      if (snapshotRef.current) bumpReposition((t) => t + 1);
    };
    // Capture phase: the pdf-canvas scrolls, and `scroll` does not bubble
    // (mirrors `textSelectionController`'s own scroll listener).
    document.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      if (raf !== 0) cancelAnimationFrame(raf);
      document.removeEventListener("selectionchange", scheduleCapture);
      document.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- takeoverActiveRef/snapshotRef are refs (stable, read live)
  }, [enabled, getPagesRef, scaleRef, rectReaderRef]);

  if (!enabled || !snapshot) return [];
  // A cheap, SYNCHRONOUS render-time check, independent of `snapshot`: a
  // commit (`createTextTool`) calls `removeAllRanges()` directly inside the
  // same synchronous pointerup handler that also adds the new mark, so both
  // land in the SAME React commit — but `selectionchange` (which is what
  // updates `snapshot`) fires later, asynchronously. Reading `rangeCount`
  // here needs no scale/geometry math (unlike the snapshot itself), so it
  // carries none of the zoom-desync risk above — it catches the clear
  // instantly, before the (later) `selectionchange` ever fires, so the old
  // preview and the new committed mark never paint on top of each other.
  const liveSelection = window.getSelection();
  if (!liveSelection || liveSelection.rangeCount === 0 || liveSelection.isCollapsed) return [];
  const cardOf = (pageIndex: number): PageCardRef | null =>
    getPagesRef.current().find((p) => p.pageIndex === pageIndex) ?? null;
  const geom = pendingSelectionGeometry(snapshot, (pageIndex) => cardOf(pageIndex)?.box ?? null, scaleRef.current);
  if (!geom) return [];
  const readerViewport = document.querySelector(".pdf-canvas")?.getBoundingClientRect() ?? null;
  return viewportRectsFromPages(
    geom.pages,
    cardOf,
    readerViewport ? { top: readerViewport.top, bottom: readerViewport.bottom } : null,
  );
}
