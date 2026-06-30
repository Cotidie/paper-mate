# Sprint Change Proposal — 2026-06-30

**Author:** Wonseok (via correct-course)
**Status:** Approved (batch mode)
**Scope classification:** Moderate (backlog reorganization — two new epics + Epic-3 additions; no change to Epics 1–3 core build)

## Section 1 — Issue Summary

Epic 1 and Epic 2 are complete (Story 2.12 merged, 2.13 pen-alpha is the last Epic-2 item). Across that build, `deferred-work.md` accumulated ~25 items: render/anchor fidelity bugs, annotation-edit extensions, color-system asks, UX-polish requests, and a standing code-quality refactor thread. They were never reflected in the epic plan, so the backlog did not show what real work remains beyond Epics 1–3.

Trigger (user): "including deferred works, revise the epics and correct course. If you find a good spot to group into a new Epic, do so."

First, `deferred-work.md` was pruned of items already delivered:
- **1-5-zoom** section (text-layer scale vars resolved; scroll-away cancel promoted to Story 1.7, done).
- **2-5 arm-time default-color pick** (delivered by Story 2.6 — store `activeColor`/`setActiveColor` replaced the hardcoded `DEFAULT_COLOR`).
- **Local Docker dev experience** (delivered by Story 2.1 — `docker-compose.yml` `user:` + bind-mount `--reload`).

## Section 2 — Impact Analysis

Remaining deferred items cluster into 7 groups:

| Cluster | Items | Home |
| --- | --- | --- |
| A. Render/anchor fidelity bugs | copy-spaces, trailing band, gutter-join, multi-column selection | **Epic 4 (new)** |
| B. On-page mark treatment | comment-vs-highlight, memo transparent | **Epic 4 (new)** |
| C. Annotation edit extensions | adjust text range, memo move/resize, retext via command path, convert highlight↔comment, cross-type hit-layer | **Epic 3** (folded in) |
| D. Preferences / UX polish | settings+hotkeys, hide/show toggle, layered Esc, confirm-check, collapse stroke-width, dim ToC | **Epic 5 (new)** |
| E. Color system | per-tool default, custom slots | **Epic 5 (new)** |
| F. Code-quality refactor | data contracts, conditional/FSM unify, src split | **Epic 5 Story 5.0** (enabler) |
| G. Post-v1 / Phase-2-3 | upload size cap, ToC synthesis, direct PDF text edit | **out of scope** (unchanged) |

- **Epic Impact:** Epics 1–3 core build unchanged. Epic 3 gains 2 stories (3.7, 3.8) + 3 folded notes on Story 3.1. Two new post-v1 epics (4, 5).
- **Artifact conflicts:** PRD lists FR-1..22 only; this adds FR-23..27 → recommend a PRD addendum (epics.md updated now). DESIGN.md needs new `--annotation-comment-*` / memo tokens (Epic 4 Story 4.3) and custom-color CSS vars (Epic 5 Story 5.2) when those stories run.
- **Technical impact:** No contract/anchor-MODEL change in any new story (verified against AR-3/AR-5). Refactor (5.0) must keep the OpenAPI contract byte-identical.

## Section 3 — Recommended Approach

**Direct adjustment** (no rollback, no MVP cut). Decisions confirmed with the user:
- **Two new epics**, post-v1 (Phase-1.5): Epic 4 Fidelity (A+B), Epic 5 Preferences & Polish (D+E+F).
- **v1 still ships on Epics 1–3.** New epics sequenced after launch; promote any single Epic-4 fidelity story to v1-blocking if a bug materially degrades core reading.
- Cluster C folds into Epic 3 (it is command-path edit work). Cluster G stays Phase-2+.
- Refactor (5.0) is tracked in Epic 5 but flagged to pull to the **Epic-2/3 boundary** (before Story 3.1 builds on the current sprawl) if warranted.

## Section 4 — Detailed Change Proposals

### epics.md
- **Requirements inventory:** added FG-F (post-v1) with FR-23..FR-27; noted fidelity bugs map to NFR-3 + existing FRs, small UX refinements are AC-level.
- **FR Coverage Map:** added FR-23..27 rows + a quality/fidelity note routing the no-new-FR items to Epic 4.
- **Epic List:** added Epic 4 + Epic 5 summaries (FRs/NFRs/architecture).
- **Epic 3:** added a note block on Story 3.1 (memo corner-resize priority; route memo/comment retext through the command path; cross-type unified hit-layer) + new **Story 3.7** (convert highlight↔comment) and **Story 3.8** (adjust text range).
- **Epic 4 (new):** Story 4.1 text-layer copy/selection fidelity (+ de-flake `Reader.test.tsx`), 4.2 column-aware selection & highlight geometry, 4.3 distinct/non-obscuring on-page treatment.
- **Epic 5 (new):** Story 5.0 structural refactor (enabler), 5.1 settings + hotkey rebinding, 5.2 color system, 5.3 hide/show-all toggle, 5.4 interaction polish (layered Esc / confirm / stroke-width), 5.5 dim ToC.

### sprint-status.yaml
- Added `3-7-convert-highlight-comment`, `3-8-adjust-text-range`, `epic-4` + 3 stories, `epic-5` + 6 stories (5-0..5-5), all `backlog`; retros `optional`. `last_updated` noted.

### deferred-work.md
- Pruned 3 delivered items. Added a "Promoted to epics" mapping table (each item → epic/story) + a "Not promoted" line.

### PRD (recommended, not yet applied)
- Add FR-23..FR-27 to the PRD addendum so the PRD stays the FR source of truth.

## Section 5 — Implementation Handoff

- **Scope:** Moderate → Product Owner / Developer. Backlog is reorganized; no code change in this proposal.
- **Next dev action:** finish Epic 2 (Story 2.13 pen-alpha, `ready-for-dev`), then Epic 2 retro, then Epic 3. Consider pulling Epic 5 Story 5.0 (refactor) to the Epic-2/3 boundary.
- **Success criteria:** every remaining `deferred-work.md` item is either delivered, tracked to an epic/story, or explicitly Phase-2+. epics.md, sprint-status.yaml, and deferred-work.md agree.
- **Follow-up:** apply the PRD addendum for FR-23..27.
