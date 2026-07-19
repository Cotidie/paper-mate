# Sprint Change Proposal, 2026-07-20

**Trigger:** User decision to adopt **opendataloader-pdf** (`github.com/opendataloader-project/opendataloader-pdf`, Apache-2.0) as Paper Mate's document-structure engine, and to **heavily replace custom PDF-interpretation logic** with the building blocks it provides. Goal: make the reader **section-aware** (Figures, Tables, Headings, Paragraphs, Footnotes, Captions, Lists) as a first-class, box-anchored layer.
**Author:** Wonseok (correct-course)
**Scope classification:** **Significant**, adds a new external runtime dependency (a JRE + the `opendataloader-pdf` Python binding in the container image), a new architecture decision (**AD-13** main spine + **AD-L8** library spine), a new API contract (`DocStructure` + `GET /api/docs/{id}/structure`), a new per-doc storage artifact (`structure.json`), supersedes a reserved story (12.3), and proposes new FRs. Routes to a PO/DEV loop; **spike-gated** at the enabler.

> **FINAL NUMBERING (authoritative, 2026-07-20).** This proposal was applied through two successive user-directed renumbers on the same day; the body below may reference intermediate epic numbers. The final, live numbering (matching `epics.md` + `sprint-status.yaml`) is: **Epic 9** = Reader & annotation polish round 3 (DONE, was Epic 10); **Epic 10** = Document structure layer (opendataloader, THIS proposal's new epic); **Epic 11** = Annotation blocks (textbox/image/clipboard, from the 2026-07-18 batch); **Epic 12** = Phase-2 kickoff / download + export + reading-helper (was Epic 9, deprioritized to last because it is unbuilt). The structure layer's reading-helper (Story 10-4) supersedes the old reading-helper (now Story 12-3). Exec order = numeric order; Epic 10 (structure) is the next backlog epic.

---

## Section 1, Issue Summary

Paper Mate's Phase-2 reading-helper (FR-27, Story 12.3) and several existing behaviors depend on *interpreting* the PDF, detecting Figures/Tables, headings, footnotes, and citation markers, and mapping each to a region. Today that interpretation is hand-rolled and partial:

- **Metadata** (`server/app/domain/extract.py`) uses a PyMuPDF "largest horizontal font near the top of page 0" heuristic for the title, plus XMP + DOI/arXiv regex.
- **Table of contents** (Story 1.9) renders the PDF's *embedded* outline only, absent from most papers, so most papers have no TOC.
- **Reading-helper previews** (Story 12.3, unbuilt) are specced as "regex over text-layer spans + geometry", a fragile SPIKE whose hard part is exactly the detection opendataloader already does.
- **Figures/Tables** have no representation at all; a Phase-3 "chat about this figure" would require the user to draw a box.

opendataloader-pdf emits, per element, `{type, page number, bounding box [left,bottom,right,top] in PDF points, heading level, font, content}` for headings (leveled), paragraphs, tables, lists, images, captions, formulas, plus reading order and header/footer/watermark filtering. Its boxes map **1:1** onto our `RectAnchor` (AD-4): normalize by page dimensions, flip Y. So one server-side extraction pass yields a **document-structure layer** every reader feature can consume, and lets us **delete or bypass** the heuristics above.

Critically, opendataloader runs **inside our container** (Java core, `pip install opendataloader-pdf` spawns a bundled JVM; the PDF is already in `/data`). Unlike the Phase-3 agent CLIs, which need *host* access and stay deferred (main spine Deferred, AD-9 `agents/` seam), this dependency does **not** hit the dockerization boundary, so it is safe to adopt now.

## Section 2, Impact Analysis

### Epic impact

- **New Epic 10**, "Document structure layer (opendataloader integration)": a Phase-2 **enabler** (structure extraction + contract + client service) plus the consumers it unlocks (synthesized TOC, Figures/Tables index, structure-backed reading-helper previews, structure-backed metadata) and a terminal refactor.
- **Epic swap (user decision):** the structure layer is prioritized over the annotation-blocks epic, so the two are switched: the structure layer takes **Epic 10** (runs first) and the pre-existing annotation-blocks epic (textbox/image/clipboard, from the 2026-07-18 batch) is renumbered to **Epic 11**. Blocks content/FRs (FR-28/29/30) are unchanged, only the number and exec-order shift.
- **Epic 12** (Phase-2 kickoff, backlog), **Story 12.3 (reading-helper preview) is superseded** by Epic 10's structure-backed reading helper (Story 10-4). Its *approach* (hand-rolled text-layer detection) is dropped; its *capability* (FR-27) is delivered on the structure layer instead. Same shape as 8-9 → 8-11 (approach replaced, concern absorbed). Epic 12 keeps 12-1 (download) + 12-2 (export), which are independent.
- **No shipped code touched.** The only new epic is Epic 10 (structure layer); the other Phase-2 epics (blocks = 11, download/export = 12) and the done reader-polish epic (now 9) are only renumbered, content unchanged (see FINAL NUMBERING above). Story 1.9 (TOC) and Story 6.5 (metadata) are **upgraded**, not rewritten: their code stays as the graceful fallback when structure is thin (scanned/pathological PDFs).

### Story impact (grounded in current code)

- `server/app/domain/extract.py`, the `bytes -> ExtractedMeta` seam is already documented "GROBID-swappable." opendataloader is the swap-in for title/heading detection; DOI/arXiv regex stays (fed opendataloader's clean text). Story 10-5.
- `server/app/domain/`, gains a second domain tenant: `structure.py` (`extract_structure(pdf_bytes) -> DocStructure`) behind a port, opendataloader as the first adapter (mirrors AD-L2's extract/enrich).
- `server/app/models.py`, additive: `StructureElement` + `DocStructure` (surfaced into OpenAPI → generated TS types).
- `server/app/routes/docs.py`, new `GET /api/docs/{id}/structure` (+ `docs/API.md` entry).
- `server/app/storage/`, a new per-doc artifact `structure.json` beside `source.pdf`/`meta.json` (AD-8 layout; produced in the AD-L4 background import pipeline).
- `client/src/`, a new `structure/` service (fetch + hold `DocStructure`); thin consumers for TOC (Story 10-2), Figures/Tables index (10-3), reading-helper (10-4).
- Story 12.3, superseded by 10-4 (see Epic impact).

### Artifact conflicts

- **Main architecture spine**, the "Phase 2 surfaces … all consume AD-4 anchors; not designed here" Deferred note (and the Deferred section) is now partially **designed** by AD-13. Updated in this proposal.
- **Library architecture spine**, AD-L2 opened the backend domain layer for extraction; structure extraction is its **second tenant** (AD-L8), and AD-L4's import pipeline gains a step, AD-L7's index-write concurrency is unaffected (structure.json is per-doc, not the shared index). Updated in this proposal.
- **Reader PRD**, needs new FRs (FR-34..37) + a reframe of FR-27. RECOMMENDED as a separate `bmad-edit-prd` run (Section 4c), not applied here.

### Technical impact

- **Dependency:** a JRE in the Docker image (~image-size cost) + `opendataloader-pdf` (PyPI). Determinism: born-digital local mode is deterministic + offline (fits NFR-6-Library local-first). OCR/hybrid mode (Docling + a vision model) is **out of scope** (deferred).
- **Runtime cost:** a JVM spawn per document, at **import** (background, one-time), never per request. Acceptable for a single-user local app.
- **Risk, coordinate correctness:** the PDF-points → normalized-rect → screen mapping is the jsdom-blind geometry that recurs across this project ([[verify-on-hidpi-and-real-host]]). The enabler is **spike-gated** on a DPR>1, multi-column live smoke before anything ships.
- **Risk, accuracy:** structure is best-effort; scanned/pathological PDFs yield thin structure. Every consumer degrades gracefully and the existing heuristics stay as the fallback.

## Section 3, Recommended Approach

**Direct Adjustment**, add one new enabler-led epic; no rollback, no MVP change, no touch to shipped epics.

1. **Epic 10** is the Phase-2 **structure foundation**. Story **10-1 (enabler, SPIKE-FIRST)** is a hard prerequisite for 10-2..10-6 and gates the whole epic on coordinate correctness + binding feasibility.
2. Sequence Epic 10 as the **next Phase-2 epic**, ahead of Epic 12's reading-helper (which it supersedes) and alongside the download/export items. The enabler de-risks the dependency before any user-facing consumer is built.
3. **Supersede Story 12.3**: its capability (FR-27) is delivered by Story 10-4 on the structure layer; mark 12-3 `blocked` (superseded), Epic 12 still closes on 12-1/12-2.
4. **Upgrade, don't rewrite** TOC (1.9) and metadata (6.5): route through structure, keep the heuristic as the fallback.

Rationale: one server-side pass replaces four hand-rolled detectors with one box-anchored model that maps onto the anchor system we already ship; the enabler isolates the dependency + coordinate risk behind a spike; the terminal refactor (10-7) absorbs the epic's debt (AE7-5). Effort: ≈ 6 feature/enabler stories + 1 refactor; risk concentrated in 10-1 (binding + coordinates) and 10-4 (marker→region resolution), both gated.

---

## Section 4, Detailed Change Proposals

### 4a. sprint-status.yaml (APPLIED)

- Add **Epic 10** (backlog) with stories 10-1..10-7 + `epic-10-retrospective: optional`.
- `12-3-footnote-reference-preview`: `backlog` → **`blocked`** (superseded by Story 10-4; FR-27 delivered on the structure layer). Annotate with the supersession note.
- Update `last_updated` + header note.

### 4b. epics.md (APPLIED)

- Append the **Epic 10** section (7 stories) in the house format (narrative intro > per-story `> note` + role + ACs + Out-of-scope / Open-design-calls).
- Amend the **Story 12.3** block: mark superseded-by-11-4 (kept for provenance, like the descoped-story precedent).

### 4c. Reader PRD addendum (RECOMMENDED, separate `bmad-edit-prd` run, not applied here)

Proposed FRs (numbers provisional; addendum finalizes):

- **FR-34** Document-structure extraction, a per-document, box-anchored structure model (typed elements: heading/paragraph/table/figure/caption/list/footnote + reading order), extracted at import.
- **FR-35** Section navigation, a synthesized Table of Contents from detected headings, for every paper (upgrades **FR-3**, which today needs an embedded outline).
- **FR-36** Figures & Tables index, a navigable list of detected figures and tables with jump-to-region.
- **FR-37** *(directional, Phase-3 groundwork)* Structure-derived paper digest, reading-order sectioned text as the AI-companion context payload.
- **FR-27 reframed**, the inline reading-helper preview resolves markers against the FR-34 structure layer (element lookup), not hand-rolled text-layer geometry.
- **LFR-8 upgraded**, metadata extraction routes through structure (title from heading-1 / reading order); the PyMuPDF heuristic remains the fallback.

### 4d. Architecture-spine addendum (APPLIED)

- **Main spine (`architecture-paper-mate-2026-06-28`)**, add **AD-13 (Document-structure layer)**; update the Deferred + Capability-map entries that said Phase-2 surfaces were "not designed here."
- **Library spine (`architecture-paper-mate-library-2026-07-04`)**, add **AD-L8 (structure extraction = second domain tenant)**, extending AD-L2's domain layer + AD-L4's import pipeline; note structure.json is per-doc (does not touch AD-L7 index concurrency).

---

## Section 5, Implementation Handoff

**Scope: Significant → route to PO/DEV loop, enabler spike-gated.**

Per-story pipeline (unchanged house process): `bmad-create-story` (Opus High, fresh context, branch per story) → `bmad-dev-story` (Sonnet 5 xHigh) → `bmad-code-review` via Codex (cross-model) → merge, flip sprint-status `done`, PATCH +1, update `docs/API.md` when a route changes → epic close → `bmad-retrospective`.

**Pre-work before Epic 10 dev:**
- Land the **reader-PRD addendum** (`bmad-edit-prd`) so FR-34..37 + the FR-27 reframe are the FR source of truth.
- **Story 10-1 is SPIKE-FIRST**: prove the `opendataloader-pdf` Python binding runs in the image (JRE bundling), produce one real paper's `structure.json`, and live-smoke the PDF-points → normalized-rect → screen mapping on a 2-column paper at DPR>1 **before** committing the contract + consumers. A negative binding/coordinate outcome is a complete, acceptable spike result (write-up + reassess), do not build 10-2..10-6 on an unproven enabler.

**Success criteria:** the structure layer is one server-produced artifact + one contract + one client service; TOC, Figures/Tables index, reading-helper, and metadata are thin consumers of it; the heuristics they replace survive only as graceful fallbacks; no shipped code touched (only Epic 10 is new; the rest renumbered per FINAL NUMBERING); new FRs traceable PRD to epic to story.

---

## Epic definition (for epics.md)

### Epic 10, Document structure layer (opendataloader-pdf integration) (post-v1, Phase-2 enabler)

| Story | Kind | FR |
|---|---|---|
| 10-1 Structure-extraction enabler, JRE-in-image + `opendataloader-pdf` binding, `extract_structure` port + adapter, `structure.json` artifact, `DocStructure` contract + `GET /api/docs/{id}/structure`, points→normalized mapping (SPIKE-FIRST, DPR>1 coordinate gate) | enabler | **FR-34** |
| 10-2 Section navigation, synthesized Table of Contents from detected headings, for every paper | feature | **FR-35** (upgrades FR-3) |
| 10-3 Figures & Tables index, navigable list of detected figures/tables + jump-to-region | feature | **FR-36** |
| 10-4 Inline reading-helper previews via structure lookup (Figure/Table first, then footnote/`[n]`), **supersedes Story 12.3** | feature | **FR-27** (reframed) |
| 10-5 Structure-backed metadata extraction, route `extract()` through structure, keep PyMuPDF fallback | feature | LFR-8 (upgraded) |
| 10-6 Structure-derived paper digest (Phase-3 groundwork, directional) | directional | **FR-37** |
| 10-7 Epic 10 structural refactor (terminal, AE7-5) | refactor | (none) |

### Epic 12 amendment

- Story 12.3 → superseded by Story 10-4 (structure-backed). FR-27 now delivered in Epic 10. `12-3-footnote-reference-preview`: `backlog` → `blocked`.
