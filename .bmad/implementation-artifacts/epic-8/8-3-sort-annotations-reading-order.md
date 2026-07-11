---
baseline_commit: ccf84e824ca31de67bf55434f64650d6dc64fccc
---

# Story 8.3: Sort annotations in reading order

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a reader,
I want Bank annotations ordered by page and then by their position on the page,
so that they follow the paper's reading order instead of the order I happened to create them.

## Context (read first)

Story 3.6 built the Annotation Bank ordered by `created_at` ascending. This story changes the Bank's default ordering to **spatial reading order**: page ascending, then top-to-bottom, then left-to-right for same-row ties. That is the entire story.

**This is a one-file change plus tests.** The Bank's ordering lives in exactly one place: `bankItems()` in `client/src/lib/bank.ts:102`, which today sorts by `a.created_at.localeCompare(b.created_at)` (line 105). It is a leaf module (AD-9): imports only `api/` types + the `anchor/` `pointsBounds` helper, no store, no DOM. Its **only** consumer is `BankPanel.tsx:84` (`filterBankItems(bankItems(annotations.values(), docId), activeTypes)`), and `filterBankItems` is order-preserving (Story 8.2), so re-ordering `bankItems` re-orders the rendered list with **no `BankPanel` change**.

**Everything you need for the sort key already exists on the mark.** Each anchor is a discriminated union carrying normalized `[0,1]` page-box coordinates (AD-4, zoom-independent):
- `kind=text` → `anchor.rects: Rect[]` (per-line boxes), `Rect = {x0,y0,x1,y1}`
- `kind=rect` → `anchor.rect: Rect` (region / memo / comment box)
- `kind=path` → `anchor.points: Point[]`, bbox via the existing `pointsBounds(points)` (`anchor/index.ts:190`, returns `{x0,y0,x1,y1}`)

