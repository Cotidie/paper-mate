# Sprint Change Proposal: Library layout redesign doc sync

**Date:** 2026-07-05
**Trigger:** Ad-hoc user-requested Library page layout redesign, brainstormed/planned/implemented outside the formal BMad story pipeline (superpowers brainstorming → writing-plans → executing-plans, on branch `story-6-4-bulk-upload-optimistic-rows`), landing after Story 6.4 (`bulk-upload-optimistic-rows`, status `done`).

## 1. Issue Summary

Immediately after Story 6.4 shipped, the user requested a Library page redesign referencing an external app (Anara): remove the fixed top bar entirely, move the collection count and Add control into one toolbar row inside the main pane, redesign Add into a dropdown (`File upload` / `Folder upload`), restyle the left folder panel (a `LIBRARY` caption, `All` as a selected-nav pill), and show the app version at the bottom of the left panel. This was implemented in 4 commits (`6f38dd5`, `8141177`, `e70ba3b`, plus the version-display commit `6f38dd5`) with full test coverage (921 client tests, 97 backend tests, typecheck clean) and live-smoked in a real browser.

The implemented UI now diverges from what `epics.md` specifies for Epic 6's Library shell: `epics.md` still describes a "fixed top bar (48px, hairline bottom) carrying app identity + an Add/upload action + the collection count," and Story 6.1's acceptance criteria (already `done`) literally asserts that top bar. No BMad story was created for this redesign — it was reviewed and approved directly with the user in-session, not via `bmad-create-story`/`bmad-dev-story`.

