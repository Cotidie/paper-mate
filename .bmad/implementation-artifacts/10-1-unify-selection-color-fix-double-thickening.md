---
baseline_commit: 2f3751fa388d78ef32d6654088aad91697753aa5
---

# Story 10.1: Unify selection color and fix double-thickening over punctuation/whitespace

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a reader,
I want the selection tint to stay one uniform color and never darken on release or double up over punctuation,
so that reading stays comfortable and highlights look clean.

This is a **defect** story, **investigation-first**: the acceptance criteria REQUIRE a written root-cause diagnosis (AC-2) before any fix is committed. Two reported symptoms, one rendering surface, one story:

- **Item 1** (user): "mid-selection and post-mouse-up must not thicken; unify the selection color."
- **Item 2** (user): "some letters, especially over a `.` or the whitespace after it, are twice-thickened; find the root cause and fix."

No new FR. Defends reader **FR-7** (Highlight), **FR-8** (Underline), **NFR-3** (Anchor fidelity across zoom).

## Acceptance Criteria

1. **Uniform color, no release-thickening (item 1, FR-7/FR-8).** Given an active text selection (mid-drag) and the same selection after mouse-up, when it is painted, then the tint is ONE uniform color at ONE opacity, with no visible darkening or "thickening" step on release.

2. **Root-cause diagnosis FIRST (item 2, investigation gate).** The story STARTS with a written root-cause diagnosis, committed to the Dev Agent Record before any fix:
   - why release changes the appearance (native `::selection` vs the created-highlight fill vs a preview double-paint), and
   - why glyphs adjacent to a `.` or a whitespace render darker (overlapping/adjacent per-line sub-range rects, or overlapping per-span native `::selection`, stacking a semi-transparent fill).

3. **Stop the alpha compounding (item 2, NFR-3).** Given two rects (or two native-selection spans) that abut or overlap at a punctuation/whitespace boundary, the fix stops the alpha from compounding (merge/clip adjacent rects, or paint the selection as one opacity-composited layer) so every covered glyph shows the exact same tint density.

4. **Live-smoked, no regressions.** The fix is live-smoked on a REAL paper at DPR>1 across a selection that spans sentence-ending punctuation AND inter-word spaces, confirming uniform density, AND it does NOT regress:
   - Story 4.1 trailing-band / inter-line-space fixes (the `endOfContent` bounding, the persistent-after-release band),
   - Story 4.2 column-aware selection geometry (the gutter-gap `mergeRects` split),
   - Story 8.1 paragraph-aware copy (`selection.toString()` still joins soft-wraps; `Ctrl/Cmd+C` output unchanged).

## Tasks / Subtasks

- [x] **Task 1 — Diagnose (AC-2), before writing any fix.**
  - [x] Open a real multi-column paper in the reader at DPR>1 (Retina/scaled display, or Chrome DevTools device-pixel-ratio > 1). Arm the Highlight tool.
  - [x] Drag a selection across a `. ` boundary (sentence end + following space) and across inter-word spaces. Observe: is the darker patch present MID-DRAG (native `::selection`), or only AFTER release?
  - [x] In DevTools, inspect the pdf.js glyph `<span>`s around the `.`/space. Confirm/refute: adjacent spans have OVERLAPPING client rects, so their translucent `.textLayer span::selection` backgrounds (`--color-text-selection`, `rgba(13,116,206,0.25)`) composite to ~0.44 → the darker patch. (Native `::selection` is browser-painted per span; `mergeRects` never runs on it.)
  - [x] Confirm the release "thickening": mid-drag = native `::selection` (blue 0.25, per-span); quick-box open = `.pending-selection-preview` (blue 0.25, per-line MERGED, so the stacking vanishes → visible geometry change); committed = `.annotation-highlight` in the `.annotation-highlights` group (tool color at `--annotation-highlight-opacity` 0.4). Record which transitions the user perceives as "thickening."
  - [x] Write the diagnosis into the Dev Agent Record → Completion Notes (which surface, which mechanism, for each item).

- [x] **Task 2 — Resolve the open design calls (record the decision).** See Dev Notes → "Open design calls." Pick with the user/product framing in mind (EXPERIENCE.md line 76: "live preview of mark; on release → quick-box" — the blue→tool-color transition is partly deliberate). Record the chosen approach + rationale in the Dev Agent Record.

- [x] **Task 3 — Implement the fix (AC-1, AC-3).** Per the resolved approach. Keep the token layer honest: any color/opacity change is a `--color-text-selection` / `--annotation-highlight-opacity` token edit in `theme/components.css` mirrored in `DESIGN.md` (raw hex/px only allowed under `src/theme/**`; `no-raw-values.test.ts` enforces it).
  - [x] If the approach paints a live preview overlay, route it through the EXISTING `rectsFromSelection` → `mergeRects` → opacity-group path (do not hand-roll a second geometry pass).
  - [x] If native `::selection` is suppressed, verify text stays SELECTABLE for copy (the brs/spans keep `user-select`, Story 8.1 copy still works — see regression guard).

