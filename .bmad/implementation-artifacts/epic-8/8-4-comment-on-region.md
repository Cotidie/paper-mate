---
baseline_commit: 7046832fa2ad7c9de518b329c8ed25fb2bbf9957
---

# Story 8.4: Comment on a boxed region

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a reader,
I want to attach a comment to a boxed region,
so that I can annotate a specific visual area (a figure, a table, a diagram) the way I comment on text.

## Context (read first)

**This story adds "box comment" as a MODE of the Comment tool, mirroring exactly how "box highlight" is a mode of the Highlight tool.** The user's request is literal: *"add box comment in toolrail of comment."* The Comment tool's flyout gets a two-option Text / Box picker (twin of the Highlight flyout's Text / Box picker); with Box mode on, a rectangle drag over a page creates a `type=comment`, `anchor kind=rect` mark (a boxed region with a comment pin + bubble) instead of a text-run comment.

**Why the epic's original framing does not apply verbatim.** Story 8.4's AC in `epics.md` says the region comment comes from *"the region quick-box's 'comment' option"* reserved by Story 2.11. **That quick-box was DELETED.** Story 2.11's post-review revision (`f97881d`, `3c3e4af`) removed box-comment, the region tool-type picker, and the `retypeRegion` store action; box-highlight was relocated to a MODE of the Highlight tool (the `boxHighlight` flag + the Highlight flyout's Text/Box picker). This story realizes the same end state (a comment attached to a boxed region: `type=comment`, `kind=rect`, `body`) through the pattern that actually shipped — a box MODE on the Comment tool — not through a resurrected region picker. Do NOT rebuild the region quick-box or `retypeRegion`.

**Almost everything this story needs already exists — this is a small, client-only, contract-byte-identical change.** The rendering, the create builder, the Bank behavior, and even a two-step way to reach the same mark are all already in the codebase:

- **The create builder exists.** `buildCommentPin(placement, docId, {now, newId, color})` (`client/src/annotations/create.ts:164`) builds exactly `type="comment"`, `kind="rect"`, `body=""`. It is used today for the click-to-place point pin (a degenerate rect). Feeding it the drawn drag rect (instead of a point) makes a boxed region comment. No new builder.
- **The render is done.** A `kind=rect` + `type=comment` mark already: (1) paints the ~0.4 region fill — `regionMarks` filters `kind==="rect" && (type==="highlight" || type==="comment")` (`AnnotationLayer.tsx:123`); (2) renders the comment pin at the rect top-left — `commentMarks` → `renderComment`, which handles `liveAnchor.kind==="rect"` (`AnnotationLayer.tsx:316`); (3) opens the `CommentBubble` on select and is movable/resizable via Story 3.1 handles (`movable = liveAnchor.kind==="rect"`); (4) is excluded from the generic selection quick-box (`showSelectionBox` excludes `type==="comment"`, Story 2.10). **This exact mark shape is already produced in production** by Story 3.7's convert-highlight-to-comment on a region highlight (`convertSelected` → `retypeAnnotation(..., "comment", ...)`, `useSelection.ts:200`). So box-comment is not new geometry or new paint — it is a new, direct way to CREATE a mark shape the app already renders and edits.
- **The Bank is done.** The mark is `type=comment`, so the Story 8.2 filter treats it as a comment (shown by default) and the Story 8.3 reading-order sort keys off its rect top-left (`anchorTopLeft` handles `kind==="rect"`). No Bank change (AC-4 falls out for free).
- **The command path is reused.** The box gesture commits via `ctx.addAnnotation`, which mutates `annotations` — the zundo-tracked temporal slice (`store/index.ts`), i.e. the single command path (AR-7). Undo/redo works for free, same as box-highlight.

**The one real wiring risk: box mode must fully OWN comment creation while it is on**, so a box drag does not ALSO trigger the Comment tool's existing text-drag / click-pin create path (`useCreateQuickBox`). Box-highlight avoids this by luck (the Highlight tool's empty-selection pointerup branch is a no-op); the Comment tool's empty-selection branch is NOT a no-op (it drops a click pin). So this story must suppress `useCreateQuickBox`'s comment paths while any box mode is active (see Design D3). This is the single most likely defect and the reason the box gesture is generalized rather than duplicated.

## The decisions that define this story (read before coding)

