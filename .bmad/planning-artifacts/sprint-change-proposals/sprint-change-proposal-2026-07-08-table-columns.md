# Sprint Change Proposal: table column reorder + tag-type columns

**Date:** 2026-07-08
**Author:** Wonseok (via bmad-correct-course)
**Scope classification:** Moderate (two new Epic 7 backlog stories; one adds a client-only persistence surface, one changes the API contract + meta.json authors representation; no in-flight work altered)

## Section 1: Issue Summary

Two user feature requests for the collection table (Library):

1. **Persistent column reorder.** "As a reader, I'd like to re-order columns by drag and drop. It should be persistent." Today the columns are a fixed const order (`tableView.ts` `COLUMNS`) in ephemeral view-state; there is no reorder and no persisted table layout.

2. **Tag-type columns, Author first.** With a Notion screenshot: columns should support a "tag" cell type (colored chips), and the Author column should be the first to use it. Today the domain has `ExtractedMeta.authors: list[str]` but storage flattens it to a single joined `DocMeta.authors: str | None`, which the client renders and inline-edits as one string.

## Section 2: Impact Analysis

- **Epic impact:** Both land in the in-progress **Epic 7** (organize & curate the collection), extending Story 7.4's column model. New stories **7.11** and **7.12**. No existing epic status changes.
- **Story impact:** 7.11 (reorder + persisted layout) and 7.12 (Author tag column). Both `backlog`. Sequencing: 7.12 benefits from Story 7.10's decomposition (the cell-type dispatch is exactly 7.10's descriptor seam) and interacts with 7.9 (both touch columns); 7.11 is independent.
- **Artifact conflicts:**
  - `epics.md`: add Stories 7.11, 7.12.
  - `sprint-status.yaml`: register `7-11-reorder-columns-persisted`, `7-12-author-tag-column`.
  - `ARCHITECTURE-SPINE.md` (AD-L1): amended to record that column-layout *preferences* persist client-side in localStorage (distinct from row ordering, which stays unpersisted), without touching the storage-sole-writer invariant.
  - **7.12 is a contract change:** `CollectionRow` gains the authors list (Pydantic to OpenAPI to regenerated TS types), `docs/API.md` updated, and the `meta.json` authors representation gains a first-class list (schema handling is an open design call: additive `authors_list` vs typed migration + `schema_version` bump).
- **Technical impact (when built):**
  - 7.11: client-only. New `localStorage` table-view-prefs store; `COLUMNS` becomes an ordered persisted list threaded through `useTableView`/`useColumnWidths`. No backend/contract change.
  - 7.12: full-stack. Cell-type seam in the table; authors surfaced as a list end-to-end; editable add/remove chips persisting to `meta.json` via the edit path; filter-by-tag integrating with Story 7.4's Filter control. Colors deferred.

## Section 3: Recommended Approach

**Direct adjustment**, two new stories in Epic 7. Confirmed decisions with the user:

- **7.11 persistence scope:** persist column **order + visibility + widths** (NOT sort) in **client-only localStorage** (app-global, one layout). Row ordering unchanged.
- **7.12 data source:** surface authors as a **first-class list** (additive contract change) rather than client-splitting the joined string.
- **7.12 first slice:** **chips + editable + filter**, **no colors yet** (chip style left color-ready).

Risk: 7.11 is moderate (drag UX + a11y + a new persistence surface, but client-only and contract-safe). 7.12 is the larger one (contract + meta.json schema + editable + filter + the cell-type seam); recommend it after Story 7.10 so it builds on the decomposed table + descriptor seam rather than the current 629-line `CollectionTable`.

## Section 4: Detailed Change Proposals

### 4a. `epics.md`: Story 7.11 (reorder columns, persisted layout)

Drag a column header to reorder (plus a keyboard-accessible move); order + visibility + widths restored from a client-only localStorage prefs store on reload; sort stays ephemeral; row order unchanged. Title stays non-hideable (7.4 AC-1); pinned-vs-movable is a create-story call. The prefs store degrades safely on missing/corrupt/older values and ignores unknown column keys (forward-compat). No backend/contract change.

### 4b. `epics.md`: Story 7.12 (Author tag column)

A column `cellType` (text / number / badge / tag) with a dispatch registry (coordinate with 7.10). Author declared `tag`: authors surfaced as a first-class `list[str]` end-to-end (meta.json schema decision + additive `CollectionRow` contract + `_cache_from_meta` projection + `docs/API.md`); each author a chip (uniform token style, color-ready, no colors this slice); editable add/remove persisting to meta.json via the edit path; filter-by-tag as a set-membership match integrating with 7.4's Filter. Em-dash-free UI strings, keyboard-operable.

### 4c. `ARCHITECTURE-SPINE.md`: AD-L1 amendment

Recorded that table column-layout preferences (order/visibility/widths) persist client-side in localStorage, distinct from row ordering (still unpersisted), and outside `library.json`/`meta.json`.

### 4d. `sprint-status.yaml`

Added `7-11-reorder-columns-persisted: backlog` and `7-12-author-tag-column: backlog` (Epic 7 block) with provenance comments. Bumped `last_updated`.

## Section 5: Implementation Handoff

- **Scope:** Moderate. No in-flight work touched; both stories `backlog`.
- **Recipients:** Developer (Wonseok) at the next `bmad-create-story` cycle.
- **Sequencing:** 7.11 anytime. 7.12 recommended after Story 7.10 (cell-type seam builds on the decomposed table) and coordinated with Story 7.9 (both touch columns).
- **Open design calls flagged in the stories:** 7.11 (Title pinned vs movable; drag primitive; prefs schema/key). 7.12 (meta.json authors-list schema handling; DocPatch-widened vs dedicated add/remove endpoint; author-string to list back-compat; sequencing vs 7.10/7.9).
- **Success criteria:** both stories tracked in epics.md + sprint-status; the AD-L1 persistence stance stays honest; 7.12's contract change is captured for the regen discipline; no code touched this round.
