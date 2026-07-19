# Epic 8: Reader & annotation polish, round 2 (post-v1, Phase-1.5)

> Added 2026-07-07 via correct-course (`sprint-change-proposal-2026-07-07-deferred-review.md`) as Epic 12; RENUMBERED Epic 12 → Epic 8 on 2026-07-11 (correct-course: Remote sync un-numbered, this took its slot). A deferred-work review removed every reader-fidelity item that had since shipped (4.1 copy/selection + de-flake, 4.2A gutter split, 3.7 convert, 5.1 settings, 5.5 hide-all, 5.6 layered-Esc, 5.0/5.3/5.4 refactors, 3.1 memo move/resize, 7.8 Starred-lens column) and promoted the one still-open, still-wanted reader bug (Story 8.1). **BROADENED 2026-07-11 via correct-course (`sprint-change-proposal-2026-07-11-epic-8-9-stories.md`):** the epic's original "fix correctness, add no capability, no new FRs" charter is RETIRED. From a ten-request user batch (whose three heavyweight Phase-2 features were split into the new Epic 12), this epic now also holds Annotation-Bank capability (filter + reading-order sort), the comment-on-region completion, a Library venue-display refinement, and three reader defects. Story 8.1 (paragraph-aware copy) is kept verbatim; 8.2–8.8 are the new polish/defect stories. New reader FRs: FR-23 (Bank filter), FR-24 (Bank sort), FR-25 (comment on a region). Sequenced post-v1. **Broadened again 2026-07-12 via correct-course** (`sprint-change-proposal-2026-07-12-epic-8-snap-select-refactor.md`): Story 8.9 spikes a snap-to-nearest-text UX for the Story 8.8 empty-space-origin case (investigation-first, may end in a documented discard); Story 8.10 is the epic's structural-refactor pass, same footing as Stories 5.0/5.3/5.4/6.8, sequenced last.

## Story 8.1: Paragraph-aware copy (join soft-wrapped lines)

> deferred-work: "copied single-visual-line text copies as MULTIPLE clipboard lines" (2026-07-07). This is the mirror-image regression of the 4.1 fix: Story 4.1 faithfully reproduced pdf.js's `TextLayer`, which appends a `<br role="presentation">` after every text item with `hasEOL: true`. A PDF marks EVERY visually distinct line `hasEOL` (it carries no paragraph metadata), so a paragraph that soft-wraps across several lines now copies with a hard line break at every wrap, not just at real paragraph ends. Confirmed upstream (Firefox's built-in pdf.js viewer has the identical characteristic), not a Paper Mate regression.

As a reader,
I want a soft-wrapped paragraph to copy as one continuous line,
So that pasting a passage keeps real paragraph breaks but joins wrapped lines with a space instead of a hard newline.

**Acceptance Criteria:**

**Given** a selection spanning a paragraph that soft-wraps across several visual lines
**When** I copy it
**Then** the clipboard text joins the wrapped lines with a single space (no hard `\n` mid-paragraph); a genuine paragraph break still copies as a line break (FR-2, AR-2)

**Given** the fix must distinguish a soft wrap from a real break
**Then** it applies a paragraph-vs-wrap HEURISTIC over pdf.js's per-line geometry (e.g. consecutive lines' Y-gap vs the page's typical line-height, left-margin/indent alignment, trailing punctuation), since pdf.js's `hasEOL` alone cannot tell them apart, and only the geometry-derived "real break" keeps a `\n` (FR-2)

**Given** the risk that any heuristic has false positives/negatives
**Then** the story STARTS with a small spike: prototype the Y-gap/indent heuristic against 2–3 real papers (multi-column, justified, and indented-paragraph layouts) and validate before committing to the full implementation; the AC-1 join behavior is verified by copying a wrapped passage from a real paper and diffing against the intended single-line result, not only a unit test

**Given** the fix
**Then** it stays in `render/` (the text layer's owner, alongside Story 4.1's `render/textSelection.ts`), no annotation/anchor/store change; highlight/underline geometry (per-line rects via `anchor/collectTextRects`) is unaffected, and it does NOT reintroduce the 4.1 inter-line-space or trailing-punctuation defects (AR-9, regression-guard on 4.1)

