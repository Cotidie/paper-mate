---
baseline_commit: ecfacfc74f2567889bbf4470d0b45368a8e8021a
---

# Story 8.2: Annotation Bank filter by type (default comments)

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a reader,
I want the Annotation Bank to list every annotation type and let me filter by type, starting with comments only,
so that I can focus on the annotations that matter to me without wading through every mark.

## Context (read first)

This story does two things to the existing Annotation Bank (Story 3.6):

1. **Widen what the Bank can list.** Today the Bank silently drops two of the five annotation types. `client/src/lib/bank.ts:40` has `BANK_TYPES = new Set(["highlight", "memo", "comment"])` and `bankItems` filters every row through it, so **pen strokes and underlines never appear** no matter how many exist. AC-1 retires that restriction: the Bank must be able to list ALL five types.
2. **Add a client-only type filter, defaulting to comments only.** A control in the panel selects which types are shown; on every open the default is comments only, and the reader can widen it to any subset or all types.

**This is view state, full stop.** No store mutation, no `annotations.json` change, no Pydantic/OpenAPI/contract change, no `docs/API.md` change. The filter narrows what the existing list *renders*; it never reorders, mutates, or persists the annotation set (AR-12). It must compose cleanly with Story 8.3 (reading-order sort), which lands next and re-sorts the same list.

**The five types are the whole universe.** `Annotation["type"]` is exactly `"highlight" | "underline" | "pen" | "memo" | "comment"` (`server/app/models.py:380`). There is **no `region` type.** A "region" is a `type=highlight` (or, after Story 8.4, `type=comment`) whose `anchor.kind === "rect"` — the Bank already renders it with a `"Region"` placeholder snippet. The AC-1 parenthetical "(highlight, underline, pen, memo, comment, region)" lists region as an illustrative anchor-shape case, **not a sixth filter facet.** Filter over the five model `type`s. Do NOT invent a `region` type or a sixth chip (see Open Design Call 4).

**Good news on rendering:** `BankPanel` already maps all five types. `TYPE_ICON` (`BankPanel.tsx:9`) and `TYPE_LABEL` (`bank.ts:30`) both have entries for all five (underline → `TextUnderline`, pen → `PencilSimple`). `toBankItem`/`snippetOf`/`topFractionOf` already handle every anchor kind (`kind=text` underline → `anchor.text`; `kind=path` pen → `"Pen stroke"` placeholder + `pointsBounds`). So once `bankItems` stops excluding pen/underline, those rows render correctly with zero new render code. The work is the filter, not the row.

## Acceptance Criteria

**AC-1 — The Bank can list every type** (FR-19, FR-23, UX-DR9)
**Given** a document with marks of several types (highlight, underline, pen, memo, comment, and rect-anchored "region" highlights)
**When** the Bank is open with those types included in the filter
**Then** it lists ALL of them, each as a `bank-row` (`{component.bank-list-item}`) with its type glyph + color dot + snippet + page — not only highlight/memo/comment as today.

**AC-2 — A type filter, default comments only** (FR-23, UX-DR9)
**Given** the Bank
**Then** a filter control selects which of the five types are shown; the DEFAULT every time the Bank opens is **comments only**, and the reader can widen the selection to any subset or to all types.

**AC-3 — Filtering updates the list in place, empty filter shows an empty state** (FR-23, NFR-1, UX-DR18)
**Given** a filter whose active types match no marks in the document
**When** the filter is applied
**Then** the visible list updates without reflowing the canvas (NFR-1), and an empty result shows an empty-state message that adapts to the active filter (e.g. "No comments yet." when only comments are selected).

**AC-4 — Filter is client-only view state that composes with sort** (FR-23, AR-12)
**Given** the filter selection
**Then** it is view state only: it does not mutate, reorder, or persist the annotation set, and it composes with the Story 8.3 reading-order sort (the filter narrows; the sort orders; neither owns the other).

