# Epic 2: Annotate the paper

Mark up the page with all six tools via drag-to-annotate and the contextual quick-box. Marks land anchored to exact PDF coordinates and the page never moves. This epic proves the spatial-anchor model holds across zoom (NFR-3) and defines the Annotation entity (AR-5).

> Restructured 2026-06-29 (correct-course, see `sprint-change-proposal-2026-06-29.md`): added a dev-infra enabler (Story 2.1) and split the foundation out of the original Story 2.1 into a dedicated Annotation-foundation story (Story 2.2), renumbering the six tool stories to 2.3–2.9 so number = execution order. Rationale: the original 2.1 bundled five net-new architectural pillars (`anchor/` service, `Annotation` entity, Zustand `store/`, `annotations/` overlay, quick-box shell) with the highlight feature — the foundation is the highest-leverage decision of the epic (Epic 1 retro PREP-1) and earns its own story. Standing principle applied across the anchor stories: **adopt stable primitives, don't reinvent wheels** (Epic 1 retro AP-4).

> Restructured again 2026-06-29 (correct-course, see `sprint-change-proposal-2026-06-29-tool-fsm.md`): the Story 2.3 live smoke found two design changes — tool state was two orthogonal fields (pan could eat an annotation drag) and there was no arm-time color pick. Inserted Story 2.4 (unify tool state into one `activeTool` FSM, AD-11) and Story 2.5 (arm-time color quick-pick) ahead of the remaining tool features, renumbering the old 2.4–2.9 to 2.6–2.11 so number = execution order. The FSM (PREP-3) lands first so the later tool stories build on one mutually-exclusive model.

> Restructured again 2026-06-29 (correct-course, see `sprint-change-proposal-2026-06-29-select-highlight.md`): the same Story 2.3 live smoke also found highlights are not selectable (no recolor/delete after creation), and Epic 3's Stories 3.1/3.3 silently assume a selection seam nobody builds. Added one AC to Story 2.4 (a rail click switches `activeTool` in a single click; a tool's quick-box never opens in place of the switch) and inserted Story 2.5 "Select a highlight (click-select, recolor, delete)" right after the FSM (AD-12), renumbering the old 2.5–2.11 to 2.6–2.12. Lightweight click-select + recolor/delete lands in Epic 2; drag-handle move/resize + text re-edit stay in Story 3.1.

## Story 2.1: Dev-infra enabler (local Docker dev loop)

As a developer,
I want the local Docker dev loop usable (writable data dir, live backend),
So that Epic 2's heavy iteration isn't blocked by stale containers or root-owned files.

> Enabler, not a product feature. Sequenced first so the rest of Epic 2 develops without the dev-experience friction surfaced in Epic 1 (`deferred-work.md`, 2026-06-29). No annotation code.

**Acceptance Criteria:**

**Given** `docker compose up`
**When** the container writes to the mounted `/data`
**Then** new files are owned by the host user (compose `user:` set, host dir pre-created), so the host user can edit/delete library files — not root-owned (AD-10; `deferred-work.md`)

**Given** a backend code change
**Then** the dev loop is documented: either (a) local dev = the host two-process flow (`uvicorn --reload` + `vite dev`) with Docker as the prod-like single-command boot, OR (b) a dev compose override bind-mounts `server/app` and runs `uvicorn --reload`; the decision is recorded in the dev docs (CLAUDE.md/README) so a stale container is never mistaken for a bug

**Given** the enabler
**Then** it changes no product behavior and touches no annotation code (Dockerfile / docker-compose / dev docs only)

## Story 2.2: Annotation foundation (anchor service + store + overlay)

As a reader,
I want a single mark to land anchored to exact PDF coordinates and survive zoom,
So that every annotation tool is built on one proven spatial foundation.

> The architectural through-line of the epic (AR-4/AD-4). Stands up `anchor/`, the `Annotation` entity, the Zustand `store/`, the `annotations/` overlay, and the quick-box shell — proven end-to-end by the simplest mark — so Stories 2.3–2.12 are thin features on top. Adopt stable primitives (Epic 1 retro AP-4/PREP-1).

**Acceptance Criteria:**

**Given** the rendered page box (AD-4)
**Then** the `anchor/` service provides normalized↔screen projection built on pdf.js `viewport.convertToPdfPoint` / `convertToViewportPoint` (adopt the stable primitive, do NOT hand-roll); `anchor/` is the ONLY home of that math (AD-9, NFR-3)

**Given** a text selection
**Then** text-run rects come from the native Selection API + `Range.getClientRects()` over the pdf.js text layer (stable primitive), normalized to canonical `{x0,y0,x1,y1}` with `x0≤x1, y0≤y1`, top-left origin, against the page box; screen position is derived, never persisted (AR-4, AR-9)