`BankItem` already carries `pageIndex` and `topFraction` (the mark's top-most `y0`, used by the jump target). **What's missing is X.** Add a `leftFraction` to `BankItem` and derive the sort from `(pageIndex, topFraction, leftFraction)`.

**This is view state, full stop (AR-12).** No store mutation, no `annotations.json` change, no Pydantic/OpenAPI/`docs/API.md` change, no server side, no `gen:api` regen. The sort re-orders what the existing list *renders*; the annotation set is untouched. It composes with the Story 8.2 type filter (the filter narrows, the sort orders, neither owns the other).

**Decisions already made for you** (details + rationale in "Design decisions" below):
- **Reading order fully REPLACES `created_at` as the sole Bank order.** No user-facing sort menu/toggle. `created_at` survives only as the final deterministic tie-break.
- **Near-equal Y is banded by an epsilon.** Two marks whose top `y0` differ by less than ~one line-height count as the same "row" and order by X (left-to-right). This is what makes same-line and two-column-same-row marks read correctly; pure `y0` ordering mis-sorts them.
- **Y and X come from the SAME (top-most) rect** for a multi-line text run, so the row's start defines both keys.

## Acceptance Criteria

**AC-1 — Rows sort in reading order: page, then Y, then X** (FR-24, AR-12)
**Given** annotations across several pages
**When** the Bank lists them
**Then** they sort by `page_index` ascending, then by on-page position within a page (top-to-bottom by the mark's anchor top `y0`, then left-to-right by `x0` for same-row ties), so the list reads in paper order. This replaces the `created_at` ordering as the Bank's default.

**AC-2 — A page-boundary (group_id) mark sorts once, at its start** (FR-24, AR-4)
**Given** a mark split across a page boundary into per-page siblings sharing a `group_id` (AR-4)
**When** the Bank lists it
**Then** it appears exactly once, positioned by its first (top-most, **earliest-page**) rect — the mark's start — not by whichever sibling was created first.

**AC-3 — Region and pen marks sort by their bounding-box top-left** (FR-24)
**Given** a region mark (`anchor.kind=rect`) or a pen stroke (`anchor.kind=path`)
**When** the Bank lists it
**Then** its sort position derives from its bounding-box top-left (`rect.{x0,y0}` for a region; `pointsBounds(points).{x0,y0}` for a pen), consistent with how text marks sort.

**AC-4 — Reading order is client-only view state that composes with the filter** (FR-24, AR-12)
**Given** the reading-order sort
**Then** it is view state only: no store/contract/persistence change, and it composes with the Story 8.2 type filter (a filtered subset stays in reading order; the sort never re-widens the filter, the filter never re-orders the sort).

## Tasks / Subtasks

- [x] **Task 1 — Add the paired top-left sort key to `bank.ts`** (AC: 1, 3)
  - [x] Replace `topFractionOf(a)` (`bank.ts:73`) with a single helper that returns the top-most rect's **both** coordinates, e.g. `anchorTopLeft(a: Annotation): { top: number; left: number }`. For `kind=rect` → `{ top: rect.y0, left: rect.x0 }`; `kind=path` → `pointsBounds(points)` `{ top: y0, left: x0 }`; `kind=text` → the rect with the minimum `y0` (the reading start), returning **that same rect's** `x0` (not a separate global-min `x0`, which could come from a different line). Empty `rects` → `{ top: 0, left: 0 }` (preserves today's fallback).
  - [x] Keep `topFraction`'s meaning identical (min-`y0`) so the jump target (`usePageNav.jumpToAnnotation`, which multiplies `topFraction * card.clientHeight`) is byte-unchanged. `anchorTopLeft().top` MUST equal the old `topFractionOf` result.
  - [x] Add `leftFraction: number` to the `BankItem` interface (`bank.ts:14`) with a short doc comment; set both `topFraction` and `leftFraction` in `toBankItem` from one `anchorTopLeft(a)` call.

- [x] **Task 2 — Swap the `bankItems` comparator to reading order** (AC: 1, 2, 4)
  - [x] In `bankItems` (`bank.ts:102`), replace the `created_at.localeCompare` sort with a reading-order comparator: `pageIndex` asc → **epsilon-banded** `topFraction` → `leftFraction` asc → `created_at.localeCompare` as the final stable tie-break. See "Design decisions → Epsilon band" for the comparator shape and the ε value to validate.
  - [x] **Sort BEFORE the group dedup, as today.** The existing loop keeps the first-seen row per `group_id`; because the comparator now sorts by page first, the first-seen sibling is the earliest-page one, which satisfies AC-2 for free. Do not add group-specific logic.
  - [x] The comparator needs each mark's `created_at` for the final tie-break, which `BankItem` does not carry (and should not — it is a display projection). Structure the function so the annotation is still in hand at compare time (e.g. project to `{ annotation, item }` pairs, sort the pairs, then dedup + emit `item`), rather than adding `created_at` to `BankItem`. Recompute `anchorTopLeft` once, not twice.
  - [x] Rewrite the `bankItems` docstring (currently "ordered `created_at` ascending, AR-12"): it now orders by reading order, with `created_at` as a deterministic tie-break only.

- [x] **Task 3 — Reconcile the two now-stale "created_at ordering" notes** (AC: 1)
  - [x] Update the `BankPanel` component docstring (`BankPanel.tsx:31`) that says "ordered `created_at` ascending" → reading order.
  - [x] Update the architecture-spine descriptive line: `.bmad/planning-artifacts/architecture/architecture-paper-mate-2026-06-28/ARCHITECTURE-SPINE.md:136` reads "Annotation Bank order = `created_at` ascending." Change to reading order (page, then on-page position; `created_at` tie-break). This is a one-line doc reconciliation in the same change (AE7-3: reconcile docs alongside the behavior change, not later).

- [x] **Task 4 — Tests** (AC: 1, 2, 3, 4)
  - [x] **Flip the ordering guard:** `bank.test.ts:102` ("orders rows by created_at ascending") is now false. Replace it with reading-order tests: (a) rows on different pages sort by page ascending regardless of `created_at`; (b) rows on one page sort top-to-bottom by `y0`; (c) two marks at near-equal `y0` sort left-to-right by `x0` (exercise the epsilon band); (d) two marks with identical `(page, y0, x0)` fall back to `created_at` order (deterministic tie-break). The existing `textMark`/`regionMark`/`penMark`/`memoMark`/`commentMark` builders already accept `rects`/`anchor` overrides with distinct `x0`/`y0`, so seed positions directly.
  - [x] **AC-2 dedup test with earliest-page ≠ earliest-created:** seed a `group_id` pair where the page-0 sibling was created **after** the page-1 sibling, and assert the surviving row is the page-0 (earliest-page) one. (Today's dedup test at `bank.test.ts:113` happens to make earliest-page and earliest-created the same mark, so it does not prove reading-order dedup; add the distinguishing case.)
  - [x] **AC-3:** assert a region (`kind=rect`) and a pen (`kind=path`) sort by their bbox top-left relative to text marks.
  - [x] **AC-4 compose-with-filter:** a filtered subset (via `filterBankItems`) is still in reading order (the `filterBankItems` "preserves input order" test at `bank.test.ts:265` already covers order-preservation; add one asserting the composed `filterBankItems(bankItems(...))` output is reading-ordered).
  - [x] **Audit any order-dependent assertion that assumed `created_at` order.** The multi-type `filterBankItems` test at `bank.test.ts:242` seeds pen/underline/highlight/memo/comment with ascending `created_at` and all on page 0 with distinct `y0`; under reading order the row order changes. If it asserts a specific order, update it; if it only asserts membership, leave it. Grep the suite for any Bank order assumption. `BankPanel.test.tsx` / `ReaderPage.test.tsx` seed at most one or two marks, so their order assertions are unlikely to break, but re-run them.
  - [x] Run `cd client && npm test` and `npm run typecheck` — both green.

- [x] **Task 5 — Live smoke** (AC: 1, 2, 3)
  - [x] With your OWN fresh dev servers (never a user-launched / Docker one — CLAUDE.md; Story 8.2 hit exactly this trap when a `--reload` container grabbed port 8000), on a **multi-page** paper: create marks out of reading order (e.g. a comment low on page 3, a highlight high on page 1, an underline mid page 2, a region + pen on page 1) and confirm the Bank lists them page 1 → 3, top-to-bottom within each page. Widen the 8.2 filter to all types so every mark is visible.
  - [x] Validate the epsilon band on a **real paper**: put two marks on the same visual text line (e.g. a highlight on the left half, an underline on the right half) and confirm they read left-to-right, not swapped by a hair of `y0` difference. This is the ε acceptance check (see Design decisions); tune ε here if needed, do not ship an unvalidated constant.
  - [x] Confirm a Bank row click still jumps + flashes + selects (`handleBankJump` unchanged) and that filtering + sorting never reflows the canvas (NFR-1).

### Review Findings

Reviewed by Codex (`bmad-code-review`, `ccf84e8..HEAD`). All 3 patch findings resolved below; 11 other concerns dismissed as intended behavior, unsupported speculation, or excluded by the render lifecycle.

- [x] [Review][Patch] [High] Make the epsilon-banded reading-order comparator transitive and input-order independent [client/src/lib/bank.ts:118]
- [x] [Review][Patch] [Medium] Add regression coverage that verifies scroll repositions the quick-box and a second same-kind cross-page selection uses the new anchor [client/src/annotations/AnnotationInteraction.test.tsx:1048]
- [x] [Review][Patch] [Medium] Exercise left-edge ordering for both region and pen bounding boxes in the AC-3 test [client/src/lib/bank.test.ts:156]

## Design decisions (made at create-story; record any change in Completion Notes)

**D1 — Replace `created_at`, no toggle.** Reading order becomes the Bank's sole default order; there is no user-facing "sort by created vs reading order" control. Rationale: the user asked for annotations that "follow the paper's reading order" (one order, not a choice); the AC describes one ordering; the smallest correct structure wins (CLAUDE.md); Story 8.4's AC already assumes reading order is THE order ("sorts by the region's top-left in 8.3's reading order"). `created_at` is retained only as the final tie-break so ordering stays deterministic. If the user later wants a toggle, it layers on top without undoing this.

**D2 — Epsilon-banded Y, then X.** Compare `topFraction` within a tolerance band ε: if `|a.top − b.top| ≤ ε`, treat the two as the same row and order by `leftFraction`; otherwise order by `top`. Why: the real tie case is not exact-Y, it is *same-line* marks whose rect tops differ by a few pixels (an underline sits slightly below a highlight on the same line; a text run vs a region box on the same row; two columns at the same height). Pure `y0` ordering can then put a right-side mark before a left-side one. A one-line-height band fixes this. Comparator shape:

```ts
const READING_ORDER_Y_EPSILON = 0.01; // page-fraction; ~ under one line-height, tune in smoke

function readingOrder(a, b): number {         // a, b carry {pageIndex, top, left, createdAt}
  if (a.pageIndex !== b.pageIndex) return a.pageIndex - b.pageIndex;
  if (Math.abs(a.top - b.top) > READING_ORDER_Y_EPSILON) return a.top - b.top;
  if (a.left !== b.left) return a.left - b.left;
  return a.createdAt.localeCompare(b.createdAt);
}
```

ε ≈ `0.01` of page height is the starting value: a typical paper line-height is ~0.015 of the page box, so 0.01 catches same-line marks without merging adjacent lines (~0.015 apart). **Validate it in Task 5 against a real paper** (Story 8.1's rule: a geometry heuristic is confirmed by looking at a real paper, not only a unit test), and adjust if same-line marks still swap (too small) or adjacent lines merge (too large). If ε proves fiddly, the documented fallback is ε = 0 (pure `top` then `left` then `createdAt`), still AC-conformant — but ε > 0 is the faithful reading-order choice; prefer it.

**D3 — Paired top-left from one rect.** For a multi-line text run, Y and X must come from the *same* rect (the top-most line), so the sort key is the reading start, not a Frankenstein of min-`y0` and min-`x0` from different lines. Hence a single `anchorTopLeft` helper returning `{top, left}` together, replacing the split-out `topFractionOf`.

**D4 — Known, accepted limitation: no column model.** A plain page→Y→X sort interleaves a two-column layout when a left-column line and a right-column line share a Y band (they sort adjacent, L then R, instead of finishing the left column first). This is inherent to the AC's explicit "top-to-bottom by Y, then left-to-right by X" model and is **out of scope** (column-aware ordering was Story 4.2's concern for selection, not Bank order). Do not build a column detector; the epsilon band already gives correct same-line ordering, which is the case users notice.

## Dev Notes

### What to touch (and what NOT to)

- **Touch:** `client/src/lib/bank.ts` (add `leftFraction`, `anchorTopLeft`, reading-order comparator), `client/src/lib/bank.test.ts` (flip the created_at guard, add reading-order + dedup tests), `client/src/components/BankPanel/BankPanel.tsx` (docstring line only), `.bmad/planning-artifacts/architecture/.../ARCHITECTURE-SPINE.md` (one descriptive line).
- **Do NOT touch:** the store (`store/index.ts`), the annotation model / API contract (`server/app/models.py`, `client/src/api/schema.d.ts`), `docs/API.md`, autosave, the on-page render/overlay, or `BankPanel`'s render/filter logic. There is no server side and no `gen:api` regen. `BankPanel.tsx:84` (`filterBankItems(bankItems(...))`) needs no code change: order flows through the order-preserving filter.

### Architecture & layering (AD-9)

`bank.ts` stays a leaf: `api/` types + `anchor/pointsBounds` only, no store, no DOM. All new logic (the helper + comparator) is pure data-in/data-out and unit-testable with plain fixtures — no component or store test needed for the ordering itself. Do not import the store into `bank.ts` or move ordering into `BankPanel`.

### Why the group dedup keeps working unchanged (AR-4)

AR-4: a page-spanning selection is split into one annotation per page sharing a `group_id`; each sibling carries its own `page_index`. `bankItems` sorts the full annotation list first, then walks it keeping the first row seen per `group_id`. Because the new comparator orders by `page_index` ascending before anything else, the first sibling seen for a group is the earliest-page one — the mark's start — so AC-2 falls out of the existing structure. The only trap is ordering the dedup relative to the sort: **sort first, dedup second** (as today). If you dedup before sorting you lose the earliest-page guarantee.

### The `topFraction` contract must not drift

`BankItem.topFraction` is consumed by the jump target: `handleBankJump` (`ReaderPage.tsx:290`) → `Reader.jumpToAnnotation(pageIndex, topFraction)` → `usePageNav` scrolls to `topFraction * card.clientHeight`. It has always been the min-`y0` of the mark's rects. Keep that exact value (`anchorTopLeft().top`), so jumping is unchanged. You are *adding* `leftFraction` for the sort, not changing `topFraction`.

### FR-24 numbering note (avoid confusion reading epics.md)

Epic 8's **FR-24 = "sort the Bank in reading order"** (added 2026-07-11 correct-course, `sprint-change-proposal-2026-07-11-epic-8-9-stories.md`). This is a *reader* FR distinct from the Phase-1 **FR-24 = Settings hotkey rebinding** (`epics.md:72`, shipped in Epic 5, unrelated and done). The correct-course reused FR-23/24/25 for the new reader capabilities (Bank filter / Bank sort / region comment); the collision is a known doc artifact, not a mistake to resolve here. Cite FR-24 = Bank reading-order sort.

### Testing standards

Vitest + Testing Library (`cd client && npm test`; `npm run typecheck`). The ordering is pure, so cover it in `bank.test.ts` with the existing fixture builders (they accept `rects`/`anchor`/`created_at` overrides to place marks at specific `(page, y0, x0)`). Assert on `rows.map((r) => r.id)` sequences. Follow Story 8.1's discipline for the epsilon: the unit tests pin the comparator's logic, but the ε *value* is confirmed by the real-paper smoke in Task 5, not asserted numerically as if it were exact.

### Project Structure Notes

- Ordering derivation → `client/src/lib/bank.ts` (leaf), matching the colocated component + `lib/` pure-module layout (Stories 5.3/5.4, and Story 8.2's `filterBankItems`).
- No `render/` export added, so the `App.test.tsx` / `Reader.test.tsx` `vi.mock("./render")` barrel-sync rule does not apply.
- Versioning: at PR merge, PATCH +1 → `server/pyproject.toml` `0.5.14` → `0.5.15` (per-story bump; the sole version source).

### References

- [Source: .bmad/planning-artifacts/epics.md#Story 8.3 (line 1971)] — canonical AC set, out-of-scope, open design calls.
- [Source: .bmad/planning-artifacts/sprint-change-proposals/sprint-change-proposal-2026-07-11-epic-8-9-stories.md §4c (line 111)] — provenance; FR-24 = Bank reading-order sort; "ordering is view state, no contract/store change" (line 44).
- [Source: .bmad/implementation-artifacts/epic-8/8-2-annotation-bank-filter-by-type.md] — the predecessor: `filterBankItems` is order-preserving and composes with this sort; the Docker-port live-smoke trap.
- [Source: client/src/lib/bank.ts] — `bankItems` (102, the `created_at` sort at 105 to replace), `topFractionOf` (73, to fold into `anchorTopLeft`), `BankItem` (14, add `leftFraction`), `toBankItem` (80), `filterBankItems` (125).
- [Source: client/src/components/BankPanel/BankPanel.tsx:84] — the sole consumer (`filterBankItems(bankItems(...))`); docstring "created_at ascending" at line 31 to update.
- [Source: client/src/anchor/index.ts:190] — `pointsBounds(points) → {x0,y0,x1,y1}` for pen bbox.
- [Source: client/src/reader/ReaderPage.tsx:290] — `handleBankJump` uses `item.pageIndex` + `item.topFraction` (jump path, unaffected).
- [Source: client/src/reader/usePageNav.ts:78] — `jumpToAnnotation(pageIndex, topFraction)` (why `topFraction` must stay min-`y0`).
- [Source: server/app/models.py:300] — `Rect{x0,y0,x1,y1}` / `Point{x,y}` / `TextAnchor.rects` / `RectAnchor.rect` / `PathAnchor.points`; `Annotation` (372), five-value `type` (380), `group_id` (381).
- [Source: architecture spine, ARCHITECTURE-SPINE.md:76 (AR-4 page-split), :136 (Bank order note to update)] — the group-split rule and the stale ordering note.
- FR-24 (Bank reading-order sort), AR-4 (page-boundary split → per-page siblings sharing `group_id`), AR-12 (Bank ordering / client-only view state), FR-19 (Bank lists each mark), NFR-1 (no canvas reflow).

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (xHigh)

### Debug Log References

- **Data-root env var mistake, caught and cleaned up before it mattered.** For the Task 5 live smoke, `PAPER_MATE_DATA_DIR` was used to point the backend at an isolated data dir — the actual variable `paths.py` reads is `PAPER_MATE_DATA`, so the wrong name silently no-op'd and the backend defaulted to the user's real `~/.paper-mate` store. One fixture PDF (`1903.03295v2.pdf`) landed in the user's real library via `POST /api/docs` before this was noticed. Caught by inspecting `~/.paper-mate/library.json` (real papers dated back to 2026-06-28, clearly not test data) before creating any annotations there. Cleaned up via `POST /api/library/trash` (reversible, not a hard delete) rather than touching the file store directly, then relaunched both servers with the correct `PAPER_MATE_DATA` pointed at an isolated scratch dir for the rest of the smoke.
- **Mid-smoke, the user reported a live bug in their own separate session** (Bank row click on a highlight: quick-box flashes and closes almost instantly, jump reads as barely moving) on a Docker-served build unrelated to this story's in-progress edits. Traced to `useSelection.ts`'s document-level `scroll` listener, which closed the selected-mark quick-box on ANY scroll — including the Bank jump's own `jumpToAnnotation` smooth-scroll, so `select()` opening the box and the jump's first scroll tick closing it raced within a frame. `useCreateQuickBox.ts` had already fixed the identical problem for the CREATE popup (its own comment cites "Story 4.x fix": track scroll/zoom instead of closing), but the fix was never backported to the selected-mark box. Applied the same reposition-on-scroll pattern here (see File List) — out of this story's scope (FR-24/AR-12 reading order only), done as a direct ad hoc fix per explicit user request mid-session, kept as a separate change from Story 8.3's own diff.
- **The reposition fix above surfaced a second bug, also reported live by the user**: jumping to a highlight on another page (after some other mark was already selected) landed the quick-box at the viewport's top-left corner instead of near the mark. Root cause: `repositionBox` (a `useCallback`) called `selectionPoint`, a plain function redefined every render — but since `repositionBox`'s only dep was `isMemoSelected`, which stays `false` across any run of non-memo selections, React kept returning the STALE memoized `repositionBox` from whichever earlier render `isMemoSelected` last actually changed, frozen on that render's stale `effectiveAnchor` (from an older mark, or `null` pre-selection). Fixed by promoting `selectionPoint` itself to a properly-dependency-tracked `useCallback` (`[selectedAnno, effectiveAnchor, getPagesRef, scaleRef]`) and adding it to `repositionBox`'s deps, so both always reflect the currently selected mark. Reproduced and verified fixed via a real two-step repro (select a page-1 mark, then Bank-jump to a page-6 mark) — the box's `getBoundingClientRect()` moved from a page-1-anchored point to a real, in-viewport point near the page-6 mark, not `{0,0}`.

### Completion Notes List

- **Task 1:** Added `anchorTopLeft(a)` to `bank.ts`, replacing `topFractionOf`; returns `{top, left}` from the SAME rect (min-`y0` for `kind=text`, the rect's own `{x0,y0}` for `kind=rect`, `pointsBounds` for `kind=path`). `leftFraction` added to `BankItem`; `topFraction`'s value is unchanged (verified: the existing "min y0 across all rects" unit test still passes byte-for-byte).
- **Task 2:** `bankItems` now sorts `{annotation, item}` pairs (so `created_at` stays available for the tie-break without adding it to `BankItem`) through a `readingOrderCompare`: `pageIndex` asc → epsilon-banded `topFraction` (ε=0.01 page-fraction) → `leftFraction` asc → `created_at` tie-break. Dedup still runs AFTER the sort, unchanged, so AC-2 (earliest-page sibling wins) falls out for free.
- **Task 3:** `BankPanel.tsx:31` and `ARCHITECTURE-SPINE.md:136` both updated from "`created_at` ascending" to reading order.
- **Task 4:** Flipped the stale `created_at`-order guard and added reading-order tests for AC-1 (cross-page, top-to-bottom, epsilon left-to-right, tie-break), AC-2 (earliest-page ≠ earliest-created dedup), AC-3 (region/pen bbox sort), and AC-4 (filter composes with the sort). Two pre-existing tests asserted a SPECIFIC row order that reading order now changes: `bank.test.ts`'s "lists all five types" test (its own name says it's a membership check) switched to a `Set` comparison; `bank.test.ts`'s `filterBankItems` "multi-type set" test updated its expected order to match (`memo` before `pen`, since memo's `topFraction=0.2` sorts before pen's `0.5`). 1399/1399 client tests pass (68 files); `npm run typecheck` clean.
- **Task 5:** Live-smoked on own fresh servers (backend 8010, frontend 5183 — see Debug Log for the data-root mistake and recovery) against a 10-page fixture PDF (`1903.03295v2.pdf`). Created a highlight + comment + pen stroke on page 1, an underline mid-page-2, and a comment low on page 3, all out of creation order; widened the Bank filter to all five types and confirmed the list reads page 1 → 2 → 3, top-to-bottom within each page. Epsilon check: a highlight on the left half and an underline on the right half of the SAME visual line in the abstract sorted left-to-right (not swapped by the sub-pixel `y0` difference between a highlight's fill-rect top and an underline's baseline-rect top) — ε=0.01 holds, no retune needed. Confirmed a Bank row click still jumps + flashes + selects, and (after the ad hoc fix above) the selected-mark quick-box now survives the jump's own scroll and lands correctly positioned on the target mark. No console errors; no canvas reflow observed.
- **Review Findings, all resolved:**
  - **High (bank.ts):** The pairwise epsilon comparator (`|a.top - b.top| <= ε` → tie) was NOT transitive — three marks with consecutive gaps each ≤ ε but a first/last gap > ε form a genuine cycle (A ties B, B ties C, A strictly precedes C), so `Array.sort` could return a different result depending on input order, violating AC-1's determinism. Reproduced independently (same 3 marks, 4 input permutations → 3 different sort outputs) before fixing. Fixed by moving the epsilon tolerance out of the comparator entirely: a strict, transitive pre-sort by `(pageIndex, top)`, then a one-directional chaining pass that assigns each mark a `rowRank` (a new mark joins the current row when within ε of the row's most recently added member), then a final strict sort by `(pageIndex, rowRank, leftFraction, created_at)`. Added a determinism regression test (4 permutations of a 3-mark epsilon chain, asserts identical output).
  - **Medium (bank.test.ts AC-3):** The region/pen bbox test only exercised Y-ordering across rows, never their `left` value within a shared row. Added a same-row region-vs-pen test asserting left-to-right order by bbox `x0`.
  - **Medium (AnnotationInteraction.test.tsx):** The scroll test only asserted the box stayed mounted, not that its position actually changed; nothing exercised the specific stale-closure sequence (select mark A, then Bank-jump to mark B on another page). Strengthened the scroll test to assert `style.top` actually changes after the card's mocked rect moves, and added a dedicated two-mark cross-page selection test. Verified both tests actually catch their bug: temporarily reverted `useSelection.ts`'s fix, confirmed the new tests fail (one hangs waiting for a position change that never comes), then restored the fix and confirmed all 140 tests in the file pass again.
  - 1402/1402 client tests pass (68 files, +3 new); `npm run typecheck` clean.

### File List

- `client/src/lib/bank.ts` (modified: `topFractionOf` → `anchorTopLeft`; added `leftFraction` to `BankItem`; `bankItems` comparator swapped from `created_at` to reading order, then from a non-transitive pairwise-epsilon comparator to a transitive pre-sort + row-clustering pass per Review Findings)
- `client/src/lib/bank.test.ts` (modified: flipped the `created_at`-order guard; added AC-1..AC-4 reading-order tests; updated two order-dependent assertions that reading order legitimately changes; added a determinism regression test and a same-row region/pen left-edge test per Review Findings)
- `client/src/components/BankPanel/BankPanel.tsx` (modified: docstring line only, "ordered `created_at` ascending" → reading order)
- `.bmad/planning-artifacts/architecture/architecture-paper-mate-2026-06-28/ARCHITECTURE-SPINE.md` (modified: one descriptive line, Bank order note)
- `.bmad/implementation-artifacts/sprint-status.yaml` (modified: `8-3-sort-annotations-reading-order` → in-progress, then review)

**Out of this story's scope — ad hoc bug fix, per explicit user request mid-session (see Debug Log); kept as a separate commit from the above:**

- `client/src/annotations/gestures/useSelection.ts` (modified, two bug fixes: (1) the selected-mark quick-box repositions on scroll instead of closing, matching `useCreateQuickBox`'s existing pattern, fixing the box self-closing on a Bank jump's own scroll; (2) `selectionPoint` promoted to a correctly-dependency-tracked `useCallback` so `repositionBox` never reads a stale mark's position, fixing the box landing at the viewport's top-left corner on a cross-page Bank jump)
- `client/src/annotations/AnnotationInteraction.test.tsx` (modified: updated the one test that asserted the old close-on-scroll behavior to assert the box now stays open and repositions; per Review Findings, strengthened it to assert an actual position change and added a cross-page stale-closure regression test)

## Change Log

| Date | Change |
|------|--------|
| 2026-07-12 | Implemented Story 8.3: Bank ordering switched from `created_at` ascending to reading order (page, then epsilon-banded top-to-bottom, then left-to-right, `created_at` as final tie-break). 1399/1399 client tests pass; typecheck clean; live-smoked on own dev servers (8010/5183) with out-of-order marks across 3 pages plus a same-line epsilon check. Status → review. |
| 2026-07-12 | Ad hoc (out of story scope, user-requested mid-session): fixed two related selected-mark quick-box bugs in `useSelection.ts` — closes-on-scroll self-closing a Bank jump's own box, and a stale-closure bug landing the box at the top-left corner on a cross-page jump. Both reproduced live and verified fixed. Kept as a separate commit from the Story 8.3 diff. |
| 2026-07-12 | Codex `bmad-code-review` (`ccf84e8..HEAD`): 3 patch findings, all resolved. High: fixed a non-transitive epsilon comparator in `bank.ts` (reproduced input-order-dependent sorts, fixed with a pre-sort + row-clustering pass). Medium ×2: strengthened test coverage in `bank.test.ts` (same-row left-edge ordering) and `AnnotationInteraction.test.tsx` (actual position-change assertions, cross-page stale-closure regression). 1402/1402 client tests pass; typecheck clean. |
| 2026-07-12 | PR #65 merged to `main`. `server/pyproject.toml` version bumped 0.5.14 → 0.5.15 (PATCH +1 per completed story). Status → done. |
