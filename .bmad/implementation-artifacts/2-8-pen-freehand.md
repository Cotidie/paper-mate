---
baseline_commit: a1887e070d90ed9e3fb370b6de50b7395b42cc54
---

# Story 2.8: Pen / freehand

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a reader,
I want to draw freehand on the page,
so that I can sketch marks beside the text.

> **This is the FIRST genuinely new machinery since the foundation, not a paint variant.** Highlight (2.3) and underline (2.7) are both `kind=text` marks built from a native browser text selection (`rectsFromSelection` → `buildAnnotations` → store), differing only in paint. Pen is the opposite axis: a `kind=path` mark built from a **freehand pointer drag** (NOT a text selection), the first tool to (a) capture its own pointer gesture instead of reading `window.getSelection()`, (b) store `points` instead of `rects`, (c) render an SVG stroke instead of CSS rect divs, and (d) carry `stroke_width` in `style`. The contract already anticipates ALL of this (`PathAnchor`, `Point`, `Style.stroke_width`, `type:"pen"` are already in the generated type + Pydantic model — see AC7), the anchor model is reused (normalized `[0,1]` fractions, scale-derived), and the rail/FSM/selection-seam patterns are reused. But the gesture-capture path, the point math, the perfect-freehand wrapper, and the SVG render branch are NEW and are where the real work (and the risk) is.

## The decisions that define this story (read before coding)

**1. Pen is a pointer GESTURE, not a selection.** The 2.3/2.7 create path keys off `window.getSelection()` in a document-level `pointerup`. Pen cannot: a freehand drag must NOT select text, and there is no text to select. So pen gets its OWN capture path — `pointerdown` (pen armed) starts a stroke, `pointermove` accumulates points, `pointerup` finalizes — mirroring how the Reader's PAN gesture works (origin in a ref, pointer-capture for off-canvas drags, `preventDefault` to suppress native selection/drag). This path lives in the interaction layer alongside the selection path, gated on `armedTool === "pen"`, and the two never both fire for one gesture (a pen drag prevent-defaults the selection; a text drag never starts when pen is armed because `user-select` is off).

**2. Coordinate math stays in `anchor/` (AD-9).** Highlight/underline normalize rects via `anchor/normalizeRect`/`denormalizeRect`. Pen needs the SAME round-trip for POINTS: `normalizePoint(local, box, scale)` → `Point` (`[0,1]` fractions) and `denormalizePoint(point, box, scale)` → card-local px. These are NEW `anchor/` exports, unit-tested DOM-free exactly like the rect pair (divide / multiply by `box * scale`, clamp01). NO point math lands in `annotations/` or the render layer — `anchor/` is the single home of screen↔PDF coordinate math.

**3. perfect-freehand is the stroke engine; geometry-on-kind, style-on-type still holds (AD-5).** The freehand outline (input points → a filled polygon outline) and its SVG path string come from `perfect-freehand` (pinned `1.2.3`, per CLAUDE.md AD-2) behind a tiny `annotations/pen.ts` wrapper, used by BOTH the live preview AND `AnnotationLayer` so they draw identically. GEOMETRY keys off `anchor.kind` (`path` → render an SVG stroke from `points`), STYLE keys off `type`/`style` (`pen` paints a filled stroke in `style.color` at `style.stroke_width`). This is the same two-axis rule 2.7 established; pen is the third `anchor.kind` and the first non-rect render branch.

**4. Pen is SINGLE-PAGE; `stroke_width` is stored at scale 1.0.** A `PathAnchor` has one `page_index` — a stroke binds to the page its `pointerdown` landed on, and points are normalized against THAT card's box (points wandering off the card clamp to `[0,1]`). No two-page split, no `group_id` (that is the text-selection path's concern). `stroke_width` is stored in **scale-1.0 CSS px** (like the page box), and the renderer feeds perfect-freehand `size = stroke_width * scale` so the line thickens with zoom and stays glued (NFR-3) — exactly the invariant the rects already satisfy.

## Scope boundary — READ FIRST

**IN (this story):**

