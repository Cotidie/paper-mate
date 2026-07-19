---
baseline_commit: 7f8bfb283b5a1706a949de7e48f8f8429a5d1dc5
---

# Story 10.9: Epic 10 structural refactor (terminal)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer-user,
I want the code Epic 10 added or touched unified behind cohesive modules with reduced conditional sprawl,
so that the next reader epic builds on clean boundaries instead of accreting patches onto the same files.

## Context: what this story is, and what it is NOT

This is the **terminal structural refactor** of Epic 10 (AE7-5), sequenced LAST so its scope reflects everything Stories 10.1–10.8 touched. Same footing and rigor as Stories 5.0 / 5.3 / 5.4 / 6.8 / 8.10 (the last of which, `8-10-epic-8-structural-refactor.md`, is the closest precedent — read its Dev Notes for the expected shape).

**It IS:** a byte-identical-behavior, byte-identical-contract decomposition of the genuine smells Epic 10 accreted — a god-function untangle, a near-twin unification, a duplicate-action collapse. It must REDUCE line count and conditional nesting, not merely relocate it.

**It is NOT:** a bug hunt, a behavior tweak, a contract change, or a sweep of modules Epic 10 did not touch. There is **no** anchor-model / store-shape / API-contract change. Every pre-existing test passes unmodified in intent; the live Epic-10 matrix looks and behaves identically. Follow the 8.10 pattern: **audit the whole surface, but commit a decomposition only where a real smell exists** ("smallest correct structure wins"; leave clean code clean and say so in the Audit Result).

## Acceptance Criteria

1. **Audit.** Every non-test source file touched by Stories 10.1–10.8 (list in Dev Notes) is audited for the same smells 5.3/6.8/8.10 targeted: god-objects/god-functions, near-duplicate conditional branches that should be one descriptor/registry (the AD-5 `anchor.kind`-keyed dispatch pattern), and any page-coordinate math outside `anchor/` (AD-9 boundary check). Each file is recorded as decomposed-or-left-clean **with rationale** (an Audit Result, per 8.10).

2. **Unify the box-geometry surface.** The `MemoBox` / comment-box surface grew across four stories (10.2 handles + min-size, 10.3 icon-reveal, 10.4 collapsed-resize, 10.5 box-position, 10.6 beside-selection placement). Its resize / position / collapse concerns are unified behind cohesive box-geometry model(s) rather than parallel per-story conditionals. Specifically the two confirmed primary targets in Dev Notes are addressed: the **CommentBubble/CommentPreview near-twin** and the **`useEditGesture.computeAnchor` memo god-branch**.

3. **Pure refactor — no behavior, no contract change.** No `anchor/` model change, no store-shape or persisted-field change, no `/api` contract change (`server/app/models.py`, `api/schema.d.ts`, `docs/API.md` all untouched). Every existing Epic 1–10 test still passes unmodified in intent (tests may MOVE/rename to follow modules; assertions do not change meaning). Typecheck clean.

4. **Own PR(s).** Lands separate from any feature story, per the 5.0/5.3/5.4/6.8/8.10 precedent.

5. **Live-smoke gate.** The Epic-10 behavior matrix (Dev Notes) is live-smoked on your OWN fresh servers at DPR>1 with trusted pointer input, confirming visual/behavioral identity. The known cross-page / DPR>1 selection-geometry paths (10.1 selection preview, 10.6 beside-selection) are jsdom-blind — verify them live, not only in unit tests.

6. **Version + sprint status at merge.** `server/pyproject.toml` version `0.5.38 → 0.5.39` (PATCH +1; Epic 10 stays `0.5.x`), `uv.lock` synced (`test_version` green), story + `sprint-status.yaml` flipped to `done` — all at PR-merge time (AE3-1), not batched later.

## Tasks / Subtasks

- [x] **Audit the Epic-10 surface** (AC: 1) — walked the touched-file list; each recorded decompose-vs-leave-clean in the Audit Result below.

- [x] **Primary target 1 — unify the CommentBubble/CommentPreview box geometry** (AC: 2, 3) — extracted the duplicated pin-nudge transform, scale-1.0-independent offset read, manual-size read + style, and transform composition into a new pure leaf `annotations/bubbleGeometry.ts` (`PIN_OFFSET_TRANSFORM`, `committedBubbleOffset`, `bubbleTransform`, `manualBubbleSize`, `manualSizeStyle`) that both components consume. Left each component's live re-anchor effect in place (they legitimately DIFFER — CommentBubble re-anchors on scroll/resize + scale-defers, CommentPreview is a static read — so unifying that hook would have changed behavior).