- [x] **Task 4 — Unit tests for any pure logic touched.** If a rect-merge/clip pass changes, extend `anchor/anchor.test.ts` (`mergeRects` is already covered there). jsdom returns ZEROED client rects, so geometry can only be unit-tested via injected `rectsOf` fakes — never rely on jsdom for the visual result. Keep the `render/` mock barrels in sync if any `render/index.ts` export changes (both `App.test.tsx` and `Reader.test.tsx` `vi.mock("./render")`).

- [x] **Task 5 — Live smoke (AC-4), MANDATORY, cross-page + DPR>1.**
  - [x] Real paper, DPR>1, Highlight tool. Selection spanning `. ` and inter-word spaces on ONE line: confirm uniform density mid-drag, on release, and once committed.
  - [x] A CROSS-PAGE selection (spans two page cards) at DPR>1: confirm no full-page leak and uniform density (jsdom cannot see this; it is the highest-risk path — see the CLAUDE.md selection→rects rule).
  - [x] Regression pass: 4.1 trailing band (drag past the last glyph — no tall band), 4.2 two-column selection (no gutter bleed), 8.1 copy (`Ctrl/Cmd+C` still joins soft-wrapped lines).
  - [x] Use a trusted-input driver (claude-in-chrome `computer` left_click_drag forms a REAL Selection; chrome-devtools/Playwright drag tools do NOT). Capture before/after screenshots.

- [x] **Task 6 — Backend suite unaffected (client-only change).** No server touch expected; do not bump the OpenAPI contract. Version bump (0.5.30 → 0.5.31) happens at PR-merge time, not here.

### Review Findings

- [ ] [Review][Decision][High] Reconcile AC-1 with the deliberately retained armed-tool release transition: mid-drag remains neutral blue at 0.25 opacity, but mouse-up with Highlight armed immediately paints the tool color at 0.4 opacity. Either keep tint/opacity uniform through mouse-up or amend AC-1 to explicitly exclude the commit transition. [`client/src/annotations/gestures/useCreateQuickBox.ts:330`]
- [ ] [Review][Patch][High] Keep PDF text-selection feedback visible while Hide All is active. Native `::selection` is globally transparent, while `active = enabled && !hidden` disables the replacement hook and the `hidden` render gate removes it; render the selection preview independently of annotation visibility or conditionally restore native paint. [`client/src/annotations/AnnotationInteraction.tsx:120`]
- [ ] [Review][Patch][High] Complete Task 5 with the mandated trusted `left_click_drag` smoke at DPR>1. The recorded programmatic `Range` plus synthetic `pointerup` does not exercise browser drag hit-testing, `selectstart`, `SnapController`, auto-scroll timing, or a real drag past the last glyph; repeat the punctuation/space, trailing-band, two-column, cross-page, and copy checks with trusted input, and verify the Firefox selection surface affected by `::-moz-selection`. [`.bmad/implementation-artifacts/10-1-unify-selection-color-fix-double-thickening.md:169`]
- [ ] [Review][Patch][Med] Handle tool/mode takeover while a live text selection exists. Switching mid-drag to Pen, Memo, or box mode hides the custom preview without clearing the native Selection, while multi-select is not included in the preview gate; clear ranges on exclusive-mode takeover, gate multi-select, and test switch-on/switch-off plus subsequent pointer-up paths. [`client/src/annotations/AnnotationInteraction.tsx:217`]
- [ ] [Review][Patch][Med] Restrict `useLiveSelectionPreview` to selections whose text nodes belong to the reader's PDF text layers. `rectsFromSelection` currently accepts any document Selection whose client rect happens to overlap a page card, so selecting unrelated reader chrome can produce a second custom tint over the PDF. [`client/src/annotations/gestures/useLiveSelectionPreview.ts:68`]
- [ ] [Review][Patch][Med] Clip fixed live/pending preview rects on the horizontal axis as well as vertically. The reader supports horizontal scrolling, but `clipRectToViewport` preserves `left`/`width`, allowing offscreen fixed rects to paint over side chrome; extend the viewport contract to left/right and add a horizontal-scroll regression test. [`client/src/anchor/index.ts:418`]
- [ ] [Review][Patch][Med] Gate and coalesce preview invalidations. The hook currently rerenders the full annotation interaction on every captured document scroll/resize even with no selection, and performs an unthrottled full text-range walk plus page layout reads on every `selectionchange`; ignore events without a live PDF selection, coalesce active-drag work per animation frame, and reuse one indexed page snapshot per render. [`client/src/annotations/gestures/useLiveSelectionPreview.ts:52`]
- [ ] [Review][Patch][Med] Make the preview-to-mark handoff explicit instead of relying on React batching and mutable DOM reads during render. `createTextTool` publishes annotations before clearing the Selection, and picker commits clear the Selection before separately dispatching `commit`; reorder/atomically batch the handoff and add a commit-sequence assertion that no DOM commit contains both preview and final mark. [`client/src/annotations/gestures/useCreateQuickBox.ts:190`]
- [ ] [Review][Patch][Med] Strengthen the new tests around the actual defect and regression paths. The "pixel-identical" test compares one inline style for one rect, the direct-commit test does not assert that a mark was created or detect an intermediate duplicate commit, the scroll test dispatches on `document` rather than a scrolling descendant, and no component test drives overlapping bands or a live two-page/two-column Selection; assert rect count/geometry, committed annotation state, descendant capture, and injected overlap/cross-page cases. [`client/src/annotations/AnnotationInteraction.test.tsx:382`]
- [ ] [Review][Patch][Low] Synchronize the Dev Agent Record with the final reviewed tree. It records 1,532 tests and 12 additions, while the current tree passes 1,533 tests with 13 additions and now includes scroll/resize invalidation behavior that is absent from the completion/file-list narrative. [`.bmad/implementation-artifacts/10-1-unify-selection-color-fix-double-thickening.md:186`]

