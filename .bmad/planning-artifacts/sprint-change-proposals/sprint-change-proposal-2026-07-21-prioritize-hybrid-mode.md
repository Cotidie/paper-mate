# Sprint Change Proposal — Prioritize the hybrid-mode migration to Story 10.3

- **Date:** 2026-07-21
- **Author:** Wonseok (via bmad-correct-course)
- **Scope classification:** Minor (a resequencing/renumber within Epic 10; no scope, contract, or AC change to any story)
- **Epic:** 10 (Document structure layer)

## Section 1 — Issue Summary

The hybrid-mode migration (opendataloader Docling + vision model for higher structure fidelity) was added as Story 10.8 by the earlier 2026-07-21 correct-course. User decision: **prioritize it to Story 10.3** so the fidelity upgrade lands BEFORE the remaining structure consumers are built — the Figures/Tables index, reading-helper, metadata, and digest then read the higher-fidelity structure from the start, instead of being built on local mode and re-validated after a later hybrid swap.

## Section 2 — Impact Analysis

- **Epic impact:** Epic 10 story ORDER changes; no story's scope, ACs, or dependencies change. All shifted stories except the S2-enrich one are un-started `backlog`.
- **Story renumber (old → new):**
  - Migrate to hybrid mode: **10.8 → 10.3** (moved up)
  - Figures & Tables index: 10.3 → 10.4
  - Inline reading-helper previews: 10.4 → 10.5
  - Structure-backed metadata: 10.5 → 10.6
  - Structure-derived digest: 10.6 → 10.7
  - Prioritize Semantic Scholar (enrich): **10.7 → 10.8** (the only renumbered story with an existing file — `ready-for-dev`; independent of the structure layer, so its number is purely exec order)
  - Epic 10 structural refactor (terminal): stays **10.9** (AE7-5, always last)
- **Artifact conflicts:** the epic file (headings reordered + renumbered, hybrid section physically moved to the 10.3 slot, stale numbered cross-refs corrected), `sprint-status.yaml` (keys renumbered), the S2 story file (`git mv` 10-7 → 10-8 + heading + internal cross-refs), and `epics/index.md` (the epic-10 story list, which was already two correct-courses stale, rewritten to the new order). AD-13 and the hybrid ACs are unchanged (the migration is the same work, just earlier).
- **Technical impact:** none — no code, no contract. Sequencing only. (The dev win: consumers 10.4–10.7 build once, on hybrid-fidelity structure.)

## Section 3 — Recommended Approach

**Direct Adjustment (resequence).** No rollback, no scope change. Hybrid becomes 10.3; the five displaced stories shift +1; S2-enrich moves 10.7 → 10.8; the refactor stays last at 10.9.

- **Effort:** artifact renumber only.
- **Risk:** low — the only story with a created file (S2-enrich, `ready-for-dev`) is renamed and its internal references corrected; it stays independent and pickable anytime.

## Section 4 — Detailed Change Proposals

- **Epic file:** hybrid section moved to the 10.3 slot (after 10.2) and renumbered; Figures/reading-helper/metadata/digest → 10.4/10.5/10.6/10.7; S2 → 10.8; refactor stays 10.9. Intro + body cross-refs corrected (`10-5 supersedes 12.3`, prereq `10-2..10-8`, refactor `10-9`, reading-helper "benefits from 10-4", S2 "interacts with 10-6", refactor "enrich cascade 10.8"). Hybrid intro gains the prioritization rationale.
- **`sprint-status.yaml`:** `10-3-hybrid-mode-switchable` (new position), `10-4-figures-tables-index`, `10-5-structure-backed-reading-helper`, `10-6-structure-backed-metadata`, `10-7-structure-derived-digest`, `10-8-metadata-enrichment-semantic-scholar-first` (was 10-7, `ready-for-dev`), `10-9-epic-10-structural-refactor`. `last_updated` bumped, dated correct-course note added.
- **S2 story file:** `git mv` to `10-8-…`, heading `Story 10.7 → 10.8`, internal "Story 10.5/10.7" → "10.6/10.8".
- **`epics/index.md`:** epic-10 story list rewritten to the 10.3–10.9 order (also recovering the two entries the previous correct-courses hadn't added).

## Section 5 — Implementation Handoff

- **Scope:** Minor (resequence).
- **Next step:** `bmad-create-story 10-3` (the hybrid-mode SPIKE-FIRST story) is now the next structure-layer story after 10.2. The S2-enrich story (now 10.8) remains independently `ready-for-dev`.
- **Success criteria:** the epic file, sprint-status, the renamed story file, and the index all agree on the 10.3–10.9 order; hybrid is 10.3; the refactor is last at 10.9.