**Given** a created mark
**Then** it stores as `Annotation {id(uuidv4), doc_id, type, group_id, anchor(kind), style, body, created_at, updated_at}` keyed by `id` in the Zustand `store/` (AD-5, AD-7); rendering keys off `anchor.kind`, never `type`

**Given** the annotations overlay
**Then** it renders in the `annotations/` layer as an overlay that never reflows the canvas (NFR-1), and the `{component.quick-box}` shell exists (pops on drag-release; dismiss on pick, outside-click, or `Esc`) for every tool story to reuse (UX-DR5, UX-DR6, UX-DR16)

**Given** a selection spanning two pages
**Then** it splits into one annotation per page sharing a `group_id` (AR-4)

**Given** I zoom after creating the mark
**Then** it re-renders on the exact location across all zoom levels (NFR-3 proven on the simplest mark)

**Given** the tool-arm keys and overlay interactions
**Then** they follow the document-level handler convention (phase-gated, editable/buttons exempt) and distinguish armed/active/empty states with proper focus return (Epic 1 retro AP-1, PREP-3)

## Story 2.3: Highlight text via drag

> Builds on the Story 2.2 foundation: the anchor service, `Annotation` entity, store, and quick-box shell already exist; this story is the highlight feature on top.


As a reader,
I want to drag across text and drop a highlight,
So that I mark passages and the page never moves.

**Acceptance Criteria:**

**Given** the highlight tool armed (rail button or `H`)
**When** I drag across a text run and release
**Then** a highlight renders over the run at `{colors.annotation-default}` ~0.4 opacity, and the page does not shift or reflow (FR-7, FR-13, NFR-1, UX-DR7)

**Given** the drag selection
**Then** the anchor service produces a page-normalized anchor `kind=text {rects: Rect[], text}`, canonical `{x0,y0,x1,y1}` with `x0≤x1, y0≤y1`, top-left origin, against the rendered page box; screen position is derived, never persisted (AR-4, AR-9)

**Given** a created highlight
**Then** it stores as `Annotation {id(uuidv4), doc_id, type=highlight, group_id, anchor, style.color, created_at, updated_at}` keyed by `id`; rendering keys off `anchor.kind`, never `type` (AR-5)

**Given** a selection spanning two pages
**Then** it splits into one annotation per page sharing a `group_id` (AR-4)

**Given** drag-release
**Then** a `{component.quick-box}` pops at the selection with the color-swatch row; choosing a swatch recolors; it never shifts the canvas; dismiss on pick, outside-click, or `Esc` (UX-DR5, UX-DR6, UX-DR16)

**Given** I zoom after creating
**Then** the highlight re-renders on the exact text run across all zoom levels (NFR-3 proven)

## Story 2.4: Unify tool state (single activeTool FSM)

> Added 2026-06-29 via correct-course (`sprint-change-proposal-2026-06-29-tool-fsm.md`). Story 2.3 live smoke found that `mode` (cursor/hand/box) and `armedTool` (highlight) being two orthogonal states let pan and highlight both arm at once, so pan ate the highlight drag ("no reaction"). 2.3 shipped a surgical mutual-exclusion patch; this story replaces it with one finite-state model. Sequenced first so the remaining tool stories (2.7–2.12) build on it (Epic-1 retro PREP-3: design the overlay state machine once).

As a reader,
I want exactly one tool active at a time,
So that arming a tool never lets another (pan) swallow my gesture and the rail always shows one active tool.

**Acceptance Criteria:**

**Given** the reader
**Then** a single `activeTool` model (`cursor|hand|box|highlight|underline|pen|memo|comment`) is the one source of truth, mutually exclusive by construction, replacing App's `mode` + `armedTool` and reconciling the Story 2.2 overlay machine; the 2.3 surgical mutual-exclusion patch is removed in favor of the FSM with behavior preserved (AD-11)

