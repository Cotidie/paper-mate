# Story 2.5: Select a highlight (click-select, recolor, delete)

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a reader,
I want to click a highlight to select it and then recolor or delete it,
so that I can fix or remove marks without re-creating them.

> **This builds the selection seam (AD-12), not the heavy editor.** It adds the FIRST way to act on an *existing* mark: a single nullable `selectedId` in the store, a pure hit-test in `anchor/`, a selected affordance in `annotations/`, and a lightweight recolor (reuse 2.3) + delete. Drag-handle move/resize and text re-edit stay in Story 3.1; persistence + undo stay in Epic 3. Client-only, no anchor/contract change beyond `selectedId` + a client delete action. [AD-12, AD-9]
>
> **Why now (sequencing):** cross-mode click-select depends on the single `activeTool` model that Story 2.4 just landed (on an active annotation tool, pointerdown-on-a-mark must SELECT, pointerdown-on-empty must CREATE — that disambiguation only works with one tool model). Epic 3's Stories 3.1 (edit) and 3.3 (delete) assume a "selected annotation" exists but nothing builds the hit-test + selected-state seam; this story builds it so they extend it instead of inventing it.

## Scope boundary — READ FIRST

**IN (this story):**
- **A single `selectedId: string | null` in the Zustand `store/`** as the one source of truth for selection (AD-12), plus `select(id)` / `clearSelection()` actions and a `deleteAnnotation(id)` action that removes the mark AND its `group_id` siblings (two-page highlights delete together, AR-4).
- **A pure hit-test in `anchor/`** (the only home of normalized↔screen math, AD-9): map a card-local point to the topmost annotation whose page-normalized rects contain it (recent-wins on overlap). DOM-free, unit-tested.
- **Click-select wired in `annotations/AnnotationInteraction.tsx`** at the document level (AP-1): a pointerdown hit-tests the point; a hit sets `selectedId` and opens a selection quick-box; an empty-space pointerdown (or `Esc`) clears selection. Works in cursor mode AND while an annotation tool is active; on an active tool, pointerdown-on-a-mark selects, pointerdown-on-empty falls through to the existing create path (AD-11/AD-12).
- **The selected affordance in `annotations/AnnotationLayer.tsx`**: the selected mark renders a visible ring (subscribe to `selectedId`); `render/` never knows about selection (AD-9).
- **A selection quick-box** (reuse the `.quick-box` shell + `ColorSwatchRow` + `clampToViewport`): for the selected mark, show the swatch row (value = the mark's current color) to recolor (reuse `store.recolorAnnotation`) **plus a Delete affordance**. This is a SEPARATE render path keyed off `selectedId` — it does NOT fold into the 2.2/2.3 transient create machine (Decision B).
- **Keyboard:** `Del`/`Backspace` deletes the selected mark (IP-8); `Esc` clears the selection. Document-level, phase-gated, editable/buttons exempt — same convention as the existing handlers.

**OUT (later stories — do NOT build):**
- **Drag-handle move / resize / text re-edit** → Story 3.1. No handles, no geometry mutation, no double-click-to-edit.
- **Command stack / undo / redo** → Stories 3.2/3.3. This delete is the client-side SEED 3.3 reuses; it does not route through a do/undo stack (there is none yet).
- **Persistence** → Epic 3. Nothing writes to disk / the API; `selectedId` and the delete are in-memory store state only.
- **Multi-select / marquee select** → not in scope. Single selection only (one `selectedId`).
- **Selecting non-highlight marks** — only `text`-kind (highlight) marks exist today; the hit-test naturally covers only what `AnnotationLayer` renders. Underline/pen/memo/comment arrive in 2.7–2.10; their selection comes for free once they render rects, but do NOT build them here.
- **Arm-time color pick** (swatch row on *arming* a tool) → Story 2.6. This story's swatch row is the post-select recolor only.
- Any **anchor-rect / store-schema / Pydantic / endpoint / generated-type change** beyond adding `selectedId` UI state + a client delete action. `render → anchor → annotations → store → api` layering preserved (AD-9); `server/openapi.json` + `client/src/api/schema.d.ts` stay byte-identical.

## Acceptance Criteria

1. **Single selection via `selectedId`, hit-tested through the anchor service (AD-12, AD-4).** Given a rendered highlight, when the user single-clicks it in cursor mode OR while a highlight tool is active, it becomes the selected annotation — exactly one nullable `selectedId` in the store is the source of truth. The hit-test maps the click to a mark by testing its page-normalized rects via a pure `anchor/` helper (AD-4); on overlapping marks the topmost (recent-wins, latest `created_at`) wins. Clicking empty space or pressing `Esc` clears the selection. No second selection field exists anywhere. [Source: ARCHITECTURE-SPINE.md#AD-12; epics.md#Story-2.5 AC1; sprint-change-proposal-2026-06-29-select-highlight.md §4]

2. **Selected mark shows a ring; the selection quick-box offers recolor + delete (AD-12).** Given a selected highlight, `AnnotationLayer` renders a visible selected ring on it (token-styled, no raw hex/px), and a selection quick-box opens showing `ColorSwatchRow` (value = the mark's current `style.color`) plus a Delete affordance. Picking a swatch recolors the mark through `store.recolorAnnotation` (reused from 2.3) and the mark repaints; the Delete affordance removes it. The quick-box reuses the 2.2/2.3 `.quick-box` shell + `clampToViewport` and is dismissed on outside-click/`Esc`/scroll. [Source: epics.md#Story-2.5 AC2; ARCHITECTURE-SPINE.md#AD-12; 2-3 (ColorSwatchRow + recolorAnnotation)]

3. **`Del`/`Backspace` deletes; group siblings go too (IP-8, AR-4).** Given a selected highlight, when the user presses `Del` or `Backspace` (or clicks Delete), the mark is removed by `id` AND every annotation sharing its `group_id` is removed (a two-page highlight deletes both pages); `selectedId` clears. The key handler is document-level, phase-gated, and exempts `INPUT`/`TEXTAREA`/`SELECT`/`BUTTON`/`contentEditable` + Ctrl/Alt/Meta chords (same convention as the tool keys). This delete path is the seed Story 3.3 reuses — no command stack / undo yet. [Source: epics.md#Story-2.5 AC3; ARCHITECTURE-SPINE.md#AD-4 (group_id); CLAUDE.md#Engineering-principles (document-level handlers); UX-DR15 (Del/Backspace)]

4. **Select-vs-create disambiguation on an active tool (AD-11/AD-12).** Given an active annotation tool, a pointerdown on an existing mark SELECTS it (and does not start a create); a pointerdown on empty content falls through to the existing 2.3 create-on-release path. The existing highlight create-on-release, swatch recolor, sticky-after-mark, and the disarm-while-pending `removeAllRanges()` re-pop fix all still work unchanged. [Source: epics.md#Story-2.5 AC4; ARCHITECTURE-SPINE.md#AD-11; 2-3/2-4 behavior]

5. **Client-side only; layering + contract preserved (AD-9, AD-3).** Given the selection + delete, they live in `store/` (`selectedId` + delete action) and `annotations/` (hit-test wiring + affordance + quick-box) only, with the pure hit-test math in `anchor/`. No persistence, no undo, no API/Pydantic/generated-type change → `server/openapi.json` + `client/src/api/schema.d.ts` stay byte-identical; `no-raw-values.test.ts` stays green; no new `render/index.ts` export so both `vi.mock("./render")` barrels stay untouched (AP-2). Highlight create (2.3), pan (2.4), and zoom-glue (NFR-3) do not regress. [Source: ARCHITECTURE-SPINE.md#AD-9, #AD-3; epics.md#Story-2.5 AC5; CLAUDE.md#Engineering-principles]

## Tasks / Subtasks

- [ ] **Task 1 — Add the pure hit-test to `anchor/` (AC: 1, 5)**
  - [ ] In `client/src/anchor/index.ts`, add a DOM-free helper that returns the topmost annotation id under a card-local point. Suggested shape:
    `hitTestAnnotation(point: { x: number; y: number }, candidates: { id: string; rects: Rect[]; created_at: string }[], box: PageBox, scale: number): string | null`.
    Normalize the point the same way `normalizeRect` normalizes a box (divide card-local px by `box * scale`), then return the `id` of the candidate whose any rect contains the normalized point; on multiple hits, the latest `created_at` wins (recent-wins, matching the paint order in `AnnotationLayer` where the last mark wins on shared text). Reuse `canonicalize`; do NOT re-flip y (AD-4 note in the file header).
  - [ ] Add a tiny pure point-in-rect predicate (normalized space) used by the helper; export it if useful for tests. Keep all of this in `anchor/` — no hit-test math anywhere else (AD-9).
  - [ ] For finding which card a screen point is over, REUSE `pickPage` with a degenerate (zero-size) `ClientBox` at the pointer (`{left:x,top:y,right:x,bottom:y}`) rather than adding a parallel point-in-card path.
  - [ ] Unit tests in `anchor/anchor.test.ts` (or the existing anchor test file): point inside a rect hits; outside misses; overlapping rects return the most-recent `created_at`; empty candidates → `null`; scale-invariance (same normalized hit at scale 1 and 2).

- [ ] **Task 2 — Selection + delete state in `store/` (AC: 1, 2, 3, 5)**
  - [ ] In `client/src/store/index.ts`, add to `AnnotationStore`: `selectedId: string | null` (init `null`), `select(id: string | null): void`, `clearSelection(): void` (or fold into `select(null)`), and `deleteAnnotation(id: string): void`.
  - [ ] `deleteAnnotation(id)`: look up the mark; gather every annotation sharing a non-null `group_id` with it (plus the mark itself); remove them all from the map (new Map each mutation for Zustand). If the deleted set includes `selectedId`, clear `selectedId`. (Group logic lives in the store because it owns the map — keep callers from re-deriving siblings.)
  - [ ] Keep the store dependency-clean (AD-9): it still imports `api/` types only. `recolorAnnotation` is REUSED as-is for the selected-mark recolor (no change). Do NOT add persistence/command-stack here.
  - [ ] Store unit tests (`store/store.test.ts` or wherever the store tests live): select/clear sets `selectedId`; `deleteAnnotation` removes the mark; a grouped two-page mark deletes both ids together; deleting the selected mark clears `selectedId`.

- [ ] **Task 3 — Selected affordance in `AnnotationLayer` (AC: 2, 5)**
  - [ ] In `client/src/annotations/AnnotationLayer.tsx`, subscribe to `selectedId` (`useAnnotationStore((s) => s.selectedId)`) and add a selected modifier class to the rendered mark when `a.id === selectedId` (e.g. `annotation-highlight--selected`). Keep the layer pointer-transparent and `aria-hidden` (selection is geometry-driven via the document-level hit-test, NOT by making marks clickable — preserves NFR-1 / the selectable text layer underneath).
  - [ ] Add `.annotation-highlight--selected` to `client/src/annotations/Annotations.css` using EXISTING theme tokens only (e.g. `outline: var(--hairline-width) solid var(--color-ink)` or a radius/shadow token) — NO raw hex/px (Annotations.css is not under `src/theme/**`, so `no-raw-values.test.ts` applies). Make the ring visible against all 6 swatch colors.
  - [ ] The selected ring must stay glued across zoom (it rides the same denormalized rect as the mark) — confirm in the live smoke (NFR-3).

- [ ] **Task 4 — Click-select + selection quick-box in `AnnotationInteraction` (AC: 1, 2, 3, 4)**
  - [ ] In `client/src/annotations/AnnotationInteraction.tsx`, add a document-level `pointerdown` handler (phase-gated by `enabled`, `isExempt` for editable/buttons) that: finds the card under the pointer (`pickPage` degenerate-rect), localizes the point to that card, reads this doc+page's marks from the store, and calls the `anchor/` hit-test. On a hit → `select(id)` and record the quick-box anchor point (the click position). On a miss → `clearSelection()` (clicking empty space deselects, AC1). Bind/cleanup like the existing listeners; read latest `scale`/`getPages` via the existing refs.
  - [ ] **Disambiguate select vs create (AC4):** the existing create path fires on `pointerup` from a non-collapsed text selection. A pointerdown that HITS a mark must select and must NOT also create on the following pointerup — guard the pointerup create when the gesture began as a select (e.g. a ref set on a hit pointerdown, cleared on the next gesture; if the pointer didn't move into a real selection, treat it as a click-select). Do NOT break: empty-space drag still creates (2.3), the re-pop fix, sticky-after-mark.
  - [ ] **Selection quick-box (Decision B — separate path):** render a quick-box driven by `selectedId` (NOT the transient create machine). When `selectedId` is set, show `ColorSwatchRow` (value = the selected mark's `style.color`) + a Delete button (`data-testid="quick-box-delete"`), positioned at the recorded click point (or the selected mark's first denormalized rect), nudged on-screen with `clampToViewport`. Swatch pick → `recolorAnnotation([...the mark + its group siblings], token, now)` then keep it selected (recolor does not deselect; or dismiss the box per the 2.3 pick-is-dismiss feel — match 2.3: pick dismisses the box but the mark stays selected/ringed). Delete button → `deleteAnnotation(selectedId)`. Dismiss on outside-click/`Esc`/scroll (reuse the existing dismiss wiring) → `clearSelection()`.
  - [ ] **Keys (AC3):** in the same component's document-level key handling, add `Del`/`Backspace` → `deleteAnnotation(selectedId)` when something is selected; `Esc` → `clearSelection()` (the App-level `Esc`→cursor still runs; deselect + return-to-cursor is acceptable and consistent). Keep chord-skip + editable/buttons exempt.
  - [ ] Confirm `Reader.tsx` needs no change: `AnnotationInteraction` already mounts with `getPages`/`scale`/`enabled`; selection reads the store directly. (If a value is genuinely needed, pass it as a prop in the existing shape — but prefer reading the store.)

- [ ] **Task 5 — Tests + regression bar (AC: all)**
  - [ ] `anchor` hit-test unit tests (Task 1). Store selection/delete unit tests (Task 2).
  - [ ] `AnnotationInteraction.test.tsx`: clicking a mark (drive the hit via the same fake-card + stubbed geometry pattern the file already uses; jsdom zeroes real rects, so feed the hit-test through mocked card boxes / a spied hit-test or fixed `getPages`) sets the selection quick-box; the swatch recolors the mark; Delete removes it; `Del`/`Backspace` deletes; `Esc`/outside-click clears; an empty-space drag still CREATES (2.3 path unbroken); selecting on an active tool does not double-create.
  - [ ] `AnnotationLayer.test.tsx`: the selected mark gets the `--selected` class; non-selected marks do not; clearing `selectedId` removes the ring.
  - [ ] Full regression: `cd client && npm test` + `npm run typecheck`; `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q`. Contract byte-identical: `git diff --stat -- server/openapi.json client/src/api/schema.d.ts` empty. `no-raw-values.test.ts` green. Both `vi.mock("./render")` barrels untouched (no new render export).
  - [ ] **Live smoke (the real verifier — Epic-1 retro; jsdom proves wiring, not gesture routing).** Host two-process flow + a real PDF at DPR>1: (a) create a highlight, click it in cursor mode → ring appears + quick-box with swatches + Delete; (b) recolor via a swatch → mark repaints; (c) `Del` → mark gone; (d) with the Highlight tool armed, click an existing mark → selects (does NOT create a new one), drag empty text → still creates; (e) make a two-page highlight, delete it → both pages clear; (f) click empty space / `Esc` → deselects; (g) zoom in/out with a mark selected → ring stays glued. Capture results in Completion Notes. [Reuse `fixtures/sample-pdfs/09-regularization.pdf`.]

- [ ] **Task 6 — Docs (AC: 5)**
  - [ ] No `/api` change → `docs/API.md` untouched.
  - [ ] Update `client/src/annotations/README.md`: note the selection model (AD-12) — one `selectedId` in the store, the `anchor/` hit-test (recent-wins), the selected affordance in `AnnotationLayer`, and the selection quick-box (recolor reuses 2.3; delete removes id + group siblings; client-only, persistence/undo deferred to Epic 3).

## Dev Notes

### What this story adds vs reuses (the core of the story)

The hard parts already exist. This is a thin selection slice over them:

| Need | Already exists (REUSE) | New (this story) |
| --- | --- | --- |
| Normalized↔screen math | `anchor/` (`normalizeRect`/`denormalizeRect`/`pickPage`/`canonicalize`) | a pure `hitTestAnnotation` point→id helper |
| Annotation store | `store/` (`annotations` Map, `addAnnotation`, `recolorAnnotation`, `all`) | `selectedId` + `select`/`clearSelection` + `deleteAnnotation` (group-aware) |
| Mark VIEW | `AnnotationLayer` (denormalized per-page marks) | a `--selected` ring class subscribed to `selectedId` |
| Quick-box shell | `.quick-box` CSS + `ColorSwatchRow` + `clampToViewport` + dismiss wiring in `AnnotationInteraction` | a selection quick-box render path keyed off `selectedId` (+ a Delete button) |
| Recolor | `store.recolorAnnotation` (built for 2.3 create-time recolor) | reused for the selected EXISTING mark (acceptable client-side; 3.1 later routes it through the command path) |
| Doc-level handlers | `AnnotationInteraction` pointerup/key/dismiss effects | a pointerdown hit-test + `Del`/`Backspace`/`Esc` selection keys |

Resist adding: a second selection field, drag handles, a command stack, any API call, or hit-test math outside `anchor/`.

### Decision A — hit-test lives in `anchor/` (AD-9, AD-12)

AD-12 says "hit-testing maps a pointer location to an annotation by testing its page-normalized rects via the anchor service (AD-4)". So the geometry (point→normalized→rect-contains, recent-wins) is a pure helper in `anchor/index.ts`, unit-tested DOM-free (jsdom zeroes real client rects, so the math must be testable with plain numbers — same discipline as `pickPage`/`normalizeRect`). `annotations/` calls it; it never computes coordinates itself (AD-9). The screen-point→card step reuses `pickPage` (degenerate rect) so there is one card-pick path.

### Decision B — the selection quick-box is a SEPARATE path, not the create machine (PREP-3 boundary)

The 2.2/2.3 transient overlay machine (`machine.ts`: `empty/armed/annotating/pending`) is for the *create* gesture (drag-release → quick-box → commit/dismiss). Folding "an existing mark is selected" into it would re-entangle selection with the create lifecycle the 2.4 refactor just cleaned up. AD-12 says selection is plain store state, decoupled from the command stack. So: render the selection quick-box off the store's `selectedId` (with a recorded anchor point), independent of `machine.ts`. Reuse the `.quick-box` CSS, `ColorSwatchRow`, `clampToViewport`, and the same outside-click/`Esc`/scroll dismiss pattern — but as its own small effect/branch. This keeps the create machine untouched (re-verify the 2.3 re-pop fix still fires) and matches "selection decoupled from the Epic-3 command stack."

### Select-vs-create disambiguation (AC4) — the one subtle bit

The create path is `pointerup` + a non-collapsed text selection (`rectsFromSelection`). Click-select is `pointerdown` + a hit-test. A plain click on a mark fires BOTH pointerdown (hit → select) and pointerup (but the selection is collapsed → `rectsFromSelection` returns `[]` → no create). So in the common case they already don't collide. The guard you must add: a pointerdown that HITS a mark should mark the gesture as "select" so that if the user happens to also have a stale text selection, the pointerup create is suppressed for that gesture. Empty-space pointerdown does nothing special → the existing create-on-release runs unchanged. Keep it minimal; do not rework the create path.

### What must NOT change (regression guardrails)

- **Highlight create-on-release + recolor (2.3), sticky-after-mark, two-page `group_id` split** — untouched. Don't touch `buildAnnotations`/`create.ts`.
- **The 2.3 re-pop fix** (`removeAllRanges()` on disarm-while-pending) and **scroll/outside/`Esc` dismiss** of the create quick-box — still fire.
- **The 2.4 single `activeTool` FSM** — selection is orthogonal store state; do NOT add tool state. Click-select works in cursor mode and on an active annotation tool, driven by `activeTool` only for the create-vs-select fall-through.
- **`AnnotationLayer` stays pointer-transparent + `aria-hidden`** (NFR-1; the text layer underneath stays selectable). Selection is geometry-driven, not DOM-click-driven.
- **Pan (hand), hold-Space, zoom-glue (NFR-3)** — unaffected.
- **`AnnotationLayer` filters by `doc_id` + `page_index`** (2.2 finding) — keep it; the hit-test must also scope to the doc+page under the pointer so one doc's marks never select on another.

### Integration points (read these; they are the seams)

- `client/src/anchor/index.ts` — `normalizeRect` (line 68), `denormalizeRect` (95), `pickPage` (152), `canonicalize` (54), `ClientBox`/`PageBox`/`PageCardRef` types. ADD `hitTestAnnotation` here. [anchor/index.ts:54-160]
- `client/src/store/index.ts` — `AnnotationStore` + `addAnnotation`/`recolorAnnotation`/`all` (the whole file is 48 lines). ADD `selectedId` + `select`/`clearSelection`/`deleteAnnotation`. [store/index.ts:13-48]
- `client/src/annotations/AnnotationLayer.tsx` — per-page marks; subscribe to `selectedId`, add the `--selected` class (line 51-62 render block). [AnnotationLayer.tsx:31-66]
- `client/src/annotations/AnnotationInteraction.tsx` — the document-level pointerup/key/dismiss effects + the quick-box shell + `clampToViewport` + refs (`scaleRef`/`getPagesRef`). ADD the pointerdown hit-test, the selection quick-box path, and the `Del`/`Backspace`/`Esc` keys. [AnnotationInteraction.tsx:43-257]
- `client/src/annotations/ColorSwatchRow.tsx` — reuse as-is (value + onPick). [ColorSwatchRow.tsx:30-60]
- `client/src/annotations/Annotations.css` — `.quick-box` (line 35), `.annotation-highlight` (24). ADD `.annotation-highlight--selected` (tokens only). [Annotations.css:24-46]
- `client/src/Reader.tsx` — mounts `AnnotationInteraction` (563-571) + `AnnotationLayer` inside `PageCard` (736); `getPages` (513). No logic change expected. [Reader.tsx:513-571, 736]

### Design tokens / UI strings

- No new colors/tokens. The selected ring uses an existing token (`--color-ink` + `--hairline-width`, or a radius/shadow token). NO raw hex/px outside `src/theme/**` (`no-raw-values.test.ts`). [[no-emdash-user-facing]] — Delete button label/`aria-label`/`title` must avoid the em-dash (use plain words, e.g. "Delete (Del)").
- Delete affordance: a `quick-box__action`-styled button is fine; give it `data-testid="quick-box-delete"`, `aria-label="Delete"`, `title="Delete (Del)"`.

### Engineering conventions in force (CLAUDE.md#Engineering-principles)

- **Document-level handlers (AP-1):** the pointerdown hit-test + `Del`/`Backspace`/`Esc` keys bind on `document`, phase-gated, editable/buttons exempt — NOT on a card/canvas. Mirrors the existing `AnnotationInteraction` listeners.
- **Adopt stable primitives, don't reinvent (AP-4/PREP-1):** reuse `pickPage`/`normalizeRect`/`ColorSwatchRow`/`clampToViewport`; the only new math is the point-in-rect + recent-wins selection in `anchor/`.
- **`render/` mock-barrel sync (AP-2):** no new `render/index.ts` export → both `vi.mock("./render")` barrels (`App.test.tsx`, `Reader.test.tsx`) stay untouched. Confirm.
- **HiDPI live smoke (memory):** verify selection hit-test + ring at DPR>1 on a real host — jsdom zeroes rects and DPR=1 localhost smoke misses rect/glyph mismatches. [[verify-on-hidpi-and-real-host]]
- **Cross-model code review (AP-3):** run `bmad-code-review` (Codex) after dev-story.

### Testing standards

- Frontend Vitest + jsdom: assert the MODEL and wiring (selectedId set/cleared, recolor writes through store, delete removes id+group, the `--selected` class, create-vs-select fall-through) — NOT pixel geometry. jsdom zeroes `getClientRects`, so drive the hit-test via plain-number unit tests in `anchor/` and via fixed `getPages`/stubbed geometry in the interaction tests, exactly as `AnnotationInteraction.test.tsx` already stubs selection.
- Backend pytest: no model/contract change; run to confirm no regression.

### Project Structure Notes

- Edits: `anchor/index.ts` (+ tests), `store/index.ts` (+ tests), `annotations/AnnotationLayer.tsx` (+ test), `annotations/AnnotationInteraction.tsx` (+ tests), `annotations/Annotations.css`, `annotations/README.md`. No new top-level dirs; `ColorSwatchRow`/`create.ts`/`machine.ts` reused without change (machine untouched — Decision B). [Source: ARCHITECTURE-SPINE.md#Structural-Seed]
- Layer rule (AD-9): `render → anchor → annotations → store → api`. Hit-test math in `anchor/`; selection state in `store/`; wiring + affordance in `annotations/`; `render/` and the contract untouched.

### References

- [Source: ARCHITECTURE-SPINE.md#AD-12] — the selection model: one `selectedId` in the store, hit-test via anchor rects (recent-wins), cross-mode click-select driven by `activeTool`, decoupled from the Epic-3 command stack, affordance in `annotations/`, `render/` unaware.
- [Source: ARCHITECTURE-SPINE.md#AD-11] — the single `activeTool` model this builds on (select-vs-create fall-through).
- [Source: ARCHITECTURE-SPINE.md#AD-9] — layer/boundary invariants (hit-test math only in `anchor/`; client reaches backend only via the generated client).
- [Source: ARCHITECTURE-SPINE.md#AD-4] — page-normalized anchor model + canonical rects (hit-test in normalized space, no y-flip).
- [Source: .bmad/planning-artifacts/sprint-change-proposal-2026-06-29-select-highlight.md] — the gap (highlights not selectable), the chosen slice (selection seam + lightweight recolor/delete in Epic 2; heavy edits in 3.1), AD-12 text.
- [Source: .bmad/planning-artifacts/epics.md#Story-2.5] — story statement + 5 ACs + scope guard.
- [Source: EXPERIENCE.md IP-6] — lightweight click-select + restyle/recolor + delete (2.5) split from heavy drag-handle move/resize + re-edit (3.1).
- [Source: .bmad/implementation-artifacts/2-4-unify-tool-state-fsm.md] — the `activeTool` FSM (done); the create machine + quick-box behaviors to preserve.
- [Source: .bmad/implementation-artifacts/2-3-highlight-text-via-drag.md] — `ColorSwatchRow`, `recolorAnnotation`, create-on-release, the re-pop fix to preserve.
- [Source: CLAUDE.md#Engineering-principles, #Design-conventions] — document-level handlers, adopt-stable, render-mock-barrel sync, token rules, no em-dash, test incantations.

## Previous Story Intelligence

From Story 2.4 (tool-state FSM, done) + its review + the Epic-1 retro:

- **One model, no parallel state.** 2.4 collapsed `mode`+`armedTool` into one `activeTool`; do NOT reintroduce a sibling for selection — selection is its own store field (`selectedId`), orthogonal to `activeTool`. The create-vs-select fall-through reads `activeTool` only to decide whether an empty-space gesture may create.
- **Codex review caught an asymmetry (the flyout stayed open on switch).** Lesson: think about the INVERSE path. For 2.5, the inverse paths are: clicking empty space must clear (not just clicking another mark); deleting the selected mark must clear `selectedId`; recolor must keep the ring consistent.
- **Live smoke is the real verifier.** jsdom passed 2.4 while a real-DOM gesture bug existed. Hit-test routing (click lands on the right mark, recent-wins on overlap, ring glued across zoom) MUST be smoke-tested on a real host at DPR>1 — jsdom zeroes rects.
- **`AnnotationLayer` filters by `doc_id`+`page_index`** (2.2) and marks paint in an opacity group where the last/topmost wins on shared text — the hit-test's "recent-wins" must match that visual top.
- **The 2.3 re-pop fix + sticky-after-mark** survived 2.4; they must survive 2.5 too (the new pointerdown handler must not break create-on-release).

## Git Intelligence

- Baseline: `45d41ff` (Chore: mark story 2-4 done; bump 0.1.1) on `main`; the `activeTool` FSM, `tools.ts`, the create machine, `ColorSwatchRow`, `store.recolorAnnotation`, and the `anchor/` service are all merged. This story adds the selection seam on top.
- Branch off `main` (never commit to `main` directly). Dev loop = host two-process flow (`uvicorn --reload` + `vite dev`).
- No contract change → keep `server/openapi.json` + `client/src/api/schema.d.ts` byte-identical (verify no diff after the suite).

## Project Context Reference

- Two processes, one container (AD-1/AD-10): `client/` (React 19.2 + Vite 8 + TS 6.0) + `server/` (FastAPI + Pydantic v2). Prod = single image, same-origin.
- Client layering (AD-9): `render → anchor → annotations → store → api`, strict downward. This story touches `anchor/` (hit-test math), `store/` (`selectedId` + delete), and `annotations/` (wiring + affordance + quick-box). NO `render/`/contract change.
- Selection model (AD-12) is the new cross-tool invariant established here; Epic 3 (3.1 edit, 3.3 delete-with-undo) extends it.
- No auth, localhost single-user. v1 scope = Phase 1.

## Story Completion Status

Ultimate context engine analysis completed - comprehensive developer guide created. Two internal design calls are pre-resolved with rationale (Decision A: the hit-test is a pure helper in `anchor/`; Decision B: the selection quick-box is a separate render path off the store's `selectedId`, NOT folded into the 2.2/2.3 create machine). No user-blocking decisions. Success = a highlight is click-selectable in cursor mode AND while a highlight tool is active, shows a token-styled ring, recolors via the reused swatch row, deletes via Delete / `Del` / `Backspace` (with `group_id` siblings), clears on empty-click / `Esc`, stays client-only (no contract/anchor/persistence change), and the live smoke passes at DPR>1 without regressing create/pan/zoom.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
