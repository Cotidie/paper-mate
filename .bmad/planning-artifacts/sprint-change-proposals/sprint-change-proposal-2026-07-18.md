# Sprint Change Proposal — 2026-07-18

**Trigger:** 13-request user batch (reader/annotation + library), injected after Epic 8 closed out.
**Author:** Wonseok (correct-course, Batch mode)
**Scope classification:** **Moderate** (backlog reorganization — two new epics + one existing-story amendment + a recommended reader-PRD addendum for new FRs + an architecture-spine note for image blocks).

---

## Section 1 — Issue Summary

A batch of 13 user requests arrived while the sprint sat between Epic 8 (reader polish r2, all stories terminal) and Epic 9 (Phase-2 kickoff, backlog). The requests are not a single theme: they split into (a) reader/annotation **defects** shipped in Epics 2–8 that the user hit in real use, (b) small **polish** refinements to existing marks, (c) three **net-new heavyweight capabilities** (textbox, image, clipboard) that add contract/FR surface and a backend byte-storage seam, and (d) one **Library** feature that extends an already-backlogged Phase-2 story.

Evidence: user-supplied screenshots (mid-selection vs post-mouse-up color shift; double-thickened `.`/whitespace; memo bottom handles off-position; always-visible memo expand icon; dragged comment box; collapsed memo fixed size; three-level pen; Library buttons panel).

The requests must be triaged, grouped, and injected into the epic/story backlog without disturbing the terminal Epics 1–8 or the reserved Epic 9 Phase-2 line.

---

## Section 2 — Impact Analysis

### Epic impact

