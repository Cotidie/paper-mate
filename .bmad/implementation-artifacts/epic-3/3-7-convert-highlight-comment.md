---
baseline_commit: ed930a0a02430601a787ce7247496bb56382afd9
---

# Story 3.7: Convert highlight ↔ comment

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a reader,
I want to turn a highlight into a comment and back,
so that I can add a note to a mark (or drop the note) without re-creating it.

## Acceptance Criteria

**AC1 — Highlight → comment (forward, explicit)**
Given a selected text highlight (`type=highlight`, `anchor.kind=text`)
When I choose "Turn into comment" in its quick-box
Then its `type` flips `highlight → comment` and `body` goes `null → ""`; it gains a pin and opens the bubble; the `kind=text` anchor/`rects` are UNCHANGED; a two-page highlight converts ALL `group_id` siblings together (FR-27, AR-5).

**AC2 — Comment → highlight (reverse, explicit)**
Given a selected text comment (`type=comment`, `anchor.kind=text`)
When I choose "Turn into highlight" in its bubble
Then its `type` flips `comment → highlight` and `body` goes to `null` (drops the pin/bubble, even if it held a note — the drop is undoable via the command stack, no confirm); the `kind=text` anchor/`rects` are UNCHANGED; a two-page comment converts ALL `group_id` siblings together (FR-27, AR-5). There is NO auto-revert on deselect: an empty comment is KEPT (Story 2.10 Decision 5 stays unchanged); comment → highlight happens ONLY via this explicit action.

**AC3 — Command path + no contract change**
Given either conversion (forward or reverse)
Then it flows through the single client command stack (do/undo, AR-7) via a `type`+`body` store action (`retypeAnnotation`); no component mutates the annotation outside that action (AE-3). There is NO contract/anchor-MODEL change (the `type` union already includes `highlight`/`comment`; `body` is already nullable). A converted two-page mark is live-smoked at DPR>1 (NFR-3).

## Tasks / Subtasks

- [x] **Task 1 — Store: `retypeAnnotation` command action (AC1, AC2, AC3)**
  - [x] Add `retypeAnnotation(ids: string[], type: Annotation["type"], body: string | null, now: string)` to `client/src/store/index.ts`, mirroring `recolorAnnotation`: route through the existing `patchAnnotations(state.annotations, ids, now, apply)` helper so it (a) is group-aware via the `ids` the caller passes, (b) bumps `updated_at`, (c) preserves the Map ref when nothing changes (zundo no-op suppression), and (d) records ONE undo step automatically (the temporal middleware already tracks the `annotations` Map — no manual history push).
  - [x] `apply` sets BOTH fields on the mark: `{ ...a, type, body }`. No `kind`/anchor mutation (AD-5: geometry-on-kind, style/type only).
  - [x] Add the action to the `AnnotationStore` interface/type and export it via the store's public surface like the sibling `retextAnnotation`.
  - [x] Unit tests in `client/src/store/index.test.ts`: type+body flip both directions; group-aware (two ids → both flip in one Map); unknown/absent id is a no-op (Map ref unchanged); one `pastStates` entry per call and `undo()` restores the prior `type`+`body` exactly.

- [x] **Task 2 — Forward: "Turn into comment" quick-box action (AC1)**
  - [x] In `client/src/annotations/gestures/useSelection.ts` add a `convertSelected()` callback: `retypeAnnotation(selectedGroupIds(), "comment", "", new Date().toISOString())`. Do NOT clear the selection (the mark stays selected so its bubble opens). Reuse the existing `selectedGroupIds()` (already group-aware). Wire `retypeAnnotation` in via `useAnnotationStore((s) => s.retypeAnnotation)` and expose `convertSelected` on `SelectionApi`.
  - [x] In `client/src/annotations/AnnotationInteraction.tsx` destructure `convertSelected` from `selection` and render a new `role="menuitem"` button INSIDE the generic selection quick-box JSX (the `showSelectionBox && selectedAnno && selectedSpec` block, ~lines 617-651), placed before the delete action with a `quick-box__divider`. Gate it to a TEXT highlight only: `selectedAnno.type === "highlight" && selectedAnno.anchor.kind === "text"`. Icon: `ChatCircle` (already imported in this file); `aria-label="Turn into comment"`, `title="Turn into comment"`, `data-testid="quick-box-convert-comment"`, icon-only to match the existing icon-only quick-box chrome. No em-dash in any string.
  - [x] After conversion the mark is `type=comment` → its descriptor `usesBubble` is `true` → the generic box gates OFF and `AnnotationLayer.renderComment` mounts the bubble for the still-selected mark (verify, no extra wiring needed).

