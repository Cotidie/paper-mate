# Epic 9: Reader & annotation polish, round 3 (post-v1, Phase-1.5)

> Added 2026-07-18 via correct-course (`sprint-change-proposal-2026-07-18.md`). From a 13-request user batch, this epic holds the reader/annotation **defects**, small **polish**, and three small **persistence** features; the three heavyweight new capabilities (textbox, image, clipboard) split into Epic 11, and the Library download (item 13) amended Story 12.1. Same split-by-weight precedent as the 2026-07-11 batch (polish stayed in Epic 8, heavyweight went to Epic 12). Three stories carry a new reader FR (proposed FR-31/32/33), recommended into a reader-PRD addendum before dev; the rest are quality-of-existing-FR (no new FR). Story 9-9 is the epic's terminal structural-refactor pass, same footing as Stories 5.0/5.3/5.4/6.8/8.10 (AE7-5: refactor as the last story so it absorbs the whole epic's debt). Sequenced post-v1; Epic 9 runs before Epic 11 (defects first, heavy capabilities after).

## Story 9.1: Unify selection color and fix double-thickening over punctuation/whitespace (items 1+2)

> User request (item 1): "mid-selection and post-mouse-up must not thicken; unify the selection color." User request (item 2): "some letters, especially over a `.` or the whitespace after it, are twice-thickened; find the root cause and fix." One root-cause story: both are the same rendering surface (the native `::selection` tint plus the per-line highlight rects that stack alpha where sub-ranges overlap). Touches `render/selectionBounder.ts` (Story 4.1 `endOfContent` bounding) and the per-line rects from `anchor/collectTextRects`. Defect, investigation-first. No new FR (defends FR-7/FR-8, NFR-3).

As a reader,
I want the selection tint to stay one uniform color and never darken on release or double up over punctuation,
So that reading stays comfortable and highlights look clean.

**Acceptance Criteria:**

**Given** an active text selection (mid-drag) and the same selection after mouse-up
**When** it is painted
**Then** the tint is ONE uniform color at ONE opacity, with no visible darkening or "thickening" step on release (item 1, FR-7/FR-8)

**Given** the story
**Then** it STARTS with a root-cause diagnosis: identify why release changes the appearance (native `::selection` vs the created-highlight fill vs an overlay double-paint) and why glyphs adjacent to a `.` or a whitespace render darker (overlapping/adjacent per-line sub-range rects stacking a semi-transparent fill), before committing a fix (item 2)

**Given** two per-line rects that abut or overlap at a punctuation/whitespace boundary
**Then** the fix stops the alpha from compounding (merge/clip adjacent rects, or paint the highlight as one opaque-composited layer) so every covered glyph shows the exact same tint density (item 2, NFR-3)

**Given** the fix
**Then** it is live-smoked on a real paper at DPR>1 across a selection that spans sentence-ending punctuation and inter-word spaces, confirming uniform density, and it does NOT regress the Story 4.1 trailing-band / inter-line-space fixes or the Story 4.2 column-aware geometry

> **Out of scope:** changing the selection color VALUE (this is about uniformity, not palette); the multi-column selection controller (stays deferred). **Open design calls for create-story:** whether the fix is CSS-only (`::selection` + highlight compositing) or needs a rect-merge pass in `anchor/`; whether "unify" means the live selection adopts the created-highlight color or vice versa.

## Story 9.2: Memo resize-handle position and minimum-size fix (item 3)

> User request: "the memo's two bottom handles are off their position; there is a fixed minimum height/width; examine and fix." Defect in the `MemoBox` edit-frame corner-handle geometry plus `resizeMemoAnnotation` (which regrows the rect from the top-left anchor). No new FR (defends FR-10/FR-15).

As a reader,
I want a memo's resize handles to sit exactly on its corners at any size,
So that I can grab and resize it precisely.

**Acceptance Criteria:**