**Category:** Documentation/planning-artifact drift from an out-of-process UX iteration (closest fit to the checklist's "new requirement emerged from stakeholder," but the requirement has *already shipped* — this proposal is a doc-sync, not a forward plan).

**Evidence:**
- `epics.md:1235` (L-UX-DR1), `epics.md:1239` (L-UX-DR5), `epics.md:1318` (Story 6.1 AC) describe the removed top bar.
- Actual code: `client/src/library/LibraryPage.tsx`, `LibraryPage.css`, `AddMenu.tsx` (new), `AddMenu.css` (new) — no `<header>`/top-bar markup remains.
- Live-smoke screenshots taken this session confirm the new layout matches the approved design mockups (`.superpowers/brainstorm/462178-1783232562/content/sidebar-direction.html`, `add-dropdown.html`) and the written design spec (`docs/superpowers/specs/2026-07-05-library-layout-redesign-design.md`).

## 2. Impact Analysis

### Epic impact
Epic 6 ("The library becomes home") is **unaffected structurally** — no story added, removed, reordered, or rescoped. Story 6.1 (`done`) and Story 6.4 (`done`) remain complete; their *descriptive* text just needs to track what was actually built, since a later out-of-band UI pass changed the shell they described.

### Story impact
- **Story 6.1** (`router-flip-library-shell`, done): its acceptance criterion at `epics.md:1318` needs its shell description corrected (top bar → no top bar; folder panel + toolbar row; and its named empty-state copy `"No papers yet."` corrected to the current `EmptyDropzone` copy `Drop PDFs here` / `or browse…`, since that text is what the AC's own referenced empty-state actually renders now).
- **Story 6.4** (`bulk-upload-optimistic-rows`, done): unaffected functionally (concurrency cap, optimistic rows, whole-region drop target all still work exactly as specified) — no AC text changes needed for 6.4 itself.
- **No other Epic 6 or Epic 7 story** references the top bar or the Add-button location in a way this redesign breaks; Stories 6.5–6.7 and Epic 7 (7.1–7.6) describe extraction, inline edit, folders, sort/filter, and trash — all orthogonal to shell chrome.

### Artifact conflicts
- **PRD** (`prd-paper-mate-library-2026-07-04/prd.md`): no conflict — its "Add papers" section (F2) is functional/goal-level, doesn't specify a top bar.
- **Architecture** (`ARCHITECTURE-SPINE.md`, library spine): no conflict — AD-L1..AD-L7 are data/API-layer decisions, not layout.
- **UX/UI (`epics.md`)**: 3 lines need correction (detailed in Section 4).
- **`docs/API.md`, `server/openapi.json`**: no conflict — this was a pure-client redesign, no `/api` surface change.
- **`DESIGN.md`**: no conflict requiring action in this pass — Library isn't a per-component DESIGN.md catalog entry (its frontmatter already flags Phase-2 surfaces as "not yet styled" and generic-token-only), and no new token or component *type* was introduced (the new `AddMenu` composes existing tokens/patterns, same as `CollectionTable`/`EmptyDropzone` did without their own DESIGN.md catalog entries).

### Related drift discovered, NOT part of this proposal's edits (flagged for a separate decision)
While scanning `epics.md` for this redesign's impact, two **pre-existing, unrelated** drifts surfaced — both predate this redesign (from Story 6.3/6.4) and are left untouched here since they're outside what was requested:
1. `epics.md:1245` (L-UX-DR11) and `epics.md:1384` (Story 6.3 AC) both still say the empty state shows `"No papers yet."` — that copy was replaced by `EmptyDropzone`'s `Drop PDFs here` in Story 6.4, several stories before this redesign.
2. `epics.md:1299` (Epic 6 summary) and `epics.md:1236` (L-UX-DR2) say "double-click any row" / "double-click a row opens the reader" — Story 6.3's own code-review round 2 replaced double-click with click-to-select-then-click-to-open, per that story's Dev Agent Record.

Recommend a small follow-up correct-course (or a quick direct edit) to clean these up, since they're the same class of issue. Not touched in this proposal to keep scope matched to what was requested.

### Technical impact
None. No code changes result from this proposal — implementation is already done, tested, and committed. This proposal only updates planning documents.

## 3. Recommended Approach

**Option 1: Direct Adjustment.** Correct the 3 stale `epics.md` lines to describe the shipped layout. No rollback (the new layout is the intended, approved result — nothing to revert). No PRD/MVP scope change (redesign is a chrome-level UI change, not a scope or requirements change).

- Effort: Low (3 targeted text edits, already drafted below).
- Risk: Low (documentation-only; no code, no tests affected).

## 4. Detailed Change Proposals

### `epics.md` — L-UX-DR1 (line 1235)

**OLD:**
> - **L-UX-DR1 Library page layout (route `/`, the boot landing)**: a fixed top bar (48px, hairline bottom, `{component.top-bar}`) carrying app identity + an Add/upload action + the collection count; a left **folder panel** (hairline-bounded `{colors.surface-card}` column, ~280px, `{component.toc-panel}` width class); a main region hosting the collection table on the `{colors.reader-backdrop}` floor. Desktop-only; token-driven; nothing reflows on control open.

**NEW:**
> - **L-UX-DR1 Library page layout (route `/`, the boot landing)**: no top bar. A left **folder panel** (hairline-bounded `{colors.surface-card}` column, ~280px, `{component.toc-panel}` width class) shows a `LIBRARY` caption label, `All` as a selected-nav-item pill, and the app version pinned to the bottom. A main region hosts the collection count and an Add control together in one toolbar row above the table, on the `{colors.reader-backdrop}` floor. Desktop-only; token-driven; nothing reflows on control open.

**Rationale:** Matches the shipped shell (`LibraryPage.tsx`/`.css`); the top bar was removed, the count/Add row moved into the main pane, and the folder panel gained the label/pill/version chrome.

### `epics.md` — L-UX-DR5 (line 1239)

**OLD:**
> - **L-UX-DR5 Bulk upload affordance**: accept **one or more PDFs at once** via a drag-drop zone + a browse button. When the collection is empty, reuse `{component.empty-dropzone}` ("Drop PDFs here" / "or browse…"); when non-empty, a compact Add control in the top bar. Dropping N files streams N optimistic rows into the table immediately.

**NEW:**
> - **L-UX-DR5 Bulk upload affordance**: accept **one or more PDFs at once** via a drag-drop zone + a browse button, or via the Add control's dropdown (`File upload` / `Folder upload`, the latter recursing a chosen directory and silently skipping non-PDFs). When the collection is empty, reuse `{component.empty-dropzone}` (`Drop PDFs here` / `or browse…`); when non-empty, the Add control sits in the main-pane toolbar row next to the collection count. Dropping N files (anywhere in the main region) streams N optimistic rows into the table immediately.

**Rationale:** The Add control moved out of the (now-removed) top bar into the toolbar row, and gained the File-upload/Folder-upload dropdown (`AddMenu.tsx`) this redesign added.

### `epics.md` — Story 6.1 Acceptance Criteria (line 1318)

**OLD:**
> **Given** the Library route at rest with no collection data yet
> **Then** it renders a Library shell from DESIGN.md tokens (no inline hex/px): a 48px hairline-bottom top bar with app identity + an Add affordance, a left folder-panel region, and a main region on `{colors.reader-backdrop}` showing the empty-collection copy "No papers yet." (L-UX-DR1, L-UX-DR11)

**NEW:**
> **Given** the Library route at rest with no collection data yet
> **Then** it renders a Library shell from DESIGN.md tokens (no inline hex/px): a left folder-panel region and a main region on `{colors.reader-backdrop}` showing the empty-collection dropzone copy `Drop PDFs here` / `or browse…` (L-UX-DR1, L-UX-DR11)

**Rationale:** No top bar remains; and since this AC's own empty-state clause is being corrected, its copy reference is updated in the same edit to match `EmptyDropzone`'s actual copy (the `"No papers yet."` string was already dead code since Story 6.4, see the flagged-but-unfixed drift above — this one instance is fixed here only because it's the exact clause this edit touches).

## 5. Implementation Handoff

**Scope classification: Minor.** Pure documentation correction, no code/story/epic restructuring. No PO/PM/Architect involvement needed.

**Handoff:** Developer agent (or direct edit) applies the 3 changes above to `.bmad/planning-artifacts/epics.md`. No `sprint-status.yaml` change needed (no epic/story added, removed, or renumbered; Stories 6.1 and 6.4 remain `done`).

**Success criteria:** `epics.md`'s Library-page description matches the shipped `LibraryPage`/`AddMenu` implementation; no other planning artifact requires a corresponding change.