**D1 — Box comment is a MODE of the Comment tool (the `boxComment` flag), a faithful twin of `boxHighlight`.** Add `boxComment` state next to `boxHighlight` in the composition root (`ReaderPage.tsx`), reset to `false` whenever the active tool leaves Comment, and surface it as a Text / Box two-option `menuitemradio` picker at the TOP of the Comment flyout (above the color swatch, with a divider) — exactly like the Highlight flyout. AD-11 is preserved: box-comment is not a competing `ActiveTool` value; the single `activeTool` stays `"comment"`. Box-highlight and box-comment are mutually exclusive for free (they are modes of two different tools; only one tool is active).

**D2 — ONE box gesture, parametrized by what it builds — do NOT fork a second gesture.** `useBoxGesture` today takes `boxActive: boolean` and always builds a region highlight. Generalize its second argument to `boxMode: "highlight" | "comment" | null` (null = inactive). Gate on `boxMode !== null`; on commit branch the builder + color:
- `"highlight"` → `buildRegionAnnotation(placement, docId, { now, newId, color: defaults.colors.highlight })` (unchanged behavior).
- `"comment"` → `buildCommentPin(placement, docId, { now, newId, color: defaults.colors.comment })`, feeding the DRAWN, canonicalized, normalized drag rect (the same `placement` the highlight branch uses — NOT a degenerate point).
Both then `addAnnotation(created)` + `select(created.id)`. Because a selected `type=comment` mark opens the `CommentBubble` (and NOT the generic selection quick-box), the bubble opens for immediate typing, exactly like a click-placed comment. The disarm-on-mode-off effect keys on `boxMode` becoming `null`. This is the smallest correct structure (CLAUDE.md: refactor structure in the same change; prefer one parametrized primitive over a near-duplicate).

**D3 — While ANY box mode is active, `useCreateQuickBox` must NOT also create a comment.** Thread a `boxActive: boolean` (= `boxMode !== null`) into `useCreateQuickBox`. In its `onPointerUp` handler, return early when box mode is active (like the existing pen/memo early-return) so a box drag never falls through to the text-comment create (`createTextTool`) or the click-pin path (`buildCommentPin`). Also null the comment-click candidate in `onPointerDownCandidate` when box mode is active. This makes box mode authoritative for both highlight (belt-and-suspenders; the current no-op is coincidental) and comment (required — its empty-selection branch drops a pin). This is the story's highest-risk seam; cover it with a test that a box-comment drag creates exactly ONE mark.

**D4 — No new hotkey; the flyout Text/Box picker is the affordance.** Box-highlight has `M` because it predates this pattern and the keymap already carried it. This story deliberately does NOT add a `boxComment` keymap action: the keymap is a non-optional `Record<KeyAction, KeyBinding>` persisted to `localStorage` (Story 5.1), so a new action adds a hydration/merge-migration surface and needs a default key with no obvious mnemonic — for a capability the user asked to reach through the toolrail. The Comment flyout's Box option is the affordance. (If a hotkey is wanted later it layers on as a keymap action; note the persisted-keymap merge concern then.) Accept the small asymmetry with box-highlight's `M`.

**D5 — No new rendering, no store schema/contract change.** A boxed region comment reuses the region fill branch (2.11), the comment pin/bubble (2.10), the movable rect edit frame (3.1), the Bank filter/sort (8.2/8.3), the doc-scoped comment group helpers, and `retextAnnotation`/`recolorAnnotation`/`deleteAnnotation`. `RectAnchor`, `type:"comment"`, and `body` are already in the generated contract (AR-5 permits `comment → rect`). `server/openapi.json` (tracked) + `client/src/api/schema.d.ts` stay byte-identical; no `gen:api`, no server change, no new `render/index.ts` export.

## Acceptance Criteria

