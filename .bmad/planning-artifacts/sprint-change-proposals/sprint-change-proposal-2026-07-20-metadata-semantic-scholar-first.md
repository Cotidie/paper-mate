# Sprint Change Proposal, 2026-07-20 (metadata enrichment: Semantic Scholar first)

**Trigger:** A live metadata diagnostic during the Story 10.1 dev session. The user uploaded the TranAD paper (DOI `10.14778/3514061.3514067`) and the library row showed a **truncated title** ("TranAD"). Investigation of both external metadata APIs revealed Crossref registers a source-truncated title while Semantic Scholar has the full, correct one, and that our pipeline prefers Crossref by DOI with no plausibility gate, so the bad title wins.
**Author:** Wonseok (correct-course)
**Scope classification:** **Moderate** (Direct Adjustment). Adds ONE story to the active epic, reframes one Library FR, resolves a Library-PRD open question, and notes an architecture seam. No epic redefinition, no rollback, no MVP change, no shipped-code change. Routes to the PO/DEV loop.

---

## Section 1, Issue Summary

Paper Mate's metadata enrichment (`server/app/domain/enrich.py` -> `CrossrefEnricher`, Story 6.5/7.9/8.5) is **Crossref-first by DOI**. On a DOI hit, `crossref.py` `_dedupe_from_doi_work` returns Crossref's `titles[0]` **verbatim, with no plausibility gate** (the `_titles_match` Jaccard guard only protects the title-*query* fallback path, not DOI hits). So when Crossref's registered title is worse than the local one, it silently overwrites it.

**Concrete evidence** (raw API responses saved at `docs/crossref-10.14778_3514061.3514067.json` + `docs/semantic-scholar-10.14778_3514061.3514067.json`), DOI `10.14778/3514061.3514067`:

| Field | Crossref | Semantic Scholar | Better source |
|---|---|---|---|
| title | `TranAD` (**source-truncated**) | `TranAD: Deep Transformer Networks for Anomaly Detection in Multivariate Time Series Data` | **S2** |
| year | 2022 | 2022 | tie |
| venue (full) | `Proceedings of the VLDB Endowment` | `Proceedings of the VLDB Endowment` | tie |
| venue (short) | `Proc. VLDB Endow.` | shortest `alternate_names`: `Proc VLDB Endow` | **S2** (per user rule) |
| author names | `Giuliano Casale`, `Nicholas R. Jennings` (full given) | `G. Casale`, `N. Jennings` (initials) | S2 for display; **Crossref** for the detailed form |
| detailed authors + references | present | not fetched | **Crossref** (reserved for later AI features) |

The local PyMuPDF font heuristic already extracts the correct full title; Crossref then clobbers it. Semantic Scholar has the correct title and, via `journal.name`/`alternate_names`, a good venue too.

## Section 2, Impact Analysis

### Epic impact

- **Epic 10 (Document structure layer)** absorbs the change as **one new story (10.7)**. It is metadata-enrichment quality, adjacent to the existing Story 10.5 (structure-backed metadata) but **independent of the structure layer** (it does NOT consume opendataloader / Story 10-1). Epic 10 is the active epic and already owns the metadata neighbor, so it is the pragmatic home.
- **Refactor-last convention (AE7-5):** the terminal structural refactor is renumbered **10.7 -> 10.8** so the new feature story takes 10.7 and the refactor stays the highest-numbered / last-executed story. Number = exec order preserved.
- **No other epic affected.** Epic 11 (blocks) and Epic 12 (reading helper) untouched. Story 10.5 interacts on the **title field** only (10.5 improves the LOCAL candidate; 10.7 improves the EXTERNAL correction + adds the anti-truncation guard) — sequence deliberately at dev time.

### Story impact (grounded in current code)

- `server/app/domain/semantic_scholar.py` — generalized from the Story 8.5 venue-short-only fetcher into a full enricher (title/year/venue/venue_short/authors), keyed DOI -> arXiv id -> title-search.
- `server/app/domain/enrich.py` — the cascade is reordered: **S2 primary, Crossref fallback, local `extract()` last.** Add the anti-truncation guard.
- `server/app/domain/crossref.py` — **retained** as the fallback + the reserved detailed-author/reference source for future AI features. Not deleted.
- No `models.py`/route/schema change (additive behavior behind the existing `enrich(meta) -> meta | "skipped"` seam; the `venue`/`venue_short`/`year`/`authors_list` fields already exist).

### Artifact conflicts