**AC-5 — No em-dash in any new copy** (UX-DR13)
**Given** any new control label, tooltip, aria-label, or empty-state string
**Then** none contains an em-dash (—). Use a comma, colon, parentheses, or period.

## Tasks / Subtasks

- [x] **Task 1 — Widen `bankItems` to all five types** (AC: 1)
  - [x] In `client/src/lib/bank.ts`, remove the `BANK_TYPES` restriction so `bankItems` returns rows for all five `Annotation["type"]` values (keep the `doc_id` filter, the `group_id` dedup, and the `created_at` ordering exactly as-is). Delete `BANK_TYPES` and its comment; do not leave it dead.
  - [x] Confirm `toBankItem`/`snippetOf`/`topFractionOf` need no change (they already branch on anchor kind for all types). Underline rows use `anchor.text`; pen rows fall back to the `"Pen stroke"` label + `pointsBounds`.
- [x] **Task 2 — Add the pure type-filter derivation** (AC: 2, 4)
  - [x] Add a small pure helper to `bank.ts` (leaf module, AD-9 — no store/DOM) that narrows a `BankItem[]` to an active set of types, e.g. `filterBankItems(items: BankItem[], activeTypes: ReadonlySet<Annotation["type"]>): BankItem[]`. Keep `bankItems` (all rows) and the filter as separate single-responsibility functions so Story 8.3's re-sort drops in without entangling the filter.
  - [x] Export a canonical ordered list/const of the five types (for building the control) and the comments-only default, so `BankPanel` and tests share one source of truth (no re-listing the enum inline).
- [x] **Task 3 — Filter control + default in `BankPanel`** (AC: 2, 3, 5)
  - [x] Own the active-types set as client view state in `BankPanel` via `useState`, initialized to comments-only. `BankPanel` returns `null` when `!open` (it unmounts on close), so this state naturally resets to the comments-only default on each open, satisfying AC-2. (See Open Design Call 2 if the default should instead be remembered per session.)
  - [x] Render the filter control in the panel header region (see Open Design Call 1 for shape). Each type toggle is a real `<button>` with `aria-pressed`, a visible glyph + label (reuse `TYPE_ICON`/`TYPE_LABEL`), keyboard-operable.
  - [x] Compose in render: `filterBankItems(bankItems(annotations.values(), docId), activeTypes)`.
- [x] **Task 4 — Filter-adaptive empty state** (AC: 3, 5)
  - [x] Replace the single `"No annotations yet."` with a message that adapts to the active filter (comments-only → "No comments yet."; a broader/empty selection → a general "No annotations match this filter." — settle exact copy per Open Design Call 3). No em-dash.
  - [x] Keep the empty state inside the panel; the canvas never reflows (NFR-1).
- [x] **Task 5 — Styling via tokens** (AC: 1, 2)
  - [x] Style the filter control in `BankPanel.css`, tokens only (raw hex/px live in `theme/**` only — `src/no-raw-values.test.ts` enforces this). Reuse existing tokens where they fit (e.g. the `tag-chip` family, `--space-*`, `--color-*`); add new `--bank-filter-*` tokens to `client/src/theme/components.css` only if a genuinely new dimension is needed.
- [x] **Task 6 — Tests** (AC: 1, 2, 3, 4)
  - [x] **Flip the regression guard:** `client/src/lib/bank.test.ts:140` currently asserts "excludes pen strokes and underlines; only highlight/memo/comment appear". After Task 1 that is wrong — rewrite it to assert all five types now produce rows (order preserved by `created_at`).
  - [x] Unit-test `filterBankItems`: comments-only narrows to comment rows; a multi-type set includes exactly those; the empty set yields `[]`; filtering preserves the input order (so it composes with sort).
  - [x] Add `BankPanel` component tests (the component has NONE today — CodeGraph flags "no covering tests"): default open shows comments only; toggling a type chip reveals/hides that type's rows; a filter matching nothing shows the adaptive empty state; the filter never calls any store mutator.
  - [x] Run `cd client && npm test` and `npm run typecheck` — both green.
