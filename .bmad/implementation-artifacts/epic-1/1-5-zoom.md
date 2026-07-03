---
baseline_commit: a855fff53700334b9ced3dc39bb4952c4eaa896b
---

# Story 1.5: Zoom

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a reader,
I want to zoom with keyboard, ctrl+scroll, and an on-screen control,
so that I can size the page to read comfortably.

## Acceptance Criteria

1. **Keyboard zoom + fit/reset.** Given the reader, when I press `Ctrl +` / `Ctrl -` (or `Ctrl+scroll`), then pages zoom in/out and the on-screen control shows a live `%`; and `Ctrl 0` fits the page to width / resets the zoom. The shortcuts work **regardless of which reader control has focus** (the canvas or the zoom control), and the browser's native zoom never fires. [FR-5, UX-DR14, UX-DR15]
2. **Ctrl+scroll zoom.** Given the reader, when I hold `Ctrl` and scroll the wheel (or pinch a trackpad) anywhere over the reader (incl. the zoom control), then the page zooms in/out, the browser's native page zoom never fires, and plain (no-`Ctrl`) scroll still scrolls the document. The wheel step is **finer than the keyboard step** (≈10% per notch, multiplicative ×1.1), and a `deltaY === 0` Ctrl-wheel event does nothing. [FR-5, UX-DR14]
3. **Top-bar zoom control mirrors keyboard.** Given the zoom control in the **top bar, immediately left of the ToC button** (`−` / live `%` / `+`), when I click `−` / `+`, then the page zooms and the `%` updates live; the buttons have a tokenized hit-size and the current `%` is exposed to assistive technology. **Supersedes UX-DR10's bottom-right placement.** [UX-DR10 (revised)]
4. **Pixel-stable canvas, single scale invariant.** Given any zoom level, then the `pdf-canvas` box stays pixel-stable (the top-bar control is normal chrome — it never consumes canvas width and nothing reflows), and zoom changes exactly one `scale` value that uniformly multiplies the scale-1.0 page box so derived screen positions stay correct (the AD-4 page box itself is never mutated). [NFR-1, NFR-3 foundation]
5. **Zoom preserves the focal point.** Given any zoom step, then the document point under the cursor (wheel) or the viewport center (keyboard + buttons) stays fixed — the page zooms about that point rather than drifting — by compensating the scroll position. This remains a single `scale` (the scroll adjustment is layout arithmetic, not a second scale/offset), so AC-4's invariant holds. [NFR-1, user follow-up]

> **Scope guard.** This story adds: `Ctrl +` / `Ctrl -` / `Ctrl 0` keyboard zoom, `Ctrl+scroll` (and trackpad pinch) zoom, the top-bar `{component.zoom-control}` (left of ToC) with live `%`, and focal-point-preserving scroll compensation, all driving the existing `scale` state. It does **NOT** add: pan / hand tool / hold-`Space` (Story 1.6), table of contents (1.7), any annotation or anchor coordinate math (Epic 2 — this story only preserves the single-`scale` invariant the anchor layer will later rely on), the save-indicator behavior (Epic 3), or zoom animation/transitions. A **stage-/document-level** key handler is permitted (guarded to when a document is open) so the shortcuts work regardless of which reader control has focus; **scroll-position compensation** in `Reader` is permitted (focal point). Do **not** introduce a second scale/offset variable, mutate the scale-1.0 page box, or replace the `IntersectionObserver` lazy paint.
>
> **Revised 2026-06-28 (correct-course, sprint-change-proposal-2026-06-28.md):** zoom control moved from the bottom-right floating pill to the top bar (overrides UX-DR10); wheel step made finer than keyboard; focal point preserved (AC-5); shortcuts made focus-independent. See the "Review Follow-ups (AI)" tasks below.

## Tasks / Subtasks

- [x] **Task 1 — Pure zoom math in `render/`** (AC: 1, 2, 3, 4)
  - [x] In `client/src/render/index.ts`, add a DOM-free `nextZoom(current, direction)` helper next to `fitToWidthScale` / `pageNavTarget`: returns the next scale `direction` steps from `current`, clamped to `[ZOOM_MIN, ZOOM_MAX]`. `direction` is `+1` (in) / `-1` (out). Use a multiplicative step (`ZOOM_STEP = 1.25`). Pure arithmetic, no DOM, no pdf.js.
  - [x] Export `ZOOM_MIN` (0.25) / `ZOOM_MAX` (4) and `ZOOM_STEP` (1.25) as behavioral constants (in code, NOT the token layer).
  - [x] `Ctrl 0` reuses the existing `fitToWidthScale` (via `computeFitScale` in Task 2) — no second fit calc.
- [x] **Task 2 — Refactor fit-to-width into a reusable callback in `Reader`** (AC: 1)
  - [x] In `client/src/Reader.tsx`, extract the inline fit calc (currently lines ~76-85: widest box → canvas width minus `--space-lg` gutters → `fitToWidthScale`) into a `useCallback` `computeFitScale()` that reads `boxes` + `scrollRef.current.clientWidth` live. The initial load and `Ctrl 0` both call it (DRY). It must read the **live** canvas width each call (so it refits correctly after a resize), not a cached value.
- [x] **Task 3 — Keyboard zoom on the canvas** (AC: 1, 4)
  - [x] Extend the existing `handleKeyDown` on `.pdf-canvas`. Add, with a `e.ctrlKey` (Ctrl-held) guard:
    - zoom **in**: `e.key === "+" || e.key === "="` (allow Shift — on a US layout `+` is `Shift+=`, and `e.key` is already the resolved `"+"`; numpad `+` also reports `"+"`). → `setScale((s) => nextZoom(s, +1))`
    - zoom **out**: `e.key === "-"` → `setScale((s) => nextZoom(s, -1))`
    - fit/reset: `e.key === "0"` → `setScale(computeFitScale())`
  - [x] Each of these calls `e.preventDefault()` so the **browser's** native Ctrl+/-/0 page zoom never fires. Keep the existing PgUp/PgDn + Ctrl+Arrow handling intact and ahead of / beside this — do not let the new `ctrlKey` branch swallow Ctrl+Arrow page nav (different keys, but verify both still work).
