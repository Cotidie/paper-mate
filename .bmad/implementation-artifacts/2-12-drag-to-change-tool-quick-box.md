---
baseline_commit: 9ca4317
---

# Story 2.12: Drag-to-change-tool quick-box

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a reader,
I want a tool picker on drag in cursor mode,
so that I switch tool mid-annotation without going to the left rail.

> **This is the LAST Epic-2 tool story and the one that closes FR-14.** In CURSOR mode (no annotation tool armed), a text drag-select today pops a one-button "proof" quick-box that only ever makes a Highlight (the Story 2.2 placeholder). This story replaces that single button with the real **tool-type picker**: Highlight / Underline / Comment / Memo. Pick a tool and the mark is created on the CURRENT text selection in that tool's mode, with no trip to the left rail. It is CLIENT-ONLY and adds NO contract surface: every create path it drives (`buildAnnotations` for highlight/underline/comment, `buildMemoAnnotation` for memo) already exists and ships today from the ARMED-tool paths. This story just lets cursor mode reach them through a picker.

## The decisions that define this story (read before coding)

**1. Replace the cursor-mode one-button proof box with a four-tool picker — same machine, same shell, new contents.** The pending quick-box already exists (`AnnotationInteraction.tsx` ~L968): in cursor mode a text drag-release dispatches `present` → `status:"pending"` carrying `{selection, at}`, and the box renders ONE button (`Highlight` → `commit()`). Story 2.12 swaps that single `<button>` for FOUR `role="menuitem"` buttons — Highlight / Underline / Comment / Memo — each calling a generalized `commitTool(tool)`. NOTHING about the machine (`machine.ts`), the `present`/`dismiss`/`commit` actions, the position/clamp, the focus-in/return, or the dismiss-on-pick/outside-click/`Esc`/scroll plumbing changes — they already drive the pending box and are reused verbatim. This is a CONTENTS swap inside the existing `pending &&` render branch, not a new overlay state.

**2. `commit()` generalizes to `commitTool(tool)` and SHARES the armed-tool create path.** Today two code paths build a text-anchor mark from a selection: the armed-tool `onPointerUp` branch (~L281–300, `buildAnnotations(pages, {type: tool, color, body})` for highlight/underline/comment) and the cursor `commit()` (~L672, hardcoded `type:"highlight"`). They are the SAME operation differing only by `type`. Factor ONE helper — `createTextTool(pages, tool)` — that builds via `buildAnnotations` (passing `body:""` only for comment, exactly as the armed path does), `addAnnotation`s each, clears the live selection, and `select`s the first. The armed `onPointerUp` branch AND `commitTool` both call it (adopt-stable / don't duplicate, [[prefer-stable-solutions]]). `commitTool` additionally `dispatch({type:"commit"})` to rest the machine (close the picker) before/after creating, mirroring the current `commit()`.

**3. Memo from the picker is the ONE genuine design call: drop a default-size memo at the selection START, then select it.** Memo is the odd tool out — it is `kind=rect` placed by a CLICK (`buildMemoAnnotation` + `activeMemoSize`), not a text-anchor mark. But FR-14 / UX-DR5 explicitly list memo in the selection picker, so it must be offered. The decision: picking **Memo** places a default-size memo box whose top-left is the selection's first rect top-left (on that rect's page), via the EXISTING `buildMemoAnnotation({page_index, rect})` with `rect` = `normalizeRect` of `{activeMemoSize at the selection-start card-local point}` — the identical construction the armed-memo click gesture uses (~L451–467), just anchored at the selection instead of a raw click. Then `select(created.id)` so the layer autofocuses its textarea (the 2.9 flow). The live text selection clears. Rationale: a memo is "a note about THIS spot," so anchoring it where the user dragged is the natural read; reusing `buildMemoAnnotation`/`activeMemoSize` keeps ONE memo construction. (If the selection has no usable rect, Memo is a no-op — but a `pending` box only ever exists with a non-empty selection, so this is defensive.)

**4. After a pick, each tool lands in its OWN existing post-create affordance — no new UI.** Picking Highlight/Underline → create + `select` → the Story 2.5 selection quick-box (recolor + delete) opens, IDENTICAL to arming that tool and dragging. Picking Comment → create (`body:""`) + `select` → the Story 2.10 comment bubble opens (the layer renders the bubble for a selected `type:"comment"`; the shared selection box is already gated to EXCLUDE comments, ~L842). Picking Memo → create + `select` → the Story 2.9 memo textarea autofocuses. So the picker only chooses WHICH create runs; every downstream affordance already exists. The empty-memo cleanup (~L593–600) already deletes a never-typed memo on deselect, so a picked-then-abandoned memo self-cleans for free.

