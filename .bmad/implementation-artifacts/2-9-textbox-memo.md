---
baseline_commit: 5747ec7cd30e747c419393f361ae81d429ef59aa
---

# Story 2.9: Textbox memo

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a reader,
I want a free-floating memo,
so that I type a note onto the page without displacing the text.

> **Memo is the FIRST `kind=rect` mark and the FIRST mark with a `body`, but it reuses every established seam.** Highlight/underline are `kind=text` (built from a selection); pen is `kind=path` (built from a drag gesture). Memo is `kind=rect` (a single box placed by a CLICK) carrying typed text in `body`. The genuinely new pieces are: (1) a click-to-place gesture (not a selection, not a freehand drag), (2) an INTERACTIVE on-page editable box (a `<textarea>`, pointer-events + focus) instead of a pointer-transparent paint mark, and (3) `body` text that updates as you type (a `retextAnnotation` store action, the body twin of `recolorAnnotation`). Everything else is the SAME pattern pen/underline already set: a rail button + `T` hotkey + an arm-time color/size sub-toolbox, the create-then-select flow into the 2.5 selection quick-box (now carrying color + size + delete), and `denormalizeRect` zoom-glue. The contract ALREADY supports memo (`RectAnchor {kind:"rect", page_index, rect}`, `body: string | null`, `type:"memo"` are all in the generated `Annotation`), so this is client-only with the tracked contract byte-identical.

## The decisions that define this story (read before coding)

**1. Memo is placed by a CLICK, not a drag or a selection.** Pen captures a freehand drag; highlight/underline read a text selection. Memo: with memo armed, a single `pointerdown`/click on a page CARD places a default-size box at that point (auto-grows with content), selects it, and focuses its textarea so the user types immediately. (Drag-to-size is OUT — "place a spot" = a click; the box auto-sizes to content. A future story can add drag-to-size.) The gesture lives in `AnnotationInteraction` alongside the pen gesture, gated `armedTool === "memo"`, document-level (AP-1), only over a `.page-surface`.

**2. A memo is an INTERACTIVE editable box, not a paint sheet.** Highlight/underline/pen render in pointer-transparent/paint groups. A memo is a `<textarea>` (native, accessible, focus-managed) positioned via `denormalizeRect` over the page card, `pointer-events:auto`, that the user types into. It overlays the canvas and NEVER displaces page text (NFR-1: absolutely-positioned, no reflow). It lives in a NEW `.annotation-memos` group in `AnnotationLayer` (the per-page mark view), still keyed off `anchor.kind === "rect"` + `type === "memo"` (geometry-on-kind / style-on-type, AD-5).

**3. `body` updates through a `retextAnnotation` store action (the body twin of recolor/restroke).** Create the memo with `body = ""`, then each edit calls `retextAnnotation(id, body, now)`. This is CREATION-TIME editing (client-side, no command stack), exactly like recolor-at-creation (2.6) and restroke (2.8). Re-editing a memo AFTER it is deselected (double-click to re-open) is Story 3.1 (command path) — OUT here. A memo with an empty `body` on blur+deselect is removed (no stray empty boxes) — see Decision 5.

**4. The memo reuses the 2.5 selection quick-box for color + size + delete; the box itself is the inline text-input (FR-10).** On placement the memo is selected, so the selection quick-box opens carrying a `ColorSwatchRow` (memo accent) + a NEW `SizeRow` (box size presets) + delete — the SAME unification pen used (color + width + delete). The "inline text-input" the AC names IS the memo's own `<textarea>`; "color/size" are the quick-box rows. No bespoke memo quick-box.

**5. An empty memo is not persisted.** If the textarea is empty when the memo loses focus / is deselected, delete it (a placed-but-never-typed box is a no-op, not a stray empty mark). A memo with text stays.

## Scope boundary — READ FIRST

**IN (this story):**

