---
baseline_commit: 6d851a7ad9a5da4a40ba147915bffa1ae743dc01
---

# Story 1.8: Pan / hand tool

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> Renumbered from Story 1.6 → 1.8 on 2026-06-28 (correct-course) so story numbers track execution order after the render-fix stories (1.6/1.7) landed first. **This is the FIRST tool-rail story**: the rail has shipped only as a collapsed placeholder `<aside>` (Story 1.1). It stands up the floating tool-rail with the cursor button + its flyout (cursor / hand / box-select) and wires the hand tool + hold-`Space` to pan the page. The other rail buttons (highlight/underline/pen/memo/comment/box-select-behavior/ToC) arrive with their own stories — build the rail as an extensible shell, not the full toolset.

## Story

As a reader,
I want to pan the page by dragging with a hand tool or holding Space,
so that I can reposition a zoomed-in page.

## Acceptance Criteria

1. **Cursor button + flyout; selecting hand arms panning.** Given the `{component.tool-rail}` cursor button, then clicking it opens its `{component.tool-flyout}` offering **cursor / hand / box-select**; selecting **hand** arms panning (the rail shows the hand as the armed tool, `{component.tool-button-armed}`), selecting **cursor** returns to the default. (Box-select is selectable and arms its mode for visual parity, but its drag behavior is Story 2.6 — it does nothing this story.) [FR-6, UX-DR4]
2. **Drag pans without reflow (hand armed or Space held).** Given the hand tool is armed **or** `Space` is held, when I drag on the page, then the canvas scroll offset follows the pointer (the page moves under the cursor) and **nothing reflows** — page geometry, scroll height, and card positions are unchanged; only the scroll position moves (NFR-1). The pointer shows `grab` when pan is available and `grabbing` during the drag, and a hand-drag does **not** start a text selection. [FR-6, IP-4, UX-DR14, NFR-1]
3. **Return to cursor (Space release / `V` / `Esc`).** Given `Space` is released, then control returns to **whatever tool was armed before** (temporary pan). Given `V` or `Esc` is pressed, then the armed tool returns to **cursor**. [UX-DR15]
4. **Rail collapse toggle (`[`).** Given the reader, when I press `[` (or click the rail's collapse affordance), then the tool-rail collapses / expands, overlaying the canvas without reflowing it (NFR-1). [UX-DR4, UX-DR15]

> **Scope guard.** Adds: a new `ToolRail` chrome component (cursor button + cursor/hand/box-select flyout + collapse) replacing the placeholder `<aside>` in `App`; App-level `mode` (`"cursor" | "hand" | "box-select"`) + `railCollapsed` state and the `V`/`Esc`/`[` key handling; pointer-drag + hold-`Space` panning inside `Reader` (it owns the `.pdf-canvas` scroll container); the `tool-button` / `tool-button-armed` / `tool-flyout` component dims in `components.css` and rail/flyout/cursor CSS in `App.css`. It does **NOT**: build any annotation tool (highlight/underline/pen/memo/comment) or the box-select drag behavior (Story 2.6); add the quick-box (UX-DR5); wire the ToC or Bank buttons; introduce Zustand or any new dependency (tool mode stays lightweight React state until the Epic 2 tool system — matches the `App.tsx` note); change `renderPage`, zoom math, scroll-nav, the AD-4 page box, or anchor math; add a backend route / Pydantic model / OpenAPI / `docs/API.md` change; or compute any screen↔PDF coordinate (pan is pure scroll-offset, no anchor math — AR-9).

## Tasks / Subtasks

- [x] **Task 1 — Tool-mode + rail state in `App`, with `V`/`Esc`/`[` keys** (AC: 1, 3, 4)
  - [x] In `client/src/App.tsx` add `const [mode, setMode] = useState<ToolMode>("cursor")` and `const [railCollapsed, setRailCollapsed] = useState(false)`, where `type ToolMode = "cursor" | "hand" | "box-select"`. Keep it **lightweight React state** — do NOT add Zustand (not installed; the tool system formalizes in Epic 2, per the existing `App.tsx` comment at line 14-15). Define `ToolMode` in a small shared spot (e.g. export from `ToolRail.tsx`) so `Reader`/`App`/`ToolRail` agree.
  - [x] Document-level `keydown` listener (guarded to when a doc is open, mirroring the Reader's zoom-key effect): `V` or `Escape` → `setMode("cursor")`; `[` → `setRailCollapsed((c) => !c)`. **Do NOT** handle `Space` here — Space is a Reader-internal temp-pan (Task 3), and a document-level Space handler would fight the scroll container. Guard like the existing keyboard map: ignore when `e.ctrlKey/altKey/metaKey` (so `Ctrl 0` etc. pass) and when the event target is an editable field (`input`/`textarea`/`[contenteditable]`) — none exist yet, but it keeps the map future-safe. `preventDefault` only for keys you consume.
  - [x] Pass pan-armed down to `Reader`: `panArmed={mode === "hand"}`. The Reader owns the actual pan gesture; `App` only tells it whether the hand is the armed tool.
- [x] **Task 2 — `ToolRail` component (cursor button + flyout + collapse)** (AC: 1, 4)
  - [x] Create `client/src/ToolRail.tsx` (root-level chrome, mirroring `ZoomControl.tsx`: presentational, owns no scroll/scale state). Props: `{ mode: ToolMode; onMode: (m: ToolMode) => void; collapsed: boolean; onToggleCollapse: () => void }`. Replace the placeholder `<aside className="tool-rail">` in `App.tsx` (lines 91-93) with `<ToolRail … />`.
  - [x] Render the floating 48px rail (`{component.tool-rail}`). When **expanded**, show the **cursor button** (`{component.tool-button}`; armed styling `{component.tool-button-armed}` when `mode !== "box-select"`… see below) that toggles the **flyout**. The flyout (`{component.tool-flyout}`) lists three options: **cursor**, **hand**, **box-select**; clicking one calls `onMode(value)` and closes the flyout. The currently-armed option shows the armed state. Include the collapse affordance (a small button, `aria-label="Collapse tools"` / `"Expand tools"`); when **collapsed**, render the minimal rail (icon-only or a single expand button) so `[` / click round-trips.
  - [x] Armed indicator: the cursor rail button reflects the active cursor-family mode (cursor vs hand vs box-select). Keep it simple — one rail button (the cursor/family button) whose flyout picks the sub-mode; the armed sub-mode is highlighted inside the flyout and/or on the button. Do NOT add the other tool buttons (highlight/underline/pen/memo/comment/ToC) — those are their own stories; leave vertical room but don't render dead buttons.
  - [x] A11y: rail is `<aside aria-label="Tools">`; the cursor button is a `<button aria-haspopup="menu" aria-expanded={open}>`; flyout options are `<button>`s with `aria-pressed` reflecting armed. Close the flyout on outside-click and `Escape` (Escape also returns to cursor via the App handler — that's fine; the flyout just closes). Keep `data-testid="tool-rail"` (already asserted by `App.test.tsx`) and add `data-testid` hooks for the flyout + options.
- [x] **Task 3 — Pan gesture in `Reader` (hand-drag + hold-`Space`)** (AC: 2, 3)
  - [x] Add `panArmed?: boolean` to `Reader`'s props. Add internal `const [spaceHeld, setSpaceHeld] = useState(false)` and derive `const canPan = panArmed || spaceHeld`.
  - [x] **Hold-`Space` temp pan:** a `keydown`/`keyup` listener (on the `.pdf-canvas` or document, guarded `phase === "ready"`): `Space` keydown → `setSpaceHeld(true)` + `preventDefault()` (stop the browser's page-scroll-on-space); `Space` keyup → `setSpaceHeld(false)`. Ignore auto-repeat (`e.repeat`) and editable targets. On release, `canPan` falls back to `panArmed` (so it returns to the armed tool — AC-3 temp-pan). Do not swallow Space if a future text input has focus.
  - [x] **Pointer-drag pan:** on the `.pdf-canvas`, `onPointerDown` (when `canPan` and primary button): capture the pointer (`setPointerCapture`), record `startX/startY` and the container's `startScrollLeft/startScrollTop`, set a `dragging` flag, `preventDefault()` (suppress text selection / native drag). `onPointerMove` (while dragging): `container.scrollLeft = panScroll(startScrollLeft, e.clientX - startX)` and `container.scrollTop = panScroll(startScrollTop, e.clientY - startY)` — i.e. the page follows the pointer (drag right → content moves right → scrollLeft decreases). `onPointerUp`/`onPointerCancel`/`lostpointercapture`: release capture, clear `dragging`. **Pan only moves `scrollLeft`/`scrollTop`** — it never touches card geometry, `scale`, or the page box (NFR-1).
  - [x] **Cursor + selection suppression:** when `canPan`, set the canvas cursor to `grab` (and `grabbing` while `dragging`) and disable text selection on the canvas (a `data-pan` attribute or class the CSS targets with `cursor` + `user-select: none`). When not panning, the text layer stays selectable (Story 1.3 behavior preserved).
  - [x] Leave ALL existing Reader behavior intact: the `usePageViewport` window, zoom (wheel/key/imperative + focal anchor), PgUp/PgDn nav. Pan is additive pointer/Space handling on the same container; the plain (no-pan) wheel/scroll path is unchanged (AC-2 of Story 1.5 still holds).
- [x] **Task 4 — Pure pan helper + tokens + CSS** (AC: 1, 2, 4)
  - [x] Add a DOM-free pure helper to `client/src/render/index.ts` next to `focalScroll`: `export function panScroll(startScroll: number, pointerDelta: number): number { return startScroll - pointerDelta; }` (the browser clamps the assigned value to range). Unit-tested — gives the gesture a deterministic anchor the way `focalScroll`/`nextZoom` do. Plain layout arithmetic, no anchor math (AR-9).
  - [x] In `client/src/theme/components.css` add the missing hand-authored dims from `DESIGN.md`: `--tool-button-size: 36px`, `--tool-button-radius` → `{rounded.md}` token, and any `--tool-flyout-*` padding/offset you need (DESIGN.md: `tool-button` 36px, `tool-button-armed` 36px, `tool-flyout` padding `{spacing.xxs}`). Keep the existing `--tool-rail-*` tokens. **Raw px/hex only ever in `src/theme/**`** — `no-raw-values.test.ts` enforces this for `App.css`/`ToolRail.tsx`.
  - [x] CSS for the rail buttons + flyout + cursor. Follow the existing precedent that `ZoomControl`'s styles live in `App.css` (the `.zoom-control` block) — extend `App.css`'s `.tool-rail` block with `.tool-button`, `.tool-button--armed`, `.tool-flyout`, and the collapsed variant, referencing the tokens above (`{colors.surface-card}`, `{colors.surface-strong}`, `{rounded.md}`, `{colors.hairline}`, `{shadow-card}`). Add `.pdf-canvas[data-pan] { cursor: grab; user-select: none }` and `.pdf-canvas[data-pan="grabbing"] { cursor: grabbing }` (token-free CSS keywords are fine; only hex/px are banned). The flyout overlays — `position: absolute`, higher `z-index` than the rail, never reflowing the canvas (NFR-1).
- [x] **Task 5 — Tests** (AC: 1, 2, 3, 4)
  - [x] `client/src/render/index.test.ts` (or extend an existing render test): `panScroll(100, 30) === 70`, `panScroll(0, -50) === 50`, identity at delta 0.
  - [x] `client/src/ToolRail.test.tsx` (new, mirror `ZoomControl.test.tsx`): renders the rail (`data-testid="tool-rail"`); clicking the cursor button opens the flyout showing cursor/hand/box-select; clicking **hand** calls `onMode("hand")`; the armed option reflects the `mode` prop (`aria-pressed`); the collapse button calls `onToggleCollapse`. DOM-only, no pdf.js.
  - [x] `client/src/App.test.tsx` additions: pressing `V` and `Escape` sets mode back to cursor (assert via the Reader receiving `panArmed=false`, or the rail's armed state); `[` toggles the rail collapsed state; arming **hand** in the flyout makes `App` pass `panArmed` to `Reader`. The `./render` mock already stubs the Reader's render calls — keep `pageWindow`/`WINDOW_RADIUS` in the mock (added in Story 1.7); add nothing unless a new render export is imported.
  - [x] `client/src/Reader.test.tsx` additions: `Space` keydown on the canvas is `preventDefault`ed (returns `false` from `fireEvent.keyDown`) and a subsequent `keyup` clears it; with `panArmed`, a `pointerdown` sets the `data-pan="grabbing"` (or the grab class) and `pointerup` clears it. (Real scroll movement isn't observable under jsdom — that's the live smoke; assert the gesture wiring + cursor state here.) Confirm the existing Space/arrow nav tests still pass (Space must NOT break `PgUp`/`PgDn` or the Ctrl-arrow aliases).
  - [x] `no-raw-values.test.ts` + `focus-ring.test.ts` stay green.
- [x] **Task 6 — Validate + live smoke** (AC: all)
  - [x] `cd client && npm test` (all green incl. the new `ToolRail`/`panScroll` tests), `npm run typecheck` (clean), `npm run build` (succeeds).
  - [x] **Live (AC-1/2/3/4):** `npm run dev` (or the built `dist/` via FastAPI), open a paper, **zoom in** so the page overflows the canvas, then:
    - Rail → cursor button → flyout shows cursor / hand / box-select; pick **hand** → the rail shows hand armed; drag on the page → it **pans** (page follows the pointer), cursor is `grab`/`grabbing`, **no text selection**, and the page does **not** reflow (scrollbars move, geometry fixed).
    - Hold **`Space`** in cursor mode → drag pans; **release** → back to cursor (text selectable again).
    - Press **`V`**/**`Esc`** → returns to cursor; press **`[`** → rail collapses/expands without moving the canvas.
    - Sanity: zoom (`Ctrl +/-/0`, `Ctrl+scroll`), `PgUp`/`PgDn`, and plain scroll still work (no regression).
  - [x] No backend change — do not regenerate the OpenAPI contract or edit `docs/API.md`.

## Dev Notes

### Architecture patterns & constraints (binding)

- **Pan is a `render/` (viewport) concern, not an annotation.** The capability map puts **FR-1..FR-6 (view/scroll/zoom/pan/ToC) in client `render/`** — pan lives with the scroll container in `Reader`, implemented as pure scroll-offset manipulation. It is NOT screen↔PDF coordinate math, so it does not touch `anchor/` and does not violate AR-9. The `panScroll` helper sits with the other DOM-free render helpers (`focalScroll`, `nextZoom`). [Source: ARCHITECTURE-SPINE.md capability map line 190; AD-9 rule lines 105-106]
- **Tool mode is lightweight React state for now — NOT Zustand.** Zustand is the *chosen* store lib (AD-2) but is **not installed**, and the Epic 2 tool system is where it lands. `App.tsx` already states "Lightweight React state only; the Zustand annotation store arrives with annotations (Epic 2/3)." Keep the `mode`/`railCollapsed` state in `App`; do not add a dependency. The full tool system (the other tools + quick-box) is `annotations/` in Epic 2 — this story only stands up the rail shell + the one viewer tool (hand). [Source: client/src/App.tsx:14-15; ARCHITECTURE-SPINE.md source-tree line 172; package.json — no zustand]
- **NFR-1 layout stability is the bar pan must not break.** Panning changes only `scrollLeft`/`scrollTop`; it must never alter `scale`, card geometry, or the page box. The rail + flyout are **overlays** (`position: absolute`, `z-index` above the canvas) that never consume canvas width or reflow it — same rule the top-bar chrome and the collapsed rail already follow. [Source: epics.md NFR-1 (line 64), UX-DR2 (line 92), UX-DR4 (line 94); client/src/App.css `.tool-rail` overlay block]
- **Keyboard map (UX-DR15) — only the in-scope keys.** This story owns `V`/`Esc` (→cursor), `Space` (hold-pan), `[` (rail). The tool letters `H`/`U`/`D`/`T`/`C`/`M` and `Ctrl B` (bank) belong to later stories — do not bind them. Respect the app's existing Ctrl-only discipline so adjacent chords (Ctrl+Shift+Arrow select, `Ctrl 0` fit) pass through. [Source: epics.md UX-DR15 (line 105); client/src/Reader.tsx handleKeyDown + zoom-key effects]
- **No backend / contract / token-generation change.** Pure client UI + interaction. `components.css` is the **hand-authored** dims layer (not generated) — adding `tool-button`/`tool-flyout` dims there is correct and does not require `gen:tokens`. No `/api`, Pydantic, OpenAPI, or `docs/API.md` edit. [Source: CLAUDE.md design-tokens note; ARCHITECTURE-SPINE.md capability map]

### The footguns (read before coding)

- **`Space` must not double-act.** The browser scrolls the page on `Space`; you `preventDefault` it for panning. But `Space` also activates a focused `<button>` — so the rail/flyout buttons must not be focused when the user expects Space-to-pan, and the Reader's Space handler should ignore editable/`button` targets or simply live on the `.pdf-canvas` which is the focused scroll region during reading. Also ignore `e.repeat` so a held Space doesn't thrash `setSpaceHeld`.
- **Hand-drag vs text selection.** Without suppression, a drag over the text layer selects text instead of panning. Suppress with `user-select: none` (via the `data-pan` attribute) **and** `preventDefault()` on `pointerdown` while `canPan`. Restore selection when not panning (don't leave the text layer permanently unselectable — Story 1.3's selectable text is a feature).
- **Pointer capture for off-canvas drags.** Use `setPointerCapture` on `pointerdown` so a fast drag that leaves the canvas keeps panning and the `pointerup` still fires. Release on up/cancel/`lostpointercapture`.
- **Pan direction.** `panScroll(start, delta) = start - delta`: dragging the pointer **right** (positive deltaX) should move the *content* right, which means **decreasing** `scrollLeft` — hence the subtraction (grab-and-drag, like a hand). Verify the feel in the live smoke; it should match dragging paper, not a scrollbar.
- **Don't fight `usePageViewport`.** Panning changes `scrollTop`, which the single `IntersectionObserver` already reacts to (it recomputes the page-in-view + live window off observer fires, not a scroll listener). No extra wiring needed; just don't add a competing scroll listener. [Source: client/src/render/usePageViewport.ts]

### Current state of files this story touches (read before editing)

- `client/src/App.tsx` — the shell. **Today:** holds `doc`/`currentPage`/`zoomPercent` React state + the `readerRef` imperative zoom handle; renders the top-bar (filename, page status, `ZoomControl`, ToC/Bank placeholder pills) and `<main>` with `<Reader>` + a **placeholder** `<aside className="tool-rail" data-testid="tool-rail">` (lines 91-93). **Change:** add `mode`/`railCollapsed` state + `V`/`Esc`/`[` keydown; replace the placeholder aside with `<ToolRail>`; pass `panArmed={mode === "hand"}` to `Reader`. [client/src/App.tsx:17-98]
- `client/src/ToolRail.tsx` — **NEW.** Mirrors `ZoomControl.tsx` (presentational top-level chrome). Cursor button + cursor/hand/box-select flyout + collapse.
- `client/src/Reader.tsx` — owns `.pdf-canvas` (the scroll container, `scrollRef`), `handleKeyDown` (PgUp/PgDn + Ctrl-arrows), the zoom wheel/key/imperative effects, and `usePageViewport`. **Change:** accept `panArmed`; add `spaceHeld` state + Space keydown/up; add pointer-drag pan handlers + `data-pan` cursor state on the `.pdf-canvas` div (line 320-328). Nothing else moves. [client/src/Reader.tsx:320-348 return; handleKeyDown 295-318]
- `client/src/render/index.ts` — DOM-free pure helpers + `renderPage`. **Change:** add `panScroll` next to `focalScroll` (line ~122). Nothing else. [client/src/render/index.ts]
- `client/src/App.css` — has `.top-bar`, `.zoom-control`, `.stage`, and the collapsed `.tool-rail` overlay block (line 104-117). **Change:** extend with `.tool-button`/`.tool-button--armed`/`.tool-flyout`/collapsed-variant + the `.pdf-canvas[data-pan]` cursor rules. Tokens only. [client/src/App.css:104-117]
- `client/src/theme/components.css` — hand-authored dims; has `--tool-rail-*`. **Change:** add `--tool-button-*` / `--tool-flyout-*` dims per DESIGN.md. [client/src/theme/components.css:40-43]

### Testing standards

- Vitest + jsdom (`npm test`), typecheck `npm run typecheck`. New presentational components get a `*.test.tsx` next to them (mirror `ZoomControl.test.tsx`); DOM-free helpers get a unit test in `render/` (mirror `nav.test.ts`/`zoom.test.ts` — `panScroll` joins them). [Source: CLAUDE.md commands; client/src/*.test.tsx]
- **jsdom can't prove the pan itself** (no layout → `scrollLeft`/`scrollTop` don't move). Automated coverage = `panScroll` math + the rail interactions + the gesture *wiring* (Space `preventDefault`, `data-pan` cursor state on pointerdown/up). The **moving-page proof is the Task-6 live smoke** — do not claim AC-2 without it. [Source: existing Reader.test.tsx uses fireEvent + mocked render]
- `no-raw-values.test.ts` (no hex/px outside `theme/**`) and `focus-ring.test.ts` must stay green — the new rail buttons must show the standard focus ring. [Source: client/src/no-raw-values.test.ts; client/src/focus-ring.test.ts]

### Previous-story intelligence (1.7 windowing, 1.5 zoom, 1.1 shell)

- **1.7 unified the observer — pan rides on it for free.** `usePageViewport` is the single `IntersectionObserver`; it recomputes page-in-view + the live paint window on observer fires, not a scroll listener. Panning (which changes `scrollTop`) is picked up automatically; add no scroll listener. Don't disturb the hook or `PageCard`'s `live`/release path. [Source: 1-7-render-perf-windowing.md; client/src/render/usePageViewport.ts]
- **1.5 set the document-level keyboard precedent.** Zoom keys are bound at `document` (guarded `phase === "ready"`, Ctrl-only) so they fire regardless of focus. Mirror that pattern for `V`/`Esc`/`[` (App) and `Space` (Reader). The Reader already shows the `{ passive: false }` + `preventDefault` discipline for wheel — reuse it for the Space scroll-suppress. [Source: client/src/Reader.tsx zoom-key + wheel effects; 1-5-zoom.md]
- **1.1 left the rail placeholder + `mode`-less shell.** The `.tool-rail` aside and its tokens already exist (collapsed). This story is the first to give the rail behavior; keep the existing `data-testid="tool-rail"` so no earlier test breaks. App's "lightweight React state" note is the standing guidance against premature Zustand. [Source: client/src/App.tsx:91-93; client/src/App.css:104-117; client/src/theme/components.css:40-43]

### Git intelligence

Epic-1 render path is complete through 1.7 (PR #7 `6d851a7`, current HEAD/baseline): render + text (1.3), scroll/nav (1.4), zoom (1.5), decoders (1.6), windowing (1.7). This story is the first **interaction/tool** layer on top — it touches `App` (shell), a new `ToolRail`, `Reader` (pointer/Space on the existing scroll container), and one pure render helper. It changes no prior commit's render algorithm. [Source: `git log` 6d851a7]

### Project Structure Notes

- `ToolRail.tsx` at `client/src/` root mirrors `ZoomControl.tsx`/`Toast.tsx`/`EmptyDropzone.tsx` (top-level chrome components), keeping it out of the `render/`→`anchor/`→`annotations/` layer dirs (the full tool *system* moves into `annotations/` in Epic 2; a single chrome rail driven by App state is fine at root for now). [Source: client/src tree; ARCHITECTURE-SPINE.md source-tree]
- `panScroll` belongs in `render/index.ts` with the other interaction helpers; pan is viewport math, owned by the render layer. No conflict with the layered dependency rule. [Source: ARCHITECTURE-SPINE.md line 27 layered client]
- `ToolMode` is shared by `App`/`Reader`/`ToolRail`; export it from `ToolRail.tsx` (or a tiny shared types spot) so there is one definition. No new module layer needed.

### References

- [Source: .bmad/planning-artifacts/epics.md#Story-1.8 (lines 327-345)] — story statement + 3 ACs (cursor/hand flyout, drag-pan-no-reflow, return-to-cursor).
- [Source: .bmad/planning-artifacts/epics.md FR-6 (32/117), NFR-1 (64), NFR-2 (65), UX-DR4 (94), UX-DR14 (104), UX-DR15 (105)] — referenced requirements + the rail/keyboard specs.
- [Source: .bmad/planning-artifacts/prds/prd-paper-mate-2026-06-28/prd.md FR-6 (45), NFR-2 (80)] — hand-tool pan + smoothness.
- [Source: .bmad/planning-artifacts/architecture/.../ARCHITECTURE-SPINE.md capability map (190 = pan in render/), AD-9 (105-106), source-tree (172)] — pan-in-render, boundary, tool-system home.
- [Source: DESIGN.md lines 164-186, 441-447] — `tool-rail` / `tool-button` / `tool-button-armed` / `tool-flyout` token + component specs.
- [Source: client/src/App.tsx:14-15,91-93] — the lightweight-state note + the placeholder aside to replace.
- [Source: client/src/ZoomControl.tsx] — the presentational chrome-component pattern to mirror.
- [Source: client/src/Reader.tsx:295-348] — `handleKeyDown` + the `.pdf-canvas` return where Space/pointer pan wires in.
- [Source: client/src/render/index.ts:122] — `focalScroll`, the neighbor for `panScroll`.
- [Source: client/src/theme/components.css:40-43; client/src/App.css:104-117] — the token + CSS homes to extend.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (BMad dev-story workflow)

### Debug Log References

- Live browser smoke (Vite dev `:5173`, sample `09-regularization.pdf`, zoomed to 250% so both axes overflow):
  - AC-1: cursor button opens flyout (cursor/hand/box-select); picking **hand** → rail button `tool-button--armed`, canvas `data-pan=""` (grab), flyout closes.
  - AC-2: pointer-drag panned `scrollTop +150 / scrollLeft +64` (the +64 is the horizontal max clamp from a +90 request — `panScroll` correct); `data-pan="grabbing"` + `cursor: grabbing` mid-drag; `scrollHeight`, `scrollWidth`, and the page-card width/height all UNCHANGED across the drag (NFR-1). Hand and Space paths both verified.
  - AC-3: hold-`Space` armed grab + `defaultPrevented` (page-scroll suppressed) and panned; release → back to cursor (`data-pan` cleared, `cursor: auto`). `V` and `Esc` un-arm to cursor.
  - AC-4: `[` collapses the rail (cursor button gone, "Expand tools" affordance present, rail still mounted as overlay) and re-expands; canvas geometry untouched.
- Fixed during smoke: `setPointerCapture` was called before recording the drag origin; on a pointer the UA can refuse capture and abort the handler. Reordered to record origin + arm the drag first, then capture in a `try/catch` (capture is a best-effort enhancement). Real trusted events were fine, but the reorder makes the gesture robust and removed the flakiness.

### Completion Notes List

- Stood up the first real `ToolRail` (cursor button + cursor/hand/box-select flyout + `[` collapse), replacing the Story 1.1 placeholder `<aside>`. Presentational, mirrors `ZoomControl`; `ToolMode` is exported from `ToolRail.tsx` as the single shared definition.
- App owns lightweight `mode`/`railCollapsed` React state (NO Zustand — matches the `App.tsx` note; the tool system formalizes in Epic 2) + the document-level `V`/`Esc`/`[` key map (guarded to when a doc is open, Ctrl/Alt/Meta + editable targets ignored). `Space` is deliberately handled inside `Reader`, not `App`.
- `Reader` gained `panArmed`, internal `spaceHeld`, `canPan = panArmed || spaceHeld`, hold-`Space` temp-pan (keydown/up on the focused `.pdf-canvas`, ignores `e.repeat`), and pointer-drag pan via the pure `panScroll` helper — moving ONLY `scrollLeft`/`scrollTop`, never scale/card geometry/page box (NFR-1) and no anchor math (AR-9). `data-pan` drives the grab→grabbing cursor + `user-select: none`.
- `panScroll(startScroll, pointerDelta) = startScroll - pointerDelta` added next to `focalScroll` in `render/index.ts` (DOM-free, unit-tested).
- Tokens: added `--tool-button-size`, `--tool-flyout-offset`, `--tool-rail-gap` to `components.css`; rail/button/flyout + `.pdf-canvas[data-pan]` cursor CSS in `App.css` (tokens only). `no-raw-values` + `focus-ring` stay green.
- Tests: `101 passed` (added `render/pan.test.ts`, `ToolRail.test.tsx`, and Reader/App cases for Space + pointer wiring + key map + tooltips + the two review fixes); `npm run typecheck` clean; `npm run build` succeeds. No backend / OpenAPI / `docs/API.md` change.

### Review Follow-ups (post-codex `bmad-code-review`, 2026-06-28)

Ran the project `bmad-code-review` skill via `codex exec` (different model). Verdict CHANGES-REQUESTED, 2 findings — both addressed + live-verified:

- ✅ Resolved review finding [High]: Space released mid-drag (cursor armed) kept panning — `handlePointerMove` ignored `canPan` and `dragOrigin` stayed set. Now `handlePointerMove` re-checks `canPan`, and a `canPan`-false effect tears down the active drag (releases captured pointer via the new `dragPointerId` ref). With the hand armed the drag continues (canPan stays true). [client/src/Reader.tsx]
- ✅ Resolved review finding [Medium]: hold-`Space` only armed when `.pdf-canvas` had focus. Moved Space keydown/keyup to a document-level effect (gated `phase === "ready"`, mirrors the zoom-key effect), exempting editable fields + buttons so focused controls keep their Space-activate. [client/src/Reader.tsx]
- Feature (user request): hover tooltips (native `title`) on every rail/flyout/collapse button, and replaced the line glyphs with emoji icons (🖱️ cursor, ✋ hand, 🔲 box-select). [client/src/ToolRail.tsx]
- Live re-verified: doc-level Space arms with focus off-canvas; Space-release mid-drag stops the pan (further pointer-move = 0 movement); hand-armed drag survives Space release; emoji + tooltips render.

### File List

- client/src/ToolRail.tsx (new)
- client/src/ToolRail.test.tsx (new)
- client/src/render/pan.test.ts (new)
- client/src/render/index.ts (added `panScroll`)
- client/src/App.tsx (tool `mode`/`railCollapsed` state, `V`/`Esc`/`[` keys, `ToolRail`, `panArmed` to Reader)
- client/src/App.test.tsx (render mock `panScroll`; tool-rail + key tests)
- client/src/Reader.tsx (`panArmed` prop, `spaceHeld`, hold-`Space` + pointer-drag pan, `data-pan`)
- client/src/Reader.test.tsx (render mock `panScroll`; Space + pointer-drag wiring tests)
- client/src/theme/components.css (tool-button / tool-flyout / rail-gap dims)
- client/src/App.css (rail buttons + flyout + `.pdf-canvas[data-pan]` cursor CSS)
- .bmad/implementation-artifacts/sprint-status.yaml (1-8 → in-progress → review)

## Change Log

| Date | Change |
|------|--------|
| 2026-06-28 | Created Story 1.8 (pan / hand tool): first tool-rail (cursor button + cursor/hand/box-select flyout + `[` collapse), App-level tool `mode`/`V`/`Esc` keys, Reader hold-`Space` + pointer-drag pan via `panScroll`, no-reflow scroll-offset only. Status → ready-for-dev. |
| 2026-06-28 | Implemented Story 1.8: `ToolRail` + `ToolMode`, App tool-mode/`V`/`Esc`/`[` keys, Reader hold-`Space` + pointer-drag pan, pure `panScroll`, tool tokens + CSS. All 4 ACs verified via unit tests (97 passing) + live browser smoke (real scroll-offset pan, no reflow). Status → review. |
| 2026-06-28 | Addressed codex `bmad-code-review` findings (2 resolved: High Space-release-mid-drag stops pan; Medium document-level hold-Space) + added hover tooltips and emoji tool icons (user request). Tests now 101 passing; typecheck/build clean; fixes live-verified. |