- [x] **Task 3 — Reverse: "Turn into highlight" bubble action (AC2)**
  - [x] Add a `role="menuitem"` "Turn into highlight" button to the comment bubble's `__actions` row in `client/src/annotations/CommentBubble.tsx` (beside the existing `ColorSwatchRow` + delete). New prop `onConvertToHighlight: () => void`. Icon: `Highlighter` (import from `@phosphor-icons/react`, same glyph the rail uses); `aria-label="Turn into highlight"`, `title="Turn into highlight"`, `data-testid="comment-convert-highlight-${anno.id}"`. No em-dash. **Gate: render the button only for a `kind=text` comment** (`anno.anchor.kind === "text"`) — a `kind=rect` bare pin has no text-highlight counterpart (the forward is text-only), so it offers no convert. Pass `undefined`/omit the handler for rect comments, or guard the render on the kind.
  - [x] Wire the handler in `client/src/annotations/AnnotationLayer.tsx` where `CommentBubble` is rendered (renderComment): add `const retypeAnnotation = useAnnotationStore((s) => s.retypeAnnotation)` and pass `onConvertToHighlight={() => retypeAnnotation(commentGroupIds(a), "highlight", null, new Date().toISOString())}`. Reuse the existing `commentGroupIds(a)` (already group-aware, same-doc, `type=comment`). The `body` drops to `null` unconditionally (even a non-empty note) — highlights carry no body; it is undoable.
  - [x] The bubble mounts only for a selected comment, and the button is further gated to `kind=text` (above), so the action targets exactly the text-comment ⇄ text-highlight round-trip. After conversion the mark is `type=highlight` (usesBubble=false) → the bubble unmounts and the generic selection quick-box shows for the still-selected highlight (symmetric with the forward path). No selection clear.
  - [x] Do NOT touch the empty-memo cleanup watcher (`prevSelectedRef` effect, ~lines 368-375): there is no auto-revert. An empty comment is kept on deselect (Decision 5 unchanged).
  - [x] Tests: `CommentBubble` renders the convert button and calls `onConvertToHighlight` on click; an `AnnotationLayer` (or store-level) test that convert flips `type=comment → highlight` and `body → null` group-aware, dropping a non-empty body; a regression asserting an empty comment is NOT auto-reverted on deselect (memo cleanup still deletes empty memos).

- [x] **Task 4 — Regression: persistence + undo/redo integration (AC3)**
  - [x] Confirm (no new code expected) that a `retypeAnnotation` change flows to Story 3.4 autosave automatically: it mutates the `annotations` Map, which the autosave subscription watches, so the converted mark PUTs and survives a reload (Story 3.5 restore renders it at its persisted `type`). A persisted empty-body comment restores as a comment (no auto-revert) — correct. (Verified: `useAutosave.ts` watches `annotations` generically via `useAnnotationStore((s) => s.annotations)` and PUTs `all()`, no per-action branching; `server/app/models.py` `Annotation.type`/`body` are already the full union/nullable, and `routes/docs.py` GET/PUT operate on `list[Annotation]` with no per-type logic — no server change needed.)
  - [x] Confirm undo/redo (Story 3.2) reverses each conversion as one step (forward convert; a typed-body edit session; explicit reverse convert are distinct commands). (Verified via a new regression test in `client/src/store/index.test.ts`: three sequential commands push three separate `pastStates` entries and three `undo()` calls unwind them one at a time.)