- **Add `perfect-freehand@1.2.3`** to `client/package.json` dependencies (the AD-2 pen engine; first use). It is a tiny zero-dep pure-function lib (`getStroke(points) → number[][]` outline). No build/config change.
- **`anchor/` point math (NEW exports).** `normalizePoint(local: {x,y}, box, scale): Point` and `denormalizePoint(point: Point, box, scale): {x,y}` — the point twins of `normalizeRect`/`denormalizeRect`, clamped to `[0,1]` on normalize, DOM-free, unit-tested in `anchor.test.ts`. Re-export from `anchor/index.ts`.
- **`annotations/pen.ts` (NEW).** A pure wrapper over perfect-freehand: `strokeOutline(points: {x,y}[], size: number): number[][]` (calls `getStroke` with our fixed options) and `svgPathFromOutline(outline): string` (the standard quadratic-smoothed `d` builder). DOM-free, unit-tested (a 2-point input yields a non-empty path `d`). Used by the preview AND the layer.
- **`buildPenAnnotation` in `create.ts` (NEW, sibling of `buildAnnotations`).** Pure: given `{page_index, points: Point[]}`, `docId`, and `{now, newId, color, strokeWidth}`, returns ONE `Annotation {type:"pen", group_id:null, anchor:{kind:"path", page_index, points}, style:{color, stroke_width:strokeWidth}, body:null}`. Single-page, so no group split. Unit-tested.
- **Pen gesture capture (interaction layer).** In `AnnotationInteraction.tsx`, add a document-level pen path active only while `armedTool === "pen"`: `pointerdown` (primary button, not exempt, over the canvas) records the start and begins a draft (client-space points), `pointermove` pushes points and updates a live preview, `pointerup` assigns the page (`pickPage` on the points against the live card boxes), converts client→card-local→normalized points, calls `buildPenAnnotation`, `addAnnotation`, and `select`s the new mark (so the selection quick-box takes over). `preventDefault` on the pen `pointerdown`/`pointermove` suppresses native text selection + image drag; use `setPointerCapture` so a drag off the canvas still finishes (mirror the Reader pan). A draft with < 2 points (a click, no drag) creates nothing. `Esc` mid-draft aborts.
- **Live preview overlay.** While drafting, render the in-progress stroke via `pen.ts` in a `position:fixed`, full-viewport, `pointer-events:none` SVG in the SAME accent color + width the mark will land in (so what you draw is what you get). Fixed/client space is safe: the pointer is captured for the gesture's duration, so the canvas does not scroll mid-stroke. Cleared on `pointerup`/abort.
- **`AnnotationLayer` renders `kind=path`.** Add a `kind=path` branch to the per-page layer: a full-opacity per-page SVG sheet (sibling of `.annotation-highlights`/`.annotation-underlines`) drawing each pen mark as one `<path>` — `points` denormalized against this card's box+scale → `strokeOutline(pts, stroke_width*scale)` → `svgPathFromOutline` → `d`, filled with `var(--color-${style.color})`. The path is the selection HIT surface (pointer-events:auto + the existing hover/select/click handlers); hover/selected show via a CSS treatment on the path (e.g. an ink `stroke`/outline) since the rect-based `--hovered`/`--selected` outline does not fit a stroke. Re-derives on every zoom (NFR-3). No reflow (NFR-1: absolutely-positioned sheet).
- **Pen rail button + `D` hotkey + arm-time sub-toolbox.** In `ToolRail.tsx`, add a Pen `.tool-rail__item` below Underline (DESIGN.md#tool-rail order: cursor, highlight, underline, pen, …), the twin of the color tools, BUT its flyout holds `ColorSwatchRow` **+ a `StrokeWidthRow`** (color + stroke-width steps, UX-DR5). Phosphor `PencilSimple` (or `Pen`) glyph, `aria-label="Pen"`, `title="Pen (D)"`. In `App.tsx`'s document-level keydown, add `D`/`d` → `setActiveTool("pen")` next to `H`/`U` (UX-DR15: `D` = pen).
- **`StrokeWidthRow` component (NEW) + `activeStrokeWidth` store state.** A small row of N stroke-width steps (e.g. 3: thin/medium/thick) mirroring `ColorSwatchRow`'s shape (armed step shows the ink ring; `value` + `onPick(width)`); shared by the arm-time flyout AND the selection quick-box. `activeStrokeWidth` (number, scale-1.0 px) lives in the store next to `activeColor` (two writers — the rail flyout AND the selection quick-box restroke — plus the create path reads it; remember-last-choice), with `setActiveStrokeWidth`.
- **Selection quick-box becomes type-aware for pen.** The 2.5 selection quick-box (`ColorSwatchRow` + delete) must also handle a selected PEN mark: show `ColorSwatchRow` + `StrokeWidthRow` + delete. Recolor reuses `recolorAnnotation`; restroke uses a new store action `restrokeAnnotation(ids, width, now)` (the stroke-width twin of `recolorAnnotation`; sets the mark's `style.stroke_width` + bumps `updated_at`, and also sets `activeStrokeWidth` — last-choice-wins). The box anchor logic (`showSelectionBox`/`selectionPoint`) currently assumes `kind=text` rects → add a `kind=path` branch anchoring the box below the stroke's bounding box.
- **Selection hit-test recognizes pen marks.** The 2.5 selection seam matches marks via `t.closest(".annotation-highlight")` at TWO sites (reopen-box pointerdown; empty-space-deselect pointerdown). A pen path is NOT an `.annotation-highlight` rect, so add `.annotation-pen` (or a shared `.annotation-selectable` hook) to BOTH `.closest()` selectors so a pen stroke is selectable/deselectable like a rect mark. Keep the change minimal and covered by a test.
- **Stroke-width tokens** in `client/src/theme/components.css` (hand-authored token layer, raw px allowed there per CLAUDE.md#Design-conventions; `no-raw-values.test.ts` only forbids raw values OUTSIDE `src/theme/**`): the N step values (e.g. `--pen-stroke-thin/medium/thick`) and any preview/selected-stroke treatment width. The pen COLOR is the mark's `style.color` (accent palette via `var(--color-*)`), default = `activeColor`.
- **Accessibility + no-canvas-shift:** the pen sub-toolbox is the same keyboard-reachable, `Esc`/outside-click-dismissable rail overlay as the color tools; the preview + marks never reflow the canvas (NFR-1).

**OUT (later stories / do NOT build):**

- **Memo / comment / box tools** (2.9–2.11) and their rail buttons/sub-toolboxes. Only pen this story.
- **Move / resize / re-point / erase the stroke** — Epic 3 (Story 3.1 edit path). This story creates, selects, recolors, restrokes (width), and deletes; it does NOT drag-move the path, edit individual points, or erase part of a stroke.
- **Multi-page / cross-page strokes.** A `PathAnchor` is single-page (one `page_index`); a stroke binds to the page its `pointerdown` landed on. No `group_id`, no two-page split (that is the text path's AR-4 concern). A drag wandering onto another card clamps its stray points to `[0,1]` of the start page.
- **Pressure / tilt / velocity tuning** beyond perfect-freehand's defaults. Use sensible fixed options (a `size` from `stroke_width`, default `thinning`/`smoothing`/`streamline`); no stylus-pressure capture, no per-stroke options UI. (Pressure is a Phase-2/3 polish item if ever wanted.)
- **Persistence / command stack / undo** — Epic 3. Create/select/recolor/restroke/delete stay client-side, reusing/extending the existing store actions (no do/undo yet).
- **Per-tool remembered color/width that differs from the shared default.** `activeColor` stays the ONE shared default across all color tools; `activeStrokeWidth` is the ONE shared pen width. Per-tool memory is a future extension (noted OUT in 2.6/2.7 too).
- **Any anchor-MODEL / Pydantic / endpoint / generated-type change.** `type:"pen"`, `PathAnchor{kind:"path", points}`, `Point`, and `Style.stroke_width` are ALREADY in the generated `Annotation` type + the Pydantic model (Story 2.2 foundation built the full entity). `server/openapi.json` (tracked fields) + `client/src/api/schema.d.ts` stay byte-identical.

## Acceptance Criteria

1. **Pen armed → drag draws a vector freehand stroke stored as `kind=path {points}` normalized, `type=pen` (epics.md#Story-2.8 AC1; FR-9, AR-5, IP-9).** With pen armed (rail button or `D`), a pointer drag over a page draws a freehand stroke rendered via perfect-freehand, and on release stores ONE `Annotation {type:"pen", anchor:{kind:"path", page_index, points:Point[]}, style:{color, stroke_width}}`. `points` are normalized `[0,1]` fractions of the page box (via the new `anchor/normalizePoint`), so they are scale-independent; the drag does NOT select text and the page does not shift or reflow (NFR-1). A click without a drag (< 2 points) creates nothing. [Source: epics.md#Story-2.8 AC1; ARCHITECTURE-SPINE.md#AD-4, #AD-5 (`pen → path`, `stroke_width` path-only); AnnotationInteraction.tsx (new pen gesture path); anchor/index.ts (normalizePoint); create.ts (buildPenAnnotation)]

2. **Drag-release shows the pen quick-box: color swatches + stroke-width steps (epics.md#Story-2.8 AC2; UX-DR5/DR7).** On release, the new pen mark is selected and the selection quick-box opens showing a `ColorSwatchRow` (recolor) + a `StrokeWidthRow` (restroke) + delete. Recolor writes through `recolorAnnotation` and repaints the stroke; restroke writes through the new `restrokeAnnotation` and rethickens it; both update the shared default (`activeColor`/`activeStrokeWidth`, last-choice-wins); delete removes the mark. `style` carries `color` + `stroke_width` (stroke_width path-only per AR-5). [Source: epics.md#Story-2.8 AC2; ARCHITECTURE-SPINE.md#AD-5 (stroke_width path-only); UX-DR5 ("pen → swatch row + stroke-width steps"); AnnotationInteraction.tsx (selection quick-box, type-aware); Story 2.5]

3. **The stroke stays anchored and correctly scaled across zoom (epics.md#Story-2.8 AC3; NFR-3).** After drawing, zooming re-renders the stroke at the exact page location and the line thickness scales with zoom (perfect-freehand `size = stroke_width * scale`), so the mark rides the denormalized points via the anchor service — screen geometry derived, never persisted. This is the Epic-2 risk-gate invariant; prove it LIVE at DPR>1. [Source: epics.md#Story-2.8 AC3; ARCHITECTURE-SPINE.md#AD-4; AnnotationLayer.tsx (re-derive on scale); anchor/denormalizePoint]

4. **Pen is a first-class tool in the single `activeTool` FSM (AD-11).** The rail has a Pen button below Underline (DESIGN.md#tool-rail order); clicking it switches `activeTool` to `"pen"` in ONE click and the rail reflects it; `D` arms it; `V`/`Esc` returns to cursor; arming pen disarms whatever was active (mutual exclusion by construction). Switching TO pen auto-opens its sub-toolbox (color swatches + stroke-width steps, reusing `ToolFlyout` + the shared `flyoutOpen` + the open-on-tool-change effect); a click on the already-active Pen button toggles it; `Esc`/outside-click/switch-away/collapse close it. The sub-toolbox sets the shared `activeColor` + `activeStrokeWidth`. While pen is armed, panning is off (pen is an annotation tool, so `panArmed` is false) and text selection is suppressed over the canvas. [Source: ARCHITECTURE-SPINE.md#AD-11; tools.ts (`ANNOTATION_TOOLS` already includes "pen"); UX-DR4/DR5/DR15; ToolRail.tsx (color-tool pattern); Story 2.6]

5. **Geometry-on-kind / style-on-type is honored; `kind=path` is a NEW geometry branch, not a `type` hack (AD-5).** The render branch is selected by `anchor.kind === "path"` (draw an SVG stroke from `points`), never by `type`; the paint (fill color, stroke width) keys off `style`. No code infers anchor SHAPE from `type`. The point math lives ONLY in `anchor/` (AD-9 layering); `annotations/` consumes it. [Source: ARCHITECTURE-SPINE.md#AD-5 (line 83), #AD-9; AnnotationLayer.tsx; anchor/index.ts]

6. **The stroke is selectable, recolorable, restrokable, and deletable via the 2.5 seam (AD-12).** Clicking a stroke selects it (store `select`), hovering outlines it, the selected stroke shows a persistent treatment, and the selection quick-box recolors/restrokes/deletes it — the SAME selection seam highlight/underline use, extended so its hit-test (`.closest`) and box-anchor recognize a `kind=path` mark. Delete via the quick-box or `Del`/`Backspace` removes the stroke. [Source: ARCHITECTURE-SPINE.md#AD-12; Story 2.5 (selection seam); AnnotationInteraction.tsx (hit-test + selectionPoint, path branch)]

7. **Client-side only; layering + contract preserved (AD-9, AD-3).** No store-SCHEMA/persisted-`Annotation`/anchor-MODEL/API change. `type:"pen"`, `PathAnchor`, `Point`, and `Style.stroke_width` are ALREADY in the generated type + Pydantic model, so `server/openapi.json` (tracked fields) + `client/src/api/schema.d.ts` stay byte-identical. perfect-freehand is a new CLIENT runtime dep (consumed in `annotations/`), NOT a `render/` export, so both `vi.mock("./render")` barrels (`App.test.tsx`, `Reader.test.tsx`) stay untouched. `no-raw-values.test.ts` stays green (new raw px only in `src/theme/components.css`). Highlight create/select/recolor/delete (2.3/2.5/2.6), underline (2.7), pan (2.4), and zoom-glue (NFR-3) do not regress. [Source: ARCHITECTURE-SPINE.md#AD-9, #AD-3; CLAUDE.md#Engineering-principles, #Design-conventions; client/src/api/schema.d.ts (PathAnchor/Point/stroke_width present)]

## Tasks / Subtasks

- [x] **Task 1 — Add perfect-freehand + the pen.ts wrapper (AC: 1, 3, 5)**
  - [x] `cd client && npm install perfect-freehand@1.2.3` (pins it in `package.json` + lockfile; AD-2). Confirm it is a `dependencies` entry, not `devDependencies`.
  - [x] Create `client/src/annotations/pen.ts`: `strokeOutline(points: {x,y}[], size: number): number[][]` calling `getStroke(points, { size, thinning, smoothing, streamline, last: true })` with fixed sensible options; `svgPathFromOutline(outline: number[][]): string` building a quadratic-smoothed `d` (the canonical perfect-freehand snippet) returning `""` for an empty outline. Pure, DOM-free.
  - [x] Unit test `pen.test.ts`: a ≥2-point input yields a non-empty outline + a non-empty `d`; an empty input yields `""`.

- [x] **Task 2 — anchor/ point math (AC: 1, 3, 5)**
  - [x] In `client/src/anchor/index.ts`, add `normalizePoint(local: {x:number;y:number}, box: PageBox, scale: number): Point` (divide by `box*scale`, `clamp01`) and `denormalizePoint(point: Point, box: PageBox, scale: number): {x:number;y:number}` (multiply by `box*scale`). Import `Point` from `../api/client`. Mirror the existing `normalizeRect`/`denormalizeRect` doc-comments (single home of coordinate math; no y-flip — top-left y-down baked box).
  - [x] Re-export both from the `anchor/` public surface (they are already in `index.ts`).
  - [x] Unit test in `anchor.test.ts`: round-trip a point (`denormalize(normalize(p)) ≈ p`), scale-independence (same normalized point at scale 1 and 2 denormalizes to `×2`), and clamp (an off-card point clamps into `[0,1]`).

- [x] **Task 3 — buildPenAnnotation + store stroke-width state (AC: 1, 2)**
  - [x] In `client/src/annotations/create.ts`, add `buildPenAnnotation(page: {page_index:number; points:Point[]}, docId: string, opts: {now; newId; color; strokeWidth}): Annotation` → one `type:"pen"`, `group_id:null`, `anchor:{kind:"path", page_index, points}`, `style:{color, stroke_width:strokeWidth}`, `body:null`. Keep `buildAnnotations` (text path) unchanged. Export it.
  - [x] In `client/src/store/index.ts`, add `activeStrokeWidth: number` (default a sensible scale-1.0 px = the medium step), `setActiveStrokeWidth(width)`, and `restrokeAnnotation(ids: string[], width: number, now: string)` (the stroke-width twin of `recolorAnnotation`: set `style.stroke_width` + bump `updated_at`). Document them like the `activeColor`/`recolorAnnotation` comments (two writers + create reads; client-only, not persisted).
  - [x] Unit tests: `create.test.ts` for `buildPenAnnotation` (shape, single mark, null group); `store` test for `restrokeAnnotation` + `setActiveStrokeWidth`.

- [x] **Task 4 — Pen gesture capture + live preview (AC: 1, 2, 3)**
  - [x] In `client/src/annotations/AnnotationInteraction.tsx`, add a document-level pen path, active only while `armedTool === "pen"` (read via `armedToolRef`), SEPARATE from the selection `pointerup`. `pointerdown` (button 0, not `isExempt`, target inside the canvas): start a draft (a ref of client-space `{x,y}` points + a `drawing` state for the preview), `e.preventDefault()` (suppress native selection/drag), `setPointerCapture` best-effort. `pointermove` while drawing: push the client point, update the preview state. `pointerup`: if ≥ 2 points, resolve the page via `pickPage` on the points against `getPages()` card boxes, convert each client point to card-local (`client - cardRect`) then `normalizePoint` against that page box+scale, `buildPenAnnotation`, `addAnnotation`, `select(created.id)`; then clear the draft. `Esc` (or pointercancel) aborts the draft with no mark.
  - [x] Render the live preview: a `position:fixed`, full-viewport, `pointer-events:none` `<svg>` with one `<path d={svgPathFromOutline(strokeOutline(draftPoints, activeStrokeWidth*scale))}>` filled `var(--color-${activeColor})`. Only while `drawing`. (Client space is safe — the pointer is captured so the canvas can't scroll mid-stroke.)
  - [x] Do NOT touch the selection `pointerup` text path, the cursor-mode proof, the 2.2 re-pop fix, or the `armedTool` prop-sync. The non-text-tool early-return (`if (tool !== null) return;` after the highlight/underline branch) already prevents pen from popping the cursor proof box — keep it; pen is handled in its OWN path, not the selection path.

- [x] **Task 5 — Render kind=path in AnnotationLayer (AC: 1, 3, 5, 6)**
  - [x] In `client/src/annotations/AnnotationLayer.tsx`, add a `kind=path` render branch: a full-opacity per-page `<svg className="annotation-pens">` sheet (sibling of the highlight/underline groups) with one `<path>` per pen mark — `points` `denormalizePoint`'d against `box`+`scale` → `strokeOutline(pts, a.style.stroke_width * scale)` → `svgPathFromOutline` → `d`, `fill: var(--color-${a.style.color})`. The path carries `data-testid={annotation-mark-${a.id}}`, the `onPointerEnter/Leave` (setHovered) + `onClick` (select) handlers, `pointer-events:auto`, and hover/selected classes. Keep the existing `kind=text` highlight/underline branches unchanged; the existing `if (a.anchor.kind !== "text") return null` becomes a proper kind switch (text → rect divs; path → SVG path).
  - [x] Add `.annotation-pens` + `.annotation-pen` (+ `--hovered`/`--selected` treatment for a stroke, e.g. an ink `stroke` outline on the path) to `Annotations.css`. Tokens/vars only.
  - [x] Keep marks `created_at`-sorted (recent-wins within the pen group). Note (do NOT fix here): cross-type recent-wins across the separate SVG/opacity groups is the same deferred limitation as 2.7 (see deferred-work.md) — pen adds a third group; same rationale, do not restructure the seam.

- [x] **Task 6 — Pen rail button + StrokeWidthRow + D hotkey + type-aware selection box (AC: 2, 4, 6)**
  - [x] Create `client/src/annotations/StrokeWidthRow.tsx`: a row of N width steps (e.g. 3), mirroring `ColorSwatchRow` (`value: number` + `onPick(width: number)`; armed step shows the ink ring; keyboard-reachable). Export from `annotations/index.ts`. Add its dims to `components.css`.
  - [x] `client/src/ToolRail.tsx`: add a Pen `.tool-rail__item` below Underline — `const penActive = activeTool === "pen"`, armed class, `aria-label="Pen"`, `title="Pen (D)"`, `aria-haspopup="menu"`, `aria-expanded={penActive && flyoutOpen}`, `data-testid="tool-pen-button"`, `onClick: if (penActive) setFlyoutOpen(o=>!o); else onSelectTool("pen")`, and a `ToolFlyout testId="pen-flyout"` holding `<ColorSwatchRow value={activeColor} onPick={…}/>` + `<StrokeWidthRow value={activeStrokeWidth} onPick={…}/>`. Phosphor `PencilSimple`/`Pen` glyph. Thread `activeStrokeWidth`/`onPickStrokeWidth` props through ToolRail (App owns them, store-backed). The existing `flyoutOpen` + open-on-tool-change + dismiss effects are tool-agnostic — pen plugs in, no new bool.
  - [x] `client/src/App.tsx`: add the `D`/`d` branch → `setActiveTool("pen")` next to `H`/`U` (keep the editable/button exemption guard). Subscribe to `activeStrokeWidth`/`setActiveStrokeWidth` from the store and pass them to `ToolRail` (twins of `activeColor`/`setActiveColor`).
  - [x] In `AnnotationInteraction.tsx`, make the selection quick-box type-aware: for a selected `kind=path` mark, render `ColorSwatchRow` + `StrokeWidthRow` (restroke) + delete; for `kind=text`, unchanged. Add a `kind=path` branch to `showSelectionBox` (allow path marks with ≥1 point) and `selectionPoint` (anchor the box below the stroke's bounding box, computed from denormalized points). Add `.annotation-pen` to BOTH `.closest(".annotation-highlight")` hit-test selectors (reopen-box + empty-space-deselect) so a pen stroke is selectable/deselectable.

- [x] **Task 7 — Tests + regression bar (AC: all)**
  - [x] `anchor.test.ts`: normalizePoint/denormalizePoint round-trip + scale-independence + clamp (Task 2).
  - [x] `pen.test.ts`: outline + path-`d` from points (Task 1).
  - [x] `create.test.ts`: `buildPenAnnotation` shape (Task 3).
  - [x] `AnnotationInteraction.test.tsx`: with `armedTool="pen"`, a synthetic pointerdown→move×N→pointerup builds a `type:"pen"`/`kind:"path"` annotation with `style.color===activeColor` + `style.stroke_width===activeStrokeWidth`, normalized points, and selects it; a down→up with no move creates nothing; the highlight/underline/cursor paths still pass unchanged. (jsdom zeroes rects/points geometry — assert the MODEL/wiring, inject the page boxes/points like the existing fake-card pattern.)
  - [x] `AnnotationLayer.test.tsx`: a `kind=path` mark renders a `<path>` inside `.annotation-pens` carrying `annotation-mark-<id>`, gets `--hovered`/`--selected` on hover/select, and is clickable (selects). Text marks unchanged.
  - [x] `ToolRail.test.tsx`: clicking Pen while another tool is active switches `activeTool` to `"pen"` in one click; switching to pen shows `pen-flyout` with the swatch row AND the stroke-width row; clicking the active Pen button toggles it; picking a width calls `onPickStrokeWidth`; picking a color calls `onPickColor`; `Esc`/outside-click/switch-away close it.
  - [x] `App.test.tsx`: pressing `D` sets `activeTool` to `"pen"`; `V`/`Esc` returns to cursor. Thread the new `activeStrokeWidth`/`onPickStrokeWidth` props through the existing mounts. (No new `render/` export → both `vi.mock("./render")` barrels untouched; confirm.)
  - [x] `StrokeWidthRow.test.tsx`: renders N steps, the armed step has the ring, picking a step calls `onPick` with that width.
  - [x] Full regression: `cd client && npm test` + `npm run typecheck`; `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q`. Tracked contract byte-identical: `git diff --stat -- client/src/api/schema.d.ts` empty (and `server/openapi.json` tracked fields — only `info.version` may move with the bump). `no-raw-values.test.ts` green.
  - [x] **Live smoke (the real verifier; jsdom can't draw or measure a stroke). Launch your OWN fresh `uvicorn` + `vite dev` (alternate ports if 8000/5173 taken; never reuse a found-running server — CLAUDE.md), real PDF at DPR>1:** (a) arm Pen from cursor (button, ONE click) → pen armed, the sub-toolbox auto-opens with color swatches + stroke-width steps; (b) press `D` → arms pen; (c) pick a color + a width (arm-time) → preview/next stroke uses them; (d) drag a freehand squiggle over the page → a smooth vector stroke lands in the chosen color + width, the page does NOT scroll/select text, and the selection quick-box opens with swatches + width steps + delete; (e) recolor + restroke via the quick-box → the stroke repaints/rethickens; (f) zoom in/out → the stroke stays glued to the page location AND thickens with zoom (NFR-3); (g) click an empty area → deselects; click the stroke → reselects; (h) `Del` / quick-box delete → removes it; (i) confirm a plain click (no drag) makes no mark; (j) confirm highlight/underline still work (switch tools, drag text). Capture results + a screenshot in Completion Notes. [Reuse `fixtures/sample-pdfs/09-regularization.pdf`.]

- [x] **Task 8 — Docs (AC: all)**
  - [x] No `/api` change → `docs/API.md` untouched.
  - [x] Update `client/src/annotations/README.md`: pen is the first `kind=path` tool — a freehand pointer GESTURE (not a text selection) captured in the interaction layer with a live preview, point math in `anchor/` (`normalizePoint`/`denormalizePoint`), the freehand engine in `pen.ts` (perfect-freehand), rendered as an SVG stroke in `AnnotationLayer` (geometry-on-kind), carrying `style.stroke_width` (path-only); rail button + `D` hotkey + a color+width sub-toolbox; the 2.5 selection seam extended to recognize/recolor/restroke a path mark.

## Dev Notes

### What this story adds vs reuses (the core of the story)

Unlike 2.7, pen is mostly NEW — but it reuses the anchor MODEL, the rail/FSM, and the selection seam:

| Need | Already exists (REUSE) | New (this story) |
| --- | --- | --- |
| Normalized `[0,1]` coordinate model + zoom re-derivation | `normalizeRect`/`denormalizeRect`, scale-derived screen position | `normalizePoint`/`denormalizePoint` (the point twins, same math) |
| The annotation entity + contract | `PathAnchor`/`Point`/`Style.stroke_width`/`type:"pen"` ALL already generated + in Pydantic | `buildPenAnnotation` (compose the entity; no contract change) |
| Page assignment | `pickPage` (used by the text split) | reuse it on the stroke's points (single page, no split) |
| Tool state / mutual exclusion | `activeTool` FSM; `"pen"` already in `ANNOTATION_TOOLS` | the Pen rail button + `D` hotkey |
| Arm-time sub-toolbox | `ToolFlyout` + `flyoutOpen` + open-on-tool-change + `ColorSwatchRow` | add `StrokeWidthRow`; pen flyout = color + width |
| Post-create edit | the 2.5 selection quick-box (recolor + delete) | type-aware: + `StrokeWidthRow` + a `kind=path` box-anchor + `.annotation-pen` hit-test |
| Active defaults | `activeColor` store state | `activeStrokeWidth` store state + `restrokeAnnotation` |
| Mark render | per-page absolutely-positioned sheet, denormalize-on-zoom | an SVG `<path>` branch (`kind=path`) + the freehand engine `pen.ts` |
| Gesture capture | the Reader PAN gesture pattern (origin ref, pointer-capture, preventDefault) | a pen draw gesture in the interaction layer + a live preview |

Resist: putting point math in `annotations/` or `render/` (it belongs in `anchor/`); rendering the stroke by branching on `type` instead of `anchor.kind`; a second tool/color/width state model (one `activeTool`, one `activeColor`, one `activeStrokeWidth`); a bespoke pen quick-box separate from the 2.5 selection seam; reading `window.getSelection()` for the pen gesture; storing `stroke_width` in screen px (store scale-1.0 px, multiply by scale at render).

### Decision A — pen is a pointer GESTURE captured in the interaction layer, NOT a text selection

The 2.3/2.7 create path is: native text drag → `pointerup` reads `window.getSelection()` → `rectsFromSelection`. Pen has no selection. So pen gets its own `pointerdown`→`pointermove`→`pointerup` capture, gated on `armedTool === "pen"`, mirroring the Reader's PAN gesture (origin/points in a ref so a move never re-renders the store; `setPointerCapture` so an off-canvas drag still finishes; `preventDefault` to kill native text-selection + image-drag). It lives in `AnnotationInteraction` (the interaction layer, annotations/) next to the selection path, not in the Reader, because it produces an annotation (anchor/store work belongs in annotations/+anchor/, AD-9). The Reader's only pen-related job is presentational: set `data-draw` on `.pdf-canvas` (a pure derivation of `armedTool==="pen"`, twin of `data-pan`) so CSS disables `user-select` and shows a crosshair cursor while pen is armed — otherwise a quick drag could still flicker a native selection before `preventDefault`.

### Decision B — live preview in fixed/client space; storage in normalized page coords

The preview draws in `position:fixed` viewport pixels (raw `clientX/clientY` points → `pen.ts` → an SVG path in a full-viewport overlay), the SAME space the quick-box already uses. This is safe for the duration of ONE stroke because the pointer is captured, so the canvas cannot scroll mid-drag (no detach). Only on `pointerup` do we convert to the durable form: pick the page (`pickPage` on the points), localize (`client - cardRect`), and `normalizePoint` against that card's box+scale. So the on-screen preview and the stored mark are computed by the SAME `pen.ts`, guaranteeing what-you-draw-is-what-you-get; the normalize step happens once, at the end.

### Decision C — `stroke_width` stored at scale 1.0; perfect-freehand `size = stroke_width * scale`

`points` are normalized fractions, so at render they denormalize to card-local px AT THE CURRENT SCALE. The stroke thickness must scale the same way or the line would look too thin when zoomed in. So `stroke_width` is stored in scale-1.0 CSS px (like the page box) and the layer/preview feed perfect-freehand `size = stroke_width * scale`. A 4px@scale1 stroke is 8px@scale2 — glued AND proportionally thick (NFR-3). The `StrokeWidthRow` steps are scale-1.0 px values (tokens in `components.css`).

### Decision D — `AnnotationLayer` gets a `kind` switch; pen renders one SVG `<path>` per mark

Today the layer early-returns `null` for any non-text anchor. Replace that with a kind switch: `text` → the existing rect divs (highlight fill / underline line); `path` → one `<path>` in a full-opacity `.annotation-pens` SVG sheet, `d` from `svgPathFromOutline(strokeOutline(denormPts, stroke_width*scale))`, `fill` = the mark's accent. The path is the selection hit surface (`pointer-events:auto` + the hover/select handlers); since the rect `outline` hover/selected treatment doesn't suit a stroke, pen uses a CSS treatment on the path (an ink `stroke`/outline). The pen sheet is full-opacity (a crisp stroke), so — like underlines — it sits OUTSIDE the 0.4-opacity highlight group. Cross-type recent-wins across the three groups is the SAME deferred limitation as 2.7 (deferred-work.md) — do not restructure the hit-testing here.

### Decision E — selection seam extended, not duplicated (2.5)

A pen mark must be selectable/recolorable/deletable through the ONE 2.5 selection seam, plus restrokable. Three touch-points: (1) the hit-test `.closest(".annotation-highlight")` (two sites) also matches `.annotation-pen`; (2) `showSelectionBox`/`selectionPoint` gain a `kind=path` branch (the box anchors below the stroke's denormalized bounding box, since a path has no `rects`); (3) the box body renders `StrokeWidthRow` for a path mark (in addition to `ColorSwatchRow` + delete). No second selection machine.

### What must NOT change (regression guardrails)

- **The text-selection create path** (highlight/underline `pointerup` → `rectsFromSelection` → `buildAnnotations`), the 2.2 re-pop fix, the cursor-mode proof, the non-text-tool early-return, and the two-page `group_id` split — all unchanged; pen is a separate gesture path.
- **The 2.5 selection seam** (`selectedId`, recolor + delete, hover/selected, group-aware lighting) — EXTENDED (path hit-test + restroke + path box-anchor), not rewritten; highlight/underline selection unaffected.
- **The 2.6/2.7 rail flyout machinery** (`flyoutOpen`, open-on-tool-change, dismiss/collapse/switch-away) — tool-agnostic; the Pen button plugs in. Do not regress the pointer/highlight/underline flyouts when adding the fourth.
- **Single `activeTool` model (AD-11)** — `"pen"` is already in the union; do NOT add a second tool field. One `activeColor`, one `activeStrokeWidth`.
- **Contract byte-identical** — `PathAnchor`/`Point`/`stroke_width`/`type:"pen"` already exist; no Pydantic/OpenAPI/schema.d.ts change.
- **Pan (hand), hold-Space, zoom-glue (NFR-3), render/ layer** — unaffected. Pen must NOT pan (it is an annotation tool) and must NOT select text (preventDefault + `data-draw` user-select:none).

### Integration points (read these; they are the seams)

- `client/src/annotations/AnnotationInteraction.tsx` — the selection `pointerup` (gate ~line 147) stays text-only; ADD a separate pen gesture path (pointerdown/move/up while `armedTool==="pen"`) + the live preview overlay; make the selection quick-box (~lines 373-399 `showSelectionBox`/`selectionPoint`, ~459-484 body) type-aware for `kind=path`; add `.annotation-pen` to the two `.closest(".annotation-highlight")` hit-tests (~lines 288, 352). [AnnotationInteraction.tsx]
- `client/src/annotations/AnnotationLayer.tsx` — the `renderMark` text branch + the `if (a.anchor.kind !== "text") return null` guard (~line 83); ADD the `kind=path` SVG branch + `.annotation-pens` group. [AnnotationLayer.tsx:69-127]
- `client/src/anchor/index.ts` — `normalizeRect`/`denormalizeRect` (~lines 68-105) are the template; ADD `normalizePoint`/`denormalizePoint`. `pickPage` (~line 152) reused for page assignment. [anchor/index.ts]
- `client/src/annotations/create.ts` — `buildAnnotations` (text); ADD `buildPenAnnotation` (path, single-page). [create.ts]
- `client/src/store/index.ts` — `activeColor`/`recolorAnnotation` (~lines 62-99) are the template; ADD `activeStrokeWidth`/`setActiveStrokeWidth`/`restrokeAnnotation`. [store/index.ts]
- `client/src/ToolRail.tsx` — the Underline `.tool-rail__item` (~lines 229-260) is the template; ADD the Pen item with a color+width flyout; thread `activeStrokeWidth`/`onPickStrokeWidth`. [ToolRail.tsx:229-260]
- `client/src/App.tsx` — the document-level keydown (`U` branch ~line 106); ADD the `D` branch; subscribe + pass `activeStrokeWidth`/`setActiveStrokeWidth` to ToolRail (~lines 45-46, 205-216). `armedTool={isAnnotationTool(activeTool) ? activeTool : null}` (~line 200) already forwards `"pen"` — no thread change. [App.tsx:96-117, 194-216]
- `client/src/Reader.tsx` — ADD `data-draw` on `.pdf-canvas` derived from `armedTool==="pen"` (twin of `data-pan` ~line 532) for the crosshair + user-select:none. [Reader.tsx:522-539]
- `client/src/tools.ts` — `ANNOTATION_TOOLS` already contains `"pen"`; no change. [tools.ts:14]
- `client/src/annotations/Annotations.css` + `client/src/theme/components.css` + `client/src/Reader.css` — pen group/path styles + stroke-width tokens + the `[data-draw]` cursor/user-select rule.

### Design tokens / UI strings

- New tokens in `components.css` (allowed raw px under `src/theme/**`): N stroke-width steps (e.g. `--pen-stroke-thin/medium/thick`) + any selected-stroke treatment width. Pen COLOR uses the existing accent palette via `style.color` (no new color token). [Source: CLAUDE.md#Design-conventions; DESIGN.md#annotation-pen]
- UI strings: the Pen button `aria-label="Pen"` / `title="Pen (D)"`; stroke-width step labels — plain words, NO em-dash. [[no-emdash-user-facing]] [Source: DESIGN.md#tool-rail]

### Engineering conventions in force (CLAUDE.md#Engineering-principles)

- **Adopt-stable / don't reinvent (AP-4):** use `perfect-freehand` for the stroke (NOT hand-rolled spline math) — exactly the example CLAUDE.md#Engineering-principles names ("perfect-freehand for the pen"); reuse `pickPage`, `ToolFlyout`, `ColorSwatchRow`, the anchor normalize pattern, the selection seam. [[prefer-stable-solutions]]
- **Document-level handlers (AP-1):** the `D` key joins App's document-level keydown (phase-gated by `docOpen`, editable/buttons exempt); the pen gesture binds on `document` (phase-gated `enabled`), not `.pdf-canvas`. Capture-state (drawing/draft) must reset on pointercancel/blur so an interrupted stroke can't strand a half-draft (the recurring held-state bug). [[held-key-state-reset-on-blur]]
- **`render/` mock-barrel sync (AP-2):** perfect-freehand is consumed in `annotations/`, NOT a `render/index.ts` export → both `vi.mock("./render")` barrels (`App.test.tsx`, `Reader.test.tsx`) untouched. Confirm.
- **HiDPI + real-host live smoke (memory + CLAUDE.md):** pen is a pointer-geometry feature jsdom can't draw or measure (zeroed rects) — MUST live-smoke the actual stroke + zoom-thickening at DPR>1, not just assert the model in jsdom. (Pen is single-page, so the cross-page path doesn't apply, but the stroke geometry + zoom-glue are the live risk.) [[verify-on-hidpi-and-real-host]]
- **Cross-model code review (AP-3):** run `bmad-code-review` (Codex) after dev-story.

### Testing standards

- Frontend Vitest + jsdom: assert the MODEL/wiring — the pen create call's `type`/`kind`/`style`, the layer's path branch + group, the rail flyout (color + width) + `activeTool` switch, the `D` keymap, the store stroke-width actions — NOT pixel geometry (jsdom zeroes rects/points). Inject page boxes + synthetic pointer points like the existing fake-card pattern. The freehand math (`pen.ts`) + point math (`anchor`) are pure → unit-tested directly.
- Backend pytest: no model/contract change; run to confirm no regression.

### Project Structure Notes

- New files: `annotations/pen.ts` (+ `pen.test.ts`), `annotations/StrokeWidthRow.tsx` (+ `StrokeWidthRow.test.tsx`). Edits: `anchor/index.ts` (+ `anchor.test.ts`), `annotations/create.ts` (+ `create.test.ts`), `annotations/AnnotationInteraction.tsx` (+ test), `annotations/AnnotationLayer.tsx` (+ test), `annotations/Annotations.css`, `annotations/index.ts`, `store/index.ts` (+ test), `theme/components.css`, `ToolRail.tsx` (+ test), `App.tsx` (+ test), `Reader.tsx` (+ `Reader.css`), `annotations/README.md`. No new top-level dirs. `machine.ts`/`tools.ts`/`render/`/api-schema unchanged. `package.json` gains `perfect-freehand`. [Source: ARCHITECTURE-SPINE.md#Structural-Seed]
- Layer rule (AD-9): `render → anchor → annotations → store → api`, strict downward. This story touches the App composition root (`App.tsx` — `D` key, stroke-width prop), the Reader (`data-draw` derivation), the rail (`ToolRail.tsx` — pen button), `anchor/` (point math), and `annotations/` (gesture, create, layer, selection). No `render/`/store-SCHEMA/contract change.

### Versioning

- PATCH +1 when this story reaches `done` (PR merge): `server/pyproject.toml` `0.1.4 → 0.1.5` (single source; do NOT hard-code elsewhere). Bump once at done, not per commit. [Source: CLAUDE.md#Versioning]

### References

- [Source: .bmad/planning-artifacts/epics.md#Story-2.8] — story statement + the three ACs (pen armed → vector freehand stroke stored `kind=path {points}` normalized `type=pen`; drag-release shows the pen quick-box color + stroke-width; re-renders at correct scale/position on zoom).
- [Source: ARCHITECTURE-SPINE.md#AD-5 (lines 82-84)] — `pen → path`; `anchor.kind` geometry vs `type` semantic; `stroke_width` applies only to `kind=path`.
- [Source: ARCHITECTURE-SPINE.md#AD-4] — page-normalized anchor + zoom re-derivation (NFR-3); the point math is the `[0,1]` model applied to `{x,y}`.
- [Source: ARCHITECTURE-SPINE.md#AD-11] — the single `activeTool` model + single-click switch the pen button obeys.
- [Source: ARCHITECTURE-SPINE.md#AD-12] — the selection seam (`selectedId`, recolor/delete) pen rides + extends (restroke + path hit-test).
- [Source: ARCHITECTURE-SPINE.md#AD-9, #AD-3] — layering (point math in anchor/) + contract stability (no API/Pydantic/generated-type change).
- [Source: client/src/api/schema.d.ts (PathAnchor, Point, Style.stroke_width, type "pen")] — the contract ALREADY carries the full pen shape; verify byte-identical after the suite.
- [Source: DESIGN.md#annotation-pen, #quick-box, #tool-rail, #color-swatch] — "freehand vector stroke in the chosen accent; stroke width from the pen quick-box"; pen mode quick-box = swatch row + stroke-width steps; rail tool order (pen below underline).
- [Source: UX-DR4/DR5/DR7/DR15] — tool rail, contextual quick-box (pen → swatch + stroke-width), on-page pen rendering, `D` keymap.
- [Source: .bmad/implementation-artifacts/2-7-underline-text.md] — the previous tool story: the rail-button/flyout twin pattern, the selection-seam reuse, style-on-type, and the live-smoke discipline pen extends.
- [Source: .bmad/implementation-artifacts/2-6-arm-time-color-pick.md] — `activeColor` store state + `ToolFlyout` + the arm-time color sub-toolbox pen's color+width flyout twins.
- [Source: .bmad/implementation-artifacts/2-5-select-highlight-recolor-delete.md] — the selection seam (`selectedId`, recolor + delete) pen extends with restroke + a path branch.
- [Source: CLAUDE.md#Engineering-principles, #Design-conventions, #Versioning] — adopt-stable (perfect-freehand named), document-level handlers, render-mock-barrel sync, token contract, no em-dash, HiDPI live smoke, PATCH bump.

## Previous Story Intelligence

From Story 2.7 (underline, done) + 2.6 (arm-time color) + their Codex reviews + the Epic-1 retro:

- **Think about the INVERSE path (Codex repeatedly caught flyout-stays-open + fall-through bugs).** For pen: the sub-toolbox must CLOSE on switch-away/collapse (the existing effects should cover it — VERIFY); a pen `pointerup` with no real drag must create NOTHING (not a zero-length stroke); an interrupted draft (pointercancel/blur/Esc) must reset cleanly (no stranded half-stroke or stuck preview); and pen must NOT fall into the text-selection `pointerup` path (the `if (tool !== null) return;` guard already added in 2.7 covers this — keep it).
- **Live smoke is the real verifier; jsdom passed while real-DOM gesture/visual bugs existed.** Verify the actual STROKE (smooth, correct color + width, no text selected, no scroll), the new-mark selection box (swatches + width), recolor/restroke, and especially zoom-thickening + glue on a real host at DPR>1. jsdom proves wiring only.
- **Launch your OWN dev servers (CLAUDE.md rule).** A found-running uvicorn/vite may predate your edits or be a no-HMR prod build — smoke against a fresh own pair on alternate ports.
- **One model, no parallel state.** Keep pen inside the single `activeTool` FSM, the single `activeColor`, and add ONE `activeStrokeWidth`; no per-tool color/width map.
- **Contract byte-identical discipline.** Every Epic-2 story kept the tracked contract unchanged; this one must too (`PathAnchor`/`Point`/`stroke_width`/`type:"pen"` are already in it).
- **The 2.5 selection seam + 2.6/2.7 `ToolFlyout`/flyout effects** are the exact seams pen plugs into — reuse + extend, don't re-derive.

## Git Intelligence

- Baseline: `a1887e0` (Feat: Add Underline Text Annotations (#16)) on `main`. The anchor service (rect math), `buildAnnotations`, the `activeTool` FSM (`"pen"` already in the union), the 2.5 selection seam, the 2.6 `activeColor`+`ToolFlyout`, and the 2.7 underline (style-on-type render split, second rail flyout) are all merged. The full annotation entity (incl. `PathAnchor`/`Point`/`stroke_width`) was built in the 2.2 foundation and is already in the generated contract.
- Branch off `main` (never commit to `main` directly). Dev loop = host two-process flow (`uvicorn --reload` + `vite dev`).
- New dep `perfect-freehand@1.2.3` → `package.json` + lockfile change (expected). No contract change → keep `client/src/api/schema.d.ts` byte-identical (verify no diff after the suite).

## Project Context Reference

- Two processes, one container (AD-1/AD-10): `client/` (React 19.2 + Vite 8 + TS 6.0) + `server/` (FastAPI + Pydantic v2). Prod = single image, same-origin. v1 scope = Phase 1; no auth, localhost single-user.
- Client layering (AD-9): `render → anchor → annotations → store → api`, strict downward. Pen touches the App composition root (`D` key, stroke-width prop), the Reader (`data-draw`), `anchor/` (point math), and `annotations/` (gesture, create, layer, selection). No `render/`/store-SCHEMA/contract change.
- `activeTool` (AD-11) is the single tool model (`"pen"` already a member); `activeColor` (store) + the NEW `activeStrokeWidth` (store) are the shared defaults the create path reads. `anchor.kind` (AD-5) is the geometry discriminator — `path` is the third kind and pen's render branch.

## Story Completion Status

Ultimate context engine analysis completed - comprehensive developer guide created. Pen is the FIRST non-text tool, so the story is heavier than 2.7 (a paint variant): the gesture-capture path, the point math, the perfect-freehand wrapper, and the SVG render branch are genuinely new. Five internal design calls are pre-resolved with rationale (A — pen is a pointer GESTURE in the interaction layer mirroring pan, not a text selection, with `data-draw` suppressing native select; B — preview in fixed/client space, storage normalized once on release, both drawn by the same `pen.ts`; C — `stroke_width` stored at scale 1.0, perfect-freehand `size = stroke_width * scale` so the line thickens with zoom; D — `AnnotationLayer` gains a `kind` switch rendering one SVG `<path>` per pen mark in a full-opacity group; E — the 2.5 selection seam is extended, not duplicated — path hit-test + restroke + a path box-anchor). The contract already carries the full pen shape (`PathAnchor`/`Point`/`stroke_width`/`type:"pen"`), so this is client-only with the API/anchor-model/store-schema byte-identical. Success = pen is a first-class tool (rail button below Underline + `D` hotkey + a color+stroke-width sub-toolbox), a freehand drag while armed lands a smooth `type=pen`/`kind=path` vector stroke (perfect-freehand) at the chosen color+width without selecting text or scrolling, the stroke stays glued AND thickens across zoom, the 2.5 selection quick-box recolors/restrokes/deletes it, everything stays client-side with the contract byte-identical, and the live smoke passes the real stroke + zoom-thickening at DPR>1 without regressing highlight/underline/select/pan/zoom.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Claude Code dev-story workflow).

### Debug Log References

- Live-smoke note: the first synthetic-gesture probe read the DOM in the SAME
  synchronous tick it dispatched the pointer events, so the freshly-added mark
  hadn't rendered yet (React batches). Re-running with a post-`pointerup` delay
  confirmed the stroke + selection box. (Two strokes briefly existed because that
  first probe DID create a mark via the synchronous store write — a test artifact,
  not a bug; the Del path then correctly removed only the selected one, 2→1.)

### Completion Notes List

Implemented entirely client-side; no store-schema / anchor-MODEL / persisted-model
/ API change. The tracked contract (`client/src/api/schema.d.ts`) is byte-identical
— `PathAnchor` / `Point` / `Style.stroke_width` / `type:"pen"` were already in the
contract (Story 2.2 foundation built the full entity). `perfect-freehand@1.2.3` is
a new CLIENT runtime dep (consumed in `annotations/`), not a `render/` export, so
both `vi.mock("./render")` barrels are untouched.

- **pen.ts + anchor point math (Tasks 1, 2):** `strokeOutline` (perfect-freehand
  `getStroke`, fixed no-pressure options) + `svgPathFromOutline` (quadratic-smoothed
  `d`); `anchor/normalizePoint` + `denormalizePoint` are the point twins of the rect
  pair (divide/multiply by `box*scale`, clamp01). All pure + unit-tested.
- **buildPenAnnotation + store (Task 3):** a single-page `kind=path` builder (null
  group); store gains `activeStrokeWidth` (default 4) + `setActiveStrokeWidth` +
  `restrokeAnnotation` (the stroke-width twin of `recolorAnnotation`).
- **Gesture capture + preview (Task 4):** a SEPARATE document-level pen path in
  `AnnotationInteraction`, pen-gated, mirroring the Reader pan (draft points in a
  ref + `drawing` state for the live fixed-space SVG preview; `preventDefault` kills
  native selection; pointercancel/blur/Esc abort). pointerup picks the start page
  (`pickPage`), normalizes the points, builds + selects the mark. < 2 points = no
  mark. The selection `pointerup` early-returns for pen.
- **kind=path render (Task 5):** `AnnotationLayer` now switches on `anchor.kind` —
  text → the existing rect divs; path → one filled `<path>` per mark in a new
  full-opacity `.annotation-pens` SVG sheet, `size = stroke_width * scale` (glued +
  thickens with zoom). The path is the 2.5 hit surface; hover/selected add an ink
  SVG stroke.
- **Rail + StrokeWidthRow + D + type-aware box (Task 6):** a Pen rail button (twin
  of the color tools) whose flyout holds `ColorSwatchRow` + the new `StrokeWidthRow`;
  `D` arms it; `Reader` sets `data-draw` (crosshair + `user-select:none`). The 2.5
  selection quick-box is type-aware: a selected pen mark also shows the stroke-width
  row (restroke) and the box anchors below the stroke's bounding box; `.annotation-pen`
  added to both `.closest()` hit-tests so a stroke is selectable/deselectable.

**Regression bar:** client `npm test` 309 passed (25 files; was 267 at 2.7);
`npm run typecheck` clean; server pytest 38 passed; tracked `schema.d.ts`
byte-identical (`git diff --stat` empty); `no-raw-values.test.ts` green; no new
`render/index.ts` export so both `vi.mock("./render")` barrels untouched.

**Live smoke (my OWN fresh servers per CLAUDE.md — uvicorn :8001 + vite :5174,
NOT the user's stale :8000/:5173; real PDF `09-regularization.pdf`, Chrome via
Playwright, DPR 1.25 > 1):**
(a) arm Pen from cursor (button, ONE click) → armed, sub-toolbox auto-opens with
5 color swatches + 3 stroke-width steps, `data-draw` set ✓;
(b) press `D` → arms pen + sets `data-draw` ✓;
(c) pick Green + Thick (arm-time) ✓;
(d) freehand drag over a page → a smooth filled vector stroke lands
(`fill: var(--color-annotation-green)`, path `d` ~3.9k chars), no text selected /
no scroll, and the selection quick-box opens with the color row + stroke-width row
(armed) + delete ✓;
(e) restroke via the quick-box (Thick→Thin) → stroke bbox height 20px → 5px ✓;
(f) **zoom 200% → 250% (×1.25): the stroke stayed glued AND thickened exactly
proportionally — bbox w 628→785, h 46→57, x 237→296, y 611→763, all ×1.25 (NFR-3)** ✓;
(g) click the stroke → reselect (box reopens); (h) `Del` → removed the selected
stroke (path count 2→1) ✓.
Captures: `docs/images/story-2-8-pen-green-live.png`,
`docs/images/story-2-8-pen-strokes-zoomed.png`.
Pen is single-page (no cross-page path), so the cross-page leak risk does not apply;
the live geometry risk (stroke shape + zoom-thickening) was verified at DPR>1.

### File List

- client/package.json (perfect-freehand@1.2.3 dependency)
- client/package-lock.json (lockfile)
- client/src/anchor/index.ts (normalizePoint / denormalizePoint)
- client/src/anchor/anchor.test.ts (point-math tests)
- client/src/annotations/pen.ts (NEW — perfect-freehand wrapper)
- client/src/annotations/pen.test.ts (NEW)
- client/src/annotations/create.ts (buildPenAnnotation)
- client/src/annotations/create.test.ts (buildPenAnnotation tests)
- client/src/annotations/AnnotationInteraction.tsx (pen gesture + preview; type-aware selection box; restroke; pen hit-test)
- client/src/annotations/AnnotationInteraction.test.tsx (pen gesture + pen selection-box tests)
- client/src/annotations/AnnotationLayer.tsx (kind switch; pen SVG path branch)
- client/src/annotations/AnnotationLayer.test.tsx (pen render + hit-surface tests)
- client/src/annotations/Annotations.css (pen group/path + pen-preview + stroke-width-row styles)
- client/src/annotations/StrokeWidthRow.tsx (NEW — pen stroke-width steps)
- client/src/annotations/StrokeWidthRow.test.tsx (NEW)
- client/src/annotations/index.ts (export StrokeWidthRow + buildPenAnnotation)
- client/src/store/index.ts (activeStrokeWidth + setActiveStrokeWidth + restrokeAnnotation)
- client/src/store/index.test.ts (stroke-width + restroke tests)
- client/src/theme/components.css (--pen-stroke-* + --annotation-pen-selected-width tokens)
- client/src/ToolRail.tsx (Pen button + color+width sub-toolbox; PencilSimple icon)
- client/src/ToolRail.test.tsx (pen button + sub-toolbox tests)
- client/src/App.tsx (D hotkey + activeStrokeWidth wiring)
- client/src/App.test.tsx (D keymap test)
- client/src/App.css (.pdf-canvas[data-draw] crosshair + user-select:none)
- client/src/Reader.tsx (data-draw derived from armedTool === "pen")
- client/src/annotations/README.md (Story 2.8 notes)
- server/pyproject.toml (version 0.1.4 → 0.1.5)
- docs/images/story-2-8-pen-green-live.png (live-smoke capture)
- docs/images/story-2-8-pen-strokes-zoomed.png (live-smoke capture — zoom-glue)
- .bmad/implementation-artifacts/2-8-pen-freehand.md (this story)
- .bmad/implementation-artifacts/sprint-status.yaml (status tracking)

## Code Review (cross-model: Codex via `codex exec --sandbox read-only`)

Ran the BMad code-review method (Blind Hunter / Edge Case Hunter / Acceptance
Auditor, merged) through `codex exec --sandbox read-only` against `a1887e07..HEAD`.
No BLOCKER. Verdict: Changes-Requested. All 6 findings triaged as PATCH (none
decision-needed, none deferred) and fixed:

### Review Findings

- [x] [Review][Patch] HIGH — disarm mid-drag could still persist a stroke [client/src/annotations/AnnotationInteraction.tsx]. Switching tool (V/Esc) mid-draft left the draft live, so a late `pointerup` persisted a pen mark after pen was no longer armed. Fixed: a disarm-abort effect clears the draft + preview the moment `armedTool !== "pen"`, and `onUp` re-guards `armedToolRef.current === "pen"` before finalizing. +1 regression test.
- [x] [Review][Patch] HIGH — touch/stylus freehand could scroll instead of draw [client/src/App.css]. `data-draw` suppressed text selection but not browser touch panning. Fixed: added `touch-action: none` to `.pdf-canvas[data-draw]`.
- [x] [Review][Patch] MED — `restrokeAnnotation` wrote `stroke_width` onto any mark, incl. text anchors (AR-5 path-only) [client/src/store/index.ts]. Fixed: guard `a.anchor.kind === "path"` before mutating.
- [x] [Review][Patch] MED — `StrokeWidthRow` emitted raw `px` from component code (token-only-outside-theme spirit) [client/src/annotations/StrokeWidthRow.tsx]. Fixed: the dot size now comes from `--pen-stroke-*` via `.stroke-width-step__dot--{thin,medium,thick}` classes; no px literal in the component.
- [x] [Review][Patch] LOW — a draft could start over the gutter/margin (inside `.pdf-canvas` but no page), showing a preview then dropping the mark on release (pickPage = -1) [client/src/annotations/AnnotationInteraction.tsx]. Fixed: the draft only starts when the pointerdown hits a `.page-surface`.
- [x] [Review][Patch] LOW — `perfect-freehand` declared with a caret despite the AD-2 pin requirement [client/package.json]. Fixed: exact `"perfect-freehand": "1.2.3"` + lockfile resynced.

Post-review: client 310 tests pass (+1), typecheck clean, server pytest 38 pass,
tracked `schema.d.ts` byte-identical, `no-raw-values` green.

## Change Log

- 2026-06-29: Story created (ready-for-dev) via bmad-create-story.
- 2026-06-29: Implemented Story 2.8 (pen / freehand). First non-text tool: a
  freehand pointer-gesture create path in `AnnotationInteraction` with a live
  preview, point math in `anchor/` (`normalizePoint`/`denormalizePoint`), the
  perfect-freehand engine in `pen.ts`, a `kind=path` SVG render branch in
  `AnnotationLayer` (geometry-on-kind, AD-5), `stroke_width` stored at scale 1.0,
  a Pen rail button with a color + stroke-width sub-toolbox + `D` hotkey, and the
  2.5 selection seam extended to recolor / restroke / delete a stroke. Client-only;
  tracked contract byte-identical. Live-smoked on own fresh servers incl. zoom-glue
  (×1.25 exact) + thickening at DPR 1.25. Version 0.1.4 → 0.1.5. Status → review.
- 2026-06-29: Cross-model code review (Codex, read-only) over `a1887e07..HEAD`. No
  BLOCKER; verdict Changes-Requested. Fixed all 6 findings (2 HIGH: disarm-mid-drag
  abort + `touch-action:none`; 2 MED: restroke path-only guard + token-backed
  stroke-width dots; 2 LOW: draft requires a page card + exact-pin perfect-freehand)
  with +1 regression test. Client 310 pass, contract byte-identical. Status → done.
