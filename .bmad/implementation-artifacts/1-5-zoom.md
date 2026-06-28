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

1. **Keyboard zoom + fit/reset.** Given the reader, when I press `Ctrl +` / `Ctrl -` (or `Ctrl+scroll`), then pages zoom in/out and the on-screen control shows a live `%`; and `Ctrl 0` fits the page to width / resets the zoom. [FR-5, UX-DR14, UX-DR15]
2. **Ctrl+scroll zoom.** Given the reader, when I hold `Ctrl` and scroll the wheel (or pinch a trackpad), then the page zooms in/out, the browser's native page zoom never fires, and plain (no-`Ctrl`) scroll still scrolls the document. [FR-5, UX-DR14]
3. **Zoom-control pill mirrors keyboard.** Given the bottom-right `{component.zoom-control}` pill (`−` / live `%` / `+`), when I click `−` / `+`, then the page zooms by the same step as the keyboard and the `%` updates live. [UX-DR10]
4. **Pixel-stable canvas, single scale invariant.** Given any zoom level, then the `pdf-canvas` box stays pixel-stable (the zoom-control and all chrome are overlays — they never consume canvas width and nothing reflows), and zoom changes exactly one `scale` value that uniformly multiplies the scale-1.0 page box so derived screen positions stay correct (the AD-4 page box itself is never mutated). [NFR-1, NFR-3 foundation]

> **Scope guard.** This story adds: `Ctrl +` / `Ctrl -` / `Ctrl 0` keyboard zoom, `Ctrl+scroll` (and trackpad pinch) zoom, the bottom-right `{component.zoom-control}` pill with live `%`, all driving the existing `scale` state. It does **NOT** add: pan / hand tool / hold-`Space` (Story 1.6), table of contents (1.7), any annotation or anchor coordinate math (Epic 2 — this story only preserves the single-`scale` invariant the anchor layer will later rely on), the save-indicator behavior (Epic 3), or zoom animation/transitions. Do **not** add window-level/global key listeners — extend the existing canvas `handleKeyDown` (the established pattern). Do **not** introduce a second scale/offset variable, mutate the scale-1.0 page box, or replace the `IntersectionObserver` lazy paint.

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

### File List

**Added**
- `client/src/ZoomControl.tsx`
- `client/src/ZoomControl.test.tsx`
- `client/src/render/zoom.test.ts`

**Modified**
- `client/src/render/index.ts` (add `nextZoom` + `ZOOM_MIN`/`ZOOM_MAX`/`ZOOM_STEP`)
- `client/src/Reader.tsx` (`computeFitScale`, keyboard `Ctrl +/-/0`, native `wheel` zoom effect, render `<ZoomControl>` overlay)
- `client/src/Reader.test.tsx` (render-mock `nextZoom`; zoom keyboard/wheel/pill tests)
- `client/src/theme/components.css` (`--zoom-control-*` tokens)
- `client/src/App.css` (`.zoom-control` overlay rules)
- `.bmad/implementation-artifacts/sprint-status.yaml` (1-5 → in-progress → review)

## Change Log

- **2026-06-28:** Story 1.5 drafted (create-story) — zoom via `Ctrl +/-`, `Ctrl 0` fit/reset, `Ctrl+scroll`/pinch, and the bottom-right `{component.zoom-control}` pill with live `%`, all driving the existing `scale` state. Status → ready-for-dev.
- **2026-06-28:** Story 1.5 implemented (dev-story) — `nextZoom` pure helper, reusable `computeFitScale`, keyboard `Ctrl +/-/0`, non-passive `Ctrl+scroll`/pinch zoom, and the `ZoomControl` overlay pill. Frontend 59 tests, typecheck, prod build green; live Chrome smoke on a 12-page PDF confirmed all 4 ACs (keyboard + wheel + pill zoom, live %, browser-zoom suppression, pixel-stable canvas, page-nav coexistence). Status → review.