> **Out of scope (this story):** OCR / scanned-PDF handling (no geometry to read); reflowing or editing the PDF; any change to stored `anchor.text` semantics beyond what the copy path already captures. **Open design calls for create-story:** the exact heuristic signals + thresholds (settle in the spike); whether an ambiguous line defaults to join or break; whether to expose the raw-vs-joined behavior as a preference (default: joined, matching normal reader/browser copy).

## Story 8.2: Annotation Bank filter by type (default comments) (added 2026-07-11)

> User request: "the Annotation Bank should include all annotation types and let me filter by type, defaulting to comments only." Extends Story 3.6 (Bank lists each mark, ordered by `created_at`) and lifts the PRD's "v1 Bank is list + jump only, no filter" note. New **FR-23**.

As a reader,
I want the Annotation Bank to list every annotation type and let me filter by type, starting with comments only,
So that I can focus on the annotations that matter to me without wading through every mark.

**Acceptance Criteria:**

**Given** a document with marks of several types (highlight, underline, pen, memo, comment, region)
**When** the Bank is open
**Then** it can list ALL types (each as `{component.bank-list-item}` with its type glyph + color dot + snippet + page), not only some (FR-19, FR-23, UX-DR9)

**Given** the Bank
**Then** a filter control selects which types are shown; the DEFAULT on open is comments only, and the reader can widen it to any subset or all types (FR-23, UX-DR9)

**Given** a filter that hides every mark of a type
**Then** the visible list updates without reflowing the canvas, and an empty result shows an empty-state message (e.g. "No comments yet." adapting to the active filter) (FR-23, NFR-1, UX-DR18)

**Given** the filter selection
**Then** it is view state (client-only); it does not mutate, reorder, or persist the annotation set, and it composes with the Story 8.3 sort (FR-23, AR-12)

**Given** any new control label, tooltip, or empty-state copy
**Then** no string contains an em-dash (UX-DR13)

> **Out of scope:** in-bank editing, search, export (still deferred). **Open design calls for create-story:** the filter control shape (chips vs a multi-select menu); whether the comments-only default is remembered per session; exact empty-state copy per filter.

## Story 8.3: Sort annotations in reading order (added 2026-07-11)

> User request: "annotations sorted by page and their position on the page so that they follow the paper's reading order." Story 3.6 orders the Bank by `created_at` ascending; this changes the default ordering to spatial reading order. New **FR-24**.

As a reader,
I want Bank annotations ordered by page and then by their position on the page,
So that they follow the paper's reading order instead of the order I happened to create them.

**Acceptance Criteria:**

