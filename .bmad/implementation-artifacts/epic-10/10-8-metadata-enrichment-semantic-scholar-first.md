# Story 10.8: Prioritize Semantic Scholar over Crossref for metadata enrichment

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a reader,
I want paper metadata (title, year, venue, authors) enriched from Semantic Scholar first, with Crossref as the fallback,
so that my library rows show the correct full title and clean venue instead of the truncated/worse values Crossref sometimes registers.

## Context / Motivation

Live diagnostic on DOI `10.14778/3514061.3514067` (TranAD) exposed a real defect and a source-quality ranking (raw evidence saved at `docs/crossref-10.14778_3514061.3514067.json` + `docs/semantic-scholar-10.14778_3514061.3514067.json`):

| Field | Crossref | Semantic Scholar | Winner |
|---|---|---|---|
| title | `TranAD` (**truncated at the source**) | `TranAD: Deep Transformer Networks for Anomaly Detection in Multivariate Time Series Data` | **S2** |
| year | 2022 | 2022 | tie |
| venue (full) | `Proceedings of the VLDB Endowment` | `Proceedings of the VLDB Endowment` | tie |
| venue (short) | `Proc. VLDB Endow.` (`short-container-title`) | `alternate_names`: `Proc VLDB Endow` / `Proc Vldb Endow` (shortest) | **S2 (per user rule)** |
| author names | `Giuliano Casale`, `Nicholas R. Jennings` (full given) | `G. Casale`, `N. Jennings` (initials) | **S2** for display; Crossref keeps full-given for later |
| detailed authors + references | full author objects, references | not fetched | **Crossref** (reserved for later AI features) |

The current pipeline (`enrich()` -> `CrossrefEnricher` DOI-first) takes Crossref's `titles[0]` verbatim on a DOI hit with **no plausibility gate** (the `_titles_match` Jaccard guard only protects the title-*query* path, not DOI hits), so Crossref's truncated `TranAD` **overwrites** the correct local font-heuristic title. **User decision (2026-07-20): make Semantic Scholar the primary enricher; keep Crossref as the fallback and reserve it for later AI-assisted features (detailed authors, reference graphs).**

## Acceptance Criteria

