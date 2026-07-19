---
baseline_commit: ab744739e5021842e8eb45a817bea6e36f40e9b4
---

# Story 10.7: Remember and restore last view position on reopen

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a reader,
I want a paper to reopen at the page and scroll position where I left off,
so that I resume reading without hunting for my place.

## Acceptance Criteria

1. **(Capture per document on close, item 11, FR-33)** Given an open paper scrolled to some page/position, when I leave the reader (Back to Library) or switch documents, then that paper's last view position is captured PER DOCUMENT, keyed by `doc_id`: the 1-based page in view plus the intra-page scroll offset expressed as a `[0,1]` FRACTION of that page's rendered height (so it is scale-independent, AC #2). Persisted client-side, never on the server (AD-8 view-state tier; not the annotation contract).

2. **(Restore on reopen, scale-independent, item 11, FR-33, AR-6)** Given I reopen that paper, when the reader becomes ready, then it restores to the remembered page and fractional offset — landing on the SAME content even if the fit/zoom scale differs from last visit (the fraction is re-multiplied by the current-scale page height) — not the top of page 1.

3. **(First-time open unchanged, FR-33)** Given a first-time open (no remembered position for this `doc_id`), then the reader opens at the top of page 1, exactly as today. A corrupt or out-of-range persisted entry (hand-edited `localStorage`, a page beyond the doc's `page_count`, a fraction outside `[0,1]`) is reconciled — dropped or clamped — so it can never scroll to a broken spot; a dropped entry degrades to the first-time-open behavior.

4. **(Composes with windowing, no jank, NFR-2)** Given the restore, then it composes with the Story 1.7 render windowing: because every page card is laid out at final reserved geometry up front (before any lazy paint), the target page's `offsetTop`/height are accurate at restore time, so the jump lands correctly even for a page deep in a 50+ page paper whose canvas has not painted yet (the paint window then recomputes around the landed page). The restore is a single INSTANT scroll (no smooth glide), timed so the reader does not visibly flash page 1 first (no scroll-jank burst).

5. **(Capture never clobbers the memory before restore reads it)** Given the reader is still opening (scroll offset 0 during load), then the capture path does NOT overwrite the stored position with a top-of-page-1 value before the restore has consumed it: the remembered position is read once at open, restore runs first, and only then is capture enabled. Restore is one-shot per doc open (re-armed when `doc_id` changes).

6. **(Out of scope, resolves open design calls)** Given this story, then it does NOT persist a per-page zoom LEVEL (only page + fraction), and it does NOT sync the position across devices (Remote sync stays deferred). The position lives in a client-only `localStorage` view-prefs store, mirroring the Story 7.10 `tableViewPrefs`/Story 5.1 `settings` stores — not in `meta.json` and not the annotation working copy.

7. **(Live-smoked at DPR>1 on a 50+ page paper, NFR-2)** Given the feature, then it is live-smoked at DPR>1 on a real 50+ page paper: scroll to a mid-document position, go Back to Library, reopen → lands at the remembered spot; change the zoom, reopen → lands on the same CONTENT (not the same pixel offset); a never-opened paper opens at the top.

## Tasks / Subtasks

- [x] **Task 1 — The persisted last-view store (AC: #1, #3, #6).** New file `client/src/reader/lastView.ts`, a Zustand store wrapped in `persist`, mirroring `client/src/library/tableViewPrefs.ts` and `client/src/settings/store.ts` (the app's two existing `localStorage` preference stores) EXACTLY in shape (`name`/`version`/`partialize`/`merge`-reconcile):
  - `export interface LastView { page: number; frac: number; }` — `page` is 1-based, `frac` is a `[0,1]` fraction of the page's rendered height. No scale/zoom field (AC #6).
  - State: `positions: Record<string, LastView>` (keyed by `doc_id`); actions `remember(docId: string, view: LastView): void` (writes `positions[docId]`) and `forget(docId: string): void` (deletes the entry; wired to nothing this story — see Task 6 out-of-scope note — but exported for a future doc-delete/purge caller).
  - `persist` config: `name: "paper-mate:last-view"`, `version: 1`, `partialize: (s) => ({ positions: s.positions })`, and a `merge` that runs the reconcile below (mirror `tableViewPrefs`'s `merge` verbatim in structure).
  - `reconcile(positions: unknown): Record<string, LastView>` (pure, exported, unit-tested): drop the whole thing if not a plain object; per entry keep ONLY when `page` is a finite integer `>= 1` AND `frac` is a finite number, clamping `frac` into `[0,1]`; drop any malformed entry. (Do NOT clamp `page` to a max here — the store does not know a doc's `page_count`; the render-time clamp in Task 2 handles a page beyond the doc, AC #3.) Match `tableViewPrefs.reconcile`'s "each field degrades independently, a corrupt entry never poisons the others" discipline.
  - `export function viewOffsetFraction(scrollTop: number, cardOffsetTop: number, cardClientHeight: number): number` — pure, unit-tested: `cardClientHeight <= 0 ? 0 : clamp((scrollTop - cardOffsetTop) / cardClientHeight, 0, 1)`. This is the inverse of `usePageNav`'s `card.offsetTop + frac * clientHeight` restore math; homing it HERE (not in `render/index.ts`) deliberately avoids the `vi.mock("@/render")` barrel-sync maintenance the CLAUDE.md engineering principle calls out.

- [x] **Task 2 — `restoreView` on the page-nav concern (AC: #2, #4).** In `client/src/reader/usePageNav.ts`, add a `restoreView(pageNumber: number, frac: number): void` to `PageNavApi` (L9-13) and its impl, so the ONE scroll mechanic stays owned by this hook (mirrors `scrollToPage`/`jumpToAnnotation`):
  - Clamp `pageNumber` to `[1, pageCount]` (same `Math.min(pageCount, Math.max(1, …))` guard as `scrollToPage` L66 — this is the AC #3 "page beyond `page_count`" safety net), look up the card, and if present call `scrollCardIntoView(card, frac * card.clientHeight, false)` — reuse the existing L44-58 mechanic with `extraTop = frac * clientHeight` and `smooth = false` (INSTANT, AC #4; no `JUMP_MARGIN_FRACTION` — restore wants the exact remembered spot, not the Bank-jump's 15% inset).
  - Return `restoreView` from the hook. No change to `scrollToPage`/`jumpToAnnotation`/`handleKeyDown`.

- [x] **Task 3 — The remember/restore orchestration hook (AC: #1, #2, #4, #5).** New file `client/src/reader/useRememberedView.ts` — the Reader-owned concern that ties the store to the live scroll geometry, mirroring the `usePageNav`/`useZoomControl` extraction pattern (each Reader concern in its own hook). Signature:
  ```ts
  useRememberedView(opts: {
    scrollRef: RefObject<HTMLDivElement | null>;
    cards: RefObject<Map<number, HTMLDivElement>>;
    currentPage: number;        // 1-based, from usePageViewport
    pageCount: number;
    docId: string;
    active: boolean;            // phase === "ready"
    restoreView: (pageNumber: number, frac: number) => void; // from usePageNav
  }): void
  ```
  - **Read-once + restore ordering (AC #5, correctness-critical):** on open, read `useLastViewStore.getState().positions[docId]` ONCE into a ref (NOT a live subscription) so a capture write can never mutate the target mid-open. Keep a `restoredRef` (and a `restoredDocRef` holding the docId it was armed for). When `active` becomes true and `restoredRef` is false, run the restore: if the remembered position exists, call `restoreView(pos.page, pos.frac)`; either way set `restoredRef = true`. Use a `useLayoutEffect` (not passive) so the instant scroll happens before paint and page 1 never flashes (AC #4). Every page card is already registered by the time this parent layout effect runs (child ref callbacks fire during commit, before parent layout effects), so `cards.current.get(pos.page)` is populated — but still guard `restoreView` internally on a missing card (Task 2 already does).
  - **Reset on doc switch:** when `docId` changes, reset `restoredRef = false`, re-read the remembered position ref for the new doc, and clear the capture-armed flag — so switching papers without unmounting (a future path; today Back-to-Library unmounts) still restores correctly.
  - **Capture (enabled only AFTER restore, AC #5):** attach a `scroll` listener to `scrollRef.current` that, trailing-DEBOUNCED (~400ms; a single `setTimeout` reset per event — near-zero work on the scroll hot path, the real compute runs once after scrolling stops, NFR-2), computes `frac = viewOffsetFraction(container.scrollTop, card.offsetTop, card.clientHeight)` for `card = cards.current.get(currentPage)` and calls `remember(docId, { page: currentPage, frac })`. Do nothing until `restoredRef` is true. Guard on a missing card / missing scrollRef (jsdom no-op).
  - **Flush on unmount / doc switch (AC #1 "Back to Library" / "switch documents"):** the effect cleanup clears the debounce timer AND does one final synchronous capture (compute + `remember`) so navigating away inside the debounce window still persists the exact last spot. (This is the primary capture trigger for the two named close events; the debounced scroll write is the belt-and-suspenders that also survives a hard tab close up to the last debounce.)

- [x] **Task 4 — Wire the hook into Reader (AC: #2, #4).** In `client/src/components/Reader/Reader.tsx`, after the `usePageNav` call (L115-120), destructure `restoreView` from it and call `useRememberedView({ scrollRef, cards, currentPage, pageCount: doc.page_count, docId: doc.doc_id, active: phase === "ready", restoreView })`. No change to the imperative handle (L123-127) — restore is Reader-internal, not top-bar chrome, so it does NOT go on `ReaderHandle`. No prop/interface change to `Reader` itself. Confirm the hook no-ops cleanly under jsdom (no `scrollTo`, no `IntersectionObserver`, `offsetTop`/`clientHeight` = 0), so existing Reader tests stay green without touching the `vi.mock("@/render")` barrels.

- [x] **Task 5 — Tests (AC: #1-#5).**
  - [x] `client/src/reader/lastView.test.ts` (new): `reconcile` — a non-object → `{}`; a valid entry kept; `frac` out of range clamped to `[0,1]`; `page < 1`, non-integer `page`, non-finite `frac`, missing keys → that entry dropped while sibling valid entries survive. `viewOffsetFraction` — mid-page fraction, top-of-page → 0, clamps below 0 and above 1, `clientHeight <= 0` → 0, and the zoom-independence property: the SAME `(scrollTop, offsetTop, clientHeight)` scaled by a common factor yields the same fraction (mirror the scale-doubling assertion style used in `anchor.test.ts`). `remember`/`forget` mutate `positions` as expected.
  - [x] `client/src/reader/useRememberedView.test.tsx` (new; `renderHook`): with a stubbed `restoreView` mock — (a) NO stored position → `restoreView` NOT called, first-time-open preserved (AC #3); (b) a stored position for `docId` → `restoreView(page, frac)` called exactly ONCE when `active` flips true (AC #2), and not again on re-render; (c) capture does not fire before restore (dispatch a `scroll` at offset 0 during `active=false` → `remember` not called, AC #5); (d) after restore, a `scroll` + timer advance calls `remember` with `{ page: currentPage, frac }` (jsdom layout is 0, so assert the CALL/shape, not pixels); (e) unmount flushes a final `remember`. Fake timers for the debounce.
  - [x] Extend `client/src/reader/usePageNav` coverage if a nav test file exists (else fold into the hook test): `restoreView` clamps `pageNumber` into range and, given a card, calls the container `scrollTo` with `top = offsetTop + frac*clientHeight`, `behavior:"auto"` (mock the container like the existing nav mechanic tests). The pixel MATH under real layout is live-smoke-only (jsdom has no layout).
  - [x] No `render/index.ts` export change and no new `Reader`/`AnnotationInteraction` prop → the two `vi.mock("./render")` barrels (`App.test.tsx`, `Reader.test.tsx`) need NO edit (verify). Run the full suite + `npm run typecheck`.

- [x] **Task 6 — Live smoke at DPR>1 on a 50+ page paper (AC: #4, #7), OWN dev servers, throwaway `PAPER_MATE_DATA`.** Start YOUR OWN `uvicorn` + `vite dev` (never a user-launched/Docker server, CLAUDE.md) with an explicit throwaway `PAPER_MATE_DATA` scratch dir (never `~/.paper-mate`, the Story 10.2/10.4/10.5/10.6 process note). Import a real 50+ page PDF at DPR 2:
  - [x] (a) Scroll to a mid-document position (e.g. partway down page ~30), go Back to Library, reopen the paper → it lands at that page + intra-page offset, not page 1, with no visible page-1 flash first (AC #2, #4).
  - [x] (b) Reopen again after CHANGING the zoom (zoom in a couple of steps first, then Back, then reopen) → it lands on the SAME content line, not the same pixel offset (scale-independent, AC #2). Confirm `window.devicePixelRatio === 2`.
  - [x] (c) A never-opened paper (import a second PDF, open it fresh) → opens at the top of page 1 (AC #3).
  - [x] (d) Corrupt-entry resilience: hand-edit the `paper-mate:last-view` `localStorage` value to an out-of-range `page`/`frac`, reload, reopen → it opens at the top (or a clamped safe spot), never a broken scroll (AC #3).
  - [x] Delete the transient test docs afterward and confirm `library.json` is clean; the position store is client-only `localStorage`, so also clear the `paper-mate:last-view` key. Note (as Stories 10.1-10.6 did) if `claude-in-chrome` is unavailable and the `chrome-devtools-mcp` `emulate({viewport:"…x2"})` fallback was used for DPR 2. (No text-selection here, so the drag-forms-a-real-Selection constraint does not apply — plain scroll + navigation is fine to script.)

- [x] **Task 7 — Version + docs.** Bump `server/pyproject.toml` `[project].version` `0.5.36` → `0.5.37` at PR-merge time (per CLAUDE.md versioning — once, when the story flips to `done`; NOT mid-implementation). Pure client change: NO `/api` contract change, so `docs/API.md` needs NO edit; no new DESIGN.md token; no new user-facing UI copy, so no em-dash grep needed (but sanity-check any new string). No `render/` barrel change.

## Dev Notes

### Resolved open design calls (from epics.md L2461)

- **Where the position lives** → a client-only `localStorage` view-prefs store (`client/src/reader/lastView.ts`), mirroring Story 7.10's `tableViewPrefs.ts` and Story 5.1's `settings/store.ts` — NOT `meta.json`. Rationale: FR-33 is pure VIEW state, explicitly "never part of the annotation contract" (PRD FR-33 note, AD-8). Putting it in `meta.json` would touch the API contract (`DocMeta`/`DocPatch` + a write endpoint), add a server round-trip on every close, and couple reading position to the shared document record — all for state that is inherently local and out-of-scope for cross-device sync. The app already has the exact precedent: two `localStorage` Zustand-`persist` stores for local view/preference state. AD-8's own spine note calls `localStorage` preferences a DIFFERENT persistence tier from the `~/.paper-mate` annotation working copy — this belongs in that tier.
- **Normalized fraction vs page + px offset** → page (1-based) + a `[0,1]` FRACTION of the page's rendered height. The fraction is the scale-independence mechanism (AC #2, AR-6): capture divides by the current-scale `clientHeight`, restore multiplies by the (possibly different) current-scale `clientHeight`, so a zoom change between sessions still lands on the same content. This mirrors the app's existing zoom-independent page fraction — `usePageNav.jumpToAnnotation` already scrolls to `topFraction * card.clientHeight` (Story 3.6, `bank.ts`). `restoreView` is `jumpToAnnotation` without the margin and instant.
- **Debounce / flush timing on close** → trailing-debounced (~400ms) capture on scroll as the continuous writer, PLUS a synchronous final capture in the hook's cleanup (unmount / doc switch). The two named close events (Back to Library, switch documents) both run React cleanup, so the flush covers them exactly; the debounced scroll write is the belt-and-suspenders that also survives a hard tab close up to the last debounce. Not using `beforeunload` (out of scope; the debounced write already covers the realistic "scrolled, then paused, then closed the tab" case).

### The clobber hazard this story must not trip (AC #5)

A naive "listen to scroll, write to store" plus "on ready, read store and scroll" RACES: while the doc is loading, the container sits at `scrollTop = 0`; if any scroll event fires (or the listener is attached before restore), capture writes `{ page: 1, frac: 0 }` and CLOBBERS the real remembered position before restore ever reads it. The fix, baked into Task 3: read `positions[docId]` ONCE into a ref at open, run the restore first (guarded by `restoredRef`), and only ENABLE the capture writer after restore has run. This is the single most important correctness property of the story — the hook test (AC #5, cases c/d) exists specifically to lock it.

### Why restore composes with windowing without waiting for paint (AC #4)

Story 1.7 windowing paints only pages within ±`WINDOW_RADIUS` of the current page (`usePageViewport`), so a page deep in a 50+ page doc is a blank reserved card until scrolled near. That does NOT block restore: Reader lays out EVERY page card up front at final reserved geometry (`Reader.tsx` L228 maps every `box` to a `PageCard`; NFR-1 reserve-geometry), so `card.offsetTop` and `card.clientHeight` are already final before any canvas paints. `restoreView` scrolls by `offsetTop + frac*clientHeight` — accurate immediately. The IntersectionObserver then fires as the target crosses into view, updates `currentPage`, and recomputes the paint window around it (`usePageViewport` L99-109), so the target paints right after the landing. That is the AC's "the target page is rendered before the jump" intent: the JUMP TARGET (its geometry) is valid pre-paint; paint follows via the normal window, exactly like a manual scroll to that page. Restore is `useLayoutEffect` + instant scroll so there is no visible page-1 frame.

### Coordinate / unit rules (AD-9 — do not violate)

This is plain layout arithmetic (scroll offsets, card `offsetTop`/`clientHeight`), NOT anchor/normalize math — it never touches `anchor/`, never divides by `page.getViewport` box, never denormalizes an annotation. `viewOffsetFraction` is a DOM-free pure helper (like `focalScroll`/`pageNavTarget` in `render/index.ts`), homed in `lastView.ts` to keep it out of the `@/render` mock barrels. The fraction is a page-height fraction, the same species as `jumpToAnnotation`'s `topFraction` — a viewport/layout concern, unit-testable, jsdom-layout-free by living as pure math.

### Preserve exactly (regression guards)

- `usePageNav`'s `scrollToPage`, `jumpToAnnotation`, `handleKeyDown`, and the shared `scrollCardIntoView` mechanic are UNCHANGED — `restoreView` is a NEW sibling that reuses `scrollCardIntoView` (one scroll mechanic, AR-9). Do not alter the `JUMP_MARGIN_FRACTION` inset (that is the Bank jump's, not restore's).
- The `ReaderHandle` imperative API (L26-38, L123-127) is UNCHANGED — restore is internal to Reader, not top-bar chrome. Do not add a method to it.
- The hydrate-before-mount ordering in `ReaderPage`'s load effect (L163-183, Story 3.5 anti-clobber) is untouched — last-view restore is orthogonal to annotation hydration and lives entirely inside `Reader`/`useRememberedView`, keyed off `phase === "ready"`, which only becomes true after the load effect has run.
- `usePageViewport`'s `currentPage` (1-based, defaults 1) is the single source of the in-view page; capture reads it, never re-derives its own page-in-view (no second observer, AR-9).

### Persistence tier (AD-8) — this is NOT annotation data

`lastView.ts` is `localStorage`, app-global-ish (a `docId`-keyed map), sitting in the SAME tier as `settings/store.ts` (keymap) and `tableViewPrefs.ts` (columns): a Zustand store with `persist`, its own `name`, `version`, `partialize`, and a `merge`-reconcile guard against stale/corrupt shapes. It is NOT the doc-scoped zundo-wrapped annotation working copy in `store/` (no `schema_version`, no `~/.paper-mate` file, no autosave, not undoable), and it is NOT `meta.json`. An orphaned entry for a deleted/purged doc is harmless (one tiny object, reconcile leaves it); `forget(docId)` is exported for a future Library delete/purge caller but is intentionally NOT wired this story (wiring it would pull Library delete/trash into scope). An optional LRU cap on `positions` is possible but unnecessary at library scale — skip unless trivial.

### Out of scope (from epics.md L2461)

- Per-page ZOOM level memory — only page + fraction persist; the reader still applies its own fit-to-width scale on open (AC #6). A returning reader lands on the same content, at the reader's current scale.
- Cross-device sync of the position (Remote sync stays deferred / un-numbered per the 2026-07-11 correct-course).

### Testing standards

- Backend: none (pure client story; no backend touched). Frontend: `cd client && npm test` + `npm run typecheck`.
- jsdom has no layout (`offsetTop`/`clientHeight`/`scrollTop` = 0, no `scrollTo`, no `IntersectionObserver`), so the PIXEL round-trip (capture→restore landing spot) is **live-smoke only** (AC #7). Fully unit-testable in jsdom: `reconcile`, `viewOffsetFraction` (incl. the zoom-independence property), the store actions, and the hook's ORCHESTRATION (restore-once, no-restore-when-absent, capture-gated-after-restore, unmount-flush) via a mocked `restoreView` + fake timers.
- **Live smoke mandatory at DPR>1 on a 50+ page paper** with YOUR OWN dev servers and an explicit throwaway `PAPER_MATE_DATA` (never `~/.paper-mate`, Story 10.2 process note). `[[verify-on-hidpi-and-real-host]]`.

### Project Structure Notes

- Downward-dependency rule holds: `lastView.ts` (pure store + math, leaf) ← `useRememberedView.ts` (Reader concern hook) ← `Reader.tsx` (composition root). `useRememberedView` depends on `usePageNav`'s `restoreView` (both `reader/` concern hooks, same tier — passed in as a param, no cross-hook import, mirroring how Reader already wires `scale`/`cards`/`currentPage` between its concern hooks). No `anchor/`, `annotations/`, or `render/` change. Two new files under `client/src/reader/`, two edited (`usePageNav.ts`, `Reader.tsx`) — matches the Story 5.3/5.4 `reader/` concern-hook layout.

### References

- Epic + ACs + open design calls: [Source: .bmad/planning-artifacts/epics.md#Story 10.7] (L2437-2461).
- Source of the request (item 11, new FR): [Source: .bmad/planning-artifacts/sprint-change-proposals/sprint-change-proposal-2026-07-18.md] (L36, L96, L137).
- FR-33 (finalized in the reader PRD): [Source: .bmad/planning-artifacts/prds/prd-paper-mate-2026-06-28/prd.md] (L88, L90). AR-6 ownership/hydrate-on-open (applied loosely — last-view is the client view-prefs TIER, not backend-owned annotation data): [Source: .bmad/planning-artifacts/epics.md] (L96). AD-8 storage tiers: [Source: .bmad/planning-artifacts/architecture/architecture-paper-mate-2026-06-28/ARCHITECTURE-SPINE.md] (L96-98, L132).
- Code touch points (verbatim, current):
  - Persisted view-prefs precedent to mirror: `client/src/library/tableViewPrefs.ts` (store + `reconcile` + `persist merge`, L40-124), `client/src/settings/store.ts` (the minimal `persist` shape, L22-42).
  - Page-nav scroll mechanic: `client/src/reader/usePageNav.ts` — `PageNavApi` L9-13, `scrollCardIntoView` L44-58, `scrollToPage` L64-71 (the clamp idiom), `jumpToAnnotation` L78-87, `JUMP_MARGIN_FRACTION` L22 (restore does NOT use it). Add `restoreView`.
  - Reader composition root: `client/src/components/Reader/Reader.tsx` — `scrollRef` L88, `usePageViewport`→`{ cards, currentPage }` L97-101, `useZoomControl`→`scale` L103-109, `usePageNav` L115-120, imperative handle L123-127 (unchanged), reserve-geometry card map L228-239, `phase === "ready"` gate. Wire `useRememberedView` after L120.
  - In-view page source: `client/src/render/usePageViewport.ts` — `currentPage` L50 (1-based, defaults 1), IO recompute L81-109.
  - Load ordering not to disturb: `client/src/reader/ReaderPage.tsx` — param-driven load + `openDoc` L163-183.
- Relevant memories: [[verify-on-hidpi-and-real-host]], [[fixed-overlay-live-reanchor]], [[same-tick-dom-read-stale-after-dispatch]], [[ancestor-ref-passive-effect]].

## Dev Agent Record

### Agent Model Used

Sonnet 5 (claude-sonnet-5), xHigh reasoning.

### Debug Log References

- Live-smoke blocker (found + fixed during Task 6, not a pre-existing story risk called out in Dev Notes): `restoreView` was never firing on reopen — `cards.current` was still EMPTY at the moment `useRememberedView`'s `useLayoutEffect` ran. Root cause: `PageCard`'s `register(pageNumber, cardRef.current)` call (`client/src/reader/PageCard.tsx`) lived in a passive `useEffect`, not a layout effect, so it hadn't run yet when the PARENT's (`Reader`'s) own layout effect fired — passive effects across a whole commit run strictly after ALL layout effects in that commit, parent included, not "child-before-parent" the way layout effects themselves do. The Dev Notes' assumption ("child ref callbacks fire during commit, before parent layout effects") held for native DOM ref callbacks but not for this codebase's actual mechanic, where registration is one level removed (an effect calling the callback, not the callback itself). Fixed at the source: promoted `PageCard`'s registration effect from `useEffect` to `useLayoutEffect` (`client/src/reader/PageCard.tsx`) — cheap (pure `Map`/`WeakMap` mutation, no DOM read/write) and correct for every existing consumer of `cards` (`scrollToPage`/`jumpToAnnotation`/IntersectionObserver setup), none of which regressed (full suite + live re-smoke both green after the fix). Confirmed via temporary `console.log` instrumentation in the browser (removed before commit) reading `cards.current.size`/`.has(30)` at restore-effect-fire time (0/false before the fix, populated after).

### Completion Notes List

- Task 1: `client/src/reader/lastView.ts` — `useLastViewStore` (Zustand + `persist`, `name: "paper-mate:last-view"`, `version: 1`), `reconcile` (per-entry degrade, page/frac validated independently), `viewOffsetFraction` (pure inverse of the restore math). 21 unit tests in `lastView.test.ts`, all passing.
- Task 2: `usePageNav.restoreView(pageNumber, frac)` added — clamps into `[1, pageCount]`, reuses `scrollCardIntoView` with `smooth=false`, no `JUMP_MARGIN_FRACTION`. `scrollToPage`/`jumpToAnnotation`/`handleKeyDown` untouched.
- Task 3: `client/src/reader/useRememberedView.ts` — read-once ref + `useLayoutEffect` restore gated by `restoredRef`, debounced (400ms) capture gated on `restoredRef`, unmount/doc-switch flush. `currentPage` is mirrored into a ref (not a capture-effect dependency) so the scroll listener isn't torn down and re-attached on every page crossing — an early implementation drafted `currentPage` as a dependency, which would have put a synchronous flush-capture on every IntersectionObserver page update, violating NFR-2; caught and fixed before commit, not by live smoke.
- Task 4: Wired into `Reader.tsx` right after `usePageNav`; no `ReaderHandle`/prop change.
- Task 5: `lastView.test.ts` (21 tests) + `useRememberedView.test.tsx` (10 tests: 6 for the orchestration hook, 4 for `usePageNav.restoreView` folded in per the task's "if no nav test file exists" branch). Full suite: 74 files / 1636 tests passing. `npm run typecheck` clean. Confirmed no `render/index.ts` export changed and no barrel-mock edit needed.
- Task 6: Live-smoked at DPR 2 (`chrome-devtools-mcp` `emulate`, `claude-in-chrome` was available for navigation/upload but has no DPR-emulation primitive) against a real 62-page arXiv paper (throwaway `PAPER_MATE_DATA` scratch dir, own `uvicorn`/`vite` on ports 8137/5187). Found and fixed the `PageCard` registration-timing bug above; all four smoke sub-cases (a)-(d) then passed, including the scale-independence check (200% → 313% zoom, Back, reopen → landed on the identical "5.2 Precision agriculture" content line) and corrupt-entry resilience (out-of-range `page:9999`/`frac:5.5` clamped to the last page at `frac=1`; malformed JSON degraded to a clean first-open). Scratch dir and dev servers torn down afterward.
- Task 7: No `/api` change → `docs/API.md` untouched. No new DESIGN.md token. No new user-facing UI copy (no em-dash risk). Version bump to `0.5.37` deferred to PR-merge time per CLAUDE.md versioning (not done in this session).

### File List

- `client/src/reader/lastView.ts` (new)
- `client/src/reader/lastView.test.ts` (new)
- `client/src/reader/useRememberedView.ts` (new)
- `client/src/reader/useRememberedView.test.tsx` (new)
- `client/src/reader/usePageNav.ts` (modified — added `restoreView`)
- `client/src/reader/PageCard.tsx` (modified — registration effect promoted from `useEffect` to `useLayoutEffect`; live-smoke fix, see Debug Log)
- `client/src/components/Reader/Reader.tsx` (modified — wired `useRememberedView`)

## Change Log

- 2026-07-19: Story created (bmad-create-story). Resolved the three epics.md open design calls: (1) position lives in a NEW client-only `localStorage` view-prefs store `client/src/reader/lastView.ts`, mirroring Story 7.10 `tableViewPrefs`/Story 5.1 `settings` (NOT `meta.json`; AD-8 view-state tier, not the annotation contract); (2) stored as page (1-based) + a `[0,1]` page-height FRACTION (scale-independent per AR-6, the same species as `jumpToAnnotation`'s `topFraction`); (3) trailing-debounced (~400ms) scroll capture plus a synchronous cleanup flush on unmount/doc-switch. Architected as: a persisted store + pure `reconcile`/`viewOffsetFraction` (`lastView.ts`), a new `restoreView(page, frac)` sibling on `usePageNav` (reuses the one `scrollCardIntoView` mechanic, instant, no margin), and an orchestration hook `useRememberedView` wired into `Reader` that reads the remembered position once, restores in a `useLayoutEffect` before enabling capture (the AC #5 clobber guard), and composes with Story 1.7 windowing via reserve-geometry `offsetTop`. Out of scope: per-page zoom memory, cross-device sync. Pure client change; no `/api`/`docs/API.md`/DESIGN.md change; version bumps to 0.5.37 at PR merge.
- 2026-07-19: Implemented (bmad-dev-story). Tasks 1-7 complete. Live smoke (Task 6) surfaced and fixed a genuine restore-on-reopen bug: `PageCard`'s card-registration effect ran as a passive `useEffect`, so the card registry was still empty when the new restore `useLayoutEffect` fired on initial mount — promoted it to `useLayoutEffect` (see Debug Log). All ACs verified live at DPR 2 on a 62-page paper. Full suite green (1636 tests), typecheck clean.