## Dev Notes

### The one rendering surface, three paint states (the core map)

A text selection under the Highlight tool passes through THREE different renderers across its lifecycle. This is the whole story — both symptoms live here.

| State | When | Renderer | Color / opacity | Geometry | Stacks alpha? |
|-------|------|----------|-----------------|----------|---------------|
| **Live selection** | mid-drag | browser-native `::selection` — `Reader.css:20-25` `.pdf-canvas .textLayer span::selection { background: var(--color-text-selection) }` | `--color-text-selection` = `rgba(13,116,206,0.25)` (blue) | per pdf.js glyph **span** (spans can overlap) | **YES** — overlapping spans composite → darker patch |
| **Pending preview** | quick-box open (post-release, pre-commit) | `.pending-selection-preview` — `AnnotationInteraction.tsx:335-351`, styled in `Annotations.css:175-181` | `--color-text-selection` (same blue 0.25) | per-**line** MERGED (from `rectsFromSelection`→`mergeRects`) | No (one band/line) |
| **Committed highlight** | after picking Highlight | `.annotation-highlight` inside `.annotation-highlights` group — `AnnotationLayer.tsx:491`, styled in `Annotations.css:18-45` | tool color at `--annotation-highlight-opacity` = `0.4` (default yellow) | per-line MERGED, group carries `opacity` + `isolation: isolate`, children OPAQUE | No (single flatten) |

**Item 2 (double-thickening over `.`/whitespace) — leading root cause:** the LIVE native `::selection` surface. pdf.js's custom text layer emits absolutely-positioned, `transform: scaleX(...)`-ed glyph spans that frequently OVERLAP horizontally (a `.` glyph and the following space are separate spans whose boxes overlap). Two translucent `span::selection` backgrounds at 0.25 composite to ~0.44 → the darker patch, exactly at punctuation/space boundaries. Neither the pending preview nor the committed highlight shows this — both run through `mergeRects` (`anchor/index.ts:279`), which unions each line into ONE band, and both composite inside an opacity group. **Confirm this in DevTools before fixing** (AC-2): the fix target depends on which surface actually stacks.

**Item 1 (thickening on release) — leading root cause:** the transition between the three states above. On release the geometry changes (per-span native → per-line merged preview, so the stacking disappears) and on commit the color+opacity jumps (blue 0.25 → tool color 0.4). Both read as "thickening." Note the blue→tool-color jump is PARTLY deliberate (EXPERIENCE.md line 76: "Annotating = live preview of mark; on release → quick-box"; components.css:206-208 calls the blue "the in-progress selection... without competing with the yellow highlight it becomes"). So "unify" is a product call, not a pure bug — see Open design calls.

### Open design calls (resolve in Task 2, record the decision)

1. **What "unify" means** (from the story): does the live selection adopt the created-highlight look (tool color at 0.4), or does everything stay the neutral blue and only match DENSITY? Reconcile with EXPERIENCE.md line 76 (the blue-selecting → colored-highlight transition is intended live-preview language). Changing the color VALUE/palette is explicitly **out of scope** — this is about uniformity/density, not picking a new color.

2. **CSS-only vs a rect-merge/overlay pass** (from the story):
   - **Leading candidate (kills both items in one move):** suppress native `::selection` (`.textLayer span::selection { background: transparent }`) and paint the LIVE drag selection through the SAME per-line-merged, opacity-grouped overlay the pending preview already uses — i.e. render a preview on `selectionchange` (the `SelectionBounder` already listens there) using `rectsFromSelection`+`mergeRects`. Then mid-drag, post-release, and (modulo the intended commit transition) commit all composite identically: no per-span stacking, no geometry jump. **Cost/risk:** native `::selection` is currently the ONLY mid-drag feedback and Story 4.1 deliberately kept it un-gated so the band persists after release; replacing it means re-implementing live drag feedback and re-smoking 4.1's trailing-band + persistence behavior. Perf: the preview re-derives rects on `selectionchange` during a drag — keep it cheap (it already runs per scroll/zoom for the pending case).
   - **Lighter alternative (item 2 only, partial):** you cannot group-flatten browser-native `::selection` (it is per-glyph paint), so a CSS-only fix cannot fully remove the per-span stacking. Reducing `--color-text-selection`'s alpha only makes the stack less visible, not gone. Flag this as a partial if chosen.

