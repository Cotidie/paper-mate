---
baseline_commit: 0e6cf3384cc6dbb4683232fedcc190c9482acc71
---

# Story 8.6: Comment preview size reflects its adjusted full size

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a reader,
I want a comment's collapsed hover preview to match the size I adjusted its full bubble to,
so that the preview and the full bubble read as the same box instead of the preview snapping back to a default size.

## Context (read first)

**This is a small, client-only, contract-byte-identical bug fix.** A comment has two viewport-anchored surfaces, both rendered from `AnnotationInteraction.tsx` (`position: fixed`, so they escape the per-page `.page-surface` `overflow:hidden` clip):

- **`CommentBubble`** (`client/src/annotations/CommentBubble.tsx`) — the FULL/expanded view, shown when the comment is **selected**. It is resizable via a corner handle; on release it commits `resizeCommentAnnotation(id, {width, height})`, which persists `style.bubble_width`/`style.bubble_height` (AD-8, in `~/.paper-mate`). On render it reads those back (`manualWidth = resizeDraft?.width ?? anno.style.bubble_width ?? null`, `CommentBubble.tsx:73-74`) and applies them inline as `width`/`height` (`:123-124`). With them null (never resized) it falls through to the `.comment-bubble` CSS default (`width: var(--comment-bubble-width)` = 220px, auto height).

- **`CommentPreview`** (`client/src/annotations/CommentPreview.tsx`) — the COLLAPSED/compact view, shown on **hover** while the comment is NOT selected. It is a stripped-down twin: a single `textarea`, no color row, no actions, no resize handle. **It does NOT read `style.bubble_width`/`style.bubble_height`.** Its box is always the `.comment-preview` CSS fixed size (`width: var(--comment-bubble-width)` = 220px, auto height, `Annotations.css:824-836`).

**The defect:** resize a comment's full bubble larger (say 320×200), deselect, then hover its pin — the preview pops up at the default 220px box, not the 320×200 you adjusted the bubble to. Collapsed and expanded read as two different sizes. **The fix:** `CommentPreview` must apply the same persisted `style.bubble_width`/`style.bubble_height` the bubble already reads, so a resized comment's preview matches its full size; an un-resized comment (both null) keeps today's compact default unchanged.

**The persisted fields already exist in the contract** (`server/app/models.py:380-381` `bubble_width`/`bubble_height`; `client/src/api/schema.d.ts:709-711`). Story 3.5 restore rehydrates `style`, so once `CommentPreview` reads these fields the reload case (AC-2) falls out for free. **No contract change, no `gen:api`, no server touch, no new `render/index.ts` export.**

## The decisions that define this story (read before coding)

**D1 — Scope is the COMMENT only (Story 2.10 `CommentPreview` ↔ `CommentBubble`), NOT the memo.** This resolves the epics.md open call *"confirm whether 'comment box' here means the textbox memo (2.9), the comment bubble (2.10), or both."* The story's own framing — *"the preview render lives in `AnnotationInteraction`, `position:fixed`"* — points squarely at the two comment surfaces. `MemoBox` (`client/src/annotations/MemoBox.tsx`) renders **on the page** from `AnnotationLayer` (not `position:fixed`), its full size **is** its anchor rect (already persisted + rendered at that size), and its collapse (`style.collapsed`) is a **deliberate one-line summary** (`MemoBox.tsx:92` drops `minHeight: pos.height` while collapsed, showing `firstLine (...)`). Forcing a collapsed memo back to full height would defeat the collapse feature, which the user explicitly designed to shrink. **The memo is out of scope; do not touch `MemoBox`, `resizeMemoAnnotation`, or `setMemoCollapsed`.** (If the user actually meant the memo too, that is a different change — see Open Questions.)

**D2 — The preview reflects BOTH width and height** (resolving *"which dimension the preview must track"*). `CommentBubble` persists both `bubble_width` and `bubble_height` from one corner-handle drag; the preview applies both, so the box matches on both axes. Track them independently and null-guard each (a comment could in principle carry one without the other, though today the resize always writes the pair).

