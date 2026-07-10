# Sprint Change Proposal — Deprioritize Remote sync, renumber Reader-fidelity to Epic 8

**Date:** 2026-07-11
**Trigger (user):** "Let's delete Epic 8. It's not important right now. Move Epic 9 as Epic 8."
**Scope classification:** Minor (planning-artifact only; no code, no contract, no PRD/architecture/spec requirement change).
**Mode:** Batch, applied on approval.

## 1. Issue summary

Remote sync occupied the **Epic 8** slot (DEFERRED, undecomposed — LFR-25..29). The user deprioritized it ("not important right now") and asked to promote **Reader fidelity round 2** (then Epic 9, one open story: paragraph-aware copy) into the Epic 8 slot.

The key nuance surfaced during analysis and confirmed with the user: Remote sync is **not only an epic** — it is a committed product requirement **F8 (FR-25..29)** in the PRD, backed by a **reserved switchable-backend sync seam** in the architecture spine, and named as a non-goal in the SPEC. "Delete Epic 8" therefore had two possible meanings.

**User decision:** *Un-number it, keep F8 captured.* Remove Remote sync from the numbered epic roadmap only; leave PRD F8 / FR-25..29, the architecture seam, and the SPEC entries intact as a deferred, unnumbered follow-on capability.

## 2. Impact analysis

- **Epics:** Remote sync stops being a numbered epic (becomes an unnumbered deferred note). Reader-fidelity round 2 renumbers Epic 9 → **Epic 8**; its single story renumbers 9.1 → **8.1**. No cascade (no Epic 10 existed).
- **Requirements (unchanged):** PRD F8 / FR-25..29, the architecture spine's reserved sync seam, and the SPEC non-goal entries stay exactly as-is. The capability is deprioritized, not dropped.
- **Cross-references reconciled in the same change** (the Epic-7 retro AE7-3 discipline): the Epic-7 retro's forward-looking "next epic" references, the `deferred-work.md` tracker, and the live `sprint-status.yaml` AE7-4 action item all pointed at "Epic 9 / Story 9.1" and were updated to "Epic 8 / Story 8.1" with a renumber breadcrumb.
- **Historical records left untouched:** the three dated `sprint-change-proposal-2026-07-07-*.md` files are point-in-time records and were not rewritten.
- **Code / tests / version:** none. No `server/`, `client/`, contract, or version change.

## 3. Recommended approach

Direct adjustment — a documentation renumber + a deferral reclassification. No rollback, no MVP-scope change.

## 4. Detailed change proposals (applied)

**`.bmad/planning-artifacts/epics.md`**
- LFR-25..29 mapping: `→ Epic 8 (DEFERRED)` → `→ deferred follow-on, UNNUMBERED (PRD F8/FR-25..29 + reserved architecture sync seam)`.
- Library-Epic-List `### Epic 8: Remote sync` entry → `### Remote sync (DEFERRED, UNNUMBERED follow-on; was "Epic 8")` note.
- Full `## Epic 8: Remote sync (DEFERRED)` section → `## Remote sync (DEFERRED, unnumbered)` note.
- `## Epic 9: Reader fidelity round 2` → `## Epic 8: Reader fidelity round 2` (+ renumber provenance in the intro).
- `### Story 9.1: Paragraph-aware copy` → `### Story 8.1: Paragraph-aware copy`.

**`.bmad/implementation-artifacts/sprint-status.yaml`**
- Removed the `epic-8` / `epic-8-retrospective` rows (Remote sync) and its comment; replaced with an un-numbered deferred note.
- Renumbered `epic-9` → `epic-8`, `9-1-paragraph-aware-copy` → `8-1-paragraph-aware-copy`, `epic-9-retrospective` → `epic-8-retrospective` (comment carries the renumber provenance).
- Updated action item **AE7-4**'s "Epic 9 reader-fidelity" reference to "Epic 8 reader-fidelity (renumbered from Epic 9)".

**`.bmad/implementation-artifacts/deferred-work.md`** — 4 references "Epic 9 Story 9.1" → "Epic 8 Story 8.1" (with renumber breadcrumbs).

**`.bmad/implementation-artifacts/epic-7/epic-7-retro-2026-07-11.md`** — 3 forward-looking references reconciled (Epic 9 → Epic 8; the "Epic 8 = Remote sync" next-epic line reworded to reflect the un-numbering).

## 5. Implementation handoff

Minor scope, applied directly. No downstream handoff. When Remote sync is eventually picked up it re-enters as a fresh numbered epic via its own discovery; PRD F8 remains its captured source. Reader-fidelity is now **Epic 8**, still `backlog`, its Story **8.1** (paragraph-aware copy) unchanged in substance.
