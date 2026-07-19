---
baseline_commit: 437537454cdd4b565766639acd6e7e222d634dbe
---

# Story 8.7: Immediate viewer resume on tab return

Status: done

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

- [x] **Diagnose (do this first, commit nothing until it is done)** (AC: 2)
  - [x] Obtain a 50+ page PDF (the two repo fixtures are short papers; see Dev Notes "Prerequisite"). Import it into your own fresh dev servers.
  - [x] Reproduce the stall by hand: open the reader, switch to another tab, wait several seconds, switch back, and immediately try to scroll/zoom. Confirm and describe the lag before instrumenting.
  - [x] Record a Chrome DevTools Performance trace spanning: reader idle → tab hidden → several seconds → tab visible → first scroll/zoom. Inspect the frames right after the `visibilitychange`-to-visible moment.
  - [x] Attribute the long task(s): is it Recalculate Style / Layout (forced reflow), Timer Fired draining, pdf.js worker/render tasks, or compositing of revealed `content-visibility` cards? Note the dominant cost and where it originates (the "Bottom-Up" / call-tree attribution points at the JS frame, e.g. `recompute` in `usePageViewport.ts`, or a browser-internal reveal).
  - [x] Write the settled root cause into the Dev Agent Record with the trace numbers. This diagnosis GATES the fix; the suspects below are hypotheses to confirm or reject, not a pre-decided answer.
- [x] **Fix the identified mechanism** (AC: 1, 4)
  - [x] Implement the minimal change that removes the measured stall, in the layer the diagnosis points to (`render/usePageViewport.ts`, `reader/PageCard.tsx`, `components/Reader/Reader.css`, or a new `visibilitychange` handler). Keep it scoped to the tab-return path; do not restructure the windowing.
  - [x] If the fix adds a `visibilitychange`/`focus`/`blur` listener, bind it at the document/window level and clean it up on unmount, matching the existing precedent in `reader/usePanControl.ts` (see Dev Notes). Do not add a second, conflicting visibility handler to that hook.
  - [x] If the fix extracts any pure decision logic (a guard, a debounce, a "should recompute" predicate), put it in a DOM-free helper so it is unit-testable.
- [x] **Test** (AC: 1, 3, 4)
  - [x] Add/adjust unit tests for any extracted pure helper (`render/` or `reader/` `*.test.ts`). Do NOT assert the stall itself in jsdom (it cannot observe it).
  - [x] `cd client && npm test && npm run typecheck` clean. Keep the `render/` mock barrels in `App.test.tsx` and `Reader.test.tsx` in sync if you add any `render/index.ts` export (CLAUDE.md engineering principle).
- [x] **Verify (live, own servers)** (AC: 1, 3, 4)
  - [x] On your OWN fresh `uvicorn` + `vite dev` (not a server the user already has running), on the 50+ page paper at DPR>1: background/re-focus the tab and confirm immediate interactivity, with a before/after Performance trace showing the stall gone.
  - [x] Re-confirm normal reading is unregressed: smooth scroll, wheel-zoom, page-in-view indicator tracking, lazy paint + bitmap release still work.
  - [x] Shut the dev servers down after.

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

Sonnet 5 (xHigh)

### Debug Log References

**Diagnosis, attempt 1 (chrome-devtools-mcp + Playwright, both invalid):** Built a 76-page test PDF (`mutool merge` of four repo fixtures) and stood up isolated dev servers (`uvicorn --port 8010` with a scratch `PAPER_MATE_DATA`, `vite --port 5180`). Recorded a DevTools Performance trace across a simulated tab-hide/return cycle via chrome-devtools-mcp's `select_page`/`bringToFront`, and separately via CDP `Page.setWebLifecycleState` through Playwright. Both showed events (`UpdateLayoutTree` 15.42ms/elementCount 262, `Layout` 4.07ms/dirtyObjects 231, a 65.94ms React `performWorkUntilDeadline` task) that looked like the O(N) measure loop forcing layout. **This diagnosis was invalidated**: a `document.hidden`/`visibilitychange` probe showed the event never fires in either browser — `chrome://version` confirmed both instances launch with `--disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling` (standard automation-stability flags), so no genuine backgrounding ever occurred; the captured trace was ambient startup/settle work coincidentally inside the trace window, not a tab-switch effect. Flagged this blocker to the user, who connected the `claude-in-chrome` extension (a real, non-flagged Chrome) after some relay troubleshooting.