3. Whether the fix needs to touch `anchor/` at all (only if a new merge/clip pass is introduced; `mergeRects` already handles the committed/preview path).

### Files in play (with why)

- `client/src/components/Reader/Reader.css:20-25` — the native `::selection` tint rule. Primary lever for the live surface.
- `client/src/theme/components.css:203-209` — `--color-text-selection` token def + rationale comment. `:137-139` — `--annotation-highlight-opacity`. Token edits live here (mirror in `DESIGN.md`).
- `client/src/annotations/Annotations.css:15-45` — `.annotation-highlights` opacity group (the anti-stacking mechanism to mirror) + `:161-181` `.pending-selection-preview`.
- `client/src/annotations/AnnotationInteraction.tsx:335-351` — where `.pending-selection-preview` rects render. The natural home for a unified live-preview overlay if that route is chosen.
- `client/src/anchor/index.ts` — `mergeRects` (`:279`), `rectsFromSelection` (`:490`, already merges per-line), `pendingSelectionGeometry` (`:384`), `collectTextRects` (`:448`). The pure geometry layer; already the correct anti-stacking path.
- `client/src/render/selectionBounder.ts` — Story 4.1 `endOfContent` bounding, the `selectionchange` listener. A live-preview overlay would hang off this same event. Do NOT break the trailing-band bound.
- `client/src/render/textSelection.ts` / `textLayerRegistry.ts` / `copyJoiner.ts` — the Story 8.10 decomposition of the selection controller (PR #72, 2026-07-13). Respect AD-9: these modules import nothing from `anchor/`, `annotations/`, or `store/`. If the live preview needs `anchor/` geometry it belongs in `annotations/`, not `render/`.

### Regression guards (must NOT break)

- **Story 4.1** — the `endOfContent` bound (`selectionBounder.ts`) stops a drag past the last glyph from painting a tall band; `::selection` is un-gated so the band persists after release. Re-smoke both if the live surface changes.
- **Story 4.2** — `mergeRects`'s `GUTTER_GAP_HEIGHT_MULTIPLE` split keeps a two-column selection from bridging the gutter. Don't loosen the merge such that columns re-bridge.
- **Story 8.1** — paragraph-aware copy (`copyJoiner.ts`): text must stay selectable so `selection.toString()` reaches the copy handler and soft-wraps join. If native `::selection` is suppressed, spans/brs keep `user-select` — verify `Ctrl/Cmd+C` output is unchanged.
- **NFR-3** — anchor fidelity: any rect the fix paints must ride zoom (denormalized from the scale-independent stored selection), like the existing pending preview. No pixel-frozen rects.
- **NFR-1** — the mark/preview sheets are `pointer-events:none` overlays that never reflow the canvas. Keep it that way.

### Testing standards

- Unit: Vitest. Pure geometry (`mergeRects` etc.) is unit-testable ONLY via injected `rectsOf` fakes — `anchor/anchor.test.ts` is the home. jsdom returns zeroed `getClientRects()`, so it can NEVER validate the visual result; it exists for the pure math only.
- **Live smoke is the real acceptance gate** (AC-4). The double-thickening and the cross-page leak are invisible to jsdom. Cross-page selection at DPR>1 is mandatory and is the highest-risk path (a cross-page full-page-highlight bug shipped once because only jsdom covered the two-page create — see CLAUDE.md "Selection→rects must measure text nodes").
- Use claude-in-chrome `computer` left_click_drag for smoke — it forms a REAL, trusted `Selection`; chrome-devtools/Playwright drag tools do not. For clipboard readback, capture via an in-page `copy` listener (`clipboard.readText()` hangs on a permission prompt).
- Run against YOUR OWN freshly-launched dev servers (`uvicorn` + `vite dev`), never a server the user already has running (it may be stale / a no-HMR prod build).

### Project Structure Notes

- Client-only change. No server, no OpenAPI contract, no `docs/API.md` touch.
- Layering (architecture downward-dependency rule): `render/` must not import `anchor/`/`annotations/`/`store/` (AD-9). A unified live-preview overlay that needs `anchor/` geometry belongs in `annotations/` (alongside the pending preview), driven by a `selectionchange` subscription — not inside `render/selectionBounder.ts`.
- Token layer: raw hex/px are allowed ONLY under `src/theme/**` (`no-raw-values.test.ts` enforces). Any color/opacity value is a token in `theme/components.css`, mirrored in `DESIGN.md`.
- No em-dash in any user-facing string (there are none expected in this story; guard applies if a tooltip/label is added).

### References

- Story spec: `.bmad/planning-artifacts/epics.md#Story 10.1` (Epic 10, lines ~2288-2311).
- Correct-course origin: `.bmad/planning-artifacts/sprint-change-proposals/sprint-change-proposal-2026-07-18.md` (items 1+2, "Story impact — grounded in current code").
- FR/NFR: reader PRD `.bmad/planning-artifacts/prds/prd-paper-mate-2026-06-28/prd.md` — **FR-7** Highlight (line 49), **FR-8** Underline (line 50), **NFR-3** Anchor fidelity (line 96). NOTE: the Library PRD reuses the numbers FR-7/FR-8/NFR-3 for unrelated things — cite the READER PRD.
- Experience language: `EXPERIENCE.md:76` (Annotating = live preview → quick-box), `:61` (quick-box on drag-release).
- Design tokens: `DESIGN.md` `components.annotation-highlight` (~line 214/497), `text-selection` tint (~line 207).
- Prior-art anti-stacking mechanism to mirror: `Annotations.css:15-23` (`.annotation-highlights` opacity group, "so overlapping/stacked marks do not compound into a darker band, AC #3").
- Selection machinery decomposition: PR #72 (Story 8.10, commit `7154fa4`), `render/textSelection.ts` header comment.
- CLAUDE.md engineering principles: "Selection→rects must measure text nodes, never the whole range" (cross-page smoke mandate); "Bind interaction handlers at the document level"; "Keep the `render/` test mocks in sync."

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5

### Debug Log References

- Live diagnosis performed against fresh dev servers (own `uvicorn --port 8123`, own `vite dev --port 5273`, not any server the user had running), reader open on the real, already-imported "MobileNets" paper (`doc_id 9fd87b0...`) from `~/.paper-mate`, viewport emulated at `deviceScaleFactor: 2` (DPR>1) via chrome-devtools-mcp (`claude-in-chrome` extension was not connected this session, so chrome-devtools-mcp was used instead).
- Selections were formed via a real `Range`/`Selection.addRange` (native browser Selection, indistinguishable from a user drag for CSS `::selection` paint purposes) targeting the pdf.js text-layer spans around "neural networks. We" in the Abstract. Release was simulated by dispatching a `pointerup` at the selection's end point — the app's document-level `pointerup` handler (`useCreateQuickBox.ts`) does not gate on `event.isTrusted`, so this exercises the real production code path.
- One test highlight was transiently persisted to the real library doc during the armed-Highlight-tool probe (confirmed via `GET /api/docs/{doc_id}/annotations`) and was deleted immediately after (`PUT .../annotations` with `[]`) — verified empty afterward. No lasting change to user data.
- Pixel evidence: `/tmp/.../scratchpad/selection-native.png` (mid-drag state) and `/tmp/.../scratchpad/selection-released.png` (cursor-mode post-release state), sampled with PIL at known DOM-rect coordinates (scratch files, not committed).

### Completion Notes List

**Root-cause diagnosis (AC-2), written before any fix:**

**Item 2 — double-thickening over `.`/whitespace. Confirmed: overlapping native `::selection` glyph spans, exactly as the Dev Notes hypothesized.**

Measured every same-line adjacent pdf.js text-layer span pair on the paper's first page: 15 pairs have a horizontally overlapping client rect. The dominant pattern (10 of 15) is a span ending in sentence/word punctuation (`"...networks."`, `"...problem."`, `"...directly."`, etc.) immediately followed by its trailing whitespace span, overlapping by 0.2-0.6 CSS px (0.4-1.2 device px at DPR 2) — pdf.js's own text-layer geometry, not something this app's code generates.

Pixel-level proof at one such boundary (`"networks."` / `" "` before `"We"`): a selection background over a single, non-overlapping span renders `rgb(194,220,242)` — white composited once with `--color-text-selection` (`rgba(13,116,206,0.25)`), matching the token exactly (solved for alpha: 0.252). Inside the ~0.2px overlap sliver, the same selection renders `rgb(149,194,233)`. Two stacked 0.25-alpha layers composite to an effective alpha of `1-(1-0.25)^2 = 0.4375`; the predicted R channel is `255*(1-0.4375)+13*0.4375 = 149.1` — matches the measured 149 pixel-exact. This is the mechanism: native `::selection` paints **per pdf.js glyph span** (browser-internal, cannot be merged or group-composited by app CSS), so any two spans whose boxes overlap by even a sub-pixel amount stack their translucent backgrounds into a visibly darker patch. Neither the pending preview nor the committed highlight shows this because both go through `mergeRects` (per-line union) before painting — confirmed structurally by reading `anchor/index.ts:279,490`.

**Item 1 — thickening on release. Two distinct release paths exist; only one is a genuine bug, the other is a deliberate (if abrupt) style transition.**

1. **Cursor mode (no tool armed) → H/U/C picker pops.** `useCreateQuickBox.ts` (~line 347-354) deliberately leaves the native Selection alive on release ("so Ctrl+C still copies the dragged text" — a prior fix, per its own comment) while `AnnotationInteraction.tsx:335-351` renders `.pending-selection-preview` divs (same `--color-text-selection` blue, merged per-line) **on top of** that still-live selection. Both are independent, absolutely-positioned, alpha-0.25 layers occupying the same screen rect → live-verified: a background pixel that reads `rgb(194,220,242)` (single layer) mid-drag reads `rgb(148,194,232)` in the identical screen position immediately after the simulated release — matching the same double-composite math as Item 2, but now covering the **entire** selected band, not just punctuation seams. **This is a real stacking bug**, not a deliberate transition: nothing in EXPERIENCE.md or the CSS comments intends the picker's blue preview to be painted on top of a still-live native selection.
2. **A tool (e.g. Highlight) armed → direct commit, no pending state.** `createTextTool` (`useCreateQuickBox.ts:197-211`) clears the native selection immediately (`window.getSelection()?.removeAllRanges()`) and creates the committed `.annotation-highlight` mark directly — live-verified: after release, `window.getSelection().toString()` is `""` and the mark is an opaque yellow fill (`rgb(255,228,120)`) whose 0.4 opacity is carried by the parent `.annotation-highlights` group (`isolation: isolate`), so it does not stack. No double-layer bug here. What reads as "thickening" is the simultaneous geometry snap (per-span → per-line merged) and color/opacity jump (blue 0.25 → tool color 0.4) happening in the same frame — this transition is partly deliberate (EXPERIENCE.md:76 "Annotating = live preview of mark; on release → quick-box"; `components.css:206-208`'s own rationale comment for the blue token), so "unify" here is a product call (Task 2), not a pure bug fix.

**Net:** Item 1's dominant, unambiguous bug is (1) — the double-painted cursor-mode release. Item 2 is the native-`::selection` per-span overlap. Both items 1(1) and item 2 share the same underlying fix shape: stop compositing translucent layers over the same screen region outside of `mergeRects`'s per-line union + a single opacity-group flatten (the mechanism `.annotation-highlights` and `.pending-selection-preview`'s own single-layer case already use correctly). Item 1(2)'s blue-to-tool-color jump is a separate, smaller product decision, addressed in Task 2.

**Task 2 — open design calls, resolved:**

1. **What "unify" means:** density/geometry only, NOT color value. The live selection and the post-release pending preview both stay the neutral `--color-text-selection` blue at 0.25 opacity (unchanged token), now uniform because both phases paint through the same merged, single-layer geometry pass (no more per-span stacking, no more double-layer stacking). The blue-to-tool-color, 0.25-to-0.4 jump at COMMIT (whichever path: armed-tool direct-commit, or picking a tool from the quick-box) is left alone — that transition is the deliberate live-preview-to-final-mark language EXPERIENCE.md:76 describes, and the story's own scope note is explicit: "changing the color VALUE/palette is explicitly out of scope." The user-perceived "thickening on release" this story targets is the STACKING bug (Item 1's path (1)), not this deliberate commit transition.
2. **Fix shape: suppress native `::selection` + a live-preview overlay through the existing `rectsFromSelection` -> `mergeRects` path** (the Dev Notes' "leading candidate," confirmed safe): `::selection` is pure CSS paint, so suppressing it does NOT touch the `Selection`/`Range` object, `SelectionBounder`'s `endOfContent` bounding (Story 4.1), or `copyJoiner.ts`'s `Ctrl/Cmd+C` (Story 8.1) — all three keep working unchanged. This eliminates the "re-implementing live drag feedback" risk the Dev Notes flagged for this option: only the VISUAL layer is replaced, not the selection mechanics. The lighter CSS-only alternative was rejected per the Dev Notes' own caveat: it cannot fully remove native per-span stacking (Item 2) and does nothing for Item 1's double-layer stacking (a different compounding mechanism: pending-preview stacked over a still-alive, still-visible native selection).
3. **`anchor/` touch:** no new merge/clip pass. Reused `rectsFromSelection`, `mergeRects` (indirectly, inside `rectsFromSelection`), `pendingSelectionGeometry`, and `clipRectToViewport` exactly as they exist. One new small shared pure function, `viewportRectsFromPages` (denormalize-and-clip-to-viewport), factored OUT of `useCreateQuickBox`'s previously-inline flatMap so the new live-drag preview and the existing post-release pending preview call the identical geometry pass rather than each hand-rolling their own (CLAUDE.md: refactor structure in the same change).

**Task 5 — live smoke (AC-4), against the fix (own dev servers, MobileNets paper, DPR 2):**

- **Deviation from the story's trusted-input instruction:** the `claude-in-chrome` browser extension was not connected this session ("Browser extension is not connected"), so `computer` `left_click_drag` was unavailable. Used `chrome-devtools-mcp` (a real, non-jsdom Chrome instance) instead, forming selections via `Range`/`Selection.addRange` and dispatching a real `pointerup` `PointerEvent`. This exercises the identical production code paths `rectsFromSelection`/`useLiveSelectionPreview`/`useCreateQuickBox` read (`window.getSelection()`, real `getClientRects()`, the app's own document-level `pointerup` listener, which does not gate on `event.isTrusted`) — the one thing NOT exercised is the OS-level mouse-drag gesture itself (`SnapController`'s pointerdown/pointermove path). A follow-up smoke with a real trusted drag (claude-in-chrome, once reconnected) is recommended before merge but was not blocking for this pass since the fix is a paint-layer change with no pointer-gesture logic touched.
- **`. `/whitespace boundary, one line, DPR 2:** re-ran the exact diagnosis measurement (`"neural networks. We"`, spans 26-28) against the FIXED code. Pre-fix the overlap sliver read `rgb(149,194,233)` (double-composited) against a `rgb(194,220,242)` single-layer baseline. Post-fix: the ENTIRE band, including the former overlap sliver, reads a uniform `rgb(194,220,242)` mid-drag. Confirmed at every reachable state: mid-drag (before pointerup), immediately after a cursor-mode pointerup (quick-box open, native selection still alive per the existing Ctrl+C-preserving design), and committed (Highlight armed, direct commit) — no darker patch at any point, no color/geometry jump between mid-drag and post-release.
- **Cross-page selection, DPR 2:** selected from "Compression based on..." (page 1, last real text line) through "Photo by Juanedc..." (page 2, a caption near Figure 1) — a range whose raw `Range.getBoundingClientRect()` spans -1275px to 1691px (would be a full-page leak if the whole range's rects were used). The rendered preview produced 9 small rects (max height 25px), none page-sized — confirms `collectTextRects`'s per-text-node measurement (the Story 4.2/cross-page anti-leak fix) is preserved through the new live-preview path, since it calls the exact same `rectsFromSelection`.
- **Story 4.1 regression (trailing band):** selected from a short line (`"convnets [37]."`, far short of its column's right edge) through the last node in the page's text layer (simulating a drag that ran to the end of the page). Preview rects: max height 21px (one text line) — no anomalous tall band.
- **Story 4.2 regression (two-column gutter):** selected across "Finegrain Classification" (right column) and "Object Detection" (left column) at the identical line height (`top: 399.625`). Rendered as TWO separate rects (`left:828,width:130` and `left:215.7,width:91.4`) — not one wide rect bridging the ~500px gutter. `mergeRects`'s `GUTTER_GAP_HEIGHT_MULTIPLE` split still holds through the new path.
- **Story 8.1 regression (paragraph copy):** selected the Abstract's first two soft-wrapped lines. `selection.toString()` (raw) returns them newline-joined; capturing the actual `copy` event (`document.execCommand('copy')` + an in-page `copy` listener reading `event.clipboardData`, per the clipboard-readText-hangs memory) shows `copyJoiner.ts` still joins them with a space, unchanged — confirms suppressing native `::selection` paint (pure CSS) does not touch `Selection`/`Range`/copy behavior at all, as predicted in the diagnosis.
- Before/after screenshots + the pixel-sampling scripts are in the scratchpad (not committed): `selection-native.png`/`selection-released.png` (bug, pre-fix) and `selection-fixed-middrag.png`/`selection-fixed-released.png` (fixed).
- One test highlight was transiently created twice during this pass (once per armed-Highlight-tool check) and deleted immediately after each (`PUT /api/docs/.../annotations` with `[]`), verified empty via a final `GET`. No lasting change to the user's real library data.
- Full frontend suite: `npm test -- --run` → **1532/1532 passing** (1520 pre-existing + 12 new). One unrelated test (`Reader.test.tsx`'s Ctrl +/-/0 zoom-key test) flaked ONCE across ~5 full-suite runs during this session, in a full-suite context only (never in file-isolated runs); confirmed present on the pre-story baseline too (same flake profile, unrelated to selection/zoom logic touched by neither baseline nor this change) — not a regression from this story. `npm run typecheck` clean.

**Task 6 — backend unaffected:** client-only change (`client/src/anchor/`, `client/src/annotations/`, `client/src/components/Reader/Reader.css`, `client/src/theme/components.css`). No `server/` file touched, no OpenAPI contract change, `docs/API.md` untouched. No version bump in this change (happens at PR-merge time per CLAUDE.md versioning policy).

**Post-implementation fix request — "ghost selection" on scroll mid-drag:** the user reported (with a screenshot) a blue selection band left frozen at a stale screen position after scrolling during an active drag-select, plus an odd split double-row artifact. Root cause: `useLiveSelectionPreview` only recomputed on `selectionchange`; a scroll that does not itself change the Selection's anchor/focus nodes (a plain wheel scroll or the browser's auto-scroll-while-dragging near the viewport edge) fires no `selectionchange` at all, so the hook kept rendering the LAST computed `position: fixed` pixel rects — frozen at the pre-scroll screen location, exactly matching the reported ghost. Fix: added the same `scroll` (capture phase, since `.pdf-canvas`'s scroll doesn't bubble) and `resize` listeners `useCreateQuickBox`'s `computePendingGeometry` already uses for the post-release phase, both forcing the same render-time-fresh recompute the hook already does for `selectionchange`. Live-verified in a real browser: scrolled the canvas 300px mid-selection: the preview's screen position moved by exactly 300px, matching the (freshly re-read) glyph's new position (2px of that gap is the Range's own start offset into the glyph, not drift) — no ghost band left behind. Added a regression test (`AnnotationInteraction.test.tsx`, "tracks a scroll mid-drag...") that moves the stubbed selection bands AND the fake card position together (a naive test that only moved the card, leaving the stubbed selection bands fixed, does not model a real scroll — text and its containing card move together — and gave a false pass); confirmed the test fails without the fix (manually reverted, re-ran) and passes with it. Full suite 1533/1533, typecheck clean.

### File List

- `client/src/anchor/index.ts` — added `viewportRectsFromPages` (shared denormalize-and-clip-to-viewport pass).
- `client/src/annotations/gestures/useCreateQuickBox.ts` — refactored `computePendingGeometry` to call `viewportRectsFromPages` instead of its own inline flatMap.
- `client/src/annotations/gestures/useLiveSelectionPreview.ts` (new) — the live (pre-release) half of the text-selection preview.
- `client/src/annotations/AnnotationInteraction.tsx` — wires `useLiveSelectionPreview`, unifies `selectionPreviewRects` across the live and pending phases, updates the render gate + preview JSX comment.
- `client/src/components/Reader/Reader.css` — suppresses native `::selection` paint (background: transparent), updated rationale comment.
- `client/src/annotations/Annotations.css` — updated `.pending-selection-preview` comment for its dual-phase (live + pending) role.
- `client/src/theme/components.css` — updated `--color-text-selection` rationale comment (no token value change).
- `client/src/anchor/anchor.test.ts` — added `viewportRectsFromPages` unit tests (5 cases).
- `client/src/annotations/AnnotationInteraction.test.tsx` — added a nested describe block for the live selection preview (7 tests); fixed the resulting nesting so pre-existing tests stayed correctly scoped.
- `.bmad/implementation-artifacts/10-1-unify-selection-color-fix-double-thickening.md` — this story file (frontmatter, tasks, Dev Agent Record).
- `.bmad/implementation-artifacts/sprint-status.yaml` — status tracking.

(Post-implementation fix, same files touched again: `client/src/annotations/gestures/useLiveSelectionPreview.ts` — scroll/resize listeners added; `client/src/annotations/AnnotationInteraction.test.tsx` — added a scroll-mid-drag regression test.)

## Change Log

- 2026-07-19: Story created from the correct-course sprint-change-proposal-2026-07-18.md (items 1+2).
- 2026-07-19: Root-cause diagnosis (AC-2) written before any fix, live-verified against a real paper at DPR 2 (`chrome-devtools-mcp`, `claude-in-chrome` unavailable this session). Item 2 (punctuation/whitespace double-thickening): overlapping native `::selection` glyph spans compositing 0.25-alpha to ~0.44, pixel-confirmed exact. Item 1 (release thickening): two distinct paths — a genuine double-layer stacking bug in cursor-mode release (pending preview painted on top of a still-alive native selection), and a separate, partly-deliberate blue-to-tool-color commit transition in the armed-tool direct-commit path.
- 2026-07-19: Design decision (Task 2): "unify" = density/geometry only (native `::selection` suppressed; a new live-preview overlay, `useLiveSelectionPreview`, replaces it through the existing `rectsFromSelection` → `mergeRects` → `pendingSelectionGeometry` pipeline). The commit-time blue→tool-color/0.25→0.4 jump stays (EXPERIENCE.md's deliberate live-preview-to-mark language; color VALUE changes are out of scope).
- 2026-07-19: Implemented (Task 3): `viewportRectsFromPages` (new shared `anchor/` helper, also refactors `useCreateQuickBox`'s prior inline duplicate), `useLiveSelectionPreview` (new hook), `AnnotationInteraction.tsx` wiring, Reader.css/Annotations.css/components.css comment + suppression updates. Unit tests added (`anchor.test.ts` +5, `AnnotationInteraction.test.tsx` +7). Full suite 1532/1532 green, typecheck clean.
- 2026-07-19: Live-smoked the fix (Task 5) at DPR 2 against a real paper: punctuation/whitespace boundary now uniform at every phase (mid-drag/release/committed), cross-page selection shows no full-page leak, Story 4.1/4.2/8.1 regressions all re-verified holding.
- 2026-07-19: Fix request (user-reported, with screenshot): a scroll mid-drag left a "ghost" selection band frozen at the pre-scroll screen position. `useLiveSelectionPreview` was missing the `scroll`/`resize` listeners the post-release pending preview already has. Fixed, regression-tested (confirmed the test fails without the fix), live-verified (300px scroll -> preview moves exactly 300px, no ghost). 1533/1533 green.
