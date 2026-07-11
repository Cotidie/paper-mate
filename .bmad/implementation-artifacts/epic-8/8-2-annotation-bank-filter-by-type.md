---
baseline_commit: ecfacfc74f2567889bbf4470d0b45368a8e8021a
---

# Story 8.2: Annotation Bank filter by type (default comments)

Status: ready-for-dev

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

- [ ] **Task 1 — Widen `bankItems` to all five types** (AC: 1)
  - [ ] In `client/src/lib/bank.ts`, remove the `BANK_TYPES` restriction so `bankItems` returns rows for all five `Annotation["type"]` values (keep the `doc_id` filter, the `group_id` dedup, and the `created_at` ordering exactly as-is). Delete `BANK_TYPES` and its comment; do not leave it dead.
  - [ ] Confirm `toBankItem`/`snippetOf`/`topFractionOf` need no change (they already branch on anchor kind for all types). Underline rows use `anchor.text`; pen rows fall back to the `"Pen stroke"` label + `pointsBounds`.
- [ ] **Task 2 — Add the pure type-filter derivation** (AC: 2, 4)
  - [ ] Add a small pure helper to `bank.ts` (leaf module, AD-9 — no store/DOM) that narrows a `BankItem[]` to an active set of types, e.g. `filterBankItems(items: BankItem[], activeTypes: ReadonlySet<Annotation["type"]>): BankItem[]`. Keep `bankItems` (all rows) and the filter as separate single-responsibility functions so Story 8.3's re-sort drops in without entangling the filter.
  - [ ] Export a canonical ordered list/const of the five types (for building the control) and the comments-only default, so `BankPanel` and tests share one source of truth (no re-listing the enum inline).
- [ ] **Task 3 — Filter control + default in `BankPanel`** (AC: 2, 3, 5)
  - [ ] Own the active-types set as client view state in `BankPanel` via `useState`, initialized to comments-only. `BankPanel` returns `null` when `!open` (it unmounts on close), so this state naturally resets to the comments-only default on each open, satisfying AC-2. (See Open Design Call 2 if the default should instead be remembered per session.)
  - [ ] Render the filter control in the panel header region (see Open Design Call 1 for shape). Each type toggle is a real `<button>` with `aria-pressed`, a visible glyph + label (reuse `TYPE_ICON`/`TYPE_LABEL`), keyboard-operable.
  - [ ] Compose in render: `filterBankItems(bankItems(annotations.values(), docId), activeTypes)`.
- [ ] **Task 4 — Filter-adaptive empty state** (AC: 3, 5)
  - [ ] Replace the single `"No annotations yet."` with a message that adapts to the active filter (comments-only → "No comments yet."; a broader/empty selection → a general "No annotations match this filter." — settle exact copy per Open Design Call 3). No em-dash.
  - [ ] Keep the empty state inside the panel; the canvas never reflows (NFR-1).
- [ ] **Task 5 — Styling via tokens** (AC: 1, 2)
  - [ ] Style the filter control in `BankPanel.css`, tokens only (raw hex/px live in `theme/**` only — `src/no-raw-values.test.ts` enforces this). Reuse existing tokens where they fit (e.g. the `tag-chip` family, `--space-*`, `--color-*`); add new `--bank-filter-*` tokens to `client/src/theme/components.css` only if a genuinely new dimension is needed.
- [ ] **Task 6 — Tests** (AC: 1, 2, 3, 4)
  - [ ] **Flip the regression guard:** `client/src/lib/bank.test.ts:140` currently asserts "excludes pen strokes and underlines; only highlight/memo/comment appear". After Task 1 that is wrong — rewrite it to assert all five types now produce rows (order preserved by `created_at`).
  - [ ] Unit-test `filterBankItems`: comments-only narrows to comment rows; a multi-type set includes exactly those; the empty set yields `[]`; filtering preserves the input order (so it composes with sort).
  - [ ] Add `BankPanel` component tests (the component has NONE today — CodeGraph flags "no covering tests"): default open shows comments only; toggling a type chip reveals/hides that type's rows; a filter matching nothing shows the adaptive empty state; the filter never calls any store mutator.
  - [ ] Run `cd client && npm test` and `npm run typecheck` — both green.
- [ ] **Task 7 — Live smoke** (AC: 1, 2, 3)
  - [ ] With your OWN fresh dev servers (never a user-launched/Docker one — CLAUDE.md), on a paper carrying at least one of each type: open the Bank → confirm comments-only default; toggle chips → confirm pen/underline/highlight/memo rows appear and jump+select correctly (a Bank row click still runs `handleBankJump` = jump + flash + select); confirm the adaptive empty state; confirm the canvas never reflows while filtering. This is a light single-view smoke; no cross-page selection is involved (that is 8.4/8.8's concern, not this story).

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

### Debug Log References

### Completion Notes List

### File List
