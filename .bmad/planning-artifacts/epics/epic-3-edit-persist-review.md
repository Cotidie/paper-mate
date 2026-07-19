# Epic 3: Edit, persist & review

Make the annotated record durable and curatable: select, move, resize, restyle, re-edit, undo/redo, and delete — all through one command stack — plus autosave to disk with exact restore on reopen, and the Annotation Bank (list + click-to-jump).

## Story 3.1: Edit annotations (command path)

As a reader,
I want to select and edit a mark (move, resize, restyle, re-edit text),
So that I can refine annotations after creating them.

**Acceptance Criteria:**

**Given** cursor mode
**When** I click an annotation
**Then** it is selected with drag handles (IP-6, UX-DR14)

**Given** a selected annotation
**When** I drag a handle
**Then** it moves/resizes and the new geometry re-normalizes against the page box via the anchor service (FR-15, AR-4)

> Move/resize MUST cover EVERY mark geometry, not just text rects: a `kind=path` pen stroke (Story 2.8) moves by TRANSLATING all its normalized `points` (resize = scaling them); `kind=rect` marks move/resize the rect; `kind=text` marks per the run. (User feature request 2026-06-29 "pen movable when selected" → routed here, kept in 3.1 so move goes through the one command path + undo, AR-7, rather than a one-off pen mover.)

> **Deferred-work additions folded into 3.1 (2026-06-30 correct-course):**
> - **Memo CORNER drag-resize is the user's priority piece** (deferred-work 2026-06-29): a selected memo exposes corner handles for free resize (and body-drag to move). This is the memo case of the move/resize AC above — route it through the command path here, NOT the client-only 2.9 mutation. (The memo's transparent/no-color VISUAL treatment is a separate design slice → Epic 4 Story 4.3.)
> - **Route memo/comment text re-edit through the command path** (Story 2.9 code-review follow-up, dismissed for 2.9): the double-click re-edit AC above is the one command boundary for memo body, comment body, recolor, restroke, resize, and delete — no special-case client mutation survives once 3.1 lands.
> - **Cross-type unified hit-layer** (Story 2.7 deferred, MED): selection currently can't honor recent-wins ACROSS the two paint groups (an underline always hit-tests above a highlight on the same run). When 3.1 builds multi-type selection, separate hit-testing from the visual opacity grouping (one transparent `created_at`-ordered hit layer; paint groups stay `pointer-events:none`). Ties into Epic 5's structural refactor — coordinate.

**Given** a selected annotation
**When** I re-open its quick-box
**Then** I can restyle the color; double-clicking a text/memo/comment annotation re-edits its text (FR-15, IP-6)

**Given** any edit (move/resize/restyle/retext)
**Then** it flows through the single client command stack; no component mutates annotations outside the command path (AR-7)

**Given** the editing state
**Then** handles and the restyle affordance show, and the canvas never reflows (UX-DR16, NFR-1)

## Story 3.2: Undo / redo

As a reader,
I want undo and redo,
So that I can reverse mistakes freely.

**Acceptance Criteria:**

**Given** a sequence of creates/edits/deletes
**When** I press `Ctrl Z` / `Ctrl Shift Z`
**Then** each is reversed/reapplied via the command stack (FR-16, AR-7, UX-DR15)

**Given** undo/redo
**Then** it is client-only, in-memory, and discarded on reload (AR-7)

**Given** a quick-box restyle reopen
**Then** it is itself a command and is undoable (AR-7)

## Story 3.3: Delete annotation

As a reader,
I want to delete a mark,
So that I can remove ones I no longer want.

**Acceptance Criteria:**

**Given** a selected annotation
**When** I press `Del`/`Backspace`
**Then** it is removed via the command path and leaves the canvas (FR-17, AR-7, UX-DR15)

**Given** a deleted annotation
**When** I undo
**Then** it is restored exactly (AR-7)

## Story 3.4: Autosave to disk

As a reader,
I want changes to save themselves,
So that I never think about saving.

**Acceptance Criteria:**

**Given** any annotation change (create/move/resize/restyle/retext/delete)
**Then** a dirty flag is set and a debounced autosave fires (FR-21, AR-7)

**Given** autosave
**Then** the client PUTs the full current annotation set to `/api/docs/{doc_id}/annotations`, single-flight (one in-flight PUT; edits during a flight set the dirty flag and trigger a follow-up PUT after it resolves) (AR-7, AR-11)

**Given** a PUT
**Then** the storage module overwrites `annotations.json` (whole-document) via atomic temp + rename, carrying `schema_version`; the backend has no history/undo/edit logic (AR-7, AR-8)

**Given** saving
**Then** `{component.save-indicator}` shows "Saving…" then "Saved" (success flash, settling to muted) (UX-DR12, UX-DR16, UX-DR18)