**Given** a selected memo in its edit frame
**When** the corner handles render
**Then** all four (including the two bottom handles) sit exactly on the box corners at every size and zoom level, not offset from the box edge (item 3, FR-15, NFR-3)

**Given** the story
**Then** it diagnoses the offset cause (a min-height/min-width clamp fighting the handle placement, a border-box vs content-box mismatch, or a stale scale factor) before the fix (item 3)

**Given** the fixed minimum height/width
**Then** the memo can be resized down to a sensible smaller minimum (create-story sets the floor) without the handles detaching, and shrinking never clips the text-entry unusably (item 3, FR-10)

**Given** the fix
**Then** it is live-smoked at DPR>1 by resizing a memo from large to the new minimum and back, confirming handle tracking, and it does not regress the Story 3.1 memo move/resize command path or Story 8.6's preview-size behavior

> **Open design calls for create-story:** the exact new min width/height; whether the min is scale-1.0 px or CSS px; confirm the offset is geometry (handle placement) not a transform.

## Story 9.3: Hide the memo expand icon until hover or focus (item 4)

> User request: "the memo expand icon is always visible; hide it unless hovered or focused." Polish on the `MemoBox` chrome. No new FR (FR-10, UX minimal-chrome principle).

As a reader,
I want the memo expand icon hidden until I hover or focus the memo,
So that idle memos stay clean and unobtrusive.

**Acceptance Criteria:**

**Given** a memo that is neither hovered nor focused
**When** it renders
**Then** its expand icon is hidden (the memo shows only its content/box), keeping idle chrome minimal (item 4, UX-DR minimal-chrome)

**Given** the memo is hovered OR has focus-within (its text-entry or a control focused)
**Then** the expand icon appears and is fully clickable/keyboard-reachable, and it does not shift the memo's layout when it appears/disappears (item 4, UX-DR17)

**Given** keyboard-only use
**Then** the icon is reachable when the memo is focused (never hover-only), so it is not lost to keyboard users (UX-DR17)

> **Open design calls for create-story:** whether "expand" means the collapse/expand toggle or a separate control; the exact reveal trigger (`:hover` + `:focus-within`); a short fade vs instant.

## Story 9.4: Resizable, persisted collapsed memo box (item 10)

> User request: "the collapsed memo box is a fixed size; I want to resize it, and have that persist." Today `setMemoCollapsed` is a boolean and the collapsed box has a fixed size. This adds a persisted collapsed dimension (a contract addition). Proposed reader **FR-32** (finalize in the PRD addendum). Shares the `MemoBox` surface with 9-2/9-3.

As a reader,
I want to resize a memo's collapsed box and have the size stick,
So that collapsed memos fit the space I want them to occupy.

**Acceptance Criteria:**

**Given** a collapsed memo
**When** I drag its resize handles
**Then** the collapsed box resizes (independently of the expanded size), with handles tracking the corners exactly (consistent with 9-2) (item 10, FR-15)

**Given** a resized collapsed memo
**When** I reload the paper (Story 3.5 restore)
**Then** the collapsed box restores at its persisted size, not the fixed preset (item 10, proposed FR-32, AR-6)

**Given** the persisted collapsed size
**Then** it is stored as annotation style/geometry through the command path (AR-7, undoable) and added additively to the contract (no `schema_version` break; an existing annotation without it falls back to the current fixed size) (proposed FR-32, AD-8)

**Given** the collapsed and expanded sizes
**Then** they are tracked distinctly (resizing one does not silently change the other) and both survive reload; live-smoked at DPR>1

> **Out of scope:** a shared "default collapsed size" preference across memos (create-story call). **Open design calls:** the exact stored field(s) (a `collapsed_size` vs reusing `bubble_*`); the collapsed min-size floor; how this composes with Story 8.6's preview-size behavior.

## Story 9.5: Persist a moved comment box's position (item 5)

