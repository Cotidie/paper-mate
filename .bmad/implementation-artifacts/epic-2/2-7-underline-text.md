---
baseline_commit: 7126a2292d69908e66b2becb71b74e40061f4013
---

# Story 2.7: Underline text

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a reader,
I want to underline text,
so that I emphasize lines without the page moving.

> **This is the second annotation tool, and it is mostly a paint variant of highlight, not new machinery.** Underline reuses the SAME text-anchor path highlight already uses (`rectsFromSelection` → `buildAnnotations` → `kind=text {rects, text}` → store), the SAME create-on-release timing, the SAME selection quick-box (recolor + delete, 2.5), the SAME arm-time color sub-toolbox pattern (2.6), and the SAME `activeColor`. The ONLY genuinely new behavior is: (1) the create path is no longer hardcoded to `type: "highlight"` — it reads the armed tool, so a drag while underline is armed lands `type: "underline"`; and (2) the overlay renders a `type=underline` mark as a **2px accent line under the run** instead of a ~0.4-opacity fill over it. Everything else is wiring a second rail button + the `U` hotkey, both of which the FSM (2.4) and tool model already anticipate.

## The one decision that defines this story (read before coding)

**Geometry keys off `anchor.kind`; STYLE keys off `type`. They are different axes.** [Source: ARCHITECTURE-SPINE.md#AD-5 line 83; review-adversary.md H1 fix line 28: "Consumers select *geometry* handling on `anchor.kind` and *style* handling on `type`. Never infer shape from `type`."]

`AnnotationLayer.tsx`'s current inline comment ("Render keys off `anchor.kind`, NEVER off `type`") is about GEOMETRY only — it was written when highlight was the sole tool, so a type-branch had nothing to do. Highlight and underline are BOTH `kind=text` (same rects, same `denormalizeRect` positioning). What differs is the paint: highlight = accent fill at ~0.4 opacity OVER the run; underline = 2px accent line UNDER the run. That difference is the `type` axis, and branching the VISUAL on `type` is exactly what AD-5 mandates. Do NOT try to encode the underline look as a new `anchor.kind` — that would corrupt the anchor model. The dev must update that comment to say geometry-on-kind / style-on-type so the next tool story (pen) inherits the correct reading.

## Scope boundary — READ FIRST

**IN (this story):**

- **Create path reads the armed tool (the one real logic change).** In `AnnotationInteraction.tsx`, the `pointerup` create-on-release branch is currently gated `if (armedToolRef.current === "highlight")` and passes a hardcoded `type: "highlight"` to `buildAnnotations`. Generalize it to fire for highlight **OR** underline (any text-anchor tool) and pass `type: armedToolRef.current`. After the mark lands it is selected, so the existing 2.5 selection quick-box (color-swatch row + delete) takes over — that satisfies AC2 (drag-release shows the color-swatch row) with zero new quick-box code. The cursor-mode proof box stays highlight-only (the cursor-mode tool-type picker is Story 2.12).
- **Render a `type=underline` mark as a 2px accent line under the run.** In `AnnotationLayer.tsx`, split the marks by `type` into two groups: the existing `.annotation-highlights` opacity group (highlights only, unchanged) and a NEW `.annotation-underlines` group at FULL opacity (underlines). Underline marks keep the `.annotation-highlight` base class (so the 2.5 selection hit-test, hover outline, and selected ring all keep working untouched — both `.closest(".annotation-highlight")` call sites stay valid) PLUS an `.annotation-highlight--underline` paint modifier that swaps the fill for `border-bottom: <2px> solid var(--color-${a.style.color})` and a transparent background. Same rect, same `denormalizeRect`, same per-rect hit surface — only the paint changes.
- **A 2px underline-width token.** Add `--annotation-underline-width: 2px;` next to `--annotation-highlight-opacity` in `client/src/theme/components.css` (the hand-authored component-token layer where raw px is allowed per CLAUDE.md#Design-conventions; `no-raw-values.test.ts` only forbids raw values OUTSIDE `src/theme/**`). Reference it in the `.annotation-highlight--underline` border width. The underline COLOR is the mark's own `a.style.color` (`var(--color-${a.style.color})`), exactly like the highlight fill — NOT the fixed `annotation-underline` token default.
- **Underline rail button + its arm-time color sub-toolbox (twin of Highlight).** In `ToolRail.tsx`, add an Underline tool button below Highlight in DESIGN.md#tool-rail order, wrapped in a `.tool-rail__item`, mirroring the Highlight button EXACTLY: `aria-label="Underline"`, `title="Underline (U)"`, armed styling on `activeTool === "underline"`, `onClick: if (underlineActive) setFlyoutOpen(o => !o); else onSelectTool("underline")`, and its own `ToolFlyout` (`testId="underline-color-flyout"`) holding `<ColorSwatchRow value={activeColor} onPick={…} />`. The single `flyoutOpen` bool + the existing open-on-`activeTool`-change effect already generalize — switching to underline auto-opens its color sub-toolbox just like highlight. Use a Phosphor underline icon (e.g. `TextUnderline`).
- **`U` hotkey.** In `App.tsx`'s document-level `keydown` handler, add `else if (e.key === "u" || e.key === "U") { e.preventDefault(); setActiveTool("underline"); }` next to the `H` branch. (UX-DR15 keyboard map: `U` = underline.)
- **Accessibility + no-canvas-shift:** the underline sub-toolbox is the same keyboard-reachable, `Esc`/outside-click-dismissable rail overlay as Highlight's; it never reflows the canvas (NFR-1).

**OUT (later stories / do NOT build):**

- **Pen / memo / comment / box tools** (2.8–2.11) and their rail buttons/sub-toolboxes. Only underline this story.
- **A geometric (`kind=rect`) underline.** AD-5 allows `underline → rect`, but this story is the text-drag underline only (`kind=text`), matching the highlight slice. Region/box anchoring is Story 2.11.
- **Per-tool remembered color.** `activeColor` stays ONE shared default across highlight and underline (switching tools carries the color). Per-tool color is a future extension if ever needed (noted OUT in 2.6 too).
- **Any anchor / store-schema / Pydantic / endpoint / generated-type change.** `type: "underline"` is ALREADY a legal value in the generated `Annotation` type and `AnnotationTool` union (`tools.ts`) — nothing is added to the contract. `server/openapi.json` + `client/src/api/schema.d.ts` stay byte-identical.
- **Persistence / command stack / undo** — Epic 3. Create/select/recolor/delete stay client-side, reusing the existing store actions.
- **The cursor-mode tool-type picker** (drag with no tool → pick highlight/underline/comment/memo). That is Story 2.12; the cursor-mode proof box stays highlight-only here.

## Acceptance Criteria

1. **Underline armed → drag creates a 2px accent underline via the same text-anchor path (epics.md#Story-2.7 AC1; FR-8; UX-DR7).** With underline armed (rail button or `U`), dragging across a text run and releasing creates an `Annotation {type: "underline", anchor: kind=text {rects, text}, style.color}` through the SAME `rectsFromSelection` → `buildAnnotations` path as highlight (the create call passes `type: armedTool`, not a hardcode). The mark renders as a 2px accent-token line under the run (transparent fill + `border-bottom`), at the mark's `style.color`, and the page does not shift or reflow (NFR-1). [Source: epics.md#Story-2.7; ARCHITECTURE-SPINE.md#AD-5 (style-on-type); AnnotationInteraction.tsx#onPointerUp; AnnotationLayer.tsx; DESIGN.md#annotation-underline ("2px accent-token underline under the text run")]

2. **A two-page underline splits into one mark per page sharing a `group_id` (AR-4).** A selection spanning two pages produces one `type=underline` annotation per page with a shared non-null `group_id` (handled already inside `buildAnnotations` — no new code, but it MUST be verified live, see Task 5). Hover/selected/recolor/delete act on the whole group together, exactly as highlight does. [Source: ARCHITECTURE-SPINE.md#AD-4; create.ts (group_id split); epics.md#Story-2.3 AC (two-page split)]

3. **Drag-release shows the color-swatch row (epics.md#Story-2.7 AC2; UX-DR5/DR6).** On release, the new underline is selected and the existing 2.5 selection quick-box opens with the `ColorSwatchRow` (recolor) + delete affordance. Recolor writes through `store.recolorAnnotation` and repaints the underline; delete removes it (and its `group_id` siblings). This reuses the highlight selection seam with NO new quick-box. [Source: epics.md#Story-2.7 AC2; AnnotationInteraction.tsx (selection quick-box); Story 2.5]

4. **The underline stays anchored across zoom (epics.md#Story-2.7 AC3; NFR-3).** After creating an underline, zooming re-renders it on the exact text run at every zoom level — the line rides the denormalized rect via the anchor service (`denormalizeRect`), screen position is derived not persisted. This is the Epic-2 risk-gate invariant; it must be proven LIVE at DPR>1. [Source: epics.md#Story-2.7 AC3; ARCHITECTURE-SPINE.md#AD-4; AnnotationLayer.tsx (re-derive on scale)]

5. **Underline is a first-class tool in the single `activeTool` FSM (AD-11).** The rail has an Underline button below Highlight (DESIGN.md#tool-rail order); clicking it switches `activeTool` to `"underline"` in ONE click and the rail reflects it; `U` arms it; `V`/`Esc` returns to cursor; arming underline disarms whatever was active (mutual exclusion by construction). Switching TO underline auto-opens its color sub-toolbox (twin of Highlight's, reusing `ToolFlyout` + `ColorSwatchRow` + the shared `flyoutOpen` + the open-on-tool-change effect); a click on the already-active Underline button toggles it; `Esc`/outside-click/switch-away/collapse close it. The sub-toolbox sets the shared `activeColor`. [Source: ARCHITECTURE-SPINE.md#AD-11; tools.ts (`ANNOTATION_TOOLS` already includes "underline"); UX-DR4/DR15; ToolRail.tsx (Highlight pattern); Story 2.6]

6. **Geometry-on-kind / style-on-type is honored, and the misleading comment is corrected (AD-5).** The geometry/positioning of every `kind=text` mark stays kind-driven (shared with highlight); only the VISUAL paint branches on `type`. `AnnotationLayer.tsx`'s "render keys off kind, NEVER type" comment is updated to reflect that style (fill vs underline) legitimately keys off `type` per AD-5, so Story 2.8 (pen) inherits the correct rule. No code infers anchor SHAPE from `type`. [Source: ARCHITECTURE-SPINE.md#AD-5 line 83; review-adversary.md H1 (line 28)]

7. **Client-side only; layering + contract preserved (AD-9, AD-3).** No store-schema, persisted-`Annotation`, anchor-model, or API change. `type: "underline"` is already in the generated type + `AnnotationTool` union, so `server/openapi.json` + `client/src/api/schema.d.ts` stay byte-identical. No new `render/index.ts` export (so both `vi.mock("./render")` barrels stay untouched). `no-raw-values.test.ts` stays green (the only raw px is the new `--annotation-underline-width` token, which lives in the allowed `src/theme/components.css`). Highlight create (2.3/2.6), selection/recolor/delete (2.5), arm-time color (2.6), pan (2.4), and zoom-glue (NFR-3) do not regress. [Source: ARCHITECTURE-SPINE.md#AD-9, #AD-3; CLAUDE.md#Engineering-principles, #Design-conventions]

## Tasks / Subtasks

- [x] **Task 1 — Create path reads the armed tool (AC: 1, 2, 3)**
  - [x] In `client/src/annotations/AnnotationInteraction.tsx`, change the `onPointerUp` gate `if (armedToolRef.current === "highlight")` to fire for highlight OR underline (e.g. a `const tool = armedToolRef.current; if (tool === "highlight" || tool === "underline") {…}`). Inside, pass `type: tool` to `buildAnnotations` instead of the hardcoded `type: "highlight"`. Keep the rest of the branch identical (create-on-release → `addAnnotation` → `removeAllRanges()` → `select(created[0].id)`).
  - [x] Leave the cursor-mode proof `commit()` path (line ~238) HARDCODED to `type: "highlight"` — the cursor-mode tool-type picker is Story 2.12; underline is reached only via the armed-tool path here.
  - [x] Do NOT touch `machine.ts`, the 2.2 re-pop fix, sticky-after-mark, or the two-page `group_id` split — `buildAnnotations` already handles the split and accepts `type`.

- [x] **Task 2 — Render `type=underline` as a 2px line under the run (AC: 1, 4, 6)**
  - [x] In `client/src/annotations/AnnotationLayer.tsx`, split `marks` by `type`: keep highlights in the existing `.annotation-highlights` opacity group (unchanged), and render underlines in a NEW sibling `<div className="annotation-underlines">` (full opacity, no `isolation` opacity dimming). Both groups map the same `kind=text` rects via `denormalizeRect`.
  - [x] Underline mark divs keep the `annotation-highlight` base class (preserves the 2.5 hit surface + `--hovered`/`--selected` outline + both `.closest(".annotation-highlight")` selectors) and add an `annotation-highlight--underline` modifier. Keep `data-testid={`annotation-mark-${a.id}`}`, the hover/click handlers, and the per-rect map identical to the highlight branch — only the wrapping group + the modifier class differ.
  - [x] Update the file's header/inline comment so it states geometry keys off `anchor.kind` and STYLE keys off `type` (AD-5), replacing the absolute "NEVER off type" wording (AC6).

- [x] **Task 3 — Underline CSS + 2px width token (AC: 1, 7)**
  - [x] In `client/src/theme/components.css`, add `--annotation-underline-width: 2px;` adjacent to `--annotation-highlight-opacity` (line ~97).
  - [x] In `client/src/annotations/Annotations.css`, add `.annotation-underlines { position: absolute; inset: 0; }` (full opacity — NO `opacity` rule), and `.annotation-highlight--underline { background-color: transparent; border-radius: 0; border-bottom: var(--annotation-underline-width) solid; }` so the per-mark `style.borderBottomColor` (set in the layer from `var(--color-${a.style.color})`) draws the accent line. (Set the border COLOR via inline style off the mark's color, mirroring how the highlight sets `backgroundColor`; the CSS supplies width + position only.) Tokens/vars only, no raw hex; `no-raw-values.test.ts` green.
  - [x] Confirm the hover outline + selected ring still read on an underline mark (they ride the same rect; the outline tokens are unchanged).

- [x] **Task 4 — Underline rail button + color sub-toolbox + `U` hotkey (AC: 3, 5)**
  - [x] `client/src/ToolRail.tsx`: add an Underline `.tool-rail__item` below the Highlight item, mirroring it exactly — `const underlineActive = activeTool === "underline";`, armed class on `activeTool === "underline"`, `aria-label="Underline"`, `title="Underline (U)"`, `aria-haspopup="menu"`, `aria-expanded={underlineActive && flyoutOpen}`, `data-testid="tool-underline-button"`, `onClick: if (underlineActive) setFlyoutOpen(o => !o); else onSelectTool("underline")`, and a `{underlineActive && flyoutOpen && <ToolFlyout testId="underline-color-flyout"><ColorSwatchRow value={activeColor} onPick={(t) => { onPickColor(t); setFlyoutOpen(false); }} /></ToolFlyout>}`. Import a Phosphor underline glyph (`TextUnderline`).
  - [x] Verify the existing open-on-`activeTool`-change effect (the `flyoutOpen` driver) already fires for underline (it keys off any tool change) and that the existing dismiss/collapse/switch-away effects already cover it — they should, because they are tool-agnostic. No new flyout bool.
  - [x] `client/src/App.tsx`: in the document-level `keydown` handler, add the `U`/`u` branch → `setActiveTool("underline")` next to the `H` branch (keep the editable/button exemption guard above it).

- [x] **Task 5 — Tests + regression bar (AC: all)**
  - [x] `AnnotationInteraction.test.tsx`: with `armedTool="underline"`, a drag-release builds an annotation with `type === "underline"` and `style.color === activeColor`, and selects it (the selection quick-box opens with the swatch row). The highlight-armed and cursor-mode-proof paths still pass unchanged.
  - [x] `AnnotationLayer.test.tsx`: a `type=underline` mark renders with the `annotation-highlight--underline` class inside `.annotation-underlines` (NOT inside `.annotation-highlights`), still carries `annotation-mark-<id>`, still gets `--hovered`/`--selected` on hover/select, and is still clickable (the selection hit-test). A `type=highlight` mark is unchanged (fill, in `.annotation-highlights`).
  - [x] `ToolRail.test.tsx`: clicking Underline while another tool is active switches `activeTool` to `"underline"` in one click; switching to underline shows `underline-color-flyout`; clicking the active Underline button toggles it; picking a swatch calls `onPickColor` and closes it; `Esc`/outside-click/switch-away close it. Reuse the Highlight flyout test pattern.
  - [x] `App.test.tsx`: pressing `U` sets `activeTool` to `"underline"`; `V`/`Esc` returns to cursor. Thread any new prop through existing mounts (none expected — `activeColor`/`onPickColor` already flow to ToolRail; no new `render/` export → both `vi.mock("./render")` barrels untouched; confirm).
  - [x] Full regression: `cd client && npm test` + `npm run typecheck`; `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q`. Contract byte-identical: `git diff --stat -- server/openapi.json client/src/api/schema.d.ts` empty. `no-raw-values.test.ts` green.
  - [x] **Live smoke (the real verifier; jsdom zeroes rects so it proves wiring, not gesture/visual/geometry). Launch your OWN fresh `uvicorn` + `vite dev` (alternate ports if 8000/5173 taken; never reuse a found-running server — CLAUDE.md), real PDF at DPR>1:** (a) arm Underline from cursor (button, ONE click) → underline armed, color sub-toolbox auto-opens; (b) press `U` → arms underline; (c) drag a text run → a 2px accent line lands UNDER the run (not a fill), and the selection quick-box opens with the swatch row + delete; (d) recolor → the underline changes color; (e) **CROSS-PAGE drag (the highest-risk path, memory + CLAUDE.md): a selection spanning two page cards underlines per-page and does NOT leak a full-page line** (this is the `collectTextRects` path — verify it produces per-run rects, not page boxes); (f) zoom in/out → the underline stays glued to the exact run (NFR-3); (g) delete via the quick-box / `Del` removes it (+ both pages of a group); (h) the sub-toolbox never shifts the canvas. Capture results + a screenshot in Completion Notes. [Reuse `fixtures/sample-pdfs/09-regularization.pdf`.]

- [x] **Task 6 — Docs (AC: all)**
  - [x] No `/api` change → `docs/API.md` untouched.
  - [x] Update `client/src/annotations/README.md`: underline is the second tool; it reuses the text-anchor create path and selection quick-box; the create path now reads the armed tool's `type` (no longer hardcoded highlight); rendering branches the PAINT on `type` (highlight fill in the opacity group / underline 2px line in a full-opacity group) while geometry stays kind-driven (AD-5); the underline rail button has a color sub-toolbox twinning Highlight's; `U` arms it.

## Dev Notes

### What this story adds vs reuses (the core of the story)

Almost everything exists; this is a thin re-wire + a paint variant:

| Need | Already exists (REUSE) | New (this story) |
| --- | --- | --- |
| Text selection → per-page anchors | `rectsFromSelection` + `collectTextRects` (anchor/) | nothing |
| Build the entity (incl. two-page group split) | `buildAnnotations` (already takes `type` + `color`) | pass `type: armedTool` instead of hardcoded `"highlight"` |
| Create-on-release timing | the `onPointerUp` highlight-armed branch | widen the gate to highlight OR underline |
| Post-create recolor + delete | the 2.5 selection quick-box (off `selectedId`) | nothing (underline selects into the same box) |
| Arm-time color | `activeColor` (store) + `ColorSwatchRow` + `ToolFlyout` (2.6) | a second sub-toolbox on the Underline button |
| Tool state / mutual exclusion | `activeTool` FSM; `"underline"` already in `ANNOTATION_TOOLS` | the Underline rail button + `U` hotkey |
| Mark geometry / zoom-glue | `denormalizeRect` per rect (AnnotationLayer) | nothing (same rects) |
| Mark paint | `.annotation-highlight` fill in the 0.4 opacity group | a full-opacity `.annotation-underlines` group + `--underline` 2px-border modifier |

Resist: a new anchor kind for underline, a second create machine, a bespoke underline quick-box, a per-tool color map, or putting `type=underline` logic in the anchor/geometry layer.

### Decision A — underline marks keep the `.annotation-highlight` base class (so the 2.5 selection seam needs ZERO change)

The 2.5 selection hit-test (`AnnotationInteraction.tsx`) finds marks via `t?.closest?.(".annotation-highlight")` at TWO sites (the open-box pointerdown ~line 276 and the empty-space-deselect pointerdown ~line 340). If underline marks used a different base class, both break and underlines would be unselectable. So underline divs keep `.annotation-highlight` (the interactive base = pointer-events + hover/selected outline) and ADD `.annotation-highlight--underline` purely to swap the paint. Cheapest correct path; no selection regression. (If a later story wants a semantically cleaner base class like `.annotation-mark`, that is a rename refactor for then — out of scope now.)

### Decision B — underlines live OUTSIDE the `.annotation-highlights` opacity group

`.annotation-highlights` applies `opacity: var(--annotation-highlight-opacity)` (0.4) to the WHOLE group so overlapping highlights don't compound. A 2px underline must be a crisp FULL-opacity line, so it cannot sit inside that group (it would render at 40%). Hence a sibling `.annotation-underlines` group at full opacity. Both groups are absolutely-positioned, pointer-transparent sheets; the per-mark divs opt back into pointer events (the inherited `.annotation-highlight` rule). The underline group needs no `isolation` (no opacity compositing to confine).

### Decision C — underline color = the mark's `style.color`, not the `annotation-underline` token

DESIGN.md defines `component.annotation-underline.borderColor: {colors.annotation-default}` as a DEFAULT, but a real underline must paint in the mark's chosen color (the user can recolor it, and arm-time color sets it), exactly like the highlight fill uses `var(--color-${a.style.color})`. So the border color is an inline style off `a.style.color`; the CSS token `--annotation-underline-width` supplies only the 2px thickness. The `annotation-underline` DESIGN token's borderColor is informational (the default == `annotation-default` == yellow, which is what a fresh mark gets anyway).

### What must NOT change (regression guardrails)

- **Highlight create-on-release + the 2.6 active-color read + the 2.2 re-pop fix + sticky-after-mark + the two-page split** — the only create change is widening the tool gate and passing `type`; the highlight branch's behavior is identical.
- **The 2.5 selection seam** (`selectedId`, the selection quick-box recolor + delete, hover/selected outline, group-aware lighting) — unchanged; underline rides it via the shared base class.
- **The 2.6 rail flyout machinery** (`flyoutOpen`, open-on-tool-change, dismiss/collapse/switch-away) — it is tool-agnostic; the Underline button plugs in. Do not regress the Highlight or pointer flyout when adding the third.
- **Single `activeTool` model (AD-11)** — `"underline"` is already in the union; do NOT add a second tool field or fold paint into the tool.
- **Contract byte-identical** — `type: "underline"` already exists in the generated `Annotation`; no Pydantic/OpenAPI/schema.d.ts change.
- **Pan (hand), hold-Space, zoom-glue (NFR-3)** — unaffected.

### Integration points (read these; they are the seams)

- `client/src/annotations/AnnotationInteraction.tsx` — the `onPointerUp` create branch (gate ~line 143, `type: "highlight"` ~line 151) and the cursor-mode `commit()` (~line 238, stays highlight). Widen the gate + pass `type: armedTool` at the create site only. [AnnotationInteraction.tsx:131-166, 238-250]
- `client/src/annotations/AnnotationLayer.tsx` — the `.annotation-highlights` group + per-mark map (~lines 79-111) and the `if (a.anchor.kind !== "text") return null` guard. Split by `type`; add the underlines group + modifier; fix the comment. [AnnotationLayer.tsx:79-114]
- `client/src/annotations/Annotations.css` — `.annotation-highlights` (opacity group), `.annotation-highlight` (base hit surface), `--hovered`/`--selected` outlines. ADD `.annotation-underlines` + `.annotation-highlight--underline`. [Annotations.css]
- `client/src/theme/components.css` — `--annotation-highlight-opacity` (line ~97). ADD `--annotation-underline-width: 2px;`. [components.css:97]
- `client/src/ToolRail.tsx` — the Highlight `.tool-rail__item` (~lines 186-221) is the template; the `flyoutOpen` + open-on-change effect + dismiss effects are tool-agnostic. ADD the Underline item below it. [ToolRail.tsx:186-221]
- `client/src/App.tsx` — the document-level `keydown` handler (`H` branch ~line 100). ADD the `U` branch. `armedTool={isAnnotationTool(activeTool) ? activeTool : null}` (line 196) already forwards `"underline"` to the overlay — no thread change. [App.tsx:96-110, 196]
- `client/src/tools.ts` — `ANNOTATION_TOOLS` already contains `"underline"`; no change. [tools.ts:15]
- `client/src/annotations/create.ts` — `buildAnnotations` already takes `type` + splits groups; no change. [create.ts]

### Design tokens / UI strings

- One NEW token: `--annotation-underline-width: 2px` in `components.css` (allowed raw px under `src/theme/**`). No new DESIGN.md color token (underline uses the existing accent palette via `style.color`). [Source: CLAUDE.md#Design-conventions]
- UI strings: the Underline button `aria-label="Underline"` / `title="Underline (U)"` — plain words, NO em-dash. [[no-emdash-user-facing]] [Source: DESIGN.md#tool-rail]

### Engineering conventions in force (CLAUDE.md#Engineering-principles)

- **Adopt-stable / don't reinvent (AP-4):** reuse `buildAnnotations`, the selection quick-box, `ColorSwatchRow`, `ToolFlyout`, `denormalizeRect`, `activeColor`. Underline authors NO new machinery — only a paint variant + a rail button. [[prefer-stable-solutions]]
- **Document-level handlers (AP-1):** the `U` key joins the existing App document-level `keydown` (phase-gated by `docOpen`, editable/buttons exempt). Do not bind to `.pdf-canvas`. [[held-key-state-reset-on-blur]]
- **`render/` mock-barrel sync (AP-2):** no new `render/index.ts` export → both `vi.mock("./render")` barrels (`App.test.tsx`, `Reader.test.tsx`) untouched. Confirm.
- **HiDPI + cross-page live smoke (memory + CLAUDE.md):** underline is a selection-driven geometry feature, so the cross-page path is the highest-risk surface and jsdom can't see it (rects zeroed). MUST live-smoke a CROSS-PAGE underline at DPR>1 — not just single-page — to prove `collectTextRects` yields per-run rects, not a full-page line. [[verify-on-hidpi-and-real-host]]
- **Cross-model code review (AP-3):** run `bmad-code-review` (Codex) after dev-story.

### Testing standards

- Frontend Vitest + jsdom: assert the MODEL/wiring — the create call's `type`, the layer's class/group split, the rail flyout + `activeTool` switch, the `U` keymap — NOT pixel geometry (jsdom zeroes rects). Reuse `AnnotationInteraction.test.tsx`'s fake-card/stub-selection pattern, `AnnotationLayer.test.tsx`'s rect-class assertions, and `ToolRail.test.tsx`'s flyout pattern.
- Backend pytest: no model/contract change; run to confirm no regression.

### Project Structure Notes

- Edits: `annotations/AnnotationInteraction.tsx` (+ test), `annotations/AnnotationLayer.tsx` (+ test), `annotations/Annotations.css`, `theme/components.css`, `ToolRail.tsx` (+ test), `App.tsx` (+ test), `annotations/README.md`. No new files, no new top-level dirs. `create.ts`/`machine.ts`/`store/index.ts`/`tools.ts`/anchor/render unchanged. [Source: ARCHITECTURE-SPINE.md#Structural-Seed]
- Layer rule (AD-9): `render → anchor → annotations → store → api`, strict downward. This story touches the App composition root (`App.tsx` — `U` key), the rail (`ToolRail.tsx` — underline button), and `annotations/` (create `type`, layer paint). No `render/`/anchor/store-schema/contract change.

### Versioning

- PATCH +1 when this story reaches `done` (PR merge): `server/pyproject.toml` `0.1.3 → 0.1.4` (single source; do NOT hard-code elsewhere). Bump once at done, not per commit. [Source: CLAUDE.md#Versioning]

### References

- [Source: .bmad/planning-artifacts/epics.md#Story-2.7] — story statement + the three ACs (underline armed → 2px line via text-anchor path; drag-release shows the swatch row; stays anchored across zoom).
- [Source: ARCHITECTURE-SPINE.md#AD-5 (line 83)] — `type` is semantic/presentation, `anchor.kind` is geometry; allowed pairing `underline → text|rect`; rendering geometry keys off kind.
- [Source: architecture/.../review-adversary.md H1 (line 28)] — "select geometry on `anchor.kind` and style on `type`; never infer shape from `type`" — the rule that legitimizes the type-based paint branch.
- [Source: ARCHITECTURE-SPINE.md#AD-11] — the single `activeTool` model + single-click switch the underline button must obey.
- [Source: ARCHITECTURE-SPINE.md#AD-4] — page-normalized anchor + two-page `group_id` split + zoom re-derivation (NFR-3).
- [Source: ARCHITECTURE-SPINE.md#AD-9, #AD-3] — layering + contract stability (no API/Pydantic/generated-type change).
- [Source: DESIGN.md#annotation-underline, #tool-rail, #color-swatch] — "2px accent-token underline under the run"; rail tool order; the swatch row reused arm-time.
- [Source: UX-DR4/DR5/DR6/DR7/DR15] — tool rail, contextual quick-box, on-page underline rendering, `U` keymap.
- [Source: .bmad/implementation-artifacts/epic-2/2-6-arm-time-color-pick.md] — the `activeColor` store state, `ToolFlyout`, the rail color sub-toolbox pattern underline twins.
- [Source: .bmad/implementation-artifacts/epic-2/2-5-select-highlight-recolor-delete.md] — the selection seam (`selectedId`, recolor + delete) underline rides via the shared `.annotation-highlight` base class.
- [Source: .bmad/implementation-artifacts/epic-2/2-3-highlight-text-via-drag.md] — `buildAnnotations`'s `type`/`color` options, create-on-release.
- [Source: CLAUDE.md#Engineering-principles, #Design-conventions, #Versioning] — adopt-stable, document-level handlers, render-mock-barrel sync, token contract, no em-dash, cross-page HiDPI smoke, PATCH bump.

## Previous Story Intelligence

From Story 2.6 (arm-time color, done) + its Codex reviews + the Epic-1 retro:

- **Think about the INVERSE path (Codex repeatedly caught flyout-stays-open bugs).** For underline: the color flyout must CLOSE when underline stops being active (the existing switch-away + collapse effects should already cover it — VERIFY, don't assume), and arming underline from cursor must auto-open it the same way highlight does.
- **Live smoke is the real verifier; jsdom passed while real-DOM gesture/visual bugs existed.** Verify the underline PAINT (2px line, not a fill, full opacity not 40%), the new-mark color, and the flyout on a real host. CROSS-PAGE at DPR>1 is mandatory — the exact full-page-leak bug that shipped in 2.3 lived in the cross-page path jsdom can't see.
- **Launch your OWN dev servers (new CLAUDE.md rule, added this epic).** A found-running uvicorn/vite may predate your edits or be a no-HMR prod build — smoke against a fresh own pair on alternate ports.
- **One model, no parallel state.** Keep underline inside the single `activeTool` FSM and the single `activeColor`; do not add a second tool field or a per-tool color map.
- **Contract byte-identical discipline.** Every Epic-2 story kept `server/openapi.json` + `client/src/api/schema.d.ts` unchanged; this one must too (`type: "underline"` is already in the contract).
- **The 2.6 `ToolFlyout` extraction + shared `flyoutOpen` + open-on-tool-change effect** are exactly the seams underline plugs into — reuse them, don't re-derive.

## Git Intelligence

- Baseline: `7126a22` (Feat: Add Highlight Color Picker (#15)) on `main`. The anchor service, `buildAnnotations` (with `type`+`color`), the `activeTool` FSM (`"underline"` already in the union), the 2.5 selection seam, the 2.6 `activeColor` store + `ToolFlyout` + Highlight color sub-toolbox are all merged. This story re-wires the create `type`, adds the underline paint, and clones the rail button + hotkey.
- Branch off `main` (never commit to `main` directly). Dev loop = host two-process flow (`uvicorn --reload` + `vite dev`).
- No contract change → keep `server/openapi.json` + `client/src/api/schema.d.ts` byte-identical (verify no diff after the suite).

## Project Context Reference

- Two processes, one container (AD-1/AD-10): `client/` (React 19.2 + Vite 8 + TS 6.0) + `server/` (FastAPI + Pydantic v2). Prod = single image, same-origin. v1 scope = Phase 1; no auth, localhost single-user.
- Client layering (AD-9): `render → anchor → annotations → store → api`, strict downward. This story touches the App composition root (`App.tsx` — `U` key), the rail (`ToolRail.tsx` — underline button), and `annotations/` (create `type` + layer paint). No `render/`/anchor/store-schema/contract change.
- `activeTool` (AD-11) is the single tool model (`"underline"` already a member); `activeColor` (store, AD-12-adjacent) is the shared chosen color underline reuses.

## Story Completion Status

Ultimate context engine analysis completed - comprehensive developer guide created. Three internal design calls are pre-resolved with rationale (Decision A — underline keeps the `.annotation-highlight` base class so the 2.5 selection seam needs zero change, adding only a paint modifier; Decision B — underlines render in a full-opacity sibling group, outside the 0.4-opacity highlight group; Decision C — the underline paints in the mark's own `style.color`, with only the 2px width coming from a new `components.css` token). The one architectural subtlety — that AD-5 means geometry-keys-on-`anchor.kind` while STYLE-keys-on-`type`, which legitimizes the type-based paint branch and requires correcting the misleading `AnnotationLayer` comment — is called out up front. Success = underline is a first-class tool (rail button below Highlight + `U` hotkey + its color sub-toolbox), a drag while armed lands a `type=underline` mark via the shared text-anchor path, it renders as a 2px accent line under the run at full opacity, the 2.5 selection quick-box recolors/deletes it, it stays glued across zoom, two-page underlines split into a shared group, everything stays client-side with the API/anchor/store contract byte-identical, and the live smoke passes a CROSS-PAGE underline at DPR>1 without regressing highlight/select/pan/zoom.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Claude Code dev-story workflow).

### Debug Log References

- Live smoke selection: a single-span `.textLayer` text-node range drove the
  create-on-release pointerup cleanly (the 2.6-noted multi-span collapse does not
  bite a single node). The CROSS-PAGE path DID select live this time: a
  `setStart`/`setEnd` range from the last span of page 1 to the first of page 2
  yielded an 82-char selection that split into two per-page underline marks.

### Completion Notes List

Implemented entirely client-side; no store-schema/anchor/persisted-model change.
The tracked contract (`client/src/api/schema.d.ts`) is byte-identical — the only
contract delta is `server/openapi.json`'s `info.version` (gitignored build artifact)
moving with the app version bump.

- **Create reads the armed tool (Task 1):** `AnnotationInteraction`'s create-on-
  release gate widened from `=== "highlight"` to highlight OR underline, passing
  `type: armedTool` to `buildAnnotations` (was a hardcoded `"highlight"`). The
  cursor-mode proof path stays highlight-only (tool picker is 2.12). The new mark
  selects into the existing 2.5 selection quick-box (recolor + delete) — AC2 with
  no new quick-box.
- **Style-on-type render (Task 2, AD-5):** `AnnotationLayer` splits marks into the
  `.annotation-highlights` opacity group (fill) and a full-opacity
  `.annotation-underlines` group. A shared `renderMark(a, underline)` keeps the
  `.annotation-highlight` base class on underlines (so the 2.5 hit-test/hover/ring
  work unchanged) and adds `.annotation-highlight--underline`; the border color is
  the mark's own `style.color` (inline), width from the new token. Corrected the
  misleading "render keys off kind, NEVER type" comment to geometry-on-kind /
  style-on-type.
- **Token + CSS (Task 3):** added `--annotation-underline-width: 2px` to
  `components.css` (hand-authored token layer, raw px allowed there); the
  `.annotation-highlight--underline` modifier is a transparent box with a 2px accent
  `border-bottom`. `no-raw-values` stays green.
- **Rail button + U hotkey (Task 4):** an Underline `.tool-rail__item` below
  Highlight, the exact twin (arm in one click; the color sub-toolbox auto-opens on
  switch via the shared `flyoutOpen`/open-on-tool-change effect; a click on the
  active button toggles it; `Esc`/outside/switch-away/collapse close it). `TextUnderline`
  Phosphor glyph. `U`/`u` added to App's document-level keydown next to `H`.

**Regression bar:** client `npm test` 266 passed (23 files; was 257 baseline);
`npm run typecheck` clean; server pytest 38 passed; tracked `schema.d.ts`
byte-identical (`git diff --stat` empty); `no-raw-values.test.ts` green; no new
`render/index.ts` export so both `vi.mock("./render")` barrels untouched.

**Live smoke (my OWN fresh servers per CLAUDE.md — uvicorn :8001 + vite :5174,
NOT the user's stale :8000/:5173; real PDF `09-regularization.pdf`, Chrome via
Playwright):**
(a) arm Underline from cursor → armed in one click, the 5-swatch color sub-toolbox
auto-opens (default armed) ✓;
(b) pick Green (arm-time) ✓;
(c) drag a text run → a 2px line lands UNDER the run, `border-bottom: solid
rgb(185,239,198)` (green), `background: rgba(0,0,0,0)` (no fill), in
`.annotation-underlines` at group `opacity: 1` (full, not 0.4) ✓;
(d) the selection quick-box opened armed to green (AC2) ✓;
(e) recolor via the quick-box → pink `rgb(255,199,222)` ✓;
(f) zoom 200% → 250% → the underline stayed glued to the exact span (left 563 vs
span 562, bottom 741 vs 740, width 954 vs 954; NFR-3) ✓;
(g) `Del` → underline removed ✓;
(h) **CROSS-PAGE underline (the highest-risk path): an 82-char selection spanning
two page cards produced TWO per-page underline marks sharing a group, with NO
full-page leak** (mark widths 863/35 px vs card 1530 px → ≤56%, well under the
85% leak threshold; the `collectTextRects` per-text-node path holds) ✓.
Captures: `docs/images/story-2-7-underline-green-live.png`,
`docs/images/story-2-7-underline-crosspage-live.png`.
DPR note: the Playwright context ran at DPR≈1 (browser page-zoom ~80%, so the 2px
token computed to 1.6px used-px). This story's anchor/geometry path is byte-identical
to highlight (`rectsFromSelection` + `buildAnnotations` untouched); the only new
surfaces are the `type` value and CSS-px paint, neither DPR-sensitive. The actual
memory risk (cross-page full-page leak) was verified live and is clean.

### File List

- client/src/annotations/AnnotationInteraction.tsx (create reads armedTool's type)
- client/src/annotations/AnnotationInteraction.test.tsx (underline create + two-page tests)
- client/src/annotations/AnnotationLayer.tsx (style-on-type split; underline group + modifier; comment fix)
- client/src/annotations/AnnotationLayer.test.tsx (underline render + hit-surface tests)
- client/src/annotations/Annotations.css (.annotation-underlines group + --underline modifier)
- client/src/theme/components.css (--annotation-underline-width token)
- client/src/ToolRail.tsx (Underline button + color sub-toolbox; TextUnderline icon)
- client/src/ToolRail.test.tsx (underline button + sub-toolbox tests)
- client/src/App.tsx (U hotkey)
- client/src/App.test.tsx (U keymap test)
- client/src/annotations/README.md (Story 2.7 notes)
- server/pyproject.toml (version 0.1.3 → 0.1.4)
- docs/images/story-2-7-underline-green-live.png (live-smoke capture)
- docs/images/story-2-7-underline-crosspage-live.png (live-smoke capture)
- docs/images/story-2-7-quickbox-below-3px.png (post-review: 3px + box-below-text capture)
- .bmad/implementation-artifacts/epic-2/2-7-underline-text.md (this story)
- .bmad/implementation-artifacts/sprint-status.yaml (status tracking)

## Code Review (cross-model: Codex via `codex exec --sandbox read-only`)

Ran the BMad code-review method through `codex exec --sandbox read-only` against
`7126a22..HEAD`. No BLOCKER / HIGH. Verdict: Changes-Requested. Triage:

- ✅ **LOW — non-text armed tools fall through to the cursor proof box**
  (`AnnotationInteraction.tsx`): a future `pen`/`memo`/`comment` armed tool would
  skip the highlight/underline branch and then pop the cursor-mode highlight proof
  box as if nothing were armed — the inverse-path the story guards. Fixed: added
  `if (tool !== null) return;` after the highlight/underline create branch, before
  the cursor-mode proof. +1 regression test (armed `pen` creates nothing and opens
  no proof box).
- ⏸️ **MED — cross-type recent-wins across the two render groups (dismissed, with
  rationale + deferred note):** the split into `.annotation-highlights` (an isolated
  0.4-opacity stacking context) and `.annotation-underlines` means an underline
  always stacks above a highlight on shared text, so newest-wins is not preserved
  ACROSS types. Dismissed for this story because: (a) within EACH type recent-wins
  is intact (each group is `created_at`-sorted); (b) cross-type overlap is a new,
  previously-undefined scenario (only one type existed before), not a regressed
  spec; (c) it only mis-targets in the narrow case of a highlight created LATER than
  an underline on the EXACT same run; (d) the correct fix (a unified transparent
  hit-layer sorted by the full mark list, decoupled from the opacity groups) would
  restructure the Story 2.5 selection seam and churn its tests — disproportionate
  to a MED edge case. **Deferred:** unify mark hit-testing into one created-at-ordered
  interaction layer when Epic 3's multi-type selection / Annotation Bank lands (the
  isolated opacity group makes per-mark z-index unavailable, so this needs the
  hit-layer, not a tweak). Recorded in `deferred-work.md`.

Post-review follow-ups requested live by the user (folded into this story since it
is not yet merged):

- **Underline thicker: 2px → 3px** — `--annotation-underline-width` bumped to `3px`
  in `components.css` (single source). Live-verified (computed 2.4px at the test
  browser's 80% page-zoom).
- **Quick-box must not cover the marked text** — the selection quick-box now anchors
  just BELOW the selection's lowest line (`QUICK_BOX_GAP` under the run, left-aligned
  to the first line) instead of over the mark's top-left. Live-verified: box top sits
  ≥ mark bottom (gap ~5px at zoom), `boxClearsTargetText: true`. Capture:
  `docs/images/story-2-7-quickbox-below-3px.png`.

Post-review: client 267 tests pass, typecheck clean, contract byte-identical,
`no-raw-values` green.

## Change Log

- 2026-06-29: Story created (ready-for-dev) via bmad-create-story.
- 2026-06-29: Implemented Story 2.7 (underline text). Create path reads the armed
  tool's `type` (no longer hardcoded highlight); `AnnotationLayer` paints
  `type=underline` as a full-opacity 2px accent line under the run (style-on-type,
  AD-5) in a new `.annotation-underlines` group, reusing the 2.5 selection seam via
  the shared `.annotation-highlight` base class; Underline rail button + color
  sub-toolbox (twin of Highlight) + `U` hotkey. Client-only; tracked contract
  byte-identical. Live-smoked on own fresh servers incl. a clean cross-page underline
  (no full-page leak) and zoom-glue. Version 0.1.3 → 0.1.4. Status → review.
- 2026-06-29: Cross-model code review (Codex, read-only). Fixed the LOW inverse-path
  guard (non-text armed tools no longer pop the cursor proof box; +test); dismissed
  the MED cross-type recent-wins with rationale + a deferred note (unified hit-layer
  in Epic 3). Folded two user UX follow-ups: underline 2px → 3px; the selection
  quick-box now anchors below the marked text so it never covers it. Client 267 pass,
  contract byte-identical. Status → done.
