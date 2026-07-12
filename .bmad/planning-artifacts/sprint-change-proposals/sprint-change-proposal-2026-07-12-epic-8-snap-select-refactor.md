# Sprint Change Proposal: snap-select spike (Story 8.9) + Epic 8 structural refactor (Story 8.10)

**Date:** 2026-07-12
**Trigger:** user request, in-conversation, following Story 8.8's completion
**Mode:** Batch

## Section 1: Issue Summary

Story 8.8 (just merged to `review`) resolved the empty-space-drag defect by making the origin a **no-op** for text selection (its AC-3 design call). During review, the user asked whether a better UX is technically possible: instead of doing nothing, a drag starting in blank space next to text (e.g. "NYU v2.") should snap its selection to the nearest text — starting from the end of the preceding line when dragging down, or ending there when dragging up.

This is not new territory. `deferred-work.md` documents **four prior attempts** at column-aware/snap text selection, all built and reverted (`03d471b`, `a294ca9`), plus a **hard Chromium blocker** (Story 3.8: `caretRangeFromPoint`/`caretPositionFromPoint` return corrupt results mid-drag once the page's text layer has had any prior interaction). The most recent evaluation (Story 4.2 Part B, 2026-07-02) explicitly deferred a fifth attempt without a dedicated prototyping spike, naming the exact escape routes still untested: (a) resolve the anchor position **once**, not continuously mid-drag (AE3-7, never validated), or (b) a manual `Range` + `getClientRects()` binary search that avoids the caret-API family entirely (also never validated).

The user's ask is narrower than what those four attempts tried: it needs a **single anchor resolution at gesture start**, not continuous column-aware tracking through an active cross-column drag. That distinction is the basis for treating this as a new, boundable spike rather than a re-open of the discarded controller.

Separately, the user asked for a structural-refactor pass over Epic 8's code (OOP unification, reduced conditional sprawl), matching the precedent already set by Story 5.0/5.3/5.4 (Epic 2/5-era refactor) and Story 6.8 (the Epic 6 Library refactor) — a per-epic cleanup story on its own footing, no behavior change.

## Section 2: Impact Analysis

- **Epic Impact:** Epic 8 ("Reader & annotation polish, round 2") gains two more stories (8.9, 8.10), its third broadening via correct-course (following the original 2026-07-07 creation and the 2026-07-11 broadening). No epic re-scoping beyond adding these two stories; the epic's charter blockquote is updated to note the addition.
- **Story Impact:**
  - New **Story 8.9** — investigation-first spike into snapping an empty-space-origin drag to the nearest text, gated on live-smoke validation, explicitly allowed to end in a documented negative result (mirrors Story 8.7's and Story 4.2 Part B's precedent for investigation-first / design-gated stories).
  - New **Story 8.10** — Epic 8 structural refactor, same footing as Stories 5.0/5.3/5.4/6.8. Sequenced *after* 8.9 so its scope reflects whatever code 8.9 actually adds (or doesn't).
  - `epic-8-retrospective` slot in `sprint-status.yaml` shifts to after 8.10.
- **Artifact Conflicts:** `epics.md` (Epic 8 section) and `sprint-status.yaml` (development_status block) need the two new entries. No PRD change: neither story commits to a new FR yet (8.9's FR, if any, is deferred to its own create-story per the 8.2-8.4 precedent of assigning FRs only once a design is committed). No architecture-spine change yet — a validated 8.9 outcome would earn a new AD in its own create-story, not here.
- **Technical Impact:** None yet — both are planning-only additions. Story 8.9 carries real technical risk (the caret-API corruption is a hard, previously-blocking browser bug); the proposal manages that risk by framing 8.9 as a spike with an explicit "discard is a valid outcome" gate, not a committed build.

## Section 3: Recommended Approach

**Direct Adjustment** — add both stories to the existing Epic 8 backlog. No rollback, no MVP re-scope; this is additive backlog growth on an already-in-progress epic, the same shape as its two prior broadenings.

- **Effort:** 8.9 is a spike (bounded prototyping + live smoke, budgeted to end in "discard" as a valid outcome) — small if it fails fast, moderate if a technique validates and a narrow implementation follows. 8.10 is a focused refactor pass scoped to Epic 8's own touched files (`render/textSelection.ts` primarily, plus the Bank filter/sort view-state), same size class as Story 6.8.
- **Risk:** 8.9's technical risk is real and named (Story 3.8's browser bug); mitigated by requiring live-smoke validation across *repeated* drags in one session (not a fresh-load-only test, which would falsely pass) before any implementation commitment. 8.10 carries the low, well-precedented risk of any pure-refactor story (5.0/5.3/5.4/6.8 all shipped clean).
- **Timeline:** both sequenced after 8.8 closes; 8.9 before 8.10 (refactor scope should reflect 8.9's actual outcome, matching how Story 6.8 ran after all of Epic 6's feature stories landed).

## Section 4: Detailed Change Proposals

### `epics.md` — Epic 8 charter blockquote (line ~1916)

**OLD** (final sentence of the existing blockquote):
> Story 8.1 (paragraph-aware copy) is kept verbatim; 8.2–8.8 are the new polish/defect stories. New reader FRs: FR-23 (Bank filter), FR-24 (Bank sort), FR-25 (comment on a region). Sequenced post-v1.

**NEW** (appends a sentence):
> Story 8.1 (paragraph-aware copy) is kept verbatim; 8.2–8.8 are the new polish/defect stories. New reader FRs: FR-23 (Bank filter), FR-24 (Bank sort), FR-25 (comment on a region). Sequenced post-v1. **Broadened again 2026-07-12 via correct-course** (`sprint-change-proposal-2026-07-12-epic-8-snap-select-refactor.md`): Story 8.9 spikes a snap-to-nearest-text UX for the Story 8.8 empty-space-origin case (investigation-first, may end in a documented discard); Story 8.10 is the epic's structural-refactor pass, same footing as Stories 5.0/5.3/5.4/6.8, sequenced last.

**Rationale:** keeps the epic's own history self-documenting, consistent with how the two prior broadenings were recorded in the same blockquote.

### `epics.md` — new Story 8.9 and Story 8.10 sections (inserted after Story 8.8, before Epic 9)

See the full story text applied directly to `epics.md` (below, Section 4 continues in the file itself — story drafts were reviewed and approved in conversation before this proposal was finalized).

### `sprint-status.yaml` — `development_status` block

**OLD:**
```yaml
  8-8-empty-space-drag-no-select: review
  epic-8-retrospective: optional
```

**NEW:**
```yaml
  8-8-empty-space-drag-no-select: review
  8-9-snap-empty-space-drag-to-text: backlog
  8-10-epic-8-structural-refactor: backlog
  epic-8-retrospective: optional
```

**Rationale:** `epic-8-retrospective` stays last; the two new stories slot in execution order ahead of it, matching every other epic's convention in this file.

## Section 5: Implementation Handoff

**Scope classification: Moderate.** This is backlog reorganization on an already-in-progress epic — two new story specs added to `epics.md`, `sprint-status.yaml` updated to match. No PRD rewrite, no architecture-spine edit (a validated 8.9 outcome earns its own AD at create-story time, not here).

- **Routed to:** Developer (via `bmad-create-story` → `bmad-dev-story`) for both stories once picked up from backlog. Story 8.9 explicitly starts with the spike/live-smoke gate before any implementation commitment — do not skip straight to a build.
- **Deliverables:** this Sprint Change Proposal + the `epics.md`/`sprint-status.yaml` edits (applied in this same change).
- **Success criteria:** `epics.md` Story 8.9/8.10 sections read as complete, create-story-ready specs (story statement, ACs, scope guards, open design calls) in the same shape as the existing Epic 8 stories; `sprint-status.yaml` shows both as `backlog` with `epic-8-retrospective` still last; no other epic/story/FR/architecture content disturbed.
