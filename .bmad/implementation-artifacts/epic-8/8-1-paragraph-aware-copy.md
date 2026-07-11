---
baseline_commit: 944a91407adab9c314faad3440d5f3cb9fcc9be7
---

# Story 8.1: Paragraph-aware copy (join soft-wrapped lines)

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a reader,
I want a soft-wrapped paragraph to copy as one continuous line,
so that pasting a passage keeps real paragraph breaks but joins wrapped lines with a space instead of a hard newline.

## Context & root cause (read first)

This is the **mirror-image regression** of the Story 4.1 copy fix. Read this before touching code — it is the whole reason the story exists and it defines what you must NOT break.

**The bug (user-reported, with a screenshot):** selecting text that reads as one paragraph in the PDF (wrapping across several visual lines) copies with a hard line break at *every* visual line, not just at real paragraph ends. Paste it and you get:

```
Transformers have become the
dominant architecture for
sequence modeling.
```

instead of the intended:

```
Transformers have become the dominant architecture for sequence modeling.
```

**Root cause (confirmed by reading the pdf.js source, not hypothesized):**

- `client/src/render/index.ts:340` renders each page's text with pdf.js's own `TextLayer` class (`node_modules/pdfjs-dist/build/pdf.mjs`). That class appends a `<br role="presentation">` after every text item whose `hasEOL: true`.
- `hasEOL` comes straight from the PDF's glyph-positioning data. **Every visually distinct line** (a soft wrap OR a genuine paragraph end) is a separately Y-positioned glyph run, and a PDF file carries **no paragraph-boundary metadata at all**. So pdf.js marks EVERY line `hasEOL: true` and cannot tell a wrap from a real break.
- Story 4.1 (`render/textSelection.ts`) faithfully reproduced this upstream `<br>`-per-line behavior so that inter-line whitespace survives `selection.toString()`. That fix was correct — but it means native copy now emits a hard `\n` at every wrap. **This is not a Paper Mate regression:** Firefox's own built-in PDF viewer (same pdf.js codebase) has the identical characteristic.

