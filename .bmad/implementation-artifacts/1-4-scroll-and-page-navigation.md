---
baseline_commit: 72414cc
---

# Story 1.4: Scroll and page navigation

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a reader,
I want smooth vertical scrolling with a page indicator and keyboard page nav,
so that I can move through a long paper fluidly.

## Acceptance Criteria

1. **Fluid vertical scroll on a long paper.** Given a multi-page document, when I scroll, then vertical scrolling stays fluid (~60fps target, no jank) on a 50+ page paper. [FR-4, NFR-2]
2. **Live page indicator.** Given I scroll, then the status shows `Page N of M` for the page currently in view (N = the page whose card occupies the viewport; M = `doc.page_count`). [FR-2, UX-DR12, UX-DR18]
3. **Keyboard page nav.** Given focus is on the canvas, when I press `PgUp` / `PgDn`, then the view moves one page (to the previous / next page card), and the default browser page-scroll is suppressed so it never double-scrolls. [UX-DR15]
4. **No reflow.** Given scrolling (or any of the above), then page geometry never reflows: the indicator and key handling are pure overlays/behaviors and change no card size or canvas width. [NFR-1]

> **Scope guard.** This story adds the page indicator (`Page N of M`), `PgUp`/`PgDn` page nav, and confirms 50+ page scroll stays smooth on top of 1.3's reserve-geometry + lazy-paint streaming. It does **NOT** add: zoom or `ctrl+scroll` / `Ctrl 0` (Story 1.5), the zoom-control pill (1.5), pan / hand tool / hold-`Space` (1.6), ToC (1.7), the save-indicator behavior (Epic 3 persistence), or any annotation/anchor math (Epic 2). Do not introduce a virtualization library: the existing `IntersectionObserver` lazy paint is the smoothness mechanism; tune it if needed, do not replace it.

## Tasks / Subtasks

- [x] **Task 1 — Track the page in view in `Reader`** (AC: 2, 4)
  - [x] In `client/src/Reader.tsx`, derive the **current page** (1-based) from scroll position without per-scroll React thrash. Single `IntersectionObserver` over all registered page cards picks the **top-most card at least partially in view** via the pure `currentPageInView`; `setCurrentPage` only fires when the number changes.
  - [x] Coalesce updates to avoid jank (NFR-2): the IO callback schedules a single `requestAnimationFrame` recompute (no raw per-frame `scroll` listener).
  - [x] Default `currentPage` to `1` before first paint (loading phase) so the indicator is stable from the start.
  - [x] Extracted the selection into the pure DOM-free `currentPageInView(pages, viewportTop, viewportBottom)` in `render/index.ts`, unit-tested without layout.
- [x] **Task 2 — Surface `Page N of M` in the top bar** (AC: 2, 4)
  - [x] `Reader` reports the page up via `onVisiblePageChange(page)`; `App.tsx` holds `currentPage` and renders the indicator in the `top-bar`. `M` = `doc.page_count`.
  - [x] Indicator is text-only, tokens only (`--type-caption-*`, `--color-muted`) in `App.css`, copy exactly `Page {N} of {M}`. No inline hex/px in `.tsx`.
  - [x] `role="status"` + `aria-live="polite"` polite live region.
- [x] **Task 3 — `PgUp` / `PgDn` page navigation** (AC: 3, 4)
  - [x] `.pdf-canvas` is focusable (`tabIndex={0}`), keeps `data-testid="reader-backdrop"` + `aria-label`.
  - [x] `onKeyDown` handles `PageDown`/`PageUp`: scrolls the target card's top to the canvas top, clamps at first/last via `pageNavTarget`, calls `e.preventDefault()` so native page-scroll never double-fires.
  - [x] Target resolved from the live card registry; `scrollTo` uses `behavior: "smooth"` unless `prefers-reduced-motion: reduce` (then `"auto"`).
  - [x] `pageNavTarget(current, delta, pageCount)` is a pure clamped helper, unit-tested.