**AC-1 — Box-comment mode → drag a rectangle creates a region comment (`type=comment`, `kind=rect`, `body`) through the command path** (FR-11, FR-12, FR-25, AR-5, AR-7)
**Given** the Comment tool is armed with Box mode on (the Comment flyout's Box option)
**When** I drag a rectangle over a page and release
**Then** a comment is attached to that region: one `Annotation { type:"comment", group_id:null, anchor:{kind:"rect", page_index, rect}, style:{color}, body:"" }`, the rect canonicalized (`x0≤x1, y0≤y1`) and `normalizeRect`-normalized `[0,1]` against the page box (scale-independent), single-page, built via `buildCommentPin` and added through `addAnnotation` (the zundo command path, so it is undoable). It lands selected and its `CommentBubble` opens for immediate typing. A below-threshold drag creates nothing, and the box drag does NOT also create a text comment or a stray click pin (Design D3).

**AC-2 — Clicking the region's pin opens the comment bubble for read/edit; keyboard-reachable and `Esc`-dismissable with focus management** (FR-25, UX-DR8, UX-DR17, NFR-1)
**Given** a region comment
**When** I click its pin
**Then** the `{component.comment-bubble}` opens over the region for read/edit, focus moves into the textarea on open and back to the prior element on close, `Esc` dismisses it, and nothing reflows the canvas. (This is the existing Story 2.10 pin/bubble path, unchanged.)

**AC-3 — The region box and its comment pin stay anchored and correctly scaled across zoom** (NFR-3, AD-4)
**Given** a region comment
**When** I zoom
**Then** the ~0.4 region fill and the comment pin stay at their exact PDF coordinates and scale (both ride `denormalizeRect`); screen position is derived, never persisted. Prove LIVE at DPR>1.

**AC-4 — The region comment appears in the Annotation Bank as a comment, in reading order** (FR-19, FR-24)
**Given** a region comment
**Then** it appears in the Annotation Bank (shown by the Story 8.2 filter's comments-default, like any comment) and sorts by the region's rect top-left in Story 8.3's reading order. No Bank code change (it is `type=comment`, `kind=rect`, which the Bank already handles).

**AC-5 — Box comment is a mode of the single `activeTool` FSM; client-only; contract + regressions preserved** (AD-11, AD-9, AD-3)
**Given** the Comment tool
**Then** its flyout shows a Text / Box two-option picker (Text default); picking Box sets `boxComment=true` (drag → region comment) and picking Text sets it back (drag → text comment / click → point pin); `boxComment` resets to `false` whenever `activeTool` leaves Comment; AD-11 holds (`activeTool` stays `"comment"`, box is a mode not a tool). No store-schema / persisted-model / anchor-model / API change (`server/openapi.json` + `client/src/api/schema.d.ts` byte-identical); no new `render/index.ts` export (both `vi.mock("@/render")` barrels untouched); `no-raw-values` green. Box-highlight, text comment (drag + click), highlight/underline/pen/memo, pan, zoom-glue, and the Bank do not regress.

## Tasks / Subtasks

- [x] **Task 1 — Generalize `useBoxGesture` to build highlight OR comment (AC: 1)** [Design D2]
  - [x] `client/src/annotations/gestures/useBoxGesture.ts`: change the second parameter from `boxActive: boolean` to `boxMode: BoxMode | null`, where `export type BoxMode = "highlight" | "comment";`. Rename `boxActiveRef` → `boxModeRef`; gate every `boxActiveRef.current` check on `boxModeRef.current !== null` (the pointerdown gate, the mid-drag disarm guard in `onUp`, and the mode-off abort effect keyed on `boxMode`).
  - [x] On commit, branch the builder + color on `boxModeRef.current`: `"highlight"` → `buildRegionAnnotation(placement, docId, { now, newId, color: defaultsRef.current.colors.highlight })` (unchanged); `"comment"` → `buildCommentPin(placement, docId, { now, newId, color: defaultsRef.current.colors.comment })`. `placement = { page_index: page.pageIndex, rect }` is identical for both. Import `buildCommentPin` alongside `buildRegionAnnotation`. Keep the `BOX_DRAG_THRESHOLD`, `pickPage`, `normalizeRect`, capture, preventDefault, and abort logic exactly as-is.
  - [x] Update the header comment (it currently says "box-highlight drag gesture" only) to note it now builds a highlight OR a comment region per `boxMode`.

- [x] **Task 2 — Suppress the text-comment create while box mode is active (AC: 1, 5)** [Design D3]
  - [x] `client/src/annotations/gestures/useCreateQuickBox.ts`: add `boxActive: boolean` to the opts; mirror it into a live ref (or reuse the existing ref-mirror pattern). In `onPointerUp`, add an early `return` when box mode is active, placed right after the `isExempt`/button-guard and alongside the existing pen/memo early-return (`if (armedToolRef.current === "pen" || armedToolRef.current === "memo") return;`). In `onPointerDownCandidate`, when box mode is active, set `commentDownRef.current = null` and return (no click candidate). Add `boxActive` to the `onPointerUp` effect's dep list if you gate via the reactive value rather than a ref (prefer a ref so the document listeners are not re-bound on every mode toggle).
  - [x] `client/src/annotations/AnnotationInteraction.tsx`: replace the `boxActive?: boolean` prop with `boxMode?: BoxMode | null` (default `null`); pass `boxMode` to `useBoxGesture(gestureCtx, boxMode)`; pass `boxActive: boxMode != null` into `useCreateQuickBox({...})`. Update the prop's doc comment.

- [x] **Task 3 — Thread `boxMode` from the composition root through Reader (AC: 1, 5)**
  - [x] `client/src/reader/ReaderPage.tsx`: add `const [boxComment, setBoxComment] = useState(false);` next to `boxHighlight`, and a reset effect `useEffect(() => { if (activeTool !== "comment") setBoxComment(false); }, [activeTool]);` (twin of the `boxHighlight` reset at `:68`). Compute a single `boxMode`: `activeTool === "highlight" && boxHighlight ? "highlight" : activeTool === "comment" && boxComment ? "comment" : null`. Pass `boxMode={boxMode}` to `<Reader>` (replacing `boxActive={...}`). Pass `boxComment={boxComment}` + `onSetBoxComment={setBoxComment}` to `<ToolRail>`.
  - [x] `client/src/components/Reader/Reader.tsx`: replace the `boxActive?: boolean` prop with `boxMode?: BoxMode | null`; pass it through to `<AnnotationInteraction boxMode={boxMode ?? null} />`. Update the prop doc comment (box is a mode of Highlight OR Comment; the overlay's box-drag gesture builds the matching region).

- [x] **Task 4 — Comment flyout Text / Box picker (AC: 5)** [Design D1]
  - [x] `client/src/components/ToolRail/ToolRail.tsx`: add `boxComment: boolean` + `onSetBoxComment: (v: boolean) => void` to the props (twin of `boxHighlight`/`onSetBoxHighlight`, with the same doc comments adapted to Comment). In the Comment flyout (`comment-flyout`, currently a lone `ColorSwatchRow`), add — ABOVE the swatch, mirroring the Highlight flyout exactly — a Text option (`role="menuitemradio"`, `aria-checked={!boxComment}`, `ChatCircle` icon, `data-testid="comment-text-toggle"`, `onClick={() => onSetBoxComment(false)}`) and a Box option (`aria-checked={boxComment}`, `BoundingBox` icon, `data-testid="comment-box-toggle"`, `onClick={() => onSetBoxComment(true)}`), then a `<div className="tool-flyout__divider" data-testid="comment-box-divider" />`, then the existing `ColorSwatchRow`. A mode PICK must NOT close the flyout (do not call `setFlyoutOpen(false)` — same as the Highlight text/box picks); only the color pick closes it. No em-dash in `title`/`aria-label` strings (e.g. `title="Box comment: drag a region"`, `title="Text comment: drag over text or click a spot"`).

- [x] **Task 5 — Tests + regression bar (AC: all)**
  - [x] `client/src/annotations/gestures/useBoxGesture.test.ts` (or the box tests in `AnnotationInteraction.test.tsx`, wherever the current box-gesture coverage lives): a box drag with `boxMode="comment"` creates ONE `type="comment"`, `kind="rect"`, `body=""` mark with the canonicalized normalized rect + `defaults.colors.comment`, adds + selects it; `boxMode="highlight"` still creates a region highlight (regression); `boxMode=null` creates nothing; below-threshold drag → no mark; mid-drag mode-off aborts.
  - [x] `client/src/annotations/gestures/useCreateQuickBox.test.ts` (or its home): with box mode active, a comment-armed drag does NOT create a text comment and does NOT drop a click pin (assert exactly zero marks from `useCreateQuickBox` — the box gesture owns it). With box mode off, the existing text-drag comment + click-pin paths still work (regression).
  - [x] `client/src/components/ToolRail/ToolRail.test.tsx`: the Comment flyout shows a Text/Box radio pair + divider + color row; clicking Box fires `onSetBoxComment(true)` and does NOT close the flyout; clicking Text fires `onSetBoxComment(false)`; the color pick still closes it. Mirror the existing `highlight-box-toggle` tests.
  - [x] `client/src/reader/ReaderPage.test.tsx` (+ `Reader`/`AnnotationInteraction` prop tests if present): `boxComment` resets when `activeTool` leaves Comment; `boxMode` derives to `"comment"` only while Comment is active + box on, `"highlight"` only while Highlight is active + box on, else `null`. Confirm NO new `render/` export (both `vi.mock("@/render")` barrels untouched).
  - [x] Full regression: `cd client && npm test` + `npm run typecheck` green; `no-raw-values` green. Contract byte-identical: `git diff 7046832..HEAD -- client/src/api/schema.d.ts server/openapi.json` empty. Server pytest is unchanged (no backend touch) — run-it-yourself on the host per CLAUDE.md; nothing here can regress it.

- [x] **Task 6 — Live smoke (AC: 1, 2, 3)** [[verify-on-hidpi-and-real-host]]
  - [x] With your OWN fresh dev servers (never a user-launched / Docker one — CLAUDE.md; Stories 8.2/8.3 hit exactly this trap when a `--reload` container held port 8000), on a real multi-page paper at DPR>1: (a) arm Comment, open its flyout, pick Box; (b) drag a rectangle over a figure → a ~0.4 region fill + a comment pin appear, the page is NOT displaced, and the bubble opens focused — type a note; (c) click elsewhere to deselect, then click the pin → the bubble reopens with the saved note; (d) recolor + delete from the bubble work; (e) switch the flyout back to Text → a drag highlights a text run + pin (text comment), a click drops a point pin (no double-create either way); (f) zoom 150→250% → the region fill + pin stay glued and scaled (record the fraction invariants); (g) the region comment appears in the Bank as a comment and sorts in reading order among other marks; (h) box-highlight still works (Highlight → Box → drag → region highlight, no comment); (i) below-threshold click while box-comment armed → no stray mark. Save a screenshot to `.bmad/implementation-artifacts/8-4-region-comment-smoke.png`.
  - **Smoke run 2026-07-12** (own uvicorn on :8010 + own vite on :5180, `PAPER_MATE_API_TARGET` pointed to it, isolated scratch `PAPER_MATE_DATA` so the user's real `~/.paper-mate` library was never touched; DPR=2, "Microsoft COCO" 15-page fixture, 200%→250% zoom): all sub-items (a)-(i) verified via `evaluate_script` DOM/state inspection (real `PointerEvent`s for drags, since the gestures listen on raw `document` pointer events; a genuine trusted `.click()` for the comment pin's React `onClick`). (b) confirmed via `annotation-highlight annotation-region` fill rect at the exact drag rect + `annotation-comment-pin`, bubble opened and typed. (c) confirmed the reopened bubble's body textbox held the saved text. (d) recolor changed `background-color: var(--color-annotation-green)`; delete removed both the fill and the pin. (e) Text mode: a text-drag produced a `kind=text` comment (no region rect), a click produced exactly one NEW `kind=rect` point pin (no double-create, confirmed before/after pin counts). (f) the region rect's screen geometry scaled by exactly 1.25× on a 200%→250% zoom (`774.5/619.6`, `187.5/150`, `125/100`), confirming NFR-3 zoom-glue. (g) the Bank panel listed all 3 created comments under the Comment filter, `p.1`. (h) Highlight's box mode still created a plain (`annotation-default` color, non-comment) region highlight — confirmed the D2 builder branch is unaffected. (i) a sub-threshold pointerdown/move/up while box-comment was armed left the pin count unchanged (3→3). No console errors observed. Dev servers stopped and the scratch data dir left for cleanup; nothing written to the user's real library.

- [x] **Task 7 — Docs + version (AC: all)**
  - [x] No `/api` change → `docs/API.md` untouched.
  - [x] `client/src/annotations/README.md`: update the Story 2.11 / box-mode section to note box-comment is now a mode of the Comment tool (drag → `type=comment`, `kind=rect` region comment), the twin of box-highlight; `useBoxGesture` builds either per `boxMode`.
  - [x] `server/pyproject.toml` version `0.5.15 → 0.5.16` at done (single source; PATCH +1 per completed story).

## Dev Notes

### What this adds vs reuses

| Need | Reuse | New |
| --- | --- | --- |
| Rect create builder | `buildCommentPin` (`create.ts:164`, already `type=comment`/`kind=rect`/`body=""`) | feed it the drawn drag rect instead of a point |
| Box drag gesture | `useBoxGesture` (draft→preview→commit, abort, capture, page-clamp) | a `boxMode` param + a builder branch |
| Region fill render | `regionMarks` branch (`AnnotationLayer.tsx:123`, already includes `type=comment`) | nothing |
| Comment pin + bubble | `renderComment` + `CommentBubble` (rect-aware, 2.10) | nothing |
| Move/resize the region | the Story 3.1 rect edit frame (`movable = kind==="rect"`) | nothing |
| Bank (list + filter + sort) | `type=comment` → 8.2 filter default + 8.3 `anchorTopLeft` (kind=rect) | nothing |
| Command path / undo | `addAnnotation` → zundo temporal (AR-7) | nothing |
| Tool state / mode flag | `boxHighlight` pattern (state + reset effect + flyout Text/Box picker) | `boxComment` twin |
| Box vs text-create arbitration | the pen/memo early-return in `useCreateQuickBox.onPointerUp` | a box-mode early-return |

Resist: a new store action (`retypeRegion` was deleted, and none is needed — `buildCommentPin` builds the final mark directly); a second box gesture (parametrize the one you have); resurrecting the region quick-box / region tool-type picker (removed in 2.11's revision); a `boxComment` keymap action (D4); any render/CSS/contract change (D5); a convert-based two-step (Story 3.7 convert stays as-is for text highlights, but box-comment creates the mark directly).

### Integration points (the seams)

- `client/src/annotations/gestures/useBoxGesture.ts` — `boxMode` param + `buildCommentPin` branch (Task 1).
- `client/src/annotations/gestures/useCreateQuickBox.ts` — `boxActive` opt + early-return in `onPointerUp`/`onPointerDownCandidate` (Task 2, D3).
- `client/src/annotations/AnnotationInteraction.tsx` — `boxActive` prop → `boxMode`; wire both hooks (Task 2).
- `client/src/components/Reader/Reader.tsx` — `boxActive` prop → `boxMode` passthrough (Task 3).
- `client/src/reader/ReaderPage.tsx` — `boxComment` state + reset + `boxMode` derivation + ToolRail props (Task 3).
- `client/src/components/ToolRail/ToolRail.tsx` — Comment flyout Text/Box picker (Task 4).
- `client/src/annotations/create.ts` — NO change (`buildCommentPin` already exists).
- `client/src/annotations/AnnotationLayer.tsx` — NO change (region fill + comment pin/bubble already render `kind=rect` comments).
- `client/src/store/index.ts` — NO change (reuse `addAnnotation`/`retextAnnotation`/`recolorAnnotation`/`deleteAnnotation`).

### Engineering conventions in force (CLAUDE.md#Engineering-principles)

- **Adopt-stable / one model:** parametrize the one box gesture; reuse the region fill, comment pin/bubble, rect edit frame, Bank filter/sort, and command path. New = a `boxComment` mode flag + a builder branch + a flyout picker. [[prefer-stable-solutions]]
- **Document-level handlers (AP-1):** the box gesture + the create-quick-box listeners already bind on `document`, phase-gated. The box-mode early-return in `useCreateQuickBox` keeps its arbitration document-level. [[held-key-state-reset-on-blur]]
- **`render/` mock-barrel sync (AP-2):** no new `render/index.ts` export → both `vi.mock("@/render")` barrels untouched. Confirm.
- **HiDPI live smoke (highest-risk path):** box-comment is a placed-geometry drag; live-smoke the drag, the fill (no page displacement), the pin→bubble, recolor/delete, the box↔text mode switch (no double-create), and zoom-glue at DPR>1. jsdom zeroes rects — assert the MODEL in unit tests, prove geometry LIVE. [[verify-on-hidpi-and-real-host]]
- **Cross-model code review (AP-3):** run `bmad-code-review` (Codex) after dev-story; the D3 double-create seam is the finding magnet.

### Testing standards

Frontend Vitest + jsdom: assert the MODEL/wiring — the box-comment create call (`type:"comment"`/`kind:"rect"`/`body:""`/`defaults.colors.comment`), the `boxMode` branch, the `useCreateQuickBox` box-mode suppression (exactly one mark from a box-comment drag), the flyout Text/Box picker, the `boxComment` reset — NOT pixel geometry (jsdom zeroes rects). Drive the box drag via synthetic pointerdown→move→up with a ≥`BOX_DRAG_THRESHOLD` delta, matching the existing box-highlight tests. Backend: no model/contract change; nothing to run.

### Project Structure Notes

- Touches the composition root (`ReaderPage`), `Reader`, the rail (`ToolRail`), and `annotations/gestures/` (`useBoxGesture`, `useCreateQuickBox`) + `AnnotationInteraction`. No `render/`/`anchor/`/store-schema/contract change (AD-9 downward rule intact; store actions reused).
- No new files. No new top-level dirs.
- Versioning: PATCH +1 at PR merge → `server/pyproject.toml` `0.5.15 → 0.5.16` (the sole version source).

### References

- [Source: .bmad/planning-artifacts/epics.md#Story 8.4 (line 1996)] — canonical AC set; note AC-1's "region quick-box comment option" is realized as the Comment tool's box mode (the region quick-box was removed in 2.11's revision — see Context); "verify what Story 2.11 actually shipped and close the gap" (line 2021).
- [Source: .bmad/planning-artifacts/sprint-change-proposals/sprint-change-proposal-2026-07-11-epic-8-9-stories.md] — provenance; FR-25 = comment on a region; Epic 8 broadened charter.
- [Source: .bmad/implementation-artifacts/epic-2/2-11-box-select-a-region.md] — the POST-REVIEW REVISION (top of file): box-comment + region picker + `retypeRegion` REMOVED; box-highlight relocated to a MODE of the Highlight tool (`boxHighlight` flag, Highlight flyout Text/Box picker, `BoundingBox` icon). This story mirrors that for Comment.
- [Source: .bmad/implementation-artifacts/epic-2/2-10-comment-highlight-pin-bubble.md] — the comment pin + `CommentBubble` (rect-aware); `buildCommentPin`; the bubble replaces the selection quick-box for comments; empty comment is KEPT.
- [Source: client/src/annotations/gestures/useBoxGesture.ts] — the gesture to generalize (`boxActive` → `boxMode`; commit at `:111`).
- [Source: client/src/annotations/gestures/useCreateQuickBox.ts] — the text-comment drag (`createTextTool`, `:187`) + click-pin (`:301`) paths to suppress under box mode; the pen/memo early-return at `:262` is the pattern to follow.
- [Source: client/src/annotations/create.ts:164] — `buildCommentPin` (`type=comment`, `kind=rect`, `body=""`), fed the drag rect.
- [Source: client/src/annotations/AnnotationLayer.tsx:123 (regionMarks), :316 (renderComment)] — the render that already paints a `kind=rect` comment (fill + pin + bubble + movable frame); no change.
- [Source: client/src/reader/ReaderPage.tsx:67 (boxHighlight state), :68 (reset effect), :250 (boxHighlight keymap action), :409 (boxActive derivation)] — the box-highlight wiring to twin.
- [Source: client/src/components/ToolRail/ToolRail.tsx:259 (Highlight flyout Text/Box picker), :446 (Comment flyout)] — the picker to mirror into the Comment flyout.
- [Source: client/src/lib/bank.ts (anchorTopLeft, kind=rect)] — why the Bank sort (8.3) handles the region comment for free.
- [Source: client/src/store/index.ts] — `addAnnotation` mutates the zundo temporal `annotations` slice (command path, AR-7); reused for undoable create.
- FR-11/FR-12 (annotate; area/box selection), FR-25 (comment on a region), AR-5 (`comment → text|rect`), AR-7 (single command path / undo), AR-12 (Bank view state), AD-11 (single `activeTool`; box is a mode), NFR-1 (no reflow), NFR-3 (zoom-glue), UX-DR8/DR17 (bubble open/keyboard/Esc/focus).

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (xHigh)

### Debug Log References

- Live smoke (Task 6, 2026-07-12): initial attempt reused the host's already-running Docker backend on `:8000` by mistake (this session's own `uv run uvicorn --port 8000` failed to bind — `[Errno 98] address already in use` — and silently kept serving from the pre-existing container against the user's real `~/.paper-mate` library). Caught before any write, by checking `ps aux` for the bound PID and its cwd. Recovered by starting a genuinely own-owned pair: `uv run uvicorn --port 8010` with `PAPER_MATE_DATA` set to a scratchpad dir, and `vite --port 5180` with `PAPER_MATE_API_TARGET=http://127.0.0.1:8010`.
- Live smoke: `.click()`-based DOM calls on the comment pin (a React `onClick`) require an actual trusted-enough click (`element.click()`), not a synthetic `PointerEvent` pair — the box/pen/quick-box gestures listen on raw `document` pointer events so synthetic `PointerEvent`s work for those, but the pin's select-on-click needed the DOM `.click()` method. Also: post-action DOM/store reads must happen in a SEPARATE `evaluate_script` call, not the same one that fired the action — React's state update had not flushed yet within the same synchronous script execution, producing several false "nothing happened" reads that were actually just timing.

### Completion Notes List

- Implemented per Design D1-D5 exactly as specced: `useBoxGesture`'s `boxActive: boolean` generalized to `boxMode: BoxMode | null` (`BoxMode = "highlight" | "comment"`), branching the builder (`buildRegionAnnotation` vs `buildCommentPin`) and color (Highlight's vs Comment's remembered default) on commit; `useCreateQuickBox` gained a `boxActive` opt with early-returns in `onPointerUp`/`onPointerDownCandidate` (Design D3); `ReaderPage` derives one `boxMode` from `activeTool` + `boxHighlight`/`boxComment`; `ToolRail`'s Comment flyout got a Text/Box picker mirroring Highlight's.
- One addition beyond the story's task list: the `boxPreview` rubber-band's `borderColor` (in `AnnotationInteraction.tsx`) was hardcoded to `activeColors.highlight` regardless of mode — branched it on `boxMode` so a box-comment drag previews in the Comment tool's own color, not Highlight's. Same branch pattern the builder already uses; no new render primitive.
- `BoxMode` is exported from `annotations/index.ts` (new symbol, not a `render/` export) so `Reader.tsx` can type its `boxMode` prop without reaching into `annotations/gestures/` directly (AD-9 layering) — confirmed both `vi.mock("@/render")` barrels (`App.test.tsx`, `Reader.test.tsx`) needed no changes.
- Full regression green: `npm run typecheck` clean, `npm test` 68 files / 1413 tests passing (including `no-raw-values`), contract byte-identical (`git diff 7046832..HEAD -- client/src/api/schema.d.ts server/openapi.json` empty — no server/contract touch, D5). `server/uv.lock` re-synced via `uv lock` to match the `0.5.16` `pyproject.toml` bump (it had drifted to `0.5.14` on disk before this story).
- Live smoke (Task 6) fully passed all sub-items (a)-(i) on the "Microsoft COCO" 15-page fixture at DPR=2, using an isolated scratch `PAPER_MATE_DATA` so the user's real library was never touched (see Debug Log). Screenshot saved to `.bmad/implementation-artifacts/8-4-region-comment-smoke.png`.

### File List

- `client/src/annotations/gestures/useBoxGesture.ts` (modified — `boxMode` generalization, Task 1)
- `client/src/annotations/gestures/useCreateQuickBox.ts` (modified — `boxActive` suppression, Task 2)
- `client/src/annotations/AnnotationInteraction.tsx` (modified — `boxMode` prop + wiring + preview color branch, Task 2)
- `client/src/annotations/index.ts` (modified — re-export `BoxMode`)
- `client/src/components/Reader/Reader.tsx` (modified — `boxMode` prop passthrough, Task 3)
- `client/src/reader/ReaderPage.tsx` (modified — `boxComment` state + reset + `boxMode` derivation + ToolRail props, Task 3)
- `client/src/components/ToolRail/ToolRail.tsx` (modified — Comment flyout Text/Box picker, Task 4)
- `client/src/annotations/AnnotationInteraction.test.tsx` (modified — updated `boxActive`→`boxMode` call sites + new box-comment/D3-suppression tests, Task 5)
- `client/src/components/ToolRail/ToolRail.test.tsx` (modified — `boxComment`/`onSetBoxComment` prop plumbing + new Comment flyout tests, Task 5)
- `client/src/reader/ReaderPage.test.tsx` (modified — new box-comment mode + mutual-exclusion tests, Task 5)
- `client/src/annotations/README.md` (modified — Story 2.11 section updated for the box-comment generalization, Task 7)
- `server/pyproject.toml` (modified — version `0.5.15` → `0.5.16`, Task 7)
- `server/uv.lock` (modified — re-synced to `0.5.16`)
- `.bmad/implementation-artifacts/8-4-region-comment-smoke.png` (added — Task 6 live-smoke screenshot)

## Change Log

| Date | Change |
|------|--------|
| 2026-07-12 | Story created (ready-for-dev) via bmad-create-story. Box comment = a MODE of the Comment tool (twin of box-highlight); `useBoxGesture` generalized to `boxMode: "highlight"|"comment"`; reuses `buildCommentPin` + the existing region-fill/comment-pin/bubble render + Bank filter/sort + command path. Client-only, contract byte-identical. |
| 2026-07-12 | Implemented Tasks 1-7: generalized `useBoxGesture` (D2), added D3 create-suppression to `useCreateQuickBox`, threaded `boxMode`/`boxComment` through `AnnotationInteraction`/`Reader`/`ReaderPage`, added the Comment flyout's Text/Box picker to `ToolRail` (D1), full test coverage, live smoke on a real multi-page paper at DPR>1, docs + version bump (`0.5.15` → `0.5.16`). All ACs verified; ready for review. |