**5. The picker is cursor-mode ONLY and never competes with an armed tool or selection.** It renders solely inside `pending &&`, and `pending` is only entered when `tool === null` (cursor mode — the armed branch returns before `present`, ~L305). With ANY annotation tool armed, the mark lands directly (no picker). With a tool armed AND a mark selected, the 2.5 selection box owns the popup. AD-11 (single `activeTool`) is untouched: the picker does NOT change `activeTool` — it is a one-shot create, the tool stays cursor (mid-annotation convenience, not a sticky arm). [Genuine call, matches FR-14 "switch tool WITHOUT going to the rail" = a per-drag pick, not a mode change.]

**6. No contract / no new `render/` export / tokens-only.** Every type the picker creates (`highlight`/`underline`/`comment`/`memo`) and every builder (`buildAnnotations`, `buildMemoAnnotation`) already exists and ships. `server/openapi.json` (tracked fields) + `client/src/api/schema.d.ts` stay byte-identical. No `render/index.ts` export added → both `vi.mock("./render")` barrels (`App.test.tsx`, `Reader.test.tsx`) untouched. Any picker dims/icons come from token-backed classes (`.quick-box__action`) — `no-raw-values` green.

## Scope boundary — READ FIRST

**IN (this story):**

- **The cursor-mode tool-type picker.** In `AnnotationInteraction.tsx`, the `pending &&` render branch (the cursor-mode proof box) renders FOUR `role="menuitem"` buttons — Highlight / Underline / Comment / Memo (Phosphor `Highlighter` / `TextUnderline` / `ChatCircle` / `TextT`, matching the rail glyphs) — instead of the single `Highlight` button. Each calls `commitTool(tool)`. `role="menu"`, `aria-label="Annotation tools"`, keyboard-reachable, focus moves to the first button on open (the existing focus-in already focuses the first `button`).
- **`createTextTool(pages, tool)` shared helper + `commitTool(tool)`.** Factor the text-anchor create (`buildAnnotations` + `addAnnotation` + clear selection + `select` first) out of the armed `onPointerUp` branch into ONE helper; the armed branch and `commitTool` both call it for highlight/underline/comment. `commitTool` handles memo via `buildMemoAnnotation` at the selection start (Decision 3) and dispatches `commit` to close the picker.
- **Wire the four picks to their existing affordances** (Decision 4): highlight/underline → 2.5 selection box; comment → 2.10 bubble; memo → 2.9 textarea. No new post-create UI.
- **Tests:** the picker renders four tools in cursor mode; each pick creates the right `type` on the selection and selects it; comment carries `body:""`; memo lands a `kind=rect` memo at the selection start; the picker dismisses on pick / outside-click / `Esc` / scroll (regression of the existing pending plumbing); armed-tool paths + 2.5/2.9/2.10 affordances do not regress.
- **Docs + version:** `annotations/README.md` cursor-picker note; no `/api` change (`docs/API.md` untouched); `server/pyproject.toml` `0.1.9 → 0.1.10`.

**OUT (later stories / do NOT build):**

- **Pen in the picker.** Pen needs a freehand DRAG, not a text selection; FR-14 / UX-DR5 list exactly highlight/underline/comment/memo. Do NOT add a pen entry.
- **Box-select / region tools in the picker.** Box-highlight is a MODE of the Highlight tool off a rectangle drag (Story 2.11), not a text-selection pick.
- **Changing `activeTool` on a pick / making the pick sticky.** The picker is a one-shot create; the tool stays cursor (Decision 5).
- **A new overlay state / a second machine.** Reuse the existing `pending` state + shell (Decision 1).
- **Any anchor-MODEL / Pydantic / endpoint / generated-type change.** All four types + both builders already exist and ship. `server/openapi.json` + `client/src/api/schema.d.ts` stay byte-identical.
- **Move / resize / re-edit existing marks, undo/redo, persistence.** Epic 3.

## Acceptance Criteria