- **Memo placement gesture.** In `AnnotationInteraction.tsx`, a document-level path active only while `armedTool === "memo"`: a primary-button `pointerdown` on a `.page-surface` (not chrome/quick-box) places a default-size memo. Compute the card-local rect from the click point + a default box size (scale-1.0 px), `normalizeRect` it against the page box, `buildMemoAnnotation` (`type:"memo"`, `kind:"rect"`, `body:""`, `style.color = activeColor`, plus the chosen size), `addAnnotation`, `select`, and focus its textarea. Single-page (one `page_index`, `group_id` null).
- **`buildMemoAnnotation` in `create.ts` (NEW).** Pure: `{page_index, rect}` + `{now, newId, color, ...size}` → one `type:"memo"`, `kind:"rect"` `Annotation` with `body:""`. Unit-tested.
- **Memo render (interactive textarea).** `AnnotationLayer.tsx`: a `kind=rect`+`type=memo` branch rendering a `<textarea>` (or focusable box) in a new `.annotation-memos` group, positioned by `denormalizeRect` (left/top/width/min-height from the normalized rect × scale), styled per `{component.annotation-memo}` (surface-card bg, `rounded.sm`, hairline-strong border, body-sm). It is the selection hit surface (pointer-events:auto; click selects; the selected ring/treatment applies). Typing calls `retextAnnotation`. The font/box size does NOT reflow the page (absolute overlay). Re-derives on zoom (NFR-3).
- **`retextAnnotation(id, body, now)` store action (NEW).** The body twin of `recolorAnnotation`: set `body` + bump `updated_at`. Plus an empty-on-blur cleanup (Decision 5) via the existing `deleteAnnotation`.
- **`SizeRow` component (NEW) + `activeMemoSize` store state.** A step row of box-size presets (e.g. S/M/L → a scale-1.0 px width/min-height), mirroring `StrokeWidthRow` (`value` + `onPick`; armed step ringed; keyboard-reachable). `activeMemoSize` is the sticky session default (last-choice-wins), with `setActiveMemoSize` + a `resizeMemoAnnotation(ids, size, now)` (guarded `kind=rect`+`type=memo`). Size tokens in `components.css`.
- **Memo rail button + `T` hotkey + arm-time color/size sub-toolbox.** `ToolRail.tsx`: a Memo `.tool-rail__item` below Pen (DESIGN.md#tool-rail order: cursor, highlight, underline, pen, memo, …), the twin of the color tools, its `ToolFlyout` holding `ColorSwatchRow` + `SizeRow`. Phosphor `TextT` (or `NoteBlank`/`Textbox`) glyph, `aria-label="Memo"`, `title="Memo (T)"`. In `App.tsx`'s document-level keydown, add `T`/`t` → `setActiveTool("memo")` next to `H`/`U`/`D` (UX-DR15: `T` = memo).
- **Selection quick-box gains memo support.** The 2.5 quick-box already shows `ColorSwatchRow` + delete (and the 2.8 pen `StrokeWidthRow`). Add: for a selected `type=memo` mark, show `ColorSwatchRow` + `SizeRow` + delete; the box anchors below the memo box. Add `.annotation-memo` to BOTH `.closest(...)` hit-test selectors so a memo is selectable/deselectable.
- **Color application.** The memo's `style.color` tints its accent (e.g. the border color / a left accent strip) via `var(--color-${color})`, default `activeColor` — exactly like the highlight fill / underline line use `style.color`. The body text stays ink (`{colors.ink}`); only the accent is colored.
- **Accessibility + no-canvas-shift.** The textarea is keyboard-reachable and focus moves into it on create; `Esc` blurs/deselects (does not delete a non-empty memo); the box overlays and never reflows (NFR-1).

**OUT (later stories / do NOT build):**

- **Comment / box-select tools** (2.10–2.11) and their rail buttons. Only memo this story.
- **Re-edit a memo's text after it is deselected** (double-click to re-open the textarea) — Story 3.1 (edit command path). This story types into the memo at CREATION time; once deselected, re-editing the text is 3.1.
- **Move / resize the memo by dragging** (handles) — Story 3.1. (Size here is the preset `SizeRow`, set at arm-time or via the quick-box; it is a style preset, not a drag-resize.)
- **Drag-to-size on placement** — "place a spot" is a click; the box auto-sizes to content. Drag-to-size is a future refinement.
- **Persistence / command stack / undo** — Epic 3. Create / retext / recolor / resize / delete stay client-side, reusing/extending the store actions.
- **Any anchor-MODEL / Pydantic / endpoint / generated-type change.** `RectAnchor`, `body`, `type:"memo"` are ALREADY generated. `server/openapi.json` (tracked fields) + `client/src/api/schema.d.ts` stay byte-identical.

## Acceptance Criteria

1. **Memo armed → click places an `{component.annotation-memo}` box with an inline text-input; typing does not displace page text (epics.md#Story-2.9 AC1; FR-10, UX-DR7).** With memo armed (rail button or `T`), clicking a page places a free-floating memo box (DESIGN `annotation-memo`: surface-card bg, `rounded.sm`, hairline-strong border, body-sm text) whose `<textarea>` is focused for immediate typing. The box overlays the canvas and the page does NOT reflow/shift (NFR-1). [Source: epics.md#Story-2.9; DESIGN.md#annotation-memo, #text-input; AnnotationInteraction.tsx (memo gesture); AnnotationLayer.tsx (memo render)]

2. **The memo stores as `type=memo`, `anchor kind=rect {rect}`, `body=text` non-null (epics.md#Story-2.9 AC2; AR-5).** Placement creates `Annotation {type:"memo", anchor:{kind:"rect", page_index, rect}, style:{color}, body}` via `buildMemoAnnotation`; `body` is non-null (starts `""`, updated as the user types through `retextAnnotation`). Rect is normalized `[0,1]` against the page box (scale-independent). [Source: epics.md#Story-2.9; ARCHITECTURE-SPINE.md#AD-5 (`memo → rect`, `body` non-null for memo/comment); create.ts (buildMemoAnnotation); anchor/normalizeRect]

3. **The memo quick-box offers inline text + color/size (epics.md#Story-2.9 AC3; UX-DR5).** The memo's own textarea IS the inline text; on placement the memo is selected so the selection quick-box opens with a `ColorSwatchRow` (memo accent) + a `SizeRow` (box-size presets) + delete. Color writes through `recolorAnnotation`, size through `resizeMemoAnnotation`, both updating the sticky session defaults (last-choice-wins); delete removes the memo. [Source: epics.md#Story-2.9; UX-DR5 (memo → inline text-input + color/size); AnnotationInteraction.tsx (selection quick-box); Stories 2.5/2.6/2.8]

4. **The memo box stays anchored across zoom (epics.md#Story-2.9 AC3; NFR-3).** After placing a memo, zooming re-renders it at the exact page location and scale (the box rides the denormalized rect via `denormalizeRect`); screen position derived, never persisted. Prove LIVE at DPR>1. [Source: epics.md#Story-2.9; ARCHITECTURE-SPINE.md#AD-4; AnnotationLayer.tsx]

5. **Memo is a first-class tool in the single `activeTool` FSM (AD-11).** The rail has a Memo button below Pen (DESIGN.md#tool-rail order); clicking it switches `activeTool` to `"memo"` in ONE click; `T` arms it; `V`/`Esc` returns to cursor; arming memo disarms whatever was active (mutual exclusion). Switching TO memo auto-opens its color/size sub-toolbox (reusing `ToolFlyout` + the shared `flyoutOpen` + the open-on-tool-change effect). A click on the already-active button toggles it; `Esc`/outside-click/switch-away/collapse close it. While memo is armed, pan is off and a click places a memo (not a text selection / pan). [Source: ARCHITECTURE-SPINE.md#AD-11; tools.ts (`ANNOTATION_TOOLS` includes "memo"); UX-DR4/DR15; ToolRail.tsx; Story 2.6]

6. **Geometry-on-kind / style-on-type honored; empty memos are not persisted; client-only + contract preserved (AD-5, AD-9, AD-3).** Render branches on `anchor.kind === "rect"` (a box), not `type`; the accent paint keys off `style.color`. An empty memo (no text on blur/deselect) is removed (Decision 5). No store-SCHEMA / persisted-model / anchor-model / API change — `RectAnchor`/`body`/`type:"memo"` already exist, so `server/openapi.json` (tracked) + `client/src/api/schema.d.ts` stay byte-identical. No new `render/index.ts` export (both `vi.mock("./render")` barrels untouched). `no-raw-values` green (size tokens live in `src/theme/**`). Highlight/underline/pen create+select+restyle+delete, pan, zoom-glue do not regress. [Source: ARCHITECTURE-SPINE.md#AD-5, #AD-9, #AD-3; CLAUDE.md#Engineering-principles, #Design-conventions]

## Tasks / Subtasks

- [x] **Task 1 — buildMemoAnnotation + store actions (AC: 1, 2, 3)**
  - [x] `client/src/annotations/create.ts`: add `buildMemoAnnotation({page_index, rect}, docId, {now, newId, color})` → one `type:"memo"`, `group_id:null`, `anchor:{kind:"rect", page_index, rect}`, `style:{color, stroke_width:null}`, `body:""`. (Size maps to the rect dimensions, no contract field.) Unit-tested.
  - [x] `client/src/store/index.ts`: added `retextAnnotation(id, body, now)`; `activeMemoSize` (default = the medium preset, via `MEMO_SIZES`/`DEFAULT_MEMO_SIZE`) + `setActiveMemoSize`; `resizeMemoAnnotation(ids, {w,h}, now)` guarded `anchor.kind === "rect" && type === "memo"`. Added `activeMemoSize` to the `beforeEach` reset; tests for retext, resize (incl. guard + clamp), setActiveMemoSize.

- [x] **Task 2 — Memo placement gesture (AC: 1, 2)**
  - [x] `client/src/annotations/AnnotationInteraction.tsx`: a document-level memo path, active only while `armedTool === "memo"`. Primary-button `pointerdown` on a `.page-surface` resolves the page (`pickPage`), builds the `activeMemoSize` rect at the card-local click, `normalizeRect`, `buildMemoAnnotation`, `addAnnotation`, `select`, `preventDefault`. The textarea autofocuses on select (layer). Memo added to the pointerup early-return so it never falls through to the text/proof path.
  - [x] Placement gated off `.annotation-memo` (clicking an existing memo selects it, no overlapping second box).

- [x] **Task 3 — Memo render (interactive textarea) (AC: 1, 4, 6)**
  - [x] `client/src/annotations/AnnotationLayer.tsx`: `kind=rect`+`type=memo` branch renders a `<textarea>` in a NEW, NOT aria-hidden `.annotation-memos` group, positioned via `denormalizeRect` (left/top/width/min-height), `value = body`, `onChange` → `retextAnnotation`, auto-grow on input, pointer-events + select/hover, autofocus when selected. `data-testid={`annotation-mark-${a.id}`}` kept.
  - [x] `client/src/annotations/Annotations.css`: `.annotation-memos` group + `.annotation-memo` box per `{component.annotation-memo}` (surface-card, radius-sm, hairline-strong border, body-sm) with accent border inline from `style.color`; hover/selected rings. Tokens only.
  - [x] Empty-memo cleanup (Decision 5): on DESELECT (selectedId moves off a memo with blank body), `deleteAnnotation` — keyed on deselect, not raw blur, so a quick-box swatch click mid-edit can't nuke it.

- [x] **Task 4 — Memo rail button + SizeRow + T hotkey + selection quick-box (AC: 3, 5)**
  - [x] `client/src/annotations/SizeRow.tsx` (NEW): a COLLAPSIBLE size picker (trigger + dropdown of S/M/L) — per the user's fix request, the memo size control ships collapsible from the start (the pen StrokeWidthRow conversion is a separate follow-up). `data-testid="memo-size-trigger"` + `memo-size-<key>`. Exported from `annotations/index.ts`. Size dims/preview tokens in `components.css`.
  - [x] `client/src/ToolRail.tsx`: a Memo `.tool-rail__item` below Pen — armed class, `aria-label="Memo"`, `title="Memo (T)"`, `aria-haspopup`/`aria-expanded`, `data-testid="tool-memo-button"`, toggle-on-active, `ToolFlyout testId="memo-flyout"` with `<ColorSwatchRow>` + `<SizeRow>`. Phosphor `TextT`. Threads `activeMemoSize`/`onPickMemoSize`.
  - [x] `client/src/App.tsx`: `T`/`t` → `setActiveTool("memo")` next to `D`. Subscribes `activeMemoSize`/`setActiveMemoSize`; passes to `ToolRail`.
  - [x] `client/src/annotations/AnnotationInteraction.tsx`: the selection quick-box is type-aware (memo → color + size + delete). Added the `kind=rect` branch to `showSelectionBox` + `selectionPoint` (anchor below the box), the `SizeRow` in the box body (→ `resizeMemoAnnotation` + set default), and `.annotation-memo` to BOTH `.closest(...)` hit-tests. Memo box exempted from the quick-box focus-grab (its textarea owns focus).

- [x] **Task 5 — Tests + regression bar (AC: all)**
  - [x] `create.test.ts`: `buildMemoAnnotation` shape (`type:"memo"`, `kind:"rect"`, `body:""`, null group, color, null stroke).
  - [x] `store/index.test.ts`: `retextAnnotation` (+ unknown-id), `resizeMemoAnnotation` (+ non-memo guard + page clamp), `setActiveMemoSize` default + remember.
  - [x] `AnnotationInteraction.test.tsx`: memo gesture (place type=memo/kind=rect, empty body, active color, size preset, selects + opens quick-box w/ color+size+delete), memo-gated, chrome-click no-op, existing-memo no second box, empty-on-deselect removal, text survives, resize/recolor/Del via the quick-box. Pen/highlight/underline/cursor paths still pass.
  - [x] `AnnotationLayer.test.tsx`: a `type=memo` mark renders a `<textarea>` in `.annotation-memos` (not highlight/pen groups), `annotation-mark-<id>`, selectable + hover/selected classes, value = body, re-derives on zoom, no group when no memos.
  - [x] `ToolRail.test.tsx`: Memo arms in one click; `memo-flyout` shows swatch row + collapsible size picker; pick color/size fires callbacks + closes; toggle/Esc/switch-away close it.
  - [x] `App.test.tsx`: `T` arms `"memo"`; `V`/`Esc` return to cursor; new `activeMemoSize`/`onPickMemoSize` props threaded (no new `render/` export → both `vi.mock("./render")` barrels untouched, confirmed).
  - [x] `SizeRow.test.tsx`: collapsed trigger, opens to 3 steps, arms `value`, `onPick` fires + collapses.
  - [x] Full regression: client `343 passed (26 files)` + `typecheck` clean; server `38 passed`. Contract byte-identical (`git diff --stat client/src/api/schema.d.ts` empty). `no-raw-values` `35 passed`.
  - [x] **Live smoke** (own fresh `uvicorn` :8071 + `vite dev` :5199, `09-regularization.pdf`, DPR=2): (a) arm Memo from cursor (one click) → flyout opens with color + collapsible size ✓; (b) `T` arms memo ✓; (c) click page → focused box, typed text shows, page NOT displaced ✓; (d) quick-box has color + size + delete; recolor + resize live (large 750px ↔ small 400px at 250%) ✓; (e) zoom 200→250% → memo glued (fracLeft 0.6703→0.6701, fracW 0.3304→0.3304 invariant) ✓; (f) empty memo on deselect vanishes, text memo stays ✓; (g) Del deletes ✓; (h) highlight still creates + selects ✓. Screenshot: `.bmad/implementation-artifacts/2-9-memo-smoke.png`.

- [x] **Task 6 — Docs (AC: all)**
  - [x] No `/api` change → `docs/API.md` untouched.
  - [x] Updated `client/src/annotations/README.md` with the Story 2.9 memo section (first `kind=rect`+`body` tool, click-placed interactive `<textarea>`, `retextAnnotation`, size-is-the-rect, collapsible `SizeRow`, empty auto-removal, AD-5).

## Dev Notes

### What this adds vs reuses

| Need | Reuse | New |
| --- | --- | --- |
| Normalized rect math + zoom-glue | `normalizeRect`/`denormalizeRect` (anchor/) | nothing |
| Entity + contract | `RectAnchor`/`body`/`type:"memo"` already generated | `buildMemoAnnotation` |
| Page assignment | `pickPage` | reuse on the click point |
| Tool state / mutual exclusion | `activeTool` FSM (`"memo"` already in union) | Memo rail button + `T` |
| Arm-time sub-toolbox | `ToolFlyout` + `flyoutOpen` + `ColorSwatchRow` | add `SizeRow`; memo flyout = color + size |
| Post-create restyle | the 2.5 selection quick-box (color + delete) | type-aware: + `SizeRow`; box-anchor for a rect |
| Active defaults | `activeColor` | `activeMemoSize` + `setActiveMemoSize` |
| Mark render | per-page sheet, denormalize-on-zoom | an INTERACTIVE `<textarea>` group + `retextAnnotation` |
| Gesture | the pen gesture pattern (document-level, page-gated) | a CLICK-to-place (not drag/selection) |

Resist: a contract field for memo size (map size to the rect dims, client-side); a bespoke memo quick-box (reuse the selection seam); drag-to-size or drag-move (3.1); re-edit-after-deselect (3.1); putting memo logic in `render/` (it is an annotations/ view).

### Decision notes

- **Where memo "size" lives:** the box size is just the `rect` dimensions (normalized). The `SizeRow` preset picks a scale-1.0 px box size; placement builds the rect at that size; `resizeMemoAnnotation` rewrites the rect's width/height (keeping the top-left anchor). So size needs NO contract field — it is the rect. `activeMemoSize` is a client default only.
- **textarea vs contentEditable:** prefer `<textarea>` (native a11y, no rich-text surprises, value/onChange is clean). Style it to look like `{component.annotation-memo}`.
- **Empty-memo cleanup (Decision 5):** delete on blur when `body.trim()===""`. This avoids a placed-but-abandoned empty box. A memo with text persists; deselect keeps it.
- **Accent color:** memo paints the ACCENT (border) in `style.color`; the body text stays `{colors.ink}` (memos are for reading notes, not colored text). Matches DESIGN (`annotation-memo` border is `hairline-strong` by default; the chosen accent replaces/augments it).

### Integration points (the seams)

- `client/src/annotations/create.ts` — add `buildMemoAnnotation` (sibling of `buildAnnotations`/`buildPenAnnotation`).
- `client/src/annotations/AnnotationInteraction.tsx` — add the memo click-place path (twin of the pen gesture, but a click); make the selection quick-box memo-aware (`showSelectionBox`/`selectionPoint`/body + `.annotation-memo` in the two `.closest()` hit-tests); a `resizeSelected`/`retext` wiring.
- `client/src/annotations/AnnotationLayer.tsx` — the `kind` switch (text rects / pen path from 2.8) gains a `kind=rect`+memo `<textarea>` branch + `.annotation-memos` group.
- `client/src/store/index.ts` — `retextAnnotation`, `activeMemoSize` + `setActiveMemoSize`, `resizeMemoAnnotation` (twins of the recolor/restroke/activeStrokeWidth lines).
- `client/src/annotations/SizeRow.tsx` (NEW) + `annotations/index.ts` export.
- `client/src/ToolRail.tsx` — Memo button + color/size flyout; thread `activeMemoSize`/`onPickMemoSize`.
- `client/src/App.tsx` — `T` key + `activeMemoSize` wiring.
- `client/src/theme/components.css` — memo size tokens; `client/src/annotations/Annotations.css` — `.annotation-memos`/`.annotation-memo`.
- `client/src/tools.ts` — `ANNOTATION_TOOLS` already has `"memo"`; no change.

### Engineering conventions in force (CLAUDE.md#Engineering-principles)

- **Adopt-stable / one model:** reuse `normalizeRect`/`denormalizeRect`, `pickPage`, `ToolFlyout`, `ColorSwatchRow`, the selection seam, `activeColor`. New = `buildMemoAnnotation`, `SizeRow`, `retext`/`resize` store actions, the textarea render. One `activeTool`, one `activeColor`, one `activeMemoSize`. [[prefer-stable-solutions]]
- **Document-level handlers (AP-1):** the `T` key joins App's document-level keydown (phase-gated, editable/buttons exempt); the memo place gesture binds on `document`, page-gated. The textarea is an editable field → it is EXEMPT from the document-level tool/selection keys (typing `t`/`v`/`Del` inside the memo must NOT arm tools or delete the mark — verify the `isExempt` guards cover the textarea). [[held-key-state-reset-on-blur]]
- **`render/` mock-barrel sync (AP-2):** no new `render/index.ts` export → both barrels untouched. Confirm.
- **HiDPI live smoke:** memo is a placed-geometry + editable feature; live-smoke placement, typing (no page displacement), zoom-glue, and empty-cleanup at DPR>1. [[verify-on-hidpi-and-real-host]]
- **Cross-model code review (AP-3):** run `bmad-code-review` (Codex) after dev-story.

### Testing standards

- Frontend Vitest + jsdom: assert the MODEL/wiring — the create call (`type`/`kind`/`body`), the layer's textarea + group, `retext`/`resize` store writes, the rail flyout + `activeTool` switch, the `T` keymap, the empty-cleanup — NOT pixel geometry (jsdom zeroes rects). Reuse the fake-card pattern; drive the textarea via `fireEvent.change`.
- Backend pytest: no model/contract change; run to confirm no regression.

### Project Structure Notes

- New files: `annotations/create.ts` (extend), `annotations/SizeRow.tsx` (+ test), edits to `AnnotationInteraction.tsx` (+ test), `AnnotationLayer.tsx` (+ test), `Annotations.css`, `annotations/index.ts`, `store/index.ts` (+ test), `theme/components.css`, `ToolRail.tsx` (+ test), `App.tsx` (+ test), `annotations/README.md`. No new top-level dirs. `machine.ts`/`tools.ts`/`render/`/anchor/api-schema unchanged. [Source: ARCHITECTURE-SPINE.md#Structural-Seed]
- Layer rule (AD-9): touches the App composition root (`T` key, size prop), the rail (Memo button), and `annotations/` (gesture, create, layer, store actions). No `render/`/anchor/store-SCHEMA/contract change.

### Versioning

- PATCH +1 at done: `server/pyproject.toml` `0.1.5 → 0.1.6` (single source). Bump once at done.

### References

- [Source: .bmad/planning-artifacts/epics.md#Story-2.9] — story + the four ACs (place a memo box with inline text-input, no page displacement; stores type=memo/kind=rect/body; quick-box offers inline text + color/size; stays anchored on zoom).
- [Source: ARCHITECTURE-SPINE.md#AD-5] — `memo → rect`; `body` non-null for memo/comment; geometry-on-kind / style-on-type.
- [Source: ARCHITECTURE-SPINE.md#AD-4] — page-normalized rect + zoom re-derivation (NFR-3).
- [Source: ARCHITECTURE-SPINE.md#AD-11] — single `activeTool`; single-click switch.
- [Source: ARCHITECTURE-SPINE.md#AD-12, #AD-9, #AD-3] — selection seam; layering; contract stability (no API/Pydantic/generated-type change; `RectAnchor`/`body`/`type:"memo"` already exist).
- [Source: DESIGN.md#annotation-memo, #text-input, #tool-rail, #quick-box] — memo box (surface-card, rounded.sm, hairline-strong, body-sm); rail tool order (memo below pen); memo-mode quick-box = inline text-input + color/size.
- [Source: UX-DR4/DR5/DR7/DR15] — tool rail, contextual quick-box (memo → inline text + color/size), on-page memo rendering, `T` keymap.
- [Source: .bmad/implementation-artifacts/2-8-pen-freehand.md] — the rail-button/flyout twin pattern, the create-then-select-into-quick-box flow, the type-aware selection quick-box, the store action twins (`restrokeAnnotation`/`activeStrokeWidth`) memo mirrors with `retext`/`resize`/`activeMemoSize`.
- [Source: CLAUDE.md#Engineering-principles, #Design-conventions, #Versioning].

## Previous Story Intelligence

From Story 2.8 (pen, done) + its Codex review + the Epic-2 pattern:

- **Type-aware selection quick-box is the established extension point.** Pen added a width row + a path box-anchor; memo adds a size row + a rect box-anchor + the `.annotation-memo` hit-test entry. Follow that shape exactly; do not fork a new quick-box.
- **Codex caught: disarm/inverse paths + token discipline + guarded store mutations.** Mirror the lessons: the memo place gesture must abort cleanly / not fire when memo is disarmed; `resizeMemoAnnotation`/`retextAnnotation` must guard the mark kind/type; size tokens live in `src/theme/**` (no raw px in components, e.g. drive textarea/box dims from CSS classes backed by tokens, like the pen `--pen-stroke-*` fix).
- **Editable field exemption is critical here (NEW risk).** The memo textarea is the first editable field ON the page. The document-level tool keys (`H`/`U`/`D`/`T`/`V`) and selection keys (`Del`/`Backspace`/`Esc`) MUST be exempt when focus is in the textarea (the `isExempt` TEXTAREA guard already exists — verify it covers the memo, so typing "t" doesn't arm memo and `Del` deletes a character, not the mark).
- **Live smoke is the real verifier; jsdom zeroes geometry.** Verify placement, typing-without-page-shift, zoom-glue, and empty-cleanup on a real host at DPR>1.
- **Launch your OWN dev servers; contract byte-identical discipline; cross-model review after.**

## Git Intelligence

- Baseline: `5747ec7` (Feat: Add Pen Freehand Annotations (#17)) on `main`. The anchor rect math, `pickPage`, the `activeTool` FSM (`"memo"` already in the union), the 2.5 selection seam, the 2.6 `ToolFlyout`/`ColorSwatchRow`/`activeColor`, and the 2.8 pen pattern (type-aware quick-box, store-action twins, the `kind` render switch) are all merged. This story adds the first `kind=rect`+`body` tool by cloning those seams + an interactive textarea.
- Branch off `main` (never commit to `main`). Dev loop = host two-process flow (`uvicorn --reload` + `vite dev`).
- No contract change → keep `client/src/api/schema.d.ts` byte-identical (verify after the suite).

## Project Context Reference

- Two processes, one container (AD-1/AD-10): `client/` (React 19.2 + Vite 8 + TS 6.0) + `server/` (FastAPI + Pydantic v2). v1 scope = Phase 1; no auth, localhost single-user.
- Client layering (AD-9): `render → anchor → annotations → store → api`, strict downward. Memo touches the App root (`T` key, size prop), the rail (Memo button), and `annotations/` (gesture, create, layer, store actions). No `render/`/anchor/store-SCHEMA/contract change.
- `anchor.kind` (AD-5) is the geometry discriminator — `rect` is memo's branch (a placed box). `activeColor` (store) + the NEW `activeMemoSize` are the shared defaults the create path reads.

## Story Completion Status

Ultimate context engine analysis completed - comprehensive developer guide created. Memo is the first `kind=rect` + `body` tool but reuses every Epic-2 seam; five design calls are pre-resolved (1 — click-to-place a default box, not a drag/selection; 2 — an interactive `<textarea>`, not a paint sheet; 3 — `body` via `retextAnnotation`, creation-time, re-edit-after-deselect is 3.1; 4 — color/size via the 2.5 selection quick-box + an arm-time flyout, the box itself is the inline text-input; 5 — empty memos are auto-removed on blur). The contract already carries memo (`RectAnchor`/`body`/`type:"memo"`), so this is client-only with the tracked contract byte-identical. Success = memo is a first-class tool (rail button below Pen + `T` + a color/size sub-toolbox), a click places a free-floating box you type into without displacing the page, it stores `type=memo`/`kind=rect`/`body`, the 2.5 selection quick-box recolors/resizes/deletes it, it stays glued across zoom, empty memos vanish, the textarea is keyboard-accessible and exempt from the tool/selection keys, and the live smoke passes placement + typing + zoom-glue + cleanup at DPR>1 without regressing highlight/underline/pen/pan/zoom.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (bmad-dev-story).

### Debug Log References

- ToolRail memo toggle test initially failed: re-arming `memo` when already `memo` does not re-pop the flyout (no `activeTool` change). Fixed the test to switch away (`cursor`) then back, mirroring the pen test.
- Live smoke methodology note: synthetic same-JS-turn clicks batch under React, so rapid-fire placements coalesce the empty-memo cleanup transitions (intermediates skipped). Real per-tick clicks clean each prior empty memo correctly; verified by driving placement/deselect in separate turns. Also: while memo is armed, a pointerdown places a memo (it does not deselect), so deselect-to-clean requires switching to cursor or pressing Esc first.

### Completion Notes List

- Memo is the first `kind=rect` mark and the first with a non-null `body`. Client-only; the contract (`RectAnchor`/`body`/`type:"memo"`) was already generated, so `client/src/api/schema.d.ts` + `server/openapi.json` are byte-identical.
- Size IS the rect (no contract field, AD-5): `SizeRow` preset (scale-1.0 px) → baked into the rect at placement; `resizeMemoAnnotation` rewrites width/height normalized against the page, keeping the top-left, clamped to `<=1`. `activeMemoSize` is the sticky client default.
- Per the user's mid-story fix request, the memo `SizeRow` ships as a COLLAPSIBLE single control (not a step row). The twin conversion of the pen `StrokeWidthRow` was logged to `deferred-work.md` as a focused follow-up (user-chosen sequencing).
- Empty-memo cleanup (Decision 5) is keyed on DESELECT, not a raw textarea blur, so clicking a quick-box swatch/size mid-edit (which blurs the textarea) does not delete the memo.
- Memos render in their OWN, NOT aria-hidden `.annotation-memos` group — a focusable `<textarea>` cannot live in the decorative aria-hidden mark sheet.
- Five async user requests arrived during the story and were logged to `.bmad/implementation-artifacts/deferred-work.md`: per-tool remembered color; custom-color picker ("More colors" sliding-window UX); collapsible pen stroke-width control; movable/drag-resizable memo + transparent-by-default background; layered Esc (cancel selection/empty memo first, then fall back to cursor).
- Regression: client `343 passed`, typecheck clean, server `38 passed`, `no-raw-values` green, contract byte-identical. Live-smoked at DPR=2 on `09-regularization.pdf` (placement w/o page displacement, typing, zoom-glue invariant, empty-cleanup, Del, resize, highlight regression). Screenshot: `2-9-memo-smoke.png`.

### File List

- client/src/annotations/create.ts (buildMemoAnnotation)
- client/src/annotations/create.test.ts
- client/src/store/index.ts (MemoSize/MEMO_SIZES/DEFAULT_MEMO_SIZE, activeMemoSize, retextAnnotation, resizeMemoAnnotation)
- client/src/store/index.test.ts
- client/src/annotations/AnnotationInteraction.tsx (memo place gesture, empty-cleanup, type-aware quick-box + SizeRow, hit-tests)
- client/src/annotations/AnnotationInteraction.test.tsx
- client/src/annotations/AnnotationLayer.tsx (memo textarea render + .annotation-memos group)
- client/src/annotations/AnnotationLayer.test.tsx
- client/src/annotations/SizeRow.tsx (NEW, collapsible)
- client/src/annotations/SizeRow.test.tsx (NEW)
- client/src/annotations/index.ts (SizeRow + buildMemoAnnotation exports)
- client/src/annotations/Annotations.css (.annotation-memos/.annotation-memo + .size-row styles)
- client/src/annotations/README.md (Story 2.9 section)
- client/src/ToolRail.tsx (Memo button + flyout)
- client/src/ToolRail.test.tsx
- client/src/App.tsx (T hotkey + activeMemoSize wiring)
- client/src/App.test.tsx
- client/src/theme/components.css (memo + size-row tokens)
- server/pyproject.toml (version 0.1.5 → 0.1.6)
- server/uv.lock (version bump resolution)
- .bmad/implementation-artifacts/deferred-work.md (5 logged requests)
- .bmad/implementation-artifacts/sprint-status.yaml (2-9 → in-progress → review)
- .bmad/implementation-artifacts/2-9-memo-smoke.png (NEW, live-smoke screenshot)

## Change Log

- 2026-06-29: Story created (ready-for-dev) via bmad-create-story.
- 2026-06-29: Implemented memo tool (first kind=rect + body): buildMemoAnnotation, retext/resize/activeMemoSize store actions, click-to-place gesture, interactive textarea render, collapsible SizeRow, Memo rail button + T hotkey, type-aware selection quick-box, empty-memo cleanup. Full suite green (client 343, server 38), contract byte-identical, live-smoked at DPR=2. Version 0.1.5 → 0.1.6. Status → review. (bmad-dev-story)
- 2026-06-29: Cross-model code review (Codex, bmad-code-review). Verdict Changes-Requested; 1 HIGH, 2 MEDIUM, 1 LOW, all real. Resolved: (MED) Esc inside the memo textarea now blurs + clears the selection (local onKeyDown in the new MemoBox); (MED) memo auto-grow moved from onInput to a layout effect keyed on body+geometry so long text re-fits after zoom/remount (extracted MemoBox component); (LOW) the selection size picker now derives the armed step from the selected memo's rect, not the session default. Dismissed with user sign-off: (HIGH) deselected memos stay editable — accepted as consistent with all Epic-2 client-only edits; the command-path formalization is logged to deferred-work for Story 3.1. Suite green (client 345, server 38), no-raw-values green, contract byte-identical. (bmad-code-review follow-up)