- [x] **Task 4 — Ctrl+scroll (and pinch) zoom** (AC: 2, 4)
  - [x] Add a native `wheel` listener on the scroll container (`scrollRef.current`) via `addEventListener("wheel", handler, { passive: false })` in an effect — **not** React's `onWheel` (React attaches wheel passively, so `preventDefault` is a no-op there and the browser zoom would still fire). Clean up with `removeEventListener` in the effect return.
  - [x] In the handler: only act when `e.ctrlKey` (this also covers trackpad pinch, which dispatches `wheel` with `ctrlKey === true`); then `e.preventDefault()` and `setScale((s) => nextZoom(s, e.deltaY < 0 ? +1 : -1))`. When `ctrlKey` is false, do nothing — let native scroll proceed untouched (AC-2: plain scroll still scrolls).
  - [x] Gate the effect on `phase === "ready"` (or guard the ref) and re-run only when needed; the handler reads `setScale` (a stable updater) so the effect deps stay minimal and the listener isn't re-bound on every scale change.
- [x] **Task 5 — `ZoomControl` pill component + overlay** (AC: 3, 4)
  - [x] Add `client/src/ZoomControl.tsx`: a small presentational component (props: `percent: number`, `onZoomIn`, `onZoomOut`, `onReset`). Renders the `{component.zoom-control}` pill: a `−` `<button>`, the live `{percent}%` text (its own click = `onReset`, i.e. clicking the % fits/resets — optional but matches "live %" affordance; at minimum render it as text), and a `+` `<button>`. Buttons are real `<button type="button">` so they are keyboard-reachable and pick up the global focus ring. Label them (`aria-label="Zoom out"` / `"Zoom in"`).
  - [x] Render `<ZoomControl>` from `Reader` as a sibling of `.pdf-canvas` (return a fragment): `percent={Math.round(scale * 100)}`, `onZoomIn={() => setScale((s) => nextZoom(s, +1))}`, `onZoomOut={() => setScale((s) => nextZoom(s, -1))}`, `onReset={() => setScale(computeFitScale())}`. It must be an **overlay** (absolute, bottom-right of `.stage`), NOT inside the scrollable `.pdf-canvas` (or it would scroll with content and consume nothing of canvas width — AC-4 / NFR-1).
  - [x] Build the `%` string as `` `${percent}%` `` — `%` is not `px`, so the `no-raw-values` digit-adjacent-`px` tripwire does not apply; keep **all** dimensions in CSS, none in `.tsx`.