> User request: "when I drag and move the white comment box, I want it to persist." Today `resizeCommentAnnotation` stores `bubble_width/height` in style but the bubble POSITION is derived from the pin (not stored), so a moved box snaps back. This adds a persisted position offset (a contract addition). Proposed reader **FR-31** (finalize in the PRD addendum).

As a reader,
I want a comment box I dragged to a new spot to stay there,
So that I can place a note where it reads best and keep it there.

**Acceptance Criteria:**

**Given** an open comment box (bubble)
**When** I drag it to a new position
**Then** it moves and stays where I dropped it for the session (item 5, FR-11/FR-15)

**Given** a moved comment box
**When** I close and reopen it, or reload the paper (Story 3.5)
**Then** it reopens at its persisted position, not snapped back to the pin default (item 5, proposed FR-31, AR-6)

**Given** the persisted position
**Then** it is stored as an offset from the pin/anchor (scale-independent, so it holds across zoom), written through the command path (undoable), and added additively to the contract (no `schema_version` break; a box without it falls back to the pin-relative default) (proposed FR-31, AD-4/AD-8)

**Given** a box dragged near a page edge
**Then** it still renders in the fixed-overlay path without page-edge clipping (the [[comment-bubble-page-edge-clipping]] guard) and without reflowing the canvas (NFR-1)

> **Open design calls for create-story:** store the offset in normalized page fractions vs a pin-relative delta; whether the pin stays fixed while only the box moves (assumed yes); per-page scope for a multi-page comment group.

## Story 9.6: Quick-box pops to the right of the selection (item 7)

> User request: "when I highlight/underline/select or use the quick box, put its popup on the RIGHT side of the selection so it obstructs reading less." Polish on the quick-box placement (`annotations/marks.ts` affordance flags + the placement logic in the interaction layer). No new FR (FR-14, UX minimal-obstruction).

As a reader,
I want the quick-box to appear to the right of my selection,
So that it does not cover the text I just selected or the line I am reading.

**Acceptance Criteria:**

**Given** a completed text selection (or an armed/selected mark that shows the quick-box)
**When** the quick-box opens
**Then** it is positioned to the RIGHT of the selection by default, clear of the selected text and the current reading line (item 7, FR-14, NFR-1)

**Given** a selection near the right page edge where a right-side box would overflow
**Then** the placement falls back gracefully (flip to left/below) so the box stays fully on-screen and never clips (item 7, NFR-1)

**Given** the existing left-vertical-strip marks (memo, box comment, box highlight, per `usesLeftVerticalQuickBox`)
**Then** the change is reconciled with them (create-story: does right-side become the default for text marks only, or unify the strip placement) without regressing those marks' current behavior (FR-14)

**Given** the placement change
**Then** it is live-smoked at DPR>1 across a selection at the left, center, and right of a page, confirming no clipping and no reading-line occlusion

