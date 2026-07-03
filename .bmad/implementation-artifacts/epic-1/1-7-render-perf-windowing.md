---
baseline_commit: 1874153d38d285f7f5a21ad15701160a46401b9d
---

# Story 1.7: Render performance — windowing & viewport unification

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> Added 2026-06-28 via correct-course (`.bmad/planning-artifacts/sprint-change-proposals/sprint-change-proposal-2026-06-28-render.md`). Completes the Story 1.4 **NFR-2** claim (scroll was jittery, not ~60fps) and resolves the virtualization item in `deferred-work.md`. **Root cause:** `PageCard` marks a page `visible` once and never releases its painted canvas + text layer, so every page scrolled past keeps a full hi-DPI canvas + a text-layer DOM forever — cost scales with zoom² — amplified by an always-on, off-screen infinite skeleton animation that composites on every unpainted card. Sequenced ahead of pan/ToC (1.8/1.9): it **restructures the render layer those stories build on**, so the refactor lands first.

## Story

As a reader,
I want scroll to stay fluid on a long paper,
so that reading never stutters.

## Acceptance Criteria

1. **~60fps scroll on a long paper.** Given a 50+ page paper, when I scroll up and down, then it holds ~60fps with no jitter (no long tasks from accumulated canvases). [FR-4, NFR-2]
2. **Bounded live canvases (windowed release).** Given pages scrolled out of view, then their canvas / text-layer bitmaps are **released** beyond a ±N-page window (the live-canvas count stays bounded at roughly `2N+1`), while **card geometry is preserved** so layout never shifts on release or re-entry. [NFR-1]
3. **Off-screen cards incur no continuous paint.** Given off-screen cards, then they do not composite continuously: `.page-surface` uses `content-visibility: auto` + `contain-intrinsic-size` (the reserved geometry), and the skeleton pulse animation runs **only** near the viewport, not on every off-screen card. [NFR-2, NFR-5]
4. **One observer, unified in a hook; `PageCard` holds no lifecycle logic.** Given the render layer, then a **single** `IntersectionObserver` (a `usePageViewport` hook) drives **both** current-page tracking **and** per-card paint / release. `PageCard` owns no observer and no visibility/window decision (it paints/releases in response to a `live` prop); `Reader` is a pure shell that wires the hook to the cards. The hook stays annotation-agnostic. [AR-9]
5. **No regression in zoom / page-in-view / PgUp-PgDn.** Given zoom (Ctrl +/−/0, Ctrl+wheel, top-bar control), page-in-view reporting, and PgUp/PgDn (+ Ctrl+Arrow aliases), then **all existing Story 1.4 / 1.5 behaviors and their tests still pass** unchanged.

