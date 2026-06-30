---
baseline_commit: f4fee51
---

# Story 2.11: Box-select a region

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a reader,
I want to box-select an area,
so that I can mark a region, not just text.

> **Box-select is a region HIGHLIGHT (box-highlight), NOT a marquee that group-selects existing marks.** A drag draws a rectangle over the page (a figure, a table, an equation), and on release the area is marked. It is the FIRST mark built from a free RECTANGLE DRAG (pen drags a freehand path; memo places a box by a single click; highlight/underline/comment read a text selection). Box-select reuses the pen drag-gesture shape (pointerdown → pointermove preview → pointerup commit) but builds a `kind=rect` BOUNDING rect from the two drag corners instead of a path. The created mark is a region highlight (`type=highlight`, `kind=rect`) — a ~0.4 fill over the area — and the region quick-box is a TOOL-TYPE picker that can switch it to a region comment (`type=comment`, `kind=rect`: the area gets a pin + bubble). Snapshot is the third region action, reserved for Phase 2 — do NOT build it. The contract ALREADY carries both pairings (AR-5: `highlight → text|rect`, `comment → text|rect`), so this is CLIENT-ONLY with the tracked contract byte-identical.

> **⚠️ POST-REVIEW REVISION (2026-06-30, supersedes the design below).** After the first implementation (commit `fbc4b15`) the user redirected the design. The decisions, ACs, tasks, and Dev Agent Record below describe the AS-FIRST-BUILT shape and are kept as history; the SHIPPED behavior is now:
> - **Box-highlight is a MODE of the Highlight tool, NOT a pointer tool.** `box` was REMOVED from `POINTER_TOOLS` (`tools.ts` now `cursor`/`hand` only). It is a `boxHighlight` flag App threads down, gated `boxActive = activeTool === "highlight" && boxHighlight`. AD-11 (single `activeTool` source of truth) is preserved — box-highlight is not a competing `ActiveTool` value. App resets `boxHighlight` to false whenever the active tool leaves Highlight.
> - **The control lives INSIDE the Highlight flyout** (`highlight-box-toggle`, `role="menuitemcheckbox"`), positioned FIRST (above the color swatches) with a hairline divider (`.tool-flyout__divider`) between. Icon is Phosphor `BoundingBox`. Toggling does NOT close the flyout. There is no cursor-flyout "Box select" entry.
> - **`M` arms Highlight + box mode** (`setActiveTool("highlight"); setBoxHighlight(true)`), not a `box` tool.
> - **box-comment and the region tool-type picker are REMOVED.** No region quick-box, no `retypeRegion` (deleted from the store). A box drag always creates a `type=highlight` / `kind=rect` region; it lands selected and the Story 2.5 selection quick-box (recolor + delete) takes over. The `kind=rect` fill branch in `AnnotationLayer` still also serves the Story 2.10 `type=comment` rect pins.
> - **Version:** PATCH bumped again to `0.1.9` for the relocation fix.
> - **Revision commits:** `f97881d` (relocate + drop box-comment), `3c3e4af` (flyout reorder + divider + `BoundingBox` icon). Live-smoked at DPR>1 (drag region → selection box, no picker; `M`/`H`/`Esc` paths; flyout order). 391 client tests green, typecheck + build clean.
> - **Revision file touch (beyond the as-built File List):** `tools.ts`, `App.tsx`, `Reader.tsx`, `ToolRail.tsx` (+test), `ToolFlyout.tsx`, `App.css`, `AnnotationInteraction.tsx` (+test), `store/index.ts` (+test), `create.ts` (+test), `tools.test.ts`, `App.test.tsx`, `annotations/README.md`.

## The decisions that define this story (read before coding)