- [x] **Task 5 — Version + docs**
  - [x] Bump `server/pyproject.toml` `[project].version` `0.2.8 → 0.2.9` and sync `uv.lock`. No `docs/API.md` / `openapi.json` / `schema.d.ts` change (assert byte-identical — no contract touch). (Verified: backend suite 67/67 green; re-ran `export_openapi` + `gen:api`, `git status` shows zero diff on `openapi.json` and `schema.d.ts`.)

- [x] **Task 6 — Live smoke at DPR>1, cross-page (AC1, AC2, AC3 / NFR-3, AE-5)**
  - [x] Launch YOUR OWN fresh servers (uvicorn + vite dev on alternate ports), DPR ≥ 1.5. Create a TWO-PAGE text highlight. "Turn into comment" → both `group_id` siblings become comments, exactly ONE bubble shows. Type a note, deselect → stays a comment on both pages (persisted). Reselect, "Turn into highlight" → both siblings revert to highlight, the note dropped, ONE undo step. Also verify: convert to comment, deselect WITHOUT typing → the empty comment is KEPT (no auto-revert). Undo/redo each transition. Verify programmatically (DOM `type`/testids), not only visually. Shut the servers down after.
    - Ran on `uvicorn` (port 8010, scratch `PAPER_MATE_DATA`) + `vite` (port 5183, `PAPER_MATE_API_TARGET` pointed at 8010), driven via chrome-devtools MCP at `1280x900x2` (DPR=2). Built the cross-page selection via `Selection.setBaseAndExtent` across two REAL `.page-surface` text layers (26 live `getClientRects()`, 5 on page0/19 on page1) then dispatched a real `pointerup` — the app's own `rectsFromSelection`/`collectTextRects`/`buildAnnotations` ran unmodified against genuine DPR=2 layout; only the selection's origin (API call vs. mouse pixels) is synthetic, not the geometry pipeline this story's AE-5 risk is about.
    - Verified via DOM testids AND the real backend GET (not just visuals): two annotations, `group_id` shared, `page_index` 0/1, forward convert flips both to `type=comment`/`body=""`, exactly one `.comment-bubble` mounts; typed note round-trips to `body` on BOTH siblings (persisted, confirmed via `GET .../annotations`); reverse convert flips both back to `type=highlight`/`body=null` (confirmed persisted); an empty comment survives Esc-deselect on both the DOM and the backend (no auto-revert).
    - Undo/redo: confirmed both directions revert/reapply as one step. **Methodology finding, not a product bug:** an in-page `dispatchEvent`/`.click()` (untrusted) does NOT reproduce a real click's browser-default focus shift, so clicking "Turn into highlight" while its bubble's textarea holds focus looked like a dropped undo entry under untrusted events. Re-tested with the MCP `click`/`press_key` tools (real trusted CDP input, matching how `AE-5`'s "real mouse" caveat in [[verify-on-hidpi-and-real-host]] applies beyond geometry to focus semantics too) and undo/redo both worked correctly; a stray follow-up "redo did nothing" was the app's OWN intentional `isEditable` exemption (Ctrl+Z/Y inside a focused textarea defers to native text-undo) — moving focus off the textarea first (Esc) made redo fire normally. No code change required.

### Review Findings

Cross-model review (Codex, `bmad-code-review`, diff `ed930a0..HEAD`): Blind Hunter + Edge Case Hunter + Acceptance Auditor, no failed layers. 0 decision-needed, 1 patch (low), 0 deferred, 3 dismissed as noise, 0 High/Med.

- [x] [Review][Patch] Reverse conversion could leave the generic quick-box hidden after a scroll [client/src/annotations/gestures/useSelection.ts:105-112] — a scroll closes `selectionBoxOpen` without changing `selectedId`; reverse convert also keeps `selectedId` unchanged, so a scroll-then-reverse-convert sequence left the mark selected as a highlight with no visible quick-box (data was still correct; the bubble, unlike the generic box, doesn't gate on that flag, so only the reverse direction was affected). Fixed: added `selectedAnno?.type` to the box-open effect's dependency array so a `type` flip re-derives `selectionBoxOpen` too. Regression test added and confirmed RED before the fix, GREEN after (`AnnotationInteraction.test.tsx`, "reverse convert reopens the generic quick-box...").

## Dev Notes

### What this story is (and is NOT)

A highlight and a text-comment are the SAME mark shape: both `type ∈ {highlight, comment}` on `anchor.kind=text`, sharing the identical `rects`/`text`. The only difference is `type` + a non-null `body` (which drives the pin + bubble). So conversion is a pure `type`+`body` edit — NO new anchor, NO geometry, NO contract change. Do not build a new mark or re-resolve the selection; only flip two fields through the command path.

- **Scope IN:** text highlight (`kind=text`, `type=highlight`) ⇄ text comment (`kind=text`, `type=comment`).
- **Scope OUT:** underline (`type=underline`, not highlight → no convert button); pen; memo; region highlight (`kind=rect`) and bare-pin comment (`kind=rect`). A rect highlight is excluded because the reverse revert is `kind=text`-only, so allowing a forward rect conversion would be a one-way trap. Keep the round-trip symmetric.

### Contract is already sufficient — DO NOT touch it (AC3)

- `server/app/models.py`: `Annotation.type: Literal["highlight", "underline", "pen", "memo", "comment"]` (both values present) and `body: str | None = None` (nullable). [Source: server/app/models.py:124-132]
- Therefore no Pydantic/OpenAPI/`schema.d.ts`/`docs/API.md` change. This is a CLIENT-ONLY story (plus the version bump). Assert the generated artifacts are byte-identical, like Story 3.6 did.

### Command path (AR-7, AE-3) — reuse, don't reinvent

The store is `zundo`'s `temporal(...)` wrapper; `partialize` tracks ONLY `annotations`, and `equality` compares the Map by reference, so ANY action that returns a NEW `annotations` Map records exactly one undo entry, and a no-op that returns the same ref records none. `retypeAnnotation` is a peer of `recolorAnnotation`/`retextAnnotation` and gets undo/redo for free — do NOT hand-roll a command object or push history manually. [Source: client/src/store/index.ts:200-368]

The shared `patchAnnotations(annotations, ids, now, apply)` helper is the group-batch primitive: it iterates `ids`, applies `apply` (return the updated mark or `null` to skip), bumps `updated_at`, and preserves the Map ref when nothing changed. `recolorAnnotation` is the exact template to copy. [Source: client/src/store/index.ts:203-284]

**AE-3 compliance:** every edit converges on this one command path; add NO client-only mutation outside a store action. The reverse revert must call `retypeAnnotation` (a command), never patch the mark in the component.

### Group-awareness (AR-4)

A two-page text mark is one annotation per page linked by a shared non-null `group_id`. Both conversion directions must touch ALL siblings:
- Forward: `useSelection.selectedGroupIds()` already returns the selected mark + same-`group_id` siblings — reuse it. [Source: client/src/annotations/gestures/useSelection.ts:108-116]
- Reverse: replicate `AnnotationLayer.commentGroupIds` (same-doc, `type=comment`, same `group_id`) for the departing comment. [Source: client/src/annotations/AnnotationLayer.tsx:180-187]

### Forward action surface (AC1)

The generic selection quick-box renders for a highlight because `MARK_DESCRIPTORS.highlight.quickBox.usesBubble === false`. Add the convert button there. Once converted, `MARK_DESCRIPTORS.comment.quickBox.usesBubble === true`, so `showSelectionBox` turns false and `AnnotationLayer.renderComment` shows the bubble for the still-selected comment (mount = open, focuses its textarea) — the "gains a pin + opens the bubble" behavior comes for free from keeping `selectedId` unchanged. [Source: client/src/annotations/marks.ts:48-68; client/src/annotations/gestures/useSelection.ts:237-251; client/src/annotations/AnnotationLayer.tsx:341-377]

Quick-box JSX to extend: `client/src/annotations/AnnotationInteraction.tsx:617-651` (the `role="menu"` block; `ColorSwatchRow` + conditional rows + `quick-box__divider` + delete). Mirror the delete button's markup for the new menuitem.

### Reverse action surface (AC2) — explicit, symmetric with the forward

Reverse is an EXPLICIT "Turn into highlight" action in the comment bubble, mirroring the "Turn into comment" action on the highlight quick-box. There is NO auto-revert on deselect: an empty comment is KEPT (Story 2.10 Decision 5 stays exactly as-is, both `kind=text` and `kind=rect`). Do NOT touch the empty-memo cleanup watcher. [Source: client/src/annotations/CommentBubble.tsx:105-117; client/src/annotations/AnnotationLayer.tsx:180-187, 360-377]

The bubble mounts only for a selected comment (mount = open), so the action is intrinsically comment-scoped. Convert drops `body → null` unconditionally (a highlight has no body); this is undoable via the command stack, so no confirm — consistent with the app's Del-only-no-confirm, undo-first philosophy. After conversion the mark is `type=highlight` (its descriptor `usesBubble=false`), so the bubble unmounts and the generic selection quick-box takes over for the still-selected highlight — the exact mirror of the forward path. Keep `selectedId` unchanged.

Handler shape (in `AnnotationLayer.renderComment`, passed to `CommentBubble`):
```
onConvertToHighlight={() =>
  retypeAnnotation(commentGroupIds(a), "highlight", null, new Date().toISOString())}
```

Symmetry: highlight `--[Turn into comment]-->` comment `--[Turn into highlight]-->` highlight. Both are explicit, both group-aware, both one `retypeAnnotation` command.

### Files to touch

- `client/src/store/index.ts` — add `retypeAnnotation` (+ interface); `client/src/store/index.test.ts` — unit tests.
- `client/src/annotations/gestures/useSelection.ts` — `convertSelected` + `SelectionApi` (forward).
- `client/src/annotations/AnnotationInteraction.tsx` — render the forward "Turn into comment" menuitem; `AnnotationInteraction.test.tsx` — tests. (The empty-memo deselect watcher is UNCHANGED.)
- `client/src/annotations/CommentBubble.tsx` — add the "Turn into highlight" action + `onConvertToHighlight` prop (reverse).
- `client/src/annotations/AnnotationLayer.tsx` — wire `onConvertToHighlight` via `retypeAnnotation(commentGroupIds(a), "highlight", null, now)`; add its test.
- `server/pyproject.toml` + `server/uv.lock` — version bump.

No change expected in `create.ts`, `marks.ts`, or any anchor/render/backend file. If you find one is needed, stop and reconsider — it likely signals scope creep.

### Testing standards

- Vitest + Testing Library; run `npm test` and `npm run typecheck` from `client/`. Backend suite unaffected but keep it green: `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q`.
- **jsdom cannot see cross-page geometry (rects zero).** Unit/RTL tests cover the store flip, the button gating, and the deselect-revert LOGIC; they do NOT substitute for the DPR>1 cross-page live smoke (Task 6, AE-5). The recurring full-page/cross-page class of bug is invisible in jsdom.
- If you add any `render/index.ts` export (not expected here), update BOTH `vi.mock("./render")` barrels (`App.test.tsx`, `Reader.test.tsx`) in the same change.
- **No em-dash** in any new UI string (tooltip/aria-label/label). Grep the diff for `—` before committing.

### Project Structure Notes

- Layering (AD-9) preserved: store action (data) ← gesture hook (`useSelection`) ← component (`AnnotationInteraction`). No upward dependency; no anchor/render/api change. Client-only, no backend contract touch — consistent with Stories 3.1/3.2/3.6.
- Version: single source is `server/pyproject.toml` `[project].version`. Bump 0.2.8 → 0.2.9 (one story). [Source: CLAUDE.md#Versioning]

### References

- [Source: .bmad/planning-artifacts/epics.md#Story 3.7 (lines 839-858)] — the three ACs verbatim.
- [Source: .bmad/planning-artifacts/sprint-change-proposals/sprint-change-proposal-2026-06-30.md] — cluster C fold-in; FR-27 routed to Story 3.7.
- [Source: .bmad/planning-artifacts/epics.md#FR-27 (lines 69, 147)] — FR-27 convert highlight ↔ comment.
- [Source: server/app/models.py:124-132] — `type` union + nullable `body` (no contract change).
- [Source: client/src/store/index.ts:203-368] — `patchAnnotations`, `recolorAnnotation` template, zundo `temporal` config.
- [Source: client/src/annotations/gestures/useSelection.ts:108-173] — `selectedGroupIds`, `recolorSelected`/`deleteSelected` patterns, `SelectionApi`.
- [Source: client/src/annotations/AnnotationInteraction.tsx:362-375, 617-651] — deselect cleanup watcher; selection quick-box JSX.
- [Source: client/src/annotations/AnnotationLayer.tsx:180-187, 341-377] — `commentGroupIds`; `renderComment` pin/bubble.
- [Source: client/src/annotations/marks.ts:48-74] — `MARK_DESCRIPTORS` / `quickBoxSpec` (`usesBubble`).
- [Source: .bmad/implementation-artifacts/3-6-annotation-bank.md] — prior story: client-only pattern, cross-model Codex review, DPR-1.5 own-servers smoke, byte-identical contract assertion.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References

- Live smoke (Task 6): scratch `uvicorn` on :8010 (`PAPER_MATE_DATA` = scratchpad dir) + `vite` on :5183 (`PAPER_MATE_API_TARGET=http://localhost:8010`), driven via chrome-devtools MCP at `1280x900x2` (DPR=2) against `fixtures/sample-pdfs/09-regularization.pdf` (23 pages). Both servers shut down and scratch data dir removed after.
- Mid-smoke false alarm (resolved, no code change): an in-page `evaluate_script` `.click()`/`dispatchEvent` doesn't reproduce a real click's browser-default focus shift, which made "Turn into highlight" clicked from inside its own focused bubble textarea look like it dropped its undo entry. Re-verified with the MCP `click`/`press_key` tools (real trusted CDP input) — undo/redo both work correctly. Saved as memory `use-trusted-input-for-focus-sensitive-smoke` for future stories.

### Completion Notes List

- Task 1: Added `retypeAnnotation(ids, type, body, now)` to the store, mirroring `recolorAnnotation` via the existing `patchAnnotations` helper (group-aware, no kind guard, zundo no-op suppression for free). 4 new unit tests + 1 new undo-step test in the existing undo/redo describe block. 56→57 store tests, all green.
- Task 2: `convertSelected()` added to `useSelection`'s `SelectionApi` (does not clear selection). Rendered as an icon-only `role="menuitem"` "Turn into comment" button in the generic selection quick-box (`AnnotationInteraction.tsx`), gated to `type === "highlight" && anchor.kind === "text"`. 5 new tests (render gating for highlight/underline/region-rect, click flips store, group-aware).
- Task 3: "Turn into highlight" added to `CommentBubble`'s actions row, gated to `anchor.kind === "text"` (new `onConvertToHighlight` prop). Wired in `AnnotationLayer.renderComment` via `retypeAnnotation(commentGroupIds(a), "highlight", null, now)`. Refactored the bubble's shared icon-button CSS from `.comment-bubble__delete` to a generic `.comment-bubble__action` (both buttons use it now; first-of-type keeps the right-aligned group layout) since a second button needed the identical chrome. Did NOT touch the empty-memo cleanup watcher (memo-only, already correctly excludes comments). 5 new tests in `AnnotationLayer.test.tsx` (kind=text/rect gating, body-drop, group-aware, no-auto-revert-on-deselect regression).
- Task 4: No production code needed. Confirmed by reading `useAutosave.ts` (generic `annotations` watcher, no per-action branching) and the backend `Annotation` model/routes (already type-agnostic). Added one store-level regression test proving 3 sequential commands (convert, a paused/coalesced retext session, reverse convert) push 3 distinct undo entries that unwind one at a time.
- Task 5: `server/pyproject.toml` 0.2.8 → 0.2.9, `uv.lock` synced. Backend suite 67/67 green. Re-ran `export_openapi` + `gen:api`; `git status` showed zero diff on `openapi.json`/`schema.d.ts` (byte-identical, no contract touch, as expected for a client-only story).
- Task 6: Live-smoked at DPR=2 against a genuine two-page cross-page mark (real `Selection.setBaseAndExtent` across two live `.page-surface` text layers + a real dispatched `pointerup`, so the app's own `rectsFromSelection`/`collectTextRects`/`buildAnnotations` pipeline ran unmodified). Verified via DOM testids AND the real backend `GET`: group_id-shared pair on `page_index` 0/1, forward convert (both → `type=comment`/`body=""`, exactly one bubble), grouped retext (note lands on both siblings, persisted), reverse convert (both → `type=highlight`/`body=null`, persisted), empty-comment-kept-on-deselect (both DOM and backend). Undo/redo verified in both directions with real trusted input (see Debug Log). Full regression: backend 67/67, frontend 595/595 (35 files), typecheck clean.

### File List

- `client/src/store/index.ts` — `retypeAnnotation` action + `AnnotationStore` interface entry
- `client/src/store/index.test.ts` — unit tests for `retypeAnnotation` (flip, group-aware, no-op, undo) + 3-step undo regression
- `client/src/annotations/gestures/useSelection.ts` — `convertSelected` + `SelectionApi` export
- `client/src/annotations/AnnotationInteraction.tsx` — "Turn into comment" quick-box menuitem
- `client/src/annotations/AnnotationInteraction.test.tsx` — forward convert tests (gating, click, group-aware)
- `client/src/annotations/CommentBubble.tsx` — "Turn into highlight" action + `onConvertToHighlight` prop; `.comment-bubble__delete` → `.comment-bubble__action` class rename
- `client/src/annotations/AnnotationLayer.tsx` — wires `onConvertToHighlight` via `retypeAnnotation`
- `client/src/annotations/AnnotationLayer.test.tsx` — reverse convert tests (gating, click, group-aware, no-auto-revert regression)
- `client/src/annotations/Annotations.css` — shared `.comment-bubble__action` icon-button class (replaces `.comment-bubble__delete`)
- `server/pyproject.toml` — version 0.2.8 → 0.2.9
- `server/uv.lock` — synced to 0.2.9

## Change Log

- 2026-07-01: Story drafted (ready-for-dev). Cluster-C command-path edit (FR-27): convert a text highlight ⇄ text comment via a new `retypeAnnotation` zundo command — a `type`+`body` flip only (no anchor/contract change). Forward = a "Turn into comment" quick-box menuitem on a selected text highlight (group-aware); reverse = an empty `kind=text` comment reverts to highlight on deselect (extends the empty-memo cleanup watcher; refines Story 2.10 Decision 5, `kind=rect` bare pins still kept). Client-only; version 0.2.8 → 0.2.9.
- 2026-07-01: Review change (Wonseok): reverse made EXPLICIT and symmetric. Comment → highlight is now a "Turn into highlight" action in the comment bubble (drops `body`, group-aware, undoable), not an implicit deselect-revert. The auto-revert is dropped; the empty-memo cleanup watcher is untouched and Story 2.10 Decision 5 (empty comment kept) stands unchanged. Adds `CommentBubble.tsx` + `AnnotationLayer.tsx` to the touched files.
- 2026-07-01: Implemented (dev-story). All 6 tasks complete; all 3 ACs satisfied. Backend 67/67, frontend 595/595 (35 files), typecheck clean. Live-smoked at DPR=2 cross-page (own scratch servers) with DOM + real-backend verification. Status → review.
- 2026-07-02: Cross-model code review (Codex): 1 low patch finding (scroll-then-reverse-convert could hide the generic quick-box), 0 High/Med. Fixed in `useSelection.ts` (re-derive `selectionBoxOpen` on a mark `type` change too) with a red-then-green regression test. Backend 67/67, frontend 596/596 (35 files), typecheck clean. Status → done.