**D3 — No NEW min/max clamp on the preview** (resolving *"whether a min/max preview clamp applies"*). The persisted values are ALREADY clamped at resize time in `CommentBubble` (`MIN_BUBBLE_WIDTH = 160`, `MIN_BUBBLE_HEIGHT = 96`, `CommentBubble.tsx:25-26`, `:248-249`). The preview only READS a stored, already-clamped size; it has no resize handle of its own, so it introduces no new drag to clamp. When both fields are null (never resized) the preview keeps its current compact default (the `.comment-preview` CSS 220px box) unchanged — deliberately preserving the "lightweight glance" default for the common, never-resized case (`CommentPreview.tsx:1-9` design intent). Only a deliberately-resized comment grows its preview.

**D4 — Mirror the bubble's manual-size treatment so the textarea fills the box.** `.comment-bubble` is `display:flex; flex-direction:column` and, when height is manual, its textarea gets `.comment-bubble__text--manual-size { flex:1 1 auto; overflow-y:auto }` so it fills the fixed box and scrolls instead of forcing it taller (`Annotations.css:766-774`, `CommentBubble.tsx:88-94` skips auto-grow under a manual height). `.comment-preview` is NOT flex today and has no auto-grow effect at all — a fixed manual height alone would leave the textarea at its `min-height` with empty box space below. Give `.comment-preview` the same `display:flex; flex-direction:column` and add a `.comment-preview__text--manual-size` twin (`flex:1 1 auto; overflow-y:auto`), applied to the textarea only when a manual height is present. Adding flex-column is harmless for the default (single child, no manual size) case: the textarea keeps its `min-height`.

**D5 — Client-only, contract + `render/` barrels untouched.** `bubble_width`/`bubble_height` are already in the generated contract. `server/openapi.json` and `client/src/api/schema.d.ts` stay byte-identical (no `gen:api`); no server change; no new `render/index.ts` export (both `vi.mock("@/render")` barrels untouched); `no-raw-values` stays green (the applied px come from persisted numeric `style` values — exactly as `CommentBubble` already does — and any new CSS uses tokens).

## Acceptance Criteria

**AC-1 — A resized comment's hover preview reflects its adjusted full size** (FR-11, FR-15)
**Given** a comment whose full bubble was resized via the corner handle (persisting `style.bubble_width`/`style.bubble_height`)
**When** it is deselected and its pin is hovered so the compact preview opens
**Then** the preview box renders at the persisted `bubble_width` × `bubble_height` (its adjusted full size), so the collapsed preview and the expanded bubble read as the same box — not the fixed default preset. A comment that was NEVER resized (both fields null) still shows today's compact default preview (unchanged).

**AC-2 — The adjusted preview size survives reload** (NFR-3, AR-6)
**Given** a resized comment
**When** the doc is closed and reopened (Story 3.5 restore rehydrates `style`)
**Then** the restored comment's hover preview still reflects the persisted adjusted size (no re-resize needed). This falls out of AC-1 once the preview reads the persisted fields; assert it in a unit test with a restored-shape annotation.

**AC-3 — The preview stays within the fixed-overlay render path, no reflow, no page-edge clipping regression** (NFR-1)
**Given** the resized preview render
**Then** it stays `position: fixed` in `AnnotationInteraction`, keeps the same pin-nudge transform and viewport clamp as today (re-clamped when the manual size changes so a larger box near a viewport edge is still nudged fully on-screen), never reflows a page, and does not reintroduce the `.page-surface` overflow clip. Prove LIVE at DPR>1 that a resized preview is not clipped by its own page card's edge.

**AC-4 — Client-only; contract, `render/` barrels, and regressions preserved** (AD-9, AD-3)
**Given** the change
**Then** no store-schema / persisted-model / API change (`server/openapi.json` + `client/src/api/schema.d.ts` byte-identical vs `0e6cf33`); no new `render/index.ts` export (both `vi.mock("@/render")` barrels untouched); `no-raw-values` green. The full `CommentBubble` (select → resize → persist → reselect), the memo (2.9, incl. collapse), hover open/close timing (the `HOVER_CLOSE_DELAY_MS` grace window), hover-to-edit, and the Annotation Bank do not regress.

