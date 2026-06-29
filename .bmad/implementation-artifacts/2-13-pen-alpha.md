# Story 2.13: Pen stroke alpha (transparency)

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a reader,
I want to adjust a pen stroke's transparency,
so that my freehand marks sit over the text like a highlighter instead of hiding it.

> **This is the FIRST contract change in Epic 2, and it is additive.** Every Epic-2 story so far kept the generated `Annotation` contract byte-identical because `PathAnchor`/`Point`/`Style.stroke_width`/`type:"pen"` were all already in the 2.2 foundation. Alpha is genuinely new: `Style` today is `{color, stroke_width}` with no transparency dimension, and the pen renders at FULL opacity. This story adds ONE field — `style.alpha` — to the Pydantic `Style` model, regenerates the OpenAPI → TS contract the sanctioned way (never hand-authored, AD-3), and threads it through create / render / the pen sub-toolbox + selection quick-box, exactly mirroring how `color` (2.6) and `stroke_width` (2.8) already flow. The field is OPTIONAL with a default, so it is backward-compatible: a pre-2.13 pen mark with no `alpha` renders at the default (the highlighter opacity), not a break (AD-8 — additive, no MAJOR bump).

## The decisions that define this story (read before coding)

**1. `alpha` is an additive, optional `Style` field — regenerate, never hand-author (AD-3).** Add `alpha: float | None = None` to `server/app/models.py`'s `Style`, then regenerate: `cd server && PYTHONPATH= uv run python -m app.export_openapi` (writes `server/openapi.json`), then `cd client && npm run gen:api` (regenerates `client/src/api/schema.d.ts`). The tracked `schema.d.ts` WILL change this story (Style gains `alpha`) — that is expected and correct; do NOT hand-edit the generated type. Update `docs/API.md`'s annotation-model entry + changelog in the same change (the contract reference rule).

**2. Default alpha = the highlighter opacity (~0.4); `null` means "use the default".** The store's `activeAlpha` defaults to the same value as `--annotation-highlight-opacity` (0.4). A new pen mark stores that number in `style.alpha`. A mark whose `alpha` is `null` (older data, or any non-pen mark) renders at the default constant — so the render path is `a.style.alpha ?? PEN_DEFAULT_ALPHA`. Keep the code constant and the CSS token in sync with a comment (the CSS var can't be read as a number in TSX, so the default lives as a small typed constant next to the render, mirroring how 0.4 is the highlighter group opacity).

**3. Alpha is the THIRD pen style axis; it rides the SAME seams as color (2.6) and width (2.8).** No new machinery: a new `AlphaRow` component (twin of `ColorSwatchRow`/`StrokeWidthRow` — a step row, NOT a bespoke slider, to stay consistent), a store `activeAlpha` + `setActiveAlpha` + `realphaAnnotation` (the alpha twin of `restrokeAnnotation`, guarded to `kind=path`), the pen rail sub-toolbox gains the alpha row, the pen selection quick-box gains the alpha row, and the create path + live preview read `activeAlpha`. Geometry is unchanged (still `kind=path` points); alpha is pure STYLE (AD-5 style axis).

**4. Apply alpha as the SVG path `fill-opacity`, not a group opacity.** The pen group (`.annotation-pens`) stays full-opacity at the group level; each `<path>` gets its own `fill-opacity={alpha}` (and the live-preview path too) so each stroke is independently transparent and overlapping strokes of different alpha do not all collapse to one group value. `fill-opacity` is a unitless number attribute, so `no-raw-values` is unaffected.

## Scope boundary — READ FIRST

**IN (this story):**

