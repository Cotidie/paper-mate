---
baseline_commit: 437537454cdd4b565766639acd6e7e222d634dbe
---

# Story 8.7: Immediate viewer resume on tab return

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a reader,
I want the viewer to respond immediately when I switch back from another browser tab,
so that returning to the paper does not pause or lag.

## Acceptance Criteria

1. **Given** the reader open on a paper, **When** I switch to another browser tab and back, **Then** the viewer is interactive immediately on return: scroll, zoom, and annotate respond on the first interaction with no multi-frame stall or freeze (NFR-2).

2. **Given** this is a defect of unknown mechanism (investigation-first), **Then** the work STARTS with a measured root-cause diagnosis before any fix is committed. Reproduce the stall on a large paper, capture a Chrome DevTools Performance trace across a background-and-return cycle, and identify which mechanism dominates the first post-return frames: background-tab rAF/timer throttling draining as a burst, the Story 1.7 render windowing forcing a synchronous layout of every card on return, the `content-visibility: auto` cards re-establishing layout/paint on reveal, a paused pdf.js render queue draining, or a stale-layout reflow. The chosen fix must target the mechanism the trace actually shows, and the diagnosis (with the trace evidence) is recorded in the Dev Agent Record.

3. **Given** the fix, **Then** it is verified LIVE by backgrounding and re-focusing the tab on a large (50+ page) paper at DPR>1 on your own fresh dev servers, with a before/after Performance measurement showing the post-return stall removed (or reduced to within one frame). A unit test alone does NOT satisfy this AC: jsdom has no IntersectionObserver, rAF, `content-visibility`, or `document.hidden`, so the regression is invisible there.

4. **Given** the fix, **Then** it does NOT regress scroll/zoom smoothness or the render-windowing behavior during normal (non-tab-switch) reading (NFR-2): pages still paint lazily inside the +/-`WINDOW_RADIUS` window, release their bitmaps when they leave it, and the page-in-view indicator still tracks scroll. Confirm normal scroll and a wheel-zoom still feel smooth after the fix.

5. **Given** any new user-facing string introduced by the fix (unlikely for this story), **Then** it contains no em-dash (UX-DR13). This story is expected to add none.

## Tasks / Subtasks

- [ ] **Diagnose (do this first, commit nothing until it is done)** (AC: 2)
  - [ ] Obtain a 50+ page PDF (the two repo fixtures are short papers; see Dev Notes "Prerequisite"). Import it into your own fresh dev servers.
  - [ ] Reproduce the stall by hand: open the reader, switch to another tab, wait several seconds, switch back, and immediately try to scroll/zoom. Confirm and describe the lag before instrumenting.
  - [ ] Record a Chrome DevTools Performance trace spanning: reader idle → tab hidden → several seconds → tab visible → first scroll/zoom. Inspect the frames right after the `visibilitychange`-to-visible moment.
  - [ ] Attribute the long task(s): is it Recalculate Style / Layout (forced reflow), Timer Fired draining, pdf.js worker/render tasks, or compositing of revealed `content-visibility` cards? Note the dominant cost and where it originates (the "Bottom-Up" / call-tree attribution points at the JS frame, e.g. `recompute` in `usePageViewport.ts`, or a browser-internal reveal).
  - [ ] Write the settled root cause into the Dev Agent Record with the trace numbers. This diagnosis GATES the fix; the suspects below are hypotheses to confirm or reject, not a pre-decided answer.
- [ ] **Fix the identified mechanism** (AC: 1, 4)
  - [ ] Implement the minimal change that removes the measured stall, in the layer the diagnosis points to (`render/usePageViewport.ts`, `reader/PageCard.tsx`, `components/Reader/Reader.css`, or a new `visibilitychange` handler). Keep it scoped to the tab-return path; do not restructure the windowing.
  - [ ] If the fix adds a `visibilitychange`/`focus`/`blur` listener, bind it at the document/window level and clean it up on unmount, matching the existing precedent in `reader/usePanControl.ts` (see Dev Notes). Do not add a second, conflicting visibility handler to that hook.
  - [ ] If the fix extracts any pure decision logic (a guard, a debounce, a "should recompute" predicate), put it in a DOM-free helper so it is unit-testable.