- **Library PRD** — FR-9 already names "Crossref / Semantic Scholar"; the **open question at L119** ("which service, by what key") is exactly what this decision resolves. Resolved inline (marked RESOLVED, pointing at this proposal). FR-9 reframed to **LFR-9** (S2 primary, Crossref fallback).
- **Library architecture spine (AD-L2)** — the domain extract/enrich seam already accommodates multiple enrichers (Crossref/arXiv/S2 ports). This change is a **priority reorder behind AD-L2**, not a new architecture decision. The only new runtime consideration is the S2 public-API rate limit (a 429 is a normal skip; an optional `S2_API_KEY` env may raise it). No spine amendment required; noted here.
- **Reader/main spine, UX** — no impact (backend metadata; the table already renders title/venue/authors).

### Technical impact

- **Dependency:** none new (`httpx` already used; S2 is the same host the Story 8.5 fetcher already calls).
- **Runtime:** the enrich hop stays a bounded, background, best-effort call. S2 rate limit (unauthenticated ~1 req/s, ~100/5 min) can be exceeded on bulk import -> a 429 degrades to a Crossref-fallback skip, never an error. No heavy retry/queue this story.
- **Risk, correctness:** low. Additive behind the seam, totality preserved, new-imports-only, spot-checked against real DOIs. The anti-truncation guard removes a whole defect class.

## Section 3, Recommended Approach

**Direct Adjustment** — add one enabler-independent story to Epic 10; no rollback, no MVP change, no shipped-code touched.

1. Add **Story 10.7 (Semantic Scholar first)**, renumber the terminal refactor to **10.8** (refactor stays last, AE7-5).
2. **Reorder** the enrich cascade (S2 -> Crossref -> local), **retain** Crossref as fallback + reserved AI-features source, and add an **anti-truncation guard** so no bad title (any source) overwrites a better one.
3. **`venue_short` = shortest `alternate_names`** (user rule), replacing the acronym-shape scan that misses multi-word venues.
4. **Resolve** the Library-PRD open question; **reframe** FR-9 -> LFR-9.

Rationale: the fix targets a real, evidenced defect (truncated title) with the smallest surface — a priority reorder behind an existing seam plus a targeted guard — while preserving Crossref for the detailed author/reference data Phase-3 AI features will want. Effort **Medium**, risk **Low** (rate-limit is the only new runtime concern, and it degrades safely).

## Section 4, Detailed Change Proposals

### 4a. sprint-status.yaml (APPLIED)

- Insert `10-7-metadata-enrichment-semantic-scholar-first: ready-for-dev`.
- Renumber `10-7-epic-10-structural-refactor` -> `10-8-epic-10-structural-refactor` (backlog; runs last).
- Annotate with this proposal + the rationale.

### 4b. epics.md (APPLIED)

- Insert the **Story 10.7** section (S2-first enrichment) in house format (narrative `>` intro + role + ACs + Out-of-scope / Open-design-calls).
- Renumber the terminal refactor to **Story 10.8**; update its scope to include 10.7's enricher cascade and its story-range references (10.1-10.7).

### 4c. Library PRD (APPLIED)

- Mark the L119 open question **RESOLVED** (both services, S2 primary + Crossref fallback; DOI -> arXiv -> title-search keys), pointing at this proposal + Story 10.7. FR-9 reframed as LFR-9.

### 4d. Story file (APPLIED)

- `.bmad/implementation-artifacts/epic-10/10-7-metadata-enrichment-semantic-scholar-first.md` — full ready-for-dev story (ACs, tasks, dev notes grounded in the enrich code + the saved API evidence).

## Section 5, Implementation Handoff

**Scope: Moderate -> PO/DEV loop.**

Per-story pipeline (unchanged house process): `bmad-dev-story` (Sonnet 5 xHigh, branch per story) -> `bmad-code-review` via Codex (cross-model, read-only sandbox, no wrapper timeout) -> merge, flip sprint-status `done`, PATCH +1, update `docs/API.md` enrich narrative -> continue Epic 10.

**Sequencing:** Story 10.7 is independent of the structure layer (10.1) and can be developed any time. It touches the **title field**, which Story 10.5 also touches, so land them coherently (10.7's anti-truncation guard makes 10.5's local-title improvement safe). The terminal refactor (10.8) stays last.

**Success criteria:** the TranAD DOI resolves to the full title; `venue_short` is the shortest alternate name; Crossref remains as the fallback + reserved detailed-metadata source; every enrich hop stays total + non-blocking; contract unchanged; no shipped code regressed.