- [x] **Task 7 — Live smoke** (AC: 1, 2, 3)
  - [x] With your OWN fresh dev servers (never a user-launched/Docker one — CLAUDE.md), on a paper carrying at least one of each type: open the Bank → confirm comments-only default; toggle chips → confirm pen/underline/highlight/memo rows appear and jump+select correctly (a Bank row click still runs `handleBankJump` = jump + flash + select); confirm the adaptive empty state; confirm the canvas never reflows while filtering. This is a light single-view smoke; no cross-page selection is involved (that is 8.4/8.8's concern, not this story).

### Review Findings

Reviewed by Codex (`codex exec` running the `bmad-code-review` workflow standalone, per CLAUDE.md's auto-review convention: story file + working-tree diff since HEAD only carried the story-creation commit + sprint-status path, non-interactive). 0 decision-needed, 2 patch, 0 defer, 12 dismissed as noise. Codex independently ran `npm test`/`typecheck` and confirmed 68/68 files, 1393/1393 tests green before reviewing. Both patch findings verified against source and fixed in this session.

- [x] [Review][Patch] Reset the filter before repaint on Bank reopen to prevent stale rows from flashing [client/src/components/BankPanel/BankPanel.tsx:65]
- [x] [Review][Patch] Use the canonical Bank filter type constants in tests instead of re-listing the type universe inline [client/src/components/BankPanel/BankPanel.test.tsx:276]

**Fix 1 — stale-filter flash on reopen.** The reset-effect (Completion Notes above) used a passive `useEffect`, which fires AFTER the browser paints. Since the component instance persists across close/reopen, the very first open-transition frame would still render with whatever filter was active when the panel was last closed, a visible one-frame flash of stale rows, before the effect fired and reset it back to comments-only. Switched to `useLayoutEffect`, which fires synchronously after DOM mutations but before paint, so the reset is applied before the browser ever shows a frame.
- **Fix 2 — tests re-listing the five-type universe inline.** Three sites (`bank.test.ts:266`, `BankPanel.test.tsx:212`, `BankPanel.test.tsx:276`) hard-coded `["highlight", "underline", "pen", "memo", "comment"]` or a 4-of-5 subset instead of importing `BANK_FILTER_TYPES`, contrary to Task 2's explicit single-source-of-truth requirement. All three now derive from `BANK_FILTER_TYPES` (the AC-1 test uses `.filter((t) => t !== "comment")` for its 4-of-5 case, since comment is already active by default).

Both fixes verified: full suite 1393/1393 pass (68 files), `npm run typecheck` clean, re-ran `bank.test.ts` + `BankPanel.test.tsx` in isolation (43/43) after the change.

## Dev Notes

### What to touch (and what NOT to)

- **Touch:** `client/src/lib/bank.ts` (widen + add filter helper), `client/src/lib/bank.test.ts` (flip guard + new filter tests), `client/src/components/BankPanel/BankPanel.tsx` (filter state + control + adaptive empty state), `client/src/components/BankPanel/BankPanel.css` (control styling), possibly `client/src/theme/components.css` (only if a new token is truly needed), a new `BankPanel.test.tsx`.
- **Do NOT touch:** the store (`store/index.ts`), the annotation model / API contract (`server/app/models.py`, `client/src/api/schema.d.ts`), `docs/API.md`, autosave, or the on-page render/overlay. There is no server side to this story and no `gen:api` regen.

### Architecture & layering (AD-9)

`bank.ts` is a leaf: it imports only `api/` types + the `anchor/` `pointsBounds` helper — no store, no DOM. Keep it that way. The filter is pure data-in/data-out; the *selection of which types are active* is UI state that lives in `BankPanel`, not in `bank.ts`. This mirrors the existing "pure derivation (`bank.ts`) vs component wiring (`BankPanel.tsx`)" split and lets the filter be unit-tested with plain data.

### The type universe (do not invent a sixth type)

`Annotation["type"] = "highlight" | "underline" | "pen" | "memo" | "comment"` — five values, verbatim from `server/app/models.py:380`. "Region" is not a type; it is `anchor.kind === "rect"`. Filter over the five. See Open Design Call 4 before doing anything region-specific.

### Group dedup interaction (no special handling needed)

`bankItems` collapses a two-page `group_id` group to its earliest sibling *before* any filtering. Widening to underline just means an underline that split across a page boundary also dedups to one row — the existing `seenGroups` logic already covers any type. Apply the type filter to the deduped representative row's `type`. Nothing new here.

### Bank row click behavior is unchanged

`ReaderPage.handleBankJump` (`ReaderPage.tsx:290`) does jump + `flashAnnotation` + `select`. Newly-surfaced pen/underline rows are ordinary selectable annotations, so this Just Works — verify in smoke that clicking a pen or underline row selects it on the page.

### Testing standards

Vitest + Testing Library (`npm test`). Follow the existing `bank.test.ts` fixture style (`textMark`/`penMark`/`memoMark`/`commentMark`/`regionMark` builders are already there and reusable). Component tests render `BankPanel` with a seeded store; assert on `data-testid` hooks (`bank-panel`, `bank-empty`, `bank-row-<id>`) and add stable test ids for the new filter chips. Typecheck with `npm run typecheck`.

### Open Design Calls (decide during dev; record the choice in Completion Notes)

1. **Filter control shape.** Recommended: a compact horizontal row of five toggle chips (one per type, glyph + short label, `aria-pressed`), placed under the panel title — five options is too few to justify a dropdown, and inline chips are keyboard-trivial and match the app's chip idiom (Story 7.11 `tag-chip`). Alternative: a multi-select menu if the header gets cramped.
2. **Remember the default per session?** Recommended: no — reset to comments-only on each open (AC-2 reads literally as "the DEFAULT every time the Bank opens is comments only"), which the current unmount-on-close `useState` gives for free. If the user later wants the last selection remembered, lift the state up to `ReaderPage` (beside `bankOpen`); do not add persistence.
3. **Empty-state copy per filter.** Recommended: comments-only → "No comments yet."; any other/empty selection → "No annotations match this filter." Keep it short, no em-dash. Confirm exact wording.
4. **"Region" as a facet.** Recommended: NOT a separate chip. Region highlights filter under Highlight; region comments (Story 8.4) under Comment. Only revisit if the user explicitly asks for a region facet — it would be a derived `anchor.kind === "rect"` predicate layered on top, never a new `type`.

### Project Structure Notes

- Filter derivation → `client/src/lib/bank.ts` (leaf). Filter UI/state → `client/src/components/BankPanel/BankPanel.tsx`. Styling → `BankPanel.css` (+ `theme/components.css` only for a new token). This matches the colocated component + `lib/` pure-module layout adopted in Stories 5.3/5.4; no new directories.
- No `render/` mock-barrel change (this story adds no `render/` export), so the `App.test.tsx` / `Reader.test.tsx` `vi.mock("./render")` sync rule does not apply here.

### References

- [Source: .bmad/planning-artifacts/epics.md#Story 8.2] — the canonical AC set + out-of-scope + open calls.
- [Source: .bmad/planning-artifacts/sprint-change-proposals/sprint-change-proposal-2026-07-11-epic-8-9-stories.md §4b] — provenance, FR-23, "view state, no contract change" framing.
- [Source: client/src/lib/bank.ts] — `BANK_TYPES` (line 40, to remove), `bankItems` (97), `TYPE_LABEL` (30), `snippetOf`/`topFractionOf`.
- [Source: client/src/components/BankPanel/BankPanel.tsx] — `TYPE_ICON` (9), empty state (69), row render (75), Esc handling (40).
- [Source: client/src/components/BankPanel/BankPanel.css] — overlay/list/row styling, token-only rule.
- [Source: client/src/reader/ReaderPage.tsx:290] — `handleBankJump` (jump + flash + select), `bankOpen` state (110), `<BankPanel>` mount (457).
- [Source: server/app/models.py:372] — `Annotation` model; `type` is the five-value `Literal` (line 380); anchor discriminated union (`TextAnchor`/`RectAnchor`/`PathAnchor`).
- [Source: client/src/lib/bank.test.ts:140] — the "excludes pen strokes and underlines" guard to flip.
- [Source: client/src/theme/components.css:215] — `tag-chip` tokens (Story 7.11) to reuse for the filter chips.
- FR-23 (Bank filter by type, default comments), AR-12 (Bank ordering/view state), NFR-1 (no canvas reflow), UX-DR9 (Bank list item), UX-DR13 (no em-dash), UX-DR18 (empty states).

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (xHigh)

### Debug Log References

- **Design Call 2's premise was wrong; fixed with an explicit reset effect, not a bare `useState`.** The story's Dev Notes/Design Call 2 both assumed `BankPanel` "unmounts on close." Checked `ReaderPage.tsx:457` directly: it renders `<BankPanel open={bankOpen} .../>` unconditionally (never `{bankOpen && <BankPanel/>}`), so the component instance persists across close/reopen; only its internal `if (!open) return null` skips output. A bare `useState(DEFAULT_BANK_FILTER)` would therefore NOT reset on reopen. Fixed with a `useEffect(() => { if (open) setActiveTypes(DEFAULT_BANK_FILTER); }, [open])` keyed on the open-transition. Added a dedicated regression test ("reopening resets the filter back to comments only") that rerenders the SAME component instance closed then open and asserts the reset, since a naive test that remounts fresh would not have caught this.
- **Docker container collision during live smoke.** A `paper-mate-paper-mate-1` container (bind-mounted, `--reload`, `/app/.venv`) started on `127.0.0.1:8000` mid-session, racing my own `uv run uvicorn --port 8000` and winning the bind; my first health check response was actually the container's, not mine (CLAUDE.md's explicit "never reuse a found-running server" trap). Caught it via `ps aux` (path `/app/.venv/...` vs. host `.venv`) and `docker ps`, then relaunched both servers on alternate ports (backend 8010, frontend 5183 with `PAPER_MATE_API_TARGET=http://127.0.0.1:8010`) so the smoke was verifiably against this working tree.

### Completion Notes List

- **Task 1:** Removed `BANK_TYPES` and its filter clause from `bankItems`; the function now returns rows for all five types, doc/dedup/order logic untouched. Flipped the pre-existing `bank.test.ts` regression guard (was asserting pen/underline exclusion) to assert all five appear.
- **Task 2:** Added `filterBankItems` (pure, order-preserving) plus `BANK_FILTER_TYPES` (canonical five-type order: highlight, underline, pen, memo, comment) and `DEFAULT_BANK_FILTER` (comment-only `Set`) to `bank.ts`, all exported as the single source `BankPanel` and tests share.
- **Task 3/4:** `BankPanel` owns `activeTypes` state, a chip row (`role="group"`, one real `<button aria-pressed>` per type, `TYPE_ICON`/`TYPE_LABEL` reused) under the header, and an `emptyMessage()` helper for the adaptive empty state. See the Debug Log entry above for the reopen-reset fix this required.
- **Task 5:** Styled via existing tokens only, no new `--bank-filter-*` custom properties were needed: `--tag-chip-*` (Story 7.11) for chip shape/spacing, the `.pill[aria-pressed="true"]` idiom (`ReaderPage.css`) for the pressed/unpressed state, plus `--hairline-width`/`--radius-pill`/`--space-*`/`--type-caption-*`. `no-raw-values.test.ts` passes.
- **Open Design Calls, as decided:**
  1. Filter shape: the recommended 5-chip horizontal row under the title. Implemented as-is.
  2. Session default: reset every open, per AC-2's literal reading. Implemented via the reset-effect described in Debug Log (the "free via unmount" rationale in the story notes does not hold for this codebase; see above).
  3. Empty-state copy: exactly the recommended two strings ("No comments yet." / "No annotations match this filter.").
  4. Region as a facet: not implemented; region highlights/comments filter under their real `type` as recommended.
- **Pre-existing tests broken by the new comments-only default, and how each was fixed** (all used highlight-type fixtures and implicitly assumed the old "show everything" behavior):
  - `BankPanel.test.tsx`: rewritten. Generic rendering/behavior tests (empty state, one row, dedup, doc-scoping, jump, Esc, close, button-tag checks) now use a `commentMark` fixture so they exercise the new default directly instead of fighting it. The three placeholder/Region-label tests (which genuinely need `type: "highlight"`) now click `bank-filter-highlight`/`bank-filter-memo` first to widen the filter, then assert. Added 11 new tests for Story 8.2 (AC-1..AC-5, the store-mutator-never-called guard, and the reopen-reset regression). 23/23 pass.
  - `ReaderPage.test.tsx`: the two "Annotation Bank" tests that seed a highlight-type `mark()` and expect it listed now click `bank-filter-highlight` before asserting the row exists. No other `mark()` call sites in that file touch Bank rendering.
- Full suite: 1393/1393 client tests pass (68 files), `npm run typecheck` clean. No server-side change (no `server/` files touched, no `gen:api` regen needed).
- **Live smoke** (own fresh servers on 8010/5183 after the Docker collision above; fixture PDF `1903.03295v2.pdf` seeded via the API with one annotation of each of the five types): confirmed comments-only default (only the comment chip pressed, only the comment row listed); toggled all four other chips and confirmed all five rows appeared; clicked the newly-surfaced pen row and confirmed it jumps + flashes/selects on the page (`handleBankJump` unchanged); toggled all five chips off and confirmed the generic empty state ("No annotations match this filter.") with the canvas unchanged underneath (no reflow); closed and reopened the panel and confirmed the filter reset back to comments-only. Zero console errors/warnings.

### File List

- `client/src/lib/bank.ts` (modified: removed `BANK_TYPES`; widened `bankItems`; added `BANK_FILTER_TYPES`, `DEFAULT_BANK_FILTER`, `filterBankItems`)
- `client/src/lib/bank.test.ts` (modified: flipped the pen/underline-exclusion guard; added a `filterBankItems` describe block)
- `client/src/components/BankPanel/BankPanel.tsx` (modified: filter state + reset effect, chip row, adaptive empty state)
- `client/src/components/BankPanel/BankPanel.css` (modified: `.bank-panel__filter`/`.bank-filter-chip` styling)
- `client/src/components/BankPanel/BankPanel.test.tsx` (modified: rewritten fixtures for the comments-only default; added Story 8.2 filter test suite)
- `client/src/reader/ReaderPage.test.tsx` (modified: widened the filter in the two Bank tests that list a highlight-type mark)
- `.bmad/implementation-artifacts/sprint-status.yaml` (modified: `8-2-annotation-bank-filter-by-type` → in-progress, then review)

## Change Log

| Date | Change |
|------|--------|
| 2026-07-11 | Implemented Story 8.2: widened `bankItems` to all five annotation types, added `filterBankItems` + `BankPanel` type-filter chip row (default comments only, resets on every reopen), adaptive empty-state copy. Fixed pre-existing `BankPanel.test.tsx`/`ReaderPage.test.tsx` fixtures broken by the new default. 1393/1393 client tests pass; typecheck clean; live-smoked on own dev servers (8010/5183) with one annotation of each type. Status → review. |
| 2026-07-11 | Addressed Codex `bmad-code-review` findings (2 patch, both resolved): reset-filter effect switched `useEffect` → `useLayoutEffect` (prevented a stale-rows flash on Bank reopen); three test sites (`bank.test.ts`, `BankPanel.test.tsx`) switched from re-listing the five annotation types inline to importing `BANK_FILTER_TYPES`. 1393/1393 tests pass; typecheck clean. Status → review. |