## Tasks / Subtasks

- [x] **Task 1 — `CommentPreview` reads and applies the persisted bubble size (AC: 1, 2)** [Design D2, D3]
  - [x] `client/src/annotations/CommentPreview.tsx`: derive `const manualWidth = anno.style.bubble_width ?? null;` and `const manualHeight = anno.style.bubble_height ?? null;` (the bubble's shape at `CommentBubble.tsx:73-74`, MINUS the live `resizeDraft` — the preview has no resize handle). Apply them on the `.comment-preview` box `style`, mirroring `CommentBubble.tsx:123-124`: spread `...(manualWidth !== null ? { width: \`${manualWidth}px\` } : {})` and the height twin, alongside the existing `left`/`top`/`transform`.
  - [x] Apply `.comment-preview__text--manual-size` to the textarea only when `manualHeight !== null` (mirror `CommentBubble.tsx:181-183`), so a manual height makes the textarea fill/scroll instead of leaving empty box below.
  - [x] Add `manualWidth`, `manualHeight` to the position-clamp `useLayoutEffect` dep array (`CommentPreview.tsx:94`), so the box is re-clamped to the viewport when its size changes — matching `CommentBubble`'s own clamp deps (`CommentBubble.tsx:113`).

- [x] **Task 2 — CSS: give `.comment-preview` the bubble's flex + manual-size treatment (AC: 1)** [Design D4]
  - [x] `client/src/annotations/Annotations.css`: add `display: flex; flex-direction: column; gap: var(--space-xxs);` to `.comment-preview` (twin of `.comment-bubble`, `:727-729`), so a manual height lets the textarea fill it.
  - [x] Add a `.comment-preview__text--manual-size { flex: 1 1 auto; overflow-y: auto; }` rule (twin of `.comment-bubble__text--manual-size`, `:771-774`). Tokens only, no raw values; no em-dash in any comment copy that ships to UI (CSS comments are exempt, but keep them clean).

- [x] **Task 3 — Tests (AC: 1, 2, 4)**
  - [x] Add `client/src/annotations/CommentPreview.test.tsx` (none exists today), mirroring `CommentBubble.test.tsx`'s harness (a `comment(id, body)` factory + a `pos` `ScreenRect`). Because the preview is hover-gated, render it with `hovered={true}` so it is visible. Assert: (a) a comment with `style.bubble_width: 320, bubble_height: 200` renders `.comment-preview` with `style.width === "320px"` and `style.height === "200px"`, and its textarea carries `comment-preview__text--manual-size`; (b) a comment with both null renders NO inline `width`/`height` (falls through to the CSS default) and the textarea does NOT carry the manual-size class; (c) width-only / height-only null-guards behave independently.
  - [x] Confirm `AnnotationInteraction.test.tsx` (which mounts `CommentPreview` for non-selected comments) still passes; add a case there only if the wiring (passing `anno` with a persisted size through to the preview) needs coverage the unit test does not give.
  - [x] Full regression: `cd client && npm test` + `npm run typecheck` green; `no-raw-values` green. Contract byte-identical: `git diff 0e6cf33..HEAD -- client/src/api/schema.d.ts server/openapi.json` empty. Both `vi.mock("@/render")` barrels (`App.test.tsx`, `Reader.test.tsx`) untouched (no new `render/` export). Server pytest unchanged (no backend touch) — run-it-yourself on the host per CLAUDE.md; nothing here can regress it.

- [x] **Task 4 — Live smoke at DPR>1 (AC: 1, 3)** [[verify-on-hidpi-and-real-host]]
  - [x] With your OWN fresh dev servers (never a user-launched / Docker one — CLAUDE.md; Stories 8.2/8.3/8.4 hit exactly this trap when a `--reload` container held port 8000 and served the user's real `~/.paper-mate`), pointing `PAPER_MATE_DATA` at an isolated scratch dir so the real library is never touched, on a real multi-page paper at DPR>1: (a) create a comment (text or region), select it, drag the corner handle to grow the bubble noticeably (e.g. ~320×220), type a note; (b) click elsewhere to deselect; (c) hover the pin → the compact preview opens at the SAME ~320×220 size (not the 220px default), body text intact, no page-edge clipping and no page reflow; (d) hover a DIFFERENT, never-resized comment → its preview is the compact default (regression that D3's null-fallthrough holds); (e) reselect the resized comment → the full bubble still opens at its persisted size and is still resizable (no bubble regression); (f) reload the doc (Story 3.5) → hover the resized comment again → the preview is still the adjusted size (AC-2 live). Save a screenshot to `.bmad/implementation-artifacts/8-6-comment-preview-smoke.png`.
    - Ran fresh `uvicorn` (port 8123) + `vite dev` (port 5183) against an isolated scratch `PAPER_MATE_DATA` dir; loaded `fixtures/sample-pdfs/1903.03295v2.pdf` (10 pages) at DPR=2 (1400x900x2) via chrome-devtools MCP. Created a text comment on "Abstract", dragged the corner handle to 330x195.6px (via dispatched PointerEvents on the resize handle, since the CDP `drag` tool only supports element-to-element targets, not pixel deltas; each step confirmed live via `getBoundingClientRect`), typed a long note. Deselected (Escape) -> hovered the pin -> preview rendered at the identical 330x195.6px with `comment-preview__text--manual-size`, fully within the viewport (no clipping). Created a SECOND, never-resized comment on "1. Introduction" -> its hover preview showed no inline width/height and no manual-size class (D3 regression holds). Reselected the resized comment -> bubble reopened at 330x195.6px with the resize handle present and body text intact (no bubble regression). Reloaded the document (`Story 3.5` restore) -> hovered the resized comment again -> preview still 330x195.6px with the manual-size class (AC-2 confirmed live). Screenshot saved to `.bmad/implementation-artifacts/8-6-comment-preview-smoke.png`. Both dev servers shut down after.

- [x] **Task 5 — Docs + version (AC: all)**
  - [x] No `/api` change → `docs/API.md` untouched.
  - [x] `client/src/annotations/README.md`: in the comment section, note that `CommentPreview` now reflects the persisted `bubble_width`/`bubble_height` (the same fields `CommentBubble` reads), so the collapsed hover preview and the full bubble stay the same size; an un-resized comment keeps the compact default.
  - [x] `server/pyproject.toml` version `0.5.19 → 0.5.20` at done (single source; PATCH +1 per completed story). Re-sync `server/uv.lock` if it drifts from the bumped version (Story 8.4 hit this).

## Dev Notes

### What this changes vs reuses

| Need | Reuse | New |
| --- | --- | --- |
| Persisted adjusted size | `style.bubble_width`/`bubble_height` (already written by `resizeCommentAnnotation`, read by `CommentBubble`) | nothing |
| Reading the size in the preview | the bubble's `manualWidth`/`manualHeight` derivation (minus `resizeDraft`) | the same two lines in `CommentPreview` |
| Manual-height textarea fill | `.comment-bubble__text--manual-size` flex-fill pattern | a `.comment-preview__text--manual-size` twin + `.comment-preview` flex-column |
| Viewport clamp on size change | `CommentPreview`'s existing `clampToViewport` effect | add the two size values to its deps |
| Reload persistence | Story 3.5 restore rehydrates `style` | nothing (falls out) |

Resist: touching the memo (`MemoBox`/`resizeMemoAnnotation`/`setMemoCollapsed`) — D1; a new store field or action — the size already persists on `style`; a new contract field — `bubble_width`/`bubble_height` exist; a `resizeDraft`/resize handle on the preview — the preview is read-only for size (resize stays a bubble-only affordance); any `render/`/`anchor/`/store-schema/contract change — D5.

### Integration points (the seams)

- `client/src/annotations/CommentPreview.tsx` — read `style.bubble_width`/`bubble_height`, apply to the box, manual-size class, clamp deps (Task 1).
- `client/src/annotations/Annotations.css` — `.comment-preview` flex-column + `.comment-preview__text--manual-size` twin (Task 2).
- `client/src/annotations/CommentBubble.tsx` — NO change (the source of truth for the persisted size; the shape to mirror).
- `client/src/annotations/AnnotationInteraction.tsx` — NO change (already passes each non-selected comment's full `anno` to `CommentPreview`, `:528-531`; the persisted `style` rides along).
- `client/src/store/index.ts` — NO change (`resizeCommentAnnotation` already persists `bubble_width`/`bubble_height`, `:499-514`).
- `server/app/models.py`, `client/src/api/schema.d.ts` — NO change (fields already present).

### Current state of the files being modified (read before coding)

- **`CommentPreview.tsx`** (117 lines): renders one `.comment-preview` box with a single `textarea` at `pos` (viewport coords) + the `PIN_OFFSET_TRANSFORM`. Owns its own hover open/close via a `HOVER_CLOSE_DELAY_MS = 200` grace window (`:60-75`) so it survives the pointer crossing the gap from pin to box — do NOT disturb that timer or the `visible` gate. Has a `clampToViewport` layout effect (`:82-94`) keyed on `[visible, body, pos.left, pos.top]`. **What changes:** derive `manualWidth`/`manualHeight` from `anno.style`, apply to the box, add the manual-size textarea class, extend the clamp deps. **What must be preserved:** the hover grace-window logic, the `visible` gate, the pin-nudge transform, the group-aware `hovered` open trigger, and the read-only (no color/actions/resize) nature of the preview.
- **`CommentBubble.tsx`** (266 lines): the reference implementation for the persisted-size read — `manualWidth`/`manualHeight` (`:73-74`), inline `width`/`height` (`:123-124`), the manual-size textarea class (`:181-183`), MIN clamps at resize (`:248-249`), and the `resizeCommentAnnotation` commit on release (via `onResize`, wired at `AnnotationInteraction.tsx:514`). **Not modified** — read it to mirror the exact shape.
- **`Annotations.css`** `.comment-preview` (`:824-836`) + `.comment-preview__text` (`:838-852`): currently a fixed 220px box, textarea not flex-filled. `.comment-bubble` (`:718-739`) + `.comment-bubble__text--manual-size` (`:771-774`) are the twins to mirror.

### Engineering conventions in force (CLAUDE.md#Engineering-principles)

- **Adopt-stable / one model** [[prefer-stable-solutions]]: the persisted size + its read shape already exist on `CommentBubble`; this story mirrors that ONE model onto `CommentPreview` rather than inventing a second size source. New surface area = ~4 lines of TSX + 2 CSS rules.
- **Document-level handlers (AP-1)** [[held-key-state-reset-on-blur]]: not touched here — the preview's hover handlers and the size read are local render logic, no document listeners added.
- **`render/` mock-barrel sync (AP-2)**: no new `render/index.ts` export → both `vi.mock("@/render")` barrels untouched. Confirm.
- **HiDPI live smoke (highest-risk path)** [[verify-on-hidpi-and-real-host]]: jsdom zeroes layout, so the unit test asserts the applied inline `style.width`/`height` (the MODEL), and the LIVE DPR>1 smoke proves the resized preview actually matches the bubble on-screen and is not clipped at a page edge. [[comment-bubble-page-edge-clipping]] is the exact clipping bug the `position:fixed` render path already guards — verify the larger box does not reintroduce it near a page/viewport edge.
- **Cross-model code review (AP-3)**: run `bmad-code-review` (Codex) after dev-story; the null-fallthrough (un-resized comment keeps the compact default) and the manual-height-fills-the-box CSS are the likely finding spots.

### Testing standards

Frontend Vitest + jsdom: assert the MODEL — the inline `style.width`/`style.height` the preview applies from `anno.style.bubble_width`/`bubble_height`, the presence/absence of `comment-preview__text--manual-size`, and the null-fallthrough — NOT pixel geometry (jsdom zeroes rects). Render the preview with `hovered={true}` (it is hover-gated). Backend: no model/contract change; nothing to run.

### Project Structure Notes

- Touches only `client/src/annotations/` (`CommentPreview.tsx`, `Annotations.css`, a new `CommentPreview.test.tsx`) + docs + the version bump. No `render/`/`anchor/`/store-schema/contract change (AD-9 downward rule intact).
- No new top-level dirs. One new test file (`CommentPreview.test.tsx`) colocated with the component it covers.
- Versioning: PATCH +1 at PR merge → `server/pyproject.toml` `0.5.19 → 0.5.20` (the sole version source).

### References

- [Source: .bmad/planning-artifacts/epics.md#Story 8.6 (line 2051)] — canonical AC set; the three "Open design calls for create-story" (memo vs comment vs both, which dimension, min/max clamp) are resolved in Decisions D1/D2/D3.
- [Source: .bmad/planning-artifacts/sprint-change-proposals/sprint-change-proposal-2026-07-11-epic-8-9-stories.md] — provenance; Epic 8 broadened to hold reader defects; 8.6 = comment/memo preview-size defect, no new FR.
- [Source: client/src/annotations/CommentPreview.tsx] — the collapsed hover preview to fix; the `manualWidth`/`manualHeight` read must be added here.
- [Source: client/src/annotations/CommentBubble.tsx:73-74, :123-124, :181-183, :248-249] — the reference: how the full bubble reads/applies the persisted size + the MIN clamps (D3).
- [Source: client/src/annotations/AnnotationInteraction.tsx:489-543] — where the selected bubble and every non-selected comment's preview are rendered (`position:fixed`), passing the full `anno` through; no change needed.
- [Source: client/src/store/index.ts:499-514 (resizeCommentAnnotation)] — persists `style.bubble_width`/`bubble_height`; already the single write path.
- [Source: client/src/annotations/MemoBox.tsx:92, :124-127] — why the memo is OUT of scope (D1): collapse deliberately drops the full height for a one-line summary; the memo renders on-page, not `position:fixed`.
- [Source: client/src/annotations/Annotations.css:718-774 (.comment-bubble + __text--manual-size), :824-856 (.comment-preview + __text)] — the CSS twin to add (D4).
- [Source: server/app/models.py:370-381 + client/src/api/schema.d.ts:693-711] — `bubble_width`/`bubble_height` already in the contract; no `gen:api`, no server change.
- [[comment-bubble-page-edge-clipping]] — the `position:fixed` render path that escapes `.page-surface` clip; the larger preview must not reintroduce it (AC-3).
- FR-11 (annotate), FR-15 (edit annotations), NFR-1 (no reflow), NFR-3 (persist/restore geometry), AR-6 (hydrate-on-open), AD-8 (persisted annotation data), AD-9 (downward layering).

## Open Questions

- **D1 memo scope:** confirmed the fix targets the COMMENT (2.10) hover preview vs full bubble, and deliberately excludes the memo (2.9), whose collapse is an intentional one-line summary. If the user actually intended the memo's collapsed box to also snap to its full adjusted height (a different, arguably collapse-defeating change), that is a follow-up, not this story.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (bmad-dev-story)

### Debug Log References

- Live smoke: fresh `uvicorn` (port 8123, isolated `PAPER_MATE_DATA` scratch dir) + fresh `vite dev` (port 5183) via chrome-devtools MCP, DPR=2 (1400x900x2). CDP's `drag` tool only supports element-to-element drop targets, not arbitrary pixel deltas, so the corner-handle resize was driven via `PointerEvent` dispatch (pointerdown/move/up) on the resize handle directly, each step confirmed against `getBoundingClientRect()`/inline style between calls (state commits async, so reads were split into separate `evaluate_script` calls rather than read-after-dispatch in the same call).

### Completion Notes List

- `CommentPreview` now derives `manualWidth`/`manualHeight` from `anno.style.bubble_width`/`bubble_height` (mirroring `CommentBubble`, minus `resizeDraft`), applies them as inline `width`/`height` on the `.comment-preview` box, adds the `comment-preview__text--manual-size` class to the textarea when a manual height is set, and extends the viewport-clamp effect's deps to include both values.
- `.comment-preview` gained `display:flex; flex-direction:column; gap:var(--space-xxs)` (twin of `.comment-bubble`) and a new `.comment-preview__text--manual-size { flex:1 1 auto; overflow-y:auto }` rule so a manual height lets the textarea fill/scroll instead of leaving blank space.
- Added `client/src/annotations/CommentPreview.test.tsx` (4 tests): resized comment applies width/height + manual-size class; never-resized comment keeps the compact default (no inline size, no manual-size class); width-only/height-only null-guards behave independently; a restored-shape annotation (simulating post-reload rehydration) still applies its persisted size.
- Full regression: `npm test` (69 files / 1435 tests passed), `npm run typecheck` clean, contract byte-identical (`git diff 0e6cf33..HEAD -- client/src/api/schema.d.ts server/openapi.json` empty), both `render/` mock barrels untouched.
- Live DPR>1 smoke (chrome-devtools MCP, isolated dev servers + scratch data dir) confirmed: a comment resized to 330x195.6px shows its hover preview at the SAME size with the manual-size class, fully within viewport (no clipping); a second, never-resized comment's preview stays at the compact default (D3 regression holds); reselecting the resized comment reopens the full bubble at its persisted size, still resizable; reloading the document (Story 3.5 restore) and re-hovering shows the preview still at the adjusted size (AC-2 confirmed live). Screenshot: `.bmad/implementation-artifacts/8-6-comment-preview-smoke.png`.
- Docs: noted the fix in `client/src/annotations/README.md`'s Story 2.10 comment section. No `/api` change, `docs/API.md` untouched. Version bumped `0.5.19 → 0.5.20` (`server/pyproject.toml`), `server/uv.lock` re-synced via `uv lock`.
- Backend pytest not run (no server/app change; per CLAUDE.md sandbox note this is run-it-yourself on the host).

### File List

**Frontend:**
- `client/src/annotations/CommentPreview.tsx`
- `client/src/annotations/Annotations.css`
- `client/src/annotations/CommentPreview.test.tsx` (new)
- `client/src/annotations/README.md`

**Backend:**
- `server/pyproject.toml` (version bump)
- `server/uv.lock` (re-synced via `uv lock`)

**Other:**
- `.bmad/implementation-artifacts/8-6-comment-preview-smoke.png` (new, live smoke evidence)
- `.bmad/implementation-artifacts/sprint-status.yaml` (status: ready-for-dev → in-progress → review)

## Change Log

| Date | Change |
|------|--------|
| 2026-07-12 | Story created (ready-for-dev) via bmad-create-story. Comment-only, client-only, contract-byte-identical: `CommentPreview` (hover/collapsed) reads the same persisted `style.bubble_width`/`bubble_height` that `CommentBubble` (selected/full) already writes+reads, so the collapsed preview matches the adjusted full size; un-resized comments keep the compact default. Memo explicitly out of scope (D1). Resolves the three epics.md open design calls (D1/D2/D3). |
| 2026-07-12 | Implemented (bmad-dev-story): `CommentPreview` reads persisted `bubble_width`/`bubble_height`, applies them + a manual-size textarea class, extends the clamp deps; `.comment-preview` CSS gained the flex-column + manual-size twin. Added `CommentPreview.test.tsx` (4 tests). Full regression green, contract byte-identical, live DPR>1 smoke confirmed AC-1/2/3. `README.md` updated, version bumped `0.5.19 → 0.5.20`. Status → review. |
