# Sprint Change Proposal: Add Venue, Year & DOI columns

**Date:** 2026-07-07
**Trigger:** User request mid-Epic-7 (after the 7-7/7-8 addition, while iterating on Library table polish): add three new collection-table columns, **Venue**, **Year** (published year), and **DOI**.

## 1. Issue Summary

The library table (Story 6.3 / 7.4) shows Title, Authors, Added, File type. The user wants three more bibliographic columns so papers can be scanned and sorted by where and when they were published, and opened at their DOI:

1. **Venue** (journal / conference / container title).
2. **Year** (published year).
3. **DOI**.

**Category:** Forward scope addition (one new story). No shipped/`done` story reopened. Net-new: not in the original Library PRD/epics.

**Two decisions taken with the user before routing (AskUserQuestion, 2026-07-07):**

- **Route as a BMad story** (not an inline ad-hoc change) — it changes the persisted `meta.json` schema, the OpenAPI/`CollectionRow` contract, and the Crossref enrich step, which is story-shaped work like Story 7.4 (columns) and 6.6 (inline-edit), not CSS-only polish.
- **Crossref, new imports only** — Venue/Year come from the existing Crossref enrichment (`work["container-title"]` = Venue, `work["issued"]`/`published` date-parts year = Year); DOI is already extracted into `ExtractedMeta` but never persisted. New and re-imported papers populate; the existing library's papers stay blank until re-added (no backfill/re-enrich pass this story).

**Evidence / grounding (verified against current code):**
- `ExtractedMeta` (`server/app/models.py`) carries `title`, `authors`, `doi` — but **no** `venue`/`year`, and `DocMeta` persists **none** of `doi`/`venue`/`year` today (the enrich `doi` is computed then dropped). So all three need new model fields.
- `crossref._meta_from_work` (`server/app/domain/crossref.py:64`) builds `ExtractedMeta(title, authors, doi)` from the raw Crossref `work` dict, which also contains `container-title` and `issued`/`published` — currently unused. Extending capture there is additive, no new dependency.
- The collection table's client column model is a pure, extensible list: `COLUMNS` in `client/src/library/tableView.ts` (Story 7.4), consumed by `CollectionTable`/`PaperRow` and the `DisplayMenu` hide/show. Adding columns is additive there.
- `_cache_from_meta` (`server/app/storage/library_index.py:90`) is the single display-cache projection point; `CollectionRow` (`server/app/models.py:174`) is the additive-field surface (the `filename`/`last_opened` precedent).

## 2. Impact Analysis

### Epic impact
Epic 7 stays **in-progress**; story count grows from 8 to 9 (adds Story 7.9). No other epic touched (Epic 8 sync deferred, unaffected).

### Story impact
- **Story 7.9 (Venue / Year / DOI columns):** NEW. Full-stack: additive `DocMeta`/`ExtractedMeta` fields, a Crossref-capture extension, `CollectionRow` + `_cache_from_meta` surfacing, and three client columns (sortable + hideable). Medium.
- **Stories 7.1-7.8 (done / backlog):** unaffected. 7.9 builds on Story 7.4's column model and Epic 6's extraction domain additively.
- **Note (sequencing):** Story 7.9 touches the same `CollectionRow` contract as 7.7 (Recent, `last_opened`) and 7.8 (Starred, `starred`). Whichever lands first, the others rebase onto the regenerated schema — all three changes are additive, non-conflicting fields.

### Artifact conflicts / updates
- **`epics.md`:** new LFR-32 (Venue/Year/DOI columns, Crossref-sourced, new-imports-only); FR Coverage Map adds LFR-32 → Epic 7; Epic 7 LFR-coverage line updated; Story 7.9 section added with full ACs. **(done in this proposal.)**
- **`sprint-status.yaml`:** add `7-9-venue-year-doi-columns: backlog`, update `last_updated`. **(done in this proposal.)**
- **PRD** (`prd-paper-mate-library-2026-07-04`): net-new, not in the PRD; annotated on the epics.md LFR as a 2026-07-07 correct-course addition. Optional backfill, not blocking.
- **Architecture** (library spine): no new decision. Reuses AL-1 (meta + display cache), AL-2 (extract/enrich domain, Crossref behind a port), AL-6 (additive contract), AL-8 (regenerated types). No spine edit.
- **Contract:** `DocMeta`/`CollectionRow` gain `doi`/`venue`/`year`; regenerated at implementation time (`export_openapi` + `gen:api`), `docs/API.md` updated then, not now.