**Given** annotations across several pages
**When** the Bank lists them
**Then** they sort by page ascending, then by on-page position within a page (top-to-bottom by the mark's anchor Y, then left-to-right by X for ties), so the list reads in paper order (FR-24, AR-12)

**Given** a mark spanning a page boundary (a `group_id` split, AR-4)
**Then** it sorts by its first (top-most, earliest-page) rect so a multi-page mark appears once at its start (FR-24, AR-4)

**Given** a region (`kind=rect`) or pen (`kind=path`) mark
**Then** its sort position derives from its bounding-box top-left, consistent with text marks (FR-24)

**Given** the reading-order sort
**Then** it composes with the Story 8.2 type filter and stays client-only view state (no store/contract change) (FR-24, AR-12)

> **Out of scope:** a user-selectable sort menu (created-at vs reading-order) unless create-story decides reading-order should be a toggle rather than the sole order. **Open design calls:** whether reading-order fully replaces `created_at` ordering or is the new default with `created_at` as an option; the exact tie-break epsilon for near-equal Y.

## Story 8.4: Comment on a boxed region (added 2026-07-11)

> User request: "attach a comment to a boxed highlight so that I can annotate a specific visual region." Completes the seam Story 2.11 reserved (the region quick-box was speced to offer "comment") on the model Story 2.10 already supports (`type=comment`, `anchor kind=rect`). New **FR-25**.

As a reader,
I want to attach a comment to a boxed region,
So that I can annotate a specific visual area (a figure, a table, a diagram) the way I comment on text.

**Acceptance Criteria:**

**Given** a boxed region (Story 2.11, `anchor kind=rect`) armed or selected
**When** I choose the region quick-box's "comment" option
**Then** a comment is attached to that region: `type=comment`, `anchor kind=rect {rect}`, `body=text`, created through the command path (FR-11, FR-12, FR-25, AR-5, AR-7)

**Given** a region comment
**When** I click its pin/marker
**Then** a `{component.comment-bubble}` opens over the region for read/edit, keyboard-reachable and `Esc`-dismissable, focus moving in on open and back on close, without reflowing the canvas (FR-25, UX-DR8, UX-DR17, NFR-1)

**Given** a region comment
**When** I zoom
**Then** the region box and its comment marker stay anchored at their exact PDF coordinates (NFR-3)

**Given** a region comment
**Then** it appears in the Annotation Bank (respecting the 8.2 filter as a comment) and sorts by the region's top-left in 8.3's reading order (FR-19, FR-24)

> **Out of scope:** a snapshot/thumbnail of the region (reserved for Phase 2 per Story 2.11); commenting on non-rect, non-text marks. **Open design calls:** verify what Story 2.11 actually shipped for the region quick-box "comment" option and close the gap; the region-comment marker placement (corner pin vs centered) and how it reads distinctly from a text comment.

## Story 8.5: Venue short name displayed, full name accessible (added 2026-07-11)

> User request: "publication venues display a shortened name while keeping the full name accessible, so paper details stay compact but clear." Refines the Story 7.9 Venue column (LFR-32). No new FR.

As a reader,
I want the Venue column to show a shortened venue name with the full name still available,
So that the table stays compact without losing the exact publication name.

**Acceptance Criteria:**

**Given** a paper with a known venue
**When** the Venue cell renders
**Then** it shows a shortened form (e.g. Crossref `short-container-title`, or a derived abbreviation when no short form exists), while the full venue name is accessible on hover/focus via `title` (LFR-32)

**Given** the Crossref enrichment path (Story 7.9's `enrich()`)
**Then** if `short-container-title` is captured, it is additive to `ExtractedMeta`/`DocMeta` (no `schema_version` bump; existing `meta.json` missing it still validates) and projected onto `CollectionRow`/`docs/API.md` like the existing venue field (LFR-32, AL-1)

**Given** a paper with no short form
**Then** the cell falls back to the full venue name (or a client-derived abbreviation), never blank when a full venue exists (LFR-32)

**Given** sorting/filtering on Venue
**Then** it behaves consistently with the chosen display value (decide short vs full as the sort key at create-story) (LFR-32)

**Given** the short/full display strings
**Then** neither contains an em-dash (L-UX-DR13)

> **Out of scope:** backfilling short names for already-imported papers; a curated venue-abbreviation dictionary beyond Crossref's `short-container-title` + a simple derivation. **Open design calls:** short-name source (Crossref `short-container-title` captured server-side vs a client-side abbreviator); whether sort/filter key on short or full; whether existing rows re-enrich.

## Story 8.6: Comment/memo preview size reflects its adjusted full size (added 2026-07-11)

> User request: "a comment box's preview size should reflect its adjusted full size, so its appearance stays consistent between collapsed and expanded views." Defect on the memo/comment preview render (Story 2.9 memo + 2.10 comment + the 3.1 corner-resize; the preview render lives in `AnnotationInteraction`, `position:fixed`). No new FR.

As a reader,
I want a comment's collapsed preview to match the size I adjusted its full view to,
So that its collapsed and expanded appearances stay consistent instead of snapping to a different size.

**Acceptance Criteria:**

**Given** a comment/memo whose full size was adjusted (resized via the Story 3.1 corner handles)
**When** it renders in its collapsed/preview state
**Then** the preview reflects the adjusted full size (its stored geometry), not a fixed preset, so collapsed and expanded read as the same box (FR-11, FR-15)

**Given** the adjusted size
**When** I reload and the mark is restored (Story 3.5)
**Then** the preview still reflects the persisted adjusted size (NFR-3, AR-6)

**Given** the preview render
**Then** it stays within the fixed-overlay render path (no page reflow, no page-edge clipping regression) (NFR-1)

> **Open design calls for create-story:** confirm whether "comment box" here means the textbox memo (2.9), the comment bubble (2.10), or both; the exact collapsed-vs-expanded states in play and which dimension (width/height) the preview must track; whether a min/max preview clamp applies.

## Story 8.7: Immediate viewer resume on tab return (added 2026-07-11)

> User request: "the paper viewer should respond immediately when I return from another browser tab, so my reading flow is not interrupted by lag." Defect: a stall on tab re-focus. Investigation-first. No new FR (defends NFR-2).

As a reader,
I want the viewer to respond immediately when I switch back from another browser tab,
So that returning to the paper does not pause or lag.

**Acceptance Criteria:**

**Given** the reader open on a paper
**When** I switch to another browser tab and back
**Then** the viewer is interactive immediately on return, with no multi-frame stall before scroll/zoom/annotate respond (NFR-2)

**Given** the story
**Then** it STARTS with a root-cause diagnosis (background-tab rAF/timer throttling, the Story 1.7 render windowing recomputing all visible pages on re-focus, a paused render queue draining as a burst, or a stale-layout reflow) before committing a fix, since the mechanism determines the fix (NFR-2)

**Given** the fix
**Then** it is verified live by backgrounding and re-focusing the tab on a large (50+ page) paper at DPR>1, not only in a unit test

**Given** the fix
**Then** it does not regress scroll/zoom smoothness or the render-windowing behavior during normal (non-tab-switch) reading (NFR-2)

> **Open design calls:** the actual root cause (settle in the diagnosis); whether the fix is in `render/` windowing, the rAF loop, or a `visibilitychange` handler.

## Story 8.8: Empty-space drag does not select underlying text (added 2026-07-11)

> User request: "dragging from empty page space should avoid selecting or copying underlying rows, so accidental selections do not occur." Defect adjacent to the deferred blank-space/multi-column selection note (deferred-work "story 2-5 blank-space text selection"). Scope-guarded to NOT reopen the full multi-column controller. No new FR (defends FR-13's intent).

As a reader,
I want a drag that starts in empty page space to do nothing to the text,
So that I do not accidentally select or copy the nearby text lines.

**Acceptance Criteria:**

**Given** the pointer over empty page space (a margin/gutter/blank area with no glyph under it)
**When** I press and drag from there
**Then** it does NOT start a text selection that snaps to and grabs the nearest text lines ("rows"), so no accidental selection/copy of underlying text occurs (FR-13)

**Given** a drag that starts ON text
**Then** normal text selection is unchanged (this story only gates the empty-space ORIGIN case) (FR-13)

**Given** the empty-space drag
**Then** its behavior is defined (a no-op, or defers to the active tool such as pan/box) rather than a native text selection, decided at create-story (FR-13)

**Given** the change
**Then** it is live-smoked with an empty-margin drag AND a cross-column empty-gutter drag at DPR>1, and it does NOT reintroduce the full-page-highlight or cross-column leak the anchor layer guards

> **Scope guard:** this is the narrow "empty-space drag origin" fix, NOT the deferred layered multi-column selection controller (that stays deferred). **Open design calls:** confirm "underlying rows" = PDF text lines (assumed) vs any table/list surface; the exact empty-space behavior (no-op vs tool-defer); how "empty space" is detected (no text node hit vs geometry).

## Story 8.9: Snap empty-space drag to nearest text (spike) (added 2026-07-12)

> User request: instead of a no-op (Story 8.8's AC-3 design call), a drag starting in blank space next to text should snap to the nearest text — starting from the end of the preceding line when dragging down, or ending there when dragging up. Not virgin territory: `deferred-work.md` documents four prior column-aware/snap-selection attempts, all built and reverted (`03d471b`, `a294ca9`), and a hard Chromium `caretRangeFromPoint`/`caretPositionFromPoint` corruption bug mid-drag (Story 3.8, also blocking Story 4.2 Part B). Those attempts needed CONTINUOUS column-aware tracking through an active cross-column drag; this ask only needs a ONE-TIME anchor resolution at gesture start — narrower, and closer to deferred-work's own named-but-untested escape route (AE3-7: "resolve once, not continuously") than to the discarded controller. Investigation-first, same pattern as Story 8.7 and the Story 4.2 Part B design-gate: a negative result is a valid, complete outcome for this story. No new FR yet — assigned at create-story only if the spike validates, mirroring how 8.2-8.4 earned FR-23/24/25 once their design was committed.

As a reader,
I want a drag that starts in empty page space to snap its selection to the nearest text instead of doing nothing,
So that the gesture works the way I'd expect on a page with visible text nearby.

**Acceptance Criteria:**

**Given** the empty-space-origin no-op behavior Story 8.8 shipped
**Then** this story STARTS with a design/prototyping spike, not a committed implementation: prototype ONE candidate technique for resolving a stable nearest-text anchor from an empty-space pointerdown, and live-smoke it against a real two-column paper at DPR>1 across REPEATED drags in the same session — not only a fresh page load, since the Story 3.8 caret corruption needs prior interaction to manifest and a fresh-load-only test would falsely pass

**Given** the two candidate techniques named in `deferred-work.md`
**Then** the spike evaluates `caretRangeFromPoint`/`caretPositionFromPoint` resolved EXACTLY ONCE at pointerdown, before any drag motion begins, FIRST (cheapest to prototype, untested per AE3-7), and only invests in the manual `Range` + `getClientRects()` binary-search alternative (avoids the caret-API family entirely) if the caret approach fails live smoke

**Given** a validated technique
**Then** the fix resolves the nearest text position EXACTLY ONCE at gesture start — never continuously mid-drag, unlike the four discarded multi-column attempts — and hands off to native `Selection`/`Range` extension for the rest of the gesture: dragging down from blank space starts the selection at that resolved point and extends downward; dragging up extends the anchor/focus the same way normal reverse-direction selection already does. One resolved point + `Selection.collapse` to it covers both directions symmetrically; no separate up/down branch is needed

**Given** "nearest text" must not reopen the abandoned controller
**Then** it resolves to the nearest glyph in the SAME column/line context as the empty-space origin (not the arbitrary next node in raw DOM order that produced the Story 8.8 defect); this story does NOT attempt cross-column-aware selection DURING a drag, only a single-shot anchor resolution AT THE ORIGIN

**Given** the spike's outcome is genuinely uncertain
**Then** if BOTH techniques fail live smoke (the Story 3.8 corruption recurs, or the manual binary search proves unreliable or too slow), the story documents the negative result in `deferred-work.md` with the same rigor as the Story 4.2 Part B write-up, and Story 8.8's no-op stays the shipped baseline — a complete, acceptable outcome, not a failed story

**Given** any implementation lands
**Then** it does not regress Story 8.8's guarantees: an on-text drag origin is unaffected (8.8 AC-2), and a cross-column empty-gutter drag still does not leak a cross-column or full-page highlight (8.8 AC-5), live-smoked at DPR>1 exactly as 8.8 was

**Given** any new user-facing string (none expected)
**Then** it contains no em-dash (UX-DR13)

> **Out of scope:** reopening the full multi-column drag-select controller (continuous column-aware tracking during an active cross-column drag) — stays deferred per `deferred-work.md`. **Open design calls for create-story:** the exact binary-search algorithm if the caret approach fails; whether "nearest" means nearest-in-reading-order or nearest-by-Euclidean-distance when the blank point is equidistant between two lines; the time/attempt budget before declaring the spike discarded again.

## Story 8.10: Epic 8 structural refactor (added 2026-07-12)

> User request: reduce code complexity and unify Epic 8's code into OOP objects, same footing as Stories 5.0/5.3/5.4 (Epic 2/5-era refactor) and Story 6.8 (the Epic 6 Library refactor) — a per-epic cleanup pass, its own PR(s), never folded into a feature story. Sequenced last so its scope reflects whatever Story 8.9 actually adds (or doesn't). No new FR, no behavior/contract change.

As a developer-user,
I want the code Epic 8 added or touched unified behind clear OOP boundaries with reduced conditional sprawl,
So that the next reader-polish epic builds on cohesive modules instead of accreting patches onto the same god-files.

**Acceptance Criteria:**

**Given** every file touched by Stories 8.1-8.9 (finalize the list once 8.9 lands or is discarded)
**Then** each is audited for the same code smells Stories 5.3/6.8 targeted: god-objects/god-functions doing more than one concern, near-duplicate conditional branches that should be one descriptor/registry (mirroring the AD-5 `anchor.kind`-keyed dispatch pattern already established), and any coordinate math computed outside `anchor/` (AD-9 boundary check)

**Given** `render/textSelection.ts` has accreted Story 4.1 (endOfContent bounding), Story 8.1 (copy/paragraph-join), Story 8.8 (empty-origin gate), and possibly Story 8.9 (anchor resolution) as one flat class with growing private state
**Then** it is decomposed along cohesive OOP lines — one class/module per concern (layer registry, selection-bounding, copy-interception, origin-gating), each with a narrow single-purpose interface, wired together by one composing controller — the same encapsulation approach Story 5.3 applied to Reader/AnnotationLayer/AnnotationInteraction

**Given** the Annotation Bank gained a type-filter (8.2) and a reading-order sort (8.3) as client view-state
**Then** they are unified behind one composable view-state model (filter and sort composing cleanly, per 8.3's own AC) rather than two independent conditional passes over the list

**Given** this is a pure refactor thread, same footing as Stories 5.0/5.3/5.4/6.8
**Then** it changes NO behavior and NO contract: every existing Epic 1-8 test still passes unmodified in intent (tests may move or rename to follow new module boundaries, but assertions don't change), and there is no anchor/store/API-contract change

**Given** the refactor
**Then** it lands in its own PR(s), separate from any feature story, per the established Story 5.0/5.3/5.4/6.8 precedent — never folded into a feature story

> **Out of scope:** any new capability; touching client/server modules Epic 8 did not touch; the still-deferred multi-column selection controller and cross-type unified hit-layer (those stay in `deferred-work.md`, tracked separately, not incidentally swept up here). **Open design calls for create-story:** the exact module boundaries for the `textSelection.ts` split; final scope depends on Story 8.9's/8.11's outcome (sequenced after them for exactly this reason).

## Story 8.11: Snap empty-space drag to nearest text — attempt 2 (added 2026-07-12)

> Follow-up to Story 8.9, which closed NEGATIVE (both named techniques failed: `caretRangeFromPoint` poisons mid-session; the manual-Range resolver is correct but native drag-select won't ARM from an off-glyph mousedown). 8.9 is NOT reopened — this is a fresh attempt on an approved design (`docs/superpowers/specs/2026-07-12-snap-empty-space-drag-to-text-design.md`). The reframe: the create/preview/copy pipeline already runs off native `window.getSelection()`, so the drag doesn't need native to ARM a selection — it needs one to EXIST. Approach is a spike-with-fallback (sequence A → B): a decision-gate probe seeds a native selection during the drag via the working 8.9 resolver + `setBaseAndExtent` (Method A, tiny — everything downstream free), gated on whether the selection survives the browser's collapse-on-release; a deterministic own-overlay + build-from-endpoints path is the fallback (Method B) if it doesn't. Sequenced BEFORE Story 8.10 so 8.10's `textSelection.ts` refactor absorbs the snap. A negative outcome remains complete/acceptable (write up, keep 8.8's no-op). No new FR unless it validates in live smoke. Full ACs + Dev Notes in the story file (`.bmad/implementation-artifacts/8-11-snap-empty-space-drag-to-text-attempt-2.md`).

As a reader,
I want a drag that starts in empty page space to snap its selection to the nearest text and behave like a normal on-text drag,
So that the gesture works the way I'd expect on a page with visible text nearby.

> **Out of scope:** the continuous column-aware drag-select controller / column-band rect clipping (the reverted-attempts class, stays deferred); the caret-API family (dead per 8.9). **Depends on:** Story 8.9's findings (resolver + native-arm blocker). **Blocks:** Story 8.10 (refactor absorbs this story's additions).
