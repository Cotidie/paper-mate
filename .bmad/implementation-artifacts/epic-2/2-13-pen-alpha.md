# Story 2.13: Pen stroke alpha (transparency)

---
baseline_commit: c2587f690b5c82ad6b338c81330cb665d6f1016e
---

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a reader,
I want to adjust a pen stroke's transparency,
so that my freehand marks sit over the text like a highlighter instead of hiding it.

> **This is the FIRST contract change in Epic 2, and it is additive.** Every Epic-2 story so far kept the generated `Annotation` contract byte-identical because `PathAnchor`/`Point`/`Style.stroke_width`/`type:"pen"` were all already in the 2.2 foundation (the `docs/API.md` changelog confirms: its last contract entry is Story 2.2, nothing since). Alpha is genuinely new: `Style` today is exactly `{color: str, stroke_width: float | None = None}` (server/app/models.py:109) with no transparency dimension, and the pen renders at FULL opacity (`.annotation-pens` is a full-opacity group). This story adds ONE field — `style.alpha` — to the Pydantic `Style` model, regenerates the OpenAPI → TS contract the sanctioned way (never hand-authored, AD-3), and threads it through create / render / the pen sub-toolbox + selection quick-box, exactly mirroring how `color` (2.6) and `stroke_width` (2.8) already flow. The field is OPTIONAL with a default, so it is backward-compatible: a pre-2.13 pen mark with no `alpha` renders at the default (the highlighter opacity), not a break (AD-8 — additive, no MAJOR bump).

## The decisions that define this story (read before coding)

**1. `alpha` is an additive, optional `Style` field — regenerate, never hand-author (AD-3).** Add `alpha: float | None = None` to `server/app/models.py`'s `Style`, then regenerate: `cd server && PYTHONPATH= uv run python -m app.export_openapi` (writes `server/openapi.json`), then `cd client && npm run gen:api` (regenerates `client/src/api/schema.d.ts`). The tracked `schema.d.ts` WILL change this story (Style gains `alpha`) — that is expected and correct; do NOT hand-edit the generated type. Update `docs/API.md`'s annotation-model `Style` entry + changelog in the same change (the contract reference rule).

**2. Default alpha = the highlighter opacity (0.4); `null` means "use the default".** The store's `activeAlpha` defaults to the same value as `--annotation-highlight-opacity` (`0.4`, in `client/src/theme/components.css:97`). A new pen mark stores that number in `style.alpha`. A mark whose `alpha` is `null` (older data, or any non-pen mark) renders at the default constant — so the render path is `a.style.alpha ?? PEN_DEFAULT_ALPHA`. The CSS var can't be read as a number in TSX, so the default lives as a small typed constant next to the render, kept in sync with the `0.4` token by a comment (this mirrors how the highlight 0.4 is applied as group `opacity` in `Annotations.css:21`).

**3. Alpha is the THIRD pen style axis; it rides the SAME seams as color (2.6) and width (2.8), and follows the now-established memo-size pattern (2.9).** No new machinery: a new `AlphaRow` component (twin of `StrokeWidthRow`/`SizeRow` — a step row, NOT a bespoke slider, for consistency), a store `activeAlpha` + `setActiveAlpha` + `realphaAnnotation` (the alpha twin of `restrokeAnnotation`, guarded to `anchor.kind === "path"`), the pen rail sub-toolbox (`pen-flyout`) gains the alpha row, the pen selection quick-box gains the alpha row (gated `isPenSelected`, exactly as the existing `StrokeWidthRow` is — see Decision 5), and the create path + live preview read `activeAlpha`. Geometry is unchanged (still `kind=path` points); alpha is pure STYLE (AD-5 style axis).

**4. Apply alpha as the SVG path `fill-opacity`, not a group opacity.** The pen group (`.annotation-pens`) stays full-opacity at the group level; each `<path>` gets its own `fill-opacity={alpha}` (and the live-preview path too) so each stroke is independently transparent and overlapping strokes of different alpha do not all collapse to one group value. `fill-opacity` is a unitless number attribute, so `no-raw-values` is unaffected.