- [x] **Task 4 — Tests** (AC: all)
  - [x] `render/nav.test.ts`: `currentPageInView` (inside / straddle / scrolled / non-intersecting / empty) and `pageNavTarget` (advance / retreat / clamp both ends / zero-page). DOM-free.
  - [x] `Reader.test.tsx` / `App.test.tsx`: indicator renders `Page 1 of 3`, `onVisiblePageChange` fires with `1`, canvas `tabIndex === 0`. IO is absent in jsdom (tracker gated the same way `PageCard` gates paint); render mocks extended with the two new exports.
  - [x] `no-raw-values.test.ts`, `focus-ring.test.ts`, and existing App/Reader tests stay green (42 frontend tests pass).
- [x] **Task 5 — Validate + live smoke** (AC: all)
  - [x] Frontend `npm test` (42 pass), `npm run typecheck` (clean), `npm run build` (pdf worker bundles). No backend change this story.
  - [x] Live (`npm run dev`, 55-page PDF, Chrome via Playwright): scroll top→bottom smooth, indicator tracked `1 → 4` (3× PgDn) `→ 2` (2× PgUp) `→ 55 of 55` (free scroll to bottom); PgUp/PgDn moved one page each with no double-scroll; `scrollWidth === clientWidth` (no horizontal overflow) and page-card width stable across scroll (NFR-1).

## Dev Notes

### Architecture patterns & constraints (binding)

