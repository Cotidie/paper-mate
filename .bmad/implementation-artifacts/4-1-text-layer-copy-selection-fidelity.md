# Story 4.1: Text-layer copy & selection fidelity

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a reader,
I want copied text to keep its spaces and selections to look uniform,
so that copying a passage and selecting across lines behaves like a normal PDF reader.

## Context & root cause (read first)

Two user-reported bugs, one root family. Both live in the **raw pdf.js text layer** (`render/`, AD-2 custom overlay), NOT in annotation/anchor code.

1. **Copy loses spaces at line breaks** (`deferred-work.md` 2026-06-29). Selecting a passage and copying fuses the last word of each line with the first word of the next: `"networks or training"` copies as `"networks ortraining"`. `selection.toString()` is missing the inter-line whitespace.
2. **Trailing punctuation renders a thick selection band** (`deferred-work.md` 2026-06-29). When a selection includes a line-ending mark (e.g. a trailing period), that portion paints a taller/heavier `::selection` box than the rest of the run.

**Why (verified against the code):**

- `client/src/render/index.ts:371` swaps the finished text nodes in with `textLayerDiv.replaceChildren(...offText.childNodes)`. pdf.js's `TextLayer` class DOES emit a `<br role="presentation">` for each `hasEOL` text item (the inter-line separator that carries the `\n`/space into `selection.toString()`), so the brs are present in our layer.
- BUT `client/src/Reader.css:24-26` sets `.pdf-canvas .textLayer br { user-select: none; }`. That hack was added in Epic 1 to hide a stray caret-height selection sliver the brs painted in the left margin. `user-select: none` makes the browser **skip the br when building `selection.toString()`**, which drops its `\n` → adjacent lines copy with no separator → **fused words**. So the copy bug is a direct consequence of the sliver hack.
- Our custom overlay never reproduces pdf.js's viewer-level selection machinery: the **`endOfContent` element** + the **`.selecting`-class global selection listener** that pdf.js's `TextLayerBuilder` adds AFTER `TextLayer.render()`. That machinery bounds the live selection and is the strong suspect for the **trailing thick band** (the unbounded selection extends into the full-line-height end region).

**The fix, in one line:** reproduce pdf.js `TextLayerBuilder`'s post-render selection handling (`endOfContent` + the global `.selecting` listener) over our live text layer, and remove the `br { user-select: none }` hack (the vendor CSS already hides the br sliver via `br::selection { background: transparent }`). Keep it in `render/` only; no anchor/annotation change; highlight/underline geometry (per-line rects) is unaffected (AR-9/AD-9).

## Acceptance Criteria

1. **(FR-2, AR-2/AD-2) Inter-line whitespace preserved on copy.** Given a multi-line selection, when I copy it, inter-line whitespace is preserved: words that wrap across a line break do NOT fuse. `selection.toString()` matches the source text (and so does any `anchor.text` captured from a selection downstream). Verified by copying a multi-line passage from a real paper and diffing against source.
2. **(FR-2) Uniform selection band on line-ending marks.** Given a selection that includes a line-ending mark (e.g. a trailing period), its `::selection` band is the same height/weight as the rest of the run — no thick/tall band.
3. **(AR-9/AD-9) Fix is `render/`-only and geometry-preserving.** The fix reproduces pdf.js's text-layer copy/selection handling (EOL whitespace + `endOfContent`, mirroring `TextLayerBuilder`) and lives in `render/` only. No import from `anchor/`, `annotations/`, or `store/` is added. Highlight/underline geometry (per-line rects via `anchor/collectTextRects`) is unchanged; existing highlights/underlines still paint correctly at DPR>1.
4. **De-flake the Ctrl+wheel test (co-located cleanup).** The pre-existing flaky `Reader.test.tsx` Ctrl+wheel test (`"ignores plain wheel, and a Ctrl+wheel with deltaY===0 (no zoom-out)"`, `client/src/Reader.test.tsx:390`) is de-flaked: flush the wheel-binding `useEffect` before dispatching the synthetic wheel (or assert via `waitFor`) so the document-level listener is guaranteed bound when the event fires. It must pass deterministically across repeated runs.
5. **No leak / lifecycle-safe.** The global selection listener is registered once (shared across all page cards) and torn down cleanly; a card leaving the live window (`live=false` → `textRef.replaceChildren()`, `Reader.tsx:703-714`) and `renderPage(...).cancel()` must NOT leave a stale text-layer div registered in the listener's registry. No console errors, no accumulating `document` listeners across scroll/zoom.
6. **Tests + typecheck + build green.** `cd client && npm test` and `npm run typecheck` pass; `npm run build` succeeds. Any new `render/` export is mirrored in BOTH `vi.mock("./render")` barrels (`App.test.tsx`, `Reader.test.tsx`) in the same change (Epic-1 retro rule).

