---
baseline_commit: 1fb83b9195ee7f68b97a88ae7d9382eeada21424
---

# Story 2.10: Comment (highlight + pin + bubble)

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a reader,
I want a comment anchored to a spot,
so that I attach a note that opens on click.

> **A comment is created TWO ways (AD-5: `comment → text` OR `rect`): DRAG across text → a `kind=text` comment (highlights the run + a pin); CLICK a spot → a `kind=rect` comment (a pin only, no highlight).** Both carry `type="comment"` + a non-null `body` and open the same note bubble. The drag path REUSES the highlight drag-selection verbatim (only delta: `type` + `body`); the click path REUSES the memo click-to-place gesture (a `kind=rect` anchor at the point, but `type="comment"`, rendered as a pin not a box). The genuinely new pieces are tiny: (1) the highlight FILL is FREE on the drag path (a `type=comment` mark is `type !== "underline"`, so it already paints in the `.annotation-highlights` 0.4-opacity group), (2) a round PIN rendered at the run start (text comment) or the click point (rect comment) — a focusable control, so it lives in a NEW non-aria-hidden `.annotation-comments` group, and (3) a `{component.comment-bubble}` that opens on pin-click for read/edit of `body` (the comment twin of memo's interactive `<textarea>`, reusing `retextAnnotation` unchanged). Everything else is the SAME pattern the tool stories already set: a rail button below Memo + a `C` hotkey + an arm-time color sub-toolbox, create-then-select, and `denormalizeRect` zoom-glue. The contract ALREADY supports comment (`type:"comment"` in the `Annotation` union, `kind=text` AND `kind=rect`, `body: string | null`), so this is client-only with the tracked contract byte-identical.

## The decisions that define this story (read before coding)

**1. A comment is created TWO ways, branched on whether the release carried a text selection (drag) or not (click).** With comment armed (rail button or `C`), the existing document-level `pointerup` handler resolves the selection:
- **DRAG across text → a `kind=text` comment (highlight + pin).** A non-empty selection builds ONE `kind=text` annotation per page (the SAME `buildAnnotations` two-page `group_id` split as highlight), `type="comment"`, `body=""`. The ONLY delta from the highlight path is `type` + a non-null `body`. The run highlights (~0.4, free) and a pin anchors at its start.
- **CLICK a spot (no selection) → a `kind=rect` comment (pin only, no highlight).** A collapsed/empty selection on a page surface places ONE `kind=rect` annotation at the click point (a small anchor rect), `type="comment"`, `body=""`, via `buildCommentPin` — the memo click-to-place gesture's twin, but a pin not a box and no highlight fill.

Both land, select, and open the bubble for immediate typing. The discriminator is `pages.length` from `rectsFromSelection` in the SAME `pointerup` (selection → drag; zero → click) — no separate pointerdown gesture. [Source: epics.md#Story-2.10 AC1; ARCHITECTURE-SPINE.md#AD-5 (`comment → text` or `rect`); UX-DR5; DESIGN.md#annotation-comment-pin]

**2. The highlight FILL (drag only) is FREE; the PIN renders for BOTH kinds.** A `kind=text` comment is `type !== "underline"`, so `AnnotationLayer`'s existing `highlightMarks` filter ALREADY paints it as a ~0.4 accent fill in the `.annotation-highlights` opacity group (UX-DR7) — do NOT add a second fill path, and a `kind=rect` comment has NO fill (it never enters `highlightMarks`, which filters `kind === "text"`). NEW = a round `{component.annotation-comment-pin}` (rounded.full, ~20px, accent fill) for EVERY comment mark, anchored at the START of the run's first rect (`kind=text`) or at the rect's top-left (`kind=rect`), rendered as a `<button>` in a NEW, NOT aria-hidden `.annotation-comments` group (a focusable control cannot live in the decorative aria-hidden mark sheet — same rule memos follow). The pin rides the denormalized anchor so it stays glued on zoom (NFR-3). [Source: DESIGN.md#annotation-comment-pin; AnnotationLayer.tsx (highlightMarks filters kind=text; comment pin keyed off type=comment)]

**3. The bubble opens on pin click; `body` updates through `retextAnnotation` (reused unchanged).** Clicking the pin selects the comment and opens the `{component.comment-bubble}`: a positioned surface (surface-card bg, rounded.md, hairline-strong border, body-sm) holding an editable `<textarea>` bound to `body`. Every edit calls `retextAnnotation(id, body, now)` — the SAME store action memo uses; it has no type guard, so it works on a comment id with zero change. This is CREATION-TIME editing (client-side, no command stack), exactly like memo's body and recolor-at-creation. Re-opening a comment AFTER it is deselected (click the pin again) re-opens the bubble for read/edit in the SAME client-side way (the pin is always present and clickable) — the command-path formalization (do/undo) is Story 3.1. [Source: epics.md#Story-2.10 AC2; UX-DR8; store/index.ts retextAnnotation]

**4. The comment-bubble REPLACES the generic selection quick-box for comments (UX-DR5: comment mode → comment-bubble opens directly).** A selected highlight/underline/pen/memo shows the shared selection quick-box (color/width/size + delete). A comment does NOT — its affordance IS the bubble. So `showSelectionBox` is gated to EXCLUDE `type === "comment"`, and when a comment is selected the bubble renders instead. The bubble carries the body `<textarea>` + a `ColorSwatchRow` (the accent tints the fill AND the pin, via `recolorAnnotation`) + a delete. Keyboard-reachable, `Esc`-dismissable (blur + clear selection), focus moves INTO the textarea on open and RETURNS to the prior element on close (UX-DR8, UX-DR17). [Source: UX-DR5, UX-DR8, UX-DR17; AnnotationInteraction.tsx showSelectionBox]

**5. An empty comment is KEPT (unlike an empty memo) — for BOTH the dragged and the clicked pin.** A memo placed but never typed into is a stray empty box, so 2.9 auto-removes it on deselect. A comment's mark IS the annotation (the highlight+pin from a drag, or the pin from a click) and the note is optional — a clicked pin with no note is a deliberate marker, not a stray. So there is NO empty-comment cleanup: deselecting a comment with empty `body` leaves the highlight/pin in place. (This is the one place the memo pattern does NOT carry over — call it out so the dev does not copy the 2.9 cleanup effect, and confirm that effect stays gated on `type === "memo"` so a clicked empty pin is never deleted.)

## Scope boundary — READ FIRST

**IN (this story):**

- **Comment create on drag-release (text) AND click (rect pin).** In `AnnotationInteraction.tsx`, extend the existing `pointerup` handler so `tool === "comment"`: if `rectsFromSelection` returned pages (a DRAG), build a `kind=text` mark like highlight/underline but `type="comment"` + `body=""`; if it returned zero AND the release was a plain click on a `.page-surface` (no drag), build a `kind=rect` comment pin at the click point via `buildCommentPin`. Either way add + select (opens the bubble). Comment is a text-selection tool, so it MUST stay OUT of the pen/memo early-return (`armedToolRef.current === "pen" || "memo"`); add `comment` to the handler. Guard the click path like memo (over `.page-surface`, not `.quick-box`/`.annotation-comment-pin`).
- **`buildAnnotations` gains an optional `body` (NEW param, default `null`).** Extend `BuildOptions` with `body?: string`; map it onto each built annotation (highlight/underline keep the default `null`; the comment DRAG path passes `""`). Pure, unit-tested. (Do NOT fork a `buildCommentAnnotations` — the text comment IS the highlight path with a body.)
- **`buildCommentPin` in `create.ts` (NEW).** Pure: `{page_index, rect}` + `{now, newId, color}` → one `type:"comment"`, `kind:"rect"`, `group_id:null`, `body:""` `Annotation` (the click-placed pin). Twin of `buildMemoAnnotation` but `type="comment"` and the rect is a small anchor for the pin (no box is drawn). Unit-tested.
- **Comment pin render (NEW group), both kinds.** `AnnotationLayer.tsx`: a `type=comment` branch rendering a round `{component.annotation-comment-pin}` `<button>` for every comment mark, positioned via `denormalizeRect` + the card box at the FIRST rect's start (`kind=text`) or the rect's top-left (`kind=rect`), in a NEW, NOT aria-hidden `.annotation-comments` group (pointer-transparent group, the pin opts back in). The pin's fill is `var(--color-${style.color})`; clicking it `select`s the comment. `data-testid="annotation-comment-pin-${a.id}"`; for a `kind=text` comment the existing `annotation-mark-${a.id}` testid stays on the FILL (the highlight group already paints it); a `kind=rect` comment has no fill. The pin re-derives on zoom (NFR-3).
- **`CommentBubble` component (NEW) + bubble render.** A `<textarea>` surface per `{component.comment-bubble}`, anchored just below the pin (denormalized first-rect start), shown only when the comment is selected. `value = body`, `onChange` → `retextAnnotation`; local `Esc` (blur + `clearSelection`); a `ColorSwatchRow` (recolor) + a delete. Focus moves into the textarea on open (autofocus when selected, like `MemoBox`) and returns on close. Extracted as its own component (like `MemoBox`) so it owns its ref/focus. Lives in the `.annotation-comments` group (a focusable control, not aria-hidden).
- **Selection quick-box excludes comments.** Gate `showSelectionBox` with `selectedAnno.type !== "comment"`, and add the comment branch (the bubble) so a selected comment shows the bubble, never the generic box. Add `.annotation-comment-pin` to BOTH `.closest(...)` hit-test selectors (so clicking the pin counts as on-a-mark and does not clear the selection) and to the open/reopen pointerdown.
- **Comment rail button + `C` hotkey + arm-time color sub-toolbox.** `ToolRail.tsx`: a Comment `.tool-rail__item` below Memo (DESIGN.md#tool-rail order: cursor, highlight, underline, pen, memo, comment, …), the twin of the color tools, its `ToolFlyout` holding a `ColorSwatchRow` (comment has color, no width/size). Phosphor `ChatCircle` (or `ChatCircleDots`/`NoteBlank`), `aria-label="Comment"`, `title="Comment (C)"`. In `App.tsx`'s document-level keydown, add `C`/`c` → `setActiveTool("comment")` next to `T` (UX-DR15: `C` = comment).
- **Color application.** The comment's `style.color` tints BOTH the highlight fill (already, via the highlights group) AND the pin (inline `var(--color-${color})`), default `activeColor`. Recolor via the bubble's `ColorSwatchRow` → `recolorAnnotation` + sets the active default (last-choice-wins, like every other tool).
- **Accessibility + no-canvas-shift.** The pin is a real `<button>` (keyboard-reachable, focus ring); the bubble's textarea is focus-managed (in on open, return on close), `Esc`-dismissable; pin + bubble overlay and never reflow the page (NFR-1, absolutely positioned).

**OUT (later stories / do NOT build):**

- **Box-select + drag-to-change-tool** (2.11–2.12) and their rail buttons. Only comment this story.
- **Re-edit through the command path (do/undo) + move/resize the pin or bubble by dragging** — Story 3.1. This story edits `body`/color/delete client-side at creation (and on re-open) exactly like every Epic-2 tool; the do/undo formalization is 3.1.
- **Drag-to-size the `kind=rect` pin** — the click places a fixed small anchor rect; the pin is a fixed-size glyph. A draggable region comment is a future refinement.
- **Persistence / command stack / undo** — Epic 3. Create / retext / recolor / delete stay client-side, reusing the existing store actions.
- **Any anchor-MODEL / Pydantic / endpoint / generated-type change.** `type:"comment"`, `kind=text`, `body` are ALREADY generated. `server/openapi.json` (tracked fields) + `client/src/api/schema.d.ts` stay byte-identical.
- **No empty-comment cleanup** (Decision 5) — do NOT copy the 2.9 empty-memo deselect-delete effect for comments.

## Acceptance Criteria

1. **Comment armed → DRAG across text highlights the run (~0.4) + a pin; CLICK a spot drops a pin only (epics.md#Story-2.10 AC1; FR-11, UX-DR7; AD-5 `comment → text` or `rect`).** With comment armed (rail button or `C`): drag-selecting text and releasing paints a ~0.4 accent fill OVER the run (the existing `.annotation-highlights` group, since `type=comment` is `type !== "underline"`) AND a round `{component.annotation-comment-pin}` at the run start (a `kind=text` comment); a plain click on a page spot (no selection) drops a round pin there with NO highlight (a `kind=rect` comment). Nothing reflows (NFR-1). [Source: epics.md#Story-2.10; ARCHITECTURE-SPINE.md#AD-5; DESIGN.md#annotation-comment-pin, #annotation-highlight; AnnotationLayer.tsx; AnnotationInteraction.tsx (create branch)]

2. **Clicking the pin opens a `{component.comment-bubble}` for read/edit; it is keyboard-reachable, `Esc`-dismissable, and focus moves in on open and returns on close (epics.md#Story-2.10 AC2; UX-DR8, UX-DR17).** The pin is a `<button>`; clicking it selects the comment and opens the bubble (surface-card, rounded.md, hairline-strong, body-sm) whose `<textarea>` is focused for immediate typing. Typing writes `body` through `retextAnnotation`. `Esc` blurs + dismisses; focus returns to the prior element on close. [Source: epics.md#Story-2.10; DESIGN.md#comment-bubble; UX-DR8/DR17; AnnotationLayer.tsx (CommentBubble); store/index.ts (retextAnnotation)]

3. **The comment stores as `type=comment`, `anchor kind=text` (drag) OR `kind=rect` (click), `body=text` non-null (epics.md#Story-2.10 AC3; AR-5).** The drag builds `Annotation {type:"comment", anchor:{kind:"text", page_index, rects, text}, style:{color}, body}` (a two-page drag shares one `group_id`); the click builds `{type:"comment", anchor:{kind:"rect", page_index, rect}, style:{color}, body, group_id:null}`. `body` is non-null both ways (starts `""`, updated as the user types). [Source: epics.md#Story-2.10; ARCHITECTURE-SPINE.md#AD-5 (`comment → text` or `rect`; `body` non-null for memo/comment); create.ts (buildAnnotations + body; buildCommentPin)]

4. **The highlight (drag) and pin (both kinds) stay anchored across zoom (epics.md#Story-2.10 AC4; NFR-3).** After creating a comment, zooming re-renders the fill (text comment) AND the pin at the exact page location and scale (both ride the denormalized anchor via `denormalizeRect`); screen position derived, never persisted. Prove LIVE at DPR>1 for BOTH a dragged and a clicked comment. [Source: epics.md#Story-2.10; ARCHITECTURE-SPINE.md#AD-4; AnnotationLayer.tsx]

5. **Comment is a first-class tool in the single `activeTool` FSM (AD-11).** The rail has a Comment button below Memo (DESIGN.md#tool-rail order); clicking it switches `activeTool` to `"comment"` in ONE click; `C` arms it; `V`/`Esc` returns to cursor; arming comment disarms whatever was active (mutual exclusion). Switching TO comment auto-opens its color sub-toolbox (reusing `ToolFlyout` + the shared `flyoutOpen` + the open-on-tool-change effect). A click on the already-active button toggles it; `Esc`/outside-click/switch-away/collapse close it. While comment is armed, pan is off; a drag selects text to comment and a click drops a pin (not a pan). [Source: ARCHITECTURE-SPINE.md#AD-11; tools.ts (`ANNOTATION_TOOLS` includes "comment"); UX-DR4/DR15; ToolRail.tsx; Story 2.6]

6. **Geometry-on-kind / style-on-type honored; bubble replaces the generic quick-box for comments; client-only + contract preserved (AD-5, AD-9, AD-3).** The fill renders off `anchor.kind === "text"` (shared with highlight); the pin/bubble key off `type === "comment"`; the accent keys off `style.color`. A selected comment shows the bubble, never the shared selection quick-box (`showSelectionBox` excludes `type==="comment"`). An empty comment is NOT removed (Decision 5). No store-SCHEMA / persisted-model / anchor-model / API change — `type:"comment"`/`kind=text`/`body` already exist, so `server/openapi.json` (tracked) + `client/src/api/schema.d.ts` stay byte-identical. No new `render/index.ts` export (both `vi.mock("./render")` barrels untouched). `no-raw-values` green (pin/bubble tokens live in `src/theme/**`). Highlight/underline/pen/memo create+select+restyle+delete, pan, zoom-glue do not regress. [Source: ARCHITECTURE-SPINE.md#AD-5, #AD-9, #AD-3; CLAUDE.md#Engineering-principles, #Design-conventions]

## Tasks / Subtasks

- [x] **Task 1 — buildAnnotations body param + buildCommentPin (AC: 1, 3)**
  - [x] `client/src/annotations/create.ts`: add optional `body?: string` to `BuildOptions` (default `null`); set `body: body ?? null` on each built annotation. Highlight/underline callers unchanged (omit it → `null`); the comment drag passes `""`. Update the doc comment (no longer "Story 2.2 proof = highlight" only).
  - [x] `client/src/annotations/create.ts`: add `buildCommentPin({page_index, rect}, docId, {now, newId, color})` → one `type:"comment"`, `kind:"rect"`, `group_id:null`, `style:{color, stroke_width:null}`, `body:""` (the click-placed pin; twin of `buildMemoAnnotation` with `type="comment"`). Export from `annotations/index.ts`.
  - [x] `create.test.ts`: `buildAnnotations` with `type:"comment"`, `body:""` → `body === ""`; without `body` → `body === null` (highlight/underline regression); `buildCommentPin` shape (`type:"comment"`, `kind:"rect"`, `body:""`, null group, color, null stroke).

- [x] **Task 2 — Comment create gestures: drag (text) + click (rect pin) (AC: 1, 3)**
  - [x] `client/src/annotations/AnnotationInteraction.tsx`: in the `pointerup` handler, add `comment`. If `rectsFromSelection` returned pages → text-anchor create branch (`type: "comment"`, `body: ""`, the `buildAnnotations` path shared with highlight/underline). If it returned ZERO and the release target is a `.page-surface` (not `.quick-box`/`.annotation-comment-pin`) → resolve the page via `pickPage`, build a small anchor rect at the click point (`normalizeRect`), `buildCommentPin`, add. Confirm comment is NOT caught by the `pen`/`memo` early-return. After create, `select(created.id)` (opens the bubble).
  - [x] Gate `showSelectionBox` to exclude `type === "comment"`; add `.annotation-comment-pin` to BOTH `.closest(...)` hit-tests (open/reopen + empty-space-deselect) and the on-mark check.

- [x] **Task 3 — Comment pin + bubble render, both kinds (AC: 1, 2, 4, 6)**
  - [x] `client/src/annotations/AnnotationLayer.tsx`: a `type=comment` render path. The FILL stays in `.annotation-highlights` (a `kind=text` comment is already in `highlightMarks` — verify, do not double-paint; a `kind=rect` comment has no fill). Add a NEW, NOT aria-hidden `.annotation-comments` group rendering, per comment mark: a round pin `<button>` at the denormalized first-rect start (`kind=text`) OR rect top-left (`kind=rect`) (`data-testid="annotation-comment-pin-${a.id}"`, accent fill, `onClick` → `select`), and when selected, a `CommentBubble`.
  - [x] `CommentBubble` component (NEW, extracted like `MemoBox`): a `<textarea>` (`value=body`, `onChange`→`retextAnnotation`, autofocus when selected, local `Esc` → blur + `clearSelection`), a `ColorSwatchRow` (recolor → `recolorAnnotation` + set default), a delete button; anchored below the pin via the denormalized first rect (`kind=text`) or rect (`kind=rect`); height re-fits on body/scale change (the `MemoBox` layout-effect pattern). Owns its ref.
  - [x] `client/src/annotations/Annotations.css`: `.annotation-comments` group (pointer-transparent, the pin/bubble opt back in) + `.annotation-comment-pin` (rounded.full, ~20px, accent fill, focus ring) + `.comment-bubble` (surface-card, rounded.md, hairline-strong, body-sm, soft drop). Tokens only (sizes in `src/theme/**`).

- [x] **Task 4 — Comment rail button + C hotkey (AC: 5)**
  - [x] `client/src/ToolRail.tsx`: a Comment `.tool-rail__item` below Memo — armed class, `aria-label="Comment"`, `title="Comment (C)"`, `aria-haspopup`/`aria-expanded`, `data-testid="tool-comment-button"`, toggle-on-active, `ToolFlyout testId="comment-flyout"` with a `<ColorSwatchRow>` (color only; no width/size). Phosphor `ChatCircle`. `commentActive` derive + flyout wiring (twin of underline).
  - [x] `client/src/App.tsx`: `C`/`c` → `setActiveTool("comment")` next to `T` in the document-level keydown.

- [x] **Task 5 — Tests + regression bar (AC: all)**
  - [x] `create.test.ts`: body param + `buildCommentPin` shape (Task 1).
  - [x] `AnnotationInteraction.test.tsx`: comment DRAG creates `type=comment`/`kind=text`/`body=""`, selects it; comment CLICK (no selection) on a page surface creates `type=comment`/`kind=rect`/`body=""` via `buildCommentPin`, selects it; comment NOT in the pen/memo early-return; selecting a comment (either kind) does NOT open the generic selection quick-box (`showSelectionBox` excludes comment); clicking the pin does not clear selection; clicking the quick-box/an existing pin does NOT drop a second pin. Highlight/underline/pen/memo/cursor paths still pass.
  - [x] `AnnotationLayer.test.tsx`: a `kind=text` comment paints a fill in `.annotation-highlights` AND a pin in `.annotation-comments` (not aria-hidden); a `kind=rect` comment paints ONLY a pin (no fill); the pin is a button with the testid; selecting it renders `CommentBubble` with `value=body`; typing fires `retextAnnotation`; recolor fires `recolorAnnotation`; delete fires `deleteAnnotation`; re-derives on zoom; empty comment (either kind) is NOT auto-removed.
  - [x] `ToolRail.test.tsx`: Comment arms in one click; `comment-flyout` shows the swatch row (no width/size row); pick color fires + closes; toggle/Esc/switch-away close it.
  - [x] `App.test.tsx`: `C` arms `"comment"`; `V`/`Esc` return to cursor (no new `render/` export → both `vi.mock("./render")` barrels untouched, confirm).
  - [x] Full regression: client suite + `typecheck` clean; server `pytest`. Contract byte-identical (`git diff --stat client/src/api/schema.d.ts` empty). `no-raw-values` green.
  - [x] **Live smoke** (own fresh `uvicorn` + `vite dev` on alternate ports, a real PDF, DPR=2): (a) arm Comment from cursor (one click) → flyout opens with color; (b) `C` arms comment; (c) DRAG across text → run highlighted ~0.4 + a round pin at the start; (d) CLICK a blank spot → a round pin only, NO highlight (kind=rect); (e) click a pin → bubble opens focused, type a note (body persists), `Esc` dismisses + focus returns; (f) re-click the pin → bubble re-opens with the saved note; (g) recolor from the bubble → fill + pin retint; (h) delete from the bubble removes the comment; (i) zoom 200→250% → fill + pin glued for BOTH a dragged and a clicked comment (record fracLeft/fracW invariants); (j) an empty comment (drag OR click, no typing, deselect) STAYS; (k) highlight/underline/pen/memo still create + select; (l) CROSS-PAGE comment drag at DPR>1 (the highest-risk selection path — fill must not leak full-page; pin renders on the start). Screenshot to `.bmad/implementation-artifacts/2-10-comment-smoke.png`.

- [x] **Task 6 — Docs + version (AC: all)**
  - [x] No `/api` change → `docs/API.md` untouched.
  - [x] Update `client/src/annotations/README.md` with the Story 2.10 comment section (a `type=comment`+`kind=text` mark = free highlight fill + a pin + a bubble; `retextAnnotation` reuse; the bubble replaces the selection quick-box; no empty-cleanup; AD-5 `comment → text`).
  - [x] `server/pyproject.toml` version `0.1.6 → 0.1.7` at done (single source).

## Dev Notes

### What this adds vs reuses

| Need | Reuse | New |
| --- | --- | --- |
| Text-anchor create (drag) + two-page `group_id` split | `buildAnnotations` + the `pointerup` selection path | add `comment`; a `body` param |
| Click-to-place pin (click) | the memo click-place gesture + `pickPage`/`normalizeRect` | `buildCommentPin` (`kind=rect`, `type=comment`); the no-selection `pointerup` branch |
| Entity + contract | `type:"comment"`/`kind=text`/`kind=rect`/`body` already generated | nothing (client-only) |
| Highlight FILL (~0.4, drag only) | the `.annotation-highlights` group already includes `kind=text` + `type !== "underline"` | nothing — the dragged comment paints for free; the clicked pin has no fill |
| Body editing | `retextAnnotation` (no type guard) | nothing (reused as-is) |
| Recolor / delete | `recolorAnnotation` / `deleteAnnotation` | the bubble surfaces them |
| Tool state / mutual exclusion | `activeTool` FSM (`"comment"` already in union) | Comment rail button + `C` |
| Arm-time sub-toolbox | `ToolFlyout` + `flyoutOpen` + `ColorSwatchRow` | comment flyout = color only |
| Zoom-glue | `denormalizeRect` | pin + bubble ride the first rect |
| Mark render | the per-page sheet + denormalize-on-zoom | a round PIN button + a `CommentBubble` in a NEW non-aria-hidden group |

Resist: a `buildCommentAnnotations` fork (the text comment IS the highlight path + a body); a second fill path for the dragged comment (it is already in `highlightMarks`); a separate pointerdown gesture for the click pin (branch the SAME `pointerup` on `pages.length`); a bespoke body store action (reuse `retextAnnotation`); copying the 2.9 empty-memo cleanup onto comments (Decision 5 — comments are kept, both kinds); putting the pin in the aria-hidden mark sheet (it is a focusable control → the `.annotation-comments` group, like memos).

### Decision notes

- **Why the bubble replaces the selection quick-box (not co-exists):** UX-DR5 says comment mode opens the comment-bubble directly. Showing both the bubble AND the generic color/delete box for one selected comment is two competing popups. So `showSelectionBox` excludes `type==="comment"`, and the bubble carries color + delete itself. (Memo kept the generic box because its textarea is the on-page box, not a popup; a comment's note is a popup off the pin — different shape, one affordance.)
- **Pin position on a multi-page comment:** a two-page comment is two `kind=text` annotations sharing a `group_id` (the `buildAnnotations` split). The pin renders at the FIRST rect of EACH comment annotation, so a two-page comment shows a pin on each page's run start. Acceptable for v1 (single-page is the common path = one pin); a single "group-start only" pin is a refinement, not required by the AC. Recolor/delete still act on the whole group (the existing `selectedGroupIds` path) — but note the bubble's group-delete should remove BOTH pages (reuse `deleteAnnotation`, which deletes group siblings).
- **`body` reuse:** `retextAnnotation(id, body, now)` has NO type guard (it sets `body` on any id), so it works on a comment unchanged. Do not add a comment-specific action.
- **Empty comment is kept (Decision 5):** do NOT add a deselect-delete effect for comments. The 2.9 `prevSelectedRef` empty-cleanup is memo-only (`m.type === "memo"`) — confirm it stays memo-scoped so a comment with empty body survives.

### Integration points (the seams)

- `client/src/annotations/create.ts` — `BuildOptions.body?` (default null) threaded onto each built annotation; NEW `buildCommentPin` (`kind=rect`, `type=comment`).
- `client/src/annotations/AnnotationInteraction.tsx` — in `pointerup`, the comment DRAG path (selection → `buildAnnotations` body `""`) AND the comment CLICK path (no selection on a page surface → `buildCommentPin`); exclude `type==="comment"` from `showSelectionBox`; add `.annotation-comment-pin` to the two `.closest()` hit-tests + the on-mark/open checks (also guards the click path off an existing pin). The comment selection shows the bubble (rendered in the layer), so the interaction layer mostly just creates + selects.
- `client/src/annotations/AnnotationLayer.tsx` — the `type=comment` render: confirm the fill is in `highlightMarks`; add the `.annotation-comments` group with the pin `<button>` + `CommentBubble`. New `CommentBubble` component (sibling of `MemoBox`).
- `client/src/annotations/Annotations.css` — `.annotation-comments`/`.annotation-comment-pin`/`.comment-bubble`.
- `client/src/ToolRail.tsx` — Comment button + color flyout (twin of underline; color only).
- `client/src/App.tsx` — `C` key.
- `client/src/theme/components.css` — pin size + bubble tokens (if not already covered by `DESIGN.md` → `tokens.css`; keep raw px in `src/theme/**` only).
- `client/src/tools.ts` — `ANNOTATION_TOOLS` already has `"comment"`; no change.
- `client/src/store/index.ts` — NO change (reuse `retextAnnotation`/`recolorAnnotation`/`deleteAnnotation`). Verify the memo empty-cleanup stays memo-scoped.

### Engineering conventions in force (CLAUDE.md#Engineering-principles)

- **Adopt-stable / one model:** reuse `buildAnnotations`, the `pointerup` selection path, `denormalizeRect`, `retextAnnotation`, `recolorAnnotation`, `deleteAnnotation`, `ToolFlyout`, `ColorSwatchRow`, `activeColor`. New = a `body` param, a pin button, a `CommentBubble`, a rail button + `C`. One `activeTool`, one `activeColor`. [[prefer-stable-solutions]]
- **Document-level handlers (AP-1):** the `C` key joins App's document-level keydown (phase-gated, editable/buttons exempt). The comment bubble's textarea is an editable field → EXEMPT from the document-level tool/selection keys (typing `c`/`v`/`Del` inside the bubble must NOT arm tools or delete the mark — the `isExempt` TEXTAREA guard already covers it; the bubble's local `Esc` handles dismiss like `MemoBox`). [[held-key-state-reset-on-blur]]
- **`render/` mock-barrel sync (AP-2):** no new `render/index.ts` export → both barrels untouched. Confirm.
- **Selection→rects measure text nodes (cross-page):** comment reuses `rectsFromSelection`/`collectTextRects` (highlight's path) — the cross-page full-page-highlight bug is already fixed there, but a comment is a NEW selection feature, so live-smoke a CROSS-PAGE comment at DPR>1 (jsdom zeroes rects). [[verify-on-hidpi-and-real-host]]
- **HiDPI live smoke:** comment is a selection + placed-pin + editable-bubble feature; live-smoke create, pin-click→bubble, typing (focus in/out), recolor, delete, zoom-glue, empty-kept, and CROSS-PAGE at DPR>1. [[verify-on-hidpi-and-real-host]]
- **Cross-model code review (AP-3):** run `bmad-code-review` (Codex) after dev-story.

### Testing standards

- Frontend Vitest + jsdom: assert the MODEL/wiring — the create call (`type:"comment"`/`kind:"text"`/`body:""`), the layer's pin button + `.annotation-comments` group + `CommentBubble`, the `retext`/`recolor`/`delete` writes from the bubble, the `showSelectionBox` exclusion, the rail flyout + `activeTool` switch, the `C` keymap, the empty-comment-kept — NOT pixel geometry (jsdom zeroes rects). Reuse the fake-card pattern; drive the textarea via `fireEvent.change`.
- Backend pytest: no model/contract change; run to confirm no regression.

### Project Structure Notes

- Touched: `annotations/create.ts` (+test), `AnnotationInteraction.tsx` (+test), `AnnotationLayer.tsx` (+ new `CommentBubble`, +test), `Annotations.css`, `ToolRail.tsx` (+test), `App.tsx` (+test), `theme/components.css`, `annotations/README.md`, `server/pyproject.toml`. No new top-level dirs. `machine.ts`/`tools.ts`/`render/`/`anchor/`/`store/`/api-schema unchanged (store reuse only). [Source: ARCHITECTURE-SPINE.md#Structural-Seed]
- Layer rule (AD-9): touches the App composition root (`C` key), the rail (Comment button), and `annotations/` (create branch, layer render, bubble). No `render/`/anchor/store-SCHEMA/contract change.

### Versioning

- PATCH +1 at done: `server/pyproject.toml` `0.1.6 → 0.1.7` (single source). Bump once at done.

### References

- [Source: .bmad/planning-artifacts/epics.md#Story-2.10] — story + ACs (drag across text → highlight ~0.4 + a round comment pin; click → a pin only; click pin → comment-bubble for read/edit, keyboard-reachable + Esc-dismissable + focus in/out; stores type=comment/kind=text or rect/body; highlight+pin stay anchored on zoom).
- [Source: ARCHITECTURE-SPINE.md#AD-5] — `comment → text` (highlights text + pin) or `rect`; `body` non-null for memo/comment; geometry-on-kind / style-on-type.
- [Source: ARCHITECTURE-SPINE.md#AD-4] — page-normalized rects + zoom re-derivation (NFR-3).
- [Source: ARCHITECTURE-SPINE.md#AD-11] — single `activeTool`; single-click switch.
- [Source: ARCHITECTURE-SPINE.md#AD-12, #AD-9, #AD-3] — selection seam; layering; contract stability (no API/Pydantic/generated-type change; `type:"comment"`/`kind=text`/`body` already exist).
- [Source: DESIGN.md#annotation-comment-pin, #comment-bubble, #tool-rail, #quick-box] — pin (annotation-default bg, rounded.full, 20px), bubble (surface-card, rounded.md, hairline-strong, body-sm, soft drop), rail tool order (comment below memo), comment-mode quick-box = bubble opens directly.
- [Source: UX-DR5/DR7/DR8/DR15/DR17] — contextual quick-box (comment → bubble directly), on-page comment-pin rendering, comment-bubble open-on-pin + keyboard/Esc/focus, `C` keymap, accessibility floor.
- [Source: .bmad/implementation-artifacts/2-9-textbox-memo.md] — the `MemoBox` interactive-textarea pattern (ref + layout-effect re-fit, autofocus-when-selected, local Esc → blur + clearSelection), the non-aria-hidden group for focusable content, the rail-button/flyout twin, `retextAnnotation`, the create-then-select flow. Comment mirrors `MemoBox` with `CommentBubble`.
- [Source: .bmad/implementation-artifacts/2-3-highlight-text-via-drag.md] — the highlight drag-selection create path the comment DRAG reuses verbatim (type is the only delta, + body).
- [Source: .bmad/implementation-artifacts/2-9-textbox-memo.md] — the memo click-to-place gesture (`pointerdown`/release on a page surface → `pickPage` + `normalizeRect`) the comment CLICK pin reuses (type=comment instead of memo, a pin not a box).
- [Source: CLAUDE.md#Engineering-principles, #Design-conventions, #Versioning].

## Previous Story Intelligence

From Story 2.9 (memo, done) + its Codex review + the Epic-2 pattern:

- **Interactive content lives in a non-aria-hidden group.** Memos render in `.annotation-memos` (NOT aria-hidden) because a focusable `<textarea>` cannot sit in the decorative aria-hidden mark sheet. The comment PIN (`<button>`) and BUBBLE (`<textarea>`) are focusable → the same rule: a NEW `.annotation-comments` group, NOT aria-hidden. Do not put the pin in the aria-hidden layer.
- **Extract the interactive box as its own component with a ref + layout-effect (Codex MED).** `MemoBox` re-fits height on body/scale change (not only on keystroke) so long text re-fits after zoom/remount. `CommentBubble` should follow the same shape.
- **Editable-field exemption is critical.** The bubble's textarea is an editable field — the document-level tool keys (`H`/`U`/`D`/`T`/`C`/`V`) and selection keys (`Del`/`Backspace`/`Esc`) MUST be exempt when focus is in it (the `isExempt` TEXTAREA guard covers it). The bubble's LOCAL `Esc` (blur + `clearSelection`) handles dismiss, mirroring `MemoBox` (Codex MED: Esc inside the textarea would otherwise be swallowed).
- **Empty-cleanup is memo-only (Decision 5 inversion).** 2.9 deletes an empty memo on deselect; a comment is KEPT. Confirm the `prevSelectedRef` cleanup effect stays gated on `type === "memo"` so it never nukes an empty comment.
- **Live smoke is the real verifier; jsdom zeroes geometry.** Verify create, pin-click→bubble, typing-with-focus-management, recolor, delete, zoom-glue, empty-kept, AND a cross-page comment at DPR>1.
- **Launch your OWN dev servers; contract byte-identical discipline; cross-model review after.**

## Git Intelligence

- Baseline: `1fb83b9` (Chore: Mark Story 2.9 textbox-memo done) on `main`. The anchor rect math, `rectsFromSelection`/`collectTextRects`, `buildAnnotations` + the two-page `group_id` split, the `activeTool` FSM (`"comment"` already in the union), the 2.5 selection seam, the 2.6 `ToolFlyout`/`ColorSwatchRow`/`activeColor`, the 2.9 `MemoBox` interactive-content pattern + `retextAnnotation`, and `denormalizeRect` zoom-glue are all merged. This story adds the comment by REUSING the highlight create path (type + body delta) + a pin button + a `CommentBubble` cloned from `MemoBox`.
- Branch off `main` (never commit to `main`). Dev loop = host two-process flow (`uvicorn --reload` + `vite dev`).
- No contract change → keep `client/src/api/schema.d.ts` byte-identical (verify after the suite).

## Project Context Reference

- Two processes, one container (AD-1/AD-10): `client/` (React 19.2 + Vite 8 + TS 6.0) + `server/` (FastAPI + Pydantic v2). v1 scope = Phase 1; no auth, localhost single-user.
- Client layering (AD-9): `render → anchor → annotations → store → api`, strict downward. Comment touches the App root (`C` key), the rail (Comment button), and `annotations/` (create branch, layer render, bubble). No `render/`/anchor/store-SCHEMA/contract change (store actions reused).
- `anchor.kind` (AD-5) is the geometry discriminator — comment is `kind=text` (shared with highlight); `type=comment` selects the pin/bubble paint. `activeColor` (store) is the shared default the create path reads.

## Story Completion Status

Ultimate context engine analysis completed - comprehensive developer guide created. Comment is a low-new tool: it reuses two existing gestures behind `type=comment`. DRAG across text → a `kind=text` comment (the highlight drag-create path verbatim, type + a non-null `body` the only delta, ~0.4 fill FREE in the existing highlights group); CLICK a spot → a `kind=rect` comment pin (the memo click-place gesture's twin, `buildCommentPin`, no fill). Both open one bubble and reuse `retextAnnotation`/`recolorAnnotation`/`deleteAnnotation` with zero store change. Five design calls are pre-resolved (1 — TWO create gestures branched on `pages.length` in ONE `pointerup`: drag→text comment, click→rect pin, per AD-5 `comment → text` or `rect`; 2 — the drag fill is free, new = a pin (both kinds) + a bubble; 3 — body via the reused `retextAnnotation`, creation-time + on-reopen, command-path is 3.1; 4 — the comment-bubble REPLACES the generic selection quick-box per UX-DR5; 5 — empty comments are KEPT for both kinds, inverting the 2.9 memo cleanup). The contract already carries comment (`type:"comment"`/`kind=text`/`kind=rect`/`body`), so this is client-only with the tracked contract byte-identical. Success = comment is a first-class tool (rail button below Memo + `C` + a color sub-toolbox); a drag highlights the run + drops a round pin AND a click drops a pin only; clicking a pin opens a keyboard-reachable, Esc-dismissable, focus-managed bubble you read/edit; it stores `type=comment`/`kind=text` or `kind=rect`/`body`; the bubble recolors/deletes it; the highlight+pin stay glued across zoom; empty comments survive; and the live smoke passes drag + click + pin→bubble + typing + recolor + delete + zoom-glue + cross-page at DPR>1 without regressing highlight/underline/pen/memo/pan/zoom.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (bmad-dev-story)

### Debug Log References

- Live smoke: own fresh servers on alt ports (uvicorn :8001, vite dev :5174 proxying to it; user's stale :8000/:5173 left untouched), real PDF `fixtures/sample-pdfs/09-regularization.pdf` (23 pages) at DPR=2 via chrome-devtools. Screenshot: `.bmad/implementation-artifacts/2-10-comment-smoke.png`.

### Completion Notes List

- **Task 1 (create):** `BuildOptions.body?` (default null) threaded onto each built mark; highlight/underline omit it → null, comment drag passes `""`. NEW `buildCommentPin` (`type:"comment"`/`kind:"rect"`/`body:""`/null group, a degenerate point rect). Exported from `annotations/index.ts`. Unit-tested.
- **Task 2 (gestures):** `pointerup` extended — non-empty selection + `tool==="comment"` → `buildAnnotations` with `body:""` (the highlight path + the one delta); empty selection + `tool==="comment"` over a `.page-surface` (guarded off quick-box / existing pin / bubble / any mark) → `buildCommentPin` at the click. Both add + select. `showSelectionBox` now excludes `type==="comment"`. Pin + bubble added to the empty-space-deselect hit-test. The empty-memo cleanup stays gated on `type==="memo"` (verified) so an empty comment survives (Decision 5).
- **Task 3 (render):** NEW `CommentBubble` (the `MemoBox` twin): textarea→`retextAnnotation`, `ColorSwatchRow`→`recolorAnnotation`+set default, delete; focus-in on open / focus-return on unmount; local Esc → blur + clearSelection. NEW `renderComment` paints a round pin `<button>` (both kinds) in a NEW NOT-aria-hidden `.annotation-comments` group; the `kind=text` fill rides FREE in `.annotation-highlights` (no second fill path); the bubble mounts only for the exactly-selected comment. CSS: `.annotation-comments`/`.annotation-comment`/`.annotation-comment-pin`/`.comment-bubble` (tokens only); pin/bubble dims added to `theme/components.css`.
- **Task 4 (rail + key):** Comment `.tool-rail__item` below Memo (`ChatCircle`, color-only flyout, `tool-comment-button`/`comment-flyout` testids, toggle-on-active); `C`/`c` → `setActiveTool("comment")` in App's document keydown.
- **Task 5 (tests + smoke):** create.test (+body param, +buildCommentPin), AnnotationInteraction.test (drag→text comment, click→rect pin, guard no-double-pin, non-comment no-pin, empty-kept), AnnotationLayer.test (text=fill+pin, rect=pin-only, pin-click→bubble, retext/recolor/delete, zoom re-derive, no-bubble-unselected, empty-not-removed, no group when none), ToolRail.test (arm-one-click, color-only flyout, pick closes, toggle/Esc/switch-away), App.test (`C` arms, V/Esc disarm). Full client suite 366 green, typecheck clean, no-raw-values green, backend pytest 38 green, contract (`schema.d.ts` + `openapi.json`) byte-identical. Live smoke ALL PASS: arm one-click + flyout; `C`/`V`; text drag → ~0.4 fill + pin + focused bubble; blank click → pin only (no fill); type→persist, Esc→dismiss+focus-return; re-click→reopen with saved note; recolor retints fill+pin; delete removes; zoom 100→250% pins glued for BOTH dragged + clicked (fracLeft 0.0333→0.0332, 0.2196→0.2195); empty comment KEPT on deselect; highlight + memo still create; CROSS-PAGE comment drag at DPR=2 → fill split per page (max 33px on a 1980px card), NO full-page leak, a pin on each page's run start.
- **Task 6 (docs/version):** no `/api` change → `docs/API.md` untouched; `annotations/README.md` gains the Story 2.10 section; `server/pyproject.toml` `0.1.6 → 0.1.7`.
- No new `render/index.ts` export → both `vi.mock("./render")` barrels untouched (AP-2).

### File List

- client/src/annotations/create.ts (modified — `BuildOptions.body?`; NEW `buildCommentPin` + types)
- client/src/annotations/create.test.ts (modified — body param + buildCommentPin tests)
- client/src/annotations/index.ts (modified — export buildCommentPin)
- client/src/annotations/AnnotationInteraction.tsx (modified — comment drag + click gestures; showSelectionBox excludes comment; pin/bubble in deselect hit-test)
- client/src/annotations/AnnotationInteraction.test.tsx (modified — comment gesture tests)
- client/src/annotations/AnnotationLayer.tsx (modified — NEW CommentBubble + renderComment + comments group)
- client/src/annotations/AnnotationLayer.test.tsx (modified — comment render/bubble/zoom tests)
- client/src/annotations/Annotations.css (modified — comments group, pin, bubble styles)
- client/src/ToolRail.tsx (modified — Comment button + color flyout)
- client/src/ToolRail.test.tsx (modified — comment rail tests)
- client/src/App.tsx (modified — `C` hotkey)
- client/src/App.test.tsx (modified — `C` keymap test)
- client/src/theme/components.css (modified — comment pin + bubble tokens)
- client/src/annotations/README.md (modified — Story 2.10 section)
- server/pyproject.toml (modified — version 0.1.6 → 0.1.7)
- .bmad/implementation-artifacts/2-10-comment-smoke.png (added — live smoke screenshot)
- .bmad/implementation-artifacts/deferred-work.md (modified — memo/comment confirm-check feature request)

## Change Log

- 2026-06-29: Story created (ready-for-dev) via bmad-create-story.
- 2026-06-29: Revised per user review — comment supports BOTH gestures: DRAG → kind=text (highlight + pin), CLICK → kind=rect (pin only, no highlight). Added buildCommentPin + the no-selection pointerup branch; pin renders for both kinds; empty-kept covers the clicked pin. (AD-5 `comment → text` or `rect`.)
- 2026-06-29: Implemented (status → review) via bmad-dev-story. Client-only: body param + buildCommentPin, comment drag/click gestures, pin + CommentBubble render, rail button + `C` key. 366 client + 38 server tests green, contract byte-identical, live-smoked at DPR=2 incl. cross-page (no full-page leak). Version 0.1.7.