**Given** any tool armed
**When** another is armed (rail or hotkey `V`/`Esc`/`H`/`U`/`D`/`T`/`C`/`M`)
**Then** the previous disarms; exactly one rail button reads active (cursor active in plain cursor mode, per the 2.3 #3 fix), via document-level handlers, phase-gated, editable/buttons exempt (AP-1)

**Given** the overlay
**Then** the transient quick-box machine (`armed/annotating/pending/empty`) is driven by the same model, not a parallel one (PREP-3)

**Given** the tool rail
**When** I click any tool button
**Then** `activeTool` switches to it in a single click and the rail reflects it immediately; a tool's quick-box (arm-time picker or recolor row) opens only when that tool is already active or on drag-release, never in place of the switch — so clicking cursor/selection while highlight is armed switches to cursor in one click and does NOT open a sub-toolbox (AD-11; fixes the Story 2.3 live-smoke single-click-switch issue)

**Given** existing behavior
**Then** highlight-on-drag (2.3), pan (`activeTool==="hand"`), zoom/scroll, and all current tests still pass; FSM transition unit tests added; no anchor/store/contract change (AD-9)

## Story 2.5: Select a highlight (click-select, recolor, delete)

> Added 2026-06-29 via correct-course (`sprint-change-proposal-2026-06-29-select-highlight.md`). Story 2.3 live smoke surfaced that highlights are not selectable — there is no way to recolor or remove a mark after creation. Epic 3 Stories 3.1/3.3 assume a "selected annotation" exists but nothing builds the hit-test + selected-state seam, and they assume cursor-mode drag-handles, not cross-mode click-select. This story builds the selection seam (AD-12) plus the lightweight recolor/delete edit; the heavier drag-handle move/resize and text re-edit stay in 3.1. Sequenced right after the FSM (2.4) because cross-mode click-select depends on the single `activeTool` model.

As a reader,
I want to click a highlight to select it and then recolor or delete it,
So that I can fix or remove marks without re-creating them.

**Acceptance Criteria:**

**Given** a rendered highlight
**When** I single-click it in cursor mode OR while a highlight tool is active
**Then** it becomes the selected annotation (single selection; one nullable `selectedId` in the store), hit-tested against its page-normalized rects via the anchor service (AD-4, recent-wins on overlap); clicking empty space or `Esc` clears selection (AD-12)

**Given** a selected highlight
**Then** its quick-box opens with the color-swatch row for recolor (reuses `recolorAnnotation` + `ColorSwatchRow` from 2.3) plus a delete affordance; recolor writes through the store; delete removes the mark by `id` and its `group_id` siblings across pages (AR-4)

**Given** a selected highlight
**When** I press `Del`/`Backspace`
**Then** it is deleted (IP-8); this delete path is the seed Epic 3's Story 3.3 reuses — no command stack / undo yet (those arrive in 3.2/3.3)

**Given** an active annotation tool
**Then** click-select vs new-create is disambiguated by hit-test: pointerdown on an existing mark selects it; pointerdown on empty text starts a create (consistent with the 2.4 `activeTool` FSM, AD-11)

**Given** the selection + delete
**Then** they stay client-side (`store/` + `annotations/` only); persistence and undo are deferred to Epic 3; no anchor/store/contract change beyond the `selectedId` UI state and a client delete action (AD-9 layering preserved)

**SCOPE GUARD:** lightweight edit only — NO drag handles, move, resize, or text re-edit. Those remain Story 3.1.

## Story 2.6: Arm-time color quick-pick

> Added 2026-06-29 via correct-course. Story 2.3's swatch row only recolors a mark *after* it is created; users expect to pick a color when arming the tool. Sequenced before the color tools (underline/pen) so they inherit it.

As a reader,
I want to pick the highlight color when I arm the tool,
So that new marks land in my chosen color without a recolor step.

**Acceptance Criteria:**

**Given** a color tool armed (highlight; later underline/pen)
**Then** the `{component.color-swatch}` row pops as an on-arm picker to set the **default** color for subsequent marks, distinct from the post-create recolor row (EXPERIENCE.md IP-1/IP-3, UX-DR5/DR6)

**Given** a chosen default
**When** I then drag a mark
**Then** it is created in that color (the create path reads the active color, not a hardcoded `annotation-default`); the default persists for the armed session

**Given** the post-create recolor row (2.3)
**Then** it still works; both read/write the same active-color state

**Given** the on-arm picker
**Then** it is keyboard-reachable, `Esc`-dismissable, and never shifts the canvas (NFR-1, UX-DR17); no anchor/contract change

## Story 2.7: Underline text

As a reader,
I want to underline text,
So that I emphasize lines without the page moving.

**Acceptance Criteria:**

**Given** underline armed (button or `U`)
**When** I drag across text and release
**Then** a 2px accent underline renders under the run via the same text-anchor path (FR-8, UX-DR7)

**Given** drag-release
**Then** the quick-box shows the color-swatch row (UX-DR5, UX-DR6)

**Given** zoom
**Then** the underline stays anchored across zoom levels (NFR-3)

## Story 2.8: Pen / freehand

As a reader,
I want to draw freehand on the page,
So that I can sketch marks beside the text.

**Acceptance Criteria:**

**Given** pen armed (button or `D`)
**When** I drag
**Then** a vector freehand stroke draws (perfect-freehand) and stores as `kind=path {points: {x,y}[]}` normalized, `type=pen` (FR-9, AR-5, IP-9)

**Given** drag-release
**Then** the pen quick-box offers color swatches + stroke-width steps; `style` carries `color` + `stroke_width` (path-only per AR-5) (UX-DR5, UX-DR7)

**Given** zoom
**Then** the stroke re-renders at correct scale and position (NFR-3)

## Story 2.9: Textbox memo

As a reader,
I want a free-floating memo,
So that I type a note onto the page without displacing the text.

**Acceptance Criteria:**

**Given** memo armed (button or `T`)
**When** I place a spot
**Then** an `{component.annotation-memo}` box with an inline `{component.text-input}` appears, and typed text does not displace page text (FR-10, UX-DR7)

**Given** the memo
**Then** it stores as `type=memo`, `anchor kind=rect {rect}`, `body=text` (non-null) (AR-5)

**Given** the memo quick-box
**Then** it offers inline text + color/size (UX-DR5)

**Given** zoom
**Then** the memo box stays anchored (NFR-3)

## Story 2.10: Comment (highlight + pin + bubble)

As a reader,
I want a comment anchored to a spot,
So that I attach a note that opens on click.

**Acceptance Criteria:**

**Given** comment armed (button or `C`)
**When** I drag across text and release
**Then** the run is highlighted (~0.4) AND a round `{component.annotation-comment-pin}` anchors at the spot (FR-11, UX-DR7)

**Given** the pin
**When** I click it
**Then** a `{component.comment-bubble}` opens for read/edit; it is keyboard-reachable, `Esc`-dismissable, and focus moves into it on open and returns on close (UX-DR8, UX-DR17)

**Given** the comment
**Then** it stores as `type=comment`, `anchor kind=text` (or rect), `body=text` (AR-5)

**Given** zoom
**Then** the highlight and pin stay anchored (NFR-3)

## Story 2.11: Box-select a region

As a reader,
I want to box-select an area,
So that I can mark a region, not just text.

**Acceptance Criteria:**

**Given** box-select armed (cursor flyout or `M`)
**When** I drag a rectangular region and release
**Then** a region annotation is created with `anchor kind=rect {rect}` (FR-12, AR-5)

**Given** drag-release
**Then** the region quick-box offers the region tool-type picker (highlight / comment; snapshot reserved for Phase 2) (UX-DR5)

**Given** the region
**Then** the overlay never reflows the page (NFR-1)

## Story 2.12: Drag-to-change-tool quick-box

As a reader,
I want a tool picker on drag in cursor mode,
So that I switch tool mid-annotation without going to the left rail.

**Acceptance Criteria:**

**Given** cursor/selection mode (no annotation tool armed)
**When** I drag across a text run and release
**Then** the `{component.quick-box}` pops a tool-type picker: highlight / underline / comment / memo (FR-14, UX-DR5)

**Given** the picker
**When** I choose a tool
**Then** the annotation is created in that tool's mode on the current selection, with no trip to the rail (FR-14)

**Given** the picker
**Then** it dismisses on pick, outside-click, or `Esc`, and never shifts the canvas (UX-DR5)

## Story 2.13: Pen stroke alpha (transparency)

> Added 2026-06-29 via correct-course (user feature request). Pen (Story 2.8) draws a full-opacity vector stroke; the user wants pen marks to be semi-transparent like the highlighter by default, with an adjustable alpha. Appended as 2.13 (after the tool stories) so it does not renumber 2.9–2.12; it is a pen-style refinement that can land any time after pen.

As a reader,
I want to adjust a pen stroke's transparency,
So that my freehand marks sit over the text like a highlighter instead of hiding it.

**Acceptance Criteria:**

**Given** the pen tool armed
**Then** a new stroke lands at the DEFAULT alpha (= the highlighter opacity, `{component.annotation-highlight}` ~0.4), stored per-mark as `style.alpha` (AR-5; additive, backward-compatible contract field — pre-2.13 marks with no alpha fall back to the default) (FR-9)

**Given** the pen sub-toolbox (arm-time) AND a selected pen mark's quick-box
**Then** an alpha control adjusts the transparency (step set or slider); the live preview, the new stroke, and a recolor/restyle all reflect the chosen alpha; the choice is the sticky session default (last-choice-wins, like color/width) (UX-DR5/DR7)

**Given** zoom
**Then** the alpha-rendered stroke stays anchored and correctly scaled, alpha unchanged (NFR-3)