- [ ] **Test** (AC: 1, 3, 4)
  - [ ] Add/adjust unit tests for any extracted pure helper (`render/` or `reader/` `*.test.ts`). Do NOT assert the stall itself in jsdom (it cannot observe it).
  - [ ] `cd client && npm test && npm run typecheck` clean. Keep the `render/` mock barrels in `App.test.tsx` and `Reader.test.tsx` in sync if you add any `render/index.ts` export (CLAUDE.md engineering principle).
- [ ] **Verify (live, own servers)** (AC: 1, 3, 4)
  - [ ] On your OWN fresh `uvicorn` + `vite dev` (not a server the user already has running), on the 50+ page paper at DPR>1: background/re-focus the tab and confirm immediate interactivity, with a before/after Performance trace showing the stall gone.
  - [ ] Re-confirm normal reading is unregressed: smooth scroll, wheel-zoom, page-in-view indicator tracking, lazy paint + bitmap release still work.
  - [ ] Shut the dev servers down after.

## Dev Notes

### Read first: this is an investigation-first defect

The epics text is explicit that Story 8.7 "STARTS with a root-cause diagnosis ... before committing a fix, since the mechanism determines the fix." Do not skip to a patch. The suspects below are ranked by how strongly the current code motivates them, but the DevTools Performance trace is the arbiter. It is a legitimate outcome for the trace to show the dominant cost is a browser-internal `content-visibility` reveal that no small JS change fully removes; in that case, record the measurement and land the smallest change that meaningfully reduces the post-return stall (or, if truly nothing helps, document the finding and the residual with numbers). Honesty about what the trace shows beats forcing a fix onto the wrong mechanism.

### The render pipeline (current state, and what happens on tab return)

The reader renders every page as a `PageCard` inside one scroll container (`components/Reader/Reader.tsx`). All cards mount up front at their reserved geometry (NFR-1), and a SINGLE IntersectionObserver drives both the page-in-view indicator and the per-card paint/release window. Relevant files, current behavior:

- **`render/usePageViewport.ts`** (the single IO + rAF windowing hook, Story 1.7 / AR-9). One `IntersectionObserver` on the scroll container; each fire calls `schedule()`, which requests one rAF; `recompute()` (usePageViewport.ts:65-76) then reads `container.getBoundingClientRect()` and loops over EVERY registered card calling `el.getBoundingClientRect()`, picks the top-most visible page, and sets `currentPage` + the `live` window. Because every page mounts up front, `cards.current` holds ALL N pages, so `recompute` is O(N) `getBoundingClientRect` calls per fire.
- **`reader/PageCard.tsx`**. A card paints its canvas + text layer only while `live` (inside +/-`WINDOW_RADIUS`, `WINDOW_RADIUS = 2`), releases the bitmaps when it leaves. A zoom re-paint is DEBOUNCED via `setTimeout(paint, REPAINT_DEBOUNCE)` (150ms, PageCard.tsx:129); the first paint is immediate.
- **`components/Reader/Reader.css:75`**: every `.page-surface` has `content-visibility: auto`, so off-screen cards skip layout/paint entirely (their reserved size comes from the inline `contain-intrinsic-size`). The skeleton pulse (`page-skeleton-pulse ... infinite`, Reader.css:94) runs only on unpainted+live cards and only under `prefers-reduced-motion: no-preference`.
- **Scrolling** is native: `usePageNav.ts` uses `container.scrollTo({ behavior: smooth && !reduceMotion ? "smooth" : "auto" })`. There is NO JS rAF-driven scroll animation to freeze on tab hide, so a "stuck JS animation" is already ruled out.