- **Layout stability (NFR-1, the defining bar).** The pdf-canvas box is pixel-stable; everything this story adds is an overlay (the top-bar indicator) or a behavior (key-driven scroll) and must reflow nothing. Story 1.3 already reserves final page geometry up front and keeps `scrollbar-gutter: stable`; do not regress that. [Source: ARCHITECTURE-SPINE.md#Capability-Map; EXPERIENCE.md lines 67-82]
- **Smoothness (NFR-2).** Target ~60fps on a 50+ page paper. The mechanism already in place is `IntersectionObserver`-gated lazy paint (pages paint as they near the viewport, in-flight render tasks cancel on unmount/scale change). Keep that. The page-in-view tracker must ride IO callbacks or `requestAnimationFrame`, never a `setState`-per-scroll-event loop. No virtualization library (not prescribed by the architecture; the lazy paint is the smoothness path). [Source: ARCHITECTURE-SPINE.md line 190 (FR-1..FR-6 → client `render/`, binds NFR-2); 1-3 Completion Notes]
- **Layered client, downward deps.** `render → anchor → annotation/tool → store → api-client`. This story stays in `render/` (pure helpers) + the `Reader`/`App` UI shells. The render layer must keep computing **no** annotation/anchor coordinate math (that is `anchor/`'s exclusive job in Epic 2); page-in-view and scroll-target math is plain layout arithmetic, not anchor normalization, so it is allowed here. Do not import `anchor/annotations/store`. [Source: ARCHITECTURE-SPINE.md#Design-Paradigm; AD-9]
- **No backend change.** Page nav + indicator are purely client-side. No new `/api` route, no Pydantic/contract regen, no `docs/API.md` change this story. [Source: epics.md Story 1.4 — FR-4/FR-2, client-only]
- **Tokens only (UX-DR1, NFR-5).** The indicator uses `{typography.caption}` / `{colors.muted}`; raw hex/px allowed **only** under `src/theme/**`. `no-raw-values.test.ts` scans `src/**` `.ts`/`.tsx`/`.css` (comments stripped) and flags hex/px elsewhere — keep all new dims in `components.css`/`App.css`, and avoid a digit directly adjacent to `px` in `.ts` (e.g. build template strings) as 1.3 had to. [Source: CLAUDE.md#Design-conventions; 1-3 Debug Log]

### UX requirements (DESIGN.md / EXPERIENCE.md)

- **Page status copy (verbatim).** `Page 3 of 23` style — `Page {N} of {M}`. From the EXPERIENCE.md microcopy table. Obsidian-quiet voice: plain, no exclamation, no emoji. [Source: EXPERIENCE.md line 50, lines 130-134 (voice)]
- **Top bar placement (UX-DR12).** `{component.top-bar}` (48px, hairline bottom, `{colors.canvas}`) holds filename + `{component.save-indicator}` + Bank/ToC toggles; the page status is a sibling quiet text element in the same bar, styled like the save-indicator (text-only, `{typography.caption}`, `{colors.muted}`). The save-indicator **behavior** itself is Epic 3 — only borrow its visual treatment, do not wire save state here. [Source: DESIGN.md#top-bar (line 433), #save-indicator (line 435); EXPERIENCE.md line 28]
- **Keyboard map (UX-DR15).** `PgUp` / `PgDn` = page nav. (`Ctrl +/-`, `Ctrl 0`, `Space`-pan etc. belong to later stories — do not bind them now.) [Source: EXPERIENCE.md lines 112-128 (keyboard map row `PgUp / PgDn | page nav`)]
- **Reduced motion (UX-DR17).** Respect `prefers-reduced-motion`: the `PgUp`/`PgDn` scroll degrades to instant (no smooth-scroll animation) when motion is reduced. The skeleton pulse in `Reader.css` already follows this convention. [Source: EXPERIENCE.md line 132; UX-DR16/17]
- **Accessibility floor (UX-DR17).** Every action keyboard-operable (this story makes the canvas focusable and page nav key-driven); visible 2px `{colors.ink}` focus ring on the now-focusable canvas — confirm `focus-ring.test.ts`/the focus-ring rule covers `[tabindex]` or add the canvas to it. The indicator is a polite live region (`role="status"`), not color-only. [Source: EXPERIENCE.md lines 128-134; UX-DR17]

### Current state of files this story touches (read before editing)

- `client/src/Reader.tsx` — S1 reader. Holds `scrollRef` (the `.pdf-canvas`), `boxes` (per-page scale-1.0 boxes), `scale` (state, fit-to-width), `phase`. Renders `PageCard`s, each with `cardRef`/`canvasRef`/`textRef` and its own paint `IntersectionObserver`. **Add:** the page-in-view tracker (single IO over cards, or report from each card up to `Reader`), `tabIndex` + `keydown` on `.pdf-canvas`, and an `onVisiblePageChange` callback prop. Preserve the reserve-geometry, lazy-paint, and render-cancellation logic exactly — do not regress NFR-1/NFR-2. The card refs you need for scroll targets already exist; consider lifting an array of card refs or measuring via the column. [client/src/Reader.tsx]
- `client/src/App.tsx` — owns `doc` state and renders the `top-bar` (filename + ToC/Bank pill placeholders) and mounts `<Reader doc={doc} />`. **Add:** `currentPage` state, pass `onVisiblePageChange={setCurrentPage}` to `Reader`, render `Page {currentPage} of {doc.page_count}` in the top bar. Keep the S0 branch, toast, and tool-rail placeholder unchanged. [client/src/App.tsx]
- `client/src/render/index.ts` — pdfjs wrapper; exposes `loadDocument`, `getPageBox`, `renderPage`, `destroyDocument`, `fitToWidthScale` (the DOM-free, unit-tested helper pattern to mirror). **Add (optional):** the pure `currentPageInView` / page-target helpers here next to `fitToWidthScale`, or in a small sibling module — keep them annotation-agnostic, no pdf.js or DOM needed. [client/src/render/index.ts]
- `client/src/render/fit.test.ts` — the existing pure-helper unit test; mirror it for the new helpers. [client/src/render/fit.test.ts]
- `client/src/Reader.css` — `.pdf-canvas` (absolute, `inset:0`, `overflow:auto`, `scrollbar-gutter: stable`), `.page-surface`, skeleton with reduced-motion guard. Tokens only. **Add** any focus-ring/indicator styling here or in `components.css`. [client/src/Reader.css]
- `client/src/App.css` / `client/src/theme/components.css` — token layer. `--top-bar-height: 48px`, `.top-bar`, `.top-bar__title`, `.top-bar__actions`, `.pill`. Add the page-indicator styling here (caption type, muted color). [client/src/App.css; client/src/theme/components.css]
- `client/src/App.test.tsx`, `client/src/Reader.test.tsx` — already `vi.mock("./render")` (pdf.js can't run under jsdom). Extend, don't rewrite. [client/src/*.test.tsx]

### Testing standards

- **Commands (host-env workarounds — use exactly):** frontend `cd client && npm test` (Vitest); typecheck `cd client && npm run typecheck`; build `cd client && npm run build`. Backend (only if touched) `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q`. [Source: CLAUDE.md; 1-1..1-3 Dev Notes]
- **jsdom limits:** no real layout (`offsetTop`, `getBoundingClientRect` → 0/zeros) and no `IntersectionObserver`. Therefore: put the page-in-view selection and the nav-target arithmetic in pure helpers and unit-test those; in component tests, mock `render` and (if needed) stub `IntersectionObserver`. Do not assert real scrolling. This is the same shape 1.3 used. [Source: 1-3 Debug Log / Task 6]
- `no-raw-values.test.ts`, `focus-ring.test.ts` must stay green; if the canvas becomes focusable, verify the focus-ring assertion still passes (extend it to the canvas if it enumerates focusable selectors). [Source: 1-1/1-3 Debug Log]

### Previous story intelligence (Story 1.3)

- **Pure-helper + mock pattern is the house style.** 1.3 kept `fitToWidthScale` DOM-free and unit-tested, mocked the whole `render` module in component tests, and unit-tested the math separately. Do the same for page-in-view and nav-target math. [Source: 1-3 Task 6, Debug Log]
- **`PREFETCH_MARGIN = 200`** is a behavioral scroll constant (not a design dim) already living in `Reader.tsx`; a similar judgement applies to any throttle/threshold constant you add — behavioral constants stay in the component, design dims go to the token layer. [Source: 1-3 Reader.tsx; review Low finding]
- **`no-raw-values` tripwire:** a digit adjacent to `px` in `.ts` is flagged; 1.3 rebuilt `rootMargin` as `` `${PREFETCH_MARGIN}px` ``. Build any px string the same way. [Source: 1-3 Debug Log]
- **Render-task cancellation** on unmount/scale change is already correct in `PageCard`; the new IO and key handler must also clean up (disconnect observer, remove listener) in their effect returns to avoid leaks during fast scroll. [Source: 1-3 Reader.tsx paint effect]
- **Scale is held in `Reader` state** for Story 1.5; page nav targets are derived from card offsets, not scale, so they keep working when 1.5 lands zoom — compute targets from live card geometry, not a cached pixel value. [Source: 1-3 Reader.tsx]

### Project Structure Notes

- Stays within `render/` (pure helpers) + `Reader`/`App` shells. `anchor/`, `annotations/`, `store/` remain README stubs (Epic 2/3) — do not create them here. [Source: ARCHITECTURE-SPINE.md#Structural-Seed]
- No backend, contract, or `docs/API.md` change (no new endpoint). [Source: epics.md Story 1.4]
- Page-in-view / scroll-target math is plain layout arithmetic and is **not** the AD-4 anchor normalization — keeping it in `render/` does not violate AD-9's "coordinate math lives only in `anchor/`", which is specifically about annotation normalized↔screen mapping. Do not conflate the two. [Source: ARCHITECTURE-SPINE.md#AD-9]

### References

- [Source: .bmad/planning-artifacts/epics.md#Story-1.4] — story statement + 4 ACs (FR-4 smooth scroll, FR-2 page indicator, PgUp/PgDn, no reflow)
- [Source: .bmad/planning-artifacts/architecture/architecture-paper-mate-2026-06-28/ARCHITECTURE-SPINE.md] — AD-2 (render layer), AD-4 (page box, untouched here), AD-9 (boundary), line 190 (FR-1..6 → render, binds NFR-2)
- [Source: EXPERIENCE.md] — line 50 page-status copy `Page 3 of 23`; lines 112-128 keyboard map (`PgUp`/`PgDn` page nav); lines 28/433-435 top-bar + save-indicator; line 132 reduced-motion
- [Source: DESIGN.md] — #top-bar (433), #save-indicator (435), `{typography.caption}`, `{colors.muted}`
- [Source: .bmad/implementation-artifacts/1-3-render-pages.md] — Reader structure, reserve-geometry, lazy paint, pure-helper + mock test pattern, no-raw-values tripwires

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (BMad dev-story workflow)

### Debug Log References

- **jsdom has no `IntersectionObserver` and no real layout.** The page-in-view tracker is gated on `typeof IntersectionObserver === "undefined"` (same guard `PageCard` already uses for lazy paint), so under jsdom `currentPage` stays the default `1` and the indicator renders `Page 1 of M` deterministically. The real IO/rAF path is covered by the live browser smoke, not unit tests.
- **Pure-helper split.** All page math (`currentPageInView`, `pageNavTarget`) lives DOM-free in `render/index.ts` and is unit-tested directly; the component only wires DOM rects into those helpers. Mirrors the 1.3 `fitToWidthScale` pattern.
- **Render-module mocks.** `Reader.test.tsx` and `App.test.tsx` `vi.mock("./render")` — extended both mock objects with `currentPageInView` and `pageNavTarget` (the module now exports them) so the destructured imports aren't `undefined`.

### Completion Notes List

- **Page-in-view tracker (AC-2,4):** one `IntersectionObserver` (root = scroll container) observes every page card; its callback schedules a single `requestAnimationFrame` that reads the live card rects and the container rect, then `currentPageInView` picks the top-most visible page. `setCurrentPage` only fires on change. No raw scroll listener (NFR-2). Cards self-register their DOM node into a `Map` ref on mount/unmount.
- **Top-bar indicator (AC-2):** `Reader` reports the page via `onVisiblePageChange`; `App` holds `currentPage` and renders `Page {currentPage} of {doc.page_count}` as a quiet caption (`--type-caption-*`, `--color-muted`) with `role="status"` `aria-live="polite"`. Tokens only — `no-raw-values` green.
- **Page nav (AC-3):** `.pdf-canvas` is `tabIndex={0}`; `onKeyDown` maps `PageDown`/`PageUp` to `pageNavTarget` (clamped to `[1, page_count]`), scrolls the target card's `offsetTop` to the top, and `preventDefault()`s the native page-scroll. Honors `prefers-reduced-motion` (smooth vs auto).
- **No reflow (AC-4):** everything added is overlay (indicator) or behavior (key/scroll); live smoke confirmed `scrollWidth === clientWidth` and stable card width across scroll.
- **Validation:** frontend 42 tests pass, typecheck clean, prod build bundles the pdf worker. No backend/contract/`docs/API.md` change (client-only story). Live browser smoke on a 55-page PDF confirmed all 4 ACs.

### File List

**Added**
- `client/src/render/nav.test.ts`

**Modified**
- `client/src/render/index.ts` (add `PageExtent`, pure `currentPageInView` + `pageNavTarget`)
- `client/src/Reader.tsx` (card registry, IO+rAF page-in-view tracker, `onVisiblePageChange` prop, `tabIndex` + `PgUp`/`PgDn` keydown)
- `client/src/App.tsx` (`currentPage` state, `Page N of M` indicator, pass `onVisiblePageChange`)
- `client/src/App.css` (`.top-bar__page-status` caption styling)
- `client/src/Reader.test.tsx` (render-mock + tracker/focus tests)
- `client/src/App.test.tsx` (render-mock + indicator test)
- `.bmad/implementation-artifacts/sprint-status.yaml` (1-4 → review)

## Change Log

- **2026-06-28:** Story 1.4 implemented — page-in-view indicator (`Page N of M`), `PgUp`/`PgDn` keyboard page nav, focusable canvas; pure `currentPageInView`/`pageNavTarget` helpers. Frontend 42 tests, typecheck, prod build green; live 55-page browser smoke confirmed all 4 ACs (indicator tracks across keyboard + free scroll, no double-scroll, no reflow). Status → review.

## Senior Developer Review (AI)

**Outcome:** Approve
**Date:** 2026-06-28

### Action Items

- [x] [LOW] No required changes. Sequential Blind Hunter, Edge Case Hunter, and Acceptance Auditor passes found no blocking or patch-level defects in the `72414cc..HEAD` diff.

### Review Follow-ups (AI)

- [x] No follow-up tasks created.
