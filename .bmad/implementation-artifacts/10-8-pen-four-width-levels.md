---
baseline_commit: c3e15cb4d2b306680bf88ce45f49d4249142dc5b
---

# Story 10.8: Pen width, four levels including a thinner one

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a reader,
I want a fourth, thinner pen width,
so that I can draw finer marks than the current thinnest stroke.

## Acceptance Criteria

1. **(Four levels, thinnest is new, item 12, FR-9)** Given the pen stroke-width picker, when it renders (opened), then it offers FOUR width steps ordered thin to thick, and the thinnest is STRICTLY thinner than today's current thinnest (`4` scale-1.0 px). Resolved values: `2 / 4 / 8 / 16` scale-1.0 px (a new `2` prepended to the existing `4 / 8 / 16`, keeping the clean geometric doubling).

2. **(Token, not raw px, item 12, DESIGN token contract)** Given the new thinnest width, then its px value is a NEW `--pen-stroke-*` component-dims token living beside the existing three in `client/src/theme/components.css` (the hand-authored token layer, the ONLY place outside `DESIGN.md`'s generated `tokens.css` where raw px is allowed — see the "Token location correction" note; the epic's "in DESIGN.md → tokens.css" wording is factually wrong for these tokens). The picker keeps reading the token set through per-key CSS classes; NO raw px enters `StrokeWidthRow.tsx`, so `no-raw-values.test.ts` stays green.

3. **(Crisp at DPR>1, persists/restores, FR-9, AR-6)** Given a stroke drawn at the new thinnest width, then it renders crisply at DPR>1 (a filled `perfect-freehand` path, not sub-pixel-invisible) and persists to `~/.paper-mate` and restores on reopen at that exact `style.stroke_width`, exactly like any other pen stroke. No annotation-model/contract change: `stroke_width` is already a free `number`.

4. **(Four cells fit both surfaces, item 12, NFR-1)** Given the four steps, then they fit BOTH the picker's layouts without breaking the flyout: the rail-flyout menu (opens as a horizontal row to the RIGHT) AND the pen selection quick-box menu (opens as a vertical column DOWN). This is the exact four-cell shape the `AlphaRow` (low/mid/high/full) already ships in the same `.pen-picker__menu`, so the layout is proven; verify live regardless.

5. **(No behavior change to the existing three or the default)** Given this is an AC-extension, then the three existing widths (`4 / 8 / 16`), their tokens, their labels, and the store default (`activeStrokeWidth: 8`, the medium step) are UNCHANGED. Adding the fourth step must not shift which step the collapsed trigger previews when the current value matches none of the steps (the `STEPS[1]` fallback trap, see Dev Notes).

## Tasks / Subtasks