- **Epic 8** — housekeeping only. Story 8.9 is stuck at `review` (a negative snap-select spike, superseded by 8.11 and absorbed by 8.10's refactor). Flip 8.9 → `blocked` (attempted-and-reverted flavor) and close `epic-8 → done`.
- **New Epic 10** — Reader & annotation polish, round 3 (post-v1, Phase-1.5). Holds 8 of the 13 (defects + polish + three small persistence features) + a terminal refactor. Mostly quality-of-existing-FR; three small contract additions.
- **New Epic 11** — Annotation blocks: textbox, image & clipboard (post-v1, Phase-2). The three heavyweight items. New reader FRs; image block needs a backend byte-storage seam and an architecture-spine note; SPIKE-FIRST on the two that carry unknowns.
- **Epic 9** — Story 9.1 (download) amended in place: add multi-select → zip + a Download button on the Library buttons panel. No new story.

### Story impact (grounded in current code)

- **Items 1+2 (selection color / double-thickening):** selection rendering runs through `render/selectionBounder.ts` (Story 4.1 `endOfContent` bounding) + per-line highlight rects from `anchor/collectTextRects`. The post-mouse-up "thickening" is the created highlight fill vs the native `::selection` tint; the double-thickening over `.`/whitespace is overlapping/adjacent semi-transparent rects stacking alpha. One root-cause story (investigation-first).
- **Item 3 (memo handles):** `MemoBox` edit-frame corner-handle geometry + `resizeMemoAnnotation` (`store/index.ts`, regrows rect from the top-left anchor). Bottom handles mis-placed under a fixed min h/w. Defect.
- **Item 4 (memo expand icon):** `MemoBox` icon visibility — hide until `:hover`/`:focus-within`. CSS/JSX only.
- **Item 5 (comment box position):** `resizeCommentAnnotation` stores `bubble_width/height` in `style`; the bubble **position** is not stored (renders relative to the pin). New style field (e.g. `bubble_offset`) → contract addition. **New FR.**
- **Item 7 (quick-box placement):** quick-box positioning (`annotations/marks.ts` `usesLeftVerticalQuickBox` + the placement logic in the interaction layer). Move the popup to the **right** of the selection. Polish.
- **Item 10 (collapsed memo resize):** `setMemoCollapsed` is a boolean; the collapsed box is fixed-size. Needs a persisted collapsed dimension. **New FR** (contract addition).
- **Item 11 (remember last view):** `openDoc` restores annotations but clears all transient view state (no scroll/page memory). Needs per-doc last-page/scroll persisted + restored. **New FR.**
- **Item 12 (pen 4th level):** `activeStrokeWidth: 8` = `--pen-stroke-medium`; three `--pen-stroke-*` tokens. Add a fourth, thinner level (token + stroke-width row 3→4). AC-extension of FR-9 (pen); no new FR.
- **Item 6 (textbox tool):** new `AnnotationTool` + `MARK_DESCRIPTORS` entry; a text-only `kind=rect` mark distinct from memo styling. **New FR + new tool descriptor.**
- **Item 8 (image block):** a new anchor kind (or `rect` + image payload) and a **backend byte-storage seam** (where image bytes live: `meta.json` sidecar vs a new upload route). **New FR, SPIKE-FIRST, arch-spine note.**
- **Item 9 (clipboard paste):** a paste gesture resolving `text → textbox block` / `image → image block`. Depends on items 6 + 8. **New FR, SPIKE-FIRST** (clipboard API + paste-target resolution).
- **Item 13 (download):** amends Story 9.1 — the existing `GET /api/docs/{doc_id}/file` covers single-file; multi-select needs a zip (client-side JSZip vs a server zip route — create-story call) + a Download button on the buttons panel (Display / Move / Star / Delete / Add). AC-extension of Library FR-30.

### Artifact conflicts

- **Reader PRD** (`prds/prd-paper-mate-2026-06-28/`): needs an **addendum** for the new reader FRs (textbox, image block, clipboard paste, persist comment-box position, resizable-persisted collapsed memo, remember last view). Numbers continue from FR-27 → **FR-28..FR-33** (proposed; the addendum finalizes). Reader FR namespace is independent of the Library PRD's FR-30.
- **Architecture spine** (reader, `architecture-paper-mate-2026-06-28/`): image blocks introduce a persisted binary-asset seam not in the current annotation model — record the decision (client-embedded data-URI vs a server-stored asset id) as an arch-spine note at create-story for Story 11-2.
- **epics.md / sprint-status.yaml:** add Epic 10 + Epic 11 with backlog stories; amend Story 9.1; reconcile Epic 8 status.
- **DESIGN.md:** a fourth `--pen-stroke-*` token (Story 10-8) and, if image/textbox blocks introduce chrome, matching component tokens.
- **docs/API.md:** touched only if 11-2 (image upload) or 13 (zip) adds a route.

### Technical impact

- Epic 10 is client-only except item 11 (last-view persistence may ride `meta.json` or a client store — create-story call). Low risk, mostly localized.
- Epic 11 is the real weight: contract additions, a backend seam (11-2), and cross-mark paste routing (11-3). Two SPIKE-FIRST gates de-risk it. This is the second capability set to cross the v1 → Phase-2 line (after Epic 9).

---

## Section 3 — Recommended Approach

**Direct Adjustment** (add stories within the existing plan; no rollback, no MVP change). Split by weight, matching the precedent set by the 2026-07-11 batch (polish → Epic 8, heavyweight → Epic 9):

1. **Epic 10** first — defects + polish + three small persistence features; unblocks daily-use friction fastest. Terminal refactor story per the standing AE7-5 pattern.
2. **Epic 11** after — the heavyweight new capabilities; SPIKE-FIRST on 11-2/11-3; wants the PRD addendum + arch-spine note landed at create-story.
3. **Story 9.1** amended in place (item 13) — schedule independently of the epics (small, Library-side).
4. **Epic 8** closed out (housekeeping) in the same pass.

Rationale: keeps defects on the fastest path, isolates the contract/seam risk behind spikes, and preserves the terminal Epics 1–8 and the reserved Epic 9 line. Effort: Epic 10 ≈ 8 small/medium stories + 1 refactor; Epic 11 ≈ 3 stories, 2 spike-gated. Risk concentrated in 11-2 (backend byte storage) and 11-3 (clipboard), both gated.

---

## Section 4 — Detailed Change Proposals

### 4a. sprint-status.yaml

- `8-9-snap-empty-space-drag-to-text`: `review` → **`blocked`** (negative spike, superseded by 8-11, absorbed by 8-10).
- `epic-8`: `in-progress` → **`done`**.
- Add **Epic 10** (backlog) with stories 10-1..10-9.
- Add **Epic 11** (backlog) with stories 11-1..11-3.
- Annotate `9-1-download-paper` with the item-13 scope amendment (comment; stays `backlog`).
- Update `last_updated` + header note.

### 4b. epics.md

- Amend the **Story 9.1** block: add a multi-select-zip + Download-button AC; lift the "bulk/zip download … (create-story call)" from Out-of-scope into scope.
- Append **Epic 10** section (9 stories) and **Epic 11** section (3 stories), in the house format (narrative intro > per-story `> note` + role + ACs + Out-of-scope/Open-design-calls).

### 4c. Reader PRD addendum (RECOMMENDED — separate `bmad-edit-prd` run, not applied here)

Add the new reader FRs (proposed numbers; addendum finalizes):

- **FR-28** Textbox tool — a text-only floating block, distinct from the memo sticky.
- **FR-29** Image attachment block — upload an image from disk, placed on the page, resizable via handles.
- **FR-30** Clipboard paste to block — paste creates a textbox block (text) or an image block (image). *(reader namespace; independent of Library FR-30.)*
- **FR-31** Persist a moved comment box's position.
- **FR-32** Resizable, persisted collapsed memo box.
- **FR-33** Remember & restore last view position (page/scroll) on reopen.

Pen fourth width level (item 12) and the download-zip (item 13) are **AC-extensions** of existing FR-9 / Library FR-30, not new FRs.

### 4d. Architecture-spine note (RECOMMENDED — at Story 11-2 create-story)

Record the image-block binary-asset decision: client-embedded data-URI in the annotation model vs a server-stored asset (new upload route + `/data` asset dir). This is the one item that touches persistence/contract shape beyond a scalar field.

---

## Section 5 — Implementation Handoff

**Scope: Moderate → route to PO/DEV loop.**

Per-story pipeline (unchanged house process):
1. `bmad-create-story` (Opus High, fresh context) — one story at a time; branch per story off `main`.
2. `bmad-dev-story` (Sonnet 5 xHigh, fresh context, on the story branch).
3. `bmad-code-review` via Codex (cross-model) — resolve High/Med.
4. Merge → flip sprint-status to `done`, PATCH +1, update `docs/API.md` if a route changed.
5. Epic close → `bmad-retrospective`.

Pre-work before Epic 11 dev:
- Land the **reader-PRD addendum** (`bmad-edit-prd`) so FR-28..33 are the FR source of truth.
- Record the **image-block arch-spine note** at Story 11-2 create-story.

Success criteria: all 13 requests represented in the backlog; Epics 1–8 untouched; Epic 9 line preserved; new FRs traceable PRD → epic → story.

---

## Epic definitions (for epics.md)

### Epic 10 — Reader & annotation polish, round 3 (post-v1, Phase-1.5)

| Story | Item | Kind | FR |
|---|---|---|---|
| 10-1 Unify selection color + fix double-thickening over punctuation/whitespace | 1+2 | defect (root-cause) | FR-7/8, NFR-3 |
| 10-2 Memo resize-handle position + min-size fix | 3 | defect | FR-10/15 |
| 10-3 Hide memo expand icon until hover/focus | 4 | polish | FR-10, UX-DR |
| 10-4 Resizable, persisted collapsed memo box | 10 | feature | **FR-32** |
| 10-5 Persist a moved comment box's position | 5 | feature | **FR-31** |
| 10-6 Quick-box pops to the right of the selection | 7 | polish | FR-14, UX-DR |
| 10-7 Remember & restore last view position on reopen | 11 | feature | **FR-33**, AR-6 |
| 10-8 Pen width — four levels incl. thinner | 12 | feature (AC-ext) | FR-9 |
| 10-9 Epic 10 structural refactor (terminal, AE7-5) | — | refactor | — |

### Epic 11 — Annotation blocks: textbox, image & clipboard (post-v1, Phase-2)

| Story | Item | Kind | FR |
|---|---|---|---|
| 11-1 Plain textbox tool (text-only block) | 6 | feature | **FR-28** |
| 11-2 Image attachment block + resize handles (SPIKE-FIRST) | 8 | feature | **FR-29** |
| 11-3 Clipboard paste → textbox / image block (SPIKE-FIRST, depends on 11-1+11-2) | 9 | feature | **FR-30** |

### Epic 9 amendment

- Story 9.1 += multi-select → zip download + Download button on the Library buttons panel (item 13). AC-extension of Library FR-30.

### Epic 8 housekeeping

- 8-9 → `blocked`; `epic-8` → `done`.
