# Epic List

## Epic 1: Read a paper
Open a PDF from disk and read it comfortably: pages render, scroll/zoom/pan stay fluid (~60fps on 50+ pages), a table of contents jumps to sections, and the canvas never reflows. Stands up the two-process app (FastAPI + Vite SPA, docker-compose single container, Pydantic→OpenAPI→TS contract generation), the library/import store (`doc_id` = SHA-256, idempotent import), the render layer, and the anchor-service page-box foundation that later phases consume.
**FRs covered:** FR-1, FR-2, FR-3, FR-4, FR-5, FR-6
**NFRs:** NFR-1 (first proof), NFR-2, NFR-5
**Architecture:** AR-1, AR-2, AR-3, AR-4 (page-box foundation), AR-8 (import/storage), AR-9, AR-10, AR-11, AR-12

## Epic 2: Annotate the paper
Mark up the page with all six tools — highlight, underline, pen, memo, comment, box-select — via drag-to-annotate and the contextual quick-box that switches tool/color without returning to the rail. Marks land anchored to exact PDF coordinates and the page never moves. This epic is the risk gate: it proves the spatial-anchor model holds across zoom (NFR-3).
**FRs covered:** FR-7, FR-8, FR-9, FR-10, FR-11, FR-12, FR-13, FR-14
**NFRs:** NFR-1 (overlay tools), NFR-3 (proven)
**Architecture:** AR-4 (proven), AR-5 (annotation entity), AR-9 (boundary)

## Epic 3: Edit, persist & review
Make the annotated record durable and curatable: select, move, resize, restyle, re-edit text, undo/redo, and delete — all through one command stack — plus autosave to disk with exact restore on reopen, and the Annotation Bank (list + click-to-jump). Groups everything that flows through the store/command-stack and persistence path.
**FRs covered:** FR-15, FR-16, FR-17, FR-18, FR-19, FR-20, FR-21, FR-22 (+ post-v1 convert-highlight-comment via Story 3.7, and adjust-text-range via Story 3.8 (blocked); both were the 2026-06-30 FR-26/FR-27, numbers since RE-USED in `prd.md`, now story-tracked, see FG-F SUPERSEDED note)
**NFRs:** NFR-4 (durability), NFR-1 (Bank overlay)
**Architecture:** AR-6 (ownership), AR-7 (command stack + autosave), AR-8 (persistence), AR-9 (boundary)

## Epic 4: Reading & annotation fidelity (post-v1, Phase-1.5)
> Added 2026-06-30 via correct-course (`sprint-change-proposal-2026-06-30.md`), grouping the render/anchor correctness items from `deferred-work.md`. Make the CORE read+annotate surfaces render and select correctly: fix the pdf.js text-layer copy/selection bugs, make highlight/selection geometry column-aware (no gutter bridging), and give comment/memo marks distinct, non-obscuring on-page treatment. No new FRs — this is quality of FR-2/4/7/8/10/11 under NFR-3. Sequenced post-v1; pull a story earlier if a bug proves v1-blocking.
> **FRs covered:** none new (quality of FR-2, FR-4, FR-7, FR-8, FR-10, FR-11)
> **NFRs:** NFR-3 (anchor fidelity), NFR-2/NFR-5 (reading quality)
> **Architecture:** AR-4 (anchor geometry), AR-9 (render/anchor boundary)

## Epic 5: Reader preferences & polish (post-v1, Phase-1.5)
> Added 2026-06-30 via correct-course, grouping the preferences / color-system / UX-refinement / structural-refactor items from `deferred-work.md`. Add user-facing preferences (settings + hotkey rebinding, per-tool + custom colors, hide/show-all toggle), the small interaction-polish refinements (layered Esc, in-editor confirm, collapsed stroke-width control, dimmed ToC), and the standing codebase structural refactor (data contracts + conditional/FSM unification + src module split) as an enabler.
> **FRs covered:** post-v1 hide/show-all (Story 5.5), settings + hotkey rebinding (Story 5.1), per-tool + custom colors (Story 5.2, blocked): the 2026-06-30 FR-23/24/25, numbers since RE-USED in `prd.md`, now story-tracked (see FG-F SUPERSEDED note)
> **NFRs:** NFR-1, NFR-5 (immersion), NFR-3 (unchanged by polish)
> **Architecture:** AR-3 (contract preserved by refactor), AR-6/AR-7 (doc-scoped store + autosave), AR-9 (layering), AD-11 (FSM)
