---
baseline_commit: 17f6eb6059a68fdd658df6db0ea990e0020c5168
---

# Story 10.2: Section navigation, synthesized Table of Contents

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a reader,
I want a table of contents built from the paper's own headings,
so that I can jump to any section even when the PDF has no embedded outline.

## Acceptance Criteria

1. **(Synthesized ToC from detected headings, FR-35, AD-4/AD-13)** Given an analyzed paper with detected headings, when I open the Table of Contents, then it lists the headings in reading order with their hierarchy (from `heading_level`), and each entry jumps to that heading's page AND region (not just the page top). The list is built from the Story 10.1 structure layer's `heading` elements via the client `structure/` service (a thin reader, no new PDF parsing).
2. **(Precedence: embedded outline vs synthesized, single source, FR-3/FR-35)** Given a paper WITH a non-empty embedded PDF outline, then the embedded outline is shown (unchanged from Story 1.9, author-curated); given a paper WITHOUT an embedded outline (the common case), then the synthesized-from-headings ToC is shown; the two NEVER double-render (exactly one source at a time). A paper with NEITHER shows the existing empty state unchanged.
3. **(Composes with windowing + a region flash, no jank, NFR-2)** Given a heading (region) jump, then it reuses the Story 1.7 render windowing (the target page's card geometry is reserved up front, so the jump lands correctly even on a not-yet-canvas-rendered page) and briefly flashes the landing region using a generalized version of the Story 3.6 flash idiom, landing at the section without a scroll-jank burst. A page-only (embedded) entry keeps the existing instant page jump.
4. **(Reuses the ToC panel affordance, no em-dash, UX-DR17)** Given the ToC UI, then it reuses the existing `TocPanel` overlay (Story 1.9): overlay-only (never reflows the canvas, NFR-1), `Esc` closes, rows are real `<button>`s, depth indentation. Any label/tooltip/copy it renders contains no em-dash.
5. **(Coordinate correctness live-smoked at DPR>1)** Given a synthesized region jump, then it is live-smoked at DPR>1 on a multi-column paper: each row lands on the real on-page heading across pages and across a zoom change, and the region flash box sits on the heading, not only in a unit test.

## Tasks / Subtasks

- [ ] **Task 1 — Synthesize a ToC from structure headings (AC: #1).** In `client/src/structure/index.ts`, add a pure selector `synthesizeToc(structure: DocStructure): TocEntry[]` beside the existing `headings()`:
  - Map each `heading` element (in reading order, which is already the array order) to a `TocEntry`: `title = element.text`, `pageNumber = element.page_index + 1` (0-based -> 1-based, the `TocEntry` convention), `depth = clampDepth(element.heading_level)`, and a region `topFraction = element.rect.y0` (the normalized top of the heading, the same `[0,1]` fraction species `jumpToAnnotation` consumes).
  - `clampDepth(level: number | null | undefined) = Math.max(0, Math.min((level ?? 1) - 1, 5))` (heading level 1 -> depth 0; missing/thin level -> depth 0; cap at 5 so a noisy deep level can't run the indent off the panel).
  - Import the `TocEntry` type from `@/render` (type-only import; render is a peer/lower layer and never imports `structure/`, so no cycle). Do NOT redefine the ToC shape.
  - Skip empty/whitespace-only titles (`element.text.trim() === ""`) so a blank heading element never produces a dead row (mirror `getOutline`'s `if (title)` guard).

- [ ] **Task 2 — Extend `TocEntry` with an optional region (AC: #1, #3).** In `client/src/render/index.ts`, add an optional field to the existing `TocEntry` interface: `topFraction?: number`. Embedded-outline entries (from `getOutline`) leave it undefined (a page-level jump, unchanged); synthesized entries carry `rect.y0`. This keeps ONE panel view model. This is an additive optional field, so `getOutline` and its tests do not change, and no `render/index.ts` EXPORT is added (only the interface is widened) so the `vi.mock("./render")` barrels in `App.test.tsx`/`Reader.test.tsx` need no change (verify: no new export means no barrel edit; CLAUDE.md engineering-principles rule).

- [ ] **Task 3 — Precedence resolver (AC: #2).** In `client/src/structure/index.ts`, add a pure `resolveToc(embedded: TocEntry[], structure: DocStructure): TocEntry[]`: return `embedded` when it is non-empty (author-curated wins, keeps Story 1.9 behavior for papers that have an outline); otherwise return `synthesizeToc(structure)` (the synthesized fallback for the outline-less common case). When both are empty this returns `[]` (the panel's existing empty state). This guarantees exactly one source renders (never a merge, never double).

- [ ] **Task 4 — Generalize the flash idiom to a non-annotation region (AC: #3).** The existing `flashAnnotation(id)` flashes an annotation MARK by id (`store` `flashId` -> `AnnotationLayer` `--flash` CSS). A synthesized heading is NOT an annotation, so a region flash is needed. Build it as a reusable reader primitive (Story 10.3's Figures/Tables index needs the SAME thing; do not build a ToC-only one):
  - New tiny standalone store `client/src/reader/regionFlash.ts` (a small Zustand store, NOT the annotation store: AD-9 keeps the annotation store the annotation working copy, and a structure-jump region is not an annotation). Shape: `{ region: { pageIndex: number; rect: Rect } | null; flash(region): void; clear(): void }`. Plus a free `flashRegionAt(pageIndex: number, rect: Rect): void` that sets the region then auto-clears after `FLASH_MS`, cancelling any prior pending clear FIRST (copy the `flashAnnotation` module-level-timer idiom in `store/index.ts` exactly, importing `FLASH_MS` from `@/store`).
  - New per-page overlay `client/src/reader/RegionFlashLayer.tsx`, rendered inside `PageCard` beside `AnnotationLayer`/`StructureDebugLayer`. It subscribes to the region-flash store; when `region.pageIndex === thisPageIndex`, it renders one positioned box at `denormalizeRect(region.rect, box, scale)` (reuse the anchor `denormalizeRect`, AD-9: no new coordinate math) with a `region-flash` class that pulses ~`FLASH_MS` then the box unmounts on auto-clear. Model the pulse CSS on `bank-flash` (`Annotations.css` L1232+): a `box-shadow` ink ring pulse (layout-free, NFR-1). Put the CSS wherever the reader overlay styles live (a new `RegionFlashLayer.css` or the reader stylesheet); use tokens only (`no-raw-values` guard) - reuse `--bank-flash-ring-width`/`--color-ink` or add a `--region-flash-*` token in `components.css` if a distinct look is wanted.
  - Only the SYNTHESIZED (region) jump flashes; a page-only embedded jump has no rect and keeps the current no-flash instant page scroll.

- [ ] **Task 5 — Wire precedence + region jump into `ReaderPage` (AC: #1, #2, #3).** In `client/src/reader/ReaderPage.tsx`:
  - Add `const { structure, loading: structureLoading } = useDocStructure(docId ?? null);` (the hook already exists from Story 10.1; import from `@/structure`).
  - Compute the panel entries + loading from the embedded `toc` state (already reported up by `Reader.onOutline`, `null` until the doc is ready) AND the structure:
    - `toc === null` -> entries `null` (still loading the embedded outline).
    - `toc` non-empty -> `resolveToc(toc, structure)` = `toc` (embedded wins; no need to wait on structure).
    - `toc` empty AND `structureLoading` -> entries `null` (loading the synthesized source).
    - `toc` empty AND not loading -> `resolveToc(toc, structure)` = `synthesizeToc(structure)` (may be `[]` -> empty state).
  - Change the `TocPanel` `onJump` to receive the ENTRY (Task 6) and branch: if `entry.topFraction !== undefined` -> `readerRef.current?.jumpToAnnotation(entry.pageNumber - 1, entry.topFraction)` then `flashRegionAt(entry.pageNumber - 1, headingRectFor(entry))` (see below); else -> `readerRef.current?.jumpToPage(entry.pageNumber)` (page-only, unchanged). Close the panel in both branches (`setTocOpen(false)`, one-shot nav, unchanged from Story 1.9).
  - The flash needs the heading's full `Rect`, not just `topFraction`. Two clean options, pick one and note it: (a) carry the full `rect` on the synthesized `TocEntry` (add `rect?: Rect` alongside `topFraction?`), so the jump handler has it directly; or (b) keep `topFraction` only and look the element back up. Option (a) is simpler and keeps the handler pure. Recommended: put `rect?: Rect` on `TocEntry` (synthesized entries only) and drop the redundant `topFraction` in favor of `rect.y0` at the jump site, so there is ONE region field, not two. Decide in implementation; keep it to a single region field.

- [ ] **Task 6 — `TocPanel` passes the entry to `onJump` (AC: #1, #4).** In `client/src/components/TocPanel/TocPanel.tsx`, change `onJump: (pageNumber: number) => void` to `onJump: (entry: TocEntry) => void` and the row `onClick` to `onJump(entry)`. Everything else (indent by `depth`, empty/loading states, `Esc`-to-close, `<button>` rows) is unchanged and correctly serves synthesized entries too. Update `TocPanel.test.tsx`: the jump assertion becomes `expect(onJump).toHaveBeenCalledWith(entries[2])` (the whole entry, not `5`). Keep the panel copy exactly (`Contents`, `This PDF has no table of contents.`, `Loading contents…`) - all em-dash-free; the "no table of contents" empty state is still accurate when neither source exists.

- [ ] **Task 7 — Tests (AC: #1, #2, #3, #4).**
  - [ ] `client/src/structure/index.test.ts` (extend): `synthesizeToc` maps headings -> entries (title/pageNumber+1/depth-from-level/region), preserves reading order, excludes non-heading elements and blank-title headings, `heading_level` null/absent -> depth 0, deep level clamped. `resolveToc`: embedded non-empty -> embedded; embedded empty -> synthesized; both empty -> `[]`.
  - [ ] `client/src/reader/regionFlash.test.ts` (new): `flashRegionAt` sets the region then clears after `FLASH_MS` (fake timers); a second call cancels the prior timer and retargets (no early clear of the new region). Mirror `store` `flashAnnotation` test patterns.
  - [ ] `client/src/reader/RegionFlashLayer.test.tsx` (new): given a region on this page in the store, it renders the box (class present); given a region on a DIFFERENT page or `null`, it renders nothing. jsdom has no layout (`getBoundingClientRect` = 0), so assert presence/class, NOT pixel geometry (that is live-smoke, AC #5).
  - [ ] `TocPanel.test.tsx` (update): `onJump` receives the entry (Task 6).
  - [ ] If `PageCard` gains a `RegionFlashLayer` child and `PageCard`/`Reader` tests mock `@/reader/regionFlash` or the render tree, keep them green (add the mock if a suite imports the new store). Run the full suite + `npm run typecheck`.

- [ ] **Task 8 — Live smoke at DPR>1 (AC: #2, #3, #5), YOUR OWN dev servers, throwaway `PAPER_MATE_DATA`.** Start your OWN `uvicorn` + `vite dev` (never a user-launched/Docker server, CLAUDE.md) with a throwaway `PAPER_MATE_DATA` scratch dir. Prefer trusted input (`claude-in-chrome`); the `chrome-devtools-mcp` `emulate({viewport:"...x...x2"})` DPR-2 fallback is acceptable if unavailable (AE7-2 tooling gap: note it, don't re-solve it).
  - [ ] **Synthesized path (the motivation):** import a multi-column paper with NO embedded outline (e.g. `client/fixtures/sample-pdfs/no-outline.pdf`, or a real arXiv paper like `1903.03295v2.pdf`). Open the ToC: it is now POPULATED from headings (was empty in Story 1.9). Click rows across several pages: each lands on the real section heading (page + region), the region flash box sits on the heading, and it stays correct across a zoom change. Confirm at DPR 2.
  - [ ] **Precedence:** import a paper WITH an embedded outline (`client/fixtures/sample-pdfs/outlined-sample.pdf`). Open the ToC: it shows the EMBEDDED outline (unchanged, page-level jumps), and the synthesized rows do NOT also appear (single source, no double-render). If no outlined multi-column fixture exists, record which fixture proved each side.
  - [ ] **Far-page jump (windowing + flash):** click a ToC row for a distant page; confirm the smooth glide lands correctly and the region flash appears once the page enters the live window (the Bank-jump model; note if the flash ever clears before a very long glide completes).
  - [ ] **Empty state:** a paper with neither source shows the existing empty state, or record that no such fixture was available.
  - [ ] Delete the transient test docs afterward; confirm the scratch `PAPER_MATE_DATA` is clean; stop the dev servers.

- [ ] **Task 9 — Version + docs.** PATCH +1 at PR-merge (CLAUDE.md versioning): `0.6.1 -> 0.6.2`. Do NOT hardcode the version anywhere but `server/pyproject.toml`. This story adds NO `/api` endpoint (it consumes the existing `GET /api/docs/{id}/structure` from Story 10.1), so `docs/API.md` needs no change. No backend change at all (client-only consumer of the 10.1 layer).

## Dev Notes

### This is a consumer of the Story 10.1 layer, client-side only

Story 10.1 already built and shipped the whole structure layer: the server extraction, the `structure.json` per-doc artifact, `GET /api/docs/{id}/structure`, and the client `structure/` service (`client/src/structure/index.ts`) with `headings()`/`figures()`/`tables()`/`elementAt()`/`denormalizeElement()` plus the `useDocStructure(docId)` fetch/hold hook. **10.2 adds NO backend code and NO new API surface.** It is a thin client consumer: read `headings()`, shape them into the existing `TocEntry` view model, decide precedence against the embedded outline, and jump+flash. Resist adding any server work. [Source: Story 10.1 File List + AC #4; `client/src/structure/index.ts`; `client/src/structure/useDocStructure.ts`.]

### The three open design calls the epic left for create-story, decided

1. **Embedded-vs-synthesized precedence -> embedded-preferred, synthesized-fallback, single source.** When the PDF has a non-empty embedded outline it wins (author-curated, exact titles, reliable page targets; keeps every Story 1.9 good case UNCHANGED, so zero regression on outlined papers). When it is empty (most papers, the whole FR-35 motivation) the reader synthesizes from `structure.headings()`. Exactly one source renders, never a merge, so the two can never double-render. Both empty -> the existing empty state. `resolveToc(embedded, structure)` is the one place this is decided. [Source: epic Story 10.2 AC #2 + "Open design calls"; sprint-change-proposal-2026-07-20 L16, L87.]
2. **Hierarchy depth -> from `heading_level`, `depth = clamp(level - 1, 0, 5)`.** opendataloader emits leveled headings (`heading_level`); level 1 -> depth 0 (top), deeper levels indent. A missing/thin level defaults to depth 0. Cap at 5 so a noisy level can't push the indent off the 280px panel. The panel already indents by `depth` (`calc(var(--toc-indent-step) * (depth + 1))`), so no panel change. [Source: `StructureElement.heading_level`, Story 10.1 contract; `TocPanel.tsx` L78.]
3. **Story 1.9's outline code stays as the PREFERRED source, not retired.** `render/getOutline` is unchanged and remains the first-choice source when present. It is not dead code and is not a mere fallback: for outlined PDFs it is strictly better than synthesized headings. The synthesized path is the NEW fallback that fills the outline-less gap. [Source: epic Story 10.2 "Open design calls"; `render/index.ts` `getOutline` L108-131.]

### Coordinate model: region jump reuses the anchor fraction species (AD-4, AD-9)

A synthesized heading carries a normalized `Rect` (the SERVER already did the PDF-points -> `[0,1]` top-left flip in Story 10.1's `domain/structure.py`; the client never sees PDF points). The reader's `jumpToAnnotation(pageIndex, topFraction)` already scrolls to `topFraction * card.clientHeight` (a page-normalized, zoom-independent fraction) with a 15% viewport margin, and is the exact mechanic the Annotation Bank uses. A heading region jump = `jumpToAnnotation(page_index, rect.y0)` (0-based `page_index` = `pageNumber - 1`). This is NOT new coordinate math: `topFraction` and `rect.y0` are the SAME fraction species, and the region flash box uses the anchor `denormalizeRect` (the one home of normalize<->screen math, AD-9). Do not invent a second jump primitive or a second coordinate path. [Source: `reader/usePageNav.ts` `jumpToAnnotation` L84-92 + `JUMP_MARGIN_FRACTION`; AD-4 (normalization basis, top-left, y-down); AD-9 (coordinate math at the anchor boundary); `anchor/` `denormalizeRect`.]

### The flash idiom must be generalized (Story 3.6 was annotation-only)

`flashAnnotation(id)` in `store/index.ts` sets `flashId`, which `AnnotationLayer` reads to apply the `--flash` pulse to the annotation MARK with that id. It only works for existing annotations. A synthesized ToC heading is not an annotation, so this story introduces a **generic region flash** (`reader/regionFlash.ts` + `RegionFlashLayer.tsx`) that pulses a transient box at a `{pageIndex, rect}` for `FLASH_MS`, then auto-clears. Copy the proven idiom exactly: the module-level cancel-prior timer from `flashAnnotation` (L681-700), and the `bank-flash` box-shadow ink-ring pulse from `Annotations.css` (L1232+, layout-free so NFR-1 holds). Home it in a small STANDALONE store, not the annotation store: AD-9 keeps the annotation store the annotation working copy, and a structure-jump region is not an annotation. **Story 10.3 (Figures/Tables index) reuses this same primitive** ("briefly indicates its region (the Story 3.6 flash idiom)"), so build it reusable now, not ToC-specific. [Source: `store/index.ts` `flashAnnotation` L681-700, `FLASH_MS` L679; `annotations/AnnotationLayer.tsx` `flashed` L144; `annotations/Annotations.css` `bank-flash` L1232+; epic Story 10.3 AC #2.]

### Where each piece lives (downward dependency holds)

- `structure/index.ts` (existing service): add `synthesizeToc` + `resolveToc` (pure selectors). Depends downward on `@/render` (the `TocEntry` type, type-only) + already `@/anchor`. No React.
- `render/index.ts` (existing): widen `TocEntry` with an optional region field only (additive; no new export -> no `vi.mock("./render")` barrel edit).
- `reader/regionFlash.ts` + `reader/RegionFlashLayer.tsx` (new): the reusable region-flash store + per-page overlay; the overlay uses the anchor `denormalizeRect` only.
- `reader/PageCard.tsx` (existing): render `<RegionFlashLayer>` per page, beside `AnnotationLayer`/`StructureDebugLayer` (mirror how Story 10.1 added `StructureDebugLayer` per page). [Source: Story 10.1 File List: `PageCard.tsx` renders `<StructureDebugLayer>` per page.]
- `reader/ReaderPage.tsx` (existing): add the `useDocStructure` hook, compose entries + loading, branch the jump (region vs page), call `flashRegionAt`.
- `components/TocPanel/TocPanel.tsx` (existing): `onJump` now takes the entry.

### Files to read before editing (UPDATE targets, current behavior to preserve)

- `client/src/reader/ReaderPage.tsx` — holds `tocOpen`/`toc` React state; `toc` is reported up by `Reader.onOutline` and is `null` until the doc is ready (so a pending outline shows the loading note, not the empty state). The ToC `onJump` currently calls `readerRef.current?.jumpToPage(p)` + `setTocOpen(false)`. The Bank jump (`handleBankJump`) is the region-jump+flash template: `jumpToAnnotation(pageIndex, topFraction)` + `flashAnnotation(id)`. Preserve: the loading-vs-empty distinction, one-shot panel close on jump, and the fact that `activeTool`/panel state is ReaderPage React state (not the store). [ReaderPage L112-117 `toc` state, L300-304 `handleBankJump`, L470-478 `TocPanel` wiring.]
- `client/src/components/TocPanel/TocPanel.tsx` — presentational, owns no pdf/scroll state; `entries: TocEntry[] | null` (`null` = loading), `Esc`-to-close, `<button>` rows indented by `depth`. Preserve all of it; only widen `onJump` to the entry.
- `client/src/render/index.ts` — `TocEntry { title, pageNumber, depth }` L73-77; `getOutline` L108-131 (embedded outline, page-resolved, tolerant, `[]` when none). Preserve `getOutline` unchanged; only add the optional region field to `TocEntry`.
- `client/src/reader/usePageNav.ts` — `scrollToPage` (instant, page-top, used by arrows/keys + the current ToC) vs `jumpToAnnotation` (smooth glide + 15% margin, used by the Bank). Region jumps use `jumpToAnnotation`; page-only jumps keep `scrollToPage` (via `jumpToPage`). [L84-92.]
- `client/src/structure/index.ts` + `useDocStructure.ts` — the layer this story consumes; `headings()` returns `heading` elements in reading order; the hook exposes `{ structure, loading }`.

### Render windowing (Story 1.7) already satisfies "target page rendered before the jump"

The reader mounts ALL page cards up front (reserve-geometry) and only canvas-renders the live window. A card's `offsetTop` is therefore always reserved, so `jumpToPage`/`jumpToAnnotation` land correctly even on a page whose canvas has not rendered yet; the canvas renders as the page enters the window during the glide. The Bank far-jump already relies on this and works, so the ToC region jump does too. The one thing to verify in smoke (Task 8): the region flash on a FAR page appears after the glide brings the page live (its `RegionFlashLayer` mounts when the page is live); note if a very long glide ever outlasts `FLASH_MS`. [Source: Reader header note "All cards mount up front (reserve-geometry)"; `usePageNav` `scrollCardIntoView` uses `card.offsetTop`.]

### Scope discipline

Out of scope (epic-stated): editing/reordering the synthesized ToC; numbering sections. In scope is only: synthesize, decide precedence, jump+flash, reuse the panel. No new API, no server change, no metadata/reading-helper/figures-index work (those are 10-3..10-6). [Source: epic Story 10.2 "Out of scope".]

### Interaction with the other in-flight Epic 10 stories

- **10.3 (Figures/Tables index)** will reuse the region-flash primitive built here (Task 4) and the same `denormalizeElement` jump pattern. Build the flash reusable, not ToC-specific, so 10.3 imports it rather than duplicating.
- **10.7 (terminal refactor)** will later unify the structure consumers; do NOT pre-optimize module boundaries here beyond the clean split above.
- Version ordering: 10.7 (metadata, S2-first) is separately `ready-for-dev` and independent of the structure layer; whichever merges takes the next PATCH. Read `server/pyproject.toml` at merge, do not assume `0.6.2` if 10.7 merged first.

### Testing standards

- Frontend only: `cd client && npm test` (Vitest) + `npm run typecheck`. jsdom has no layout, so pixel placement of the region flash and the region jump landing are **live-smoke only** (Task 8); the selectors (`synthesizeToc`/`resolveToc`), the region-flash store timer, and the panel wiring are unit-testable.
- `no-raw-values` guard: any flash CSS uses tokens (`var(--...)`), never raw hex/px outside `src/theme/**`.
- **Live smoke mandatory at DPR>1 on a real MULTI-COLUMN paper with YOUR OWN dev servers + a throwaway `PAPER_MATE_DATA`** ([[verify-on-hidpi-and-real-host]]): both the synthesized path (outline-less paper now has a ToC) and the precedence path (outlined paper unchanged, single source). Coordinate correctness of the region landing + flash is the gate.
- No backend change, so the backend suite is unaffected (do not skip running it if the dev also touched server code, but this story should not).

### Project Structure Notes

- Downward dependency holds: `structure/` (selectors) -> `render/` (`TocEntry` type) + `anchor/` (`denormalizeRect`); `reader/RegionFlashLayer` -> `anchor/` + the new `reader/regionFlash` store; `ReaderPage` composes `structure/` + `render/` + the reader primitives. No upward edge, no cycle (`render/` never imports `structure/`).
- New client files: `reader/regionFlash.ts`, `reader/RegionFlashLayer.tsx` (+ their tests). Modified: `structure/index.ts`, `render/index.ts` (widen `TocEntry`), `reader/ReaderPage.tsx`, `reader/PageCard.tsx`, `components/TocPanel/TocPanel.tsx` (+ its test), a stylesheet for the flash.

### References

- Epic + ACs + open design calls: [Source: .bmad/planning-artifacts/epics/epic-10-document-structure-layer-opendataloader-pdf-integration-post-v1-phase-2-enabler.md#Story 10.2] (L33-56).
- Prior story (the layer this consumes): [Source: .bmad/implementation-artifacts/epic-10/10-1-structure-extraction-enabler.md] (contract, `structure/` service, `useDocStructure`, `denormalizeElement`, File List).
- Origin + FR-35: [Source: .bmad/planning-artifacts/sprint-change-proposals/sprint-change-proposal-2026-07-20-opendataloader-structure-layer.md] (L16 embedded-outline gap, L87 FR-35, L121 story-10-2 row).
- **AD-13** (document-structure layer, binds FR-3 ToC + FR-35 section nav): [Source: .bmad/planning-artifacts/architecture/architecture-paper-mate-2026-06-28/ARCHITECTURE-SPINE.md#AD-13] (L122-127); **AD-4** anchor model / normalization basis (L68-77); **AD-9** coordinate math at the anchor boundary.
- NFRs: NFR-1 layout stability, NFR-2 smoothness (~60fps, no jank), NFR-3 anchor fidelity across zoom [Source: .bmad/planning-artifacts/prds/prd-paper-mate-2026-06-28/prd.md L94-96].
- Code touch points (verbatim, current):
  - `client/src/structure/index.ts` `headings` L22-24, `denormalizeElement` L76-82.
  - `client/src/structure/useDocStructure.ts` `{ structure, loading }` L14-53.
  - `client/src/render/index.ts` `TocEntry` L73-77, `getOutline` L108-131.
  - `client/src/reader/ReaderPage.tsx` `toc` state L112-117, `handleBankJump` L300-304, `TocPanel` wiring L470-478.
  - `client/src/components/TocPanel/TocPanel.tsx` `onJump`/rows L19-89; `TocPanel.test.tsx` jump assertion L29-32.
  - `client/src/reader/usePageNav.ts` `jumpToAnnotation` L84-92, `JUMP_MARGIN_FRACTION` L28.
  - `client/src/store/index.ts` `flashAnnotation` + timer L679-700, `FLASH_MS` L679.
  - `client/src/annotations/Annotations.css` `bank-flash` L1232+; `client/src/theme/components.css` `--bank-flash-ring-width` L91.
  - Fixtures for smoke: `client/fixtures/sample-pdfs/no-outline.pdf`, `outlined-sample.pdf`, `1903.03295v2.pdf` (multi-column).

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List

## Change Log

- 2026-07-20: Story created (bmad-create-story, Opus). Resolved the epic's three open design calls: (1) precedence = embedded outline preferred, synthesized-from-headings fallback, single source (never double-render), keeping Story 1.9 unchanged for outlined papers; (2) hierarchy depth from `heading_level`, `clamp(level-1, 0, 5)`; (3) `getOutline` stays as the preferred source, not retired. Pinned the region jump to reuse `jumpToAnnotation(page_index, rect.y0)` (same fraction species, no new coordinate path) and specified generalizing the annotation-only Story 3.6 flash into a reusable non-annotation region flash (`reader/regionFlash` + `RegionFlashLayer`) that Story 10.3 will also consume. Client-only consumer of the Story 10.1 layer: no backend, no new API.