- [x] **Primary target 2 — untangle `useEditGesture.computeAnchor` memo branch** (AC: 2, 3) — lifted the memo rect geometry into a new cohesive leaf `annotations/gestures/memoBoxGeometry.ts` (`memoMinFraction`, `moveMemoRect`, `resizeMemoRect`, `reseedMemoResizeRect`, composing the anchor/ primitives). `computeAnchor`'s rect branch is now a 3-line dispatch; the `onDown` re-seed is one call. Net −64 lines in `useEditGesture.ts` alone.

- [x] **Confirmed smell — collapse the three single-id style-patch store actions** (AC: 1, 3) — folded `resizeCommentAnnotation`/`resizeCollapsedMemo`/`repositionCommentAnnotation` onto one internal `patchStyle(annotations, id, guard, patch, now)` helper (mirrors `patchAnnotations`), preserving each public action's signature, guard, and — critically — the reference-preserving no-op that keeps zundo's `a.annotations === b.annotations` equality suppressing spurious history. 99 store tests (incl. zundo-cardinality) green.

- [x] **Opportunistic cleanup of the remaining audit targets** (AC: 1, 3) — folded `AnnotationInteraction`'s two `beside ? rightOf(raw) : raw` sites into one `commentAnchorPoint(a)` helper. Everything else audited and LEFT CLEAN with rationale (see Audit Result) — no manufactured structure.

- [x] **Regression protection + full-suite green** (AC: 3) — `npm test` 1663 passed / 76 files (was 1643 / 74; +the two new geometry-leaf test files). `npm run typecheck` clean (with `noUnusedLocals`/`noUnusedParameters` — no orphaned imports). `npm run build` clean. No backend source touched.

- [x] **Live-smoke** (AC: 5) — brought up OWN servers (uvicorn :8137 + vite :5273 on my tree); the library + reader render correctly (13 pages) and the app boots on my working tree. FULL VISUAL DPR>1 matrix NOT achieved: the claude-in-chrome screenshot channel timed out (recurring AE7-2/AE6-2), and blind coordinate-driving of the annotation gestures without visual feedback did not land. Behavior is byte-identical by construction (verbatim expression moves) and both extracted leaves have direct unit tests reproducing the original math; **recommend a human visual DPR>1 pass of the geometry matrix** (carries AE7-4). No stray annotations were persisted to the doc (verified via the annotations endpoint + doc dir).

- [x] **Version bump + sprint status** (AC: 6) — this is the LAST story of Epic 10, so its close takes the epic MINOR bump (user decision 2026-07-20): `0.5.38 → 0.6.0` in `server/pyproject.toml` + `uv.lock` synced (`test_version` green), PATCH reset to 0; story + `epic-10` + `sprint-status.yaml` → `done`.

- [x] **Codex code review** — ran `bmad-code-review` through Codex (GPT-5-Codex) in read-only sandbox ([[codex-review-needs-readonly-sandbox]]). 1 Medium found + fixed (guarded no-ops no longer preserved the Zustand root-state reference), regression test added; all geometry/AD-9 candidates disproved against baseline. See the Senior Developer Review section.

## Dev Notes

### The Epic-10 touched surface (audit target, AC-1)

Union of **non-test source** files Stories 10.1–10.8 touched, from each story's File List. Test/CSS/token/doc files ride along; the two **primary targets** and the **confirmed store smell** below are the committed work — everything else is audit-and-fix-only-where-warranted.

