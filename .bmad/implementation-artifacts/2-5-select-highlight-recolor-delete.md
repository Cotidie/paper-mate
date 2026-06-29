---
baseline_commit: 01c77f6f478aaeaec3e6505cc700c477b1cc7281
---

# Story 2.5: Select a highlight (click-select, recolor, delete)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a reader,
I want to click a highlight to select it and then recolor or delete it,
so that I can fix or remove marks without re-creating them.

> **This builds the selection seam (AD-12), not the heavy editor.** It adds the FIRST way to act on an *existing* mark: a single nullable `selectedId` in the store, pointer-interactive marks (hover outline + pointer cursor + click-select, hit-tested by the rendered anchor rect), the selected/hover affordances in `annotations/`, and a lightweight recolor (reuse 2.3) + delete. Drag-handle move/resize and text re-edit stay in Story 3.1; persistence + undo stay in Epic 3. Client-only, no anchor/contract change beyond `selectedId` + a client delete action. [AD-12, AD-9]
>
> **Why now (sequencing):** cross-mode click-select depends on the single `activeTool` model that Story 2.4 just landed (on an active annotation tool, pointerdown-on-a-mark must SELECT, pointerdown-on-empty must CREATE — that disambiguation only works with one tool model). Epic 3's Stories 3.1 (edit) and 3.3 (delete) assume a "selected annotation" exists but nothing builds the hit-test + selected-state seam; this story builds it so they extend it instead of inventing it.

## Scope boundary — READ FIRST

**IN (this story):**
- **A single `selectedId: string | null` in the Zustand `store/`** as the one source of truth for selection (AD-12), plus `select(id)` / `clearSelection()` actions and a `deleteAnnotation(id)` action that removes the mark AND its `group_id` siblings (two-page highlights delete together, AR-4).
- **Interactive marks for hover + select (the reviewed Kami behavior).** A highlight mark becomes pointer-interactive (`pointer-events: auto`, `cursor: pointer`): hovering it shows a hover outline around the WHOLE annotation and the cursor is the pointer/default cursor — NOT the text I-beam — so the user cannot start a new highlight over an existing one; clicking it selects it. The mark elements are positioned by the anchor service's `denormalizeRect` (AD-4), so the click surface IS the page-normalized anchor rect (satisfies AD-12's "hit-test via the anchor service" without a separate geometry pass; recent-wins = topmost in DOM, marks rendered in `created_at` order). [Decision A — revised after the 2-5 design review]
- **Hover + selected affordances in `annotations/AnnotationLayer.tsx`**: a transient hover outline on the hovered annotation (whole-annotation, via a per-layer `hoveredId`) and a persistent selected ring on the `selectedId` mark (subscribe to the store). `render/` never knows about hover/selection (AD-9).
- **Selection wired in `annotations/`** (cursor mode AND while an annotation tool is active): clicking a mark sets `selectedId` and opens a selection quick-box; clicking empty space (a pointerdown that hits no mark) or `Esc` clears selection. On an active annotation tool, a pointerdown on a mark selects it and does NOT create; a pointerdown on empty text falls through to the existing 2.3 create path (AD-11/AD-12).
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

