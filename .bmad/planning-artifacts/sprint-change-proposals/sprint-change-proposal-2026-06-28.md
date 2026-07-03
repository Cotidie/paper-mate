# Sprint Change Proposal — Story 1.5 (Zoom) Follow-ups

**Date:** 2026-06-28
**Trigger story:** `1-5-zoom` (status: in-progress, post code-review)
**Author:** Wonseok (via correct-course)
**Mode:** Batch
**Scope classification:** Moderate → Developer (dev-story review-continuation)

## 1. Issue Summary

After Story 1.5 (Zoom) reached `review`, seven follow-up items were identified:

- **4 from the Senior Developer (AI) code review** — 1 High, 3 Low.
- **3 from user testing** — placement, step granularity, focal point.

All are corrections/refinements to the shipped zoom feature. No new epic, no architecture change, client-only.

### Evidence

- **Code review (Changes Requested):** keyboard/wheel handlers attached only to `.pdf-canvas`, bypassed once a zoom-control button has focus (browser zoom can fire) [HIGH]; missing button hit-size token [LOW]; `deltaY === 0` Ctrl-wheel zooms out [LOW]; `aria-label="Fit to width"` hides the live `%` from assistive tech [LOW].
- **User #1:** the bottom-right floating pill overlaps/obstructs the PDF reading area; move it into the top bar, left of the ToC button.
- **User #2:** `Ctrl+scroll` step too coarse — jumps 250% → 315% (the multiplicative ×1.25 step grows with zoom). Wants ~10%/notch.
- **User #3:** zooming does not preserve the focal point — content drifts instead of zooming about the cursor / current position.

## 2. Impact Analysis

- **Epic Impact:** Epic 1 unaffected; still completable. Story 1.5 remains the unit of work.
- **Story Impact:** Story 1.5 ACs revised (AC-1, AC-2, AC-3) + one new AC (AC-5 focal point); scope-guard relaxed; tasks added.
- **Artifact Conflicts:** User #1 **overrides UX-DR10** ("`{component.zoom-control}` bottom-right pill"). EXPERIENCE.md (lines 32, 65) and epics.md (line 100) updated to "top bar, left of ToC."
- **Technical Impact:** `Reader.tsx`, `ZoomControl.tsx`, `App.tsx` (zoom state/control lifted into the top bar), `render/index.ts` (wheel step + focal-point math), `theme/components.css` + `App.css` (top-bar control styling, hit-size token). Client-only; no backend/contract/`docs/API.md` change.

## 3. Recommended Approach

**Direct Adjustment** — fold all 7 items into Story 1.5 and implement via `dev-story` in review-continuation mode. No rollback (the shipped work is sound; these are additive corrections). Effort: ~1 focused dev pass. Risk: low (well-scoped, client-only, covered by tests).

## 4. Detailed Change Proposals

### 4.1 Story 1.5 — Acceptance Criteria

**AC-1 (revise):**
> OLD: keyboard zoom via `Ctrl +/-/0` (works on the focused canvas).
> NEW: `Ctrl +` / `Ctrl -` / `Ctrl 0` zoom regardless of which reader control has focus (canvas **or** the zoom control); browser native zoom never fires. [fixes HIGH]

**AC-2 (revise):**
> NEW: `Ctrl+scroll` / pinch zoom works over the whole reader (incl. the control); the wheel step is **finer than the keyboard step** (≈10%/notch, multiplicative ×1.1); a `deltaY === 0` Ctrl-wheel event does nothing; plain scroll still scrolls. [fixes LOW deltaY; user #2]

**AC-3 (revise):**
> OLD: bottom-right `{component.zoom-control}` pill mirrors keyboard.
> NEW: the zoom control sits in the **top bar, immediately left of the ToC button** (`−` / live `%` / `+`), mirrors keyboard + wheel with live `%`; buttons have a tokenized hit-size; the current `%` is exposed to assistive technology. **Supersedes UX-DR10's bottom-right placement.** [user #1; fixes LOW hit-size + LOW aria]

**AC-4 (unchanged):** single-`scale` invariant; the top-bar control is normal chrome and consumes no canvas width (NFR-1 holds).

**AC-5 (new):**
> Zoom preserves the focal point: the document point under the cursor (wheel) or the viewport center (keyboard + buttons) stays fixed across a zoom step, by compensating the scroll position. This remains a single `scale` (the scroll adjustment is layout arithmetic, not a second scale/offset), so the AC-4 invariant is preserved. [user #3]

### 4.2 Story 1.5 — Scope-guard revision

> REMOVE: "Do not add window-level/global key listeners — extend the existing canvas `handleKeyDown`." (The High finding proves a canvas-only handler is insufficient once the control takes focus.)
> ADD: a stage- or document-level keyboard handler is permitted, guarded to when a document is open. Scroll-position compensation in `Reader` is permitted (focal point). Still: no second scale/offset variable, do not mutate the scale-1.0 page box, do not replace the lazy paint.

### 4.3 Story 1.5 — New tasks (Review Follow-ups)

Merge the 4 review action items with the 3 user requests as `[AI-Review]`/follow-up tasks:

1. [HIGH] Make zoom shortcuts focus-independent — lift the key handler to a stage/document owner; wheel listener covers the reader (not just `.pdf-canvas`).
2. Relocate `ZoomControl` into the top bar left of ToC (lift `scale`/zoom commands to `App` or portal it); restyle as top-bar chrome (drop the floating-card tokens).
3. Wheel step `ZOOM_WHEEL_STEP ≈ 1.1` (keyboard/buttons stay ×1.25); guard `deltaY === 0`.
4. Focal-point scroll compensation: cursor point for wheel, viewport center for keyboard/buttons; extract the pure math into a tested `render/` helper.
5. Button hit-size token + rules; expose the live `%` to AT (remove the overriding `aria-label`, use visible text + `aria-live`/`role="status"`).
6. Tests: shortcuts dispatched from the control (not only `reader-backdrop`); hit-size assertions; focal-point math unit test; AT-percent test.

### 4.4 UX spec edits (record the UX-DR10 override)

- **epics.md:100** — UX-DR10 → "top bar, left of the ToC button" (was "bottom-right pill").
- **EXPERIENCE.md:32, :65** — zoom-control placement → top bar.

## 5. Implementation Handoff

- **Scope:** Moderate (AC changes + UX-spec override + small refactor of where zoom state/control live).
- **Route to:** Developer — `dev-story 1-5` (review-continuation; the story already carries the Senior Developer Review section).
- **Success criteria:** all 7 items resolved; AC-1..AC-5 satisfied; the 4 review action items checked; UX-DR10 docs updated; full frontend suite green with added tests (focus-path shortcuts, hit-size, focal-point math, AT percent); live smoke confirms top-bar control + focal-point zoom + ~10% wheel step.