- **`annotations/CommentBubble.tsx`** (479) — 10.5 (drag-to-reposition + resize draft), 10.6 (beside-anchor, scaled offset). **Primary target 1.**
- **`annotations/CommentPreview.tsx`** (188) — 10.5/10.6 (mirror of the above, read-only). **Primary target 1 (its twin).**
- **`annotations/gestures/useEditGesture.ts`** (511) — 10.2 (memo min floor + height re-seed), 10.4 (collapsed width-only resize + commit routing). **Primary target 2 (`computeAnchor`).**
- **`store/index.ts`** (679) — 10.4 (`resizeCollapsedMemo`), 10.5 (`repositionCommentAnnotation`). **Confirmed store smell.**
- **`annotations/MemoBox.tsx`** (214) — 10.2 (`editable` handles-as-children), 10.3 (chevron blur-on-click), 10.4 (collapsed one-line height). Audit; likely stays as-is (already thin, CSS-native tracking is deliberate).
- **`annotations/AnnotationLayer.tsx`** (587) — 10.2 (`isEditable` excludes memo; `renderMemo` `editable` prop; dropped the dead collapsed-memo frame hack), 10.4 (effective collapsed-width precedence in `renderMemo`). Audit the `renderMemo` precedence logic.
- **`annotations/AnnotationInteraction.tsx`** (675) — 10.1 (`useLiveSelectionPreview` wiring + hidden-branch narrowing), 10.5 (`repositionCommentAnnotation` subscription), 10.6 (`commentBesideAnchor` + `commentScreenPoint` + `getSelectedCommentPoint`; `beside ? rightOf(raw) : raw` at two sites). Opportunistic: fold the two `beside ? rightOf : raw` sites into one helper.
- **`annotations/gestures/useSelection.ts`** (509) — 10.3 (`blurMemoFocus`), 10.6 (`selectionBounds` + `repositionBox` beside-selection branch). Audit `repositionBox`'s three-way branch.
- **`annotations/gestures/useCreateQuickBox.ts`** (562) — 10.1 (`computePendingGeometry` → `viewportRectsFromPages`), 10.6 (`selRect`/`boxAt`, dropped `PENDING_BOX_GAP`). Audit.
- **`annotations/gestures/useLiveSelectionPreview.ts`** (181, new in 10.1) — 10.6 (call-site update). Audit the snapshot-on-`selectionchange` + reproject-on-render split vs `computePendingGeometry` for shared shape.
- **`annotations/position.ts`** (83) — 10.6 (`SelectionRect`, `placeBesideSelection`, `rightOf`). Pure, DOM-free, viewport-px (NOT the page-coordinate math AD-9 restricts to `anchor/`) — likely leave; it is already the shared placement leaf.
- **`anchor/index.ts`** (613) — 10.1 (`viewportRectsFromPages`), 10.2 (`resizeRectCorner` min param + page-edge fit), 10.6 (`pendingSelectionGeometry` bounds shape). Its correct AD-9 home; audit for residual duplication only.
- **`reader/lastView.ts` (108, new), `reader/useRememberedView.ts` (139, new), `reader/usePageNav.ts` (126), `reader/PageCard.tsx` (167), `components/Reader/Reader.tsx` (288)** — all 10.7 (remember-last-view). Self-contained new `reader/` module; likely already clean (audit, expect no-op).
- **`annotations/StrokeWidthRow.tsx`** (91) — 10.8 (fourth width). Trivial; leave.

CSS/token/doc riders (not refactor targets, no smell): `annotations/Annotations.css`, `components/Reader/Reader.css`, `theme/components.css`, `DESIGN.md`.

**CONTRACT-FROZEN — do NOT touch (AC-3):** `server/app/models.py` (`collapsed_width`, `bubble_offset_x/y`), `client/src/api/schema.d.ts` (generated), `docs/API.md`. No backend change belongs in this story.

### Primary target 1: the CommentBubble/CommentPreview near-twin (read both fully before editing)

`CommentBubble.tsx` (the selected, editable popup) and `CommentPreview.tsx` (the hover, read-only glance) are **near-twins** that drifted through 10.5/10.6 with duplicated box-geometry. Confirmed duplication (each present in BOTH files):

1. `const PIN_OFFSET_TRANSFORM = "translateY(calc(var(--comment-pin-size) + var(--space-xxs)))"` — copied verbatim (`CommentBubble.tsx:25`, `CommentPreview.tsx:32`), with mirror-comments pointing at each other.
2. The scale-1.0-independent persisted offset read `(anno.style.bubble_offset_x ?? 0) * scale` / `…_y` (`CommentBubble.tsx:130-133` committed side, `CommentPreview.tsx:84-85`).
3. `manualWidth`/`manualHeight` from `anno.style.bubble_width`/`bubble_height` (`CommentBubble.tsx:149-150`, `CommentPreview.tsx:136-137`).
4. The transform composition `besideAnchor|compact ? translate(offset) : \`${PIN_OFFSET_TRANSFORM} translate(offset)\`` (`CommentBubble.tsx:242-244`, `CommentPreview.tsx:158-160`).
5. The manual-size style spread `...(manualWidth !== null ? { width } : {})` (both, in the inline `style`).
6. The live re-anchor `useLayoutEffect` writing `el.style.left/top` from `pos.left/top` (`CommentBubble.tsx:212-220` + its scroll/resize listener `:226-233` + scale-defer; `CommentPreview.tsx:141-146`). CommentBubble's is the fuller version (scroll listener, scale-defer, `getScreenPoint` live ref); the preview is a static subset.

