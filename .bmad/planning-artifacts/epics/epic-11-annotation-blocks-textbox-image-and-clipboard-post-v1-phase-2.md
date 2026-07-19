# Epic 11: Annotation blocks, textbox, image and clipboard (post-v1, Phase-2)

> Added 2026-07-18 via correct-course (`sprint-change-proposal-2026-07-18.md`). The three heavyweight items from the 13-request batch: each adds a net-new capability with FR/contract surface, so they were grouped here (the defects/polish stayed in Epic 9), the same split-by-weight the 2026-07-11 batch used (Epic 8 vs Epic 12). This is the SECOND capability set to cross the v1 to Phase-2 line (after Epic 12). New reader FRs: FR-28 (textbox), FR-29 (image block), FR-30-reader (clipboard paste) (proposed; finalize in a reader-PRD addendum before dev). Story 11-2 introduces a persisted binary-asset seam not in the current annotation model and wants an architecture-spine note at create-story; 11-2 and 11-3 are SPIKE-FIRST (feasibility gate before commit). Dependency: 11-3 depends on 11-1 and 11-2.

## Story 11.1: Plain textbox tool (text-only block, distinct from the memo) (item 6)

> User request: "support a normal text box tool that has only text, not a sticky note." A new `AnnotationTool` plus a `MARK_DESCRIPTORS` entry: a text-only `kind=rect` block distinct from the memo's sticky styling. Proposed reader **FR-28** (finalize in the PRD addendum).

As a reader,
I want a plain textbox tool that places text directly on the page,
So that I can type a clean label or note without the sticky-note styling of a memo.

**Acceptance Criteria:**

**Given** the tool rail
**When** I pick the textbox tool and click/drag on the page
**Then** a text-only block is created (`type=textbox`, `anchor kind=rect`), editable inline, with NO sticky-note fill/chrome (transparent or minimal background), created through the command path (item 6, proposed FR-28, AR-5/AR-7)

**Given** the textbox is a new mark type
**Then** it is added as one `MARK_DESCRIPTORS` entry (the AD-5 dispatch pattern) plus its contract type, additively (no `schema_version` break; existing docs still load) (proposed FR-28, AD-5/AD-8)

**Given** a textbox
**Then** it can be selected, moved, resized, recolored (text color), re-edited, deleted, and undone/redone through the SAME command path as other marks, and it appears in the Annotation Bank (respecting 8.2 filter, sorted by 8.3 reading order) (FR-15/FR-16/FR-17, FR-19)

**Given** a textbox
**When** I zoom or reload
**Then** it stays anchored at its PDF coordinates and its text restores exactly (NFR-3, AR-6)

**Given** any textbox UI string
**Then** it contains no em-dash (UX-DR13)

> **Out of scope:** rich text (bold/italic/lists); the image block (Story 11-2); paste (Story 11-3). **Open design calls for create-story:** how a textbox differs from a memo in the model (a new `type` vs a memo style flag); default background (fully transparent vs hairline); font/size controls (reuse memo's or minimal).

## Story 11.2: Image attachment block with resize handles (SPIKE-FIRST) (item 8)

> User request: "support an image attachment tool where I upload an image from the filesystem; the attached image's size is adjustable with handles." Introduces a persisted BINARY asset, which the current annotation model (scalar/rect/path/text) does not carry. SPIKE-FIRST on where the bytes live; the choice is an architecture-spine decision recorded at create-story. Proposed reader **FR-29** (finalize in the PRD addendum).

As a reader,
I want to attach an image from my computer onto the page and resize it with handles,
So that I can pin a figure, screenshot, or diagram alongside the paper.

**Acceptance Criteria:**

**Given** the story
**Then** it STARTS with a storage spike: decide where image bytes live (client-embedded data-URI inside the annotation vs a server-stored asset with a new upload route and a `/data` asset dir), weighing `~/.paper-mate` size, the AD-8 persistence-format impact, and offline/same-origin serving, and record the decision as an architecture-spine note before the full build (item 8, proposed FR-29, AD-8)

**Given** the image tool
**When** I choose an image file from disk
**Then** an image block is placed on the page (`type=image`, `anchor kind=rect`), created through the command path, and persisted so it restores on reload (item 8, proposed FR-29, AR-6/AR-7)

**Given** a selected image block
**When** I drag its handles
**Then** it resizes (aspect-ratio behavior is a create-story call), handles tracking the corners exactly at any zoom (consistent with 9-2), staying anchored at its PDF coordinates (FR-15, NFR-3)

**Given** an image block
**Then** it selects/moves/deletes/undoes through the shared command path and appears in the Annotation Bank (8.2 filter, 8.3 order), and a very large image is bounded (create-story: max dimension/byte cap) so it cannot bloat `~/.paper-mate` or jank the page (FR-15/FR-17/FR-19, NFR-2)

**Given** the block
**Then** it is live-smoked at DPR>1: attach, resize, zoom, reload, confirm placement and fidelity

> **Out of scope:** image editing (crop/rotate/filters); drag-and-drop-from-desktop and clipboard paste (paste is Story 11-3); annotating ON the image. **Open design calls for create-story:** the storage decision (the spike); upload route + contract shape if server-stored (then `docs/API.md`); aspect-lock default; max size/dimension caps.

## Story 11.3: Clipboard paste into a textbox or image block (SPIKE-FIRST) (item 9)

> User request: "support copy/paste from the clipboard: if it is an image, attach it as an image block; if it is text, attach it as a textbox block." A paste gesture that routes by clipboard content type onto the Story 11-1 textbox and Story 11-2 image blocks. SPIKE-FIRST on the Clipboard API + paste-target resolution. Proposed reader **FR-30-reader** (finalize in the PRD addendum). Depends on Stories 11-1 and 11-2.

As a reader,
I want to paste from my clipboard onto the page,
So that copied text lands as a textbox and a copied image lands as an image block, without a separate tool step.

**Acceptance Criteria:**

**Given** the story
**Then** it STARTS with a spike: prototype reading the paste payload (`ClipboardEvent`/async Clipboard API), classifying image vs text, and resolving WHERE the block lands (the paste point vs the current view center), validating the permission/security path in the same-origin app before the full build (item 9, proposed FR-30-reader)

**Given** clipboard TEXT
**When** I paste onto the page
**Then** a textbox block (Story 11-1) is created containing that text, through the command path (item 9, proposed FR-30-reader, AR-7)

**Given** a clipboard IMAGE
**When** I paste onto the page
**Then** an image block (Story 11-2) is created from those bytes, through the same storage decision Story 11-2 made, through the command path (item 9, proposed FR-30-reader, AR-7)

**Given** paste
**Then** it is undoable/redoable as one step, respects focus (a paste into an editing textarea inserts text normally, not a new block), and degrades gracefully when the clipboard is empty or an unsupported type (no crash, no ghost block) (FR-16, UX-DR)

**Given** the paste flow
**Then** it is live-smoked at DPR>1 with both a copied text passage and a copied image, confirming the right block type and placement

> **Out of scope:** pasting rich HTML as formatted text (paste as plain text); multi-item clipboard payloads (create-story call); copying a Paper Mate mark to the clipboard (the reverse direction). **Open design calls for create-story:** placement (caret/pointer vs view center); the permission model for the async Clipboard API; precedence when the clipboard carries both text and image.
