# Sprint Change Proposal — Epic 6 structural refactor (Story 6.8)

- **Date:** 2026-07-05
- **Trigger:** User request (correct-course)
- **Scope classification:** Minor (backlog insert; direct-to-dev via `bmad-create-story` → `bmad-dev-story`)
- **Mode:** Incremental
- **Author:** Wonseok

## Section 1: Issue Summary

Epic 6 (the Library run) shipped its whole feature arc (router flip, collection index, table, bulk upload, metadata extraction, inline edit, open-in-annotator) but accumulated structural debt on the way. The largest smells, found by surveying the Epic 6 code footprint:

- **`server/app/storage/__init__.py` — a 621-line god-module.** One flat file carries seven distinct concerns: the exception taxonomy (7 classes), path/data-root resolution + containment, atomic-IO primitives (`_atomic_write`/`_fsync_dir`), PDF parse (`_parse_pdf`), the `meta.json` store (import/update/touch), the `library.json` read-modify-write index (lock, cache, reconcile), and the annotations store. It is well written but monolithic — the sole `~/.paper-mate` writer (AL-9) with no internal module boundaries.
- **`server/app/domain/extraction.py` (274) fuses two separable concerns:** the pure PyMuPDF `extract` (XMP/`/Info`/font heuristic/DOI) and the Crossref-network `enrich` (the backend's only network call), with no port abstraction despite the noted "GROBID-swappable" seam.
- **`routes/docs.py` (305) repeats itself:** the OpenAPI `ErrorEnvelope` `responses=` block appears ~6× verbatim, and the `except DocumentNotFoundError → 404 / except StorageError → 500` mapping is copy-pasted into every handler.
- **Client `library/` keeps components flat** (`CollectionTable.tsx` 416, `LibraryPage.tsx` 386, plus `AddMenu`, hooks, `uploadQueue`) with upload/optimistic/polling/inline-edit conditional sprawl — NOT the `components/<Name>/` colocation Story 5.4 adopted for the rest of `client/src/`.

This is the same class of debt already handled once per prior epic boundary: Stories 5.0, 5.3, and 5.4 were pure refactor threads (structural split, component modularize, scaffold-react folder layout). Epic 6 needs its equivalent before Epic 7 (folders/trash/sort) builds more on top of the table + index.

## Section 2: Impact Analysis

- **Epic Impact:** Epic 6 only. Appends one story; no other epic changes. Epic 6 stays `in-progress` (already true; 6-7 in `review`).
- **Story Impact:** New Story 6.8 appended. **No renumbering** — 6-7 is the last existing story, so 6-8 is a clean append (unlike the 1-x/2-x/5-x inserts that shifted later stories).
- **Artifact Conflicts:** `epics.md` (add Story 6.8 section) and `sprint-status.yaml` (add `6-8-epic-6-structural-refactor: backlog`). No PRD / architecture / UX change — this is a behavior- and contract-identical refactor.
- **Technical Impact:** Server `storage`/`domain`/`routes` reorganized; client `library/` reorganized. Contract is invariant: `server/openapi.json` and `client/src/api/schema.d.ts` must regenerate byte-identical. Risk surface is the storage sole-writer/lock invariant (AL-7/AL-9) and the `annotations/` selection-geometry + doc-switch live-smoke gate (DPR>1).

## Section 3: Recommended Approach

**Direct Adjustment** — add Story 6.8 to the existing plan, same footing as the Stories 5.0/5.3/5.4 refactor threads. No rollback, no MVP-scope change.

- **Rationale:** the debt is real and localized to Epic 6; the precedent (a dedicated per-epic refactor story with its own PR(s), never folded into a feature story) is established and worked.
- **Risk:** medium on the server (storage is the sole data-root writer under a process lock; the facade must keep the public surface byte-identical so no route call-site changes). Mitigated by the contract-identical + suites-green + DPR>1 re-smoke gate baked into the ACs.
- **Effort / timeline:** one refactor story, likely multiple PRs (client vs server can split). No new dependency, no schema/version bump.

## Section 4: Detailed Change Proposals

### 4.1 — `epics.md`: insert Story 6.8

Inserted before `## Epic 7`. Full text is the Story 6.8 section now in `epics.md` (provenance blockquote + As-a/I-want/So-that + 7 Given/Then ACs covering: storage package split behind a stable facade (AL-9/AL-7); extract/enrich separation + Crossref enricher port (AD-L2); docs.py error-envelope + exception-mapping dedupe; client `library/` scaffold-react colocation + `CollectionTable`/`LibraryPage` decomposition; cross-surface dedupe/dead-code removal; behavior/contract-identical gate; AD-9 downward-layering).

### 4.2 — `sprint-status.yaml`: register the story

Added under `epic-6`, after `6-7-open-paper-in-annotator: review`:

```yaml
  6-8-epic-6-structural-refactor: backlog
```

with a provenance comment pointing at this proposal, and `last_updated` bumped.

### 4.3 — Not done here

- The **story file** (`.bmad/implementation-artifacts/6-8-epic-6-structural-refactor.md`) is created by `bmad-create-story`, not by this correct-course pass.
- **No version bump** — PATCH bumps at story done/merge, not at creation.

## Section 5: Implementation Handoff

- **Scope:** Minor.
- **Route to:** Developer — run `bmad-create-story` for 6-8 (off a `story-6-8-epic-6-structural-refactor` branch cut from `main`), then `bmad-dev-story` (Sonnet 5 xHigh), then `bmad-code-review` via Codex. Client and server may split into separate PRs.
- **Success criteria:** storage split behind a byte-identical facade (AL-9/AL-7 preserved); extract/enrich separated with a Crossref enricher port (AD-L2); docs.py error handling deduped; client `library/` on the scaffold-react layout with `CollectionTable`/`LibraryPage` decomposed; client + server suites green; `openapi.json`/`schema.d.ts` byte-identical; DPR>1 cross-page + doc-switch live smoke passes.