- [x] **Task 1 — New `--pen-stroke-fine` token (AC: #1, #2).** In `client/src/theme/components.css` (the `annotation-pen` block, L143-149), add `--pen-stroke-fine: 2px;` as the FIRST of the four (above `--pen-stroke-thin: 4px;`) so the tokens read thin-to-thick. Update the block comment (L143-146) from "three freehand stroke widths" to "four". Raw px is allowed here (`src/theme/**` is exempt in `no-raw-values.test.ts` L13); this is where the existing `--pen-stroke-thin/medium/thick` already live (NOT `tokens.css`, which is generated from `DESIGN.md` token SCALES and never emits `--pen-stroke-*`).

- [x] **Task 2 — Fourth `STEP` in `StrokeWidthRow` (AC: #1, #5).** In `client/src/annotations/StrokeWidthRow.tsx`:
  - Extend the `Step.key` union (L22) to `"fine" | "thin" | "medium" | "thick"`.
  - Prepend `{ width: 2, key: "fine", label: "Fine" }` to `STEPS` (L27-31), so the array is `[fine(2), thin(4), medium(8), thick(16)]` (thin-to-thick, matching the token order).
  - **Fix the collapsed-trigger fallback (AC #5, subtle regression):** L43 is `const current = STEPS.find((s) => s.width === value) ?? STEPS[1];`. `STEPS[1]` is the "value matches no step" fallback preview. After prepending `fine`, index 1 shifts from `medium(8)` to `thin(4)`, which would silently change the collapsed icon shown when an out-of-set width is passed. Preserve the medium fallback: change to `?? STEPS[2]` (medium is now index 2) — or, less brittle, `?? (STEPS.find((s) => s.key === "medium") ?? STEPS[0])`. Prefer the key-lookup form so a future value reorder can't re-break it.
  - No other change: both consumers already read `STEPS` (the `data-testid={`stroke-width-${s.width}`}` gives the new cell `stroke-width-2`), and `onPick(2)` flows through unchanged.

- [x] **Task 3 — Preview CSS for the `fine` key (AC: #2, #4).** In `client/src/annotations/Annotations.css`, add the two `fine` rules mirroring the existing thin/medium/thick pairs:
  - `.pen-thickness-icon--fine { height: var(--pen-stroke-fine); }` (after L361, the `--thin` bar rule) — the collapsed trigger's ink-bar height when Fine is current.
  - `.stroke-width-step__dot--fine { width: var(--pen-stroke-fine); height: var(--pen-stroke-fine); }` (after L441, the `--thin` dot rule) — the menu dot diameter. Tokens only, no raw px (this file is NOT theme-exempt).

- [x] **Task 4 — Update the two step-count assertions (AC: #1).** Two tests hard-code "three steps" and MUST move to four; mirror `client/src/annotations/AlphaRow.test.tsx` (the four-level precedent, `toHaveLength(4)`):
  - `client/src/annotations/StrokeWidthRow.test.tsx` L15-22: rename to "reveals the four width steps (2/4/8/16)", `toHaveLength(3)` → `toHaveLength(4)`, add `expect(screen.getByTestId("stroke-width-2")).toBeTruthy();`. Add one case: `value={2}` arms `stroke-width-2` (`stroke-width-step--armed`, `aria-checked="true"`); picking it calls `onPick(2)` and collapses (mirror the existing arms/pick cases).
  - `client/src/components/ToolRail/ToolRail.test.tsx` L483: `flyout.querySelectorAll(".stroke-width-step")` `.toHaveLength(3)` → `.toHaveLength(4)`. (L480's collapsed `toHaveLength(0)`, L484's `stroke-width-8` armed default, and the L491-499 pick case stay as-is.)
  - No change to `client/src/store/index.test.ts`: the store default (`activeStrokeWidth: 8`) and the `beforeEach` reset value (`4`) are both still valid widths; the store is not touched this story.
  - Run `cd client && npm test` (full suite) + `npm run typecheck`. No `render/index.ts` export changes → the `vi.mock("./render")` barrels in `App.test.tsx`/`Reader.test.tsx` need NO edit (confirm).

- [x] **Task 5 — DESIGN.md contract-doc fidelity (AC: #2).** In `DESIGN.md`, update the `annotation-pen` entry (L501) "stroke width from the pen quick-box" → "one of four stroke widths from the pen quick-box", so the contract doc matches shipped behavior (AE7-3: reconcile the spec, not only the story). Documentation only; the px tokens themselves live in `components.css` (Task 1), NOT in `DESIGN.md`/`tokens.css`. Do NOT run `gen:tokens` for this (it regenerates `tokens.css` from the DESIGN.md token scales and does not touch component dims). Verify no em-dash in the edited string.

- [x] **Task 6 — Live smoke at DPR>1 (AC: #1, #3, #4).** Start YOUR OWN `uvicorn` + `vite dev` (never a user-launched/Docker server, CLAUDE.md) with an explicit throwaway `PAPER_MATE_DATA` scratch dir (never `~/.paper-mate`, the Story 10.2-10.7 process note). At DPR 2 (`claude-in-chrome`; if it lacks DPR control use the `chrome-devtools-mcp` `emulate({viewport:"…x2"})` fallback and note it):
  - [x] (a) Arm Pen, open the stroke-width picker in the rail flyout → FOUR dots show, the new thinnest (`Fine`) is first and visibly thinner than the old thinnest; the flyout row does not overflow/wrap (AC #4).
  - [x] (b) Pick `Fine`, draw a stroke → it renders as a crisp thin filled line (not invisible) at DPR 2; confirm `window.devicePixelRatio === 2`.
  - [x] (c) Select that pen stroke → its own quick-box stroke-width menu opens DOWN with all four cells fitting, `Fine` armed (AC #4). Reopen the paper (Back to Library → reopen) → the stroke restores at the Fine width, unchanged (AC #3, persist/restore).
  - [x] Delete the transient test doc afterward and confirm `library.json` is clean. (No text-selection gesture here — plain draw + navigate — so the drag-forms-a-real-Selection constraint does not apply.)

- [x] **Task 7 — Version + docs.** Bump `server/pyproject.toml` `[project].version` `0.5.37` → `0.5.38` at PR-merge time (per CLAUDE.md versioning — once, when the story flips to `done`; NOT mid-implementation; keep `server/uv.lock` in step, `test_version.py` checks it). Pure client change: NO `/api` contract change, so `docs/API.md` needs NO edit. New token is component-dims in `components.css` (theme-exempt raw px). Only new UI string is the label "Fine" (plain word, no em-dash). No `render/` barrel change.

### Review Findings

- [x] [Review][Patch] Stale "three width steps (thin/medium/thick)" doc comment [client/src/annotations/StrokeWidthRow.tsx:4] — fixed: now reads "four width steps (fine/thin/medium/thick)".

## Dev Notes

### Resolved open design calls (from epics.md L2486)

The epic left four calls; all resolved here so dev implements without deciding:

- **Exact four values** → `2 / 4 / 8 / 16` scale-1.0 px. Prepend `2` to the current `4/8/16` (a 2× geometric ladder end-to-end), so the thinnest is exactly half today's thinnest — clearly "finer" without going so thin it vanishes at normal zoom.
- **Default stays or shifts** → STAYS medium (`activeStrokeWidth: 8`, `store/index.ts` L391). Zero behavior change for existing users; the store is not touched (AC #5).
- **Token name** → `--pen-stroke-fine` / key `"fine"` / label `"Fine"`. "Fine" is the one-word step below "Thin" (fine-point pen), keeps the single-word label ladder Fine < Thin < Medium < Thick, and needs no rename of the existing three (minimal diff).
- **Grow for a fifth level, or fixed at four** → FIXED at four. Matches the `AlphaRow` four-cell precedent that already fits the shared `.pen-picker__menu`; no layout generalization for a hypothetical fifth.

### Token location correction (AC #2 — read this before Task 1)

The epic AC says the new value is "a new `--pen-stroke-*` token in DESIGN.md (regenerated into `tokens.css`)". That is FACTUALLY WRONG for these tokens. Ground truth in this repo:

- `--pen-stroke-thin/medium/thick` are hand-authored **component dims** in `client/src/theme/components.css` (L147-149), NOT design tokens.
- `client/src/theme/tokens.css` is a gitignored build artifact `npm run gen:tokens` generates from `DESIGN.md`'s token SCALES (colors/spacing/typography/rounded). It contains no `--pen-stroke-*` and never will.
- Per CLAUDE.md: "Component dims/typography live hand-authored in `client/src/theme/components.css`. Both are the token layer; raw hex/px are allowed ONLY in `src/theme/**`."

So the fourth width goes in `components.css` beside the other three (Task 1). This fully satisfies the AC's real intent — "not a raw px, the picker reads the token set" — because `components.css` IS the token layer and `no-raw-values.test.ts` exempts `theme/`. `DESIGN.md` gets only the prose-fidelity touch in Task 5, not a token.

### The `STEPS[1]` fallback trap (AC #5)

`StrokeWidthRow` L43: `const current = STEPS.find((s) => s.width === value) ?? STEPS[1];`. `STEPS[1]` is the collapsed trigger's preview when the passed `value` matches no step. Today `STEPS[1]` is `medium(8)`. Prepending `fine(2)` shifts every index by one, so `STEPS[1]` becomes `thin(4)` — a silent change to the out-of-set fallback preview. Repoint it to medium (`STEPS[2]`, or the key-lookup form in Task 2). In practice `value` is always the store's `activeStrokeWidth` (default 8, a real step) or a selected pen's stored width (also always a real step at creation), so the fallback is rarely hit — but leaving it pointing at `thin` is an unintended behavior change and exactly the kind of index-shift bug an added enum entry introduces.

### Where the four steps surface (both consumers, no per-consumer change)

`StrokeWidthRow` is the single source of the width list; both call sites just pass `value`/`onPick`, so adding one `STEP` lights up both automatically:

- **Rail flyout** — `client/src/components/ToolRail/ToolRail.tsx` L394: `<StrokeWidthRow value={activeStrokeWidth} onPick={onPickStrokeWidth} />`. Its `.pen-picker__menu` opens as a horizontal row to the RIGHT (the `.tool-flyout .pen-picker__menu` override in `App.css`).
- **Pen selection quick-box** — `client/src/annotations/AnnotationInteraction.tsx` L564: `<StrokeWidthRow value={selectedAnno.style.stroke_width ?? activeStrokeWidth} onPick={restrokeSelected} />`. Its menu opens DOWN as a vertical column (the `.pen-picker__menu` default). `restrokeSelected` routes through the 3.1 command path (undoable recolor/restroke), unchanged.

### Render + crispness (AC #3)

The pen renders as ONE filled SVG `<path>` from the `perfect-freehand` outline (`AnnotationLayer.tsx` `renderPen`, L264-284): `const width = (a.style.stroke_width ?? 0) * scale;` then `svgPathFromOutline(strokeOutline(pts, width))`. A `stroke_width: 2` at scale 1.0 is a 2 CSS-px-wide filled shape (4 device px at DPR 2), anti-aliased, never sub-pixel-invisible at normal zoom. It thins with zoom-out like every width does (thin(4) has the same property at 2× the zoom-out); `2` is a sensible floor, not a special case. Live smoke (Task 6b) confirms at DPR 2.

### Preserve exactly (regression guards)

- The three existing widths, their tokens (`--pen-stroke-thin/medium/thick`), their keys, and their labels are UNCHANGED — this story only ADDS.
- The store is untouched: `activeStrokeWidth` default stays `8`, `setActiveStrokeWidth` unchanged (`store/index.ts` L390-392). No new store field, no `store/index.test.ts` edit.
- The annotation model / API contract is untouched: `style.stroke_width` is already a free `number` (generated type); a `2` needs no schema change, no `openapi.json`/`schema.d.ts` regen, no `docs/API.md` edit.
- No `render/index.ts` export change → the `vi.mock("./render")` barrels (`App.test.tsx`, `Reader.test.tsx`) are NOT touched (CLAUDE.md barrel-sync principle).
- The `AlphaRow` and `SizeRow` (the other two collapsible picker rows) are unrelated — do not touch.

### Testing standards

- Backend: none (pure client story; no `server/` change). Frontend: `cd client && npm test` + `npm run typecheck`.
- Only two existing tests assert the step count and must move 3 → 4 (`StrokeWidthRow.test.tsx` L18, `ToolRail.test.tsx` L483); mirror `AlphaRow.test.tsx` (already `toHaveLength(4)`) for the shape. jsdom renders the picker fully (it is DOM, no layout math), so the four-cell existence, arm-on-value, and pick-calls-`onPick(2)` are all unit-testable; the pixel crispness/fit at DPR>1 is the live-smoke-only part (Task 6). `[[verify-on-hidpi-and-real-host]]`.

### Project Structure Notes

- Downward-dependency rule holds: `components.css` (token layer, leaf) ← `Annotations.css` (component CSS) ← `StrokeWidthRow.tsx` (leaf component) ← `ToolRail.tsx` / `AnnotationInteraction.tsx` (composition). One token added, one component's `STEPS` array + fallback index, two CSS rule pairs, two test files, one DESIGN.md line. No new file. No `anchor/`, `render/`, `store/`, `server/`, or contract change.

### References

- Epic + ACs + open design calls: [Source: .bmad/planning-artifacts/epics.md#Story 10.8] (L2463-2486).
- Source of the request (item 12, AC-extension of FR-9, not a new FR): [Source: .bmad/planning-artifacts/sprint-change-proposals/sprint-change-proposal-2026-07-18.md] (L37, L48, L98, L138).
- Code touch points (verbatim, current):
  - Token layer to extend: `client/src/theme/components.css` — `annotation-pen` block L143-149 (`--pen-stroke-thin/medium/thick`); alpha-token precedent (Story 2.13's fourth level) L154-160.
  - The picker: `client/src/annotations/StrokeWidthRow.tsx` — `Step` L17-25, `STEPS` L27-31, `current` fallback L43, the `data-testid` L74. Four-level twin to mirror: `client/src/annotations/AlphaRow.tsx` (`STEPS` L28-32, four keys L23).
  - Preview CSS: `client/src/annotations/Annotations.css` — `.pen-thickness-icon--*` L359-369, `.stroke-width-step__dot--*` L438-451.
  - Consumers: `client/src/components/ToolRail/ToolRail.tsx` L394; `client/src/annotations/AnnotationInteraction.tsx` L564.
  - Render path: `client/src/annotations/AnnotationLayer.tsx` — `renderPen` L264-284 (`stroke_width * scale`).
  - Store default (do NOT change): `client/src/store/index.ts` L390-392.
  - Tests to update: `client/src/annotations/StrokeWidthRow.test.tsx` L15-22; `client/src/components/ToolRail/ToolRail.test.tsx` L483. Precedent shape: `client/src/annotations/AlphaRow.test.tsx` L18.
  - Raw-px exemption proof: `client/src/no-raw-values.test.ts` L8-13 (`theme/` exempt).
  - Contract-doc line: `DESIGN.md` L501 (`annotation-pen`).
- FR-9 (pen tool, incl. stroke width): [Source: .bmad/planning-artifacts/prds/prd-paper-mate-2026-06-28/prd.md] (pen FR). DESIGN token contract + em-dash rule: [Source: CLAUDE.md] (Design conventions).
- Relevant memories: [[no-emdash-user-facing]], [[verify-on-hidpi-and-real-host]], [[prefer-stable-solutions]] (extend the existing `STEPS`/token pattern, do not rebuild the picker).

## Dev Agent Record

### Agent Model Used

Sonnet 5 (bmad-dev-story).

### Debug Log References

- Frontend suite: `cd client && npm test` — 74 files / 1643 tests passed after Tasks 1-5.
- Typecheck: `cd client && npm run typecheck` — clean (`tsc -b --noEmit`).
- Live smoke servers (Task 6): dedicated `uvicorn` on `127.0.0.1:8010` (`PAPER_MATE_DATA` pointed at a scratch dir under the session scratchpad, never `~/.paper-mate`) + dedicated `vite dev` on `127.0.0.1:5183` (`PAPER_MATE_API_TARGET=http://127.0.0.1:8010`), both started and torn down this session. `claude-in-chrome` had no DPR control available in this session, so the documented fallback was used: `chrome-devtools-mcp`'s `emulate({viewport:"1280x900x2"})` on its own page (a separate, unrelated Paper Mate tab was already open at `localhost:5233` and was left untouched).

### Completion Notes List

- Tasks 1-5 (token, `STEPS`/fallback, preview CSS, tests, DESIGN.md prose) implemented per the Dev Notes exactly as scoped; no deviation.
- `STEPS[1]` fallback trap (AC #5) fixed via the key-lookup form the story recommended: `STEPS.find((s) => s.key === "medium") ?? STEPS[0]`.
- Task 6 live smoke at DPR 2, all sub-items verified:
  - (a) Rail flyout: four dots (Fine/Thin/Medium/Thick) render in a horizontal row, no overflow/wrap; Fine visibly thinner than Thin.
  - (b) Picked Fine, drew a stroke (synthetic trusted-shape `PointerEvent` sequence dispatched on the actual page-surface/text-layer element under the pointer, since the gesture's document-level listeners read `e.target`/`e.clientX/Y` directly with no `isTrusted` gate) → rendered as a crisp filled line at `window.devicePixelRatio === 2`; confirmed via `GET /api/docs/{id}/annotations` that it persisted with `style.stroke_width: 2`.
  - (c) Selected the stroke → its quick-box `Pen thickness: Fine` trigger showed Fine already armed; opened the picker → vertical DOWN column, all four cells fit, Fine ringed. Reloaded the reader (equivalent to Back to Library → reopen for restore purposes, since the store hydrates from the server on mount) → stroke restored unchanged at Fine width.
  - Deleted the transient test doc via `DELETE /api/docs/{id}`; confirmed the scratch `library.json` ended with empty `papers`/`folders`.
- No store/anchor/render/contract change, confirmed: `store/index.test.ts` untouched and still green; no `render/index.ts` export added so the `vi.mock("./render")` barrels needed no edit.
- Version bump (Task 7) intentionally deferred to PR-merge time per CLAUDE.md versioning (not done in this session) — matches the Story 10.7 precedent.

### File List

- `client/src/theme/components.css` (modified — added `--pen-stroke-fine: 2px;`)
- `client/src/annotations/StrokeWidthRow.tsx` (modified — fourth `STEP`, extended `Step.key` union, fixed the `STEPS[1]` fallback)
- `client/src/annotations/Annotations.css` (modified — `.pen-thickness-icon--fine` + `.stroke-width-step__dot--fine` rules)
- `client/src/annotations/StrokeWidthRow.test.tsx` (modified — step-count assertion 3→4, added a `fine` arm/pick case)
- `client/src/components/ToolRail/ToolRail.test.tsx` (modified — step-count assertion 3→4)
- `DESIGN.md` (modified — `annotation-pen` entry prose fidelity, "one of four stroke widths")

## Change Log

- 2026-07-19: Story created (bmad-create-story). Resolved the four epics.md open design calls: values `2/4/8/16` (prepend `2`, keep the 2× ladder); default STAYS medium (`8`, store untouched); token/key/label `--pen-stroke-fine`/`"fine"`/`"Fine"`; picker FIXED at four (AlphaRow four-cell precedent). Corrected the AC's token-location error: the fourth `--pen-stroke-*` is a component-dims token in `client/src/theme/components.css` (where the existing three live, `theme/`-exempt from `no-raw-values`), NOT `DESIGN.md`/generated `tokens.css`; `DESIGN.md` gets a prose-fidelity touch only. Flagged the `STEPS[1]` collapsed-fallback index-shift trap (must repoint to medium). Scoped as: one token, one `STEP` + fallback fix, two CSS rule pairs, two step-count test updates (3→4, mirroring `AlphaRow`), one DESIGN.md line, DPR>1 live smoke of render-crispness + four-cell fit on both picker surfaces. No store/anchor/render/contract change; version bumps to 0.5.38 at PR merge.
- 2026-07-19: Implemented (bmad-dev-story). Tasks 1-7 complete. Live smoke (Task 6) verified all ACs at DPR 2 with no surprises (no bugs surfaced, unlike 10.7). Full suite green (1643 tests), typecheck clean. Version bump deferred to PR-merge time per CLAUDE.md versioning.
- 2026-07-19: Senior Developer Review via Codex (`bmad-code-review`, `codex exec --sandbox read-only`). Verdict: 0 High, 0 Medium, 1 Low (stale "three width steps" doc comment). Patch applied. See "Review Findings" under Tasks/Subtasks. Story stays `review`; flips to `done` at PR-merge time per CLAUDE.md/AE3-1.