> **Scope guard.** This story is a **render-layer-internal refactor for performance**. It adds: a pure `pageWindow` helper + a `WINDOW_RADIUS` constant in `render/index.ts`; a new `render/usePageViewport.ts` hook owning the single `IntersectionObserver` + the card registry + the live-window decision; the rewiring of `Reader.tsx` to consume the hook and pass a `live` prop down; the paint/**release** lifecycle in `PageCard`; and the `content-visibility`/`contain-intrinsic-size`/skeleton CSS. It does **NOT**: change the render *algorithm* (`renderPage`’s offscreen-render-and-atomic-swap, the AD-4 `getPageBox`, the HiDPI math) — those stay byte-for-byte; change zoom math, scroll-nav math, or the focal-anchor logic; add or alter any `/api` route, Pydantic model, OpenAPI contract, or `docs/API.md`; touch the `render/` annotation-agnostic boundary (no import from `anchor/`/`annotations/`/`store/`, no normalize/denormalize math — AR-9); add a CDN or change asset wiring (Story 1.6); or add new runtime dependencies. Do **not** pull pan or ToC work forward.

## Tasks / Subtasks

- [x] **Task 1 — Pure windowing helper + radius constant in `render/index.ts`** (AC: 2, 4)
  - [x] Add a behavioral constant `WINDOW_RADIUS` (suggest `2`) next to the other interaction constants (`ZOOM_*`), with a comment that it is the ±N-page live band — a perf tuning constant, **not** a design dimension, so it lives here, not in the token layer. `2N+1 = 5` live cards bounds the painted hi-DPI canvases regardless of zoom.
  - [x] Add a pure, DOM-free helper `pageWindow(current: number, radius: number, pageCount: number): { start: number; end: number }` returning the inclusive 1-based page range `[max(1, current-radius), min(pageCount, current+radius)]`, clamped (and `{ start: 1, end: 0 }` empty range for `pageCount < 1`). Mirror the style of `currentPageInView` / `pageNavTarget` (plain layout arithmetic, no anchor math — AR-9). Placed adjacent to `pageNavTarget`.
  - [x] Unit-tested in `client/src/render/nav.test.ts`: window around a mid page, clamp at page 1 and at `pageCount`, `radius 0` (single page), and `pageCount === 0`/`1` edges.
- [x] **Task 2 — `usePageViewport` hook: the single observer + live window** (AC: 1, 2, 4)
  - [x] Created `client/src/render/usePageViewport.ts` (new). It is the **single** `IntersectionObserver` owner and the source of the paint/release decision. Pure pdf.js/viewport plumbing — no import from `anchor/`/`annotations/`/`store/` (AR-9). Imports `currentPageInView`, `pageWindow`, `WINDOW_RADIUS`, `type PageExtent`, `type PageWindow` from `./index`.
  - [x] Signature: `usePageViewport(scrollRef, pageCount, active): { registerCard, cards, currentPage, isLive }`. `registerCard` adds/removes a card node in an internal `Map` ref; `cards` exposes that ref (Reader reads it for PgUp/PgDn + zoom focal anchor); `currentPage` is the 1-based page in view (default 1); `isLive(pageNumber)` = inside the current ±`WINDOW_RADIUS` window (or always true when no IO).
  - [x] **One observer.** When `active` + IO supported, ONE `IntersectionObserver` (`root: scrollRef.current`) observes every registered card. rAF-batched callback reads container + card rects → `currentPageInView` → `setCurrentPage`, then `pageWindow(page, WINDOW_RADIUS, pageCount)` → `setLive` (reactive `isLive`, so PageCards re-render when the window shifts). Re-establishes on `active`/`pageCount` change; `io.disconnect()` + `cancelAnimationFrame` on cleanup.
  - [x] **No-`IntersectionObserver` fallback (jsdom / SSR):** `supportsIO === false` → `isLive` returns `true` for all (eager paint), `currentPage` stays `1`. The observer effect no-ops, so `pageWindow` is never called on this path. Reproduces today’s behavior; existing Reader suite passes (the `useState` initializer’s single `pageWindow(1, …)` call is satisfied by the mock — see footgun).
- [x] **Task 3 — `Reader.tsx` becomes a pure shell over the hook** (AC: 4, 5)
  - [x] Imports the hook from `./render/usePageViewport` directly — NOT the `./render` barrel — so `vi.mock("./render")` leaves the real hook in place.
  - [x] Replaced the Reader-local card registry (`cardEls` + `registerCard`) **and** the page-in-view `IntersectionObserver` effect with `const { registerCard, cards, currentPage, isLive } = usePageViewport(scrollRef, doc.page_count, phase === "ready");`. The hook owns the registry + observer.
  - [x] Rewired `captureAnchor` (map iteration) and `handleKeyDown` PgUp/PgDn (`get(target)`) to `cards.current`. Behavior identical.
  - [x] Kept the `onVisiblePageChange?.(currentPage)` effect (now reads the hook’s `currentPage`).
  - [x] Passes `live={isLive(i + 1)}` into each `<PageCard>`; `register={registerCard}` retained.
  - [x] Left ALL zoom interaction untouched (`applyScale`/`captureAnchor`/`centerFocal`/`zoom*`, wheel/key/imperative effects, focal layout effect). Removed only the `currentPageInView`/`PageExtent` imports (now used by the hook).
- [x] **Task 4 — `PageCard`: presentational paint **and release** on the `live` prop** (AC: 2, 3)
  - [x] Added `live: boolean` prop. Removed PageCard’s own `IntersectionObserver` + `visible` state and the now-unused `PREFETCH_MARGIN` const.
  - [x] **Paint:** gated the paint effect on `live` (was `visible`); offscreen-swap + first-paint-immediate / zoom-debounce contract unchanged. Under the jsdom no-IO fallback `live` is always true → matches today’s behavior.
  - [x] **Release:** a `useEffect([live])` frees bitmaps when `live` is false — `canvas.width = canvas.height = 0`, clear transform, `textRef.replaceChildren()`, `renderedScaleRef = 0`, `setPainted(false)`. Card `width`/`height` untouched → no layout shift (NFR-1). Re-entry hits the first-paint-immediate branch (`renderedScaleRef === 0`).
  - [x] Cancel-on-cleanup preserved; leaving the live window unmounts the in-flight paint → scrolled-away renders cancel (the deferred-work item).
- [x] **Task 5 — CSS: `content-visibility` + `contain-intrinsic-size`, skeleton near-viewport only** (AC: 3)
  - [x] Added `content-visibility: auto;` to `.page-surface` in `Reader.css`.
  - [x] Inline `containIntrinsicSize: \`${width}px ${height}px\`` on the card (computed, like width/height) — no `\d+px` literal in CSS/source, so `no-raw-values` passes.
  - [x] Skeleton gated `{!painted && live && …}` so released far cards hold no animating node; `prefers-reduced-motion` guard kept.
  - [x] `no-raw-values.test.ts` + `focus-ring.test.ts` green.
- [x] **Task 6 — Tests** (AC: 2, 4, 5)
  - [x] `pageWindow` unit tests added to `nav.test.ts` — green.
  - [x] `Reader.test.tsx` green. Real `usePageViewport` runs its no-IO fallback (all live, page 1). One required mock change: the hook’s `useState` initializer calls `pageWindow(1, WINDOW_RADIUS, …)` at render, so `pageWindow` + `WINDOW_RADIUS` were added to the `vi.mock("./render")` factories in **both** `Reader.test.tsx` and `App.test.tsx` (App renders Reader). All existing assertions (renderPage×page_count, onVisiblePageChange(1), nav deltas via `cards.current`, zoom %, imperative handle, no-flicker pre-scale) pass unchanged.
  - [x] Skipped the optional IO-stubbed hook test: jsdom has no real layout/IO, so the windowing proof is the Task-7 live browser smoke (below).
- [x] **Task 7 — Validate + live smoke** (AC: all)
  - [x] `npm test` (79 passed, incl. `pageWindow` + untouched Reader/App suites), `npm run typecheck` (clean), `npm run build` (succeeds, static-copy emits assets).
  - [x] **Live smoke** on a real **69-page** paper (fixture ×3 via `pdfunite`) served from the built `dist/` by FastAPI on :8000, driven through Chrome DevTools:
    - **Bounded canvases (AC-1/AC-2):** at top, exactly **3** painted (pages 1–3 = window ±2 around page 1); scrolled to page 35, exactly **5** painted (pages **33–37**), pages 1–3 **released** (`canvas.width → 0`). Live count never exceeds `2·WINDOW_RADIUS+1`, vs 69 pre-refactor.
    - **No layout shift (NFR-1):** `scrollHeight` held at 110976 across release + re-entry; returning to top **re-painted** pages 1–3 crisply, mid-doc released.
    - **Off-screen no paint (AC-3):** released cards drop their skeleton node; `content-visibility: auto` skips off-screen layout/paint.
    - **No regression (AC-5):** Ctrl+= zoom grew the canvas (1224→1912px CSS, `scrollHeight` 110976→172455) while the live count stayed bounded at 3; **console clean** (zero errors/warnings) across the full scroll + zoom.
  - [x] No backend change — OpenAPI contract / `docs/API.md` untouched.

## Dev Notes

### Architecture patterns & constraints (binding)

- **`render/` owns the viewport; it knows NOTHING about annotations (AR-9).** The new `usePageViewport` hook and `pageWindow` helper are pure pdf.js/viewport/projection concerns and belong in `render/`. They must not import from `anchor/`, `annotations/`, or `store/`, and must not do normalize/denormalize coordinate math. The hook is React glue around the existing pure helpers (`currentPageInView`, the new `pageWindow`) — layout arithmetic only. [Source: ARCHITECTURE-SPINE.md AD-9 rule (lines 100-101); ARCHITECTURE-SPINE.md source-tree `render/` “viewport/projection”; epics.md AR-9 (line 82); client/src/render/index.ts header]
- **NFR-1 layout stability is the defining bar — release must never reflow.** The PDF area is pixel-stable regardless of state. Card geometry is reserved up front (Story 1.3) and MUST stay reserved when a card releases its bitmap: only the canvas backing store + text DOM are dropped; the card’s `width`/`height` (and now `contain-intrinsic-size`) are untouched. [Source: epics.md NFR-1 (line 64); epics.md line 257 “page geometry never reflows”; ARCHITECTURE-SPINE.md NFR-1 row (line 196)]
- **NFR-2 smoothness is what this story delivers.** ~60fps, no jank on 50+ pages. The win is bounding live hi-DPI canvases (cost scaled with zoom² before) and stopping off-screen compositing (`content-visibility: auto` + skeleton-near-viewport-only). [Source: epics.md NFR-2 (line 65); sprint-change-proposal-2026-06-28-render.md §1.A; deferred-work.md “Scroll-away render cancellation → Story 1.7”]
- **NFR-5 immersion / restraint.** No new chrome; the skeleton is a quiet placeholder and must not animate off-screen. [Source: epics.md NFR-5 (line 68)]
- **No backend / contract change.** Pure client render refactor. No `/api` route, Pydantic model, OpenAPI regen, or `docs/API.md` edit. [Source: ARCHITECTURE-SPINE.md capability map “FR-1..FR-6 … client `render/`”; sprint-change-proposal-2026-06-28-render.md §2 “no spine change”]

### The one real footgun (read before coding)

- **`Reader.test.tsx` does `vi.mock("./render")` — keep the hook OFF that barrel.** The whole `render` module is mocked in the Reader tests (pdf.js can’t run under jsdom). If you export `usePageViewport` from `render/index.ts` and import it in `Reader` via `./render`, the test gets the mock’s value (`undefined`) and `Reader` crashes calling it. **Mitigation (do this):** put the hook in its own module `render/usePageViewport.ts` and import it in `Reader` as `./render/usePageViewport`. Vitest mocks by resolved module id; the sub-path is a different id from the mocked `./render`, so the **real** hook runs in the test. The real hook’s **no-`IntersectionObserver` fallback** (all cards live, `currentPage = 1`) then reproduces today’s jsdom behavior, and the existing suite passes **without editing the mock factory**. (The hook’s own `import { pageWindow, currentPageInView } from "./index"` DOES resolve to the mocked barrel inside the Reader test — that’s fine because the no-IO path never calls them. If you add a hook test that drives the IO path, fake `IntersectionObserver` and add `pageWindow` to that test’s mock.) [Source: client/src/Reader.test.tsx:9-25]
- **`content-visibility: auto` + `getBoundingClientRect`.** Skipped (off-screen) cards still report their own box rect from `contain-intrinsic-size`, so the hook’s `currentPageInView` extent reads stay correct. Just ensure `contain-intrinsic-size` equals the reserved geometry (set it inline next to `width`/`height`) so skipped cards don’t collapse. [Source: client/src/Reader.tsx:528-537 inline geometry pattern]
- **`no-raw-values.test.ts` bans `\d+px` in non-theme `.css`/`.tsx`.** Put `content-visibility: auto` (keyword, fine) in `Reader.css`, but feed the intrinsic *size* via the computed inline `${width}px ${height}px` string (no digit-then-`px` literal in source → passes), exactly as `width`/`height` already do. Don’t hardcode a px size in CSS. [Source: client/src/no-raw-values.test.ts:25-26,46]

### Current state of files this story touches (read before editing)

- `client/src/render/index.ts` — the pdfjs-dist wrapper + the DOM-free pure helpers (`fitToWidthScale`, `nextZoom`, `focalScroll`, `currentPageInView`, `pageNavTarget`) and `renderPage`. **Today:** `renderPage` already renders offscreen and swaps canvas + text-layer atomically, sets `--scale-factor`/`--total-scale-factor`, and `cancel()`s in-flight work — **leave it byte-for-byte.** **Change:** add `WINDOW_RADIUS` + `pageWindow` only (alongside `currentPageInView`). [client/src/render/index.ts:141-165 (the page-tracking helpers), 180-246 (`renderPage`, out of scope)]
- `client/src/render/usePageViewport.ts` — **NEW.** The single `IntersectionObserver` + card registry + live-window state. Replaces the observer logic currently split across the Reader page-tracking effect and PageCard’s own observer.
- `client/src/Reader.tsx` — **Today:** owns `cardEls` + `registerCard` (`:65,74-77`); a page-in-view `IntersectionObserver` effect (`:235-267`); `captureAnchor` iterates `cardEls.current` (`:116`); `handleKeyDown` reads `cardEls.current.get(target)` (`:342`); `PageCard` (`:417-543`) has its **own** `IntersectionObserver` + `visible` state (`:434,462-478`) and the paint effect (`:487-526`). **Change:** consume `usePageViewport` (registry + observer move into it); route `captureAnchor`/`handleKeyDown` through `cards.current`; pass `live` to `PageCard`; `PageCard` drops its observer/`visible`, gates paint on `live`, and adds the release path. Zoom + focal-anchor logic untouched. [client/src/Reader.tsx]
- `client/src/Reader.css` — **Today:** `.page-surface` (reserved card, hairline, shadow), `.page-surface__skeleton` with `page-skeleton-pulse … infinite` under a `prefers-reduced-motion` guard. **Change:** add `content-visibility: auto` to `.page-surface`; the skeleton only renders near-viewport (gated in TSX). Tokens only — no raw px/hex. [client/src/Reader.css]
- `client/src/Reader.test.tsx` — **Today:** mocks `./render`; asserts reserve-then-stream, page-1 default, nav deltas, zoom %, imperative handle, no-flicker. **Change:** ideally none (real hook’s no-IO fallback keeps it green); adjust only if an assertion referenced removed internals. [client/src/Reader.test.tsx]

### Testing standards

- Frontend tests run on **Vitest + jsdom** (`npm test`); typecheck via `npm run typecheck`. DOM-free render helpers get a focused unit test alongside them in `client/src/render/` (`fit.test.ts`, `nav.test.ts`, `zoom.test.ts`, `config.test.ts` are the precedent — `pageWindow` joins `nav.test.ts` or a new `window.test.ts`). [Source: CLAUDE.md commands; client/src/render/*.test.ts]
- The **perf ACs (1, 2, 3) are proven by the Task-7 live smoke**, not jsdom — jsdom has no real layout, no `IntersectionObserver`, no fps. Do not claim AC-1/2/3 met without the DevTools Performance + bounded-canvas-count check on a 50+ page paper. The automated coverage locks the pure window math + the no-regression contract (existing Reader suite). [Source: sprint-change-proposal-2026-06-28-render.md §5 success criteria]
- `no-raw-values.test.ts` / `focus-ring.test.ts` must stay green. [Source: client/src/no-raw-values.test.ts; client/src/focus-ring.test.ts]

### Previous-story intelligence (1.6 decoders, 1.5 zoom, 1.4 scroll)

- **1.6 (just merged, PR #6) is orthogonal but adjacent.** It added `render/config.ts` + a Vite static-copy of decoder assets and spreads `PDFJS_ASSET_CONFIG` into `loadDocument`. This story touches none of that — but `render/index.ts` now imports `./config`; don’t disturb that import when adding `pageWindow`. [Source: 1-6-pdfjs-decoder-assets.md File List; client/src/render/index.ts:25,47-52]
- **1.5 settled the render/zoom path — preserve it.** `renderPage` paints offscreen and atomically swaps canvas + text layer, sets the scale-factor vars, and cancels in-flight renders; the CSS pre-scale (`PageCard` `useLayoutEffect` on `scale`) gives flicker-free zoom feedback. The release path must coexist with this: releasing resets `renderedScaleRef = 0` so a re-entry repaints cleanly, and the pre-scale layout effect no-ops while `renderedScaleRef === 0`. Don’t refactor `renderPage`. [Source: 1-5-zoom.md Dev Notes; client/src/render/index.ts:180-246; client/src/Reader.tsx:455-460]
- **1.4 introduced the IO-driven page tracker this story unifies.** The current `currentPageInView` + the rAF-batched IO recompute (`Reader.tsx:235-267`) is the proven pattern — move it into the hook intact and extend it to also emit the live window. The `pageNavTarget`/PgUp-PgDn contract is unchanged. [Source: 1-4-scroll-and-page-navigation.md; client/src/render/index.ts:141-165]
- **The deferred-work item this closes:** “Scroll-away render cancellation … `PageCard` marks a page visible once and disconnects the observer, so renders cancel on unmount or scale change but not when the card leaves the viewport.” The release path (card leaves the window → effect cleanup cancels the in-flight render + frees bitmaps) is exactly this fix. [Source: deferred-work.md “Scroll-away render cancellation → Story 1.7”]

### Git intelligence

Recent commits are the Epic-1 render path: `9411e04` render + text layer (1.3, where unbounded canvases were introduced), `a855fff` scroll/page nav (1.4, the IO tracker), `75cafb1` zoom (1.5, the offscreen-swap), `d4dbfb3` decoder assets (1.6), `1874153` (HEAD = baseline). This story is a refactor on top — it changes the paint **lifecycle** (when canvases live/die) and the observer **topology** (two observers → one hook), not the paint algorithm. [Source: `git log` …1874153]

### Project Structure Notes

- `render/usePageViewport.ts` is the natural home: `render/` already owns all pdfjs-dist + viewport concerns and the layered-downward-dependency rule keeps observer/window logic out of `Reader`/`App`. `Reader` consuming a `render/` hook (rather than hand-rolling an `IntersectionObserver`) tightens the AR-9 boundary the story’s AC-4 calls for. [Source: ARCHITECTURE-SPINE.md source-tree `render/`; CLAUDE.md source-tree]
- `WINDOW_RADIUS` + `pageWindow` sit with the other behavioral constants/pure helpers in `render/index.ts`; `PREFETCH_MARGIN`/`REPAINT_DEBOUNCE` already establish “behavioral constant lives in the component/render layer, not the token layer.” [Source: client/src/Reader.tsx:402,410]
- No detected conflicts with the unified structure: one new render hook, one pure helper, a prop threaded shell→card, and a CSS property — all within established seams. No new dependency.

### References

- [Source: .bmad/planning-artifacts/epics.md#Story-1.7 (lines 301-325)] — story statement + 5 ACs.
- [Source: .bmad/planning-artifacts/sprint-change-proposals/sprint-change-proposal-2026-06-28-render.md §1.A, §2, §3, §5] — root cause (scroll jitter / unbounded canvases), impact, sequencing, success criteria.
- [Source: .bmad/planning-artifacts/epics.md FR-4 (30), NFR-1 (64), NFR-2 (65), NFR-5 (68), AR-9 (82)] — referenced requirements.
- [Source: .bmad/planning-artifacts/architecture/.../ARCHITECTURE-SPINE.md AD-9 rule (100-101), source-tree (`render/`), NFR-1 capability row (196)] — boundary + layout-stability invariants.
- [Source: client/src/Reader.tsx:65,74-77,116,235-267,342,417-543] — the registry, the page-tracking effect, the PageCard observer + paint effect to refactor.
- [Source: client/src/render/index.ts:141-165] — `currentPageInView`/`pageNavTarget` (helper home for `pageWindow`); `:180-246` `renderPage` (out of scope).
- [Source: client/src/Reader.css] — `.page-surface` / skeleton to extend with `content-visibility`.
- [Source: client/src/Reader.test.tsx:9-25] — the `vi.mock("./render")` factory (the hook-import footgun).
- [Source: client/src/no-raw-values.test.ts:25-26] — the `\d+px` ban (intrinsic-size goes inline, not in CSS).
- [Source: deferred-work.md] — the scroll-away cancellation item this story resolves.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Claude Code, bmad-dev-story)

### Debug Log References

- **Dist path / data dir for the live smoke (env, not code).** FastAPI resolves the SPA from `PAPER_MATE_STATIC_DIR` (default `server/static`), so the smoke server was started with `PAPER_MATE_STATIC_DIR=client/dist`. The default data dir `~/.paper-mate` was root-owned (leftover from a docker run) → `POST /api/docs` 500 `PermissionError`; re-pointed with `PAPER_MATE_DATA=<scratch>/data`. Both are environment-only; no app change.
- **Test-mock footgun (resolved as predicted).** `usePageViewport` is imported by sub-path so `vi.mock("./render")` keeps it real, but its `useState` initializer calls `pageWindow(1, WINDOW_RADIUS, …)` every render — including under jsdom — so the mocked barrel must export `pageWindow` + `WINDOW_RADIUS`. Added both to the `Reader.test.tsx` and `App.test.tsx` mock factories. Without it: `TypeError: pageWindow is not a function` at render.

### Completion Notes List

- **AC-1 + AC-2 (bounded live canvases / windowed release)** ✅ One `usePageViewport` IntersectionObserver tracks the page in view and exposes a ±`WINDOW_RADIUS` (=2) live window via `pageWindow`. `PageCard` paints only when `live` and **releases** its canvas/text bitmaps (`canvas.width=height=0`, `replaceChildren()`, `renderedScaleRef=0`) when it leaves. Live browser smoke on a 69-page PDF: exactly 3 painted at top (pages 1–3), exactly 5 mid-doc (pages 33–37) with 1–3 released — never the full 69.
- **AC-3 (off-screen no continuous paint)** ✅ `.page-surface { content-visibility: auto }` + inline `contain-intrinsic-size` (the reserved geometry) skips off-screen layout/paint; the skeleton node is only rendered for live, unpainted cards, so released cards carry no animation.
- **AC-4 (one observer, hook-owned; PageCard no lifecycle)** ✅ The two pre-refactor observers (Reader page-tracker + per-PageCard visibility) collapsed into the single hook, which owns the card registry too. `Reader` is a shell wiring the hook → cards; `PageCard` reacts to `live`/`scale` props with no observer or window decision. `render/` stays annotation-agnostic (AR-9).
- **AC-5 (no regression)** ✅ All Story 1.4/1.5 behaviors intact: live zoom (Ctrl+= grew canvas 1224→1912px, scrollHeight 110976→172455) kept the live count bounded; `scrollHeight` stable across release/re-entry (NFR-1); console clean across scroll + zoom. 79/79 unit tests green, typecheck clean, build succeeds.
- Scope held: no render-algorithm change (`renderPage` untouched), no backend/contract change (`docs/API.md` untouched), no new runtime dependency, no pan/ToC work.

### File List

- `client/src/render/index.ts` (modified) — added `WINDOW_RADIUS` const + pure `pageWindow` helper (+ `PageWindow` type).
- `client/src/render/usePageViewport.ts` (new) — the single IntersectionObserver hook: card registry, page-in-view tracking, ±N live window, no-IO fallback.
- `client/src/render/nav.test.ts` (modified) — `pageWindow` unit tests (mid/clamp/radius-0/edge cases).
- `client/src/Reader.tsx` (modified) — consume the hook; `PageCard` gains `live` prop, paint-on-`live` + release path, inline `contain-intrinsic-size`, skeleton gated on `live`; removed the Reader page-tracking effect, PageCard’s observer/`visible`, and `PREFETCH_MARGIN`.
- `client/src/Reader.css` (modified) — `content-visibility: auto` on `.page-surface`.
- `client/src/Reader.test.tsx` (modified) — added `pageWindow` + `WINDOW_RADIUS` to the `./render` mock (hook initializer needs them).
- `client/src/App.test.tsx` (modified) — same mock addition (App renders Reader).
- `.bmad/implementation-artifacts/sprint-status.yaml` (modified) — story status in-progress → review.

## Change Log

| Date | Change |
|------|--------|
| 2026-06-28 | Created Story 1.7 (render perf — windowing & viewport unification): single `usePageViewport` IntersectionObserver, `pageWindow` ±N release, `content-visibility`/`contain-intrinsic-size`, `PageCard` paint+release on a `live` prop. Status → ready-for-dev. |
| 2026-06-28 | Implemented Story 1.7. Unified the two observers into `usePageViewport`; `PageCard` paints/releases on a `live` prop bounded to ±`WINDOW_RADIUS`; `content-visibility: auto` + inline `contain-intrinsic-size` on `.page-surface`. Live smoke on a 69-page PDF: live canvases bounded to 3–5, geometry stable (scrollHeight 110976), console clean. 79/79 tests green, typecheck/build clean. Status → review. |

## Senior Developer Review (AI)

### Outcome

Approve

### Review Date

2026-06-28

### Reviewer Engine

Codex CLI (`codex exec`) as an independent senior reviewer. Ran the BMad `code-review` workflow with sequential Blind Hunter, Edge Case Hunter, and Acceptance Auditor passes.

### Scope Reviewed

- Diff `1874153d38d285f7f5a21ad15701160a46401b9d..HEAD` at latest commit `0aff11e` (`Feat: Window Render To Bound Live Canvases`).
- In scope: `client/src/render/index.ts`, `client/src/render/usePageViewport.ts`, `client/src/Reader.tsx`, `client/src/Reader.css`, render/Reader/App tests, story and sprint status updates.
- Confirmed no backend, API contract, OpenAPI, or `docs/API.md` changes.

### Acceptance Criteria Assessment

- AC-1 / NFR-2 scroll performance: Satisfied by bounded live-window implementation and release lifecycle inspection; no accumulated canvas/text-layer path found.
- AC-2 / NFR-1 bounded canvases with stable geometry: Satisfied. `PageCard` releases backing stores/text DOM on `live=false` without touching reserved card width/height.
- AC-3 / NFR-5 off-screen paint: Satisfied. `.page-surface` uses `content-visibility: auto`; skeleton rendering is gated by `live`.
- AC-4 / AR-9 single observer and render boundary: Satisfied. `usePageViewport` owns the observer/registry/window and imports only React plus render helpers; no annotation/store imports or coordinate normalization were introduced.
- AC-5 regression surface: Satisfied by automated test/type/build results and source inspection of zoom, page-in-view, and PgUp/PgDn wiring.

### Verification

- `cd client && npm test` — passed, 9 files / 79 tests.
- `cd client && npm run typecheck` — passed.
- `cd client && npm run build` — passed; Vite emitted only the existing large-chunk warning.
- Guardrail checks: no touched server/contract files; no raw hex/px matches in touched non-theme source; render-layer boundary check found only existing/comment references.

### Severity Breakdown

- High: 0
- Medium: 0
- Low: 0

### Action Items

- [x] [LOW] No required changes. Sequential review passes found no actionable defects in the render windowing implementation.

### Review Follow-ups (AI)

- [x] No follow-up tasks created.