> **Open design calls for create-story:** exact anchor point (selection's right edge, vertically centered vs top-aligned); the overflow flip order; whether the left-vertical-strip marks change or stay.

## Story 9.7: Remember and restore last view position on reopen (item 11)

> User request: "when I close a PDF, remember the location (page or scroll); restore it when the doc is reopened." Today `openDoc` restores annotations but clears all transient view state (no scroll/page memory). This adds per-doc last-view persistence. Proposed reader **FR-33** (finalize in the PRD addendum).

As a reader,
I want a paper to reopen at the page and scroll position where I left off,
So that I resume reading without hunting for my place.

**Acceptance Criteria:**

**Given** an open paper scrolled to some page/position
**When** I close it (leave the reader / switch documents)
**Then** its last view position (page index + intra-page scroll offset) is captured per document (item 11, proposed FR-33)

**Given** I reopen that paper
**When** the reader loads
**Then** it restores to the remembered page and scroll offset (scale-independent, so a zoom change since last visit still lands on the right content), not the top of page 1 (item 11, proposed FR-33, AR-6)

**Given** a first-time open (no remembered position)
**Then** it opens at the top, unchanged (proposed FR-33)

**Given** the restore
**Then** it composes with the Story 1.7 render windowing (the target page is rendered before the jump) and is live-smoked at DPR>1 on a 50+ page paper, landing at the remembered spot without a visible scroll-jank burst (NFR-2)

> **Out of scope:** cross-device sync of the position (Remote sync stays deferred); remembering per-page zoom level (create-story call). **Open design calls for create-story:** where the position lives (client `localStorage` view-prefs, like the Story 7.10 table-prefs store, vs `meta.json` server-side); whether position is stored as a normalized fraction or page + px offset; debounce/flush timing on close.

## Story 9.8: Pen width, four levels including a thinner one (item 12)

> User request: "support a thinner pen width; four levels rather than the current three." Today `activeStrokeWidth` defaults to 8 (`--pen-stroke-medium`); three `--pen-stroke-*` tokens exist. This adds a fourth, thinner level (a DESIGN.md token plus the stroke-width row going 3 to 4 options). AC-extension of FR-9 (pen); no new FR.

As a reader,
I want a fourth, thinner pen width,
So that I can draw finer marks than the current thinnest stroke.

**Acceptance Criteria:**

**Given** the pen stroke-width picker
**When** it renders
**Then** it offers FOUR levels, the thinnest strictly thinner than today's current thinnest, ordered thin to thick (item 12, FR-9)

**Given** the widths
**Then** the fourth (thinner) value is a new `--pen-stroke-*` token in DESIGN.md (regenerated into `tokens.css`), not a raw px, and the picker reads the token set (item 12, DESIGN token contract)

**Given** a stroke drawn at the new thinnest width
**Then** it renders crisply at DPR>1 (not sub-pixel-invisible) and persists/restores at that width like any other pen stroke (FR-9, AR-6)

**Given** the picker layout
**Then** four options fit the existing stroke-width row without breaking the flyout layout (create-story: adjust the row) (item 12, NFR-1)

> **Open design calls for create-story:** the exact four values (and whether the default stays medium or shifts); the token names; whether the picker also grows for a future fifth level or is fixed at four.

## Story 9.9: Epic 9 structural refactor (terminal)

> User request (standing pattern, AE7-5): reduce complexity and unify Epic 9's code behind clear OOP boundaries, same footing as Stories 5.0/5.3/5.4/6.8/8.10. Sequenced LAST so its scope reflects everything Stories 9.1 to 9.8 touched. No new FR, no behavior/contract change.

As a developer-user,
I want the code Epic 9 added or touched unified behind cohesive modules with reduced conditional sprawl,
So that the next reader epic builds on clean boundaries instead of accreting patches onto the same files.

**Acceptance Criteria:**

**Given** every file touched by Stories 9.1 to 9.8 (finalize the list once they land)
**Then** each is audited for the same smells Stories 5.3/6.8/8.10 targeted: god-objects/god-functions, near-duplicate conditional branches that should be one descriptor/registry (the AD-5 `anchor.kind`-keyed dispatch pattern), and any coordinate math outside `anchor/` (AD-9 boundary check)

**Given** the `MemoBox`/comment-box surface grew (9.2 handles, 9.3 icon-reveal, 9.4 collapsed-resize, 9.5 box-position)
**Then** its resize/position/collapse concerns are unified behind one cohesive box-geometry model rather than parallel per-story conditionals

**Given** this is a pure refactor thread
**Then** it changes NO behavior and NO contract: every existing Epic 1 to 10 test still passes unmodified in intent, and there is no anchor/store/API-contract change

**Given** the refactor
**Then** it lands in its own PR(s), separate from any feature story, per the Story 5.0/5.3/5.4/6.8/8.10 precedent

> **Out of scope:** any new capability; touching modules Epic 9 did not touch; the still-deferred multi-column selection controller. **Open design calls for create-story:** the exact module boundaries; final scope depends on which of 9.1 to 9.8 shipped.
