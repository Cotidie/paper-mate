# Sprint Change Proposal: Drop Note file-type, add Recent + Starred views

**Date:** 2026-07-07
**Trigger:** User scope change mid-Epic-7, after Story 7.5 (Trash) merged (PR #56, `done`). The user dropped the last backlog story (7.6, Note file-type) and requested two new Library curation features in its place: a **Recent** view and **Starred** papers.

## 1. Issue Summary

Epic 7 ("Organize & curate the collection") had one story left in backlog: **Story 7.6, Note file-type (reserved and displayed)** (LFR-17). While reviewing the shipped Library, the user decided notes are not wanted this sprint and asked to:

1. **Discard Story 7.6** (Note file-type).
2. **Add a Recent view**: selecting the left-panel `Recent` entry lists recently-opened papers, most-recent-first, tracking the last 50.
3. **Add Starred papers**: a Star toolbar action (in the same row as Add / Move / Delete) that toggles a star on the selection; a starred paper shows a filled-star icon at the end of its title (Google-Drive style: appended when there is room, holding its own space so the title truncates first when there is not); the left-panel `Starred` entry lists all starred papers.

Both new features light up the two **inert placeholders** (`Recent`, `Starred`) that Story 7.1 shipped disabled in `FolderPanel`, completing the fixed Library section (`All` / `Recent` / `Uncategorized` / `Starred` / `Trash`).

**Category:** Forward scope change (drop one backlog story, add two). No shipped/`done` story is reopened. Requirement is net-new (not in the original Library PRD).

**Evidence / grounding (verified against current code):**
- `last_opened` already exists in `DocMeta` (`server/app/models.py:66`) and is already advanced on open via `POST /api/docs/{id}/open` → `storage.touch_last_opened` (Story 6.7). Recent needs the timestamp **surfaced on `CollectionRow`** (not currently there) and a client lens; no new persistence.
- No `starred` field exists anywhere in `server/app/`. Starred is net-new org state, structurally identical to `trashed` (library.json org flag + set-based endpoint + serialized write).
- `Recent` and `Starred` are already rendered as `aria-disabled` placeholders in `client/src/library/FolderPanel/FolderPanel.tsx`.
- The toolbar bulk-action pattern (button enabled on a selection, acting over `{doc_ids}`) was just established for Restore/Purge in Story 7.5; the Star button reuses it exactly.

## 2. Impact Analysis

### Epic impact
Epic 7 stays **in-progress**; its story count changes from "6 stories, 5 done + 1 backlog" to "8 stories, 5 done + 1 descoped + 2 backlog." Epic scope prose, LFR-coverage line, and goals are updated. No other epic touched. Epic 8 (sync, deferred) unaffected.

### Story impact
- **Story 7.6 (Note file-type):** descoped. Never attempted (no story file, no code). The reserved `file_type: "note"` enum value from Epic 6 stays in the model, but nothing displays or creates a note this sprint. Marked `blocked` in `sprint-status.yaml` (the repo's descope convention, same as Stories 4.3 / 5.2 / 5.7) so Epic 7 can still reach `done`. LFR-17 defers to a future notes epic.
- **Story 7.7 (Recent view):** NEW. Mostly a client view-state lens (like the Trash lens) + one additive contract field (`last_opened` on `CollectionRow`). Small/medium.
- **Story 7.8 (Star / unstar papers):** NEW. Full-stack, mirrors Story 7.5 (Trash) structurally: new `starred` org flag in `library.json`, a set-based `POST /api/library/star` / `unstar`, a toolbar Star button, a filled-star title affordance, and a Starred lens. Medium/large.
- **Stories 7.1–7.5 (done):** unaffected. 7.7/7.8 build on their seams (folder-panel lens selection, `FolderSelection` discriminated union, `filterPapers`, the toolbar bulk-action row) additively.

### Artifact conflicts / updates
- **`epics.md`:** Library FR inventory (new `F9` group, LFR-30/31), FR Coverage Map (LFR-17 descoped, LFR-30/31 added), UX Design Requirements (new L-UX-DR14/15), Epic 7 header prose + LFR-coverage line, Story 7.6 marked descoped, Stories 7.7 + 7.8 added. **(done in this proposal.)**
- **`sprint-status.yaml`:** 7-6 → `blocked`, add 7-7-recent-view + 7-8-starred-papers `backlog`, `last_updated`. **(done in this proposal.)**
- **PRD** (`prd-paper-mate-library-2026-07-04`): Recent + Starred are net-new, not in the PRD. Left as-is; the epics.md `F9` group is annotated "not in the original Library PRD." A PRD backfill is optional and not required to proceed (create-story reads epics.md).
- **Architecture** (`ARCHITECTURE-SPINE.md`, library spine): no new architectural decision needed. Starred reuses AL-5 (org lifecycle) / AL-6 (set-based `/api/library` endpoints) / AL-7 (serialized write); Recent reuses AL-1 (last_opened in meta + display cache) / AL-3 (view-state lens). No spine edit required.
- **Contract (`server/openapi.json`, `client/src/api/schema.d.ts`, `docs/API.md`):** both new stories add fields to `CollectionRow` (`last_opened`, `starred`) and Starred adds two endpoints, regenerated at implementation time, not now.

### Technical impact (deferred to implementation, captured for create-story)
- **Recent** is additive: expose `last_opened` on `CollectionRow`, add `{ kind: "recent" }` to `FolderSelection`, a `filterPapers`/ordering branch (sort by `last_opened` desc, slice 50), and flip the `Recent` placeholder to a real button.
- **Starred** mirrors Trash: `starred` in the library index + `CollectionRow`, `star_papers`/`unstar_papers` in `library_index.py` (serialized), `POST /api/library/star` + `/unstar`, a `useStarPapers` hook (optimistic, mirrors `useTrashPapers`), a toolbar Star button, a `{ kind: "starred" }` lens, and the filled-star Title-cell affordance (renders in every lens, not just Starred).

## 3. Recommended Approach

**Direct Adjustment** (add/modify stories within the existing plan). No rollback, no MVP re-cut.

- **Discard 7.6** via the repo's established descope convention (`blocked` in sprint-status, section kept + marked DESCOPED in epics.md), not a hard delete; this preserves LFR-17 traceability and is trivially reversible if notes return.
- **Add 7.7 (Recent) then 7.8 (Starred)** as the remaining Epic-7 work, in that order (Recent is smaller and lower-risk; Starred is the full-stack one).

**Rationale:** Both features are pure additions over stable, shipped seams (the Trash story proved the exact org-flag + lens + toolbar-bulk-action pattern Starred needs; the folder/trash lenses proved the view-state pattern Recent needs). Neither touches a `done` story's behavior. Risk is low and contained to Epic 7's own surface.

**Effort estimate:** 7.7 small (1 additive contract field + client lens). 7.8 medium (a full Trash-shaped full-stack slice, minus the destructive-purge complexity). **Timeline:** replaces the discarded 7.6 slot; net Epic-7 scope grows by ~1.5 stories' worth of work.

### One open design decision for create-story (Recent semantics)
`last_opened` is currently seeded to `added` at import (a never-opened paper has `last_opened == added`). So "Recent ordered by last_opened" would surface freshly-added-but-never-opened papers too. Two readings:
- **(A) Recent = recently *touched*** (simplest): order all non-trashed papers by `last_opened` desc, cap 50. A never-opened paper sits at its add-time position and falls off the cap as others are opened. No backend change.
- **(B) Recent = recently *opened* only** (truer to "opened"): `last_opened` becomes null-until-first-open (import stops seeding it), and Recent lists only papers with a genuine open. Small backend change + a migration thought for existing papers.

**Recommendation: (A)** for this sprint (no backend semantic change, no migration), revisit (B) only if the never-opened-paper noise proves annoying in live use. Flagged in the Story 7.7 ACs; the story-writer/dev makes the final call.

## 4. Detailed Change Proposals

All edits below are **already applied** to the planning artifacts in this proposal.

### `epics.md`
- **Library Functional Requirements:** added group **F9 · Recent & Starred views** with **LFR-30** (Recent, last-opened order, cap 50) and **LFR-31** (star/unstar + filled-star title marker + Starred view), annotated as a 2026-07-07 correct-course addition not in the original Library PRD.
- **FR Coverage Map:** LFR-17 marked **(DESCOPED 2026-07-07)**; added **LFR-30 → Epic 7** and **LFR-31 → Epic 7**.
- **UX Design Requirements:** added **L-UX-DR14** (Recent lens: view-state, last-opened desc cap 50, "No recent papers.", real Recent button) and **L-UX-DR15** (Starred lens + filled-star-at-end-of-title affordance + toolbar Star button + "No starred papers.").
- **Epic 7 header (both blurbs):** prose updated (drop "reserve the Note file-type"; add "jump to recently-opened papers, star the ones that matter"); LFR-coverage line updated to add LFR-30/31 and note LFR-17 descoped.
- **Story 7.6:** header marked **DESCOPED from Epic 7 (2026-07-07)** with a note; ACs kept for traceability, tagged "DESCOPED, not built."
- **Story 7.7 (Recent view):** added, full ACs.
- **Story 7.8 (Star / unstar papers):** added, full ACs.

### `sprint-status.yaml`
- `7-6-note-file-type: backlog` → `blocked` (with a descope comment block).
- Added `7-7-recent-view: backlog` and `7-8-starred-papers: backlog`.
- Updated `last_updated`.

### PRD / Architecture / DESIGN.md
- No edits required to proceed (grounded in Section 2). Optional PRD backfill of Recent/Starred noted but not blocking.

## 5. Implementation Handoff

**Scope classification: Moderate** (backlog reorganization: one story dropped, two added; no `done` work reopened; no architectural change).

**Route to:** `bmad-create-story` for **Story 7.7 (Recent view)** first, then **Story 7.8 (Star / unstar papers)**, one at a time, per the repo's create-story-then-dev-story cadence, each on its own `story-7-7-*` / `story-7-8-*` branch off `main`.

**Success criteria:**
- Selecting `Recent` lists the ≤50 most-recently-opened, non-trashed papers, most-recent-first; opening a paper floats it to the top on the next reconcile; empty copy "No recent papers." (LFR-30, L-UX-DR14).
- A toolbar Star button toggles the star of the current selection; starred papers show a never-clipped filled-star at the end of the title in every lens; the `Starred` entry lists them; state persists across restart; empty copy "No starred papers." (LFR-31, L-UX-DR15).
- Both stories: contract regenerated, `docs/API.md` updated, no em-dash in new copy, tests + typecheck green, live-smoked on own fresh servers, cross-model Codex review, version PATCH bumps at `done`.

**Not in scope (explicitly):** in-app note authoring and Note-type display (LFR-17, deferred); any Recent/Starred remote-sync behavior (Epic 8, deferred).