- **`Style.alpha` Pydantic field + contract regen.** `alpha: float | None = None` on `Style` (path-relevant, like `stroke_width`; `None` for marks that don't set it). Regenerate `openapi.json` + `schema.d.ts`. Update `docs/API.md`.
- **Store: `activeAlpha` (default = highlighter opacity), `setActiveAlpha`, `realphaAnnotation(ids, alpha, now)`** (guarded `anchor.kind === "path"`, the alpha twin of `restrokeAnnotation`). `activeAlpha` is the sticky session default (last-choice-wins, like `activeColor`/`activeStrokeWidth`).
- **`buildPenAnnotation` writes `alpha`.** Add `alpha` to `BuildPenOptions` and into the built `style`. The pen create path (`AnnotationInteraction`) passes `activeAlphaRef.current`.
- **`AlphaRow` component (NEW).** A step row of alpha levels (e.g. `0.2 / 0.4 / 0.6 / 0.8 / 1.0`), mirroring `StrokeWidthRow` (`value: number` + `onPick(alpha)`; armed step shows the ink ring; keyboard-reachable; each step previews its opacity). Tokens for the steps in `components.css`.
- **Render alpha.** `AnnotationLayer`'s pen `<path>` gets `fillOpacity={a.style.alpha ?? PEN_DEFAULT_ALPHA}`; the live-preview path in `AnnotationInteraction` uses `activeAlpha`. Re-derives unchanged on zoom (alpha is scale-independent).
- **Pen sub-toolbox + selection quick-box gain the alpha row.** `ToolRail` pen flyout: color + width + **alpha**. The pen selection quick-box: color + width + **alpha** + delete. Recolor/restroke/realpha all keep the mark selected and update the session default.
- **Tests + live smoke.** Unit: the contract field, `realphaAnnotation` (incl. the non-path guard), `buildPenAnnotation` alpha, `AlphaRow`, the layer's `fill-opacity`, the rail/quick-box alpha row, create reads `activeAlpha`. Live: a pen stroke lands semi-transparent at the default, the alpha control changes it (preview + landed + restyle), it stays across zoom, default matches the highlighter feel.

**OUT (later / do NOT build):**

- **Alpha for highlight / underline / other types.** Highlight already gets its 0.4 from the group; this story does NOT add a per-mark alpha control to text tools (the `alpha` field exists on `Style` generally, but only the pen UI sets it; text marks leave it `null`). A future story could expose alpha for highlights.
- **A continuous slider.** Use a step row for consistency with color/width (a slider is a possible later refinement; not now).
- **Move / resize / re-point the stroke** — Story 3.1 (Epic 3, command path). Alpha is style-only.
- **Persistence / command stack / undo** — Epic 3. Create/realpha stay client-side, reusing the existing store-action pattern.
- **A MAJOR version bump.** The field is additive + optional (old data reads back fine), so this is not an AD-8 format break.

## Acceptance Criteria

1. **A new pen stroke lands at the default alpha = the highlighter opacity, stored per-mark (epics.md#Story-2.13 AC1; FR-9, AR-5).** With pen armed, a freehand stroke stores `style.alpha` = `activeAlpha` (default ≈ `--annotation-highlight-opacity`, ~0.4) and renders semi-transparent over the text. `alpha` is an additive optional `Style` field; a mark with `alpha = null` (pre-2.13 data, or a non-pen mark) renders at the default. [Source: epics.md#Story-2.13; ARCHITECTURE-SPINE.md#AD-5 (style axis), #AD-3 (generated contract); server/app/models.py `Style`; create.ts `buildPenAnnotation`]

2. **The alpha is adjustable arm-time AND on a selected mark; the choice is the sticky default (epics.md#Story-2.13 AC2; UX-DR5/DR7).** The pen rail sub-toolbox (arm-time) and the pen selection quick-box both show an alpha control (an `AlphaRow` step row); picking an alpha sets the session default (`activeAlpha`, last-choice-wins) and, for a selected mark, re-alphas it via `realphaAnnotation`. The live preview, the new stroke, and a restyle all reflect the chosen alpha. [Source: epics.md#Story-2.13; UX-DR5; ToolRail.tsx (color/width sub-toolbox pattern); AnnotationInteraction.tsx (selection quick-box); Stories 2.6/2.8]

3. **Alpha renders as per-stroke `fill-opacity`, independent across overlapping strokes (Decision 4).** Each pen `<path>` carries its own `fill-opacity`; the `.annotation-pens` group stays full-opacity so two strokes of different alpha do not collapse to one value. [Source: AnnotationLayer.tsx; ARCHITECTURE-SPINE.md#AD-5]

4. **Alpha is preserved across zoom (epics.md#Story-2.13 AC3; NFR-3).** Zooming re-renders the stroke glued + correctly scaled (Story 2.8 invariant) with the alpha unchanged (alpha is scale-independent). [Source: AnnotationLayer.tsx; ARCHITECTURE-SPINE.md#AD-4]

5. **Contract change is additive + regenerated, not hand-authored (AD-3, AD-8).** `Style.alpha` is added to the Pydantic model; `server/openapi.json` + `client/src/api/schema.d.ts` are REGENERATED (the tracked `schema.d.ts` changes by exactly the new optional `alpha` field, nothing else); `docs/API.md` updated. The field is optional with a default → backward-compatible, no persisted-format break, no MAJOR bump. No `render/index.ts` export added (mock barrels untouched); `no-raw-values` green (`fill-opacity` is unitless; alpha-step token values live in `src/theme/**`). Pen create/select/recolor/restroke/delete (2.8), highlight/underline, pan, zoom-glue do not regress. [Source: ARCHITECTURE-SPINE.md#AD-3, #AD-8, #AD-9; CLAUDE.md#Versioning, #Contract-types, #Design-conventions]

## Tasks / Subtasks

- [ ] **Task 1 — `Style.alpha` field + contract regen (AC: 1, 5)**
  - [ ] `server/app/models.py`: add `alpha: float | None = None` to `Style` with a docstring (transparency 0..1; pen-relevant; `None` = render at the default). Optionally a Pydantic `Field(ge=0, le=1)` bound.
  - [ ] Regenerate: `cd server && PYTHONPATH= uv run python -m app.export_openapi`, then `cd client && npm run gen:api`. Commit the regenerated `server/openapi.json` (tracked fields) + `client/src/api/schema.d.ts`.
  - [ ] `docs/API.md`: update the annotation-model `Style` entry + changelog (the contract reference rule).
  - [ ] Backend test: a `Style`/`Annotation` round-trips with and without `alpha` (null default); an out-of-range alpha is rejected if a bound is added.

- [ ] **Task 2 — store: activeAlpha + realphaAnnotation (AC: 1, 2)**
  - [ ] `client/src/store/index.ts`: add `activeAlpha: number` (default = the highlighter opacity constant, e.g. `0.4`), `setActiveAlpha`, and `realphaAnnotation(ids, alpha, now)` — the alpha twin of `restrokeAnnotation`, guarded `a.anchor.kind === "path"` (alpha is pen-only in the UI; do not write it onto text marks). Document like the `activeStrokeWidth`/`restrokeAnnotation` comments.
  - [ ] Add `activeAlpha` to the `beforeEach` reset in `store/index.test.ts`; tests for `setActiveAlpha` + `realphaAnnotation` (incl. the non-path guard).

- [ ] **Task 3 — buildPenAnnotation writes alpha (AC: 1)**
  - [ ] `client/src/annotations/create.ts`: add `alpha: number` to `BuildPenOptions`; set `style.alpha` in the built mark. Test it.

- [ ] **Task 4 — AlphaRow component (AC: 2)**
  - [ ] `client/src/annotations/AlphaRow.tsx` (NEW): a step row of alpha levels mirroring `StrokeWidthRow` (`value: number` + `onPick(alpha)`; armed step shows the ink ring; each step's swatch previews its opacity via `opacity`/`fill-opacity`; keyboard-reachable; `data-testid="alpha-<value>"`). Export from `annotations/index.ts`. Step token values in `components.css`.
  - [ ] `AlphaRow.test.tsx`: renders the steps, arms `value`, `onPick` fires with the chosen alpha.

- [ ] **Task 5 — render + preview alpha (AC: 1, 3, 4)**
  - [ ] `client/src/annotations/AnnotationLayer.tsx`: the pen `<path>` gets `fillOpacity={a.style.alpha ?? PEN_DEFAULT_ALPHA}` (a small typed constant kept in sync with `--annotation-highlight-opacity`). Group stays full-opacity.
  - [ ] `client/src/annotations/AnnotationInteraction.tsx`: the live-preview path uses `fillOpacity={activeAlpha}`.
  - [ ] Layer test: a pen mark renders the expected `fill-opacity`; a null-alpha mark renders the default.

- [ ] **Task 6 — pen sub-toolbox + selection quick-box gain the alpha row (AC: 2)**
  - [ ] `client/src/ToolRail.tsx`: the pen `ToolFlyout` adds `<AlphaRow value={activeAlpha} onPick={…}/>` below color + width. Thread `activeAlpha`/`onPickAlpha` props (App owns them, store-backed).
  - [ ] `client/src/App.tsx`: subscribe `activeAlpha`/`setActiveAlpha`; pass to `ToolRail`. The create path reads `activeAlpha` (via the overlay's store read + a ref, like `activeColor`/`activeStrokeWidth`).
  - [ ] `client/src/annotations/AnnotationInteraction.tsx`: the pen selection quick-box adds the `AlphaRow` (realpha via `realphaAnnotation` + set default), alongside color + width + delete.
  - [ ] Tests: `ToolRail.test.tsx` (pen flyout shows the alpha row; pick fires `onPickAlpha` + closes), `AnnotationInteraction.test.tsx` (a new pen stroke stores `activeAlpha`; a selected pen mark's box shows the alpha row and realphas), `App.test.tsx` (alpha prop threads through).

- [ ] **Task 7 — regression bar + live smoke (AC: all)**
  - [ ] `cd client && npm test` + `npm run typecheck`; `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q`. The tracked `schema.d.ts` diff is EXACTLY the new `alpha` field (expected this story). `no-raw-values` green.
  - [ ] **Live smoke (own fresh servers per CLAUDE.md; real PDF at DPR>1):** (a) arm Pen → the sub-toolbox shows color + width + alpha; (b) draw → the stroke is semi-transparent at the default (visibly like a highlighter, text shows through); (c) change alpha arm-time → the next stroke uses it; (d) select a stroke → its quick-box has the alpha row; pick a different alpha → it re-alphas live; (e) zoom → alpha unchanged, stroke glued; (f) confirm color + width still work and highlight/underline/pan unaffected. Capture a screenshot.

- [ ] **Task 8 — docs + version (AC: all)**
  - [ ] `docs/API.md` updated (Task 1). `client/src/annotations/README.md`: note pen's third style axis (alpha) — stored on `Style.alpha`, rendered as per-path `fill-opacity`, default = highlighter opacity, adjustable via the `AlphaRow` in the pen sub-toolbox + selection quick-box.
  - [ ] Version: PATCH +1 at done (`server/pyproject.toml` `0.1.5 → 0.1.6`).

## Dev Notes

### What this adds vs reuses

| Need | Reuse | New |
| --- | --- | --- |
| Style field + contract | the generated `Style` (regen flow, AD-3) | `alpha: float | None` on Pydantic `Style` |
| Sticky session default | `activeColor`/`activeStrokeWidth` pattern | `activeAlpha` + `setActiveAlpha` |
| Restyle a selected mark | `recolorAnnotation`/`restrokeAnnotation` | `realphaAnnotation` (kind=path guarded) |
| Step-row control | `ColorSwatchRow`/`StrokeWidthRow` | `AlphaRow` |
| Sub-toolbox / quick-box | the pen `ToolFlyout` + the pen selection quick-box (2.8) | add the alpha row to both |
| Render | the pen `<path>` (2.8) | `fillOpacity` per path; preview uses `activeAlpha` |

Resist: a group-level pen opacity (must be per-stroke, Decision 4); hand-editing `schema.d.ts` (regenerate); writing `alpha` onto text marks (pen-only UI); a bespoke slider (use the step row for consistency).

### Integration points

- `server/app/models.py` — `Style` (add `alpha`). [models.py]
- `server/openapi.json` + `client/src/api/schema.d.ts` — REGENERATED, not hand-edited.
- `client/src/store/index.ts` — `activeStrokeWidth`/`restrokeAnnotation` (~lines 62-130) are the template for `activeAlpha`/`realphaAnnotation`.
- `client/src/annotations/create.ts` — `buildPenAnnotation` `BuildPenOptions` (add `alpha`).
- `client/src/annotations/AnnotationLayer.tsx` — the pen `renderPen` `<path>` (add `fillOpacity`).
- `client/src/annotations/AnnotationInteraction.tsx` — the pen create call (pass `alpha`), the live-preview `<path>` (`fillOpacity`), the pen selection quick-box body (add `AlphaRow`), a new `realphaSelected` (twin of `restrokeSelected`), `activeAlphaRef`.
- `client/src/ToolRail.tsx` — the pen `ToolFlyout` (add `AlphaRow`; thread `activeAlpha`/`onPickAlpha`).
- `client/src/App.tsx` — subscribe + pass `activeAlpha`/`setActiveAlpha`.
- `client/src/theme/components.css` — alpha-step token values. `client/src/annotations/Annotations.css` — `.alpha-row`/`.alpha-step` styles (mirror stroke-width-row).

### Engineering conventions (CLAUDE.md)

- **Generated contract (AD-3):** edit Pydantic → regen → never hand-author `schema.d.ts`. This is the FIRST Epic-2 contract change; the tracked `schema.d.ts` diff is expected (the new `alpha` field only). Update `docs/API.md` in the same change.
- **Additive/backward-compatible (AD-8):** optional field with a default → no MAJOR bump; pre-2.13 marks read back fine (null → default alpha).
- **Adopt-stable / one model:** reuse the color/width seams; one `activeAlpha`, no parallel state. [[prefer-stable-solutions]]
- **No em-dash in UI strings; tokens not raw values** (`fill-opacity` is unitless; alpha-step token values live in `src/theme/**`). [[no-emdash-user-facing]]
- **HiDPI live smoke** at DPR>1 (alpha is a visual change; confirm it reads like the highlighter). [[verify-on-hidpi-and-real-host]]
- **Cross-model code review** after dev-story.

### Versioning

- PATCH +1 at done: `server/pyproject.toml` `0.1.5 → 0.1.6` (single source).

### References

- [Source: .bmad/planning-artifacts/epics.md#Story-2.13] — story + the three ACs (default = highlighter alpha; adjustable arm-time + selected; preserved across zoom).
- [Source: ARCHITECTURE-SPINE.md#AD-5] — `type`/`style` vs `anchor.kind`; `style` is field-scoped (alpha is a style axis, geometry unchanged).
- [Source: ARCHITECTURE-SPINE.md#AD-3] — Pydantic is the single contract source; client types generated, never hand-authored.
- [Source: ARCHITECTURE-SPINE.md#AD-8] — additive optional field is backward-compatible (no persisted-format break / MAJOR bump).
- [Source: .bmad/implementation-artifacts/2-8-pen-freehand.md] — the pen create/render/sub-toolbox/selection seams alpha extends; `restrokeAnnotation`/`StrokeWidthRow`/`activeStrokeWidth` are the exact twins.
- [Source: CLAUDE.md#Versioning, #Contract-types, #Design-conventions, #Engineering-principles].

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

## Change Log

- 2026-06-29: Story created (ready-for-dev) via correct-course + create-story (user feature request: pen stroke alpha).