**Given** a save failure
**Then** `{component.toast}` shows "Couldn't save — changes kept in this session." and changes persist in session, retried on the next change (UX-DR13, UX-DR16, NFR-4)

## Story 3.5: Restore on reopen

As a reader,
I want every mark back exactly where I left it,
So that my annotated record is durable across sessions.

**Acceptance Criteria:**

**Given** a previously annotated PDF
**When** I open it
**Then** the client GETs `/api/docs/{doc_id}/annotations`, hydrates the store keyed by `id`, and renders every mark (FR-22, AR-6, AR-8)

**Given** restored marks
**Then** each re-renders at its exact PDF coordinates across all zoom levels (FR-22, NFR-3)

**Given** `annotations.json` with an unknown `schema_version`
**Then** the storage module rejects or migrates it rather than guessing (AR-8)

**Given** the prior session
**Then** every mark is present and nothing is silently lost (NFR-4)

## Story 3.6: Annotation Bank

As a reader,
I want a panel listing every mark with click-to-jump,
So that I can review and recall annotations instantly.

**Acceptance Criteria:**

**Given** a loaded document
**When** I press `Ctrl B` or the top-bar toggle
**Then** `{component.annotation-bank-panel}` (320px) opens/closes as a right overlay, never reflowing the canvas (FR-18, UX-DR9, NFR-1)

**Given** annotations exist
**Then** the Bank lists each as `{component.bank-list-item}` — type glyph + color dot + snippet + page — ordered by `created_at` ascending (FR-19, UX-DR9, AR-12)

**Given** no annotations
**Then** it shows "No annotations yet." (UX-DR9, UX-DR18)

**Given** a Bank row
**When** I click it
**Then** the canvas jumps to the annotation and the target flashes (degrading to instant under `prefers-reduced-motion`) (FR-20, UX-DR9, UX-DR17)

## Story 3.7: Convert highlight ↔ comment

> Added 2026-06-30 via correct-course (deferred-work 2026-06-29, user request). A highlight and a text-comment are nearly the same mark (both `kind=text`; a comment is a highlight with non-null `body` + pin + bubble). Cheap two-way conversion is wanted. An edit of `type`/`body` → must flow through the command path (3.1/3.2), so it sits in Epic 3.

As a reader,
I want to turn a highlight into a comment and back,
So that I can add a note to a mark (or drop the note) without re-creating it.

**Acceptance Criteria:**

**Given** a selected highlight
**When** I choose "Turn into comment" in its quick-box
**Then** its `type` flips `highlight → comment` and `body` goes `null → ""` (gains a pin + opens the bubble); the `kind=text` anchor/rects are UNCHANGED; a two-page highlight converts ALL `group_id` siblings together (FR-27, AR-5)

**Given** a `kind=text` comment whose `body` becomes empty
**When** I deselect
**Then** it reverts to `type=highlight`, `body=null` (drops the pin/bubble); resolve the interaction with Story 2.10 Decision 5 (empty comment kept) and the empty-memo cleanup — a `kind=rect` comment (bare pin) is out of this revert (FR-27)

**Given** the conversion
**Then** it flows through the single command stack (do/undo, AR-7) via a `type`+`body` action (e.g. `retypeAnnotation`); no contract/anchor-MODEL change (`type` union + nullable `body` already exist); live-smoke a converted two-page mark at DPR>1 (NFR-3)

## Story 3.8: Adjust an annotation's text range

> Added 2026-06-30 via correct-course (deferred-work 2026-06-29, user request). Extend/shrink the run a text-anchored mark covers after creation. An anchor EDIT → command path, so Epic 3.

As a reader,
I want to drag a text mark's start/end to cover more or fewer words,
So that I can fix a highlight/underline/comment range without redrawing it.

**Acceptance Criteria:**

**Given** a selected text-anchored mark (highlight/underline/comment)
**When** I drag a start/end handle
**Then** the covered text is re-resolved and the `kind=text` anchor (`rects` + `text`) rebuilt to the new range via the anchor layer (`rectsFromSelection`/`collectTextRects`); pen (`kind=path`) and rect marks are OUT of scope (FR-26, AR-4)

**Given** a re-range that crosses (or stops crossing) a page boundary
**Then** the `group_id` siblings are added/removed so the mark still = one annotation per page (AR-4); this cross-page case MUST be live-smoked at DPR>1 (the recurring full-page-leak risk)

**Given** the re-range
**Then** it flows through the command stack (do/undo, AR-7); the `TextAnchor` shape is unchanged (only its `rects`/`text` values are rewritten) — no contract/anchor-MODEL change (AR-3, AR-9)