### Ranked suspects (hypotheses to confirm/reject with the trace)

1. **`content-visibility: auto` reveal + the O(N) measure loop (strongest).** With `content-visibility: auto` on all N cards (Reader.css:75), a backgrounded tab can drop the rendered/laid-out state of off-screen cards. On return, `usePageViewport.recompute` measures ALL N cards with `getBoundingClientRect` (usePageViewport.ts:69-72); measuring a `content-visibility:auto` element forces its skipped layout. On a 50+ page paper with dirty post-return layout, that first `recompute` can force a full-document synchronous reflow, i.e. the multi-frame stall. This single mechanism covers two of the epics' listed suspects at once ("windowing recomputing all visible pages on re-focus" and "stale-layout reflow"). Verify by checking whether the post-return long task is Recalculate Layout attributed to `recompute`.
2. **rAF/IO ordering on return.** Background tabs pause rAF; a rAF pending at hide-time fires on return, and any IO delivery on return schedules another. Two back-to-back O(N) recomputes compound suspect 1. Note: if no scroll happened while hidden, intersection may not actually change, so confirm whether IO even fires on return or whether the cost is purely the browser reveal.
3. **Debounce-timer burst (`setTimeout(paint, 150)`, PageCard.tsx:129).** Background tabs throttle timers to >=1s. If a zoom's debounced repaint was pending when the tab hid, it drains on return. Narrow (only after a mid-gesture zoom at hide), but cheap to rule in/out.
4. **pdf.js render queue.** `renderPage` is async on the pdf worker; a render in flight at hide-time is throttled and drains on return. Check for pdf.js frames in the post-return trace.
5. **Skeleton pulse animation.** CSS animation pauses when hidden and resumes on return; gated behind `prefers-reduced-motion`. Lowest likelihood; rule out quickly.

### Existing visibility-handler precedent (reuse the pattern, do not fight it)

`reader/usePanControl.ts:60-72` already binds `window`'s `blur` and `document`'s `visibilitychange` to release a held Space (so a background switch mid-hold-pan does not leave pan stuck). This is the only visibility handler in the reader today, and it is the established pattern: document/window-level listener, cleaned up on unmount. If your fix needs a `visibilitychange` handler, follow this shape; do not overload `releaseSpace` with unrelated render logic, and do not bind render handlers to `.pdf-canvas` (CLAUDE.md: document-level handlers, the recurring focus-bug lesson). See memory [[held-key-state-reset-on-blur]].

### Prerequisite: a 50+ page paper at DPR>1

AC-3 requires a 50+ page paper, and the two repo fixtures (`fixtures/sample-pdfs/3706598.3713941.pdf`, `.../Multi-task self-supervised visual learning.pdf`) are short conference papers, not 50+ pages. Obtain a large PDF for the smoke (a thesis, a long survey, or several PDFs concatenated with any PDF tool) and import it via the Library. The stall scales with page count and canvas cost, so a large paper at DPR>1 (a real HiDPI display, or an emulated device-pixel-ratio > 1) is where it is observable, per memory [[verify-on-hidpi-and-real-host]]. A short paper at DPR=1 will likely NOT reproduce it.

### What must not regress (NFR-2)

The same O(N) `recompute` loop runs on every scroll-driven IO fire today and is smooth during normal reading, so the windowing itself is not the thing to rip out. The fix must leave intact: lazy paint inside the window, bitmap release on leave, the page-in-view indicator tracking scroll, smooth native scroll, and wheel-zoom. If the fix defers or guards the post-return recompute, make sure a genuine scroll still recomputes promptly (do not starve the indicator/window update during real scrolling).

### Testing standards