**1. Box-select is a DRAG that builds a bounding rect — clone the pen gesture, emit a rect not a path.** The pen gesture (`AnnotationInteraction.tsx`, gated `armedTool === "pen"`) is the template: document-level (AP-1), pointerdown over a `.page-surface` starts a draft, pointermove accumulates + drives a live preview, pointerup commits. Box-select is the same shape gated on the POINTER tool `activeTool === "box"` (not an `armedTool` — `box` is a `PointerTool`, see Decision 5): pointerdown records the start corner, pointermove rubber-bands a preview rect (start corner → current point), pointerup builds the rect from the two corners, **canonicalized** (`x0 ≤ x1, y0 ≤ y1` — a negative/up-left drag normalizes, PRD#Anchor "negative drags normalized"), clamped to the page the pointerdown landed on, `normalizeRect` against that page box. Single-page (one `page_index`, `group_id` null — a region is one page by definition, no cross-page split). A too-small drag (below a small px threshold, the pen's same abort guard) commits NOTHING (a stray click while box is armed is not a zero-area region).

**2. On release the region is created as a region HIGHLIGHT (default), selected, and the region quick-box pops a tool-type picker.** This keeps AC1 literally true (the drag-release creates a `kind=rect` region) AND makes the common case — box-highlight a figure — a single drag with no required follow-up. `buildRegionAnnotation` builds `type=highlight`, `kind=rect`, `style.color = activeColor`, `body=null`; `addAnnotation`, `select`. Because it is selected, the **region quick-box** opens (a NEW small picker, NOT the recolor quick-box) offering the region tool-type picker: **Highlight / Comment** (snapshot reserved Phase 2 — not rendered). Highlight is a no-op confirm (it already is one). Comment switches the mark to a region comment. Dismiss (outside-click / `Esc` / pick) keeps the default highlight region. [Genuine design call I made: commit-on-release defaulting to highlight, rather than commit-on-pick with nothing until you choose. Rationale: the story intent is "mark a region" = box-HIGHLIGHT (the user confirmed this), the codebase has only create-then-select precedents (memo 2.9, comment 2.10) and no create-on-pick seam yet — that is Story 2.12 — and a dismissed drag should leave the area marked, not vanish.]

**3. Switching the region to a comment reuses the type seam — flip `type` to `comment`, set `body=""`, keep it selected.** A `retypeRegion(id, "comment", now)` store action (or the minimal equivalent) flips a `kind=rect` mark's `type` highlight↔comment and sets `body=""` when → comment. NO rebuild, NO contract concept: the comment render path (Story 2.10) already keys off `type === "comment"` for EITHER kind and renders the rect pin (`AnnotationLayer` line ~401 already denormalizes `anchor.rect` for the pin) + the bubble when selected. So flipping `type` → comment, staying selected, makes the layer paint the pin + open the comment bubble for free; the region quick-box closes (the mark is now a comment; the comment bubble takes over, exactly as a fresh comment does in 2.10). Re-typing back to highlight drops the body back to null.

**4. The ONE genuinely new render piece is the region rect-FILL branch (`kind=rect` + `type ∈ {highlight, comment}`).** Today `AnnotationLayer`'s fill path is text-only: `highlightMarks = textMarks.filter(...)` and `renderMark` early-returns when `kind !== "text"` (line ~301), so a `kind=rect` highlight paints NOTHING and a `kind=rect` comment gets its pin but NO ~0.4 area fill (the 2.10 note explicitly says a `kind=text` comment fills "for free" via `highlightMarks`, but a rect comment does not). Add a region-fill branch: one ~0.4-opacity fill div per `kind=rect` mark whose `type ∈ {highlight, comment}`, positioned by `denormalizeRect`, in the highlights opacity group (or a sibling region group), carrying the SAME `.annotation-highlight` hover/selected treatment so the 2.5 selection ring/hit-test work identically. This single branch serves BOTH the region highlight AND the region comment's area fill. Memo (`kind=rect`+`type=memo`) and pen (`kind=path`) are untouched.

**5. Box-select is armed from the cursor flyout or `M` — it is a POINTER tool, not an annotation tool.** `box` is already in `POINTER_TOOLS` (`tools.ts`) and the cursor flyout already lists "Box select" (`ToolRail.tsx` line ~30, Phosphor `Selection`) — arming it is wired; only its DRAG was deferred ("does nothing today (Story 2.11)"). This story makes the drag do something. Add the `M`/`m` → `setActiveTool("box")` key to App's document-level keydown (next to `C`, UX-DR15: `M` = box-select). Because `box` is a pointer tool, `isAnnotationTool("box")` is false, so the overlay's `armedTool` is null while box is active — the box drag path must therefore gate on `activeTool === "box"` (a new prop into the overlay), NOT on `armedTool`. Arming box turns pan OFF (one tool active, AD-11) and the cursor/box flyout — not an annotation color flyout — is its sub-toolbox.

**6. NFR-1 (no reflow) and NFR-3 (zoom-glue) are non-negotiable.** The region fill is an absolutely-positioned overlay div — it NEVER displaces page text (NFR-1). It rides `denormalizeRect` so it stays glued and correctly scaled across zoom; screen position derived, never persisted (NFR-3, AD-4). Prove LIVE at DPR>1.

## Scope boundary — READ FIRST

**IN (this story):**

- **Box-select drag gesture.** In `AnnotationInteraction.tsx`, a document-level path active only while `activeTool === "box"` (NEW prop; the box drag is a POINTER-tool gesture, so it can't piggyback on `armedTool`): pointerdown on a `.page-surface` (not chrome/quick-box/existing mark) records the start; pointermove rubber-bands a preview rect; pointerup builds the canonicalized, page-clamped, `normalizeRect`-ed rect, `buildRegionAnnotation`, `addAnnotation`, `select`. Below-threshold drag aborts (no mark). Clone the pen draft/preview/abort structure.
- **`buildRegionAnnotation` in `create.ts` (NEW).** Pure: `{page_index, rect}` + `{now, newId, color}` → one `type:"highlight"`, `group_id:null`, `anchor:{kind:"rect", page_index, rect}`, `style:{color, stroke_width:null}`, `body:null`. Unit-tested. (Sibling of `buildMemoAnnotation`/`buildCommentPin`.)
- **Region rect-fill render branch.** `AnnotationLayer.tsx`: a `kind=rect` + `type ∈ {highlight, comment}` fill branch — one ~0.4 fill div per mark, `denormalizeRect`-positioned, in the highlights opacity group (or a sibling `.annotation-regions` group), with the `.annotation-highlight` hover/selected classes. Serves region highlight AND region-comment area fill. Re-derives on zoom (NFR-3). Memo/pen branches unchanged.
- **Region quick-box (tool-type picker).** A NEW small picker rendered when a `kind=rect` highlight/comment region is freshly selected from a box drag: Highlight / Comment buttons (snapshot reserved Phase 2 — not shown). Picking Comment calls `retypeRegion(id, "comment")`; picking Highlight confirms/closes. Positioned at the region (anchor below the rect), dismiss on pick / outside-click / `Esc`, never shifts the canvas (UX-DR5). Reuse the `{component.quick-box}` shell + the dismiss/focus-restore plumbing the selection quick-box already has.
- **`retypeRegion(id, type, now)` store action (NEW, or minimal equivalent).** Flip a `kind=rect` mark's `type` highlight↔comment, set `body=""` when → comment / `null` when → highlight, bump `updated_at`. Guarded `anchor.kind === "rect"`. The comment render (pin + bubble, 2.10) and the region fill (Decision 4) both react off `type`, so no extra wiring.
- **`M` hotkey.** `App.tsx` document-level keydown: `M`/`m` → `setActiveTool("box")` next to `C` (UX-DR15). Thread the new `activeTool === "box"` signal into the overlay so the box drag path can gate on it.
- **Region highlight is selectable / recolorable / deletable via the 2.5 selection seam.** A selected region highlight opens the 2.5 selection quick-box (color row + delete) — reuse `recolorAnnotation`/`deleteAnnotation`. Add the region fill's hit-test class to BOTH `.closest(...)` selectors so a region is click-selectable/deselectable. (A region COMMENT is read/edited via the 2.10 comment bubble.)
- **Accessibility + no-canvas-shift.** The region quick-box picker is keyboard-reachable + `Esc`-dismissable with focus management (UX-DR17); the fill overlays and never reflows (NFR-1).

**OUT (later stories / do NOT build):**

- **Snapshot of the region** (image capture) — Phase 2. The picker shows Highlight / Comment ONLY.
- **The full selection tool-type picker (highlight / underline / comment / memo) on a TEXT drag** — Story 2.12 (FR-14). This story's picker is REGION-scoped (highlight / comment) and fires off a BOX drag, not a text selection. (Flag the shared seam for 2.12 — see Dev Notes — but build only the region picker here.)
- **Move / resize the region by dragging handles** — Story 3.1. (A region's geometry is fixed at draw time this story; recolor/retype/delete only.)
- **Cross-page regions / `group_id` split** — a region is single-page by definition. No `group_id`.
- **Persistence / command stack / undo** — Epic 3. Create / retype / recolor / delete stay client-side, reusing the store actions.
- **Any anchor-MODEL / Pydantic / endpoint / generated-type change.** `RectAnchor`, `type:"highlight"`/`"comment"`, `body` are ALREADY generated and AR-5 already permits highlight→rect + comment→rect. `server/openapi.json` (tracked fields) + `client/src/api/schema.d.ts` stay byte-identical.

## Acceptance Criteria

1. **Box-select armed (cursor flyout or `M`) → drag a rectangle + release creates a region annotation with `anchor kind=rect {rect}` (epics.md#Story-2.11 AC1; FR-12, AR-5).** With box armed (the cursor flyout's "Box select" or the `M` key), a pointerdown-drag-release over a page draws a rectangle; on release a region mark is created as `Annotation {type:"highlight", anchor:{kind:"rect", page_index, rect}, style:{color}, body:null}` via `buildRegionAnnotation`, the rect canonicalized (`x0≤x1, y0≤y1`) and `normalizeRect`-normalized `[0,1]` against the page box (scale-independent), single-page (`group_id` null). A below-threshold drag creates nothing. [Source: epics.md#Story-2.11; PRD#FR-12; ARCHITECTURE-SPINE.md#AD-5 (`highlight → text|rect`), #PRD-Anchor (rect canonical, negative drags normalized); create.ts (buildRegionAnnotation); anchor/normalizeRect; tools.ts (`box` ∈ POINTER_TOOLS)]

2. **The region quick-box offers the region tool-type picker — highlight / comment, snapshot reserved Phase 2 (epics.md#Story-2.11 AC2; UX-DR5).** On release the region is selected and a `{component.quick-box}` pops a tool-type picker: Highlight (confirm/keep) and Comment (switch the region to `type=comment`: it gains a pin + opens the comment bubble, Story 2.10). Snapshot is NOT shown (Phase 2). The picker dismisses on pick / outside-click / `Esc` and is keyboard-reachable. [Source: epics.md#Story-2.11; UX-DR5 (box-select → region tool-type picker), epics.md#L15 (box-select → region tool picker); ARCHITECTURE-SPINE.md#AD-5 (`comment → text|rect`); retypeRegion; Story 2.10 comment pin/bubble]

3. **The overlay never reflows the page (epics.md#Story-2.11 AC3; NFR-1).** The region fill and quick-box are absolutely-positioned overlays; drawing, marking, or commenting a region NEVER displaces or shifts page text/canvas. [Source: epics.md#Story-2.11; ARCHITECTURE-SPINE.md#NFR-1; AnnotationLayer.tsx (region fill div)]

4. **The region stays anchored and correctly scaled across zoom (NFR-3, AD-4).** After drawing a region, zooming re-renders the fill (and the comment pin, if retyped) at the exact page location + scale via `denormalizeRect`; screen position derived, never persisted. Prove LIVE at DPR>1. [Source: ARCHITECTURE-SPINE.md#AD-4, #NFR-3; AnnotationLayer.tsx]

5. **Box-select is a first-class POINTER tool in the single `activeTool` FSM (AD-11).** Arming box (cursor flyout "Box select" or `M`) sets `activeTool="box"` in ONE action, disarming whatever was active (mutual exclusion); pan is OFF while box is armed; `V`/`Esc` returns to cursor. The box drag path gates on `activeTool === "box"` (a pointer tool → `armedTool` is null), NOT on `armedTool`. While box is armed a drag draws a region (not a text selection / pan). [Source: ARCHITECTURE-SPINE.md#AD-11; tools.ts (`box` ∈ POINTER_TOOLS, `isPointerTool`); UX-DR4/DR15 (`M` = box-select); App.tsx; AnnotationInteraction.tsx]

6. **Geometry-on-kind / style-on-type honored; region highlight is selectable/recolorable/deletable; client-only + contract preserved (AD-5, AD-9, AD-3).** The fill render + region selection branch on `anchor.kind === "rect"`, the ~0.4 paint + accent key off `style.color`; a region highlight reuses the 2.5 selection quick-box (recolor + delete via `recolorAnnotation`/`deleteAnnotation`) and is hit-tested into BOTH `.closest(...)` selectors; a region comment is read/edited via the 2.10 bubble. No store-SCHEMA / persisted-model / anchor-model / API change — `RectAnchor`/`type:"highlight"|"comment"`/`body` already exist and AR-5 already permits both rect pairings, so `server/openapi.json` (tracked) + `client/src/api/schema.d.ts` stay byte-identical. No new `render/index.ts` export (both `vi.mock("./render")` barrels untouched). `no-raw-values` green (any region tokens live in `src/theme/**`). Highlight/underline/pen/memo/comment create+select+restyle+delete, pan, zoom-glue do not regress. [Source: ARCHITECTURE-SPINE.md#AD-5, #AD-9, #AD-3; CLAUDE.md#Engineering-principles, #Design-conventions]

## Tasks / Subtasks

- [x] **Task 1 — buildRegionAnnotation + retypeRegion store action (AC: 1, 2, 6)**
  - [x] `client/src/annotations/create.ts`: add `buildRegionAnnotation({page_index, rect}, docId, {now, newId, color})` → one `type:"highlight"`, `group_id:null`, `anchor:{kind:"rect", page_index, rect}`, `style:{color, stroke_width:null}`, `body:null`. Unit-tested (shape: type/kind/null group/null body/color/null stroke).
  - [x] `client/src/store/index.ts`: add `retypeRegion(id, type, now)` (or minimal equivalent) — guarded `anchor.kind === "rect"`; flip `type` highlight↔comment; set `body=""` when → comment, `null` when → highlight; bump `updated_at`. Added to the `beforeEach` reset coverage if it needs state; unit-tested (flip both ways + body set/clear + non-rect guard + unknown-id no-op).

- [x] **Task 2 — Box-select drag gesture (AC: 1, 5)**
  - [x] `client/src/annotations/AnnotationInteraction.tsx`: a document-level box path active only while `activeTool === "box"` (NEW prop threaded from App; box is a pointer tool so `armedTool` is null). Clone the pen draft structure: pointerdown on `.page-surface` (reject chrome/`.quick-box`/existing mark) records the start corner + page; pointermove rubber-bands a preview rect; pointerup builds the canonicalized rect (`x0≤x1,y0≤y1`) from the two corners, clamps to the pointerdown page, `normalizeRect`, `buildRegionAnnotation`, `addAnnotation`, `select`, `preventDefault`. Below-threshold drag aborts (reuse the pen abort guard). Box added to the relevant early-returns so it never falls through to the text/proof/pen path.
  - [x] Live rubber-band preview rect (a styled draft div, like the pen `penPreview`), cleared on pointerup/abort.

- [x] **Task 3 — Region rect-fill render + region quick-box (AC: 2, 3, 4, 6)**
  - [x] `client/src/annotations/AnnotationLayer.tsx`: a `kind=rect` + `type ∈ {highlight, comment}` fill branch — one ~0.4 fill div per mark via `denormalizeRect`, in the highlights opacity group (or a NEW sibling `.annotation-regions` group), carrying `.annotation-highlight` + hover/selected classes; `data-testid={`annotation-mark-${a.id}`}`. Comment regions ALSO get their 2.10 pin (already rect-aware) — render only the fill here; do NOT duplicate the pin. Memo/pen branches untouched. Re-derives on zoom.
  - [x] `client/src/annotations/Annotations.css`: region fill styling (reuse `{component.annotation-highlight}` ~0.4 + accent from `style.color`; hover/selected rings). Tokens only.
  - [x] Region quick-box: render the tool-type picker (Highlight / Comment) when a freshly box-drawn region is selected. Reuse the `{component.quick-box}` shell + dismiss/focus-restore. Comment → `retypeRegion(id,"comment")` (then the 2.10 bubble opens); Highlight → confirm/close. Anchor below the rect; dismiss on pick/outside-click/`Esc`; never shift the canvas. (Keep the picker DISTINCT from the 2.5 recolor selection quick-box — a region's RECOLOR after the type is settled uses the 2.5 box.)

- [x] **Task 4 — Cursor-flyout/`M` arming + selection wiring (AC: 5, 6)**
  - [x] `client/src/App.tsx`: `M`/`m` → `setActiveTool("box")` in the document-level keydown next to `C` (UX-DR15). Thread an `activeTool === "box"` signal (or `activeTool` itself) into `AnnotationInteraction` so the box drag path gates on it. The cursor flyout "Box select" arming already exists (`ToolRail.tsx`) — verify one-click arm + pan-off + no annotation color flyout.
  - [x] `client/src/annotations/AnnotationInteraction.tsx`: add the region fill's hit-test class (e.g. `.annotation-highlight` already, or a `.annotation-region` marker) to BOTH `.closest(...)` selectors so a region highlight is click-selectable/deselectable into the 2.5 quick-box (recolor + delete).

- [x] **Task 5 — Tests + regression bar (AC: all)**
  - [x] `create.test.ts`: `buildRegionAnnotation` shape.
  - [x] `store/index.test.ts`: `retypeRegion` flips both ways, sets/clears body, guards non-rect, no-ops unknown id.
  - [x] `AnnotationInteraction.test.tsx`: box drag (gated `activeTool==="box"`) creates `type=highlight`/`kind=rect` with the canonicalized normalized rect + active color, selects + opens the region picker; below-threshold drag → no mark; chrome/`.quick-box`/existing-mark pointerdown → no region; picker Comment → `retypeRegion` to comment; picker Highlight → confirm; region highlight click-selects into the 2.5 quick-box; recolor + Del work. Pen/highlight/underline/memo/comment/cursor paths still pass.
  - [x] `AnnotationLayer.test.tsx`: a `kind=rect`+`type=highlight` mark renders a fill in the region/highlights group (NOT memo/pen groups), `annotation-mark-<id>`, selectable + hover/selected classes, re-derives on zoom; a `kind=rect`+`type=comment` mark renders the fill AND the pin (no duplicate); no region group when no regions.
  - [x] `App.test.tsx`: `M` arms `"box"`; `V`/`Esc` return to cursor; the new `activeTool`/box signal threaded (confirm NO new `render/` export → both `vi.mock("./render")` barrels untouched).
  - [x] `ToolRail.test.tsx`: cursor flyout "Box select" arms `box` in one click (regression — already wired).
  - [x] Full regression: client suite (395/395) + `typecheck` clean; server `pytest` clean. Contract byte-identical (`git diff --stat client/src/api/schema.d.ts` + `server/openapi.json` empty). `no-raw-values` green.
  - [ ] **Live smoke** (own fresh `uvicorn` + `vite dev` on alternate ports, real PDF, DPR=2): (a) arm Box from the cursor flyout (one click) + via `M`; (b) drag a rectangle over a figure → ~0.4 region fill appears, page NOT displaced; (c) region picker pops with Highlight / Comment (no snapshot); (d) pick Comment → pin + bubble open, type a note; (e) draw another region, keep Highlight, then click-select it → 2.5 quick-box recolors + Del deletes; (f) zoom 200→250% → region stays glued + scaled (capture the fraction invariants); (g) below-threshold click while box armed → no stray region; (h) highlight/underline/pen/memo/comment + pan still work. Save a screenshot to `.bmad/implementation-artifacts/2-11-region-smoke.png`.

- [x] **Task 6 — Docs + version (AC: all)**
  - [x] No `/api` change → `docs/API.md` untouched.
  - [x] `client/src/annotations/README.md`: added Story 2.11 region section.
  - [x] `server/pyproject.toml` version `0.1.7 → 0.1.8` bumped.

## Dev Notes

### What this adds vs reuses

| Need | Reuse | New |
| --- | --- | --- |
| Normalized rect math + zoom-glue | `normalizeRect`/`denormalizeRect` (anchor/) | nothing |
| Entity + contract | `RectAnchor` + `type:"highlight"|"comment"` + `body` already generated; AR-5 permits both rect pairings | `buildRegionAnnotation` |
| Page assignment | `pickPage` | clamp the rect to the pointerdown page |
| Drag gesture | the PEN gesture (document-level, page-gated, draft→preview→commit, abort guard) | emit a BOUNDING rect (2 corners) not a path; gate on `activeTool==="box"` |
| Tool state / mutual exclusion | `activeTool` FSM (`"box"` already in POINTER_TOOLS), cursor flyout "Box select" already listed | `M` key + thread `activeTool==="box"` into the overlay |
| Region area fill render | the `.annotation-highlight` ~0.4 fill + hover/selected treatment | a `kind=rect`+highlight/comment fill BRANCH (today fill is text-only) |
| Switch region → comment | the 2.10 comment pin + bubble (already rect-aware) | `retypeRegion` (flip type, set/clear body) |
| Region recolor/delete | the 2.5 selection quick-box + `recolorAnnotation`/`deleteAnnotation` | add the region to the two `.closest()` hit-tests |
| Region tool-type picker | the `{component.quick-box}` shell + dismiss/focus-restore | a small Highlight/Comment picker (region-scoped) |

Resist: a contract field/new `type` for "region" (a region is just `kind=rect`); a cross-page `group_id` (region is single-page); building the FULL 2.12 selection tool-type picker here (region = highlight/comment only); building snapshot (Phase 2); drag-handle move/resize (3.1); putting box logic in `render/` (it is an annotations/ view).

### Decision notes

- **Commit-on-release defaulting to highlight (Decision 2).** The one genuine design call. Alternative (commit-on-pick, nothing until you choose a type) is what Story 2.12's text picker will do, but 2.11 ships first, the codebase has only create-then-select precedents, the story intent is box-HIGHLIGHT, and a dismissed drag should leave the area marked. So: release → region highlight (selected) → picker can switch to comment.
- **Box gates on `activeTool`, not `armedTool` (Decision 5).** `box` is a `PointerTool`; `isAnnotationTool("box")===false`, so the overlay's derived `armedTool` is null while box is armed. The existing pen/memo/comment gates read `armedToolRef`; the box gate must read a NEW `activeTool==="box"` signal. Thread `activeTool` (or a boolean) into `AnnotationInteraction`.
- **One fill branch, two types (Decision 4).** The new `kind=rect`+{highlight,comment} fill serves both the region highlight and the region comment's area fill. The comment's pin/bubble is the 2.10 path (already rect-aware) — do not duplicate it; render only the fill in the new branch.
- **2.12 seam.** Story 2.12 builds the TEXT-drag tool-type picker (highlight/underline/comment/memo). The region picker here is a smaller cousin (highlight/comment off a box drag). If a shared picker primitive is cheap, factor it so 2.12 can extend it — but do not over-build; ship the region picker.

### Integration points (the seams)

- `client/src/annotations/create.ts` — add `buildRegionAnnotation` (sibling of `buildMemoAnnotation`/`buildCommentPin`).
- `client/src/store/index.ts` — `retypeRegion` (twin shape of `retextAnnotation`/`recolorAnnotation`, guarded `kind==="rect"`).
- `client/src/annotations/AnnotationInteraction.tsx` — the box drag path (clone the pen gesture, gate `activeTool==="box"`, emit a rect); the region tool-type picker; `.annotation-region`/highlight in the two `.closest()` hit-tests.
- `client/src/annotations/AnnotationLayer.tsx` — the `kind=rect`+{highlight,comment} fill branch (+ optional `.annotation-regions` group).
- `client/src/annotations/Annotations.css` — region fill styling (reuse highlight ~0.4 + accent).
- `client/src/App.tsx` — `M` key + thread `activeTool` (box signal) into the overlay.
- `client/src/ToolRail.tsx` — cursor flyout "Box select" already present; verify, no new button.
- `client/src/tools.ts` — `box` already in `POINTER_TOOLS`; no change.

### Engineering conventions in force (CLAUDE.md#Engineering-principles)

- **Adopt-stable / one model:** reuse `normalizeRect`/`denormalizeRect`, `pickPage`, the pen gesture, the `.annotation-highlight` treatment, the 2.5 selection seam, the 2.10 comment pin/bubble, `activeColor`. New = `buildRegionAnnotation`, `retypeRegion`, the rect-fill branch, the region picker. One `activeTool`, one `activeColor`. [[prefer-stable-solutions]]
- **Document-level handlers (AP-1):** the `M` key joins App's document-level keydown (phase-gated, editable/buttons exempt); the box drag binds on `document`, page-gated. [[held-key-state-reset-on-blur]]
- **`render/` mock-barrel sync (AP-2):** no new `render/index.ts` export → both `App.test.tsx` + `Reader.test.tsx` `vi.mock("./render")` barrels untouched. Confirm.
- **HiDPI live smoke (highest-risk path):** box-select is a placed-geometry + drag feature — live-smoke the drag, the fill (no page displacement), the retype-to-comment, recolor/delete, and zoom-glue at DPR>1. jsdom zeroes rects — assert the MODEL in unit tests, prove geometry LIVE. [[verify-on-hidpi-and-real-host]]
- **Cross-model code review (AP-3):** run `bmad-code-review` (Codex) after dev-story.

### Testing standards

- Frontend Vitest + jsdom: assert the MODEL/wiring — the create call (`type:"highlight"`/`kind:"rect"`/canonicalized rect), the retype store write, the layer's region fill branch + group, the box-drag gate (`activeTool==="box"`), the region picker, the `M` keymap, the 2.5 selection hit-test for a region — NOT pixel geometry (jsdom zeroes rects). Reuse the fake-card pattern; drive the box drag via synthetic pointerdown→move→up with a non-zero delta.
- Backend pytest: no model/contract change; run to confirm no regression.

### Project Structure Notes

- New files: none top-level. Extends `annotations/create.ts` (+test), `store/index.ts` (+test), `AnnotationInteraction.tsx` (+test), `AnnotationLayer.tsx` (+test), `Annotations.css`, `App.tsx` (+test); `theme/components.css` only if region needs a token. `machine.ts`/`tools.ts`/`render/`/`anchor/`/api-schema unchanged. [Source: ARCHITECTURE-SPINE.md#Structural-Seed]
- Layer rule (AD-9): touches the App composition root (`M` key, `activeTool` signal) and `annotations/` (gesture, create, layer, store action). No `render/`/anchor/store-SCHEMA/contract change.

### Versioning

- PATCH +1 at done: `server/pyproject.toml` `0.1.7 → 0.1.8` (single source). Bump once at done.
- Post-review revision (2026-06-30): `0.1.8 → 0.1.9` for the box-highlight relocation fix (see the POST-REVIEW REVISION note at the top).

### References

- [Source: .bmad/planning-artifacts/epics.md#Story-2.11] — story + the three ACs (box armed via cursor flyout/`M`; drag-release creates a region `kind=rect`; the region quick-box offers highlight/comment, snapshot reserved Phase 2; overlay never reflows).
- [Source: .bmad/planning-artifacts/epics.md#L15, #UX-DR5] — box-select → region tool-type picker; contextual quick-box by mode.
- [Source: .bmad/planning-artifacts/prds/.../prd.md#FR-12, #FR-13, #Anchor] — range/area (box) selection; drag-to-annotate region; rect canonical `{x0,y0,x1,y1}`, negative drags normalized.
- [Source: ARCHITECTURE-SPINE.md#AD-5] — `highlight/underline → text|rect`, `comment → text|rect`; geometry-on-kind / style-on-type; `body` non-null only for memo/comment.
- [Source: ARCHITECTURE-SPINE.md#AD-4, #NFR-1, #NFR-3] — page-normalized rect; no reflow; zoom re-derivation.
- [Source: ARCHITECTURE-SPINE.md#AD-11] — single `activeTool`; `box` ∈ POINTER_TOOLS; one-action switch, mutual exclusion.
- [Source: ARCHITECTURE-SPINE.md#AD-9, #AD-3] — layering; contract stability (no API/Pydantic/generated-type change; `RectAnchor`/`type`/`body` already exist).
- [Source: DESIGN.md#annotation-highlight, #quick-box, #tool-rail] — region fill (highlight ~0.4 + accent); quick-box shell; cursor flyout (cursor/hand/box-select).
- [Source: UX-DR4/DR5/DR15] — tool rail + cursor flyout box-select; contextual quick-box (box-select → region picker); `M` = box-select.
- [Source: .bmad/implementation-artifacts/epic-2/2-9-textbox-memo.md] — the first `kind=rect` mark; the create-then-select-into-quick-box flow; the store-action twin pattern (`retext`/`resize`); `denormalizeRect` zoom-glue; the editable-field exemption.
- [Source: .bmad/implementation-artifacts/epic-2/2-10-comment-highlight-pin-bubble.md] — the comment pin + bubble (already rect-aware: `AnnotationLayer` denormalizes `anchor.rect` for the pin); a `kind=text` comment fills "for free" via `highlightMarks` but a `kind=rect` comment does NOT — the gap this story's rect-fill branch closes; the doc-scoped group-id guard.
- [Source: CLAUDE.md#Engineering-principles, #Design-conventions, #Versioning].

## Previous Story Intelligence

From Story 2.10 (comment, done) + 2.9 (memo, done) + the Epic-2 pattern:

- **The create-then-select pattern is the spine.** Memo (click→box→select→quick-box) and comment (drag/click→pin→bubble) both create on release and route into a contextual quick-box. Box-select follows it: drag→region→select→region picker. Do not fork a create-on-pick flow (that is 2.12).
- **`kind=rect` fill is a known gap.** The 2.10 note is explicit: a `kind=text` comment fills via `highlightMarks` but a `kind=rect` comment gets only a pin, no area fill. This story's rect-fill branch is exactly that missing piece — and it ALSO lights up the region highlight. Build it once, key off `kind=rect`+{highlight,comment}.
- **Codex review lessons to pre-apply:** guard store mutations by kind/type (`retypeRegion` guards `kind==="rect"`); keep tokens in `src/theme/**` (region fill dims/opacity from token-backed classes, no raw px/hex in components); scope any group/id logic to THIS doc (the store is a singleton until Epic 3) — though a region is single-page with no `group_id`, so this is mostly moot here.
- **Box is a POINTER tool — the gate is different.** Unlike memo/comment (annotation tools read via `armedTool`), box's drag must gate on `activeTool === "box"`. This is the single most likely wiring slip — the box gesture will silently never fire if it copies the pen gate verbatim. Thread `activeTool` into the overlay.
- **Live smoke is the real verifier; jsdom zeroes geometry.** Prove the drag, the fill (no page shift), retype-to-comment, recolor/delete, and zoom-glue on a real host at DPR>1.
- **Launch your OWN dev servers; contract byte-identical discipline; cross-model review after.**

## Git Intelligence

- Baseline: `f4fee51` (Chore: Mark Story 2.10 done; PR #19 merged) on `main`. The anchor rect math, `pickPage`, the `activeTool` FSM (`box` ∈ POINTER_TOOLS, cursor flyout "Box select" listed), the pen drag gesture, the 2.5 selection seam, the 2.6 `activeColor`, the 2.9 first-`kind=rect` memo, and the 2.10 comment pin/bubble (rect-aware) are all merged. This story makes the already-armable `box` tool's DRAG create a region, adds the missing `kind=rect` fill, and reuses the comment path for the region-comment retype.
- Branch off `main` (never commit to `main`). Dev loop = host two-process flow (`uvicorn --reload` + `vite dev`).
- No contract change → keep `client/src/api/schema.d.ts` + `server/openapi.json` byte-identical (verify after the suite).

## Project Context Reference

- Two processes, one container (AD-1/AD-10): `client/` (React 19.2 + Vite 8 + TS 6.0) + `server/` (FastAPI + Pydantic v2). v1 scope = Phase 1; no auth, localhost single-user.
- Client layering (AD-9): `render → anchor → annotations → store → api`, strict downward. Box-select touches the App root (`M` key, `activeTool` signal) and `annotations/` (gesture, create, layer, store action). No `render/`/anchor/store-SCHEMA/contract change.
- `anchor.kind` (AD-5) is the geometry discriminator — `rect` covers memo (2.9), comment-rect (2.10), and now the region (2.11). `style.color` (`activeColor`) drives the region fill accent. `box` ∈ POINTER_TOOLS, so the FSM already disarms it against pan/annotation tools.

## Story Completion Status

Ultimate context engine analysis completed - comprehensive developer guide created. Box-select is a region box-HIGHLIGHT (not a marquee group-select — the user confirmed this), the first mark built from a free rectangle drag, reusing the pen gesture (rect not path), the create-then-select flow, the `.annotation-highlight` treatment, the 2.5 selection seam, and the 2.10 comment pin/bubble. Six design calls are pre-resolved: (1) clone the pen drag, emit a canonicalized bounding rect; (2) commit-on-release defaulting to a region highlight, then a region tool-type picker (the one genuine call, made toward box-HIGHLIGHT intent); (3) switch-to-comment flips `type` + sets `body=""` and reuses the 2.10 pin/bubble; (4) the ONE new render piece is a `kind=rect`+{highlight,comment} fill branch (closes the known 2.10 rect-fill gap, serves both); (5) box is a POINTER tool — the drag gates on `activeTool === "box"`, NOT `armedTool` (the highest-risk wiring slip); (6) NFR-1 no-reflow + NFR-3 zoom-glue are non-negotiable. The contract already permits both rect pairings (AR-5: highlight→rect, comment→rect) and carries `RectAnchor`/`body`, so this is client-only with the tracked contract byte-identical. Success = box arms from the cursor flyout or `M`, a drag draws a ~0.4 region fill over an area without displacing the page, the region picker offers Highlight / Comment (snapshot reserved Phase 2), Comment gives the area a pin + bubble, a region highlight recolors/deletes via the 2.5 quick-box, everything stays glued across zoom, and the live smoke passes drag + fill + retype + recolor + zoom-glue at DPR>1 without regressing the other five tools / pan / zoom.

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

None — no major debugging detours. One pre-existing test expectation updated: `AnnotationLayer.test.tsx` "a kind=rect comment paints ONLY a pin (no fill)" renamed + extended to expect fill AND pin after the region fill branch was added (the old expectation tested the 2.10 behavior that 2.11 intentionally changes).

### Completion Notes List

- Implemented the box gesture as a separate document-level useEffect in AnnotationInteraction (gated on `boxActiveRef.current`, keyed on `[enabled, docId, addAnnotation, select]`). Mirrored the pen gesture structure exactly: pointerdown → pointermove preview → pointerup commit.
- Decision 5 (box is a pointer tool) required threading an explicit `boxActive?: boolean` prop from App → Reader → AnnotationInteraction. The gate uses `boxActiveRef.current`, not `armedToolRef.current`.
- Region picker conflicts with the selection quick-box: both open when a region is freshly created (selectedId set + selectionBoxOpen set). Gate: `regionPickerForId !== selectedId` in `showSelectionBox` suppresses the recolor box while the picker is visible.
- The `kind=rect, type=comment` fill is the ONE new render piece that closes the 2.10 gap: `regionMarks` filter includes type=comment, and `renderRegion` renders both. The existing `AnnotationLayer.test.tsx` test for "a kind=rect comment paints ONLY a pin" was updated to reflect the new behavior.
- `retypeRegion` is strictly guarded on `anchor.kind === "rect"` to avoid accidentally retyping text highlights or pen marks.
- No API/contract change: `RectAnchor`, `type:"highlight"|"comment"`, `body` already exist. `server/openapi.json` and `client/src/api/schema.d.ts` are byte-identical to the baseline.
- Live smoke not yet performed (requires user/human to run at DPR>1 with a real PDF on the host).

### File List

- `client/src/annotations/create.ts` — added `RegionPlacement`, `BuildRegionOptions` interfaces and `buildRegionAnnotation` function
- `client/src/store/index.ts` — added `retypeRegion` to the store interface and implementation
- `client/src/annotations/AnnotationLayer.tsx` — added `regionMarks` filter, `renderRegion` function, and `.annotation-regions` group render
- `client/src/annotations/Annotations.css` — added `.box-preview` rule
- `client/src/annotations/AnnotationInteraction.tsx` — added box drag gesture (pointerdown/move/up + abort + rubber-band preview), region picker, `retypeRegion` usage, `regionPickerForId` gate on `showSelectionBox`
- `client/src/App.tsx` — added `M`/`m` → `setActiveTool("box")` and `boxActive={activeTool === "box"}` prop
- `client/src/Reader.tsx` — added `boxActive?: boolean` prop, passed to AnnotationInteraction
- `client/src/annotations/AnnotationLayer.test.tsx` — updated existing rect-comment test; added region fill describe block (7 new tests)
- `client/src/annotations/create.test.ts` — added `buildRegionAnnotation` describe block (2 tests)
- `client/src/store/index.test.ts` — added `retypeRegion` tests (5 tests, inside memo/retext/resize describe)
- `client/src/annotations/AnnotationInteraction.test.tsx` — added box-select gesture describe block (10 new tests)
- `client/src/App.test.tsx` — added `M` key test
- `client/src/annotations/README.md` — added Story 2.11 region section
- `server/pyproject.toml` — bumped version 0.1.7 → 0.1.8
- `.bmad/implementation-artifacts/sprint-status.yaml` — status: in-progress → review
- `.bmad/implementation-artifacts/deferred-work.md` — added src folder refactoring request

## Change Log

- 2026-06-30: Story created (ready-for-dev) via bmad-create-story.
- 2026-06-30: Implementation complete (all tasks done except live smoke); status → review.
- 2026-06-30: Post-review revision per user redirect — box-highlight relocated to a MODE of the Highlight tool (removed from POINTER_TOOLS); box-comment + region picker + `retypeRegion` removed; `M` arms Highlight + box mode; flyout toggle ordered first with a divider + `BoundingBox` icon. Version `0.1.8 → 0.1.9`. Commits `f97881d`, `3c3e4af`. See the POST-REVIEW REVISION note at the top.
