# Sprint Change Proposal: Resequence the Epic 7 structural refactor to the last story

**Date:** 2026-07-08
**Trigger:** User request mid-Epic-7 (after Story 7.9 reached ready-for-dev): "put Story 7.10 to the last story of Epic 7, and adjust the refactoring scope revolving around Epic 7."

## 1. Issue Summary

The Epic 7 structural refactor was numbered **7.10**, sitting BEFORE the two 2026-07-08 feature stories (7.11 reorder-columns, 7.12 author-tag). A refactor placed before the features it must clean up either refactors a moving target or has to be re-touched after each later feature lands. The user wants the refactor to run **last** so it decomposes the whole Epic 7 surface (every feature story merged) in one pass, and wants its scope widened to explicitly cover the debt those later stories add.

**Category:** Backlog resequencing + scope expansion of one not-yet-started refactor story. No `done` story reopened; no feature behavior or contract changed. All three affected stories were `backlog` (no story files, no code).

**Grounding (verified against current artifacts):**
- Repo convention is **number = exec order** (stated across prior renumbers in `sprint-status.yaml`, e.g. Epic 2's `2-4`/`2-5` insertions). So "put 7.10 last" means renumber, not physically move a mislabeled section.
- Story 7.9 (`venue-year-doi-columns`) is already `ready-for-dev` with a story file on its branch; it is unaffected by the renumber (stays 7.9) but its internal cross-references to "Story 7.10 / 7.11" needed realignment.
- The old 7.12 (tag) story body already flagged the sequencing ambiguity ("recommend 7.10 first, or 7.12 introduces the seam 7.10 then generalizes"), which this resequence resolves decisively.

## 2. Impact Analysis

### Epic impact
Epic 7 stays **in-progress**; story count unchanged (still 4 open: 7.9-7.12). Only the ordering + the refactor's scope text change. No other epic touched.

### Story impact (renumber, number = exec order)
| Old | New | Story |
|---|---|---|
| 7.9 | 7.9 | Venue / Year / DOI columns (ready-for-dev, unchanged) |
| 7.11 | **7.10** | Reorder columns by drag-and-drop (persisted table layout) |
| 7.12 | **7.11** | Tag-type columns (Author as editable, filterable tags) |
| 7.10 | **7.12** | Epic 7 structural refactor (now LAST, scope expanded) |

New exec order: **7.9 → 7.10 (reorder) → 7.11 (tag) → 7.12 (refactor)**.

### Refactor scope expansion (Story 7.12)
The refactor now runs after 7.9-7.11, so its scope was widened to name their debt explicitly:
- **7.9:** the Venue/Year/DOI columns + `crossref` venue/year helpers + the grown `_cache_from_meta` projection + `ExtractedMeta`/`DocMeta`/`CollectionRow` field growth.
- **7.10:** the `localStorage` table-view-preferences store (order + visibility + widths) as a cohesive degrade-safe client-only leaf, plus the drag-reorder handler folded into the `CollectionTable` decomposition.
- **7.11:** the column **cell-type dispatch seam** (the tag story introduces it under feature pressure; the refactor consolidates it as the canonical column-descriptor/renderer seam) + the author-list end-to-end projection + any author-edit optimistic op folded into the shared `useOptimisticLibraryOp` seam.
- Removed the now-moot caveat "refactor around 7.9 if it has not merged, or sequence after it" (7.9-7.11 are all guaranteed merged before 7.12).

### Artifact conflicts / updates
- **`epics.md`:** the refactor section physically moved to the end of Epic 7 and renumbered 7.10 → 7.12 with expanded intro + ACs; the reorder (7.11 → 7.10) and tag (7.12 → 7.11) headings renumbered; the tag story's two cross-references to "Story 7.10's decomposition seam" / "sequencing vs Story 7.10" rewritten to point at the refactor as **Story 7.12, which now runs after it**. **(applied.)**
- **`sprint-status.yaml`:** the three keys renumbered with an explanatory correct-course comment block; `last_updated` bumped. **(applied.)**
- **Story 7.9 file** (`.bmad/implementation-artifacts/epic-7/7-9-venue-year-doi-columns.md`, on its branch): internal cross-refs realigned (refactor "Story 7.10" → 7.12; reorder "Story 7.11" → 7.10). **(applied on the story branch.)**
- **PRD / architecture / UX:** no change. Refactor stories carry no LFR (same footing as the 5.0/5.3/5.4/6.8 dev-debt refactors); the FR Coverage Map and the epic's LFR line are untouched.
- **Contract:** none. This is planning-only.

### Technical impact
None to code. The refactor's own AC set stays BEHAVIOR- and CONTRACT-identical (client+server suites green, `openapi.json`/`schema.d.ts` byte-identical); the expansion only enlarges the surface it decomposes.

## 3. Recommended Approach

**Direct Adjustment** (resequence + rescope one backlog story). No rollback, no MVP re-cut.

- Renumber so the refactor is the last Epic 7 story (7.12), shifting reorder → 7.10 and tag → 7.11.
- Expand the refactor scope to the full post-7.11 Epic 7 surface; resolve the old cell-type-seam sequencing question in favor of "7.11 introduces the seam, 7.12 consolidates it."

**Rationale:** a structural-refactor story is only worth doing once the code it targets has stopped moving. Running it last is the same discipline already applied to Story 5.0/5.3/5.4/6.8 (each a pure refactor thread on a settled surface). Risk is nil (no code, no contract, no `done` story).

**Effort:** trivial (planning edits only). No dev effort shifts; the three stories keep their content, only their numbers + the refactor's scope text change.

## 4. Detailed Change Proposals

All edits below are **already applied** to the artifacts.

### `epics.md`
- Moved the "Epic 7 structural refactor" section to the end of Epic 7, renumbered **7.10 → 7.12**, retitled "modularize the whole organize/curate surface", and expanded its intro + the CollectionTable / op-hooks / column-model / storage ACs to name the 7.9 columns, the 7.10 prefs store, and the 7.11 cell-type/tag seam. Dropped the "7.9 if not merged" caveat.
- Renumbered **Story 7.11 (Reorder) → 7.10** and **Story 7.12 (Tag) → 7.11** (headings only; bodies unchanged except the tag cross-refs).
- Rewrote the tag story's cell-type AC and out-of-scope sequencing note to reference **Story 7.12** (the refactor, now after it) instead of "Story 7.10".

### `sprint-status.yaml`
- `7-11-reorder-columns-persisted → 7-10`, `7-12-author-tag-column → 7-11`, `7-10-epic-7-structural-refactor → 7-12`, with a correct-course comment block recording the renumber and the widened scope. `last_updated` bumped.

### `7-9-venue-year-doi-columns.md` (story branch)
- Cross-refs: refactor "Story 7.10" → **7.12**; reorder-and-persist "Story 7.11" → **7.10**; the "do NOT close Epic 7" note relabeled to the new numbers.

## 5. Implementation Handoff

**Scope classification: Moderate** (backlog reorganization; no `done` work reopened; no code/contract change).

**Route to:** `bmad-create-story` when each renumbered story is picked up, in exec order: **7.9 (dev next, already ready-for-dev) → 7.10 reorder → 7.11 tag → 7.12 refactor (last)**.

**Success criteria:**
- Epic 7 reads 7.9, 7.10 (reorder), 7.11 (tag), 7.12 (refactor) in both `epics.md` and `sprint-status.yaml`, in file order, with no duplicate or skipped number.
- The refactor story (7.12) scope names the 7.9/7.10/7.11 debt and runs after all three.
- Story 7.9's file cross-refs match the new numbers.

**Not in scope:** any change to feature content, ACs, or the contract; closing Epic 7; touching Stories 7.1-7.8.