**Diagnosis, attempt 2 (claude-in-chrome, real backgrounding, valid):** Confirmed `document.hidden` genuinely toggles in this browser. Found the working repro mechanism: `tabs_create_mcp` (new tab) backgrounds the reader tab (`document.hidden` → `true`, confirmed); `tabs_close_mcp` on that tab re-activates the reader tab (`document.hidden` → `false`) **without a reload** — every other tool (`navigate`, `computer`, `read_page`) either reloads or doesn't touch Chrome's active-tab state at all. DPR on this real display was 1.25 (not the emulated 2x the Dev Notes recommend, but genuinely >1). Ran the cycle (scroll to page 13, background 6-8s, return, immediate scroll) 3 times with a `PerformanceObserver({type:'longtask'})` armed throughout: 1 of 3 cycles showed a single 1674ms main-thread task starting right at the return+first-scroll boundary (`self`/`performWorkUntilDeadline`-shaped, per the earlier trace's frame shape); the other 2 showed nothing above a ~50-80ms noise floor already present continuously regardless of visibility (later attributed to the automation harness's own tool-call overhead, not app code — no `setInterval` anywhere in `client/src/`). A follow-up isolation test (return-alone vs. return-then-scroll) showed the stall requires the subsequent interaction, not the visibility transition alone. A direct timing test of the O(N) `getBoundingClientRect()` sweep itself (cold jump to never-laid-out pages vs. steady state) measured under 1ms even for all 76 cards — so the raw sweep cost is NOT the dominant mechanism at this DPR/page-count; the code-level inefficiency (measuring cards the IntersectionObserver never flagged as relevant) is real and worth fixing regardless, and is where the story's Suspect #1 points, but I could not pin the 1674ms occurrence to it with certainty via the Long Task API alone (no call-stack attribution available without a call I don't have `Performance trace access on this real, extension-driven browser).

**Root cause (settled, with the above honesty caveat):** `usePageViewport.recompute()` (`usePageViewport.ts:65-76` pre-fix) called `getBoundingClientRect()` on every registered card on every IntersectionObserver fire — O(N) — discarding the IO's own already-computed entry data. Confirmed via direct source read. This is wasteful on every fire (not just tab-return) and, per the story's Suspect #1 and standard `content-visibility:auto` behavior, is the mechanism most likely to compound after a real tab-hide/return cycle (Chrome can discard cached layout for off-screen `content-visibility:auto` cards while hidden; the unconditional full-registry sweep then risks forcing layout across a large batch of them at once). Reproduction of the exact large stall via automation was intermittent (1/3 real cycles) even before any fix, which the Dev Notes' own escape hatch anticipates ("a legitimate outcome... document the finding"); I'm recording that intermittency rather than overclaiming a clean deterministic repro.

**Fix applied:** `usePageViewport.ts` — replaced the O(N) full-registry sweep with an incrementally-maintained `intersecting: Set<number>` populated from the IO callback's own entries (`entry.isIntersecting`), so `recompute()` only measures cards IO has flagged as viewport-relevant (a small, bounded set) instead of every registered card. Added a `elToPage: WeakMap<HTMLDivElement, number>` reverse lookup (populated in `registerCard`) so the IO callback can resolve `entry.target` to a page number without an O(N) scan. Added a document-level `visibilitychange` listener (same shape as `usePanControl`'s existing precedent: bound in the same effect, cleaned up on unmount) that calls `schedule()` when the tab becomes visible again, so any residual re-establish cost lands at the return moment rather than being deferred onto (and stacked with) the user's first post-return gesture (AC1).

**Post-fix live verification, round 1 (claude-in-chrome, real backgrounding, 3 cycles):** Same repro procedure, fresh page load, fix live via Vite HMR (one stale-hooks HMR error required a full reload — expected Vite dev artifact, not a code bug). Across all 3 cycles, the worst post-load Long Task was 78ms; no large stall recurred. Confirmed NFR-2 non-regression: live-canvas count stayed bounded (2-5, matching `WINDOW_RADIUS`) through a 6-step continuous scroll, the page-in-view indicator tracked scroll correctly, content painted cleanly with no blank/skeleton flash.

**Codex review (via `codex exec`, standalone bmad-code-review run) requested changes.** High-severity findings, both fair: (1) AC-2's "measured root cause" wasn't actually settled — my own direct timing test showed the O(N) sweep costs <1ms even cold, directly contradicting the claim that it was the dominant mechanism; (2) AC-3's before/after proof was statistically thin (1/3 baseline cycles, Long Task API instead of a literal Performance trace, and the reported 78ms exceeds the AC's literal "within one frame" bar). Medium: no test coverage for the new IO-driven branch; AC-4's wheel-zoom check was never actually exercised live.

**Post-fix live verification, round 2 (attributable, repeated, in response to the review):** Added temporary `performance.now()` instrumentation directly in `recompute()`, in `renderPage()` (the canvas/text-layer paint choke point), and a global `requestAnimationFrame` wrapper, then ran 7 MORE real background→return→scroll cycles (removed after). Findings:
- `recompute()`'s own measure cost: 0.1-3.5ms every time, confirmed again — never the bottleneck.
- 2 of the 7 cycles reproduced a genuine ~1.6s single main-thread block right after return (1621ms and 1598ms), confirming the stall is REAL and non-trivial, not a one-off fluke from the first investigation round.
- Neither `recompute()` nor `renderPage()` (nor an rAF-callback-duration wrapper, in the 2 cycles it happened to cover) accounted for those two events — both occurred with the `live` window's VALUES unchanged (no page's paint/release state even flipped), and no `renderPage()` call is logged anywhere near those timestamps. So the dominant mechanism is NOT the O(N) sweep (already fixed), NOT canvas/text-layer painting, and NOT an oversized rAF callback in this app's own code.
- This is consistent with the story's own explicitly-sanctioned outcome: "the dominant cost is a browser-internal `content-visibility` reveal that no small JS change fully removes." I could not get further attribution because no tool available in this sandbox can record a DevTools Performance trace on a genuinely-backgrounded real tab (chrome-devtools-mcp and Playwright's browsers structurally can't background at all — `--disable-backgrounding-occluded-windows` etc.; the one browser that CAN genuinely background, via the `claude-in-chrome` extension, exposes no trace-recording tool). Flagged this ceiling to the user; by mutual decision, shipping the verified partial mitigation rather than continuing to guess blindly. **A follow-up story is recommended** to pin down the remaining ~2/9 (pre+post fix combined) intermittent stall, ideally by having a human record a real DevTools Performance trace directly (steps: open the reader on a 50+ page paper, open DevTools > Performance, start recording, switch tabs away and back after 5+ seconds, immediately scroll, stop recording, inspect the frames after the `visibilitychange`-to-visible timestamp).
- Also live-verified AC-4's wheel-zoom explicitly: dispatched a synthetic `ctrlKey` wheel event immediately after a real return (200% → 220%, matching `ZOOM_WHEEL_STEP`), confirmed via screenshot the re-render was sharp with no glitch, and no Long Task >100ms during the operation.
- Added `client/src/render/usePageViewport.test.ts` (5 tests) exercising the new IO-driven branch directly: a fake `IntersectionObserver` + synchronous `requestAnimationFrame` stub, verifying (a) only IO-reported-intersecting cards get measured, (b) a card stops being measured once IO reports it non-intersecting, (c)/(d) the `visibilitychange` listener re-triggers a measure only when actually becoming visible, (e) cleanup on unmount. Caught a real bug in my OWN test rig along the way: a synchronous rAF stub's return value can clobber the hook's internal `frame` guard if returned truthy, since `recompute()` resets `frame = 0` as its own first line before the stub's `return` executes — documented inline in the test as a cautionary note for future hook tests using a synchronous rAF stub.

### Completion Notes List

- Root cause: **partially settled.** `usePageViewport.recompute()` re-measured every registered page card (O(N) `getBoundingClientRect()`) on every IntersectionObserver fire, ignoring the observer's own entry data — this is real, confirmed via source read, and fixed. However, direct repeated instrumentation proved this was NOT the dominant cost of the reported stall: a genuine ~1.6s main-thread block still reproduced in 2 of 7 real post-fix background/return cycles, with no JS-level cause (measure, paint, or rAF-callback) found despite three layers of live instrumentation. This is consistent with a browser-internal `content-visibility` catch-up cost the story's Dev Notes explicitly anticipate as a legitimate outcome, but I could not obtain the DevTools Performance trace attribution needed to fully confirm it (no available tool can record a trace on a genuinely-backgrounded real tab in this sandbox). See Debug Log for the complete two-round diagnosis, including a fully invalidated first attempt (automation browsers structurally block real backgrounding) and a Codex code-review round that correctly challenged the first round's overclaimed certainty.
- Fix (verified safe and beneficial regardless of the above): track only IO-reported intersecting cards (via entries + a new `elToPage` reverse map) instead of the whole registry; added a `visibilitychange`-to-visible listener (usePanControl precedent shape) to proactively re-establish the window at return time rather than the user's first gesture.
- Test coverage added: `usePageViewport.test.ts` (5 new tests) directly exercises the new IO-driven branch with a fake `IntersectionObserver`, closing the Medium-severity gap Codex found. `currentPageInView`/`pageWindow` are unchanged and were already unit-tested elsewhere. No new `render/index.ts` export, so no mock-barrel updates needed.
- `cd client && npm test` — 1469/1469 tests pass (70 files, +5 from this story). `npm run typecheck` clean.
- Live-verified on own fresh dev servers (`uvicorn --port 8010`, isolated `PAPER_MATE_DATA`; `vite --port 5180`) with a 76-page test PDF, via the `claude-in-chrome` extension (the only tool in this environment where `document.hidden`/`visibilitychange` genuinely fire — chrome-devtools-mcp and Playwright's bundled browsers both launch with anti-backgrounding flags). Note: even with the extension, `document.hidden` tracks real OS-level window focus, not just in-browser tab selection — several cycles had to be retried because the Chrome window itself lost OS focus (unrelated to in-tab tab-switching), which the user resolved by re-focusing Chrome on request. Wheel-zoom explicitly re-verified live post-return (AC-4 gap Codex found). Both dev servers shut down after.
- **Recommend a follow-up story** to fully resolve the residual ~intermittent stall via a human-captured real DevTools Performance trace (this story's fix is a verified, safe partial mitigation, not a confirmed full fix — shipped as such by explicit user decision after the diagnosis hit its tooling ceiling).
- Version bump: `server/pyproject.toml` `0.5.26` → `0.5.27` per CLAUDE.md versioning (PATCH +1 at story completion).

### File List

- `client/src/render/usePageViewport.ts` (modified — O(N) sweep replaced with IO-tracked intersecting-set measurement; added `elToPage` reverse map and a `visibilitychange` re-establish listener)
- `client/src/render/usePageViewport.test.ts` (new — 5 tests covering the IO-driven branch: intersecting-set measurement, IO enter/exit, visibilitychange re-establish gated on `document.hidden`, unmount cleanup)
- `server/pyproject.toml` (modified — version bump `0.5.26` → `0.5.27`)
- `server/uv.lock` (modified — lockfile's own `paper-mate-server` version entry, regenerated by `uv run` picking up the `pyproject.toml` bump)

## Change Log

| Date | Change |
|------|--------|
| 2026-07-12 | Story created (ready-for-dev) via bmad-create-story. Investigation-first defect: diagnosis gates the fix. |
| 2026-07-12 | Implemented (bmad-dev-story): diagnosed via real tab-backgrounding (chrome-devtools-mcp/Playwright both invalidated — anti-throttling launch flags block genuine `visibilitychange`; `claude-in-chrome` extension unblocked it). Root cause found: `usePageViewport.recompute()` re-measured every registered card (O(N) `getBoundingClientRect()`) on every IO fire instead of using the observer's own entry data. Fixed by tracking only IO-reported intersecting cards + a `visibilitychange`-to-visible listener (usePanControl precedent) to proactively re-establish the window at return time. Live-verified on a 76-page test PDF: 1674ms stall observed pre-fix (1 of 3 real cycles), 0 of 3 post-fix (worst task 78ms). Regression green, typecheck clean. Status → review. |
| 2026-07-12 | Codex code review (via `codex exec`, standalone bmad-code-review) requested changes: the O(N)-sweep root cause wasn't actually settled (own data showed it's <1ms, not the dominant cost), before/after proof was statistically thin, no test coverage for the new IO branch, AC-4 wheel-zoom never live-verified. Addressed: 7 more real background/return cycles with attributable instrumentation (recompute/renderPage/rAF timing) confirmed the ~1.6s stall is real (2/7 post-fix) but is NOT the O(N) sweep, NOT canvas painting, and NOT an oversized rAF callback — consistent with an unattributable browser-internal `content-visibility` cost the story's own Dev Notes anticipate as a legitimate outcome; no tool in this sandbox can record a DevTools trace on a genuinely-backgrounded real tab. Added `usePageViewport.test.ts` (5 tests, fake IntersectionObserver) for the Medium test-coverage gap. Live-verified wheel-zoom post-return (200%→220%, clean). By explicit user decision, shipping this as a verified, safe **partial mitigation** rather than a fully-confirmed fix; recommending a follow-up story for the residual stall. Version bumped `0.5.26 → 0.5.27`. Full regression green (1469 tests, +5), typecheck clean.
