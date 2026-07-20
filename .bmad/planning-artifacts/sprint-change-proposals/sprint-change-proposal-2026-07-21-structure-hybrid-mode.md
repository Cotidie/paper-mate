# Sprint Change Proposal — Migrate structure extraction to opendataloader hybrid mode (runtime-switchable)

- **Date:** 2026-07-21
- **Author:** Wonseok (via bmad-correct-course)
- **Scope classification:** Moderate (a new backlog story + one architecture-invariant amendment; no rework of shipped stories, contract unchanged)
- **Epic:** 10 (Document structure layer)

## Section 1 — Issue Summary

Story 10.1 shipped opendataloader-pdf's **local/fast** extraction mode (deterministic + offline, born-digital PDFs) and explicitly deferred its **hybrid** mode (Docling + a vision model).

A live diagnostic (2026-07-21) on the TranAD paper (`fixtures/sample-pdfs/adtran.pdf`, no embedded PDF outline, so the Story 10.2 synthesized ToC is used) exposed local mode's heading-detection gaps:

- `3 METHODOLOGY` — text IS extracted, but tagged `type="paragraph"` (heading_level `None`), not `heading`, so it never reaches the ToC.
- `3.1 Problem Formulation`, `3.2 Data Preprocessing` — **not extracted at all** (0 occurrences in the tool output).

Confirmed this is NOT a client-side flaw: `synthesizeToc` faithfully lists every `type="heading"` element, and the caption filter only drops `Figure N`/`Table N`. The gap is opendataloader's local heuristic heading detector.

**User decision (2026-07-21):** migrate structure extraction to **hybrid mode** for higher fidelity, and keep the mode **runtime-switchable** so falling back to local (non-hybrid) is trivial at any time.

## Section 2 — Impact Analysis

- **Epic impact:** Epic 10 gains one story. No shipped story is reworked.
- **Story impact:**
  - **New Story 10.8** — "Migrate structure extraction to opendataloader hybrid mode (runtime-switchable)". SPIKE-FIRST (mirrors 10.1), depends on 10.1.
  - **Existing terminal refactor renumbered 10.8 → 10.9** so the refactor stays LAST (AE7-5, story number = execution order). Its scope now also covers the local/hybrid mode switch.
  - **Consumers unchanged (10.2–10.6):** ToC, Figures/Tables index, reading-helper, metadata, digest read the same `DocStructure` contract; they benefit from better structure automatically, no code change.
- **Artifact conflicts:**
  - **AD-13** (main architecture spine): the line "OCR/hybrid mode is deferred" and the "deterministic + offline" invariant are amended — hybrid is un-deferred; the deterministic+offline guarantee becomes **mode-dependent** (local preserves it; hybrid may relax it), with local as the offline fallback via the switch. The Deferred-scope bullet is likewise updated.
  - **FR-34** (structure): a quality/fidelity upgrade, no new FR, no contract change.
- **Technical impact (the real cost, surfaced not hidden):**
  - **Image size + deps:** hybrid needs Docling + a vision model (and its weights) in-container, on top of the existing JRE + binding.
  - **Determinism:** a vision model may make extraction non-deterministic run-to-run (AD-13 local invariant relaxed).
  - **Offline / NFR-1 local-first:** if hybrid needs a model download at build/run, the offline promise holds only in local mode — hence the switch keeps local reachable.
  - **Coordinate mapping:** the spike must confirm hybrid's JSON output shape (bbox points, page indexing, type vocabulary) is identical to local, so `domain/structure.py`'s points→normalized-`Rect` mapping needs no change; any delta is a spike finding.
  - **Totality:** a heavier pass raises timeout/OOM risk; extraction must stay total (empty structure on failure, never blocks import) exactly as 10.1.

## Section 3 — Recommended Approach

**Direct Adjustment** — add Story 10.8 within the existing Epic 10 plan; no rollback, no MVP-scope change. The migration rides the existing `extract_structure` port + `OpenDataLoaderExtractor` adapter (opendataloader itself has both modes), so it is a mode selection, not a new adapter/contract.

- **Effort:** one SPIKE-FIRST story (spike gates the migration; a negative spike result — hybrid can't run in-image, or breaks coordinates — is an acceptable "stay on local" outcome).
- **Risk:** moderate — image size, determinism, offline are real relaxations, mitigated by the runtime switch (local always reachable).
- **Timeline:** independent of 10.2–10.7; sequenced before the terminal refactor (10.9) so the refactor's scope reflects the mode switch.

## Section 4 — Detailed Change Proposals

### 4.1 Epic file (`.bmad/planning-artifacts/epics/epic-10-...md`)

- **NEW `## Story 10.8: Migrate structure extraction to opendataloader hybrid mode (runtime-switchable)`** — SPIKE-FIRST; ACs covering: (1) the spike gate (in-image proof + cost/determinism/offline/coordinate-shape characterization on real papers incl. TranAD); (2) the single runtime config switch (`PAPER_MATE_STRUCTURE_MODE=hybrid|local`, default hybrid, local by flipping one env), contract/`structure.json` unchanged; (3) totality preserved; (4) the deterministic+offline relaxation surfaced with local as the fallback; (5) live-smoke that TranAD's dropped sections (`3 Methodology`, `3.1`, `3.2`) return and still land correctly at DPR>1. Out-of-scope: backfill of imported papers, consumer changes, per-doc mode override. Open design calls handed to create-story (config name/default, image bundling + size budget, model-fetch strategy, resource guard, health-endpoint mode exposure).
- **Renumbered `## Story 10.8` → `## Story 10.9: Epic 10 structural refactor (terminal)`** — scope updated to include the local/hybrid mode switch + the structure-status derivation; still LAST, still pure-refactor.

### 4.2 Sprint status (`.bmad/implementation-artifacts/sprint-status.yaml`)

- Added `10-8-hybrid-mode-switchable: backlog` with a dated correct-course note.
- Renamed `10-8-epic-10-structural-refactor` → `10-9-epic-10-structural-refactor` (stays LAST).
- `last_updated` bumped.

### 4.3 Architecture (`ARCHITECTURE-SPINE.md`)

- **AD-13** rule amended: extraction runs in one of two runtime-switchable modes (local/hybrid); "deterministic + offline" is now mode-dependent with local as the offline fallback; both modes emit the same contract. Change-log note added (hybrid un-deferred 2026-07-21, Story 10.8).
- **Deferred bullet** amended: OCR/scanned stays deferred; hybrid mode is adopted (Story 10.8) as a switchable mode.

## Section 5 — Implementation Handoff

- **Scope:** Moderate.
- **Next step:** `bmad-create-story 10-8` (SPIKE-FIRST; resolve the open design calls — config mechanism/default, image bundling + size budget, model-fetch/offline strategy, resource guard). Then `bmad-dev-story`.
- **Sequencing:** 10.8 before 10.9 (the terminal refactor absorbs the mode switch). 10.2–10.7 unaffected.
- **Success criteria:** hybrid runs in-container behind the same contract; one env flips local↔hybrid with no code change; extraction stays total; TranAD's dropped headings return in the synthesized ToC and land correctly at DPR>1; local mode remains a deterministic + offline fallback.