- Frontend: `cd client && npm test` (Vitest) and `npm run typecheck`.
- jsdom cannot observe this defect: no `IntersectionObserver` (the hook's fallback makes every card live), no rAF scheduling semantics, no `content-visibility`, no real `document.hidden`/`visibilitychange` timing. So do not try to unit-test the stall. Unit-test only any pure helper the fix extracts (a guard/predicate/debounce), DOM-free, in `render/` or `reader/`. The behavioral proof is the live before/after Performance trace (AC-3).
- If you add any `render/index.ts` export, update BOTH `vi.mock("./render")` barrels (`App.test.tsx`, `Reader.test.tsx`) in the same change (CLAUDE.md engineering principle), or every Reader/App test breaks.

### Live smoke (launch your OWN servers)

Do not reuse a server the user already has running: a found `uvicorn` may predate your edits and a prod/Docker frontend has no HMR, so you would be smoking code that is not yours (CLAUDE.md). Start a fresh backend (`cd server && uv run uvicorn app.main:app --reload --port 8010`) and a fresh Vite dev (`cd client && npm run dev`, alternate port if 5173 is taken), bound to your working tree. Import the 50+ page paper, then run the background/return cycle with the Performance panel recording. Tear the servers down after.

### Project Structure Notes

- Expected touch set is small and client-only: `render/usePageViewport.ts` and/or `reader/PageCard.tsx` and/or `components/Reader/Reader.css`, plus possibly a `visibilitychange` handler co-located with the render layer (or extended cleanly, not overloaded, in an existing reader hook). No backend, no API contract, no store, no anchor/annotation change: this is a pure render/timing defect. render/ stays annotation-free (AD-9).
- No new raw hex/px outside `src/theme/**` (`src/no-raw-values.test.ts` enforces it). `WINDOW_RADIUS` and `REPAINT_DEBOUNCE` are behavioral constants that already live beside their code, not in the token layer; any new timing constant follows that precedent (co-located, commented), not the design tokens.

### Version bump

Per CLAUDE.md versioning (single source `server/pyproject.toml` `[project].version`): PATCH +1 when the story reaches done. Current is `0.5.26`, so this story lands at `0.5.27`. Bump once at story completion, not per commit.

### References

- [Source: .bmad/planning-artifacts/epics.md#Story 8.7: Immediate viewer resume on tab return (added 2026-07-11)] (lines 2074-2097) for the story, AC, and the investigation-first + open-design-calls framing.
- [Source: .bmad/planning-artifacts/epics.md#Epic 8: Reader & annotation polish, round 2] (lines 1914-1916) for the epic charter and the broadening correct-course.
- [Source: sprint-status.yaml] `8-7-tab-switch-resume: backlog`; epic-8 in-progress, broadened by `sprint-change-proposal-2026-07-11-epic-8-9-stories.md`.
- [Source: client/src/render/usePageViewport.ts#usePageViewport] (:41-97, the IO + rAF `recompute` window, :65-76) and [#recompute O(N) getBoundingClientRect loop] (:69-72).
- [Source: client/src/reader/PageCard.tsx] paint/release + the `setTimeout(paint, REPAINT_DEBOUNCE)` zoom debounce (:96-135, const :22).
- [Source: client/src/components/Reader/Reader.css] `.page-surface { content-visibility: auto }` (:75) and the skeleton pulse animation (:88-100).
- [Source: client/src/components/Reader/Reader.tsx] composition root, wires `usePageViewport` (:97-101), maps all cards up front (:228-239).
- [Source: client/src/reader/usePanControl.ts] the existing `visibilitychange`/`blur` release-Space precedent (:60-72).
- [Source: client/src/reader/usePageNav.ts] native `scrollTo({ behavior })` (:47-53), confirming there is no JS scroll animation to freeze.
- [Source: CLAUDE.md] NFR-2 (immersive, non-distracting reading), document-level handler convention, render/ mock-barrel sync rule, own-servers live-smoke rule, no-raw-values, versioning.
- Memory: [[verify-on-hidpi-and-real-host]] (DPR>1 + real host surfaces this class of bug), [[held-key-state-reset-on-blur]] (visibility/blur handler precedent and cleanup).

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