### Technical impact (deferred to create-story, captured here)
- **Model:** `ExtractedMeta` += `venue: str | None`, `year: int | None`. `DocMeta` += `doi: str | None = None`, `venue: str | None = None`, `year: int | None = None` (additive, no `schema_version` bump; existing `meta.json` validates via defaults).
- **Extraction:** `crossref._meta_from_work` captures `container-title[0]` → venue and the first available `issued`/`published-print`/`published-online`/`published` `date-parts[0][0]` → year. The route projection (extract → enrich → `DocMeta`) writes doi/venue/year through. PDF-side `extract()` stays as-is (doi regex already exists; venue/year come from Crossref).
- **Surface:** `_cache_from_meta` projects doi/venue/year; `CollectionRow` exposes them.
- **Client:** `tableView.ts` `COLUMNS` gains `venue`, `year`, `doi` (sortable; hideable — Title stays non-hideable), with `sortKey` branches (year numeric, venue/doi string; empty sorts last per existing `compareForSort`) and new width tokens in `components.css`; `PaperRow` renders each cell; `DisplayMenu` picks them up automatically.

## 3. Recommended Approach

**Direct Adjustment** (add one story). No rollback, no MVP re-cut.

- **Add Story 7.9** as the next Epic-7 story, building additively on Story 7.4's column model and Epic 6's Crossref enrich.
- **Crossref new-imports-only** (user decision): no backfill of the existing library this story. A backfill/re-enrich pass over already-imported papers is a possible follow-up, out of scope here.

**Rationale:** the column model and the Crossref domain are both already the right shape for additive extension; the change touches no `done` story's behavior and no architectural decision. Risk is low and contained to the extraction capture + the additive contract fields.

**Effort:** medium (a full-stack additive slice: 3 model fields + a Crossref-capture extension + 3 client columns; no new endpoint, no migration).

### Open design decisions for create-story
- **DOI cell:** a clickable `https://doi.org/{doi}` link (must not also trigger the row's open/arm gesture, like the Title Open button) vs plain muted text. Recommend a link that `stopPropagation`s.
- **Default visibility:** DOI may be hidden by default (revealed via the Display menu) to keep the default table uncluttered; Venue/Year visible by default. Story-writer/dev's call.
- **Year type:** `int | None` (clean numeric sort) vs the raw issued string. Recommend `int`.
- **Inline-edit:** display-only this story (Venue/Year/DOI not inline-editable); extending `useInlineEdit`/`DocPatch` to them is a possible follow-up, out of scope.

## 4. Detailed Change Proposals

All edits below are **already applied** to the planning artifacts in this proposal.

### `epics.md`
- **Library Functional Requirements:** added **LFR-32** (Venue/Year/DOI columns, Crossref-sourced container-title + issued year, new-imports-only; DOI persisted from the existing extraction), annotated as a 2026-07-07 correct-course addition not in the original Library PRD.
- **FR Coverage Map:** added **LFR-32 → Epic 7**.
- **Epic 7 header:** LFR-coverage line updated to add LFR-32.
- **Story 7.9 (Venue / Year / DOI columns):** added, full ACs.

### `sprint-status.yaml`
- Added `7-9-venue-year-doi-columns: backlog`.
- Updated `last_updated`.

## 5. Implementation Handoff

**Scope classification: Moderate** (one net-new story; no `done` work reopened; no architectural change).

**Route to:** `bmad-create-story` for **Story 7.9** (in a fresh context window per the repo's one-workflow-per-context rule), then `bmad-dev-story` on a `story-7-9-*` branch.

**Success criteria:**
- New/re-imported papers with a Crossref match show Venue, Year, and DOI; papers without a match (or imported before this story) show those cells blank.
- The three columns are sortable and hideable via the Display menu (Title stays non-hideable); Year sorts numerically.
- Contract regenerated, `docs/API.md` updated, no em-dash in new copy, tests + typecheck green, live-smoked on fresh servers at DPR>1, cross-model Codex review, version PATCH bump at `done`.

**Not in scope (explicitly):** backfilling/re-enriching the existing library; inline-editing Venue/Year/DOI; any Crossref capture beyond container-title/issued.
