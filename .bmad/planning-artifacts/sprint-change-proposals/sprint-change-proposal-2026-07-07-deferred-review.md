# Sprint Change Proposal, Deferred-work review + Epic 7 refactor story

**Date:** 2026-07-07
**Author:** Wonseok (via bmad-correct-course)
**Scope classification:** Moderate (backlog reorganization, a deferred-work prune + two new backlog stories; no in-flight work altered, no contract/behavior change)

## Section 1, Issue Summary

Two related triggers, handled in one correct-course run:

1. **Deferred-work drift.** `deferred-work.md` had accumulated ~30 items since the 2026-06-30 promotion pass. Many have since SHIPPED (Epics 3/4/5/7 closed most of the reader/annotation-fidelity items), but their detail sections and the stale "Promoted to epics" table still sat in the file, mixing shipped, descoped, discarded, and still-open work with no clear signal of which was which. The user asked to review it, **remove the shipped items**, and **promote the still-valid ones to stories**, calling out the "text copy with break-lines" bug as the important one.

2. **Epic 7 structural debt.** Epic 7 landed the whole organize/curate run (folders, batch move, sort/filter, Trash, Recent, Starred) on Epic 6's table + index and grew the same kind of debt Stories 5.0/5.3/5.4/6.8 addressed for earlier epics: a 629-line `CollectionTable`, a 449-line `LibraryPage`, three near-twin optimistic op hooks, and duplicated set-based mutators/routes on the backend. The user asked to add a decomposition/refactor story as **Story 7.10**.

## Section 2, Impact Analysis

- **Epic impact:** New **Epic 9** (Reader fidelity round 2, post-v1). New **Story 7.10** under the in-progress Epic 7. No existing epic's status changes.
- **Story impact:** One new promoted story (**9.1 paragraph-aware copy**) and one new refactor story (**7.10 Epic 7 structural refactor**). Both `backlog`. No in-flight or done story is touched.
- **Artifact conflicts:** `deferred-work.md` (prune + ledger rewrite), `epics.md` (add Epic 9 + Story 9.1; add Story 7.10), `sprint-status.yaml` (register epic-9 / 9-1 / 7-10). No PRD/architecture/UX change, both new stories are no-new-FR (9.1 continues FR-2; 7.10 is a pure refactor).
- **Technical impact:** None yet (planning only). 9.1 is `render/`-only when built; 7.10 is behavior/contract-identical when built.

## Section 3, Recommended Approach

**Direct adjustment** (no rollback, no MVP change). The deferred file is pruned to reflect shipped reality; the one still-wanted reader bug and the requested refactor are promoted to tracked backlog stories in their proper epics. Both new stories are post-v1, own-PR, no-contract-change, low risk.

Epic-home decision (confirmed with user): the promoted reader bug goes to a **new Epic 9**, not Epic 7, Epic 7 is the Library epic and a text-layer copy bug is reader-fidelity work (Epic 4's theme, which is closed). A fresh Epic 9 keeps the epics coherent by theme. Only the paragraph-vs-wrap copy bug was promoted; group-selection stays `backlog` (needs a design pass, not chosen this round).

## Section 4, Detailed Change Proposals

### 4a. `deferred-work.md`, removed SHIPPED items (10 detail sections + stale table)

Replaced the stale "Promoted to epics (2026-06-30)" table with a **"Status ledger (last reviewed 2026-07-07)"** that lists only what remains (descoped / discarded / not-built / Phase-2) and records the removals + the 9.1 promotion. Removed detail sections, each verified shipped:

| Removed section | Shipped by |
| --- | --- |
| Copied text loses spaces at line breaks | Story 4.1 (AC-1) |
| Trailing-punctuation thick selection band | Story 4.1 (AC-2) |
| Flaky `Reader.test.tsx` Ctrl+wheel test | Story 4.1 (AC-4) |
| Highlights join across the gutter (`mergeRects`) | Story 4.2 Part A |
| Hide/show all annotations toggle | Story 5.5 |
| Layered Esc | Story 5.6 |
| Unify conditionals + FSM + data classes + `src` structure | Stories 5.0 / 5.3 / 5.4 |
| Convert highlight ↔ comment | Story 3.7 |
| Settings modal + hotkey rebinding | Story 5.1 |
| Starred lens needs the Location column | Story 7.8 (+ the 2026-07-07 folder-view Location-hide fix) |

Retained (NOT shipped): the Story 4.3 / 5.2 / 5.7 descopes; the 3.8 / 4.2-Part-B / 5.6 (confirm-check + stroke-width) discards; the cross-type unified hit-layer (verified not built, the two opacity groups still exist); group-selection (backlog); and the Phase-2 items (upload cap, ToC synthesis + schema bump, direct PDF text edit). The memo move/resize section is retained because its transparent-bg half is the Story 4.3 descope source (the move/resize half is already annotated shipped-in-3.1).

The **paragraph-vs-wrap copy** section is retained as the source spec and annotated **"PROMOTED to Epic 9 Story 9.1."**

### 4b. `epics.md`, new Epic 9 + Story 9.1

Appended after Epic 8. Epic 9 = "Reader fidelity round 2 (post-v1, Phase-1.5)". Story 9.1 = "Paragraph-aware copy (join soft-wrapped lines)": a soft-wrapped paragraph copies as one continuous line (wraps joined by a space; real paragraph breaks kept), via a paragraph-vs-wrap heuristic over pdf.js per-line geometry (Y-gap vs line-height, indent, trailing punctuation). Story STARTS with a spike (prototype the heuristic against 2–3 real papers) before the full implementation. `render/`-only, no annotation/anchor/store change, regression-guards Story 4.1's inter-line-space + trailing-punctuation fixes.

### 4c. `epics.md`, new Story 7.10 (under Epic 7)

Appended after Story 7.9. "Epic 7 structural refactor (modularize the library client and the storage/routes organize layer)." Same footing as 5.0/5.3/5.4/6.8. Targets: decompose `CollectionTable.tsx` (629) and `LibraryPage.tsx` (449) into cohesive units; abstract the three near-twin optimistic op hooks (`useMovePapers`/`useTrashPapers`/`useStarPapers`) into one reusable seam; split `library_index.py` (453) folder-tree vs set-based paper-org mutators + dedupe the validate-before-mutate pattern; consolidate `routes/library.py`'s duplicated `DocIdSet → storage_errors → storage.X_papers` handler shape + `responses=` map. Behavior/contract-identical, own PR(s), no new capability.

### 4d. `sprint-status.yaml`

Added `epic-9: backlog`, `9-1-paragraph-aware-copy: backlog`, `epic-9-retrospective: optional`, and `7-10-epic-7-structural-refactor: backlog` (in the Epic 7 block, after 7-9), each with a dated correct-course provenance comment. Bumped `last_updated`.

## Section 5, Implementation Handoff

- **Scope:** Moderate, backlog reorganization, no in-flight work touched.
- **Recipients:** Developer (Wonseok) at the next `bmad-create-story` cycle. Both new stories are `backlog`; run `create-story` when picking either up.
- **Sequencing note:** Story 7.10 should refactor *around* Story 7.9 (Venue/Year/DOI) if 7.9 hasn't merged when 7.10 runs, or sequence after it, do not fold them. Story 9.1 is independent (reader side) and can be picked up any time.
- **Success criteria:** deferred-work.md now cleanly separates shipped (removed) from open (kept); the two new stories are tracked in epics.md + sprint-status; no contract/behavior change; suites remain green (no code touched this round).