**5. The pen selection quick-box already renders rows conditionally by type — add the alpha row the same way.** `AnnotationInteraction.tsx` (the quick-box JSX, ~lines 1133–1148) shows `ColorSwatchRow` for every mark, then `{isPenSelected && <StrokeWidthRow value={selectedAnno.style.stroke_width ?? activeStrokeWidth} onPick={restrokeSelected} />}`, then `{isMemoSelected && <SizeRow … />}`, then the divider + Delete. The alpha row slots in right after the `isPenSelected` stroke-width row, ALSO gated `isPenSelected`, armed to `selectedAnno.style.alpha ?? activeAlpha`, `onPick={realphaSelected}`. Mirror `restrokeSelected` for `realphaSelected` (call `realphaAnnotation` + `setActiveAlpha`, keep the mark selected). The `isPenSelected` flag already exists — reuse it; do NOT add a new selection branch.

## Scope boundary — READ FIRST

**IN (this story):**

- **`Style.alpha` Pydantic field + contract regen.** `alpha: float | None = None` on `Style` (path-relevant, like `stroke_width`; `None` for marks that don't set it). Regenerate `openapi.json` + `schema.d.ts`. Update `docs/API.md`.
- **Store: `activeAlpha` (default = highlighter opacity `0.4`), `setActiveAlpha`, `realphaAnnotation(ids, alpha, now)`** (guarded `a.anchor.kind === "path"`, the alpha twin of `restrokeAnnotation` at `store/index.ts:164`). `activeAlpha` is the sticky session default (last-choice-wins, like `activeColor`/`activeStrokeWidth`/`activeMemoSize`).
- **`buildPenAnnotation` writes `alpha`.** Add `alpha: number` to `BuildPenOptions` (`create.ts:60`) and into the built `style` (`create.ts:85`). The pen create path (`AnnotationInteraction`) passes `activeAlphaRef.current`.
- **`AlphaRow` component (NEW).** A step row of alpha levels (e.g. `0.2 / 0.4 / 0.6 / 0.8 / 1.0`), mirroring `StrokeWidthRow` (`value: number` + `onPick(alpha)`; armed step shows the ink ring; keyboard-reachable; each step previews its opacity). Token values for the step swatches in `components.css`; `.alpha-row`/`.alpha-step` styles in `Annotations.css`. Export from `annotations/index.ts`.
- **Render alpha.** `AnnotationLayer`'s `renderPen` `<path>` (~line 386, where `width = (a.style.stroke_width ?? 0) * scale`) gets `fillOpacity={a.style.alpha ?? PEN_DEFAULT_ALPHA}`; the live-preview path in `AnnotationInteraction` uses `fillOpacity={activeAlpha}`. Re-derives unchanged on zoom (alpha is scale-independent).
- **Pen sub-toolbox + selection quick-box gain the alpha row.** `ToolRail` `pen-flyout`: color + width + **alpha** (the flyout currently renders `<ColorSwatchRow>` + `<StrokeWidthRow>`). The pen selection quick-box: color + width + **alpha** + delete (Decision 5). Recolor/restroke/realpha all keep the mark selected and update the session default.
- **Tests + live smoke.** Unit: the contract field, `realphaAnnotation` (incl. the non-path guard), `buildPenAnnotation` alpha, `AlphaRow`, the layer's `fill-opacity`, the rail/quick-box alpha row, create reads `activeAlpha`. Live: a pen stroke lands semi-transparent at the default, the alpha control changes it (preview + landed + restyle), it stays across zoom, default matches the highlighter feel.

**OUT (later / do NOT build):**

- **Alpha for highlight / underline / memo / other types.** Highlight already gets its 0.4 from the group; this story does NOT add a per-mark alpha control to other tools (the `alpha` field exists on `Style` generally, but ONLY the pen UI sets it; other marks leave it `null`). A future story could expose alpha for highlights.
- **A continuous slider.** Use a step row for consistency with color/width/size (a slider is a possible later refinement; not now).
- **Move / resize / re-point the stroke** — Story 3.1 (Epic 3, command path). Alpha is style-only.
- **Persistence / command stack / undo** — Epic 3. Create/realpha stay client-side, reusing the existing store-action pattern.
- **A MAJOR version bump.** The field is additive + optional (old data reads back fine), so this is not an AD-8 format break.

## Acceptance Criteria

1. **A new pen stroke lands at the default alpha = the highlighter opacity, stored per-mark (epics.md#Story-2.13 AC1; FR-9, AR-5).** With pen armed, a freehand stroke stores `style.alpha` = `activeAlpha` (default = `--annotation-highlight-opacity` = `0.4`) and renders semi-transparent over the text. `alpha` is an additive optional `Style` field; a mark with `alpha = null` (pre-2.13 data, or a non-pen mark) renders at the default. [Source: epics.md#Story-2.13; ARCHITECTURE-SPINE.md#AD-5 (style axis), #AD-3 (generated contract); server/app/models.py `Style`; create.ts `buildPenAnnotation`]

2. **The alpha is adjustable arm-time AND on a selected mark; the choice is the sticky default (epics.md#Story-2.13 AC2; UX-DR5/DR7).** The pen rail sub-toolbox (`pen-flyout`, arm-time) and the pen selection quick-box both show an alpha control (an `AlphaRow` step row); picking an alpha sets the session default (`activeAlpha`, last-choice-wins) and, for a selected mark, re-alphas it via `realphaAnnotation`. The live preview, the new stroke, and a restyle all reflect the chosen alpha. [Source: epics.md#Story-2.13; UX-DR5; ToolRail.tsx (`pen-flyout` Color+Width pattern); AnnotationInteraction.tsx (selection quick-box, `isPenSelected` rows); Stories 2.6/2.8/2.9]

3. **Alpha renders as per-stroke `fill-opacity`, independent across overlapping strokes (Decision 4).** Each pen `<path>` carries its own `fill-opacity`; the `.annotation-pens` group stays full-opacity so two strokes of different alpha do not collapse to one value. [Source: AnnotationLayer.tsx `renderPen`; ARCHITECTURE-SPINE.md#AD-5]

4. **Alpha is preserved across zoom (epics.md#Story-2.13 AC3; NFR-3).** Zooming re-renders the stroke glued + correctly scaled (Story 2.8 invariant: `stroke_width * scale`) with the alpha unchanged (alpha is scale-independent). [Source: AnnotationLayer.tsx; ARCHITECTURE-SPINE.md#AD-4]

5. **Contract change is additive + regenerated, not hand-authored (AD-3, AD-8).** `Style.alpha` is added to the Pydantic model; `server/openapi.json` + `client/src/api/schema.d.ts` are REGENERATED (the tracked `schema.d.ts` diff is exactly the new optional `alpha` field, nothing else); `docs/API.md` updated. The field is optional with a default → backward-compatible, no persisted-format break, no MAJOR bump. No `render/index.ts` export added (the `vi.mock("./render")` barrels in App.test/Reader.test stay untouched); `no-raw-values` green (`fill-opacity` is unitless; alpha-step token values live in `src/theme/**`). Pen create/select/recolor/restroke/delete (2.8), highlight/underline, memo/comment, pan, zoom-glue do not regress. [Source: ARCHITECTURE-SPINE.md#AD-3, #AD-8, #AD-9; CLAUDE.md#Versioning, #Contract-types, #Design-conventions, #Engineering-principles]

## Tasks / Subtasks

- [x] **Task 1 — `Style.alpha` field + contract regen (AC: 1, 5)**
  - [x] `server/app/models.py`: add `alpha: float | None = None` to `Style` with a docstring (transparency 0..1; pen-relevant; `None` = render at the default). Optionally a Pydantic `Field(ge=0, le=1)` bound.
  - [x] Regenerate: `cd server && PYTHONPATH= uv run python -m app.export_openapi`, then `cd client && npm run gen:api`. Commit the regenerated `server/openapi.json` + `client/src/api/schema.d.ts`.
  - [x] `docs/API.md`: update the annotation-model `Style` entry + changelog (the contract reference rule; the next changelog line after the Story 2.2 entry).
  - [x] Backend test (`server/tests/test_models.py`): a `Style`/`Annotation` round-trips with and without `alpha` (null default); an out-of-range alpha is rejected if a bound is added.

- [x] **Task 2 — store: activeAlpha + realphaAnnotation (AC: 1, 2)**
  - [x] `client/src/store/index.ts`: add `activeAlpha: number` (default = the highlighter opacity constant `0.4`), `setActiveAlpha`, and `realphaAnnotation(ids, alpha, now)` — the alpha twin of `restrokeAnnotation` (lines 94–98, 164–176), guarded `a.anchor.kind === "path"` (alpha is pen-only in the UI; do not write it onto text/rect marks). Document like the `activeStrokeWidth`/`restrokeAnnotation` comments.
  - [x] Add `activeAlpha` to the `beforeEach` reset in `store/index.test.ts`; tests for `setActiveAlpha` + `realphaAnnotation` (incl. the non-path guard, mirroring the `restrokeAnnotation` guard test).

- [x] **Task 3 — buildPenAnnotation writes alpha (AC: 1)**
  - [x] `client/src/annotations/create.ts`: add `alpha: number` to `BuildPenOptions` (after `strokeWidth`, line 68); set `style.alpha` in the built mark (line 85). Test it in `create.test.ts`.

- [x] **Task 4 — AlphaRow component (AC: 2)**
  - [x] `client/src/annotations/AlphaRow.tsx` (NEW): a step row of alpha levels mirroring `StrokeWidthRow` (`value: number` + `onPick(alpha)`; `role="group"`; each button `role="menuitemradio"`; armed step shows the ink ring; each step's swatch previews its opacity via `opacity`/`fill-opacity`; keyboard-reachable; `data-testid="alpha-<value>"`; no em-dash in labels). Export from `annotations/index.ts`. Step token values in `components.css`; `.alpha-row`/`.alpha-step` styles in `Annotations.css` (mirror `.stroke-width-row`/`.stroke-width-step`).
  - [x] `AlphaRow.test.tsx`: renders the steps, arms `value`, `onPick` fires with the chosen alpha.

- [x] **Task 5 — render + preview alpha (AC: 1, 3, 4)**
  - [x] `client/src/annotations/AnnotationLayer.tsx`: the `renderPen` `<path>` (~line 386) gets `fillOpacity={a.style.alpha ?? PEN_DEFAULT_ALPHA}` (a small typed constant kept in sync with `--annotation-highlight-opacity` = `0.4`). Group `.annotation-pens` stays full-opacity.
  - [x] `client/src/annotations/AnnotationInteraction.tsx`: the live-preview pen path uses `fillOpacity={activeAlpha}`.
  - [x] Layer test (`AnnotationLayer.test.tsx`): a pen mark renders the expected `fill-opacity`; a null-alpha mark renders the default.

- [x] **Task 6 — pen sub-toolbox + selection quick-box gain the alpha row (AC: 2)**
  - [x] `client/src/ToolRail.tsx`: the `pen-flyout` `ToolFlyout` adds `<AlphaRow value={activeAlpha} onPick={…}/>` below the existing `<ColorSwatchRow>` + `<StrokeWidthRow>`. Add `activeAlpha`/`onPickAlpha` to the props block (next to `activeStrokeWidth`/`onPickStrokeWidth` and `activeMemoSize`/`onPickMemoSize`; App owns them, store-backed). On pick, `onPickAlpha(alpha)` then `setFlyoutOpen(false)` (pick-is-dismiss, like the other rows).
  - [x] `client/src/App.tsx`: subscribe `activeAlpha`/`setActiveAlpha`; pass `activeAlpha`/`onPickAlpha` to `ToolRail`. The create path reads `activeAlpha` (the overlay subscribes to the store directly + holds an `activeAlphaRef`, exactly like `activeStrokeWidthRef` at `AnnotationInteraction.tsx:154-155`).
  - [x] `client/src/annotations/AnnotationInteraction.tsx`: subscribe `activeAlpha`, `realphaAnnotation`; add `activeAlphaRef`; add `realphaSelected` (twin of `restrokeSelected`: `realphaAnnotation([id], alpha, now)` + `setActiveAlpha(alpha)`, keep selected); in the quick-box add `{isPenSelected && <AlphaRow value={selectedAnno.style.alpha ?? activeAlpha} onPick={realphaSelected} />}` right after the `isPenSelected` `StrokeWidthRow` (Decision 5); the pen create call passes `alpha: activeAlphaRef.current` into `buildPenAnnotation`.
  - [x] Tests: `ToolRail.test.tsx` (pen flyout shows the alpha row; pick fires `onPickAlpha` + closes), `AnnotationInteraction.test.tsx` (a new pen stroke stores `activeAlpha`; a selected pen mark's box shows the alpha row and realphas; a selected highlight/memo box does NOT show it), `App.test.tsx` (alpha prop threads through — ToolRail is mocked in App.test.tsx, no new test needed there).

- [x] **Task 7 — regression bar + live smoke (AC: all)**
  - [x] `cd client && npm test` + `npm run typecheck`; `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q`. 413/413 client tests pass; 43/43 server tests pass; typecheck exits 0; `no-raw-values` green.
  - [x] **Live smoke (own fresh servers per CLAUDE.md; real PDF at DPR>1):** (a) arm Pen → the `pen-flyout` shows color + width + alpha (4 steps Low/Mid/High/Full); (b) draw → stroke renders at `fill-opacity="0.6"` (set "High" arm-time); (c) select the stroke → quick-box shows alpha row with "High" checked; (d) all 3 axes visible in flyout and quick-box; screenshot captured.

- [x] **Task 8 — docs + version (AC: all)**
  - [x] `docs/API.md` updated (Task 1). `client/src/annotations/README.md`: note pen's third style axis (alpha) — stored on `Style.alpha`, rendered as per-path `fill-opacity`, default = highlighter opacity, adjustable via the `AlphaRow` in the `pen-flyout` + selection quick-box.
  - [x] Version: PATCH +1 at done (`server/pyproject.toml` `0.1.10 → 0.1.11`).

## Dev Notes

### What this adds vs reuses

| Need | Reuse | New |
| --- | --- | --- |
| Style field + contract | the generated `Style` (regen flow, AD-3) | `alpha: float | None` on Pydantic `Style` |
| Sticky session default | `activeColor`/`activeStrokeWidth`/`activeMemoSize` pattern | `activeAlpha` + `setActiveAlpha` |
| Restyle a selected mark (guarded) | `restrokeAnnotation` (kind=path) / `resizeMemoAnnotation` (kind=rect+memo) | `realphaAnnotation` (kind=path guarded) |
| Step-row control | `StrokeWidthRow`/`SizeRow` | `AlphaRow` |
| Sub-toolbox / quick-box | the `pen-flyout` (Color+Width) + the `isPenSelected` quick-box rows (2.8) | add the alpha row to both |
| Render | the `renderPen` `<path>` (2.8) | `fillOpacity` per path; preview uses `activeAlpha` |

Resist: a group-level pen opacity (must be per-stroke, Decision 4); hand-editing `schema.d.ts` (regenerate); writing `alpha` onto text/rect marks (pen-only UI, guard it); a bespoke slider (use the step row for consistency); a new quick-box selection branch (reuse `isPenSelected`).

### Integration points (verified against current code, 2026-06-30)

- `server/app/models.py:109` — `Style` is currently `{color: str, stroke_width: float | None = None}` (add `alpha`).
- `server/openapi.json` + `client/src/api/schema.d.ts` — REGENERATED, not hand-edited.
- `client/src/store/index.ts` — `activeStrokeWidth` (63–65, 123–124) + `restrokeAnnotation` (94–98, 164–176) are the template for `activeAlpha`/`realphaAnnotation`; `activeMemoSize`/`resizeMemoAnnotation` (2.9) is the second precedent for a guarded restyle + rail/quick-box wiring.
- `client/src/annotations/create.ts:60` — `BuildPenOptions` (add `alpha`); `:85` — built `style` (add `alpha`).
- `client/src/annotations/AnnotationLayer.tsx` — `renderPen` (~line 374), the `<path>` at ~386 (add `fillOpacity`). `.annotation-pens` group stays full-opacity (line ~522).
- `client/src/annotations/AnnotationInteraction.tsx` — imports `StrokeWidthRow`/`SizeRow`/`ColorSwatchRow` (38–40); `activeStrokeWidthRef` (154–155); `restrokeSelected`; the quick-box JSX with `isPenSelected`/`isMemoSelected` conditional rows (~1133–1148). Add `activeAlphaRef`, `realphaSelected`, the gated `AlphaRow`, and pass `alpha` to the pen create call + the live-preview `fillOpacity`.
- `client/src/ToolRail.tsx` — props block (45–88, has `activeStrokeWidth`/`onPickStrokeWidth` + `activeMemoSize`/`onPickMemoSize`); the `pen-flyout` `ToolFlyout` (renders `ColorSwatchRow` + `StrokeWidthRow`) — add `AlphaRow` + thread `activeAlpha`/`onPickAlpha`.
- `client/src/App.tsx` — subscribe + pass `activeAlpha`/`setActiveAlpha`.
- `client/src/theme/components.css` — alpha-step token values (and `--annotation-highlight-opacity: 0.4` at line 97 is the default source). `client/src/annotations/Annotations.css` — `.alpha-row`/`.alpha-step` styles (mirror `.stroke-width-row`/`.stroke-width-step`).

### Engineering conventions (CLAUDE.md)

- **Generated contract (AD-3):** edit Pydantic → regen → never hand-author `schema.d.ts`. This is the FIRST Epic-2 contract change; the tracked `schema.d.ts` diff is expected (the new `alpha` field only). Update `docs/API.md` in the same change.
- **Additive/backward-compatible (AD-8):** optional field with a default → no MAJOR bump; pre-2.13 marks read back fine (null → default alpha).
- **Adopt-stable / one model:** reuse the color/width/size seams; one `activeAlpha`, no parallel state. [[prefer-stable-solutions]]
- **No em-dash in UI strings; tokens not raw values** (`fill-opacity` is unitless; alpha-step token values live in `src/theme/**`). [[no-emdash-user-facing]]
- **Document-level handlers, phase-gated** — the alpha control adds no global key/pointer handler; the pen gesture handlers already live on `document` (AP-1). No new barrel/mock work (no `render/` export).
- **HiDPI live smoke** at DPR>1 (alpha is a visual change; confirm it reads like the highlighter). [[verify-on-hidpi-and-real-host]]
- **Cross-model code review** after dev-story.

### Versioning

- PATCH +1 at done: `server/pyproject.toml` `0.1.10 → 0.1.11` (single source).

### References

- [Source: .bmad/planning-artifacts/epics.md#Story-2.13] — story + the three ACs (default = highlighter alpha; adjustable arm-time + selected; preserved across zoom).
- [Source: ARCHITECTURE-SPINE.md#AD-5] — `type`/`style` vs `anchor.kind`; `style` is field-scoped (alpha is a style axis, geometry unchanged).
- [Source: ARCHITECTURE-SPINE.md#AD-3] — Pydantic is the single contract source; client types generated, never hand-authored.
- [Source: ARCHITECTURE-SPINE.md#AD-8] — additive optional field is backward-compatible (no persisted-format break / MAJOR bump).
- [Source: .bmad/implementation-artifacts/epic-2/2-8-pen-freehand.md] — the pen create/render/sub-toolbox/selection seams alpha extends; `restrokeAnnotation`/`StrokeWidthRow`/`activeStrokeWidth` are the exact twins.
- [Source: .bmad/implementation-artifacts/epic-2/2-9-textbox-memo.md] — the more-recent twin: `SizeRow`/`activeMemoSize`/`resizeMemoAnnotation` established the step-row + sticky-default + guarded-restyle + rail/quick-box wiring this story copies.
- [Source: CLAUDE.md#Versioning, #Contract-types, #Design-conventions, #Engineering-principles].

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

None — no HALT conditions triggered; all tasks completed in one execution.

### Completion Notes List

- The generated `schema.d.ts` makes `alpha: number | null` a required field (not optional in TS), requiring `alpha: null` to be added to every non-pen `style` object across test fixtures. Fixed systematically.
- `border-radius: 1px` in the initial AlphaRow swatch CSS was caught by `no-raw-values.test.ts`; replaced with `var(--radius-xs)`.
- `AlphaRow` steps are `[0.2, 0.4, 0.6, 1.0]` (4 steps, not 5 — no 0.8 step). Story spec said "e.g. `0.2 / 0.4 / 0.6 / 0.8 / 1.0`"; settled on 4 for visual balance mirroring `StrokeWidthRow`.
- Live smoke confirmed: `fill-opacity="0.6"` on rendered path elements; quick-box shows "High" checked for the selected stroke.

### File List

- `server/app/models.py`
- `server/openapi.json`
- `server/tests/test_models.py`
- `client/src/api/schema.d.ts`
- `docs/API.md`
- `client/src/store/index.ts`
- `client/src/store/index.test.ts`
- `client/src/annotations/create.ts`
- `client/src/annotations/create.test.ts`
- `client/src/annotations/AlphaRow.tsx` (NEW)
- `client/src/annotations/AlphaRow.test.tsx` (NEW)
- `client/src/annotations/index.ts`
- `client/src/annotations/Annotations.css`
- `client/src/annotations/AnnotationLayer.tsx`
- `client/src/annotations/AnnotationLayer.test.tsx`
- `client/src/annotations/AnnotationInteraction.tsx`
- `client/src/annotations/AnnotationInteraction.test.tsx`
- `client/src/annotations/README.md`
- `client/src/ToolRail.tsx`
- `client/src/ToolRail.test.tsx`
- `client/src/App.tsx`
- `client/src/theme/components.css`
- `server/pyproject.toml`

## Change Log

- 2026-06-29: Story created (ready-for-dev) via correct-course + create-story (user feature request: pen stroke alpha).
- 2026-06-30: Re-created (staleness review). Stories 2.9–2.12 had shipped since the first draft. Updated: version target `0.1.5 → 0.1.6` corrected to `0.1.10 → 0.1.11`; added the Story 2.9 precedent (`SizeRow`/`activeMemoSize`/`resizeMemoAnnotation`) and the now-current quick-box conditional-row pattern (`isPenSelected`, Decision 5); pinned verified integration points to current symbols/line numbers. Architecture/ACs unchanged (still match epics.md#Story-2.13; `Style` is still `{color, stroke_width}`, so alpha remains the first Epic-2 contract change).
- 2026-06-30: Implemented by claude-sonnet-4-6. All 8 tasks complete. 413/413 client tests, 43/43 server tests, typecheck clean, no-raw-values green, live smoke confirmed. Status → review.
- 2026-06-30: Pen-picker UI follow-up (user fix requests, PR #23): collapse Thickness/Opacity into icon-only pickers (weight-bar + opacity-ring, toolrail-sized, no caret); step menu opens right in the rail flyout, drops down in the quick-box; picking a step keeps the picker open (only its step menu collapses); stroke widths rescaled 2/4/8 → 4/8/16 px (default 8). 415/415 client tests, typecheck, no-raw-values green, live smoke confirmed both surfaces. Version 0.1.11 → 0.1.12. Status → done (PR #23 merged).
