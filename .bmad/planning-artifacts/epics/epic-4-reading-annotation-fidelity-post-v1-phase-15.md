# Epic 4: Reading & annotation fidelity (post-v1, Phase-1.5)

> Added 2026-06-30 via correct-course (`sprint-change-proposal-2026-06-30.md`). Groups the render/anchor correctness items surfaced in `deferred-work.md` during the Epic 1–2 build. Theme: the core read+annotate features WORK but have fidelity defects (text copies without inter-line spaces, selection bands render thick on trailing punctuation, same-line highlights bridge the column gutter, multi-column drag-select intrudes the other column, comment fill is indistinguishable from a highlight). Fix correctness, do not add capability. No new FRs. Sequenced post-v1; promote any single story to v1-blocking if it materially degrades core reading.

## Story 4.1: Text-layer copy & selection fidelity

> deferred-work: "copied text loses spaces at line breaks" + "trailing punctuation renders a thick selection band". Same root family — our custom text layer omits the pdf.js viewer's EOL whitespace + `endOfContent` handling.

As a reader,
I want copied text to keep its spaces and selections to look uniform,
So that copying a passage and selecting across lines behaves like a normal PDF reader.

**Acceptance Criteria:**

**Given** a multi-line selection
**When** I copy it
**Then** inter-line whitespace is preserved (words that wrap across a line break do NOT fuse); `selection.toString()` (and any stored `anchor.text`) matches the source text (FR-2, AR-2)

**Given** a selection that includes a line-ending mark (e.g. a trailing period)
**Then** its `::selection` band is the same height/weight as the rest of the run (no thick band) (FR-2)

**Given** the fix
**Then** it reproduces pdf.js's text-layer copy/selection handling (EOL whitespace + `endOfContent` element, mirroring `TextLayerBuilder`) and lives in `render/` only — no annotation/anchor change; highlight/underline geometry (per-line rects) is unaffected (AR-9)

**Given** the parallel test suite
**Then** the pre-existing flaky `Reader.test.tsx` Ctrl+wheel test (deferred-work 2026-06-29) is de-flaked here (flush the wheel-binding effect before dispatch / assert via `waitFor`) as a small co-located cleanup

## Story 4.2: Column-aware selection & highlight geometry

> deferred-work: "highlights on the same line across the two columns join across the gutter" (`mergeRects` unions by vertical overlap only) + the reverted "multi-column selection controller" (a drag in one column intrudes the other). Shared root: no column model. The user's direction is a LAYERED controller (cursor logical position → emitted column/line → selection on top), built once and reused by selection, copy, and highlight create.

As a reader,
I want selection and highlights to respect column boundaries,
So that a drag stays in its column and a same-line highlight never bridges the gutter.

**Acceptance Criteria:**

**Given** two text runs on the same visual line in different columns
**When** a highlight/selection covers one
**Then** `mergeRects` does NOT union across a large horizontal gap (the gutter) — each column gets its own band; the fix stays in `anchor/` behind the `Rect[]` contract so highlight/underline/preview all inherit it (FR-7, FR-13, NFR-3, AR-4)

**Given** a drag-select inside a two-column body
**Then** it stays within the pointed column (a projection-profile column detector + per-column line model); cross-column selection is expressed in reading order, column by column

**Given** the controller
**Then** it lives in ONE module with a narrow contract (cursor logical position → emitted column/line) that selection, copy, and highlight create-on-release (`rectsFromSelection`) consume — not spread across `render/`/`anchor/`/`annotations/`; design it before coding (own story already; see deferred-work history of the 4 failed patch attempts)

**Given** any column geometry change
**Then** it is live-smoked with a cross-column same-line selection AND a cross-page selection at DPR>1 (jsdom zeroes rects)

## Story 4.3: Distinct, non-obscuring on-page mark treatment — DESCOPED from v1 (2026-07-02)

> **DESCOPED (2026-07-02, product decision, never attempted).** No longer needed for v1; not built. `sprint-status.yaml` marks it `blocked` so Epic 4 can still close after 4.2 merges. The spec below is retained as the source if it is ever re-promoted (see `deferred-work.md` "Descoped: Story 4.3").
>
> deferred-work: "a text-comment must read differently from a plain highlight, and not obscure the text" + the memo revised direction ("drop memo color, black border + transparent background"). Both are `style-on-type` paint changes (AD-5), token-driven.

As a reader,
I want comment and memo marks to look distinct and keep the text readable,
So that I can tell a highlight from a comment at a glance and a memo doesn't hide the page.

**Acceptance Criteria:**

**Given** a `type=comment` `kind=text` mark
**Then** it paints differently from a plain highlight (e.g. lower-alpha fill + accent border, or a hatch/underline treatment — decide among the deferred-work options) so highlight / underline / comment read as three distinct treatments, and the underlying text stays legible (FR-11, UX-DR7, AD-5)

**Given** a memo box
**Then** its color row is dropped and it renders with a `{colors.ink}` (black) border and TRANSPARENT background (text floats over the page); `style.color` stays on the model (contract unchanged) but stops driving the memo's paint (FR-10, UX-DR7)

**Given** the treatments
**Then** they are token-driven (new `--annotation-comment-*` / memo tokens, no raw values), updated in DESIGN.md as the source, and re-smoked at DPR>1 incl. cross-page; AD-5 holds (geometry-on-kind, style-on-type)