1. **Single selection via `selectedId`, resolved against the anchor rects (AD-12, AD-4).** Given a rendered highlight, when the user single-clicks it in cursor mode OR while a highlight tool is active, it becomes the selected annotation — exactly one nullable `selectedId` in the store is the source of truth. The click resolves to a mark via the rendered, anchor-positioned mark elements (`denormalizeRect`, AD-4); on overlapping marks the topmost (recent-wins, latest `created_at`, last in DOM) wins. Clicking empty space or pressing `Esc` clears the selection. No second selection field exists anywhere. [Source: ARCHITECTURE-SPINE.md#AD-12; epics.md#Story-2.5 AC1; sprint-change-proposal-2026-06-29-select-highlight.md §4]

2. **Hover affordance + cursor (the reviewed Kami behavior).** Given a rendered highlight, when the pointer is over it, the mark shows a hover outline around the whole annotation and the cursor is the pointer/default cursor, NOT the text I-beam — signaling "select this mark," and making it impossible to start a new highlight (a text drag) over an already-highlighted region (the mark intercepts the pointer). Moving off the mark restores the normal text cursor and selectable text layer. Hover state is transient and does NOT persist as selection. [Source: review 2026-06-29 (Kami reference); EXPERIENCE.md IP-6; ARCHITECTURE-SPINE.md#AD-12]

3. **Selected mark shows a ring; the selection quick-box offers recolor + delete (AD-12).** Given a selected highlight, `AnnotationLayer` renders a visible selected ring on it (token-styled, no raw hex/px), and a selection quick-box opens showing `ColorSwatchRow` (value = the mark's current `style.color`) plus a Delete affordance. Picking a swatch recolors the mark through `store.recolorAnnotation` (reused from 2.3) and the mark repaints; the Delete affordance removes it. The quick-box reuses the 2.2/2.3 `.quick-box` shell + `clampToViewport` and is dismissed on outside-click/`Esc`/scroll. [Source: epics.md#Story-2.5 AC2; ARCHITECTURE-SPINE.md#AD-12; 2-3 (ColorSwatchRow + recolorAnnotation)]

4. **`Del`/`Backspace` deletes; group siblings go too (IP-8, AR-4).** Given a selected highlight, when the user presses `Del` or `Backspace` (or clicks Delete), the mark is removed by `id` AND every annotation sharing its `group_id` is removed (a two-page highlight deletes both pages); `selectedId` clears. The key handler is document-level, phase-gated, and exempts `INPUT`/`TEXTAREA`/`SELECT`/`BUTTON`/`contentEditable` + Ctrl/Alt/Meta chords (same convention as the tool keys). This delete path is the seed Story 3.3 reuses — no command stack / undo yet. [Source: epics.md#Story-2.5 AC3; ARCHITECTURE-SPINE.md#AD-4 (group_id); CLAUDE.md#Engineering-principles (document-level handlers); UX-DR15 (Del/Backspace)]

5. **Select-vs-create disambiguation on an active tool (AD-11/AD-12).** Given an active annotation tool, a pointerdown on an existing mark SELECTS it (and does not start a create — the interactive mark intercepts the pointer, so no text selection begins over it); a pointerdown on empty content falls through to the existing 2.3 create-on-release path. The existing highlight create-on-release, swatch recolor, sticky-after-mark, and the disarm-while-pending `removeAllRanges()` re-pop fix all still work unchanged. [Source: epics.md#Story-2.5 AC4; ARCHITECTURE-SPINE.md#AD-11; 2-3/2-4 behavior]

6. **Client-side only; layering + contract preserved (AD-9, AD-3).** Given the selection + delete, they live in `store/` (`selectedId` + delete action) and `annotations/` (interactive marks + affordances + quick-box) only; anchor rect math (`denormalizeRect`) is reused, not extended. No persistence, no undo, no API/Pydantic/generated-type change → `server/openapi.json` + `client/src/api/schema.d.ts` stay byte-identical; `no-raw-values.test.ts` stays green; no new `render/index.ts` export so both `vi.mock("./render")` barrels stay untouched (AP-2). Highlight create (2.3), pan (2.4), and zoom-glue (NFR-3) do not regress. [Source: ARCHITECTURE-SPINE.md#AD-9, #AD-3; epics.md#Story-2.5 AC5; CLAUDE.md#Engineering-principles]

## Tasks / Subtasks

- [x] **Task 1 — Hit surface = the rendered anchor rects (no new `anchor/` math) (AC: 1, 2, 5)**
  - [x] No new geometry helper. The hit-test is the DOM: `AnnotationLayer` already positions each mark rect with `denormalizeRect` (AD-4), so the rendered mark element IS the page-normalized anchor rect at the current scale. Making it pointer-interactive (Task 3) lets the browser resolve hover/click to the topmost rect — that satisfies AD-12's "hit-test via the anchor service" because the rect geometry still comes only from `anchor/` (AD-9). [Decision A — revised; see Dev Notes]
  - [x] Recent-wins: render marks sorted by `created_at` ascending so the newest paints last (on top) and receives the pointer on overlap — matching the existing opacity-group "last/topmost wins on shared text" comment. (Today `AnnotationLayer` iterates the Map in insertion order; add the sort.)
  - [x] `anchor/` is otherwise UNCHANGED this story — confirm no edits to `index.ts` beyond (none expected). Layer rule preserved (AD-9).

- [x] **Task 2 — Selection + delete state in `store/` (AC: 1, 2, 3, 5)**
  - [x] In `client/src/store/index.ts`, add to `AnnotationStore`: `selectedId: string | null` (init `null`), `select(id: string | null): void`, `clearSelection(): void` (or fold into `select(null)`), and `deleteAnnotation(id: string): void`.
  - [x] `deleteAnnotation(id)`: look up the mark; gather every annotation sharing a non-null `group_id` with it (plus the mark itself); remove them all from the map (new Map each mutation for Zustand). If the deleted set includes `selectedId`, clear `selectedId`. (Group logic lives in the store because it owns the map — keep callers from re-deriving siblings.)
  - [x] Keep the store dependency-clean (AD-9): it still imports `api/` types only. `recolorAnnotation` is REUSED as-is for the selected-mark recolor (no change). Do NOT add persistence/command-stack here.
  - [x] Store unit tests (`store/store.test.ts` or wherever the store tests live): select/clear sets `selectedId`; `deleteAnnotation` removes the mark; a grouped two-page mark deletes both ids together; deleting the selected mark clears `selectedId`.

- [x] **Task 3 — Interactive marks: hover outline + cursor + selected ring in `AnnotationLayer` (AC: 1, 2, 3, 5)**
  - [x] In `client/src/annotations/AnnotationLayer.tsx`, make the highlight marks pointer-interactive: render each annotation's rects so they receive pointer events (`pointer-events: auto`, `cursor: pointer`). The mark click is the hit-test (Decision A). Keep the `.annotation-layer`/`.annotation-highlights` group otherwise as-is; only the mark rects opt back into pointer events.
  - [x] **Hover outline (whole annotation):** keep a per-layer `hoveredId` state; set it on a mark's `onPointerEnter` (to that annotation's `id`) and clear on `onPointerLeave`. Render a hover-outline class on ALL rects whose annotation `id === hoveredId` (so a multi-line mark outlines as one annotation, matching the Kami reference). Transient only — never writes `selectedId`.
  - [x] **Selected ring (persistent):** subscribe to `selectedId` (`useAnnotationStore((s) => s.selectedId)`); add a selected class to all rects of the `selectedId` annotation. Selected ring is visually stronger than hover outline.
  - [x] **Cursor:** with `cursor: pointer` on the mark, hovering a highlight shows the pointer (not the text I-beam), so the user cannot start a new text-drag highlight over an existing mark (AC2) — the mark intercepts the pointerdown.
  - [x] **Recent-wins ordering:** render marks sorted by `created_at` ascending so the newest paints last (on top) and wins hover/click on overlap (Task 1).
  - [x] **Click → select:** on a mark's `onClick` (or pointerdown), call `select(annotation.id)` and report the click position UP so the quick-box can anchor there. Since `AnnotationLayer` is per-card and currently presentational, pass a callback prop from the Reader/overlay (e.g. `onSelectMark(id, {x,y})`) OR read the select action from the store directly and let `AnnotationInteraction` own the quick-box off `selectedId` (preferred — keeps the layer thin). Choose the smaller wiring and record it.
  - [x] **CSS** in `client/src/annotations/Annotations.css`: add `.annotation-highlight` `pointer-events:auto; cursor:pointer;`, an `--hovered` outline class, and an `--selected` ring class — EXISTING theme tokens only (e.g. `outline: var(--hairline-width) solid var(--color-ink)`, radius/shadow tokens); NO raw hex/px (`no-raw-values.test.ts` applies; Annotations.css is not under `src/theme/**`). Both outlines must be visible against all 6 swatch colors and ride the denormalized rect so they stay glued across zoom (NFR-3).
  - [x] **Keep `aria-hidden`** on the layer? The marks are now interactive — give the clickable mark an accessible name (`aria-label="Highlight"`, `role="button"`) or keep selection keyboard-reachable another way; do not regress a11y. (Marks were decorative in 2.2/2.3; selecting makes them actionable.) Use your judgment; note the choice.

- [x] **Task 4 — Selection quick-box + keys in `AnnotationInteraction` (AC: 2, 3, 4)**
  - [x] In `client/src/annotations/AnnotationInteraction.tsx`, render a selection quick-box driven by the store's `selectedId` (NOT the transient create machine — Decision B). When `selectedId` is set, show `ColorSwatchRow` (value = the selected mark's `style.color`) + a Delete button (`data-testid="quick-box-delete"`, `aria-label="Delete"`, `title="Delete (Del)"`), positioned at the selected mark's first denormalized rect (or the recorded click point), nudged on-screen with `clampToViewport`. Reuse the `.quick-box` shell.
  - [x] Swatch pick → `recolorAnnotation([mark.id + its group siblings], token, now)`; match the 2.3 pick-is-dismiss feel (pick dismisses the quick-box; the mark stays selected/ringed). Delete button → `deleteAnnotation(selectedId)` (clears `selectedId`). Dismiss the quick-box on outside-click/`Esc`/scroll (reuse the existing dismiss wiring) → `clearSelection()`.
  - [x] **Disambiguate select vs create (AC4):** because the interactive mark (Task 3) intercepts a pointerdown that starts on it, the text layer never begins a selection over a mark → no create over an existing highlight, automatically. Empty-space pointerdown still reaches the text layer → the 2.3 create-on-release path runs unchanged. Verify the create machine (re-pop fix, sticky-after-mark) is untouched. A document-level pointerdown that hits NEITHER a mark NOR the quick-box clears the selection (clicking empty space deselects, AC1).
  - [x] **Keys (AC3):** add `Del`/`Backspace` → `deleteAnnotation(selectedId)` when selected; `Esc` → `clearSelection()` (the App-level `Esc`→cursor still runs; deselect + return-to-cursor is acceptable). Document-level, phase-gated, chord-skip + editable/buttons exempt.
  - [x] Confirm `Reader.tsx` needs only minimal change (if Task 3 lifts an `onSelectMark` callback, thread it through `AnnotationLayer`'s mount in `PageCard`; otherwise none). Prefer reading/writing the store directly to keep prop changes minimal.

- [x] **Task 5 — Tests + regression bar (AC: all)**
  - [x] Store selection/delete unit tests (Task 2). No new `anchor/` tests (anchor unchanged this story).
  - [x] `AnnotationLayer.test.tsx`: a mark fires `select(id)` (or the lifted callback) on click; `onPointerEnter`/`Leave` toggles the `--hovered` class on all rects of that annotation; the `selectedId` annotation's rects get the `--selected` class and non-selected do not; clearing `selectedId` removes the ring; marks render sorted by `created_at` (newest last/on top).
  - [x] `AnnotationInteraction.test.tsx`: with `selectedId` set, the selection quick-box renders (`ColorSwatchRow` + `quick-box-delete`); swatch recolors the mark (+ group siblings); Delete removes it; `Del`/`Backspace` deletes; `Esc`/outside-click clears selection; an empty-space drag still CREATES (the 2.3 path + re-pop fix + sticky-after-mark unbroken). Use the file's existing fake-card/stub-selection pattern (jsdom zeroes real rects).
  - [x] Full regression: `cd client && npm test` + `npm run typecheck`; `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q`. Contract byte-identical: `git diff --stat -- server/openapi.json client/src/api/schema.d.ts` empty. `no-raw-values.test.ts` green. Both `vi.mock("./render")` barrels untouched (no new render export).
  - [x] **Live smoke (the real verifier — Epic-1 retro; jsdom proves wiring, not gesture routing).** Host two-process flow + a real PDF at DPR>1: (a) hover an existing highlight → whole-annotation outline appears AND the cursor is the pointer, NOT the text I-beam; starting a drag on the highlight does NOT begin a new selection; (b) click a highlight in cursor mode → selected ring + quick-box with swatches + Delete; (c) recolor via a swatch → mark repaints; (d) `Del` → mark gone; (e) with the Highlight tool armed, click an existing mark → selects (does NOT create a new one), drag empty text → still creates; (f) two-page highlight, delete → both pages clear; (g) click empty space / `Esc` → deselects; (h) zoom in/out with a mark selected → ring + hover outline stay glued. Capture results in Completion Notes. [Reuse `fixtures/sample-pdfs/09-regularization.pdf`.]

- [x] **Task 6 — Docs (AC: 5)**
  - [x] No `/api` change → `docs/API.md` untouched.
  - [x] Update `client/src/annotations/README.md`: note the selection model (AD-12) — one `selectedId` in the store; marks are pointer-interactive (hover outlines the whole annotation, cursor is pointer not I-beam so you cannot start a new highlight over an existing one, click selects; recent-wins = newest on top); the selected ring + the selection quick-box (recolor reuses 2.3; delete removes id + group siblings; client-only, persistence/undo deferred to Epic 3).

## Dev Notes

### What this story adds vs reuses (the core of the story)

The hard parts already exist. This is a thin selection slice over them:

| Need | Already exists (REUSE) | New (this story) |
| --- | --- | --- |
| Normalized↔screen math | `anchor/` (`normalizeRect`/`denormalizeRect`/`pickPage`/`canonicalize`) | NONE — `anchor/` is unchanged; the rendered `denormalizeRect` mark elements are the hit surface |
| Annotation store | `store/` (`annotations` Map, `addAnnotation`, `recolorAnnotation`, `all`) | `selectedId` + `select`/`clearSelection` + `deleteAnnotation` (group-aware) |
| Mark VIEW | `AnnotationLayer` (denormalized per-page marks) | interactive marks (pointer-events + cursor), a per-layer `hoveredId` outline, a `--selected` ring, recent-wins sort |
| Quick-box shell | `.quick-box` CSS + `ColorSwatchRow` + `clampToViewport` + dismiss wiring in `AnnotationInteraction` | a selection quick-box render path keyed off `selectedId` (+ a Delete button) |
| Recolor | `store.recolorAnnotation` (built for 2.3 create-time recolor) | reused for the selected EXISTING mark (acceptable client-side; 3.1 later routes it through the command path) |
| Doc-level handlers | `AnnotationInteraction` pointerup/key/dismiss effects | a pointerdown hit-test + `Del`/`Backspace`/`Esc` selection keys |

Resist adding: a second selection field, drag handles, a command stack, any API call, or coordinate math outside `anchor/`.

### Decision A — interactive marks are the hit surface (revised after the 2-5 design review)

The review (Kami reference) requires hovering a highlight to show a whole-annotation outline AND change the cursor away from the text I-beam, so the user cannot start a new highlight over an existing one. That hover+cursor behavior is native to a pointer-interactive element, not a geometry pointermove hit-test. So the marks themselves become the hit surface: `AnnotationLayer` already positions each rect with the anchor service's `denormalizeRect` (AD-4), so the rendered mark element IS the page-normalized anchor rect — giving `pointer-events:auto` + `cursor:pointer` turns it into the hit target. Hover (`onPointerEnter/Leave` → `hoveredId`) outlines the whole annotation; click selects; recent-wins is the DOM stacking order (render marks sorted by `created_at`, newest on top). This satisfies AD-12 ("hit-test via the anchor service") because the rect geometry still comes only from `anchor/` (AD-9) — no separate geometry pass and no coordinate math added outside `anchor/`. *(Rejected: a pure `anchor/` `hitTestAnnotation` point→id helper driven by a document-level pointermove — it would re-derive the cursor/hover affordance by hand and fight the text layer's I-beam; the interactive mark gets both for free.)*

### Decision B — the selection quick-box is a SEPARATE path, not the create machine (PREP-3 boundary)

The 2.2/2.3 transient overlay machine (`machine.ts`: `empty/armed/annotating/pending`) is for the *create* gesture (drag-release → quick-box → commit/dismiss). Folding "an existing mark is selected" into it would re-entangle selection with the create lifecycle the 2.4 refactor just cleaned up. AD-12 says selection is plain store state, decoupled from the command stack. So: render the selection quick-box off the store's `selectedId` (with a recorded anchor point), independent of `machine.ts`. Reuse the `.quick-box` CSS, `ColorSwatchRow`, `clampToViewport`, and the same outside-click/`Esc`/scroll dismiss pattern — but as its own small effect/branch. This keeps the create machine untouched (re-verify the 2.3 re-pop fix still fires) and matches "selection decoupled from the Epic-3 command stack."

### Select-vs-create disambiguation (AC4 + AC2) — now automatic

With interactive marks (Decision A), a pointerdown that STARTS on a highlight is captured by the mark element, so the text layer never begins a selection there → no create over an existing mark, and the cursor is the pointer (not I-beam). A pointerdown on empty (non-highlighted) text reaches the text layer and the existing 2.3 create-on-release path runs unchanged. A mid-drag that started on empty text and crosses INTO a highlight keeps selecting (the browser already owns that drag), so create across a highlight still works. The only explicit wiring: a document-level pointerdown that hits neither a mark nor the quick-box clears `selectedId` (empty-space deselect). Do not rework the create path.

### What must NOT change (regression guardrails)

- **Highlight create-on-release + recolor (2.3), sticky-after-mark, two-page `group_id` split** — untouched. Don't touch `buildAnnotations`/`create.ts`.
- **The 2.3 re-pop fix** (`removeAllRanges()` on disarm-while-pending) and **scroll/outside/`Esc` dismiss** of the create quick-box — still fire.
- **The 2.4 single `activeTool` FSM** — selection is orthogonal store state; do NOT add tool state. Hover/click-select works in cursor mode and on an active annotation tool.
- **The text layer stays selectable over NON-highlighted text** (NFR-1) — only the highlight marks opt back into pointer events; the rest of the `.annotation-layer` sheet stays `pointer-events:none`. (Trade-off accepted per the review: you cannot text-select over an existing highlight — that region selects the mark, matching Kami.)
- **Pan (hand), hold-Space, zoom-glue (NFR-3)** — unaffected; the hover outline + selected ring ride the denormalized rect so they stay glued across zoom.
- **`AnnotationLayer` filters by `doc_id` + `page_index`** (2.2 finding) — keep it; selection scopes naturally because only this doc+page's marks render here.

### Integration points (read these; they are the seams)

- `client/src/anchor/index.ts` — `denormalizeRect` (95) positions the marks (the hit surface). UNCHANGED this story. [anchor/index.ts:95-105]
- `client/src/store/index.ts` — `AnnotationStore` + `addAnnotation`/`recolorAnnotation`/`all` (the whole file is 48 lines). ADD `selectedId` + `select`/`clearSelection`/`deleteAnnotation`. [store/index.ts:13-48]
- `client/src/annotations/AnnotationLayer.tsx` — per-page marks (render block ~51-62); subscribe to `selectedId`, add a per-layer `hoveredId`, make marks interactive (pointer-events + cursor + enter/leave + click), add `--hovered`/`--selected` classes, sort by `created_at`. [AnnotationLayer.tsx:31-66]
- `client/src/annotations/AnnotationInteraction.tsx` — the document-level pointerup/key/dismiss effects + the quick-box shell + `clampToViewport` + refs. ADD the selection quick-box path (off `selectedId`), the empty-space deselect, and the `Del`/`Backspace`/`Esc` keys. [AnnotationInteraction.tsx:43-257]
- `client/src/annotations/ColorSwatchRow.tsx` — reuse as-is (value + onPick). [ColorSwatchRow.tsx:30-60]
- `client/src/annotations/Annotations.css` — `.annotation-layer` (6, `pointer-events:none`), `.annotation-highlight` (24, currently `pointer-events:none`), `.quick-box` (35). Make `.annotation-highlight` interactive + ADD `--hovered`/`--selected` (tokens only). [Annotations.css:6-46]
- `client/src/Reader.tsx` — mounts `AnnotationInteraction` (563-571) + `AnnotationLayer` inside `PageCard` (736); `getPages` (513). Minimal/no change (only if a select callback is lifted). [Reader.tsx:513-571, 736]

### Design tokens / UI strings

- No new colors/tokens. The selected ring + hover outline use existing tokens (`--color-ink` + `--hairline-width`, or radius/shadow tokens); the selected ring is visually stronger than the hover outline. `cursor: pointer` on the mark. NO raw hex/px outside `src/theme/**` (`no-raw-values.test.ts`). [[no-emdash-user-facing]] — Delete button label/`aria-label`/`title` must avoid the em-dash (use plain words, e.g. "Delete (Del)").
- Delete affordance: a `quick-box__action`-styled button is fine; give it `data-testid="quick-box-delete"`, `aria-label="Delete"`, `title="Delete (Del)"`.

### Engineering conventions in force (CLAUDE.md#Engineering-principles)

- **Document-level handlers (AP-1):** the pointerdown hit-test + `Del`/`Backspace`/`Esc` keys bind on `document`, phase-gated, editable/buttons exempt — NOT on a card/canvas. Mirrors the existing `AnnotationInteraction` listeners.
- **Adopt stable primitives, don't reinvent (AP-4/PREP-1):** reuse `denormalizeRect`/`ColorSwatchRow`/`clampToViewport` + native pointer events for hover/click; no new coordinate math.
- **`render/` mock-barrel sync (AP-2):** no new `render/index.ts` export → both `vi.mock("./render")` barrels (`App.test.tsx`, `Reader.test.tsx`) stay untouched. Confirm.
- **HiDPI live smoke (memory):** verify hover outline + cursor + selection ring at DPR>1 on a real host — jsdom zeroes rects and DPR=1 localhost smoke misses rect/glyph mismatches. [[verify-on-hidpi-and-real-host]]
- **Cross-model code review (AP-3):** run `bmad-code-review` (Codex) after dev-story.

### Testing standards

- Frontend Vitest + jsdom: assert the MODEL and wiring (selectedId set/cleared, recolor writes through store, delete removes id+group, the `--hovered`/`--selected` classes, mark click → select, empty-space deselect) — NOT pixel geometry. jsdom zeroes `getClientRects`, so drive store actions directly and fire DOM events (`click`/`pointerEnter`/`pointerLeave`) on the rendered mark elements; reuse `AnnotationInteraction.test.tsx`'s fake-card/stub-selection pattern for the create-still-works assertions.
- Backend pytest: no model/contract change; run to confirm no regression.

### Project Structure Notes

- Edits: `store/index.ts` (+ tests), `annotations/AnnotationLayer.tsx` (+ test), `annotations/AnnotationInteraction.tsx` (+ tests), `annotations/Annotations.css`, `annotations/README.md`. `anchor/index.ts` UNCHANGED (its `denormalizeRect` is reused). No new top-level dirs; `ColorSwatchRow`/`create.ts`/`machine.ts` reused without change (machine untouched — Decision B). [Source: ARCHITECTURE-SPINE.md#Structural-Seed]
- Layer rule (AD-9): `render → anchor → annotations → store → api`. Selection state in `store/`; interactive marks + affordances + quick-box in `annotations/`; rect geometry stays in `anchor/` (unchanged); `render/` and the contract untouched.

### References

- [Source: ARCHITECTURE-SPINE.md#AD-12] — the selection model: one `selectedId` in the store, hit-test via anchor rects (recent-wins), cross-mode click-select driven by `activeTool`, decoupled from the Epic-3 command stack, affordance in `annotations/`, `render/` unaware.
- [Source: ARCHITECTURE-SPINE.md#AD-11] — the single `activeTool` model this builds on (select-vs-create fall-through).
- [Source: ARCHITECTURE-SPINE.md#AD-9] — layer/boundary invariants (coordinate math only in `anchor/`; client reaches backend only via the generated client).
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
- **Live smoke is the real verifier.** jsdom passed 2.4 while a real-DOM gesture bug existed. Hover (cursor not I-beam, whole-annotation outline), click-select on the right mark, recent-wins on overlap, and ring-glued-across-zoom MUST be smoke-tested on a real host at DPR>1 — jsdom zeroes rects.
- **`AnnotationLayer` filters by `doc_id`+`page_index`** (2.2) and marks paint in an opacity group where the last/topmost wins on shared text — the recent-wins click order must match that visual top (render marks sorted by `created_at`).
- **The 2.3 re-pop fix + sticky-after-mark** survived 2.4; they must survive 2.5 too (the new pointerdown handler must not break create-on-release).

## Git Intelligence

- Baseline: `45d41ff` (Chore: mark story 2-4 done; bump 0.1.1) on `main`; the `activeTool` FSM, `tools.ts`, the create machine, `ColorSwatchRow`, `store.recolorAnnotation`, and the `anchor/` service are all merged. This story adds the selection seam on top.
- Branch off `main` (never commit to `main` directly). Dev loop = host two-process flow (`uvicorn --reload` + `vite dev`).
- No contract change → keep `server/openapi.json` + `client/src/api/schema.d.ts` byte-identical (verify no diff after the suite).

## Project Context Reference

- Two processes, one container (AD-1/AD-10): `client/` (React 19.2 + Vite 8 + TS 6.0) + `server/` (FastAPI + Pydantic v2). Prod = single image, same-origin.
- Client layering (AD-9): `render → anchor → annotations → store → api`, strict downward. This story touches `store/` (`selectedId` + delete) and `annotations/` (interactive marks + affordances + quick-box); `anchor/`'s `denormalizeRect` is reused unchanged. NO `render/`/contract change.
- Selection model (AD-12) is the new cross-tool invariant established here; Epic 3 (3.1 edit, 3.3 delete-with-undo) extends it.
- No auth, localhost single-user. v1 scope = Phase 1.

## Story Completion Status

Ultimate context engine analysis completed - comprehensive developer guide created; revised after the 2-5 design review (Kami reference: hover affordance + cursor). Two internal design calls are pre-resolved with rationale (Decision A — REVISED: the highlight marks are pointer-interactive so hover shows a whole-annotation outline + pointer cursor and click selects; the rendered `denormalizeRect` rect IS the anchor hit surface, so `anchor/` is unchanged; Decision B: the selection quick-box is a separate render path off the store's `selectedId`, NOT folded into the 2.2/2.3 create machine). No user-blocking decisions. Success = hovering a highlight outlines it + shows the pointer (not I-beam) so no new highlight can start over it; clicking it selects (cursor mode AND while a highlight tool is active), shows a token-styled ring, recolors via the reused swatch row, deletes via Delete / `Del` / `Backspace` (with `group_id` siblings), clears on empty-click / `Esc`, stays client-only (no contract/anchor/persistence change), and the live smoke passes at DPR>1 without regressing create/pan/zoom.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Claude Code dev-story workflow).

### Debug Log References

- React enter/leave routing: native `pointerenter`/`pointerleave` dispatch does NOT trigger React's synthetic `onPointerEnter`/`onPointerLeave` (React derives them from `pointerover`/`pointerout`); the live smoke used `pointerover`/`pointerout`. jsdom tests use RTL `fireEvent.pointerEnter/Leave` (which works) — both pass.
- Live-smoke design fix (caught only by the real browser, jsdom missed it): zoom recenters fire a `scroll`, and my first cut had `scroll → clearSelection`, which lost the ring on zoom (failing smoke (h)). Corrected so `scroll` only CLOSES the floating quick-box while the selection (ring) stays glued via the denormalized rect. Also exempted buttons/chrome from empty-space-deselect so toolbar/zoom clicks keep the selection.

### Completion Notes List

Implemented the selection seam (AD-12) entirely client-side; no contract/anchor/persistence change.

- **Store (Task 2):** added `selectedId: string | null` + `select`/`clearSelection` + group-aware `deleteAnnotation` (removes id + non-null `group_id` siblings, AR-4; clears `selectedId` if it was in the removed set).
- **AnnotationLayer (Tasks 1+3):** marks are now the pointer-interactive hit surface (`pointer-events:auto; cursor:pointer`) — the rendered `denormalizeRect` rect IS the anchor hit surface, so `anchor/` is unchanged (Decision A). Per-layer transient `hoveredId` outlines the WHOLE hovered annotation; the `selectedId` mark gets a stronger `--selected` ring; marks render sorted by `created_at` ascending (recent-wins = newest on top). Layer stays `aria-hidden` (decorative; selection is a pointer affordance, Del/Esc work once selected) — keyboard-reachable selection deferred to the Epic-3 Annotation Bank (choice noted in code).
- **AnnotationInteraction (Task 4):** a SEPARATE selection quick-box off `selectedId` (Decision B, create machine untouched) — `ColorSwatchRow` armed to the mark's current color → `store.recolorAnnotation` (reused) + a Delete button (`data-testid="quick-box-delete"`, `aria-label`/`title` "Delete (Del)", no em-dash). Click a mark opens its box; pick recolors + closes the box (ring stays); `Del`/`Backspace` delete; `Esc` / empty-page pointerdown clear; scroll/zoom-recenter close the box but keep the ring glued. Document-level, phase-gated, editable/buttons/chrome exempt.
- **CSS:** `--hovered`/`--selected` outline classes use existing tokens only (`--hairline-width`/`--focus-ring-width` ink); `no-raw-values.test.ts` green.

**Regression bar:** client `npm test` 235 passed (23 files); `npm run typecheck` clean; server pytest 38 passed; `git diff --stat` on `server/openapi.json` + `client/src/api/schema.d.ts` empty (contract byte-identical); both `vi.mock("./render")` barrels untouched (no new render export).

**Live smoke (host two-process flow, real PDF `09-regularization.pdf`, Chrome at DPR 1.25):** (a) hover a highlight → whole-annotation outline (solid ink, all rects) + `cursor:pointer` (not the text I-beam); (b) click → `--selected` ring (1.6px ink, stronger than the 0.8px hover) + selection quick-box (6 swatches, armed = current color, Delete); (c) recolor (default→pink) → mark repaints, box dismisses on pick, ring stays; (d) `Del` → mark removed + selection cleared (note: with focus on a BUTTON the exempt rule correctly skips Del — works with focus off chrome); (h) keyboard zoom with a mark selected → ring stays glued (width scaled 193→241px, outline solid, color preserved), box closes on the recenter scroll. Select-vs-create on an active tool, two-page group delete, and empty-space/`Esc` deselect are covered by jsdom (real-DOM two-page selection not scripted in the smoke).

### File List

- client/src/store/index.ts (selectedId + select/clearSelection/deleteAnnotation)
- client/src/store/index.test.ts (selection + delete tests)
- client/src/annotations/AnnotationLayer.tsx (interactive marks, hoveredId, selected ring, recent-wins sort)
- client/src/annotations/AnnotationLayer.test.tsx (selection/hover/sort tests)
- client/src/annotations/AnnotationInteraction.tsx (selection quick-box, keys, deselect/scroll wiring)
- client/src/annotations/AnnotationInteraction.test.tsx (selection quick-box tests)
- client/src/annotations/Annotations.css (interactive mark + --hovered/--selected classes)
- client/src/annotations/README.md (selection model docs)
- .bmad/implementation-artifacts/2-5-select-highlight-recolor-delete.md (this story)
- .bmad/implementation-artifacts/sprint-status.yaml (status tracking)

### Code Review (cross-model: Codex gpt-5.5, read-only)

Ran the BMad code-review method via `codex exec`. No BLOCKERs. Resolved:

- ✅ **HIGH — cross-doc selection leak** (`AnnotationInteraction.tsx`): `selectedId` survives a doc switch (global store, not cleared until Epic 3), so a stale selection from doc A could render a box / be recolored/deleted from doc B. Fix: `selectedAnno` is now doc-scoped (`doc_id === docId`); delete/recolor use the scoped mark; added a clear-selection-on-`docId`-change effect. Tests added.
- ✅ **MEDIUM — Esc handled before the exempt/chord guard**: reordered so chords + editable/button targets are skipped before any key (incl. Esc), matching the document-level handler convention. Tests added (Esc-in-input, Ctrl+Del).
- ⏸️ **MEDIUM — a11y (interactive marks under `aria-hidden`)**: accepted/deferred. Selection is a pointer affordance with document-level Del/Esc; full keyboard-reachable selection lands with the Epic-3 Annotation Bank (noted in code).
- ⏸️ **LOW — selected ring dimmed by the 0.4 opacity group**: accepted. Live smoke confirmed the ring is visibly darker (1.6px ink) at DPR 1.25; a separate full-opacity overlay is a future polish if needed.

### Change Log

- 2026-06-29: Implemented Story 2.5 (select highlight: click-select + recolor + delete, AD-12). Selection seam added client-only — `selectedId` + group-aware delete in `store/`, pointer-interactive marks + hover/selected affordances + selection quick-box in `annotations/`; `anchor/` and the API contract unchanged. Status → review.
- 2026-06-29: Addressed code-review findings — doc-scoped selection (cross-doc leak fix) + key-handler exemption order; +4 tests. Client 239 pass, contract byte-identical.
- 2026-06-29: UI polish — selection quick-box centers the swatches, uses a Phosphor Trash icon for delete, and a hairline divider before it.
- 2026-06-29: Unified create→select (user request) — a highlight create-on-release (and the cursor-mode proof commit) now SELECTS the new mark and reuses the one selection quick-box (recolor + delete), removing the separate create swatch-only path (`createdIdsRef` + `recolor` callback + the `highlightMode` quick-box branch deleted). The `machine.ts` create FSM stays (cursor-mode proof box). Client 240 pass, typecheck clean; live-confirmed at DPR 1.25.
- 2026-06-29: **Two UI bug fixes + a refactor.** (1) Stray vertical strip in the left margin during a multi-line drag-select: pdf.js positions glyph `<span>`s `position:absolute` but leaves the per-line `<br>`s in normal flow at the text layer's top-left origin; a multi-line selection paints each br's selection as a caret sliver stacked top-left. Fix: `.pdf-canvas .textLayer br { user-select: none }` (Reader.css) — brs carry no glyphs, so copy is unaffected (lines join into a paragraph). (2) A two-page highlight only outlined/ringed ONE page on hover/select, because a group is two annotations in two per-page layers, hover was per-layer `useState`, and the ring matched a single id. Refactor: lifted hover into the store (`hoveredId`) and made hover+select GROUP-AWARE via one `inActiveGroup` predicate (matches by id OR shared non-null `group_id`) — fixes both, unifies the two affordances, deletes the per-layer hover state. Live-confirmed at DPR>1: no strip; cross-page hover lights 2 annotations, cross-page select rings 2. Client 244 pass.
- 2026-06-29: **Second cross-model review (Codex), all findings resolved.** (HIGH) `collectTextRects` no longer falls back to the whole-range rects when no text nodes are found — that fallback was exactly the cross-page leak; it now returns `[]` (a no-text selection makes no highlight, which is correct). The `rectsFromSelection` rect reader is now injectable (test seam) so the `AnnotationInteraction` flow tests drive it with real text nodes + an injected reader instead of a fake range. (MEDIUM) The selection quick-box now moves focus INTO itself on open and RESTORES focus on close (mirrors the create box). (LOW) Guard a selected text mark with an empty `rects` array (the generated type allows it) so it never crashes `denormalizeRect` — the box just doesn't open. +tests (focus in/out, empty-rects guard, no-text-node returns []). Client 246 pass, contract byte-identical; live-confirmed create→select still lands line-height marks with focus in the box.
- 2026-06-29: **Bug fix (cross-page highlight filled entire pages).** Root cause: `rectsFromSelection` measured the WHOLE selection range with `Range.getClientRects()`, which (per the DOM spec) also returns the border boxes of fully-enclosed elements; a cross-page selection encloses the intervening page block elements (canvas/page-surface/text layer) → their full-PAGE rects normalized to full-page highlights. Fix: new `anchor/collectTextRects` decomposes the range into per-text-node sub-ranges (text line boxes only, no element boxes); `rectsFromSelection` uses it. Added a jsdom regression (injected rect reader proves element boxes are excluded) + a CLAUDE.md engineering principle (selection→rects via text nodes; cross-page is the highest-risk path and MUST be live-smoked, jsdom can't see it). Live-confirmed at DPR 1.25: cross-page highlight now yields line-height rects (max 18px), zero full-page rects. Client 242 pass.