- [x] **Task 6 — Token + CSS for the zoom-control** (AC: 3, 4)
  - [x] Add `--zoom-control-*` dims to `client/src/theme/components.css` (token layer — px allowed only here): an offset (recommend reuse `--toast-offset: 24px` value via a new `--zoom-control-offset`, or `--tool-rail-offset` for parity), button hit size, and gap. Reference DESIGN.md `components.zoom-control`: bg `{colors.surface-card}`, text `{colors.ink}`, `{typography.caption}`, `{rounded.pill}`, padding `{spacing.xxs} {spacing.sm}`, border `1px {colors.hairline}`, shadow = the existing `--shadow-card` (`0 4px 12px rgba(0,0,0,0.04)`).
  - [x] Add `.zoom-control` rules to `client/src/App.css` (where `.top-bar` / `.pill` / `.tool-rail` overlay rules live): `position: absolute; right/bottom: var(--zoom-control-offset); z-index` above the canvas (canvas content is below the tool-rail's `z-index: 4` — match the overlay layer). Tokens only — no inline hex/px. The pill must not stretch the stage (absolute, so it cannot reflow `.pdf-canvas`).
- [x] **Task 7 — Tests** (AC: all)
  - [x] `client/src/render/zoom.test.ts` (DOM-free): `nextZoom` — in, out, clamp at `ZOOM_MAX` (in from max stays max), clamp at `ZOOM_MIN` (out from min stays min), round-trip near 1.0. Mirror `fit.test.ts` / `nav.test.ts`.
  - [x] `client/src/ZoomControl.test.tsx`: renders `184%` for `percent={184}`; clicking `+` / `−` / the % fires `onZoomIn` / `onZoomOut` / `onReset`; buttons are real `<button>`s with the aria-labels.
  - [x] `client/src/Reader.test.tsx` (extend, don't rewrite — already `vi.mock("./render")`): add `nextZoom`, `ZOOM_MIN`, `ZOOM_MAX`, `ZOOM_STEP` to the render mock so the destructured imports aren't `undefined`. Assert: zoom control renders a `%`; firing a `Ctrl+=` / `Ctrl+-` keydown on the canvas changes the rendered `%` (scale state moved); `Ctrl+0` returns to the fit `%`. (Mock `nextZoom`/`fitToWidthScale` so the math is deterministic under jsdom.) Wheel zoom is hard to assert under jsdom's passive-listener model — cover it in the live smoke, but if feasible dispatch a `new WheelEvent("wheel", { ctrlKey: true, deltaY: -1 })` and assert `%` changed.
  - [x] `no-raw-values.test.ts` and `focus-ring.test.ts` stay green (the pill buttons are chrome → must show the global 2px `{colors.ink}` `:focus-visible` ring, already defined in `index.css`; the new tokens live in `components.css`).
- [x] **Task 8 — Validate + live smoke** (AC: all)
  - [x] `cd client && npm test` (all green), `npm run typecheck` (clean), `npm run build` (pdf worker bundles). No backend change this story.
  - [x] Live (`npm run dev`, a 20+ page PDF, Chrome): `Ctrl +` / `Ctrl -` zoom and the pill `%` tracks; `Ctrl 0` snaps back to fit-to-width; `Ctrl+scroll` zooms and the browser's own zoom never triggers; plain scroll still scrolls; pill `−`/`+` clicks match the keyboard step; confirm `scrollWidth === clientWidth` for `.pdf-canvas` and that the canvas box is pixel-stable across zoom (the pill overlays, never reflows — NFR-1); pages stay sharp after zoom (re-paint at the new scale).

### Review Findings

- [x] [Review][Patch][HIGH] Keyboard/wheel interception misses the zoom-control overlay focus path [client/src/Reader.tsx:160, client/src/Reader.tsx:219, client/src/Reader.tsx:241]
- [x] [Review][Patch][LOW] Zoom-control buttons lack the specified hit-size token/rules [client/src/theme/components.css:45, client/src/App.css:85]
- [x] [Review][Patch][LOW] Ctrl+wheel with `deltaY === 0` zooms out unexpectedly [client/src/Reader.tsx:158]
- [x] [Review][Patch][LOW] Current zoom percent is hidden from assistive tech by the reset button label [client/src/ZoomControl.tsx:34]

### Review Findings — Re-Review 2026-06-28

- [x] [Review][Patch][HIGH] `Ctrl+wheel` over the top-bar zoom control still bypasses the non-passive listener [client/src/Reader.tsx:228]
- [x] [Review][Patch][MED] Focal-point compensation scales fixed reader padding/gaps as though they were PDF content, so later pages drift [client/src/render/index.ts:114]
- [x] [Review][Defer] Text layer still lacks pdf.js scale CSS variables outside the `.pdfViewer .page` wrapper [client/src/render/index.ts:218] — deferred, pre-existing
- [x] [Review][Defer] Page renders are not cancelled when a once-visible card scrolls away [client/src/Reader.tsx:409] — deferred, pre-existing

### Review Follow-ups (AI) — Correct-Course 2026-06-28

Sprint change (see `.bmad/planning-artifacts/sprint-change-proposals/sprint-change-proposal-2026-06-28.md`). Implement alongside the Review Findings above; several overlap.

- [x] [AI-Review][HIGH] Make zoom shortcuts focus-independent (AC-1/AC-2). Lift the key handler off `.pdf-canvas` to a stage-/document-level owner (guarded to when a doc is open); ensure `Ctrl +/-/0` and `Ctrl+wheel` fire no matter which reader control has focus. Resolves the HIGH Review Finding. [client/src/Reader.tsx, client/src/App.tsx]
- [x] [AI-Review][MED] Relocate the zoom control into the **top bar, left of the ToC button** (AC-3, overrides UX-DR10). Lift `scale`/zoom commands to `App` (or portal the control); restyle `ZoomControl` as top-bar chrome (drop the floating-card `--zoom-control-*` offset/shadow; keep `−`/`%`/`+`). [client/src/App.tsx, client/src/ZoomControl.tsx, client/src/App.css, client/src/theme/components.css]
- [x] [AI-Review][MED] Finer wheel step (AC-2). Add `ZOOM_WHEEL_STEP ≈ 1.1` in `render/index.ts`; the wheel uses it, keyboard/buttons keep `ZOOM_STEP = 1.25`. Guard `deltaY === 0` (no zoom). Resolves the LOW deltaY Review Finding. [client/src/render/index.ts, client/src/Reader.tsx]
- [x] [AI-Review][MED] Focal-point preservation (AC-5). After a zoom step, compensate the scroll position so the point under the cursor (wheel) / viewport center (keyboard+buttons) stays fixed. Extract the pure math into a tested `render/` helper (e.g. `focalScrollOffset`). Single `scale` only — no second scale/offset. [client/src/render/index.ts, client/src/Reader.tsx]
- [x] [AI-Review][LOW] Button hit-size token + rules (AC-3). Resolves the LOW hit-size Review Finding. [client/src/theme/components.css, client/src/App.css]
- [x] [AI-Review][LOW] Expose the live `%` to assistive tech (AC-3). Remove the overriding `aria-label`; use visible text + `aria-live`/`role="status"`. Resolves the LOW aria Review Finding. [client/src/ZoomControl.tsx]
- [x] [AI-Review][LOW] Tests: shortcuts dispatched from the control (not only `reader-backdrop`); hit-size assertions; focal-point math unit test; AT-percent test. Update render-mock with `ZOOM_WHEEL_STEP`/new helper. [client/src/Reader.test.tsx, client/src/ZoomControl.test.tsx, client/src/render/*.test.ts]
- [x] [AI-Review][MED] Smooth, flicker-free zoom re-render (user follow-up #4 — page/text strobed on each zoom). Render offscreen + atomic swap so the canvas never blanks; keep the skeleton for first paint only (never re-flash on zoom); live CSS pre-scale the canvas for instant feedback + debounce the crisp re-render during continuous wheel. [client/src/render/index.ts, client/src/Reader.tsx, client/src/Reader.css]

### Review Follow-ups (AI) — Re-Review 2026-06-28

- [x] [AI-Review][HIGH] Intercept `Ctrl+wheel` over the top-bar zoom control as well as `.pdf-canvas`; prevent browser zoom and drive the same reader zoom path, with a regression test that dispatches `Ctrl+wheel` on/focused over `ZoomControl`. [client/src/App.tsx, client/src/Reader.tsx, client/src/App.test.tsx or Reader.test.tsx]
- [x] [AI-Review][MED] Rework focal-point scroll compensation against the real page layout, not the whole scroll coordinate. Fixed `.pdf-canvas__column` padding/gaps and centering must not be multiplied as PDF content; add a test or browser smoke that zooming on a lower page preserves the same PDF point, not just the pure formula. [client/src/Reader.tsx, client/src/render/index.ts, client/src/render/zoom.test.ts]

## Dev Notes

### Architecture patterns & constraints (binding)

- **Zoom is already 90% wired — drive the existing `scale`.** `Reader` holds `const [scale, setScale] = useState(1)` (set to fit-to-width on load), passes `scale` to every `PageCard`, and `PageCard` already (a) sizes its reserved card to `Math.floor(box.width * scale) × Math.floor(box.height * scale)` and (b) re-`renderPage`s on `scale` change (the paint effect deps include `scale`, and in-flight renders cancel on change). So **zoom = call `setScale`**; the repaint, the card resize, and render cancellation are done. Do not rebuild any of that. [Source: client/src/Reader.tsx lines 43-44, 184-185, 263-290; 1-3 Completion Notes]
- **Single-`scale` invariant (AC-4, NFR-3 foundation).** The scale-1.0 page box (`getPageBox` → `renderPage`'s `getViewport({scale:1})`) is the AD-4 anchor reference; `scale` is the **only** zoom multiplier and it flows uniformly into both the canvas (`renderPage` `getViewport({scale})`) and the reserved card dims (`box * scale`). Keep it that way: a future annotation's screen rect = `rect_normalized × pageBox × scale`. Do **not** add a second independent scale/offset, and do **not** mutate the scale-1.0 box. This story writes **no** anchor math (that's `anchor/`'s job in Epic 2) — it only preserves the invariant. [Source: ARCHITECTURE-SPINE.md#AD-4, #AD-9; render/index.ts lines 58-67, 130-146; epics.md Story 1.5 AC-3]
- **Layout stability (NFR-1, the defining bar).** `.pdf-canvas` is `position:absolute; inset:0` — its box is fixed; zoom only grows the scrollable content inside it. The `{component.zoom-control}` is a bottom-right **overlay** (like `.tool-rail`), absolutely positioned, so it never consumes canvas width or reflows anything. `scrollbar-gutter: stable` is already set. Keep all of that. [Source: Reader.css `.pdf-canvas`; App.css `.tool-rail`; EXPERIENCE.md lines 67-82; UX-DR2/DR10]
- **Smoothness (NFR-2).** Keep the `IntersectionObserver` lazy paint and render cancellation. After a zoom, visible cards repaint at the new scale (the existing `scale`-dep paint effect handles this); do not add a virtualization library or a per-frame zoom animation loop. [Source: ARCHITECTURE-SPINE.md line 190; 1-3/1-4 Completion Notes]
- **Layered client, downward deps.** This story stays in `render/` (the pure `nextZoom` helper) + the `Reader`/`App` UI shells + a new presentational `ZoomControl`. `render/` must keep computing **no** annotation/anchor coordinate math; `nextZoom` is plain interaction arithmetic, like `pageNavTarget` — allowed in `render/`. Do not import or create `anchor/annotations/store`. [Source: ARCHITECTURE-SPINE.md#Design-Paradigm, #AD-9; 1-4 Dev Notes]
- **No backend change.** Zoom is purely client-side. No new `/api` route, no Pydantic/contract regen, no `docs/API.md` change. [Source: epics.md Story 1.5 — FR-5, client-only]
- **Tokens only (UX-DR1, NFR-5).** The zoom-control uses `{colors.surface-card}` / `{colors.hairline}` / `{colors.ink}` / `{typography.caption}` / `{rounded.pill}` / `--shadow-card`; raw hex/px allowed **only** under `src/theme/**`. Put new dims in `components.css` / rules in `App.css`. Build the `%` string with a template literal; avoid any digit directly adjacent to `px` in `.ts`/`.tsx` (the `no-raw-values` tripwire — but `%` is fine). [Source: CLAUDE.md#Design-conventions; 1-3/1-4 Debug Log]

### Two specific failure points (read before coding)

- **`Ctrl+scroll` needs a NON-passive native wheel listener.** React's `onWheel` is attached passively in React 19, so `preventDefault()` inside it is ignored and the browser's own Ctrl+wheel zoom still fires. You **must** `scrollRef.current.addEventListener("wheel", handler, { passive: false })` in an effect (and `removeEventListener` on cleanup) to be able to block native zoom. Only `preventDefault` + zoom when `e.ctrlKey`; otherwise leave the event alone so normal scrolling is untouched. Trackpad pinch arrives as `wheel` with `ctrlKey === true`, so this also gives pinch-zoom for free. [Source: render/Reader interaction; browser wheel passive-listener semantics]
- **The `+` key is layout-dependent — match on `e.key`, allow Shift.** On a US layout `+` is `Shift+=`, so a user "pressing Ctrl +" actually holds Ctrl+Shift and `e.key` resolves to `"+"`. Match `e.key === "+" || e.key === "="` for zoom-in (do **not** require `!e.shiftKey` here — unlike the Ctrl+Arrow page-nav guard which is Ctrl-only-no-shift to avoid the text-selection chord). Numpad `+`/`-`/`0` also report `"+"`/`"-"`/`"0"`. Always `preventDefault()` the zoom keys to suppress the browser's built-in zoom. [Source: Reader.tsx handleKeyDown lines 140-161; EXPERIENCE.md keyboard map]

### UX requirements (DESIGN.md / EXPERIENCE.md)

- **Zoom-control pill (UX-DR10, verbatim spec).** Floating pill, bottom-right corner: `−` / live `%` / `+`, in `{typography.caption}` (13px). Background `{colors.surface-card}`, `{rounded.pill}` (9999px), 1px `{colors.hairline}` border, soft drop shadow. Mirrors the keyboard zoom and `ctrl+scroll`. [Source: DESIGN.md lines 401, 426, 455, and the `components.zoom-control` block at line 248; EXPERIENCE.md lines 32, 65]
- **Live `%` copy.** Plain percent like `184%` (EXPERIENCE.md microcopy table). Obsidian-quiet voice: no label noise, no emoji — just the number + `%`. The `%` lives in the pill (the single live readout); do not also duplicate it in the top bar. [Source: EXPERIENCE.md line 51, 130-134]
- **Keyboard map (UX-DR15).** `Ctrl +/-` = zoom, `Ctrl 0` = fit / reset zoom. (`Space`-pan, ToC, Bank etc. belong to later stories — do not bind them now.) `PgUp`/`PgDn` (+ `Ctrl ↑`/`Ctrl ↓`) page nav already exists — leave it working. [Source: EXPERIENCE.md keyboard map lines 112-128; UX-DR14/DR15]
- **Accessibility floor (UX-DR17).** The pill's `−`/`+` are real, keyboard-operable `<button>`s with aria-labels and the global 2px `{colors.ink}` focus ring. No animation required (no reduced-motion branch needed for zoom — there's no zoom transition). [Source: EXPERIENCE.md lines 128-134; focus-ring.test.ts]

### Current state of files this story touches (read before editing)

- `client/src/Reader.tsx` — S1 reader. Already holds `scale` state (fit-to-width on load), the `scrollRef` (`.pdf-canvas`), `boxes`, the card registry, the page-in-view IO tracker, and `handleKeyDown` (PgUp/PgDn + Ctrl+Arrow). **Add:** extract `computeFitScale()` from the inline load-time fit calc (lines ~76-85); extend `handleKeyDown` with Ctrl `+`/`-`/`0`; add the non-passive `wheel` effect; render `<ZoomControl>` as a fragment sibling of `.pdf-canvas` wired to `setScale`. **Preserve** the load/reserve-geometry effect, the lazy paint + render cancellation, the IO page-in-view tracker, and the existing key handling exactly. [client/src/Reader.tsx]
- `client/src/render/index.ts` — pdfjs wrapper + the DOM-free helper home (`fitToWidthScale`, `currentPageInView`, `pageNavTarget`). **Add:** pure `nextZoom` + `ZOOM_MIN`/`ZOOM_MAX`/`ZOOM_STEP`. Keep annotation-agnostic. [client/src/render/index.ts]
- `client/src/App.tsx` — owns `doc`, renders `top-bar` (filename + `Page N of M` + ToC/Bank pills) and mounts `<Reader>`. **Likely unchanged** for zoom (scale stays in Reader; the pill is rendered by Reader as a stage overlay). Only touch if you choose to host the overlay here — but Reader-owned is simpler since Reader owns `scale`. [client/src/App.tsx]
- `client/src/theme/components.css` — token layer (px allowed here only). Has `--top-bar-*`, `--tool-rail-*`, `--toast-offset`, `--shadow-card`, `--focus-ring-width`. **Add** `--zoom-control-*`. [client/src/theme/components.css]
- `client/src/App.css` — overlay/chrome rules (`.top-bar`, `.pill`, `.tool-rail`, `.stage`). Tokens only. **Add** `.zoom-control` rules here. [client/src/App.css]
- `client/src/index.css` — holds the global `:focus-visible` ring (asserted by `focus-ring.test.ts`). Pill buttons inherit it; **no change needed**. [client/src/index.css]
- `client/src/Reader.test.tsx` — already `vi.mock("./render")`. **Extend** the mock with the new exports and add the zoom assertions; do not rewrite. [client/src/Reader.test.tsx]

### Testing standards

- **Commands (host-env workarounds — use exactly):** frontend `cd client && npm test` (Vitest); typecheck `cd client && npm run typecheck`; build `cd client && npm run build`. No backend touched this story. [Source: CLAUDE.md; 1-1..1-4 Dev Notes]
- **jsdom limits:** no real layout, no `IntersectionObserver`, and `wheel` listeners are subject to jsdom's event model (no real passive/zoom). So: unit-test the `nextZoom` math directly (pure); test `ZoomControl` in isolation (clicks → callbacks); in `Reader.test.tsx` mock `render` and assert the `%` readout changes on Ctrl-key zoom. Real `Ctrl+scroll` / native-zoom suppression is verified in the live browser smoke, not jsdom. Same shape 1.3/1.4 used. [Source: 1-3/1-4 Debug Log]
- `no-raw-values.test.ts`, `focus-ring.test.ts` must stay green. [Source: 1-1/1-3 Debug Log]

### Previous story intelligence (Story 1.4)

- **Pure-helper + mock pattern is the house style.** 1.4 kept `currentPageInView`/`pageNavTarget` DOM-free + unit-tested and mocked the whole `render` module in component tests (extending the mock object with each new export so destructured imports aren't `undefined`). Do the same for `nextZoom` and friends. [Source: 1-4 Debug Log, render/nav.test.ts]
- **Behavioral constants stay in the component/module, design dims go to the token layer.** `PREFETCH_MARGIN = 200` lives in `Reader.tsx`. `ZOOM_MIN/MAX/STEP` are interaction constants → keep them in `render/index.ts` (exported for tests), NOT in `components.css`. [Source: 1-3/1-4 Reader.tsx; review Low findings]
- **`no-raw-values` tripwire:** a digit adjacent to `px` in `.ts`/`.tsx` is flagged (1.3 rebuilt `rootMargin` as `` `${PREFETCH_MARGIN}px` ``). The `%` string is safe, but keep every real dimension in CSS. [Source: 1-3/1-4 Debug Log]
- **Scale was deliberately left in `Reader` state for this story.** 1.3's note: "Scale is held in `Reader` state for Story 1.5 … page nav targets are derived from live card geometry, not a cached pixel value." That holds — `pageNavTarget` reads live card `offsetTop`, so PgUp/PgDn keeps working after zoom changes the card sizes. Verify both interactions coexist. [Source: 1-3 Reader.tsx; 1-4 Dev Notes]
- **Card refs / registry already exist** (`cardEls` map, `registerCard`) and the render-task cancellation on `scale` change is already correct — zoom reuses both untouched. [Source: 1-4 Reader.tsx lines 40-52, 263-290]

### Project Structure Notes

- Stays within `render/` (pure helper) + `Reader`/`App` shells + a new top-level presentational `ZoomControl.tsx` (sits beside `EmptyDropzone.tsx` / `Toast.tsx`, the existing presentational-component convention). `anchor/`, `annotations/`, `store/` remain README stubs (Epic 2/3) — do not create them. [Source: ARCHITECTURE-SPINE.md#Structural-Seed; client/src layout]
- No backend, contract, or `docs/API.md` change (no new endpoint). [Source: epics.md Story 1.5]
- The `nextZoom` interaction math is plain arithmetic, **not** the AD-4 anchor normalization — keeping it in `render/` does not violate AD-9 (which is specifically about annotation normalized↔screen mapping, owned by `anchor/` in Epic 2). Do not conflate the two. [Source: ARCHITECTURE-SPINE.md#AD-9; 1-4 Project Structure Notes]

### References

- [Source: .bmad/planning-artifacts/epics.md#Story-1.5] — story statement + 3 ACs (FR-5 keyboard/ctrl-scroll/Ctrl-0 zoom, UX-DR10 pill, NFR-1/NFR-3 pixel-stable canvas + rescaling box)
- [Source: .bmad/planning-artifacts/architecture/architecture-paper-mate-2026-06-28/ARCHITECTURE-SPINE.md] — AD-4 (scale-1.0 page box, the zoom invariant), AD-9 (anchor boundary — no anchor math here), line 190 (FR-1..6 → render layer)
- [Source: EXPERIENCE.md] — line 32 (zoom-control bottom-right pill), line 51 (`184%` zoom microcopy), line 65 (pill `−`/`+`/`%`), lines 92/118-119 (IP-5 / keyboard map `Ctrl +/-`, `Ctrl 0`), lines 128-134 (accessibility floor)
- [Source: DESIGN.md] — line 248 `components.zoom-control` token block, line 380 (`{typography.caption}` = 13px, "zoom %"), line 401/455 (`zoom-control` floating pill spec), line 426 (`{rounded.pill}`)
- [Source: client/src/Reader.tsx] — `scale` state, `handleKeyDown` (extend), inline fit calc to refactor, PageCard `scale`-dep paint + cancellation
- [Source: client/src/render/index.ts] — `fitToWidthScale` (reuse for `Ctrl 0`), helper-module pattern for `nextZoom`
- [Source: .bmad/implementation-artifacts/1-4-scroll-and-page-navigation.md] — Reader structure, card registry, pure-helper + render-mock test pattern, behavioral-constant placement, no-raw-values tripwire

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (BMad dev-story workflow)

### Debug Log References

- **`render/` tests must mock pdf.js or jsdom isn't enough.** `zoom.test.ts` imports from `render/index.ts`, which imports `pdfjs-dist` at module load → `DOMMatrix is not defined` even under jsdom. Mirrored `nav.test.ts`: `vi.mock("pdfjs-dist" / worker `?url` / `pdf_viewer.css`)` before importing the pure helpers, keeping the zoom math a fast DOM-free unit test.
- **Live-smoke read-after-dispatch race.** Dispatching a synthetic `WheelEvent` in `page.evaluate` runs the listener synchronously (so `preventDefault` / `defaultPrevented` is observable immediately), but the React state update (and the `%` text) only flush after the handler returns. Reading the pill text in the same synchronous block showed the stale value; a follow-up read confirmed `157% → 197%`. Not a code bug — a test-timing artifact.
- **`computeFitScale` stays stable (`useCallback([])`).** It takes the measured boxes as an argument rather than closing over `boxes` state, so its identity never changes and adding it to the load-effect deps doesn't re-trigger the load. The initial load passes `nextBoxes`; `Ctrl 0` / the pill reset pass the current `boxes` state.

### Completion Notes List

- **Pure zoom math (Task 1, AC-1..4):** added `nextZoom(current, direction)` + `ZOOM_MIN`/`ZOOM_MAX`/`ZOOM_STEP` (0.25 / 4 / 1.25) to `render/index.ts` — multiplicative step, clamped, DOM-free, unit-tested (6 cases incl. both clamps + round-trip). Behavioral constants kept in code, not the token layer.
- **Reusable fit (Task 2, AC-1):** extracted `computeFitScale(measured)` in `Reader` reading the **live** canvas width; the initial load and `Ctrl 0` / pill reset share it (no duplicated fit calc).
- **Keyboard zoom (Task 3, AC-1):** extended the canvas `handleKeyDown` with `Ctrl +`/`=` (in, Shift allowed for the `+` glyph), `Ctrl -` (out), `Ctrl 0` (fit) — each `preventDefault()`s to block the browser's native page zoom. Existing `PgUp`/`PgDn` + `Ctrl+Arrow` page nav left intact and verified to coexist.
- **Ctrl+scroll / pinch (Task 4, AC-2):** native `wheel` listener with `{ passive: false }` (React's passive `onWheel` can't block native zoom); zooms only on `e.ctrlKey`, `preventDefault`s it, leaves plain scroll untouched. Cleaned up on unmount.
- **Zoom-control pill (Tasks 5-6, AC-3,4):** new presentational `ZoomControl.tsx` (`−` / live `%` / `+`, real labelled buttons, `%`-click resets), rendered by `Reader` as a fragment-sibling overlay of `.pdf-canvas`. Tokens `--zoom-control-*` in `components.css`; `.zoom-control` rules in `App.css` (absolute bottom-right, `z-index` over canvas, tokens only). Pill overlays — never consumes canvas width.
- **Single-scale invariant (AC-4):** zoom mutates only the one `scale`; it flows uniformly into both `renderPage`'s viewport and the reserved card dims. The scale-1.0 `getPageBox` is never touched, so the future anchor mapping `rect_norm × pageBox × scale` holds. No anchor math added.
- **Tests (Task 7):** `render/zoom.test.ts` (6), `ZoomControl.test.tsx` (4), `Reader.test.tsx` extended (+4: pill percent, `Ctrl +/-/=/0`, pill buttons, `Ctrl+wheel` vs plain wheel). Full suite **59 pass**, typecheck clean, prod build bundles the pdf worker. `no-raw-values` + `focus-ring` green. No backend/contract/`docs/API.md` change.
- **Live browser smoke (Task 8, Chrome via Playwright, 12-page PDF):** fit-on-load `157%`; pill `+` `157→197%`; `.pdf-canvas` box **pixel-stable** at `1026×724` across zoom (page content grows, canvas box unchanged — NFR-1); `Ctrl 0` → `157%`; `Ctrl +`/`Ctrl -` `157↔197`; `Ctrl+wheel` zooms and `defaultPrevented === true` (browser zoom blocked), plain wheel does **not** zoom; `PgDn` after zoom still advances `Page 1 → 2 of 12` (1.4 coexistence). Only console error is a benign favicon 404.

### Completion Notes — Review-continuation (correct-course, 2026-06-28)

Resolved all 4 code-review findings + 3 user follow-ups in one pass (see `sprint-change-proposal-2026-06-28.md`). The control moved off the canvas into the top bar; zoom state stays in `Reader` (it owns the scroll container needed for focal point) and is driven from `App` via an imperative handle.

- ✅ **[HIGH] Focus-independent shortcuts (AC-1).** Moved the `Ctrl +/-/0` handler off `.pdf-canvas` to a **document-level** `keydown` listener (guarded `phase === "ready"`), so the shortcuts fire no matter which control has focus. Verified live: `Ctrl 0` reset while the **Zoom-in button held focus** (the exact bypass the reviewer flagged). The canvas `handleKeyDown` keeps only PgUp/PgDn + Ctrl+Arrow.
- ✅ **[user #1] Top-bar relocation (AC-3).** `ZoomControl` now renders in `App`'s top bar, left of ToC (`role="group" aria-label="Zoom"`). `scale` lifted via `useImperativeHandle` (`ReaderHandle = { zoomIn, zoomOut, resetZoom }`, React-19 ref-as-prop); `Reader` reports the live percent up via `onZoomChange`. `.zoom-control` restyled as top-bar chrome (no absolute/shadow). Overrides UX-DR10 (patched in epics.md/EXPERIENCE.md).
- ✅ **[user #2 / LOW] Finer wheel step (AC-2).** Added `ZOOM_WHEEL_STEP = 1.1`; the wheel uses it, keyboard/buttons keep `ZOOM_STEP = 1.25`. `nextZoom` gained a `step` param. Live: `Ctrl+wheel` 157→173 (×1.10, +16pts vs the old +39). `deltaY === 0` now no-ops (was zoom-out).
- ✅ **[user #3] Focal-point preservation (AC-5).** New pure `focalScrollOffset(scroll, focal, factor)`; `Reader` stashes `{factor, focal}` on each zoom and compensates `scrollLeft/Top` in a `useLayoutEffect` keyed on `scale` (cursor for wheel, viewport center for keyboard/buttons). Live: zoomed about a point at scrollTop 800 → expected 912 vs actual 910 (within 2px). Single `scale` only — AC-4 invariant intact.
- ✅ **[LOW] Hit-size + AT percent (AC-3).** `--zoom-control-button-size: 24px` min hit target on the `−`/`+` buttons. Removed the overriding `aria-label="Fit to width"`; the visible `%` is now the reset button's accessible name + a polite live region (`aria-live="polite"`).
- ✅ **Tests.** `render/zoom.test.ts` +wheel-step + `focalScrollOffset`; `ZoomControl.test.tsx` rewritten for AT percent; `Reader.test.tsx` now asserts **document-level** keyboard zoom, the imperative handle, and `deltaY===0`; `App.test.tsx` asserts the control sits left of ToC and drives the Reader. Full suite green, typecheck + build green.
- ✅ **[user #4] Flicker-free zoom re-render.** The page/text strobed because each zoom step did `setPainted(false)` (skeleton flash) and `renderPage` reset `canvas.width` (blank) before re-rendering. Fix: `renderPage` now renders into an **offscreen canvas + detached text container and swaps both atomically** (visible canvas never blanks); `PageCard` keeps the skeleton for the **first paint only** (never re-flashes on zoom), **CSS pre-scales the canvas** (`transform: scale(scale/renderedScale)`, origin top-left) for instant feedback, and **debounces the crisp re-render** (`REPAINT_DEBOUNCE = 150ms`) so a continuous wheel zoom renders once per gesture, not per notch. The text layer (transparent selection overlay) isn't pre-scaled — a momentarily-stale selection layer is invisible. Live-verified: mid-gesture canvas shows `scale(0.8)` with **no skeleton**, settles to crisp with the transform cleared. **67 tests** (added a jsdom guard that a zoom pre-scales the canvas and never re-shows the skeleton), typecheck + build green.

### File List

**Added**
- `client/src/ZoomControl.tsx`
- `client/src/ZoomControl.test.tsx`
- `client/src/render/zoom.test.ts`

**Modified**
- `client/src/render/index.ts` (`nextZoom` + `step` param, `ZOOM_MIN/MAX/STEP`, `ZOOM_WHEEL_STEP`, card-geometry `focalScroll`; `renderPage` offscreen-render + atomic canvas/text swap + explicit `--scale-factor`/`--total-scale-factor`)
- `client/src/Reader.tsx` (`computeFitScale`; `ReaderHandle` + `useImperativeHandle`; `captureAnchor`/`applyScale` + card-anchored focal `useLayoutEffect`; document-level keyboard zoom; **document-level** cursor/centre `wheel` zoom w/ finer step + `deltaY===0` guard; `onZoomChange`; control no longer rendered here; `PageCard` flicker-free re-render — CSS pre-scale + `REPAINT_DEBOUNCE`, skeleton on first paint only)
- `client/src/Reader.css` (`.page-surface__canvas` `transform-origin: 0 0` for the zoom pre-scale)
- `client/src/App.tsx` (`ReaderHandle` ref, `zoomPercent`, top-bar `<ZoomControl>` left of ToC, pass `ref`/`onZoomChange` to `Reader`)
- `client/src/ZoomControl.tsx` (top-bar chrome; `role="group"`; AT-exposed percent)
- `client/src/Reader.test.tsx` (document-level keyboard + off-canvas wheel, imperative handle, wheel `deltaY===0`, flicker pre-scale guard; mock `focalScroll`/`ZOOM_WHEEL_STEP`)
- `client/src/App.test.tsx` (top-bar zoom-control placement + drive tests; mock zoom exports)
- `client/src/theme/components.css` (`--zoom-control-*`: drop offset, add `--zoom-control-button-size`)
- `client/src/App.css` (`.zoom-control` restyled as top-bar pill + button hit-size)
- `.bmad/planning-artifacts/epics.md`, `EXPERIENCE.md` (UX-DR10 → top bar)
- `.bmad/implementation-artifacts/sprint-status.yaml` (1-5 status transitions)

## Senior Developer Review (AI)

### Outcome

Changes Requested

### Review Date

2026-06-28 16:06 KST

### Acceptance Criteria Assessment

- AC-1 Keyboard zoom + fit/reset: **Not fully satisfied.** Keyboard zoom works only while focus is on `.pdf-canvas`; after interacting with the sibling zoom-control overlay, `Ctrl +/-/0` targets the focused button and bypasses the canvas `onKeyDown`.
- AC-2 Ctrl+scroll zoom: **Not fully satisfied.** The non-passive wheel listener is attached only to `.pdf-canvas`, so `Ctrl+wheel` over the overlay is not intercepted and can fall through to browser zoom.
- AC-3 Zoom-control pill mirrors keyboard: **Mostly satisfied**, but button hit target styling is below the story's tokenized hit-size requirement.
- AC-4 Pixel-stable canvas, single scale invariant: **Satisfied by inspection.** Zoom mutates the single `scale`; scale-1.0 page boxes are not mutated; the pill is positioned absolute under `.stage`.

### Verification

- `cd client && npm test` — passed, 8 files / 59 tests.
- `cd client && npm run typecheck` — passed.
- `cd client && npm run build` — passed; Vite reported only the existing large-chunk warning.

### Action Items

- [x] [HIGH] Fix keyboard and wheel interception for the overlay focus path. `ZoomControl` is rendered as a sibling of `.pdf-canvas` (`Reader.tsx:241`), while keyboard and native wheel handlers are attached only to `.pdf-canvas` (`Reader.tsx:160`, `Reader.tsx:219`). After clicking or tabbing to a zoom-control button, `Ctrl +/-/0` no longer reaches `handleKeyDown`; `Ctrl+wheel` over the pill no longer reaches the non-passive wheel listener. This violates AC-1/AC-2's native browser zoom suppression requirement. A scoped fix is to put the relevant handlers on a common positioned stage-level owner or make the overlay delegate/prevent the same shortcuts without adding a global/window listener.
- [x] [LOW] Add and use a zoom-control button hit-size token. Task 6 explicitly calls for a `--zoom-control-*` button hit size, but `components.css:45-50` defines only offset/gap/percent width, and `App.css:85-92` gives the buttons `padding: 0` with no min inline/block size.
- [x] [LOW] Ignore zero vertical wheel delta instead of treating it as zoom-out. `Reader.tsx:158` maps every non-negative `deltaY` to zoom-out, so a Ctrl+horizontal wheel event with `deltaY === 0` can unexpectedly zoom out while preventing default.
- [x] [LOW] Preserve the visible percent in the accessible name or an aria-live/status path. `ZoomControl.tsx:34` sets `aria-label="Fit to width"` on the percent button, overriding the visible `184%`-style text for assistive tech.

### Review Follow-ups (AI)

- Add component tests that dispatch `Ctrl +/-/0` and `Ctrl+wheel` from/focused on zoom-control buttons, not only from `reader-backdrop`.
- Add assertions for the zoom button hit-size token/rules once implemented.
- Consider an accessibility test that the current zoom value is exposed to assistive technology.

### Triage Notes

- Dismissed: `removeEventListener("wheel", onWheel)` is not a real leak; DOM listener removal matches on type, callback, and capture, not passive-object identity.
- Dismissed: `computeFitScale([])` is guarded by `fitToWidthScale`; zero width returns `1`, not `Infinity`/`NaN`.
- Dismissed: the zoom-control absolute positioning is not detached from the reader; it is correctly positioned against `.stage`, which is `position: relative`.

### Re-Review Outcome

Changes Requested

### Re-Review Date

2026-06-28 16:56 KST

### Re-Review Acceptance Criteria Assessment

- AC-1 Keyboard zoom + fit/reset: **Satisfied by inspection and tests.** The keyboard shortcuts moved to a document-level listener guarded by `phase === "ready"`; `Ctrl +/-/0` now works outside canvas focus and cleans up on effect teardown.
- AC-2 Ctrl+scroll zoom: **Not fully satisfied.** The wheel listener remains attached only to `.pdf-canvas`; after the control moved to the top bar, `Ctrl+wheel` over `ZoomControl` no longer reaches the non-passive listener.
- AC-3 Top-bar zoom control mirrors keyboard: **Satisfied by inspection and tests.** The control is left of ToC, drives the Reader imperative handle, exposes the live percent, and uses tokenized hit-size rules.
- AC-4 Pixel-stable canvas, single scale invariant: **Satisfied by inspection.** The implementation still mutates one `scale` value and leaves the scale-1.0 page box immutable; CSS pre-scale is transient presentation over the current canvas bitmap, not a second source of zoom state.
- AC-5 Zoom preserves the focal point: **Not fully satisfied.** The pure formula is correct for uniformly-scaled content, but the actual scroll content includes fixed column padding/gaps and centering, so the current compensation drifts on lower pages.

### Re-Review Verification

- `cd client && npm test` — passed, 8 files / 67 tests.
- `cd client && npm run typecheck` — passed.
- `cd client && npm run build` — passed; Vite reported only the large-chunk warning.

### Re-Review Action Items

- [x] [HIGH] Fix `Ctrl+wheel` over the top-bar zoom control. `ZoomControl` is rendered in the header (`App.tsx:65-72`), outside the `.pdf-canvas` scroll container, while the only non-passive wheel listener is attached to `scrollRef.current` (`Reader.tsx:228-240`). This leaves the prior HIGH only partially closed: keyboard focus bypass is fixed, but the wheel overlay/control path can still fall through to browser zoom. Add coverage that dispatches `Ctrl+wheel` on the top-bar zoom control, not only on `reader-backdrop`.
- [x] [MED] Fix focal-point preservation against real reader layout. `focalScrollOffset(scroll, focal, factor)` (`render/index.ts:114`) multiplies the whole scroll coordinate, but `.pdf-canvas__column` has fixed padding/gaps (`Reader.css:20-26`) and only page cards scale (`Reader.tsx:470-471`). On later pages, the accumulated fixed gaps are incorrectly scaled, so the PDF point under the cursor/viewport center drifts. Use page/card geometry or otherwise subtract fixed layout offsets before applying the scale factor.

### Re-Review Deferred

- [x] [DEFER] Text layer scale variables are still missing outside pdf.js's `.pdfViewer .page` wrapper. The new offscreen swap copies the same inline styles the old live render received, so this is pre-existing, but local `pdfjs-dist` shows `.textLayer` CSS depends on `--total-scale-factor` while `TextLayer` itself only sets `--min-font-size` and dimensions.
- [x] [DEFER] Page renders still do not cancel on scroll-away. `PageCard` marks a page visible once and disconnects the observer, so render cleanup happens on unmount or scale change, not viewport exit. This predates Story 1.5 and should be considered when broader virtualization/lazy-rendering work arrives.

### Re-Review Triage Notes

- Blind Hunter failed because the workflow requires inline diff only and the full unified diff could not be passed without truncation; Edge Case Hunter and Acceptance Auditor completed.
- Dismissed: `renderPage` offscreen canvas allocation itself is not a persistent leak; unreferenced detached canvases/text containers are released after render/cancel settles.
- Dismissed: `renderedScaleRef` / transform clear ordering looks correct on successful repaint: CSS pre-scale applies before the debounced render, then the committed crisp frame records the new scale and clears the transform.

## Change Log

- **2026-06-28:** Story 1.5 drafted (create-story) — zoom via `Ctrl +/-`, `Ctrl 0` fit/reset, `Ctrl+scroll`/pinch, and the bottom-right `{component.zoom-control}` pill with live `%`, all driving the existing `scale` state. Status → ready-for-dev.
- **2026-06-28:** Story 1.5 implemented (dev-story) — `nextZoom` pure helper, reusable `computeFitScale`, keyboard `Ctrl +/-/0`, non-passive `Ctrl+scroll`/pinch zoom, and the `ZoomControl` overlay pill. Frontend 59 tests, typecheck, prod build green; live Chrome smoke on a 12-page PDF confirmed all 4 ACs (keyboard + wheel + pill zoom, live %, browser-zoom suppression, pixel-stable canvas, page-nav coexistence). Status → review.
- **2026-06-28:** Senior code review (AI) completed — Changes Requested. Added four unresolved review action items; status → in-progress.
- **2026-06-28:** Correct-course sprint change (`sprint-change-proposal-2026-06-28.md`) — bundled the 4 review findings with 3 user follow-ups: top-bar relocation of the zoom control (overrides UX-DR10), finer ≈10% wheel step, focus-independent shortcuts, and focal-point preservation (new AC-5). Revised AC-1/AC-2/AC-3, scope guard, and added Review Follow-ups (AI) tasks. Status stays in-progress for dev-story review-continuation.
- **2026-06-28:** Review-continuation (dev-story) — implemented all 7 follow-ups: document-level focus-independent shortcuts (HIGH), zoom control relocated to the top bar via a Reader imperative handle (overrides UX-DR10), `ZOOM_WHEEL_STEP = 1.1` finer wheel + `deltaY===0` guard, focal-point-preserving scroll compensation (AC-5, `focalScrollOffset`), button hit-size token, and AT-exposed live percent. All review action items + follow-up tasks resolved. Frontend **66 tests**, typecheck, build green; live Chrome smoke confirmed focus-independent `Ctrl 0` (button focused), ~10% wheel step (157→173), and focal point preserved within 2px. Status → review.
- **2026-06-28:** Flicker-free zoom (user follow-up #4) — `renderPage` renders offscreen and swaps the canvas + text atomically (no blank); `PageCard` shows the skeleton on first paint only, CSS pre-scales the canvas for instant feedback, and debounces the crisp re-render (`REPAINT_DEBOUNCE = 150ms`). **67 tests** (added a jsdom pre-scale/no-skeleton guard), typecheck + build green; live Chrome smoke confirmed mid-gesture `scale(0.8)` with no skeleton, settling crisp.
- **2026-06-28:** Second code review (AI) — Changes Requested (prior HIGH only partly closed). Addressed: (HIGH) moved the `Ctrl+wheel` listener to the **document level** so it's caught over the top-bar control too (browser zoom blocked everywhere; focal = cursor over canvas, else centre); (MED) reworked focal preservation to **anchor to the page card under the focal point** (`focalScroll(cardEdge, cardSize, frac, focal)`) instead of a uniform factor, so fixed column padding/gaps no longer drift lower pages; (text) explicitly set `--scale-factor`/`--total-scale-factor` on the swapped text layer. **67 tests** (new `focalScroll` + off-canvas-wheel + `deltaY===0` guards), typecheck + build green; live Chrome smoke: ctrl+wheel over the pill blocked browser zoom and zoomed (157→173), lower-page focal drift **0px**, text scale vars set. Deferred (pre-existing, out of scope): render-cancel on scroll-away. Status remains review.