## Tasks / Subtasks

- [ ] **Task 1 — Decide the adopt strategy (AC: 1, 2, 3).** (AD-2 "adopt stable solutions, don't reinvent".)
  - [ ] `TextLayerBuilder` IS exported: `import { TextLayerBuilder } from "pdfjs-dist/web/pdf_viewer.mjs"` (confirmed: `pdf_viewer.mjs` export line). Its selection code is `pdf_viewer.mjs:6195-6403`.
  - [ ] **Recommended (Option B, smallest correct change):** keep our offscreen-`TextLayer` + atomic-swap flicker-free render (Epic 1 invariant — do NOT regress it), and reproduce ONLY `TextLayerBuilder`'s post-render bits over our LIVE `textLayerDiv`: append the `endOfContent` div after the swap, and register the shared global `.selecting` selection listener. Extract this into a small OOP module `client/src/render/textSelection.ts` (e.g. a `TextSelectionController` with `register(div): () => void` mirroring `TextLayerBuilder`'s static `#textLayers` Map + `#enableGlobalSelectionListener` / `#removeGlobalSelectionListener` at `pdf_viewer.mjs:6299-6402`). This keeps `render/index.ts` lean and the listener testable in isolation.
  - [ ] Rejected as primary — Option A (let `TextLayerBuilder` own the div): TLB renders into and manages its own `this.div` and binds the listener to THAT div, which conflicts with our persistent-node atomic-swap design (the live node ≠ TLB's div, so its registry keys the wrong element). Only pursue if B proves insufficient; if so, restructure so the card's live text node IS the TLB div and TLB's `hide()/show()/update()` replace our manual swap — larger change, must preserve flicker-free zoom.
- [ ] **Task 2 — Add `endOfContent` + `.selecting` machinery (AC: 1, 2, 5).**
  - [ ] In `renderPage`'s post-swap block (`render/index.ts:345-372`), after `replaceChildren`, append `<div class="endOfContent">` to `textLayerDiv` and `register(textLayerDiv)` with the controller. Mirror the reset/reposition logic at `pdf_viewer.mjs:6315-6398` (pointerdown/up, blur, keyup, selectionchange → toggle `.selecting`, move `endOfContent` to bound the selection).
  - [ ] Return the `unregister` cleanup from the controller and call it from `renderPage(...).cancel()` (`render/index.ts:379-383`) AND ensure the PageCard release path (`Reader.tsx:711` `textRef.current?.replaceChildren()`) does not orphan a registered div. Prefer: `cancel()` unregisters; also unregister defensively if the div is emptied. (AC 5.)
  - [ ] The optional `copy` handler (`pdf_viewer.mjs:6292-6298`, `normalizeUnicode`) is not required for AC 1 once brs are selectable again — include it only if a smoke shows residual unicode issues. Keep scope minimal.
- [ ] **Task 3 — Remove the br hack + reconcile CSS specificity (AC: 1, 2, 3).**
  - [ ] Delete `.pdf-canvas .textLayer br { user-select: none; }` (`Reader.css:17-26`, drop the block + comment). The vendor `pdf_viewer.css:729 br::selection { background: transparent }` already suppresses the br sliver's paint while keeping the br selectable (so its `\n` returns to copy).
  - [ ] **CSS-specificity gotcha (verify live):** our `.pdf-canvas .textLayer ::selection { background: var(--color-text-selection) }` (`Reader.css:10-15`) has higher specificity `(0,2,1)+pe` than the vendor `br::selection` `(0,1,2)+pe`, so our tint would REPAINT the br sliver after the hack is removed. Add `.pdf-canvas .textLayer br::selection { background: transparent }` (and the `-moz` twin) to re-suppress it, OR scope our tint to glyph spans (`.pdf-canvas .textLayer span::selection`). Choose one; smoke that no left-margin sliver returns.
  - [ ] **Decide (design point):** whether to gate our visible tint on the active-selection class (`.pdf-canvas .textLayer.selecting ::selection { ... }`) to match pdf.js semantics (tint only while dragging, paired with the `endOfContent` bound). Smoke both trailing-band and normal multi-line selection to pick. Keep all values token-driven (`--color-text-selection`); raw hex/px only in `src/theme/**` (`no-raw-values.test.ts`).
- [ ] **Task 4 — De-flake the Ctrl+wheel test (AC: 4).**
  - [ ] In `client/src/Reader.test.tsx:390` (`"ignores plain wheel, and a Ctrl+wheel with deltaY===0..."`), ensure the document-level wheel listener (bound in a `useEffect`) is flushed before the synthetic `wheel` dispatch. Options: `await waitFor(...)` on a state that proves the effect ran, or wrap the dispatch+assert in `waitFor`, or `await act(async () => {})` after mount. Do NOT weaken the assertion. Run it repeatedly (`npm test -- Reader` a few times) to confirm determinism. See the non-flaky sibling at `Reader.test.tsx:410-421` (already uses `waitFor`) for the pattern.
- [ ] **Task 5 — Verify (AC: 1-6).**
  - [ ] `cd client && npm test && npm run typecheck && npm run build`.
  - [ ] If any `render/index.ts` export was added, update BOTH `vi.mock("./render")` barrels (`App.test.tsx`, `Reader.test.tsx`) in this change (Epic-1 retro rule).
  - [ ] **Live smoke (mandatory — jsdom cannot see real selection geometry or clipboard):** run YOUR OWN dev servers (fresh `uvicorn` + `vite dev`, do NOT reuse a user-launched/Docker server), open a real multi-column paper, and:
    - Copy a multi-line passage → paste into a text editor → diff against source (no fused words). (AC 1)
    - Select through a line-ending period → the band is uniform, no thick box. (AC 2)
    - Confirm no left-margin selection sliver returned. (Task 3)
    - Confirm existing highlights/underlines still paint per-line and don't leak to full-page. (AC 3)
    - **Do all of the above at DPR>1 AND with a CROSS-PAGE selection** ([[verify-on-hidpi-and-real-host]]; the recurring full-page-leak/DPR class of bug is invisible in jsdom).
  - [ ] Fill the Dev Agent Record (model, debug log, completion notes, File List) before flipping status (AE3-2).

## Dev Notes

### Exact source references (verbatim, on-disk)

- **The bug site:** `client/src/render/index.ts:312-385` (`renderPage`). Text layer built at `:334-343` (`new TextLayer({ ... disableNormalization: true })` into a detached `offText`), swapped in at `:361-371`. Line `:371` `textLayerDiv.replaceChildren(...offText.childNodes)` is where the nodes land — append `endOfContent` + register the listener right after. `cancel()` at `:379-383`.
- **The CSS to remove/reconcile:** `client/src/Reader.css:5-26` — our token `::selection` tint (`:10-15`) and the `br { user-select: none }` hack (`:17-26`).
- **The reference implementation to mirror:** `client/node_modules/pdfjs-dist/web/pdf_viewer.mjs:6195-6403` (`class TextLayerBuilder`). Key parts: `endOfContent` create+append+`#bindMouse` at `:6252-6255`; `#bindMouse` (per-div mousedown/copy + registry insert) at `:6281-6301`; the shared global listener (`#enableGlobalSelectionListener`) with the `reset` closure + pointerdown/up/blur/keyup + the `selectionchange` handler that repositions `endOfContent` at `:6309-6402`.
- **The vendor CSS you rely on (already imported at `render/index.ts:21`):** `client/node_modules/pdfjs-dist/web/pdf_viewer.css:719-746` — `::selection { background: transparent }`, `br::selection { background: transparent }`, `.endOfContent { position:absolute; inset:100% 0 0 }`, `&.selecting .endOfContent { top:0 }`. This CSS is why appending `endOfContent` + toggling `.selecting` "just works" without hand-authoring `.textLayer` rules.
- **The flaky test:** `client/src/Reader.test.tsx:390-408`. Non-flaky sibling pattern: `:410-421`.
- **PageCard lifecycle (do not break):** `client/src/Reader.tsx:651-786`. Offscreen render + atomic swap is the Epic-1 flicker-free-zoom invariant; the text layer is a transparent selection overlay over the canvas (`:684-696`). Release on `live=false` at `:703-714`.

### Architecture constraints (guardrails)

- **AD-2 / AR-2:** raw `pdfjs-dist` 6.0.x + custom overlay (NOT pdf.js's built-in annotation layer). Reusing `TextLayerBuilder`'s *selection primitive* is squarely the "adopt stable solutions, don't reinvent" principle applied UNDER the custom-overlay choice — it does not violate AD-2. [Source: ARCHITECTURE-SPINE.md#AD-2; epics.md AR-2]
- **AD-9 / AR-9 (boundary invariants):** `render/` renders pixels + a selectable text layer and knows NOTHING about annotations — no import from `anchor/`, `annotations/`, `store/`, and no normalize↔screen math. This story stays entirely within that boundary. [Source: epics.md AR-9; render/index.ts:1-6]
- **AD-4 / AR-4 (anchor model) — unaffected:** highlight/underline geometry is per-line normalized rects produced by the anchor service (`collectTextRects`), independent of copy/`::selection` behavior. Do not touch it. Cross-page selections split into one anchor per page sharing `group_id` — the reason cross-page live smoke matters. [Source: epics.md AR-4; CLAUDE.md "Selection→rects must measure text nodes"]
- **NFR-3 anchor fidelity / NFR-1 layout stability:** the fix must not shift layout or change where marks land. [Source: ARCHITECTURE-SPINE.md; epics.md]
- **pdfjs-dist version:** `6.0.227` (installed). `TextLayerBuilder` and the CSS above are from this exact version — do not assume a different API.

### Testing standards

- Frontend: Vitest + jsdom (`cd client && npm test`), typecheck `npm run typecheck`, build `npm run build`.
- **jsdom limits:** it zeroes `getClientRects()` and has no real `::selection` paint or clipboard. So AC 1/2 are **live-smoke** ACs, not unit tests — do NOT fake them in jsdom. A thin unit test on the extracted `TextSelectionController` (register/unregister bookkeeping, listener add/remove counts) is worthwhile and jsdom-safe. The de-flake (AC 4) is the concrete jsdom test change.
- Keep `render/` mocks in sync: any new `render/index.ts` export must be added to BOTH `vi.mock("./render")` barrels in the SAME change or every Reader/App test breaks (Epic-1 retro).

### Project Structure Notes

- New file (recommended): `client/src/render/textSelection.ts` (+ optional `textSelection.test.ts`). Stays inside `render/` (owns the text layer). No new dependency (`TextLayerBuilder` ships in `pdfjs-dist`).
- Edited: `client/src/render/index.ts` (wire endOfContent + register/unregister into `renderPage`/`cancel`), `client/src/Reader.css` (remove br hack, reconcile `::selection` specificity), `client/src/Reader.test.tsx` (de-flake). No backend change → no OpenAPI/contract regen, no `docs/API.md` change.
- **No em-dash in any user-facing string** (there are none in scope, but check any new comment-adjacent copy). Raw hex/px only under `src/theme/**` (`no-raw-values.test.ts`).

### Versioning

- Story done (PR merged) → **PATCH +1**: `0.3.0` → `0.3.1` in `server/pyproject.toml` `[project].version` (single source; `test_version.py` asserts `pyproject`↔`uv.lock` match, so run `uv lock` / keep them in sync). Bump once at done, not per commit. Epic 4 completing later → `0.4.0`. [Source: CLAUDE.md#Versioning]

### References

- [Source: .bmad/implementation-artifacts/deferred-work.md — "Bug: copied text loses spaces at line breaks (2026-06-29)"; "Bug: trailing punctuation renders a thick selection band (2026-06-29)"; "Flaky Reader.test.tsx Ctrl+wheel test"]
- [Source: .bmad/planning-artifacts/epics.md#Story-4.1 (lines 884-905); Epic 4 preamble (lines 880-882)]
- [Source: .bmad/planning-artifacts/architecture/architecture-paper-mate-2026-06-28/ARCHITECTURE-SPINE.md#AD-2, #AD-4, #AD-9]
- [Source: .bmad/planning-artifacts/epics.md AR-2 (line 85), AR-4 (line 87), AR-9 (line 92)]
- [Source: client/node_modules/pdfjs-dist/web/pdf_viewer.mjs:6195-6403 (TextLayerBuilder); pdf_viewer.css:719-746]
- [Source: CLAUDE.md — "Engineering principles" (adopt stable solutions, document-level handlers, keep render mocks in sync, launch your own dev servers, selection→rects measure text nodes)]

## Dev Agent Record

### Agent Model Used

<!-- Use Sonnet 5 xHigh for dev-story implementation (CLAUDE.md "Model per job"). -->

### Debug Log References

### Completion Notes List

### File List