1. **Cursor mode + drag-select + release → the quick-box pops a tool-type picker (highlight / underline / comment / memo) (epics.md#Story-2.12 AC1; FR-14, UX-DR5).** With NO annotation tool armed (cursor/selection mode), dragging across a text run and releasing pops the `{component.quick-box}` containing four `role="menuitem"` actions — Highlight, Underline, Comment, Memo — in place of the old single Highlight button. The box is positioned at the release point, clamped on-screen, and focus moves to the first action. [Source: epics.md#Story-2.12; PRD#FR-14; EXPERIENCE/UX-DR5 (selection→tool-type picker highlight/underline/comment/memo); AnnotationInteraction.tsx (pending render branch); machine.ts (`present`→`pending`)]

2. **Choosing a tool creates the annotation in that tool's mode on the current selection, no trip to the rail (epics.md#Story-2.12 AC2; FR-14).** Picking Highlight/Underline/Comment builds a text-anchor mark on the selection via `buildAnnotations` (`type` = the picked tool; comment carries `body:""`), `addAnnotation`s each (two-page selections share a `group_id`), and selects the first → its existing affordance (highlight/underline → the 2.5 selection quick-box; comment → the 2.10 bubble). Picking Memo drops a default-size `kind=rect` memo (`buildMemoAnnotation` + `activeMemoSize`) at the selection start and selects it → the 2.9 textarea autofocuses. `activeTool` is unchanged (stays cursor). [Source: epics.md#Story-2.12; PRD#FR-14; ARCHITECTURE-SPINE.md#AD-5 (type-per-tool, `body` non-null for comment/memo); create.ts (buildAnnotations/buildMemoAnnotation); Story 2.5/2.9/2.10 affordances]

3. **The picker dismisses on pick, outside-click, or `Esc`, and never shifts the canvas (epics.md#Story-2.12 AC3; UX-DR5, NFR-1).** A pick closes the picker (machine rests); an outside pointer-down, `Esc`, or a canvas scroll dismisses it; the live text selection is cleared so it cannot re-pop. The quick-box is a `position:fixed` overlay — opening, picking, or dismissing NEVER displaces or reflows the page. [Source: epics.md#Story-2.12; UX-DR5 (dismiss on pick/outside-click/Esc, never shifts canvas); ARCHITECTURE-SPINE.md#NFR-1; AnnotationInteraction.tsx (dismiss/scroll/outside-click effects, reused)]

4. **The picker is cursor-mode only and does not regress the armed-tool paths (AD-11).** The picker renders solely while `pending` (entered only when no annotation tool is armed). With a tool armed, the mark still lands directly with no picker; with a tool armed and a mark selected, the 2.5 selection box still owns the popup. The picker does not change `activeTool`. [Source: ARCHITECTURE-SPINE.md#AD-11; AnnotationInteraction.tsx (armed `onPointerUp` returns before `present`)]

5. **Client-only + contract preserved; shared create path, no duplication (AD-3, AD-9; CLAUDE.md#Engineering-principles).** The text-anchor create is factored into ONE `createTextTool` helper the armed branch AND `commitTool` both call (no duplicated build/select). No store-SCHEMA / persisted-model / anchor-model / API change — `highlight`/`underline`/`comment`/`memo` + `buildAnnotations`/`buildMemoAnnotation` already exist, so `server/openapi.json` (tracked) + `client/src/api/schema.d.ts` stay byte-identical. No new `render/index.ts` export (both `vi.mock("./render")` barrels untouched). `no-raw-values` green (picker icons/dims from token-backed classes). Highlight/underline/pen/memo/comment create+select+restyle+delete, box-highlight, pan, zoom-glue do not regress. [Source: ARCHITECTURE-SPINE.md#AD-3, #AD-9; CLAUDE.md#Engineering-principles, #Design-conventions]

## Tasks / Subtasks

- [ ] **Task 1 — Factor the shared text-anchor create helper (AC: 2, 5)**
  - [ ] `client/src/annotations/AnnotationInteraction.tsx`: extract `createTextTool(pages: PageSelection[], tool: "highlight" | "underline" | "comment")` — `buildAnnotations(pages, docId, {now, newId, type: tool, color: activeColorRef.current, ...(tool === "comment" ? { body: "" } : {})})`, `created.forEach(addAnnotation)`, clear the live selection (`window.getSelection()?.removeAllRanges()`), `select(created[0].id)`. Use `useCallback` with the same deps shape as the existing `commit`.
  - [ ] Refactor the armed `onPointerUp` highlight/underline/comment branch (~L281–300) to call `createTextTool(pages, tool)` — same behavior, one code path. Confirm armed highlight/underline/comment still land + select exactly as before.

- [ ] **Task 2 — `commitTool` + the four-button picker (AC: 1, 2, 3)**
  - [ ] Replace `commit` with `commitTool(tool: "highlight" | "underline" | "comment" | "memo")`: for the three text tools call `createTextTool(pending.selection, tool)`; for `memo` build a memo at the selection start (Decision 3) via `buildMemoAnnotation` + `activeMemoSizeRef.current` + `normalizeRect`, `addAnnotation`, clear selection, `select`. In all cases `dispatch({ type: "commit" })` to close the picker. Guard `if (!pending) return`.
  - [ ] In the `pending &&` render branch, swap the single `Highlight` button for FOUR `role="menuitem"` buttons (Highlight / Underline / Comment / Memo) with Phosphor `Highlighter` / `TextUnderline` / `ChatCircle` / `TextT` icons + text labels, each `onClick={() => commitTool("…")}`, `className="quick-box__action"`, distinct `data-testid` (`quick-box-highlight`/`-underline`/`-comment`/`-memo`). Keep `role="menu"`; update `aria-label` to `"Annotation tools"`. The existing focus-in (`querySelector("button")`) focuses the first action.

- [ ] **Task 3 — Memo-at-selection placement (AC: 2)**
  - [ ] In `commitTool("memo")`: take `pending.selection[0]` (first page) and its first rect; resolve that page's card via `getPagesRef.current()`; the rect's top-left in card-local px at the current scale → `normalizeRect({x0,y0,x1:x0+size.width*scale, y1:y0+size.height*scale}, page.box, scale)` (mirror the armed-memo gesture ~L451–467, `size = activeMemoSizeRef.current`). `buildMemoAnnotation({page_index, rect}, docId, {now, newId, color})`, `addAnnotation`, clear selection, `select`. No-op if the selection has no resolvable rect/page (defensive only).

- [ ] **Task 4 — Tests (AC: all)**
  - [ ] `AnnotationInteraction.test.tsx`: in cursor mode (no `armedTool`), a text drag-release renders a `selection-quick-box`-style picker with all four `quick-box-{highlight,underline,comment,memo}` actions (NOT the single old button); picking Highlight/Underline creates that `type` (text anchor) on the selection + selects it + opens the 2.5 box; picking Comment creates `type:"comment"` with `body:""` + opens the bubble (NOT the 2.5 box); picking Memo creates a `kind=rect` `type:"memo"` at the selection start + selects it; pick / outside-click / `Esc` / scroll dismiss the picker and clear the selection; an armed tool STILL lands directly with no picker (regression); two-page selection picks share a `group_id` (via `buildAnnotations`). Use the existing fake-card + synthetic-selection patterns.
  - [ ] `machine.test.ts`: unchanged behavior — confirm `present`→`pending` still carries `{selection, at}` and `commit`/`dismiss` rest correctly (no machine change, but assert the contract the picker relies on).
  - [ ] Full regression: client suite + `typecheck` clean; server `pytest` clean. Contract byte-identical (`git diff --stat client/src/api/schema.d.ts server/openapi.json` empty). `no-raw-values` green. Both `vi.mock("./render")` barrels untouched.
  - [ ] **Live smoke** (own fresh `uvicorn` + `vite dev` on alternate ports, real PDF, DPR=2): (a) in cursor mode drag a text run → the four-tool picker pops at the release point, page NOT displaced; (b) pick Highlight → mark lands + 2.5 box (recolor/Del); (c) pick Underline → 2px underline; (d) pick Comment → pin + bubble, type a note; (e) pick Memo → memo box at the selection with focused textarea, type text; (f) drag + `Esc` / outside-click / scroll → picker dismisses, no mark; (g) arm Highlight + drag → mark lands directly, NO picker (regression); (h) zoom 200→250% → all picked marks stay glued. Save a screenshot to `.bmad/implementation-artifacts/2-12-picker-smoke.png`.

- [ ] **Task 5 — Docs + version (AC: all)**
  - [ ] No `/api` change → `docs/API.md` untouched.
  - [ ] `client/src/annotations/README.md`: add the Story 2.12 cursor-mode tool-type picker note (replaces the 2.2 proof-box placeholder).
  - [ ] `server/pyproject.toml` version `0.1.9 → 0.1.10` (single source). Bump once at done.

## Dev Notes

### What this adds vs reuses

| Need | Reuse | New |
| --- | --- | --- |
| Overlay state for the picker | the existing `pending` state + `present`/`commit`/`dismiss` machine (machine.ts) | nothing — same state, new contents |
| Quick-box shell / position / clamp / focus-in-return | the `{component.quick-box}` shell + `clampToViewport` + focus-restore (Story 2.2) | nothing |
| Dismiss on pick / outside-click / `Esc` / scroll | the existing pending-dismiss effects | nothing |
| Build highlight/underline/comment from a selection | `buildAnnotations` (the armed `onPointerUp` path) | `createTextTool` helper (factor + share, not new logic) |
| Build a memo | `buildMemoAnnotation` + `activeMemoSize` (the armed-memo gesture) | anchor it at the SELECTION start instead of a click point |
| Post-create affordances | 2.5 selection box (highlight/underline), 2.10 bubble (comment), 2.9 textarea (memo) | nothing |
| Picker glyphs | Phosphor `Highlighter`/`TextUnderline`/`ChatCircle`/`TextT` (same as the rail) | the four picker buttons |

Resist: a new overlay state / second machine (reuse `pending`); changing `activeTool` on a pick (one-shot create, not a mode change); a pen entry (pen needs a drag, not a selection); duplicating the build/select logic instead of factoring `createTextTool`; a contract field for the picker (all four types already exist).

### Decision notes

- **Memo at the selection start (Decision 3) is the one genuine call.** Highlight/underline/comment are text-anchor marks, so they map 1:1 onto the selection. Memo is `kind=rect`, so "memo on the current selection" needs an anchor choice. Anchoring the default-size box at the selection's first-rect top-left (reusing `buildMemoAnnotation`/`activeMemoSize`) is the natural "note about this spot" read and keeps ONE memo construction. The empty-memo cleanup means a picked-then-ignored memo self-deletes, so there is no stray-box risk.
- **One create path (Decision 2).** The armed-tool branch and the cursor picker build the SAME text-anchor mark; factor `createTextTool` so a future tool/`type` change touches one place. This is the Epic-1 retro "don't reinvent wheels" applied within the file. [[prefer-stable-solutions]]
- **No machine change.** `present` already carries `{selection, at}` and `commit`/`dismiss` already rest the machine. The picker is purely a contents swap inside the `pending &&` branch — keep machine.ts untouched (lower blast radius, AP-2 mock barrels unaffected).

### Integration points (the seams)

- `client/src/annotations/AnnotationInteraction.tsx` — factor `createTextTool`; replace `commit` with `commitTool`; swap the single proof button for the four-tool picker; reuse the pending machine/shell/dismiss/focus plumbing unchanged.
- `client/src/annotations/create.ts` — NO change (`buildAnnotations`, `buildMemoAnnotation` already exist).
- `client/src/annotations/machine.ts` — NO change (reuse `pending` + `present`/`commit`/`dismiss`).
- `client/src/store/index.ts` — NO change (reuse `addAnnotation`/`select`/`activeColor`/`activeMemoSize`).
- `client/src/tools.ts` — NO change (`AnnotationTool` union already covers all four).

### Engineering conventions in force (CLAUDE.md#Engineering-principles)

- **Adopt-stable / one model:** reuse the `pending` machine, the quick-box shell, `buildAnnotations`/`buildMemoAnnotation`, the 2.5/2.9/2.10 affordances; new = `createTextTool` (a factor-out) + the four picker buttons + `commitTool`. [[prefer-stable-solutions]]
- **Document-level handlers (AP-1):** no new global handler needed — the picker rides the existing pending pointerup/dismiss effects. The picker buttons are exempt from the global handlers (they are `BUTTON`s, `isExempt`).
- **`render/` mock-barrel sync (AP-2):** no new `render/index.ts` export → both `App.test.tsx` + `Reader.test.tsx` `vi.mock("./render")` barrels untouched. Confirm.
- **HiDPI live smoke:** the picked marks are placed geometry — live-smoke each pick + dismiss + zoom-glue at DPR>1; jsdom zeroes rects, so assert the MODEL (the create call + selected id) in unit tests and prove geometry LIVE. [[verify-on-hidpi-and-real-host]]
- **Cross-model code review (AP-3):** run `bmad-code-review` (Codex) after dev-story.

### Testing standards

- Frontend Vitest + jsdom: assert the MODEL/wiring — the picker renders four actions in cursor mode, each pick's create call (`type` + anchor kind + `body` for comment, memo rect for memo) + the selected id + the right affordance gate, the dismiss paths, and that an armed tool skips the picker — NOT pixel geometry (jsdom zeroes rects). Reuse the fake-card + synthetic drag-selection patterns from the existing `AnnotationInteraction.test.tsx`.
- Backend pytest: no model/contract change; run to confirm no regression.

### Project Structure Notes

- New files: none. Extends `AnnotationInteraction.tsx` (+test) only; `create.ts`/`machine.ts`/`store/`/`tools.ts`/`render/`/`anchor/`/api-schema unchanged. [Source: ARCHITECTURE-SPINE.md#Structural-Seed]
- Layer rule (AD-9): touches `annotations/` only (the overlay's interaction layer). No `render/`/anchor/store-SCHEMA/contract change. The App composition root is NOT touched (the picker fires off the existing cursor-mode pending path; no new key/prop).

### Versioning

- PATCH +1 at done: `server/pyproject.toml` `0.1.9 → 0.1.10` (single source). Bump once at done. This is the final tool story of Epic 2 (2.13 pen-alpha is a style refinement); the epic→MINOR bump happens at the Epic-2 retrospective, not here.

### References

- [Source: .bmad/planning-artifacts/epics.md#Story-2.12] — story + the three ACs (cursor-mode drag → tool-type picker highlight/underline/comment/memo; pick creates in that mode on the selection with no rail trip; dismiss on pick/outside-click/`Esc`, never shifts canvas).
- [Source: .bmad/planning-artifacts/prds/prd-paper-mate-2026-06-28/prd.md#FR-14] — drag-to-change-tool: on drag-select a quick tool picker pops (highlight/underline/comment/memo) so the user switches tool without returning to the left rail.
- [Source: .bmad/planning-artifacts/architecture/architecture-paper-mate-2026-06-28/ARCHITECTURE-SPINE.md#AD-5] — `type` selects the tool (highlight/underline/comment/memo); `anchor.kind` selects geometry; `body` non-null for comment/memo.
- [Source: ARCHITECTURE-SPINE.md#AD-11] — single `activeTool`; the transient overlay machine (`armed/annotating/pending/empty`) is driven by it; the picker is a one-shot create that does NOT change `activeTool`.
- [Source: ARCHITECTURE-SPINE.md#AD-3, #AD-9] — contract stability (no API/Pydantic/generated-type change; all four types + builders already exist); layering (annotations/ only).
- [Source: ARCHITECTURE-SPINE.md#NFR-1] — overlay never reflows the canvas.
- [Source: EXPERIENCE.md / UX-DR5] — contextual quick-box: selection→tool-type picker (highlight/underline/comment/memo); dismiss on pick/outside-click/`Esc`; positioned at selection; never shifts canvas.
- [Source: DESIGN.md#quick-box] — the quick-box shell + `.quick-box__action` (the picker buttons reuse it, tokens only).
- [Source: .bmad/implementation-artifacts/2-11-box-select-a-region.md] — flagged THIS story as the TEXT-drag tool-type picker (the region picker was its smaller cousin); the create-then-select spine.
- [Source: .bmad/implementation-artifacts/2-9-textbox-memo.md] — `buildMemoAnnotation` + `activeMemoSize` placement; the memo textarea autofocus + empty-memo cleanup the Memo pick reuses.
- [Source: .bmad/implementation-artifacts/2-10-comment-highlight-pin-bubble.md] — the comment bubble (selected `type:"comment"`) the Comment pick lands in; the shared selection box already excludes comments.
- [Source: CLAUDE.md#Engineering-principles, #Design-conventions, #Versioning].

## Previous Story Intelligence

From Story 2.11 (box-select, done) + 2.10/2.9/2.5 + the Epic-2 pattern:

- **2.11 explicitly named THIS story as the text-drag tool-type picker.** 2.11's region picker (highlight/comment off a box drag) was scoped as "a smaller cousin"; the full selection picker (highlight/underline/comment/memo off a TEXT drag) was deferred here. Note: 2.11 was later REVISED to drop its region picker entirely (box-highlight became a Highlight mode, no picker), so there is NO shared picker primitive to extend — build the four-button picker directly in the existing pending shell.
- **The create-then-select spine holds.** Every tool creates on release/pick and routes into a contextual affordance (2.5 box / 2.10 bubble / 2.9 textarea). The picker just chooses WHICH create runs — do not invent a new post-create flow.
- **Don't duplicate the build path.** The armed `onPointerUp` branch already does exactly `buildAnnotations(pages, {type, color, body})` + select. Factor it into `createTextTool` and call it from both the armed branch and the picker — Codex review consistently flags duplicated mutate/build logic.
- **The pending dismiss/focus/scroll plumbing is already correct** (it has the 2.2 re-pop fix: clear the selection on dismiss). Reuse it verbatim; do not re-implement dismissal for the picker.
- **Live smoke is the real verifier; jsdom zeroes geometry.** Prove each pick + dismiss + zoom-glue on a real host at DPR>1. Memo-at-selection placement especially needs a live check (the rect lands where the drag started).
- **Launch your OWN dev servers; contract byte-identical discipline; cross-model review after.**

## Git Intelligence

- Baseline: `9ca4317` (Chore: Mark Story 2.11 done; PR #20 merged) on `main`. The quick-box shell + pending machine (2.2), `buildAnnotations` (2.3), the 2.5 selection seam, `activeColor` (2.6), underline (2.7), pen (2.8), `buildMemoAnnotation` + `activeMemoSize` (2.9), the comment bubble (2.10), and the box-highlight mode (2.11) are all merged. This story replaces the cursor-mode one-button proof with the four-tool picker — pure reuse of paths that already ship from the armed tools.
- Branch off `main` (never commit to `main`). Dev loop = host two-process flow (`uvicorn --reload` + `vite dev`).
- No contract change → keep `client/src/api/schema.d.ts` + `server/openapi.json` byte-identical (verify after the suite).

## Project Context Reference

- Two processes, one container (AD-1/AD-10): `client/` (React 19.2 + Vite 8 + TS 6.0) + `server/` (FastAPI + Pydantic v2). v1 scope = Phase 1; no auth, localhost single-user.
- Client layering (AD-9): `render → anchor → annotations → store → api`, strict downward. This story touches `annotations/` ONLY (the overlay interaction layer); no `render/`/anchor/store-SCHEMA/contract/App-root change.
- `Annotation.type` (AD-5) selects the tool the picker creates; `anchor.kind` selects geometry (text for highlight/underline/comment, rect for memo). `activeColor`/`activeMemoSize` (store) feed the create. The single `activeTool` FSM (AD-11) is unchanged — the picker is a one-shot create in cursor mode.

## Story Completion Status

Ultimate context engine analysis completed - comprehensive developer guide created. Story 2.12 closes FR-14 (drag-to-change-tool) and is the last Epic-2 tool story. In CURSOR mode, a text drag-release today pops a one-button "Highlight" proof (the Story 2.2 placeholder); this story replaces that with the real four-tool picker (Highlight / Underline / Comment / Memo) inside the SAME `pending` quick-box state + shell. Six design calls are pre-resolved: (1) contents swap inside the existing `pending &&` branch, no new overlay state; (2) factor `createTextTool` and share it between the armed `onPointerUp` branch and the picker (no duplication); (3) the one genuine call — Memo drops a default-size `kind=rect` box at the selection start via the existing `buildMemoAnnotation`/`activeMemoSize`; (4) each pick lands in its EXISTING affordance (2.5 box / 2.10 bubble / 2.9 textarea), no new UI; (5) the picker is cursor-mode only and does NOT change `activeTool` (one-shot, not sticky); (6) no contract / no new `render/` export / tokens-only. Every type + builder the picker drives already ships from the armed tools, so this is client-only with the tracked contract byte-identical. Success = a cursor-mode text drag pops the four-tool picker, each pick creates the right mark on the selection and routes into its existing affordance without a rail trip, the picker dismisses on pick/outside-click/`Esc`/scroll without shifting the canvas, armed tools still land directly, and the live smoke passes all four picks + dismiss + zoom-glue at DPR>1 without regressing the other tools / box-highlight / pan / zoom.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

## Change Log

- 2026-06-30: Story created (ready-for-dev) via bmad-create-story.