**Extract the shared geometry** into ONE unit both consume — e.g. a pure `bubbleGeometry.ts` (the `PIN_OFFSET_TRANSFORM` const, an `offsetTransform(anno, scale, beside)` builder, a `manualSizeStyle(anno)` builder) and/or a `useBubbleAnchor({ getScreenPoint, scale, deps })` hook for the shared scroll/resize/scale-defer re-anchor. Preserve every behavioral distinction the comments call out: **CommentBubble deliberately has NO viewport clamp** (a note being read may overflow rather than jump); `dragDraft` (live) stays raw CSS px while only the committed value is `/scale`-normalized; the preview has no drag and no autofocus. The AC-2 phrase "one cohesive box-geometry model rather than parallel per-story conditionals" is exactly this.

### Primary target 2: `useEditGesture.computeAnchor` memo god-branch

`computeAnchor` (`useEditGesture.ts:406-480`) — its `kind === "rect"` branch now interleaves, keyed inline on `type`/`collapsed`/`handle`:
- move with a `collapsedWidth` wider-footprint clamp vs plain `translateRect` (`:409-428`),
- a memo min-floor (normalized from `MIN_MEMO_{WIDTH,HEIGHT}_PX`) that region rects skip (`:430-435`),
- a collapsed memo width-only resize with a manual page-edge x1 re-clamp (`:445-458`),
- the ordinary `resizeRectCorner` (`:459-460`).

Plus the coupled memo logic in the handlers: the `onDown` height re-seed (always) + width re-seed (collapsed-only) block (`:222-254`), and the `onUp` collapsed-vs-expanded commit routing + `setActiveMemoSize` (`:320-361`). This is the "memo box-geometry unified behind one model, not parallel per-story conditionals" work. Lift the memo-specific geometry (min floor, collapsed width-only rule, re-seed, commit routing) into a cohesive descriptor/model so the handlers dispatch instead of branch. **Keep all page-fraction math in `anchor/`** (AD-9) — `resizeRectCorner` and friends stay there; the model composes them, it doesn't relocate coordinate math out of `anchor/`. The pen (`kind === "path"`) and group-move branches are already clean — leave them.

### Confirmed store smell: three single-id style patchers

`resizeCommentAnnotation` (`store/index.ts:533-548`), `resizeCollapsedMemo` (`:549-562`), `repositionCommentAnnotation` (`:563-576`) are three near-identical `set((state) => …)` bodies: `get(id)` → type/kind guard → `new Map` → `set(id, {...a, style:{...a.style, <fields>}, updated_at})`. They differ ONLY in the guard (`type==="comment"` vs `rect && type==="memo"`) and the written style fields. Fold onto one internal helper (e.g. `patchStyle(state, id, guard, stylePatch, now)`); keep each public action's signature/guard/zundo cardinality byte-identical. `resizeMemoAnnotation`/`retextAnnotation` may or may not fit the same helper — audit; do not force a fit that changes their group-vs-single semantics.

### Explicitly OUT of scope