1. **(S2 primary for the core display fields, LFR-8/LFR-9)** Given a paper with a resolvable DOI (or arXiv id, or a confident title match), when the background enrich pipeline runs, then **Semantic Scholar** is the primary source for `title`, `year`, `venue`, `venue_short`, and the author display names (`authors_list`), replacing the current Crossref-first order. The truncated-title case (`10.14778/3514061.3514067`) resolves to the **full** title.
2. **(Crossref demoted to fallback, not deleted)** Given S2 skips (offline, non-200, rate-limited, or no match), then **Crossref** fills the same fields as the fallback (its existing cascade), and if Crossref also skips the **local `extract()`** values survive. The `CrossrefEnricher` + `crossref.py` cascade stay in the codebase (fallback now, the detailed-author/reference source for a future AI-features story).
3. **(venue_short = shortest alternate name, user rule)** Given S2's `publicationVenue.alternate_names`, then `venue_short` is the **shortest** entry (ties -> first), NOT the acronym-shape-only scan the Story 8.5 fetcher does today (which returns nothing for VLDB). For `10.14778/3514061.3514067` this yields `Proc VLDB Endow` (or `Proc Vldb Endow`); for an acronym venue (e.g. ACL, `alternate_names` includes `ACL`) the shortest is still the acronym.
4. **(Totality + non-blocking preserved, NFR-1/NFR-3)** Given any failure at any hop (S2 or Crossref: offline, timeout, rate-limit, malformed), then enrichment degrades to `"skipped"` and the paper still settles (`ready | enrich-skipped | parse-failed`), never raises, never blocks the add. No hop is on the request path.
5. **(Lookup keys)** Given the paper, then S2 is queried by **DOI first** (`/paper/DOI:{doi}`), then by **arXiv id** (`/paper/ArXiv:{arxiv_id}`) when `meta.arxiv_id` is present and no DOI resolved, then optionally by **title search** (`/paper/search`) gated by a title-plausibility check (reuse the `_titles_match` idea so an unrelated top hit can't overwrite a correct local title).
6. **(Contract unchanged)** Given the change, then it is behind the existing `enrich(meta) -> meta | "skipped"` seam: no new `DocMeta`/`CollectionRow` field, no `schema_version` bump, no route change. `authors`/`authors_list` derive as today (`app.authors` join). New-imports-only (no backfill of already-imported papers).
7. **(Verified against real DOIs)** Given a small corpus (the TranAD DOI + 2-3 others incl. an arXiv-only preprint and an ACL/venue-acronym paper), then the new path is spot-checked: TranAD title is full, venue_short is the shortest alternate name, and no paper that Crossref already got right REGRESSES.

## Tasks / Subtasks

- [ ] **Task 1 — Generalize the Semantic Scholar client from venue-short-only to a full enricher (AC: #1, #3, #5).** In `server/app/domain/semantic_scholar.py`:
  - Replace the narrow `VenueShortFetcher`/`SemanticScholarEnricher.fetch(doi) -> str | None` with a full `enrich`-shaped port that returns an `ExtractedMeta`-like correction (title, year, venue, venue_short, authors) or a skip. Query `fields=title,year,venue,publicationVenue,journal,authors,externalIds`.
  - `venue` = `publicationVenue.name` (or top-level `venue`); `venue_short` = **shortest** `publicationVenue.alternate_names` entry (AC #3), falling back to `journal.name` then `None`. Authors = `[a["name"] for a in authors]`.
  - Lookup keys (AC #5): `DOI:{doi}` -> `ArXiv:{arxiv_id}` -> `search?query={title}` (title-plausibility-gated). Bounded (`_TIMEOUT`), never raises, never blocks (keep the total try/except).
- [ ] **Task 2 — Reorder the enrich cascade: S2 first, Crossref fallback (AC: #1, #2, #4).** In `server/app/domain/enrich.py`:
  - Try the Semantic Scholar enricher first; on a real result use it. On S2 skip, fall through to the existing `CrossrefEnricher`; on Crossref skip, keep the local `extract()` values and the existing arXiv venue/year fallback. Preserve the `"skipped"` -> status contract and the never-block guarantee.
  - Keep `CrossrefEnricher` wired as the fallback (do NOT delete `crossref.py`); add a short docstring note that Crossref is retained as the fallback + the reserved source for future detailed-author/reference AI features.
  - The old Story-8.5 S2 venue_short fallback collapses into S2-being-primary (it is no longer a Crossref-leftover patch).
- [ ] **Task 3 — Guard against a worse title overwriting a better one (AC: #1, #7).** Whichever source wins, never replace a longer local/again-source title with a strictly-shorter one that is a **prefix/substring** of it (the exact Crossref `TranAD` truncation shape). A cheap, targeted guard so a bad registered title can't clobber a good one, independent of which API produced it.
- [ ] **Task 4 — Tests (AC: #1-#7).** In `server/tests/test_domain.py` (or a focused `test_enrich_semantic_scholar.py`):
  - S2 enricher unit: DOI hit maps title/year/venue/venue_short(shortest alternate)/authors from a captured S2 JSON fixture (use the saved `docs/semantic-scholar-*.json` shape); non-200/offline/malformed -> skip (never raises).
  - Cascade: S2 result wins over Crossref; S2 skip -> Crossref fallback; both skip -> local `extract()` survives; totality (any raise inside a hop -> `"skipped"`, status still settles).
  - Regression: the truncated-title guard (Task 3) keeps `TranAD: Deep Transformer...` over `TranAD`.
  - venue_short shortest-alternate rule (VLDB -> `Proc VLDB Endow`; an ACL-style list -> `ACL`).
  - Reuse the existing enricher-faking pattern (inject a fake port; never hit the live network in unit tests, mirroring the Crossref/arXiv test doubles).
- [ ] **Task 5 — Rate-limit + resilience note (AC: #4).** Semantic Scholar's public API is rate-limited (unauthenticated ~1 req/s, ~100 req / 5 min); bulk import (`POST /api/docs` throttled ~4 concurrent, AD-L4) can exceed it. Decide + implement the minimal safe behavior: a 429 is a normal skip (Crossref fallback covers it), NOT an error; optionally read an `S2_API_KEY` env for a higher limit if present (header `x-api-key`), else run keyless. Document the tradeoff in the module docstring. Do NOT add a heavy retry/queue this story (keep it total + simple).
- [ ] **Task 6 — Verify against real DOIs + docs (AC: #7).** Spot-check the TranAD DOI + an arXiv-only preprint + a venue-acronym paper against the running pipeline (own dev servers, throwaway `PAPER_MATE_DATA`). Update `docs/API.md`'s import/enrich narrative to say S2-first / Crossref-fallback (no endpoint change). Version PATCH +1 at PR-merge time per CLAUDE.md.

## Dev Notes

### Source-quality ranking is field-by-field, not one-API-wins (the reason for the swap)

The live evidence (saved JSON in `docs/`) shows S2 wins title + year + venue(short, per the shortest-alternate rule) + author display names, while Crossref wins full-given author names + (future) reference graphs. So the design is **S2 primary for display fields, Crossref retained as fallback + the reserved detailed-metadata source** for the Phase-3 AI features (paper digest, citation-aware chat). Do not delete Crossref; demote it.

### The exact bug this fixes

`crossref.py` `_dedupe_from_doi_work` (~L140) returns `clean(titles[0])` as the corrected title on a DOI hit with no plausibility gate, so Crossref's source-truncated `TranAD` overwrites the correct local font-heuristic title `TranAD: Deep Transformer...`. Making S2 primary fixes it for this paper; Task 3's truncation guard fixes the whole class regardless of source.

### venue_short rule (user decision)

Use the **shortest** `publicationVenue.alternate_names` entry, not the acronym-shape scan the current Story 8.5 `SemanticScholarEnricher` does (`_ACRONYM_NAME` = `^[A-Z][A-Z0-9]{1,11}$`), which returns `None` for VLDB (its alternates are all multi-word). Shortest gives `Proc VLDB Endow`; for a venue whose alternates include a bare acronym (ACL), shortest still lands on the acronym. Open call: prefer `journal.name` (`Proc. VLDB Endow.`) when it is shorter/cleaner than the shortest alternate? The user's instruction is "shortest alternate name" -> implement that as the rule; note `journal.name` as a candidate refinement.

### Interaction with Story 10.6 (structure-backed metadata) — sequence deliberately

Story 10.6 makes the LOCAL title prefer opendataloader's heading-1 (still fed to enrich). This story (10.8) changes the ENRICH source order. They both touch title resolution: 10.6 improves the local candidate, 10.8 improves the external correction + guards against a bad overwrite. If 10.8 ships first, 10.6 layers cleanly on top (better local candidate + the truncation guard already in place). Flag at dev time so the two don't fight over the title field.

### Totality is non-negotiable (mirrors the existing enrichers)

Every hop stays bounded + never-raising + never-blocking (the `CrossrefEnricher`/`ArxivEnricher`/`SemanticScholarEnricher` all already do this). A 429 rate-limit is a normal skip, not an error notice. The paper always settles.

### References

- Live API evidence: `docs/crossref-10.14778_3514061.3514067.json`, `docs/semantic-scholar-10.14778_3514061.3514067.json`.
- Current enrich pipeline: `server/app/domain/enrich.py`, `server/app/domain/crossref.py` (`_dedupe_from_doi_work` ~L140, `_titles_match` ~L154, venue-short cascade ~L94-102), `server/app/domain/semantic_scholar.py` (the venue-short fetcher this story generalizes), `server/app/routes/extraction.py` `run_extraction`.
- Contract: `server/app/models.py` `ExtractedMeta` (L36-61) + `DocMeta` venue/venue_short/year/authors_list fields. `app.authors` join/split.
- Architecture: AD-L2 (domain extract/enrich seam, GROBID/-swappable), LFR-8/LFR-9 (metadata extract + enrich, best-effort, never blocks). This is an enrich-source change behind the existing seam.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

## Change Log

- 2026-07-20: Story created (ad-hoc, from a live metadata diagnostic). User decision: prioritize Semantic Scholar over Crossref for enrichment (S2 wins title/year/venue-full/venue-short/author-names; Crossref demoted to fallback + reserved for later AI features needing detailed authors + references). venue_short = shortest `alternate_names`. Motivated by the Crossref source-truncated title on DOI 10.14778/3514061.3514067 (`TranAD` vs the full title). Raw API results saved under `docs/`.