**Why this needs a heuristic, not a one-line fix:** pdf.js's `hasEOL` alone cannot distinguish "wrapped for column width" from "real line/paragraph end." Closing the bug requires a **paragraph-vs-wrap heuristic** built on pdf.js's per-line geometry (Y-gap vs the page's typical line-height, left-margin/indent alignment, trailing punctuation) that keeps a `\n` only for a genuine break and joins a soft wrap with a single space. Any such heuristic has inherent false-positive/negative risk, so **the story starts with a spike** to validate it against real papers before the full build.

**Scope of the change:** `render/` only. This is the text layer's owner (AD-9 layering: `render/` never imports from `anchor/`, `annotations/`, or `store/`). No annotation, anchor, store, or contract change. Highlight/underline geometry (per-line rects via `anchor/collectTextRects`) is completely unaffected — this only rewrites the **clipboard string** on the `copy` event; it does NOT touch `selection.toString()` used anywhere else, and it does NOT change stored `anchor.text` semantics.

## Acceptance Criteria

**AC-1 — Soft wraps join, real breaks stay** (FR-2, AR-2)
**Given** a selection spanning a paragraph that soft-wraps across several visual lines
**When** I copy it
**Then** the clipboard text joins the wrapped lines with a single space (no hard `\n` mid-paragraph); a genuine paragraph break still copies as a line break.

**AC-2 — Geometry-derived heuristic** (FR-2)
**Given** the fix must distinguish a soft wrap from a real break
**Then** it applies a paragraph-vs-wrap HEURISTIC over pdf.js's per-line geometry (consecutive lines' Y-gap vs the page's typical line-height, left-margin/indent alignment, trailing punctuation), since pdf.js's `hasEOL` alone cannot tell them apart, and only the geometry-derived "real break" keeps a `\n`.

**AC-3 — Spike first, verified against real papers** (FR-2)
**Given** the risk that any heuristic has false positives/negatives
**Then** the story STARTS with a small spike: prototype the Y-gap/indent heuristic against 2–3 real papers (multi-column, justified, and indented-paragraph layouts) and validate before committing to the full implementation; the AC-1 join behavior is verified by copying a wrapped passage from a real paper and diffing against the intended single-line result, not only a unit test.

**AC-4 — `render/`-only, geometry-preserving, no 4.1 regression** (AR-9, AD-9)
**Given** the fix
**Then** it stays in `render/` (the text layer's owner, alongside Story 4.1's `render/textSelection.ts`), adds no import from `anchor/`, `annotations/`, or `store/`, and makes no annotation/anchor/store change; highlight/underline geometry (per-line rects via `anchor/collectTextRects`) is unaffected, and it does NOT reintroduce the 4.1 inter-line-space (fused words) or trailing-punctuation-band defects.

**AC-5 — Non-PDF and editable selections untouched**
**Given** a selection that is NOT inside a page's `.textLayer` (a memo/comment editor, Annotation Bank text, or any other UI text)
**When** I copy it
**Then** native copy is unchanged (the handler does not `preventDefault`), so copying from an editable field or app chrome behaves exactly as before.

**AC-6 — Tests + typecheck + build green**
**Given** the change
**Then** `cd client && npm test` and `npm run typecheck` pass and `npm run build` succeeds; the pure heuristic has jsdom-safe unit tests fed synthetic per-line geometry (jsdom cannot measure real rects); any new `render/index.ts` export is mirrored in BOTH `vi.mock("./render")` barrels (`App.test.tsx`, `Reader.test.tsx`) in the same change (Epic-1 retro rule).

## Tasks / Subtasks

- [x] **Task 1 — Spike the paragraph-vs-wrap heuristic (AC: 2, 3).** Do this FIRST; do not build the production path until the heuristic is validated.
  - [x] Run YOUR OWN dev servers (fresh `uvicorn` + `vite dev`, alternate ports if defaults are taken — do NOT reuse a user-launched or Docker server; see CLAUDE.md). Upload/open 2–3 **real** papers covering the three hard layouts: **multi-column** (two-column conference paper), **justified** body text (fills the column width), and **indented-first-line** paragraphs. Existing uploads under the data dir (`./.paper-mate`) work if they cover these.
  - [x] In the browser console (or a throwaway module), select a wrapped passage and read the selected `.textLayer` spans' per-line geometry: for each visual line, its top/left/right via `getBoundingClientRect()` and its font-size. Confirm which signals actually separate a soft wrap from a real break on these papers:
    - **Y-gap:** `top(nextLine) - top(line)` vs the page's typical line-height (median line-to-line gap, or modal font-size). A wrap ≈ 1 line-height; a paragraph break is larger, or there is a blank line.
    - **Indent:** does the next line start at the column's left edge (wrap) or indented right of it (new paragraph first line)?
    - **Fill / trailing punctuation:** is the current line filled to (near) the column's right edge (wrap), or short and ending in sentence punctuation (likely a real end)?
    - **Column boundary:** in a two-column layout, a "next line" that jumps to the other column's top is a real break, not a wrap.
  - [x] Settle the initial rule + thresholds and the default for an **ambiguous** line (recommendation: default to JOIN, matching normal reader/browser copy — the visible AC-1 win is the common case). Record the chosen signals + thresholds in the Dev Agent Record.
  - [x] **Decide the hyphenation edge:** a wrap that breaks a word (`trans-\nformer`) — join as `trans- former`, de-hyphenate to `transformer`, or leave as-is. Pick one and note it (see Open design calls).

- [x] **Task 2 — Extract a pure, testable heuristic module (AC: 1, 2, 6).** Prefer an OOP/functional decomposition that isolates the string logic from DOM measurement so it is unit-testable in jsdom.
  - [x] Add a small module `client/src/render/paragraphCopy.ts` (co-located with `render/textSelection.ts`, the text layer's other owner). Split it into:
    - a **pure function** — e.g. `joinParagraphLines(lines: LineGeom[]): string` — that takes already-measured per-line geometry (`{ text, top, left, right, fontSize }[]`, in DOM/reading order) and returns the joined clipboard string. This is the unit-tested core; it does NO DOM measurement.
    - a thin **adapter** — e.g. `measureSelectedLines(range/selection): LineGeom[]` — that walks the selected `.textLayer` spans (split at the `<br>` boundaries), measures each line, and hands `LineGeom[]` to the pure function.
  - [x] Keep it in `render/` with NO import from `anchor/`, `annotations/`, or `store/` (AD-9). Import it into `render/textSelection.ts` (a sub-path import, like `usePageViewport` / `textSelection.ts` itself), NOT via the `render/` barrel — so Reader/App test mocks are unaffected unless you add a NEW barrel export (then mirror both `vi.mock("./render")` barrels).

- [x] **Task 3 — Intercept `copy` and rewrite the clipboard (AC: 1, 4, 5).**
  - [x] Wire a document-level `copy` listener through the EXISTING `TextSelectionController` (`render/textSelection.ts`): add it inside `#enableGlobalListener` with the same `{ signal }` as the other listeners so it shares the AbortController lifecycle (enabled on first `register`, torn down when the last text layer unregisters — the proven Story 4.1 AC-5 lifecycle; no new leak surface, no separate phase gate). This is the smallest correct structure and reuses tested plumbing.
  - [x] In the handler:
    1. Get `document.getSelection()`; if empty, return (native copy).
    2. **Guard (AC-5):** only act when the selection is entirely within our registered `.textLayer`(s). If any part is outside a text layer (an editable memo/comment, Bank text, app chrome), return WITHOUT `preventDefault` so native copy is unchanged.
    3. Build `LineGeom[]` via the Task 2 adapter, call `joinParagraphLines`, then `event.clipboardData?.setData("text/plain", joined)` and `event.preventDefault()`.
  - [x] Keep the handler defensive: if measurement yields nothing usable, fall through to native copy (do not `preventDefault`) rather than clobbering the clipboard with an empty string.

- [x] **Task 4 — Regression-guard Story 4.1 (AC: 4).**
  - [x] Within a single visual line, preserve inter-word spaces exactly (do NOT re-introduce 4.1's fused-words bug). The join between wrapped lines is a single space; the text WITHIN each line is the line's own text with its spaces intact.
  - [x] Do not alter `render/textSelection.ts`'s `endOfContent` / `.selecting` selection-band machinery or the `br::selection { background: transparent }` CSS — the copy handler is additive. Confirm the trailing-punctuation band and normal multi-line selection still look correct.

- [x] **Task 5 — Tests (AC: 6).**
  - [x] Add `client/src/render/paragraphCopy.test.ts` covering the pure `joinParagraphLines` with synthetic `LineGeom[]`: (a) three wrapped lines at ~1 line-height gap → one space-joined line; (b) a large Y-gap / blank line → `\n` kept; (c) an indented next line → `\n` kept (new paragraph); (d) a short line ending in `.` followed by a normal-start line → real break; (e) the ambiguous default; (f) the hyphenation decision from Task 1.
  - [x] Do NOT try to unit-test real selection geometry or the clipboard in jsdom — it can measure neither (rects are zeroed). Those are covered by the live smoke.

- [x] **Task 6 — Verify (AC: 1–6).**
  - [x] `cd client && npm test && npm run typecheck && npm run build`.
  - [x] **Live smoke (mandatory — jsdom cannot see real selection geometry or the clipboard):** on YOUR OWN dev servers, for each of the three spike papers: select a soft-wrapped passage, copy (Ctrl/Cmd+C), paste into a plain-text editor, and diff against the intended single-line result. Then copy a passage that SPANS a real paragraph break and confirm the break is preserved. **Multi-column is the highest-risk path** (see the cross-page/column guidance in CLAUDE.md / [[verify-on-hidpi-and-real-host]]): smoke a multi-column selection at DPR>1 and confirm it does not fuse the two columns or leak. Also copy from a memo/comment editor to confirm AC-5 (native copy untouched).
  - [x] Use **trusted input** for the copy (real Ctrl/Cmd+C or the browser's copy, not a synthetic `.dispatchEvent`) so the `clipboardData` write path is exercised for real ([[use-trusted-input-for-focus-sensitive-smoke]]).

## Dev Notes

### The exact surface you are changing

- **`client/src/render/index.ts:340`** — `new TextLayer({...})` builds the per-page text layer; `:378` `textLayerDiv.replaceChildren(...offText.childNodes)` swaps the live spans + `<br role="presentation">` in; `:381` `textSelectionController.register(textLayerDiv)` binds the shared selection machinery. You do NOT need to change the render/swap flow — the `<br>`s and spans you need are already in the live DOM by the time a `copy` fires.
- **`client/src/render/textSelection.ts`** — the `TextSelectionController` singleton (exported at `:164`). It already owns one shared, AbortController-scoped set of `document`-level listeners (`pointerdown`/`pointerup`/`blur`/`keyup`/`selectionchange`) enabled on first `register` and torn down on last `unregister`. **Add the `copy` listener here**, in `#enableGlobalListener`, with the same `{ signal }`. `#textLayers` (its `Map<Element, HTMLElement>` of registered text layers) is exactly the set you test membership against for the AC-5 guard.
- Story 4.1 already proved this lifecycle is leak-safe and unit-tested it (`textSelection.test.ts` — register/unregister bookkeeping, single-enable, teardown-on-last). Adding one more `{ signal }`-scoped listener inherits that safety; no new teardown code needed.

### How pdf.js lays out the lines (what the adapter reads)

- pdf.js v6 `TextLayer` positions each text run as an absolutely-placed `<span>` inside `.textLayer`, sized/placed against the `--total-scale-factor` CSS var (set to `scale` on the live div at `render/index.ts:377`). A `<br role="presentation">` follows each `hasEOL` run and is the visual-line boundary.
- **Read geometry live** via `getBoundingClientRect()` on the spans (robust, post-layout, DPR-correct) — do not try to parse the inline `left/top` strings or reconstruct transforms. Group spans into visual lines by the intervening `<br>`s (or by a shared top within an epsilon). Per line, take `top`, `left` (first span), `right` (last span), and a representative `fontSize`.
- **Typical line-height** for the Y-gap test: derive per selection from the median line-to-line `top` delta (or modal font-size) of the selected lines — do NOT hard-code px (and raw px would trip `no-raw-values.test.ts` outside `src/theme/**` anyway; keep thresholds as unitless ratios of the measured line-height).

### Design decisions (locked)

- **`copy`-event interception, not a selection rewrite.** Rewrite `event.clipboardData` and `preventDefault()` only. `selection.toString()` and stored `anchor.text` are untouched — the annotation-create path (which captures `anchor.text` from the selection) is unaffected (AC-4).
- **Pure heuristic + thin adapter** (Task 2). The string logic is jsdom-testable; the DOM measurement is not, and stays a thin, un-unit-tested adapter verified by live smoke. This mirrors the project's standing split (measure-vs-decide) and keeps `paragraphCopy.ts` a real, isolated `render/` module (AD-9).
- **Document-level handler, lifecycle-tied to the controller.** Per CLAUDE.md ("bind interaction handlers at the document level"), and because the controller's registry both gates the AC-5 guard and bounds the listener's lifetime to when text layers exist.
- **Adopt over reinvent** (Epic-1 retro / [[prefer-stable-solutions]]): reuse the existing controller's listener set and `#textLayers` registry rather than standing up a second global listener manager.

### Testing standards

- Vitest + jsdom. jsdom returns zeroed rects and has no real clipboard — every geometry/clipboard AC is **live-smoke only**; unit tests cover the pure `joinParagraphLines` over synthetic `LineGeom[]`.
- Backend suite is not involved (client-only story).

### Project Structure Notes

- New files live in `client/src/render/` beside `textSelection.ts`: `paragraphCopy.ts` + `paragraphCopy.test.ts`. This is the correct home per AD-9 (the text layer's owner) and matches Story 4.1's placement of `textSelection.ts`.
- No barrel (`render/index.ts`) export is needed if `paragraphCopy` is imported directly by `textSelection.ts` (sub-path import). **If** you do add a `render/index.ts` export, you MUST add it to BOTH `vi.mock("./render")` barrels (`App.test.tsx`, `Reader.test.tsx`) in the same change (Epic-1 retro rule) or every Reader/App test breaks.
- No `anchor/`, `annotations/`, `store/`, server, contract, `docs/API.md`, or design-token change. No em-dash in any new user-facing string (there are none expected in this story; if a preference/toggle is added, its label must avoid `—`) ([[no-emdash-user-facing]]).

### Versioning

Client-only story, no server change. Bump `[project].version` in `server/pyproject.toml` **0.5.12 → 0.5.13** (PATCH +1) once the story reaches `done` at PR merge — not per commit, and do not hard-code the version anywhere else.

### Open design calls (settle in the spike, record in the Dev Agent Record)

1. **Signals + thresholds** for the paragraph-vs-wrap decision (Y-gap ratio, indent tolerance, fill/trailing-punctuation weight) — the spike (Task 1) settles these against real papers.
2. **Ambiguous line default** — join or break. Recommendation: **join** (matches normal reader/browser copy; the common wrapped-paragraph case is the visible win).
3. **Hyphenation** at a wrap (`trans-\nformer`) — join with space, de-hyphenate, or leave. Not specified upstream; pick one in the spike.
4. **Expose raw-vs-joined as a preference?** Out of scope unless the spike shows it's needed; default = joined (no preference).

### Out of scope (this story)

- OCR / scanned-PDF handling (no geometry to read).
- Reflowing or editing the PDF.
- Any change to stored `anchor.text` semantics beyond what the copy path already captures.
- The deferred blank-space / multi-column *selection* controller (that stays deferred; this story only changes the CLIPBOARD output, not what the drag selects). Note: Story 8.8 (empty-space drag) is the adjacent selection-gating story — do not fold it in here.

### References

- [Source: .bmad/planning-artifacts/epics.md#Story-8.1] — story statement + BDD acceptance criteria (verbatim).
- [Source: .bmad/implementation-artifacts/deferred-work.md] — "Bug: copied single-visual-line text copies as MULTIPLE clipboard lines" (the source spec + confirmed root cause).
- [Source: .bmad/planning-artifacts/sprint-change-proposals/sprint-change-proposal-2026-07-07-deferred-review.md#4b] — promotion of this bug to the story.
- [Source: client/src/render/textSelection.ts] — the Story 4.1 `TextSelectionController` this story extends; its listener-lifecycle contract.
- [Source: client/src/render/index.ts:340-397] — `TextLayer` build + atomic swap + `textSelectionController.register`.
- [Source: .bmad/implementation-artifacts/epic-4/4-1-text-layer-copy-selection-fidelity.md] — the fix this story regression-guards (inter-line whitespace + trailing-punctuation band).
- [Source: .bmad/planning-artifacts/architecture/architecture-paper-mate-2026-06-28/ARCHITECTURE-SPINE.md] — AD-2 (raw pdf.js + custom overlay), AD-9 (`render/` layering: no import from anchor/annotations/store), adopt-stable-primitives principle.
- [Source: CLAUDE.md] — document-level handler convention; "for live smoke launch your OWN dev servers"; selection→rects / cross-page smoke discipline.

## Dev Agent Record

### Agent Model Used

Sonnet 5 (xHigh)

### Debug Log References

**Task 1 spike (2026-07-11).** Own dev servers: `uvicorn` on :8010 (`PAPER_MATE_DATA` pointed at a scratch dir), `vite dev` on :5183 proxied to it. Uploaded 3 real papers and read live `.textLayer` per-line geometry via `getBoundingClientRect()` in the page (Playwright `browser_evaluate`, no Chrome extension available this session):

- **Microsoft COCO** (IEEE two-column, justified, first-line indent): column body `left≈213.8px`, line-height (top delta) ≈23.9px, indent on new-paragraph first line ≈19.9px (≈1 line-height's font-size, i.e. ~1em). Confirmed a genuine paragraph break ("of scene understanding?" → "We introduce a new large-scale dataset...") has the SAME ~24px Y-gap as a normal wrap — indent is the only signal that catches it. Also confirmed a hyphenated wrap ("charac-" → "terizing relationships...") has normal Y-gap, normal (non-indented) left, and a filled right edge — i.e. it looks exactly like an ordinary wrap except for the trailing `-`, so hyphenation needs its own check independent of the break/wrap decision.
- **1906.03821v1 (ACM SIGKDD)** (two-column, justified, first-line indent, no blank line between paragraphs): body `left≈751px`, line-height ≈21.9px, indent ≈20px. Same pattern as COCO: "the industrial scenario." → "Challenge 2: Generalization..." breaks with a normal Y-gap, caught only by indent + the short/punctuation-ending prior line. Column boundary confirmed as a hard signal: column 2's first line (`top=439.1`) sits well above column 1's last body line (`top≈1344.6`) — i.e. `top` goes backward, unambiguous break.
- **09-regularization.pdf** (single-column book chapter, justified, first-line indent, larger type): body `left≈383.2px`, line-height ≈23.9px, indent ≈29.8px. Confirms indent magnitude scales with font size/line-height rather than being a fixed px value — thresholds are expressed as ratios of the measured line-height, not hard-coded px (also required by `no-raw-values.test.ts` outside `src/theme/**`).

**Signals + thresholds settled** (ratios of `lineHeight` = median positive consecutive top-delta in the selection):
1. **Column jump** — `next.top < cur.top - 0.5*lineHeight` (top moves backward = new column). Hard break, overrides everything else.
2. **Big Y-gap** — `(next.top - cur.top) > 1.4*lineHeight`. Break (blank line / heading spacing).
3. **Indent** — next line's `left` exceeds the running paragraph's body-left (tracked as the running MIN `left` seen since the last break, since the indent only ever appears on a paragraph's first line, never its continuations) by `> 0.4*lineHeight`. Break. This is the dominant signal in justified, non-blank-line-separated academic layouts (both two-column papers).
4. **Short + terminal punctuation** — current line's `right` is short of the running column-right (running MAX `right` since last break) by `> 1.5*lineHeight`, AND the line's trimmed text ends in `.`/`!`/`?`/`:`/`;`. Secondary/tie-break signal, combined with (3) in practice.
5. **Ambiguous default → JOIN** (space-joined), per the story's recommendation — matches normal reader/browser copy and keeps the common wrapped-paragraph case the visible win.

**Hyphenation decision:** de-hyphenate. If the current line's trimmed text ends in a letter immediately followed by `-` (`/\p{L}-$/u`) and none of the break signals fired, strip the trailing `-` and join with NO space (`"charac-" + "terizing..."` → `"characterizing..."`), rather than leaving a literal `trans- former` or keeping the hyphen. Rationale: matches the reader's intent of one continuous word and is the common editorial convention; picked over "leave as-is" because leaving `-\n` artifacts as `- ` mid-word reads as broken, and over keeping the hyphen without a space because `trans-former` misspells the word.

### Completion Notes List

- Implemented the paragraph-vs-wrap heuristic (`joinParagraphLines`) exactly per the spike's settled signals/thresholds (column jump, big Y-gap, indent, short+terminal-punctuation, hyphen de-hyphenation, ambiguous→join default) — see Debug Log for the full spike writeup.
- `paragraphCopy.ts` is a real, isolated `render/` module: no import from `anchor/`, `annotations/`, or `store/`. Imported into `textSelection.ts` by sub-path (not via the `render/` barrel), so no `vi.mock("./render")` barrel update was needed (confirmed: full suite green with no App/Reader test changes).
- The `copy` listener lives inside `TextSelectionController#enableGlobalListener`, sharing the same `{ signal }` AbortController as the other Story-4.1 listeners — no new lifecycle/teardown code, inherits the existing register/unregister leak-safety (`textSelection.test.ts` unchanged and still green).
- 9 unit tests added for `joinParagraphLines` covering all 6 story-specified cases (a–f) plus a column-jump case; all pass. `measureSelectedLines` (the DOM adapter) is intentionally untested in jsdom (zeroed rects) per the story's testing standard — verified instead by live smoke.
- **Live smoke (real Ctrl+C/Ctrl+V, trusted input via Playwright `press_key`, own dev servers on :8010/:5183):**
  - COCO (multi-column, DPR=1): a 6-line wrapped abstract pasted as one line; a 3-hyphen passage ("clas-/sification", "understand-/ing", "con-/tains") de-hyphenated correctly; a real paragraph break (indent-only signal, no Y-gap difference) preserved its `\n` while the surrounding wraps joined.
  - 1906.03821 (ACM, ragged-right two-column): the "the industrial scenario." → "Challenge 2: ..." indent-only break preserved; wraps joined. (OS-clipboard paste round-trip was flaky on retry in this sandbox — a `copy`-event debug listener confirmed the SHIPPED handler set the exact correct joined string on `event.clipboardData` and called `preventDefault`, i.e. the production code path is verified even where the sandbox's clipboard daemon wasn't.)
  - 09-regularization (single-column, book-style, larger indent): two full wrapped paragraphs (6 lines + 5 lines) each joined to one line, including a `sub-\noptimal` → `suboptimal` de-hyphenation, with the real paragraph break between them preserved. Verified via clipboardData debug listener.
  - **Multi-column at DPR=2** (`chrome-devtools-mcp` `emulate` viewport `1400x1000x2`): a selection crossing from column 1 (body + a hanging-indent footnote/author-affiliation list) into column 2 (a figure caption) did NOT fuse the columns or leak text — every column/section transition still produced a `\n`. Found and documenting a narrow, accepted limitation below.
  - AC-5: typed into a memo annotation's `<textarea>`, selected its text, real Ctrl+C — `event.defaultPrevented` was `false` (confirmed via a debug listener on the textarea), i.e. our handler correctly did not intercept it. This holds by construction: a textarea's internal text selection never populates `document.getSelection()`, which is what the guard checks.
- **Known limitation (not a regression, not blocking):** the indent signal misfires on hanging-indent bulleted/footnote lists (continuation lines indented, item-start lines flush — the inverse of a normal paragraph's first-line indent), occasionally placing a break mid-item or joining across two list items. Found live-smoking COCO's author-affiliation footnote block. This is footnote/reference-list structure, not the AC-1 "paragraph" target, and falls squarely under AC-3's explicit acknowledgment that "any such heuristic has inherent false-positive/negative risk." No code change made for it; flagging for a future story if it proves to matter in practice.
- Full regression suite: 1369/1369 client tests pass (one `Reader.test.tsx` visibilitychange test failed on one full-suite run and passed on immediate re-run and in isolation — a pre-existing test-order flake unrelated to this change; not touched by this story's diff). `npm run typecheck` and `npm run build` both clean.
- `server/uv.lock` picked up a stray version-string bump (0.5.11→0.5.12) from running `uv run uvicorn` for the live smoke's own dev server; reverted before finalizing since this is a client-only story with no server change.

**Post-implementation fix (user-reported, same session, 2026-07-11): drag starting/ending mid-span copied whole boundary lines instead of just the highlighted characters.** Root cause: `measureSelectedLines` decided a span's inclusion with `selection.containsNode(span, true)` ("allow partial containment" — true if the selection touches the span AT ALL), then took `span.textContent` in FULL for any included span. A drag that starts or ends mid-span still "touches" that span, so its entire text leaked into the copied line regardless of where the drag actually started/ended — e.g. dragging from mid-word in "and 3D scene information" through mid-word in "in scene understanding: de-" copied both boundary LINES in full, including "attributes [9], keypoints [10], " before the drag start and "ene understanding: de-" after the drag end.

Fix: replaced the containment test with `clippedText(range, span)`, which clips each span to its ACTUAL intersection with the selection `Range` via native boundary comparison (`Range.compareBoundaryPoints` + `setStart`/`setEnd`, which the DOM spec defines to auto-collapse to empty when there's no overlap — no separate zero-overlap branch needed). Also switched layer discovery from inferring touched layers off the range's two endpoints to `range.intersectsNode(layer)` over all `.textLayer`s (mirrors the pattern already used elsewhere in `textSelection.ts`'s `selectionchange` handler), so a selection covering an entire middle page contributes its layer even when neither range endpoint sits inside it.

Added 5 new jsdom unit tests (`measureSelectedLines (text clipping)` describe block) — the text-clipping logic is pure Range/DOM-text work with no layout dependency, so unlike the rest of the adapter it IS jsdom-testable. One test reproduces the exact reported repro (6-line drag from mid-span to mid-span on the real COCO paragraph structure). Verified all 4 of the new mid-span tests FAIL against the pre-fix code (confirmed via `git stash` on just `paragraphCopy.ts`) and PASS against the fix — real regression coverage, not incidental passes. Live-smoked the exact reported drag on the real COCO PDF (own dev servers): `document.getSelection().toString()` and the shipped handler's `event.clipboardData` both read exactly `"d 3D scene information ... in sc"` with the real paragraph break preserved as `\n` — matches the user's expected output verbatim. 14/14 `paragraphCopy.test.ts` tests, full 1374/1374 suite, typecheck, and build all green after the fix.

### File List

- `client/src/render/paragraphCopy.ts` (new)
- `client/src/render/paragraphCopy.test.ts` (new)
- `client/src/render/textSelection.ts` (modified: added the `copy` listener + import)

### Review Findings

- [ ] [Review][Patch] Sparse selections normalize away the only large paragraph gap and real pdf.js font size is never measured [client/src/render/paragraphCopy.ts:72]
- [ ] [Review][Patch] Mixed selections with text outside registered text layers pass the endpoint-only guard and lose native clipboard content [client/src/render/textSelection.ts:115]
- [ ] [Review][Patch] Multi-range PDF selections are validated in full but only the first range is copied [client/src/render/paragraphCopy.ts:169]
- [ ] [Review][Patch] Existing line-edge whitespace is not normalized, so a soft-wrap boundary can contain multiple spaces or defeat de-hyphenation [client/src/render/paragraphCopy.ts:117]
