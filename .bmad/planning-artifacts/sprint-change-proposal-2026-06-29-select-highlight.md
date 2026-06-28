# Sprint Change Proposal — Selectable highlights + single-click tool switch

- **Date:** 2026-06-29
- **Author:** Wonseok (via correct-course)
- **Epic:** 2 (in-progress) — Story 2.3 done
- **Mode:** Incremental
- **Scope classification:** Moderate (backlog reorganization; no replan)
- **Trigger:** two design gaps surfaced during the Story 2.3 live smoke

## Section 1 — Issue Summary

Two distinct gaps found while exercising the shipped highlight tool on the real host:

1. **Single-click tool switch is broken.** Clicking the cursor/selection button in the rail while the highlight tool is armed opens the tool sub-toolbox (quick-box) instead of switching `activeTool` back to cursor in one click. Root cause is the same orthogonal `mode` + `armedTool` split that Story 2.4 already exists to replace with one `activeTool` FSM — but no AC pinned this exact symptom, so the FSM rebuild could pass review while still mishandling the rail-click case.

2. **Highlights are not selectable.** After creating a highlight there is no way to select it to recolor or delete it. Recolor plumbing already exists (`recolorAnnotation` + `ColorSwatchRow` from 2.3); there is no delete path and no selection state at all. Epic 3 Stories 3.1 (select/edit) and 3.3 (delete) silently assume a "selected annotation" exists, but nothing builds the hit-test + selected-state seam, and they assume cursor-mode drag-handle selection rather than the cross-mode click-select the user wants.

## Section 2 — Impact Analysis

- **Epic impact:** Epic 2 only. Epic 3 (3.1/3.3) is clarified, not restructured.
- **Story impact:**
  - Story 2.4 gains one AC (single-click switch). No renumber.
  - New Story 2.5 "Select a highlight (click-select, recolor, delete)" inserted right after the FSM.
  - Tail renumbered: old 2.5–2.11 → 2.6–2.12 (number = execution order).
- **PRD impact:** none. FR-15 (edit) and FR-17 (delete) already cover this; the work is within the Phase-1 annotator MVP. FR coverage map annotated to show the Epic-2 slice.
- **Artifact conflicts resolved here:** `epics.md`, `sprint-status.yaml`, `ARCHITECTURE-SPINE.md` (AD-11 note + new AD-12), `EXPERIENCE.md` (IP-6).
- **Technical impact:** new client-side `selectedId` UI state in `store/`, a hit-test in `annotations/` against page-normalized rects (AD-4), and a client delete action. No anchor/contract change. Persistence + undo stay deferred to Epic 3 (AD-9 layering preserved).

## Section 3 — Recommended Approach

**Direct Adjustment** (chosen): add the AC to 2.4 and insert one new Epic-2 story for the selection seam + lightweight recolor/delete; keep heavy move/resize/retext in 3.1.

Rejected alternatives:
- *Amend 3.1/3.3 only* — buries the selection seam in backlog-late stories and leaves Epic-2 highlights uneditable.
- *Rollback / MVP review* — not warranted; no completed work is wrong, no scope is being cut.

Sequencing: 2.5 (selection) lands right after 2.4 (FSM) because cross-mode click-select depends on the single `activeTool` model, and it is the user's active request. Arm-time color pick moves to 2.6.

Effort: small. Recolor exists; delete + selection are a thin client slice. Risk: low (no contract/anchor/persistence change).

## Section 4 — Detailed Change Proposals

### Story 2.4 (epics.md) — ADD AC

> **Given** the tool rail **When** I click any tool button **Then** `activeTool` switches to it in a single click and the rail reflects it immediately; a tool's quick-box opens only when that tool is already active or on drag-release, never in place of the switch — so clicking cursor/selection while highlight is armed switches to cursor in one click and does NOT open a sub-toolbox (AD-11; fixes the Story 2.3 live-smoke single-click-switch issue)

### Story 2.5 (epics.md) — NEW "Select a highlight (click-select, recolor, delete)"

Click-select in cursor mode OR while a highlight tool is active → single selection via `selectedId`, hit-tested against page-normalized rects (AD-4, recent-wins); recolor (reuse 2.3 swatch row) + delete affordance + `Del`/`Backspace`; delete removes the mark and its `group_id` siblings; client-side only, persistence/undo deferred to Epic 3. **Scope guard:** no drag-handle move/resize/retext (those stay in 3.1).

### sprint-status.yaml — renumber

```
2-4-unify-tool-state-fsm
2-5-select-highlight-recolor-delete   (NEW)
2-6-arm-time-color-pick               (was 2-5)
2-7-underline-text                    (was 2-6)
2-8-pen-freehand                      (was 2-7)
2-9-textbox-memo                      (was 2-8)
2-10-comment-highlight-pin-bubble     (was 2-9)
2-11-box-select-a-region              (was 2-10)
2-12-drag-to-change-tool-quick-box    (was 2-11)
```

### ARCHITECTURE-SPINE.md

- AD-11: added the single-click-switch rule.
- AD-12 (NEW) — Annotation selection model: a single nullable `selectedId` in `store/` as the source of truth; hit-test via anchor rects (AD-4, recent-wins); decoupled from the Epic-3 command stack; `annotations/` renders the affordance, `render/` is unaware.

### EXPERIENCE.md — IP-6 amended

Split lightweight click-select + restyle/recolor + delete (Story 2.5) from heavy drag-handle move/resize + text re-edit (Story 3.1).

## Section 5 — Implementation Handoff

- **Scope:** Moderate → Product Owner / Developer.
- **Deliverables:** this proposal + the applied epics/sprint/spine/experience edits.
- **Next step:** `bmad-create-story 2-4` (FSM, fixes single-click switch), then `2-5` (selection). Run each in a fresh context window.
- **Success criteria:** 2.4 ships the FSM with the single-click-switch AC verified; 2.5 makes a highlight click-selectable in both modes with working recolor + delete, no anchor/contract change.