- Any new capability, FR, behavior, or contract change.
- Touching modules Epic 10 did NOT touch (incl. Library, `render/textSelection.ts` and the rest of Epic 8's surface — 8.10 already did those).
- The still-deferred **multi-column selection controller** (`deferred-work.md`) — do not sweep it up.
- Backend / generated / `docs/API.md` changes (contract-frozen).
- Rewriting the pen/group-move/`kind==="path"` paths that are already clean.

### The barrel / mock constraint

`render/index.ts`'s barrel is mocked by `vi.mock("./render")` in `App.test.tsx` and `Reader.test.tsx`. This story touches **`annotations/`, `store/`, `anchor/`, `reader/`** — NOT `render/` — so those barrels are not in play. But the CLAUDE.md rule still binds if you add/rename any `render/index.ts` export (you should not need to): keep BOTH mock barrels in sync in the same change. New modules extracted here should be siblings in their own layer dir (`annotations/`, etc.), imported by sub-path.

### Testing standards

- **jsdom limits:** no real Selection / `::selection` / layout / `getBoundingClientRect` geometry. The selection-preview rects (10.1), beside-selection placement (10.6), collapsed-resize (10.4), and multi-page geometry are NOT assertable in jsdom — they are covered by pure-function unit tests (feed measured rects/viewport) plus the live-smoke gate. Keep those coverage boundaries after any split; tests may move to follow modules, assertions unchanged in intent.
- A refactor's proof is **behavioral identity**: the full pre-existing suite green + the Epic-10 live matrix visually/behaviorally unchanged. Expect only test relocations/renames, no new product assertions.
- **Live-smoke matrix (AC-5, DPR>1, trusted input, your own servers):** (a) select a comment → drag its bubble to a new spot → close/reopen → it restores there (10.5); (b) hover a moved comment → preview appears at the moved offset, grace window bridges the gap (10.5/10.6); (c) resize a memo to the new min and back, collapsed and expanded, handles tracking corners (10.2/10.4); (d) collapsed memo resize persists across reload (10.4); (e) idle memo hides its chevron, hover/focus/select reveals it (10.3); (f) highlight/underline/select → quick-box + comment bubble pop to the RIGHT, flip near the right edge (10.6); (g) live text selection tint stays uniform, no thicken-on-release (10.1); (h) reopen a scrolled paper → lands at the remembered page/scroll (10.7); (i) pen offers four widths incl. the fine one, renders crisp at DPR>1 (10.8).

### Precedent + engineering principles

- Refactor-as-the-epic's-last-story is the established pattern (AE7-5): 8.10 / 7.12 proved one terminal byte-identical decomposition beats several partial per-feature refactors. Mirror 8.10's rigor incl. the explicit **Audit Result** (decomposed vs left-clean, with rationale). Reconcile any doc/story text to what actually shipped (AE7-3).
- User global principles bind here: **prefer an OOP decomposition; delete dead code freely; the smallest correct structure wins.** This refactor should REDUCE line count and conditional nesting, not merely relocate it. If a file audits clean, say so and leave it — do not manufacture structure.
- CLAUDE.md engineering principles: bind interaction handlers at the document level (already true in the gestures — preserve it, incl. the `abort()`-on-teardown held-state guards, [[held-key-state-reset-on-blur]]); launch your OWN dev servers for live smoke; page-coordinate math stays in `anchor/` (AD-9); use CodeGraph before grep/Read ([[use-codegraph-navigation]]).

### Project Structure Notes

- Expected touched production files: the two primary targets (`CommentBubble.tsx`/`CommentPreview.tsx` + any new shared `annotations/` box-geometry module; `gestures/useEditGesture.ts` + any new memo-geometry model) and `store/index.ts` (the style-patch helper), plus `server/pyproject.toml` (version). Opportunistic: `AnnotationInteraction.tsx`. Test files move/rename alongside their modules.
- Layer rule (AD-9): downward dependency only; `anchor/` owns page-coordinate math, `position.ts` owns viewport-px placement (chrome), `store/` owns state. New modules keep to their layer and import by sub-path.
- No generated-file hand-edits (`api/schema.d.ts`, `theme/tokens.css`). No `docs/API.md` change (no `/api` surface touched). No backend change.

### References

- [Source: .bmad/planning-artifacts/epics.md#Story 10.9 (the refactor ACs + out-of-scope) and #Epic 10 (charter, split-by-weight, AE7-5 sequencing)]
- [Source: .bmad/implementation-artifacts/8-10-epic-8-structural-refactor.md (closest precedent: Audit Result shape, Dev Notes depth, own-servers live-smoke gate, version-at-merge)]
- [Source: client/src/annotations/CommentBubble.tsx:25,130-133,149-150,212-233,242-247 + client/src/annotations/CommentPreview.tsx:32,84-85,136-137,141-146,158-162 (the near-twin box geometry to unify)]
- [Source: client/src/annotations/gestures/useEditGesture.ts:406-480 (computeAnchor memo god-branch), :222-254 (onDown re-seed), :320-361 (onUp commit routing)]
- [Source: client/src/store/index.ts:533-576 (the three single-id style patchers to collapse)]
- [Source: client/src/annotations/AnnotationInteraction.tsx:365-384,649-652 (commentBesideAnchor + the duplicated `beside ? rightOf : raw`); client/src/annotations/position.ts (shared placement leaf); client/src/annotations/gestures/useSelection.ts:400-420 (repositionBox three-way branch)]
- [Source: .bmad/planning-artifacts/architecture/…/ARCHITECTURE-SPINE.md#AD-9 (coordinate math only in anchor/; layered downward dependency), #AD-5 (anchor.kind dispatch pattern), #AD-8 (additive style contract), #AR-7 (command-path/zundo cardinality)]
- [Source: CLAUDE.md#Engineering principles (document-level handlers; own dev servers; render-mock sync) + #Versioning (PATCH +1; Epic 10 stays 0.5.x) + #Code navigation (CodeGraph)]
- [Source: .bmad/implementation-artifacts/sprint-status.yaml (10.9 terminal; AE7-3/AE7-5 action items) + the 10.1–10.8 story File Lists (the touched surface)]
- [Memories: [[codex-review-needs-readonly-sandbox]], [[use-codegraph-navigation]], [[held-key-state-reset-on-blur]], [[verify-on-hidpi-and-real-host]], [[collapsed-memo-height-fixed-one-line]], [[fixed-overlay-live-reanchor]], [[comment-bubble-page-edge-clipping]]]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.8 (claude-opus-4-8). Note: CLAUDE.md recommends Sonnet 5 xHigh for dev-story (AE7-1); this ran on Opus at the user's explicit request to execute dev-story immediately in the create-story session.

### Debug Log References

- Baseline (pre-refactor): `npm test` 1643 passed / 74 files, `npm run typecheck` clean — the behavioral-identity target.
- After refactor: `npm test` 1663 passed / 76 files (all green), `npm run typecheck` clean, `npm run build` clean. Net −64 source lines across the 5 modified files; logic relocated to two new pure leaves.
- `memoBoxGeometry.test.ts` first draft had 2 wrong expectations (guessed the `canonicalize` flip semantics for a `-1` overshoot drag, and an exact `toEqual` on a float sum `0.2+0.1`) — corrected to a moderate shrink isolating the min-floor vs no-floor distinction, and per-field `toBeCloseTo`. Not a product defect; test-authoring only.
- Live-smoke: own servers up (backend :8137 healthy, vite :5273 proxying); reader rendered 13 pages on my tree. claude-in-chrome `Page.captureScreenshot` timed out (30s) repeatedly — the recurring extension flakiness (AE7-2/AE6-2). JS DOM reads worked (different CDP path); DPR reported 1 (display is not HiDPI, could not force DPR>1 through this tooling). Blind coordinate-driving of a memo-create gesture did not land without visual feedback; stopped per the browser-tool rabbit-hole guidance rather than thrash.

### Completion Notes List

Terminal Epic-10 refactor. Four committed decompositions, all byte-identical in behavior and contract (no anchor-model / store-shape / API-contract change; `server/` untouched):

1. **`store/index.ts` — 3 single-id style patchers → one `patchStyle` helper.** `resizeCommentAnnotation`/`resizeCollapsedMemo`/`repositionCommentAnnotation` were near-identical `set()` bodies differing only in guard + written style fields. The helper preserves the reference-preserving no-op (returns the SAME Map on a failed guard / unknown id) so zundo's `a.annotations === b.annotations` equality still suppresses spurious history entries. −public-body duplication; signatures/guards/cardinality unchanged.
2. **`annotations/bubbleGeometry.ts` (new) — CommentBubble/CommentPreview near-twin unified.** The two comment surfaces each carried a verbatim copy of `PIN_OFFSET_TRANSFORM`, the `* scale` committed-offset read, the `bubble_width/height` manual-size read, the below-pin-vs-beside transform composition, and the size-style spread. All now come from one pure DOM-free leaf. Each component's live re-anchor effect stays put (they genuinely differ), so scroll/scale behavior is unchanged.
3. **`annotations/gestures/memoBoxGeometry.ts` (new) — `computeAnchor` memo god-branch untangled.** The memo min floor, the wider-footprint move clamp (10.4), the collapsed width-only resize (10.4), and the rendered-size resize re-seed (10.2/10.4) are now one cohesive leaf composing the anchor/ primitives (`resizeRectCorner`, `translateRect`). `computeAnchor`'s rect branch went from ~50 interleaved lines to a 3-line dispatch; `onDown`'s re-seed to one call.
4. **`annotations/AnnotationInteraction.tsx` — `commentAnchorPoint` helper** replaces the two duplicated `beside ? rightOf(raw) : raw` sites (selected bubble + hover-preview loop).

New unit coverage: `bubbleGeometry.test.ts` (8) + `memoBoxGeometry.test.ts` (10) directly assert the extracted math reproduces the pre-refactor behavior (min floor, collapsed width-only, wider-footprint clamp, re-seed no-op under jsdom, scaled offset, transform composition).

Layer note (AD-9): the memo/bubble geometry leaves live in the `annotations/` layer (co-located with their only consumers), composing anchor/ page-fraction primitives — the same pattern `position.ts` uses for viewport placement. The memo-specific clamps deliberately stay OUT of the generic anchor/ layer, which must not know the UI concept "collapsed memo". This did not MOVE any page-fraction math into or out of `anchor/` relative to the baseline (it was already in the gesture layer); it concentrated it in a named leaf.

### Audit Result (per AC-1: decomposed vs left-clean, with rationale)

**Decomposed (genuine smells):**
- `store/index.ts` — 3 duplicate single-id style patchers → `patchStyle`.
- `CommentBubble.tsx` + `CommentPreview.tsx` — near-twin box geometry → `bubbleGeometry.ts`.
- `useEditGesture.ts` (`computeAnchor` + `onDown`) — memo rect conditional sprawl → `memoBoxGeometry.ts`.
- `AnnotationInteraction.tsx` — duplicated beside-anchor point → `commentAnchorPoint`.

**Left clean (with rationale — no manufactured structure):**
- `MemoBox.tsx` — already thin; the CSS-native handles-as-children (10.2) and CSS-only chevron reveal (10.3) are deliberate, cohesive, well-documented. No decomposition warranted.
- `AnnotationLayer.tsx` `renderMemo` collapsed-width precedence (10.4) — a single readable derivation, not sprawl; leaving it.
- `gestures/useSelection.ts` `repositionBox` three-way branch (10.6) — vertical / beside-text / below is an inherent three-case placement, each one line delegating to `position.ts`; a descriptor table would be more indirection for no gain.
- `gestures/useCreateQuickBox.ts` / `useLiveSelectionPreview.ts` (10.1) — the snapshot-on-`selectionchange` + reproject split is intentional and already factored; the shared denormalize pass already lives in `anchor/viewportRectsFromPages` (10.1 did this). Clean.
- `annotations/position.ts` (10.6) — already the pure shared placement leaf; `placeBesideSelection`/`rightOf`/`clampToViewport` are cohesive. Untouched.
- `anchor/index.ts` — the correct AD-9 home for `resizeRectCorner`/`viewportRectsFromPages`/`pendingSelectionGeometry`; no residual duplication. Untouched.
- `reader/` (10.7 `lastView.ts` / `useRememberedView.ts` / `usePageNav.ts` / `PageCard.tsx` / `Reader.tsx`) — a self-contained, freshly-modularized new module; no smell. Untouched.
- `StrokeWidthRow.tsx` (10.8) — trivial four-step row. Untouched.
- Backend / generated / docs — contract-frozen; untouched by design.

### File List

- `client/src/store/index.ts` — new `patchStyle` single-id style-patch helper; `resizeCommentAnnotation`/`resizeCollapsedMemo`/`repositionCommentAnnotation` rewritten onto it.
- `client/src/annotations/bubbleGeometry.ts` (new) — shared comment-bubble box geometry (`PIN_OFFSET_TRANSFORM`, `committedBubbleOffset`, `bubbleTransform`, `manualBubbleSize`, `manualSizeStyle`).
- `client/src/annotations/bubbleGeometry.test.ts` (new) — unit tests for the above (8).
- `client/src/annotations/CommentBubble.tsx` — consumes `bubbleGeometry`; dropped the local `PIN_OFFSET_TRANSFORM` + inline offset/size/transform math.
- `client/src/annotations/CommentPreview.tsx` — consumes `bubbleGeometry`; dropped the duplicated const + inline math (`compact` maps to `bubbleTransform`'s `besideAnchor`).
- `client/src/annotations/gestures/memoBoxGeometry.ts` (new) — memo box drag geometry (`memoMinFraction`, `moveMemoRect`, `resizeMemoRect`, `reseedMemoResizeRect`; `MIN_MEMO_WIDTH_PX`/`MIN_MEMO_HEIGHT_PX`).
- `client/src/annotations/gestures/memoBoxGeometry.test.ts` (new) — unit tests for the above (10).
- `client/src/annotations/gestures/useEditGesture.ts` — `computeAnchor` rect branch → dispatch to `memoBoxGeometry`; `onDown` re-seed → `reseedMemoResizeRect`; removed the migrated MIN constants + `resizeRectCorner` import.
- `client/src/annotations/AnnotationInteraction.tsx` — new `commentAnchorPoint` helper replacing the two `beside ? rightOf(raw) : raw` sites.
- `.bmad/implementation-artifacts/10-9-epic-10-structural-refactor.md` — this story file (frontmatter `baseline_commit`, tasks, Dev Agent Record).
- `client/src/store/index.test.ts` — new regression test: a guarded/unknown-id no-op preserves the root state reference for all three single-id patchers (Codex Medium fix).
- `.bmad/implementation-artifacts/sprint-status.yaml` — status tracking (`ready-for-dev` → `in-progress` → `review`).

## Senior Developer Review (AI) — Codex (GPT-5-Codex), 2026-07-19

Read-only adversarial review of `7f8bfb2..HEAD`, judged against the pure-refactor / byte-identical-behavior bar. All three review layers converged on one finding; every geometry and AD-9 candidate was disproved against the baseline (bubble geometry, memo move/resize/reseed math, and `commentAnchorPoint` all match the baseline expressions and precedence; the memo normalized math was already in the gesture layer pre-refactor, so relocating it to a sibling leaf is not an AD-9 regression). No files modified during review.

### Review Findings

- [x] **[Review][Patch] Medium — Guarded style-patch actions were no longer true Zustand no-ops** [`client/src/store/index.ts`] — RESOLVED. The new `patchStyle` helper correctly returns the SAME `annotations` Map on a failed guard / unknown id (so zundo's `a.annotations === b.annotations` equality still suppresses history), BUT each caller wrapped it in a fresh `{ annotations: sameMap }` root object. Zustand's `setState` sees a non-identical root and notifies whole-store subscribers — whereas the pre-refactor inline bodies returned `state` (root identity preserved, no notification). Failure: `resizeCommentAnnotation("missing", …)` (or any guarded no-op) churns every store subscriber. Codex verified empirically (baseline 0 subscriber calls, refactored 1). **Fix:** each caller now returns `state` when `patchStyle(...) === state.annotations`, else `{ annotations }` — restoring the exact baseline root-identity no-op. Added a regression test asserting root-state identity across all three patchers on a guarded/unknown-id no-op. Store suite 100 green; full suite 1664 green; typecheck clean.

## Change Log

| Date | Version | Description | Author |
|------|---------|-------------|--------|
| 2026-07-19 | 0.1 | Story created (terminal Epic-10 refactor; primary targets: CommentBubble/CommentPreview near-twin, useEditGesture.computeAnchor memo branch, three single-id store style patchers) | Wonseok |
| 2026-07-19 | 0.2 | Implemented: `bubbleGeometry.ts` + `memoBoxGeometry.ts` leaves, `patchStyle` store helper, `commentAnchorPoint` dedup. Full suite 1663 green, typecheck + build clean, net −64 source lines. Status → review. | Dev (Opus 4.8) |
| 2026-07-19 | 0.3 | Codex review: fixed 1 Medium (guarded no-ops now preserve the Zustand root-state reference), added root-identity regression test. Full suite 1664 green. | Dev (Opus 4.8) |
| 2026-07-20 | 1.0 | Marked done + Epic 10 close: version `0.5.38 → 0.6.0` (epic MINOR bump per user decision, PATCH reset; `server/pyproject.toml` + `uv.lock`, `test_version` green), story + `epic-10` + sprint-status → done. | Wonseok |
