// useRememberedView — Reader's remember/restore-last-view concern (Story
// 10.7, FR-33), mirrors the `usePageNav`/`useZoomControl` extraction
// pattern. Ties `lastView.ts`'s persisted store to the live scroll geometry:
// reads the remembered position ONCE at open, restores it before enabling
// capture (the AC #5 clobber guard — see the Dev Notes "clobber hazard"),
// then debounce-captures the live scroll position and flushes on unmount /
// doc switch.

import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { useLastViewStore, viewOffsetFraction, type LastView } from "./lastView";

const CAPTURE_DEBOUNCE_MS = 400;

export function useRememberedView(opts: {
  scrollRef: RefObject<HTMLDivElement | null>;
  cards: RefObject<Map<number, HTMLDivElement>>;
  currentPage: number;
  pageCount: number;
  docId: string;
  active: boolean;
  /** Live zoom scale (`useZoomControl`'s `scale`), captured alongside
   *  page/frac so a reopen can restore the exact zoom, not just fit-to-width
   *  (the initial-scale side of the restore is Reader's own concern — it
   *  reads the remembered scale directly in its load effect, before this
   *  hook's layout-effect restore ever runs, so cards lay out at the right
   *  size from the first paint). */
  scale: number;
  restoreView: (pageNumber: number, frac: number) => void;
}): void {
  const { scrollRef, cards, currentPage, docId, active, scale, restoreView } = opts;

  // The docId a REMEMBERED position was last read for + the value itself.
  // Refreshed at RENDER time on a docId change — safe because ONLY the
  // restore effect ever reads `pendingRef` (no cross-effect race like the
  // one below).
  const pendingDocRef = useRef(docId);
  const pendingRef = useRef<LastView | undefined>(useLastViewStore.getState().positions[docId]);
  if (pendingDocRef.current !== docId) {
    pendingDocRef.current = docId;
    pendingRef.current = useLastViewStore.getState().positions[docId];
  }

  // Which docId has actually been restored — written ONLY inside the
  // restore effect's COMMIT-phase setup below, NEVER at render time. This
  // is load-bearing, not stylistic (Codex review MEDIUM finding, Story
  // 10.7): a render-time reset (the story's original design) mutates this
  // SHARED ref for the INCOMING doc before the OUTGOING doc's flush — a
  // layout-effect CLEANUP — gets a chance to read it, since render always
  // precedes commit. Keeping the write inside the setup means: on a doc
  // switch, ALL changed-effect cleanups in a commit run before ANY new
  // setups (verified empirically against this React version), so the
  // outgoing flush always sees the outgoing doc's own still-true history,
  // and the incoming doc's restore (which flips this ref) only runs after.
  const restoredDocRef = useRef<string | null>(null);

  // Mirrors `currentPage` into a ref so capture() can read the LIVE
  // page-in-view without the debounce effect depending on it — depending on
  // it would tear down/reattach the scroll listener on every page crossing,
  // putting real work back on the scroll hot path (NFR-2).
  const currentPageRef = useRef(currentPage);
  useEffect(() => {
    currentPageRef.current = currentPage;
  }, [currentPage]);
  // Same mirroring trick for `scale`: zoom changes are infrequent (unlike
  // scroll), but keeping the capture effect's dependency list free of it
  // avoids tearing down/reattaching the scroll listener on every zoom step.
  const scaleRef = useRef(scale);
  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);

  // Restore, before paint (useLayoutEffect so page 1 never visibly flashes,
  // AC #4). Runs once per doc open; every page card is already registered by
  // the time this parent layout effect runs (PageCard's own registration is
  // itself a layout effect — child layout-effect SETUPS run before the
  // parent's, mirroring mount order).
  useLayoutEffect(() => {
    if (!active || restoredDocRef.current === docId) return;
    restoredDocRef.current = docId;
    const pos = pendingRef.current;
    if (pos) restoreView(pos.page, pos.frac);
  }, [active, docId, restoreView]);

  // The capture computation, shared by the debounced scroll path AND the
  // unmount/doc-switch flush below — memoized so both call sites always use
  // the SAME function identity for a given docId (the flush layout effect
  // keys its re-arm off this identity). Reads `restoredDocRef.current`
  // FRESH on every call (not a value snapshotted at some earlier time) —
  // see the ref's own comment for why this is safe across a doc switch.
  const capture = useCallback(() => {
    if (restoredDocRef.current !== docId) return;
    const container = scrollRef.current;
    const page = currentPageRef.current;
    const card = cards.current.get(page);
    if (!container || !card) return;
    const frac = viewOffsetFraction(container.scrollTop, card.offsetTop, card.clientHeight);
    useLastViewStore.getState().remember(docId, { page, frac, scale: scaleRef.current });
  }, [scrollRef, cards, docId]);

  // Debounced scroll capture: passive listener, cheap clearTimeout/setTimeout
  // on the scroll hot path (NFR-2, unchanged mechanic) — the real compute
  // (capture()) runs once scrolling settles.
  useEffect(() => {
    const container = scrollRef.current;
    if (!active || !container) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      if (restoredDocRef.current !== docId) return;
      clearTimeout(timer);
      timer = setTimeout(capture, CAPTURE_DEBOUNCE_MS);
    };

    container.addEventListener("scroll", onScroll);
    return () => {
      container.removeEventListener("scroll", onScroll);
      clearTimeout(timer);
    };
  }, [active, docId, scrollRef, capture]);

  // Flush on unmount / doc-switch (AC #1 "Back to Library" / "switch
  // documents"). A LAYOUT effect, not passive — this is load-bearing, not
  // stylistic (Codex review HIGH finding, Story 10.7). `PageCard`'s own card
  // registration is a layout effect too (deregisters on unmount); passive
  // effect cleanups across a WHOLE commit run strictly after ALL layout
  // effect cleanups, so a passive-effect flush here would run AFTER every
  // card had already been deregistered — `cards.current.get(page)` would
  // always miss, silently losing the last position on Back-to-Library if the
  // click landed inside the 400ms debounce window. Layout-effect cleanups
  // additionally run PARENT-before-CHILD on unmount and, on a same-component
  // re-render, ALL changed cleanups run before ANY new setups — both
  // verified empirically against this React version, not assumed — so this
  // flush is guaranteed to see live card geometry on unmount, and (combined
  // with `restoredDocRef`'s commit-phase-only write above) is guaranteed to
  // run BEFORE the incoming doc's restore effect scrolls the shared
  // container, so the outgoing doc's position can't be corrupted with the
  // incoming doc's geometry (Codex review MEDIUM finding).
  useLayoutEffect(() => capture, [capture]);
}
