---
baseline_commit: 9b013cfebd60267618f3d25f56d8e5bc685296e5
---

# Story 2.3: Highlight text via drag

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a reader,
I want to drag across text and drop a highlight,
so that I mark passages and the page never moves.

> **This is the first real tool on the Story 2.2 foundation.** The `anchor/` service, the `Annotation` entity (Pydantic → generated TS), the Zustand `store/`, the `annotations/` overlay, the overlay state machine, and the `{component.quick-box}` SHELL already exist and are proven end-to-end. Story 2.3 is **thin**: arm a real Highlight tool from the rail + `H`, and fill the quick-box's highlight-mode contents with the `{component.color-swatch}` row so the just-landed mark can be recolored. **Do not rebuild the foundation — reuse it.**
>
> **Standing principle in force (Epic 1 retro AP-4 / PREP-1): adopt stable primitives, do NOT hand-roll.** Text rects still come from the native Selection API + `Range.getClientRects()` via the existing `rectsFromSelection`; the anchor math stays in `anchor/`. This story adds NO new coordinate math.

## Scope boundary — READ FIRST

**IN (this story):**
- A **Highlight tool** the user can arm: a rail button in `{component.tool-rail}` (`ToolRail.tsx`) + the `H` hotkey (UX-DR15). Armed-sticky: stays armed until another tool, `V`, or `Esc` (UX-DR4).
- **Create-on-release:** with the Highlight tool armed, a drag text-selection released lands a `type=highlight` text `Annotation` at `{colors.annotation-default}` immediately (the highlight "lands"), reusing `buildAnnotations` + the store + `AnnotationLayer` unchanged.
- **Highlight-mode quick-box contents:** the `{component.color-swatch}` row (6 accent colors). The quick-box shell, position, dismiss, and focus management already exist (2.2) — this story only fills the highlight-mode *contents*. Choosing a swatch **recolors the just-created mark** (re-put by `id`); the armed swatch shows the 2px `{colors.ink}` ring.
- Lift the **armed annotation-tool** to a single shared source so both the rail (armed styling) and the overlay interaction (behavior) agree. See Dev Notes "Where the armed tool lives".

**OUT (later stories / Epic 3 — do NOT build):**
- Underline / pen / memo / comment / box-select tools → **2.4–2.8** (each reuses this same arm→drag→quick-box pattern).
- Cursor-mode **drag-to-change-tool** picker (highlight / underline / comment / memo on a cursor-mode drag) → **2.9**. The 2.2 cursor-mode proof action (a single default "Highlight" button on a cursor-mode drag) **stays as-is** this story — do not delete it, do not turn it into the tool picker. 2.9 replaces it.
- Post-hoc **editing** of an existing annotation (click-select, drag-handle move/resize, re-open quick-box to restyle a previously-made mark, double-click re-edit), **undo/redo**, **delete** → **Epic 3** (3.1/3.2/3.3). Recolor in THIS story is part of the *creation* quick-box (the mark was just made), not editing an old one, so it does not need the command stack — but see the Epic-3 seam note in Dev Notes.
- Any **persistence** (endpoints, storage IO, autosave, hydrate-on-open) → **Epic 3**. The store stays in-memory.

## Acceptance Criteria

1. **Arm the Highlight tool (FR-7, UX-DR4, UX-DR15).** Given the reader is ready, when the user clicks the Highlight button in `{component.tool-rail}` OR presses `H`, the Highlight tool arms and shows the armed state (`{component.tool-button-armed}`). It is sticky: it stays armed across multiple highlights until the user picks another tool, presses `V`, or presses `Esc` (which return to cursor). The `H` handler binds at `document` level, phase-gated, exempting `INPUT`/`TEXTAREA`/`SELECT`/`BUTTON`/`contentEditable`, and ignoring Ctrl/Alt/Meta chords — exactly like the existing `V`/`Esc`/`[` effect in `App.tsx`. [Source: epics.md#Story-2.3; EXPERIENCE.md#Keyboard (line 118); CLAUDE.md#Engineering-principles (document-level handlers)]

2. **Drag-to-highlight lands a mark without reflow (FR-7, FR-13, NFR-1, UX-DR7).** Given the Highlight tool is armed, when the user drags across a text run and releases, a highlight renders over the run at `{colors.annotation-default}` at `~0.4` opacity (the existing `.annotation-highlight` token), and `.pdf-canvas` does NOT shift or reflow. The mark renders via the existing `AnnotationLayer` (no new render path). [Source: epics.md#Story-2.3 AC1; DESIGN.md#annotation-highlight (lines 205-207); EXPERIENCE.md (lines 141-142)]

3. **Page-normalized text anchor, screen position derived (AR-4, AR-9, NFR-3).** Given the drag selection, the anchor is produced by the existing `rectsFromSelection` → page-normalized `kind=text {rects: Rect[], text}`, canonical `{x0,y0,x1,y1}` with `x0≤x1, y0≤y1`, top-left origin, against the rendered page box; screen position is always derived, never persisted. **No new coordinate math is written** — this is `anchor/`'s job and it is done (AD-9). [Source: ARCHITECTURE-SPINE.md#AD-4, #AD-9; 2-2 AC1/AC2]

4. **Stored as a generated `Annotation` keyed by `id`, render keys off `anchor.kind` (AR-5, AD-3).** Given a created highlight, it stores via `buildAnnotations` as `Annotation {id (crypto.randomUUID), doc_id, type=highlight, group_id, anchor (kind=text), style {color}, body=null, created_at, updated_at}` keyed by `id` in the Zustand store. The TS type stays the **generated** one (`api/client` re-export); rendering keys off `anchor.kind`, never `type`. [Source: ARCHITECTURE-SPINE.md#AD-3, #AD-5; 2-2 AC3]

5. **Quick-box color-swatch row recolors the just-landed mark (UX-DR5, UX-DR6, UX-DR16).** Given drag-release in Highlight mode, the `{component.quick-box}` pops at the selection showing the `{component.color-swatch}` row — the 6 accent colors (yellow/green/pink/blue/purple/orange); the currently-applied color's swatch shows the 2px `{colors.ink}` armed ring. Choosing a swatch recolors the just-created highlight (all annotations of a two-page group recolor together) and updates `updated_at`. The quick-box never shifts the canvas and dismisses on pick, outside-click, or `Esc` (shell behavior already built in 2.2). [Source: epics.md#Story-2.3 AC5; DESIGN.md#color-swatch (lines 459-466); EXPERIENCE.md#quick-box-mapping (lines 100-106)]

6. **Two-page selection splits sharing a `group_id` (AR-4).** Given a highlight drag spanning two page cards, it splits into one `Annotation` per page sharing one `group_id` (UUIDv4); a single-page highlight has `group_id = null`. This is already handled by `buildAnnotations` — reuse it, do not re-derive. [Source: ARCHITECTURE-SPINE.md#AD-4; 2-2 AC5]

7. **Anchor fidelity across zoom (NFR-3).** Given a highlight created at one zoom level, when the user zooms (`Ctrl +/-`, `Ctrl 0`, `Ctrl+scroll`), it re-renders at its exact text run at every zoom level. The overlay already derives screen position from the normalized anchor on each scale change (2.2 AC6); 2.3 must not regress it. Final proof is a live smoke test (jsdom proves wiring, not movement — Epic-1 retro). [Source: ARCHITECTURE-SPINE.md#AD-4; epics.md#Story-2.3 AC6; 2-2 AC6]

8. **The 2.2 cursor-mode proof and all prior behavior still pass; layering preserved (AD-9).** Existing Epic-1 behavior (load/render/scroll/zoom/pan/ToC) and the Story 2.2 cursor-mode drag→single-"Highlight"-action proof are unchanged and their tests still pass. The downward dependency holds: `render → anchor → annotations → store → api`; the new rail button + key live in `App`/`ToolRail` (the pointer-tool layer) and the overlay logic stays in `annotations/`. `no-raw-values.test.ts` stays green (no inline hex/px outside `theme/**`). [Source: ARCHITECTURE-SPINE.md#AD-9; CLAUDE.md#Design-conventions; 2-2 AC8]

## Tasks / Subtasks

- [x] **Task 1 — Lift the armed annotation-tool to a single shared source (AC: 1, 8)**
  - [x] Add `armedTool: AnnotationTool | null` state to `App.tsx` (alongside the existing `mode: ToolMode`). `AnnotationTool` is already exported from `annotations/machine.ts` (`"highlight" | "underline" | "pen" | "memo" | "comment"`); import the type (App→annotations type-only import is fine, it follows the downward layer rule). This is the refinement of the 2.2 "keep armed tool inside the annotations layer" suggestion — see Dev Notes "Where the armed tool lives"; the rail button forces a shared source, and App already owns the sibling `mode` state, so App is the natural home.
  - [x] In App's existing document-level key effect (`App.tsx:65-85`), add: `h`/`H` → `setArmedTool("highlight")`; and make `v`/`V`/`Escape` ALSO clear it (`setArmedTool(null)`) so cursor/deselect disarms the annotation tool too. Keep the existing guards (skip Ctrl/Alt/Meta, skip editable targets). Do NOT add a separate listener — extend the one effect (AP-1).
  - [x] Pass `armedTool` + `onArmTool` down to `ToolRail` and `armedTool` down to the overlay interaction (Task 3). Arming the Highlight tool does NOT change `mode` (`mode` stays cursor/hand/box for pan); they are orthogonal layers.

- [x] **Task 2 — Highlight button in the tool rail (AC: 1)**
  - [x] In `ToolRail.tsx`, add a Highlight button below the cursor button (DESIGN.md#tool-rail order: cursor, highlight, underline, pen, memo, comment, box-select, ToC — add only Highlight now). Use a Phosphor icon (`Highlighter` from `@phosphor-icons/react`, matching the existing icon idiom; it paints with `currentColor`). `aria-label="Highlight"`, `title="Highlight (H)"` (no em-dash — use parentheses). Armed styling = `tool-button--armed` when `armedTool === "highlight"`; click toggles arm/disarm via `onArmTool`.
  - [x] Keep `ToolRail` presentational (it owns no armed state — App does, mirroring how `mode` is wired). The collapsed rail need not show the Highlight button (parity with today's collapsed state, which only offers expand).

- [x] **Task 3 — Highlight-armed create-on-release + recolor quick-box (AC: 2, 4, 5, 6)**
  - [x] In `annotations/AnnotationInteraction.tsx`, accept the new `armedTool` prop and feed it into the machine so `pending.tool` reflects it. Cleanest: when the pointer-up handler builds the selection, read an `armedToolRef` and dispatch `present` carrying that tool (extend the `present` action payload with `tool`, OR dispatch `arm`/`disarm` on prop change so `currentTool(state)` already returns it). Pick the minimal change to `machine.ts` and note it; the machine already has `arm`/`armed`/`tool` plumbing.
  - [x] **Create-on-release when `armedTool === "highlight"`:** on pointer-up with a usable selection, immediately call `buildAnnotations(selection, docId, { now, newId, type: "highlight", color: "annotation-default" })`, add each to the store, remember the created `id`s (for recolor), then pop the quick-box in **swatch-row mode**. The highlight has now "landed" (AC-2) before any swatch pick.
  - [x] **Quick-box contents branch on `pending.tool`:** `tool === "highlight"` → render the `ColorSwatchRow` (Task 4) bound to the created `id`s. `tool === null` (cursor-mode drag) → keep the EXISTING single "Highlight" proof button untouched (2.2 behavior; 2.9 replaces it). Do not collapse these into one path.
  - [x] **Recolor:** picking a swatch updates the created annotation(s) to the chosen color token and bumps `updated_at`, then dismisses (a pick is a dismiss per shell behavior). Recolor every annotation sharing the group (two-page case, AC-6). Use a thin store action (Task 5), not a per-component rebuild of the entity.
  - [x] Reuse the existing shell mechanics verbatim: position/clamp (`clampToViewport`), focus-in/return, dismiss on pick/outside/`Esc`, and `removeAllRanges()` on dismiss/commit (the 2.2 re-pop fix). Do not duplicate them.

- [x] **Task 4 — `ColorSwatchRow` component + tokens (AC: 5)**
  - [x] Add `annotations/ColorSwatchRow.tsx`: a row of 6 swatch buttons (yellow/green/pink/blue/purple/orange) — read the palette as token names (`annotation-yellow`…`annotation-orange`), fill each with `var(--color-<name>)`. Props: `value` (current token), `onPick(token)`. Each swatch is a `<button role="menuitemradio">` 20px pill (`--color-swatch-size`), 1px `{colors.hairline-strong}` ring; the armed one (`value` match) gets a 2px `{colors.ink}` ring; `aria-label` = the color name (e.g. "Yellow"), `aria-checked` reflects armed. Keyboard-reachable (it lives in the quick-box menu); `data-testid="color-swatch-<name>"`.
  - [x] Styles in `annotations/Annotations.css` using existing tokens (`--color-swatch-size`, `--color-swatch-border`, `--color-hairline-strong`, `--color-ink`, `--focus-ring-width`). If a 2px armed-ring needs a token, add it hand-authored to `theme/components.css` (the swatch dims already live there: lines 88-91) — keep raw px out of `annotations/` (`no-raw-values.test.ts`). The 6-color palette tokens already exist in `tokens.css` (lines 33-39); do NOT add hex.
  - [x] No em-dash in any swatch label/aria-label/title. [[no-emdash-user-facing]]

- [x] **Task 5 — Store recolor action (AC: 5)**
  - [x] Add a minimal `recolorAnnotation(ids: string[], color: string, now: string)` (or `recolor(id, color, now)` called per id) to `store/index.ts`: for each id, re-put the annotation with `style.color = color` and `updated_at = now` (new Map per mutation, like `addAnnotation`). Keep the store dependency-clean (imports `api/` types only, AD-9). NO command stack / undo / dirty flag — that is Epic 3 (3.1 routes restyle through the command path; leave a one-line comment marking this as the pre-command-stack create-time recolor). [Source: ARCHITECTURE-SPINE.md#AD-7; 2-2 store scope]

- [x] **Task 6 — Tests + regression bar (AC: all)**
  - [x] `ToolRail`: the Highlight button arms (calls `onArmTool("highlight")`), shows `--armed` when `armedTool==="highlight"`.
  - [x] `App`: pressing `H` arms highlight; `V`/`Esc` disarm; chords + editable targets are ignored (mirror the existing tool-key tests).
  - [x] `AnnotationInteraction`: with `armedTool="highlight"`, a drag-release (feed a fake selection as the 2.2 tests do — jsdom zeroes `getClientRects`, so drive `rectsFromSelection` inputs / mock as 2.2 does) creates a default-color highlight in the store AND pops the swatch row; picking a non-default swatch recolors the stored annotation and dismisses; the tool stays armed after the pick (sticky); the cursor-mode (`armedTool=null`) drag still shows the single proof button (2.2 path intact).
  - [x] `ColorSwatchRow`: renders 6 swatches; the `value` swatch is marked armed; clicking a swatch calls `onPick` with the right token.
  - [x] `store`: `recolorAnnotation` changes `style.color` + `updated_at`, keyed by id, and recolors a 2-id group together.
  - [x] **Render-mock barrels:** this story adds NO new `render/index.ts` export (the overlay consumes the existing `getPageBox` seam), so NO `vi.mock("./render")` barrel edit is needed — confirm you did not add one. If you somehow must, update BOTH barrels (`App.test.tsx`, `Reader.test.tsx`) the same change (CLAUDE.md AP-2).
  - [x] Full regression: `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q` and `cd client && npm test` + `npm run typecheck` — all green. No contract change expected (no Pydantic/endpoint edits), so `server/openapi.json` + `client/src/api/schema.d.ts` stay byte-identical — verify no diff.
  - [x] **Live smoke (the real NFR-3/NFR-1 verifier, Epic-1 retro) — DONE via Playwright (found + fixed 3 regressions, see Live-smoke findings):** run the host two-process flow (`cd server && uv run uvicorn app.main:app --reload --port 8000` + `cd client && npm run dev`), open a PDF, press `H`, drag across text → the highlight lands and the page does NOT jump; the swatch row appears; pick green → recolors; zoom in/out → the highlight stays glued to the run.

- [x] **Task 7 — Docs (AC: 8)**
  - [x] No `/api` change → `docs/API.md` is untouched this story (do not edit it).
  - [x] Update `client/src/annotations/README.md`: the highlight tool + swatch-row quick-box mode now exist (note underline/pen/memo/comment/box-select + the cursor tool-picker are still later stories).

## Dev Notes

### Where the armed tool lives (the one design decision)

Story 2.2's dev notes recommended keeping the armed annotation tool *inside* the annotations layer's state machine, because at that point nothing outside the overlay needed it. **Story 2.3 changes that constraint:** the rail Highlight button (rendered by `App` via `ToolRail`) must both *set* and *reflect* the armed tool, and the `H` hotkey lives in App's document-level key effect. So the armed tool needs a single shared source both sides read.

**Chosen resolution (build this):** lift `armedTool: AnnotationTool | null` to `App.tsx` state, next to the existing `mode: ToolMode`. App passes it to `ToolRail` (armed styling + arm/disarm callback) and to `AnnotationInteraction` (behavior + quick-box mode). The overlay's internal `machine.ts` still drives the transient annotating/pending/empty transitions; it just takes the armed tool as input rather than owning it. This mirrors the existing `mode` wiring exactly (App owns, ToolRail + Reader consume) and keeps `mode` (cursor/hand/box, pointer/pan) orthogonal to `armedTool` (which annotation lands on a text drag). The two never merge — `mode` drives pan; `armedTool` drives marks. Note this refinement in the `AnnotationInteraction` / `App` header comments so the next tool story (2.4) follows the same seam.

Alternative (NOT chosen): a small UI-tool Zustand slice. Rejected — `store/` is the annotation working copy (AD-9, imports `api/` only); adding pointer/tool UI state there muddies its single responsibility, and App-state is the established pattern here.

### Create-on-release vs. create-on-pick (why the highlight lands first)

The epics AC and the EXPERIENCE.md scene (lines 141-142: "the highlight lands … the quick-box offers the color row; he leaves it yellow") both say the highlight **renders on release** at the default color, and the swatch row then **recolors** it. So:

1. pointer-up with a selection + Highlight armed → `buildAnnotations(..., color: "annotation-default")` → store → it renders immediately (AC-2).
2. quick-box pops with the swatch row, the default (yellow) swatch armed.
3. swatch pick → `recolorAnnotation(createdIds, token, now)` → dismiss. Leaving it (outside-click/`Esc`) keeps the default. Either way the mark persists in-session.

This is deliberately NOT "the pick creates the mark." Creating-on-pick would make a dismissed quick-box drop the highlight, contradicting "the highlight lands." Keep create-on-release.

### Recolor is creation-time, not Epic-3 editing

AR-7 routes **edits of existing annotations** through the Epic-3 command stack. The 2.3 recolor is part of the *creation* quick-box (the mark was made milliseconds ago, in the same gesture) — it is finishing the create, not re-opening an old mark. So a thin store `recolorAnnotation` is in-scope and does NOT pull the command stack forward. Story 3.1 ("Edit annotations — command path") later adds click-select + re-open-quick-box-to-restyle for *previously made* marks and routes ALL such edits (including this recolor path) through the command stack. Leave a one-line marker comment at `recolorAnnotation` so 3.1 knows to fold it in.

### Reuse map — what already exists (do NOT rebuild)

- `anchor/rectsFromSelection` + `normalizeRect`/`denormalizeRect` — the only coordinate math; complete. (AC-3/AC-6/AC-7 are inherited.)
- `annotations/create.ts` `buildAnnotations` — entity build + two-page `group_id` split (AC-4/AC-6). Pass `type:"highlight"`, `color:"annotation-default"`.
- `annotations/AnnotationLayer.tsx` — renders `text`-kind marks at `var(--color-<style.color>)` with `.annotation-highlight` (`~0.4` opacity); filters by `doc_id` + `page_index`. Recolor flows through automatically because the layer reads `style.color`. (AC-2/AC-5/AC-7.)
- `annotations/AnnotationInteraction.tsx` — the quick-box shell: position/clamp, focus-in/return, dismiss on pick/outside/`Esc`, `removeAllRanges()` re-pop fix. Reuse all of it; only the *contents* and the create-on-release branch are new.
- `annotations/machine.ts` — has `arm`/`disarm`/`armed`/`AnnotationTool` and carries `tool` through `present`. Wire the armed tool in; minimal change.
- `store/index.ts` — `addAnnotation` already "insert or replace by id"; add the thin `recolorAnnotation`.
- `theme/components.css` — `--color-swatch-size`/`--color-swatch-border` (lines 88-91) + `--annotation-highlight-opacity` (line 95) exist; `tokens.css` has the 6 `--color-annotation-*` (lines 33-39). No new hex.

### Integration points (read these; they are the seams)

- `client/src/App.tsx` — owns `mode` + the document-level tool-key effect (`App.tsx:65-85`) + renders `<ToolRail>`. Add `armedTool` state + `H` handling here (extend the one effect). [App.tsx:32, 65-85, 170-175]
- `client/src/ToolRail.tsx` — presentational rail; `ToolMode` defined here; add the Highlight button + `armedTool`/`onArmTool` props. Mirror the existing `tool-button--armed` styling. [ToolRail.tsx:25-29, 42-52, 98-147]
- `client/src/annotations/AnnotationInteraction.tsx` — the interaction layer + quick-box; accept `armedTool`, branch quick-box contents on `pending.tool`, add the highlight create-on-release + swatch recolor. The cursor-mode proof button (lines 170-180) STAYS for `tool===null`. [AnnotationInteraction.tsx:35-49, 64-80, 141-181]
- `client/src/annotations/machine.ts` — `arm`/`armed`/`tool` plumbing; feed the armed tool in. [machine.ts:13, 21-33, 48-74]
- `client/src/store/index.ts` — add `recolorAnnotation`; keep `api/`-only imports. [store/index.ts:13-33]
- `client/src/Reader.tsx` — already mounts `AnnotationInteraction` once + `AnnotationLayer` per `PageCard`; it threads `getPages`/`scale`/`docId`. Pass `armedTool` through if the interaction is mounted from Reader, OR (simpler) keep `AnnotationInteraction` receiving `armedTool` from wherever it is mounted — confirm the current mount site (Reader, per 2.2 File List) and thread the prop the same way `scale`/`docId` flow. Do NOT add a second mount.

### Design tokens (no inline hex/px — `no-raw-values.test.ts` enforces it outside `theme/**`)

- Palette: `--color-annotation-{yellow,green,pink,blue,purple,orange,default}` (default = yellow) already in `tokens.css`. The swatch fills use `var(--color-annotation-<name>)`.
- Swatch: 20px pill (`--color-swatch-size`), 1px `{colors.hairline-strong}` ring; armed swatch = 2px `{colors.ink}` ring (DESIGN.md#color-swatch lines 459-466). Add only the armed-ring dim if not already tokenized; the base swatch dims exist.
- Highlight fill: `.annotation-highlight` at `--annotation-highlight-opacity` (0.4) over the run (DESIGN.md:205-207) — already wired in `AnnotationLayer`.
- **No em-dash (—) in any user-facing string** (button `title`, `aria-label`, swatch labels). Code comments exempt. [[no-emdash-user-facing]]

### Engineering conventions in force (CLAUDE.md#Engineering-principles)

- **Adopt stable primitives, don't reinvent** (AP-4/PREP-1): 2.3 adds no new math — it reuses `rectsFromSelection`/`buildAnnotations`/the anchor service. If anything tempts a hand-rolled coordinate or selection path, stop and reuse the 2.2 primitive.
- **Document-level interaction handlers** (AP-1): the `H` key + any new global handler bind on `document`, phase-gated, exempting editable + buttons — extend App's existing effect, do NOT bind to `.pdf-canvas`.
- **`render/` mock-barrel sync** (AP-2): prefer consuming existing `render/` exports (you will — `getPageBox` via the existing seam), so NO barrel edit. If you add a `render/index.ts` export, update BOTH `vi.mock("./render")` barrels the same change.

### Testing standards

- Frontend Vitest + jsdom. jsdom zeroes `getBoundingClientRect`/`getClientRects` — so drive the create path by feeding selection inputs / mocking `rectsFromSelection` the way the 2.2 `AnnotationInteraction.test.tsx` already does; assert store mutations + quick-box contents + sticky-armed, not pixel movement. Real cross-zoom fidelity (AC-7) and the no-reflow climax (AC-2) are proven by the **live smoke** (Task 6), per the Epic-1 retro (jsdom proves wiring, not movement).
- Backend pytest: no model/contract change this story, but run the suite to confirm no regression: `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q`.
- Keep cross-model code review (`bmad-code-review` via Codex) as standing practice (Epic-1 retro AP-3).

### Project Structure Notes

- No new top-level dirs. New file: `client/src/annotations/ColorSwatchRow.tsx` (+ its test). Edits: `App.tsx`, `ToolRail.tsx`, `annotations/AnnotationInteraction.tsx`, `annotations/machine.ts` (minimal), `store/index.ts`, `annotations/Annotations.css`, maybe `theme/components.css` (one armed-ring dim), `annotations/README.md`. [Source: ARCHITECTURE-SPINE.md#Structural-Seed]
- Layer rule (AD-9): `render → anchor → annotations → store → api`. The rail button + key are in the App/ToolRail pointer-tool layer (above annotations conceptually but they only pass a prop down); the overlay logic stays in `annotations/`. No upward imports from `render/` or `anchor/`.

### References

- [Source: .bmad/planning-artifacts/epics.md#Story-2.3-Highlight-text-via-drag] — story statement + 6 ACs.
- [Source: .bmad/planning-artifacts/epics.md#Epic-2 (restructure note, lines 368-372)] — 2.3 is a thin feature on the 2.2 foundation; adopt-stable principle.
- [Source: .bmad/implementation-artifacts/epic-2/2-2-annotation-foundation.md] — the foundation this reuses: anchor service, entity, store, overlay, machine, quick-box shell, cursor-mode proof; decisions #2 (proof trigger) + #3 (overlay mount seam).
- [Source: ARCHITECTURE-SPINE.md#AD-4] — spatial-anchor model: normalized `[0,1]`, top-left y-down, canonical rect, `kind` discriminator, one-anchor-one-page + `group_id` split.
- [Source: ARCHITECTURE-SPINE.md#AD-5] — `Annotation` entity; `type` vs `anchor.kind`; highlight→text|rect pairing; style field-scoping.
- [Source: ARCHITECTURE-SPINE.md#AD-3] — Pydantic → OpenAPI → generated TS; never hand-author client API types.
- [Source: ARCHITECTURE-SPINE.md#AD-7, #AD-9] — store keys by id (command stack is Epic 3); boundary/layer invariants.
- [Source: DESIGN.md (lines 33-42, 195-207, 331-338, 459-470)] — annotation accent palette; quick-box / color-swatch / annotation-highlight component dims + the swatch armed-ring rule.
- [Source: EXPERIENCE.md (lines 100-118, 141-142)] — quick-box highlight-mode = color-swatch row; `H` = highlight; the "highlight lands, page doesn't jump, color row offered" scene.
- [Source: CLAUDE.md#Engineering-principles, #Design-conventions] — adopt-stable / document-level handlers / render-mock-barrel; token rules; test incantations.

## Previous Story Intelligence

From Story 2.2 (annotation foundation, done) + the Epic-1 retro:

- **2.2 already proved the spatial model end-to-end** (anchor survives zoom, two-page split, in-memory store, overlay no-reflow). 2.3 inherits AC-3/AC-6/AC-7 by reuse — the risk in 2.3 is wiring, not the anchor model.
- **The 2.2 quick-box re-pop bug**: a still-live browser selection re-pops the quick-box on the next pointerup/click. `dismiss()` and `commit()` call `removeAllRanges()` to fix it — keep that on every new path (the recolor pick is a dismiss).
- **AnnotationLayer filters by `doc_id` + `page_index`** (2.2 review finding) — the singleton store isn't cleared on doc switch until Epic 3; do not regress the filter.
- **Document-level handler bug recurred 3× in Epic 1** — the `H` key goes on `document`, phase-gated, editable/buttons exempt (extend App's existing effect, AC-1).
- **Live smoke is the real verifier** — jsdom proved 2.2 wiring but not real zoom fidelity; do the Task 6 live smoke for AC-2/AC-7.
- **2.2 decisions #2/#3 stand**: the cursor-mode proof trigger is intentionally thin (replaced by 2.9); the overlay mounts via `AnnotationLayer` in `PageCard` + `AnnotationInteraction` once in the Reader, fed `getPages`/`scale`/`docId` from the Reader composition root — thread `armedTool` the same way.

## Git Intelligence

- Baseline: `9b013cf` (Feat: Add Annotation Foundation, #11) — the 2.2 foundation is merged to `main`. `anchor/`, `store/`, `annotations/` (machine, create, position, AnnotationLayer, AnnotationInteraction, Annotations.css), the Pydantic `Annotation` + generated `schema.d.ts`, and the `components.css` swatch/quick-box/highlight tokens all exist. 2.3 is genuinely thin on top.
- Branch off `main` (global git convention: never commit to `main` directly). Dev loop is the host two-process flow (`uvicorn --reload` + `vite dev`) per Story 2.1; Docker is the prod-like single-command boot.
- No contract change expected → keep `server/openapi.json` + `client/src/api/schema.d.ts` byte-identical (verify no diff after the suite).

## Project Context Reference

- Two processes, one container (AD-1/AD-10): `client/` (React 19.2 + Vite 8 + TS 6.0) and `server/` (FastAPI + Pydantic v2). Prod = single image, FastAPI serves API + built SPA same-origin.
- Client layering (AD-9): `render → anchor → annotations → store → api`, strict downward. 2.3 touches `annotations/` + `store/` + the App/ToolRail pointer-tool layer; it adds NO new `anchor/`/`render/` math.
- Spatial-anchor model (AD-4) is the cross-phase invariant, already built in 2.2. 2.3 is the first tool to consume it for real.
- No auth, localhost single-user. v1 scope = Phase 1.

## Story Completion Status

Story context engineered and ready for dev. No user-blocking decisions: the one design call (armed-tool lives in App state, refining the 2.2 "keep it in the annotations layer" suggestion now that the rail button forces a shared source) is resolved with rationale in Dev Notes. Create-on-release (not create-on-pick) and the in-scope creation-time recolor are both pinned to the epics ACs + EXPERIENCE.md scene.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Claude Code, bmad-dev-story workflow).

### Debug Log References

- Frontend: `cd client && npm test` → 21 files, 189 passed (was 171 in 2.2; +18 new across ToolRail, App, AnnotationInteraction, ColorSwatchRow, store). `npm run typecheck` clean. `no-raw-values` guard 29 passed.
- Backend: `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q` → 38 passed (no backend change; regression only).
- Contract: no Pydantic/endpoint edits → `client/src/api/schema.d.ts` byte-identical (no diff), as expected.

### Completion Notes List

- **Armed-tool lives in App (decision confirmed).** Lifted `armedTool: AnnotationTool | null` to `App.tsx` next to `mode`, refining 2.2's "keep it in the annotations layer" suggestion now that the rail button + `H` need a shared source. App passes it to `ToolRail` (armed styling + toggle) and through `Reader` to `AnnotationInteraction` (behavior). Orthogonal to `mode` (pan).
- **Create-on-release (not create-on-pick).** With highlight armed, pointer-up with a selection builds + stores the highlight at `annotation-default` immediately (the mark lands, AC-2), then the quick-box shows the swatch row. Leaving it (Esc/outside) keeps the default; only a swatch pick recolors. The 2.2 cursor-mode proof (create-on-pick) is untouched (AC-8).
- **Machine wiring is minimal.** No `machine.ts` change: `AnnotationInteraction` dispatches `arm`/`disarm` from an effect on the `armedTool` prop, so `currentTool(state)` already feeds `present` → `pending.tool`, and the reducer's `rest(currentTool)` keeps the tool armed (sticky) after a mark.
- **Recolor is a thin store action** (`recolorAnnotation(ids, color, now)`), keyed by id, recolors a two-page group together, bumps `updated_at`. Marked in-code as the pre-command-stack create-time recolor; Story 3.1 folds it into the command path.
- **Swatch palette = the 6 accents**, first swatch token `annotation-default` (aliases yellow) so a just-landed default highlight shows its swatch armed (2px ink ring). `ColorSwatchRow` is reusable by 2.4 (underline) / 2.5 (pen).
- **No new `render/` export** → no `vi.mock("./render")` barrel edit needed (consumes the existing `getPageBox` seam via `getPages`). Confirmed both barrels untouched.
- **Live smoke OWED (Epic-1 retro).** jsdom proves the wiring + store mutations + quick-box contents + sticky-arm, but the real no-reflow climax (AC-2) and cross-zoom fidelity (AC-7) must be smoke-tested in the running app (`uvicorn --reload` + `vite dev`): press `H`, drag text → highlight lands, page does not jump; swatch row appears; pick green → recolors; zoom → stays glued. This is the one unchecked subtask.
- No new runtime deps. `Highlighter` is an existing `@phosphor-icons/react` export.

### File List

**Added (client):**
- `client/src/annotations/ColorSwatchRow.tsx` — the 6-accent recolor row (reused by 2.4/2.5).
- `client/src/annotations/ColorSwatchRow.test.tsx`
- `client/src/store/index.test.ts` — store add/order + `recolorAnnotation` tests.

**Modified (client):**
- `client/src/App.tsx` — `armedTool` state; `H` arms / `V`/`Esc` disarm in the existing key effect; pass to `Reader` + `ToolRail`.
- `client/src/ToolRail.tsx` — Highlight button (`Highlighter`), `armedTool`/`onArmTool` props, armed styling.
- `client/src/Reader.tsx` — thread `armedTool` to `AnnotationInteraction`.
- `client/src/annotations/AnnotationInteraction.tsx` — accept `armedTool`; highlight create-on-release + swatch-row recolor; cursor-mode proof preserved; generic focus-in.
- `client/src/store/index.ts` — `recolorAnnotation` action.
- `client/src/annotations/Annotations.css` — `.color-swatch-row` / `.color-swatch` / armed-ring styles.
- `client/src/theme/components.css` — `--color-swatch-ring-width` / `--color-swatch-ring-offset` tokens.
- `client/src/App.test.tsx`, `client/src/ToolRail.test.tsx`, `client/src/annotations/AnnotationInteraction.test.tsx` — new Story 2.3 tests.

**Docs:**
- `client/src/annotations/README.md` — note the highlight tool + swatch-row mode now exist.

### Change Log

- 2026-06-29 (Story 2.3): Highlight text via drag. Added the armed Highlight tool (rail button + `H`, sticky), create-on-release at the default color, and the `ColorSwatchRow` quick-box recolor row backed by a thin `store.recolorAnnotation`. Reused the 2.2 anchor/store/overlay/quick-box foundation unchanged (no new coordinate math, no `render/` export, no contract change). Lifted `armedTool` to App as the single source. Tests: ToolRail arm + App keys + AnnotationInteraction create/recolor/sticky/two-page + ColorSwatchRow + store. Frontend 189 pass, backend 38 pass, typecheck clean. Live smoke owed.

## Review Findings (code-review via Codex, 2026-06-29)

Verdict: Changes-Requested

- [x] [Review][Patch] `H` hotkey does not exempt all required controls [client/src/App.tsx:80] — the document-level key guard skips `INPUT`/`TEXTAREA`/contentEditable but not `SELECT` or `BUTTON`, so pressing `H` while a select or button has focus can arm Highlight despite AC1 and the document-level handler constraint requiring both to be exempt. RESOLVED: extended the App key guard to also exempt `SELECT` and `BUTTON` (matches the annotations-layer `isExempt` convention); test added (`H` over the rail button does not arm).
- [x] [Review][Patch] Disarming while quick-box is pending bypasses selection clearing [client/src/annotations/AnnotationInteraction.tsx:85] — when `V` clears `armedTool`, the sync effect dispatches `disarm` directly, dropping pending state without calling `dismiss()` and therefore without `removeAllRanges()` at lines 124-126; the stale browser selection can re-pop the cursor-mode quick-box on the next pointer release, violating AC1/AC5 and the 2.2 re-pop fix. RESOLVED: the disarm effect now clears the live selection (`removeAllRanges()`) when it drops an open quick-box (tracked via `pendingRef`); test added (disarm-while-pending clears selection and cannot re-pop).

0 decision-needed, 2 patch, 0 defer, 1 dismissed

- 2026-06-29 (Story 2.3, post-review): addressed code-review (Codex, cross-model) findings — 2 patches resolved. Exempted SELECT/BUTTON in the App document-level key handler; cleared the live selection on prop-driven disarm of an open quick-box (re-pop guard). Tests added for both. Frontend 191 pass, typecheck clean, backend 38 pass.

## Live-smoke findings (Playwright, 2026-06-29)

Ran the owed live smoke by driving the running app (uvicorn + vite) with Playwright, loading `fixtures/sample-pdfs/09-regularization.pdf`. Confirmed AC-2 (highlight lands, no reflow) and AC-7 (mark stays glued across a 157%→197% zoom) hold. Found and fixed 3 regressions the jsdom tests could not catch:

- [x] [Smoke][Patch] **Highlight-on-drag does nothing when the hand tool is also armed (the user's #5).** ROOT CAUSE = the orthogonal `mode` (cursor/hand/box) vs `armedTool` design let pan stay active while highlight was armed; the Reader's pan handler ate the drag (`data-pan` suppresses selection), so no selection reached the highlight create path. FIX = mutual exclusion in `App.tsx`: arming an annotation tool (`H` or rail) forces `mode="cursor"`; picking a pointer sub-mode clears `armedTool`. Exactly one tool active. Verified live: hand→`H`→drag now highlights (was: panned). [client/src/App.tsx]
- [x] [Smoke][Patch] **Pointer button shows no active state in plain cursor mode (#3).** FIX = the cursor-family rail button is armed whenever no annotation tool is armed (`armedTool == null`), so the default selection tool reads active; not armed when highlight is armed. [client/src/ToolRail.tsx]
- [x] [Smoke][Patch] **Quick-box floats detached on scroll (#1).** The popup is pinned to the release point (`position: fixed`); FIX = it dismisses on canvas scroll (capture-phase `scroll` listener while pending). Verified live. [client/src/annotations/AnnotationInteraction.tsx]

Deferred to correct-course (sprint change, separate from 2.3 scope):
- **#2 full tool-state FSM** — this story does the surgical mutual-exclusion fix; the complete single-`activeTool` state machine (folding cursor/hand/box/highlight/underline/... into one model, Epic-1 retro PREP-3) is a foundation refactor that ripples to 2.2 + 2.4-2.9.
- **#4 color quick-pick on arm** — show the swatch row when highlight is armed (choose default color before drawing), not only after creation. Changes the EXPERIENCE.md quick-box mapping (IP-3) → spec change.

- 2026-06-29 (Story 2.3, live-smoke): fixed 3 regressions found by the Playwright live smoke — highlight-drag eaten by an also-armed pan (#5, root cause of "no reaction"; fixed via tool mutual-exclusion), cursor button inactive in cursor mode (#3), quick-box not dismissed on scroll (#1). Tests added (App mutual-exclusion ×2, ToolRail active-state ×2, scroll-dismiss ×1). Frontend 195 pass, typecheck clean. #2 (full FSM) and #4 (color-pick-on-arm) routed to correct-course.

## Render-fidelity findings (Playwright, 2026-06-29) — 3 user-reported render bugs

Investigated live, then fixed. (Two earlier separate fixes also landed first this session: stuck hold-Space pan released on focus loss; UUID fallback for insecure contexts — both prerequisites that unmasked these render issues.)

- [x] [Render][Patch] **Live text selection invisible while dragging.** ROOT CAUSE = pdf.js `pdf_viewer.css` forces `.textLayer ::selection { background: transparent }` (pdf.js paints its own selection via machinery we don't use — AD-2 raw text layer + custom overlay), so the native drag selection never showed. FIX = re-show it with a token tint scoped under `.pdf-canvas .textLayer ::selection` (wins on specificity over the vendor rule); added `--color-text-selection` (soft accent blue) to `components.css`. Verified live: drag now shows a blue selection. [client/src/Reader.css, client/src/theme/components.css]
- [x] [Render][Patch] **Stacked highlights thicken / recent does not override.** ROOT CAUSE = per-mark `opacity: 0.4` compounds where rects overlap, two ways: (a) within one annotation, `Range.getClientRects()` emits overlapping/duplicate fragments per line (~1-2px-apart pairs → each line painted twice), and (b) across annotations, re-highlighting the same text. FIX = (1) `anchor.mergeRects` clusters rects into rows by >50% vertical overlap and unions each row, so each line is one band (kills the within-annotation doubling without fusing adjacent lines); (2) `AnnotationLayer` wraps highlight marks in an `.annotation-highlights` opacity group (`opacity: 0.4; isolation: isolate`) with marks opaque, so all highlights composite once — overlaps never deepen and the most recent (last in DOM) wins. Verified live (group opacity 0.4, isolation; even-toned overlaps). [client/src/anchor/index.ts, client/src/annotations/AnnotationLayer.tsx, client/src/annotations/Annotations.css]
- [x] [Render][Patch] **Highlight overflows into the right margin (HiDPI / DPR>1 only).** ROOT CAUSE = `renderPage` set the text layer's `--total-scale-factor` to `scale * outputScale` (outputScale = devicePixelRatio). pdf.js's `.textLayer` CSS sizes glyph font/position by `--total-scale-factor`, so on a HiDPI display (the user is on DPR=1.25) the invisible text layer rendered ~DPR× too wide — left-anchored, overshooting each line's right edge — so `getClientRects` (and thus every highlight/selection rect) ran past the visible glyphs into the page margin. Invisible at DPR=1, which is why earlier localhost smoke (DPR=1) measured tight rects. FIX = set BOTH `--scale-factor` and `--total-scale-factor` to `scale` (CSS-px zoom; DPR only inflates the canvas backing store, never text-layer layout). Verified live at DPR=1.25: the justified line's rect went 961→811 (the true text margin), the highlight no longer bleeds into the margin. This also corrects selection alignment + anchor fidelity for all HiDPI users. [client/src/render/index.ts]

- 2026-06-29 (Story 2.3, render-fidelity): fixed live text-selection invisibility (override pdf.js's transparent `::selection`), highlight opacity-stacking/thickening (per-line `mergeRects` + an `.annotation-highlights` opacity group so overlaps don't compound and recent wins), AND the right-margin overflow — root-caused to a HiDPI bug where the text layer's `--total-scale-factor` wrongly included the device-pixel-ratio, stretching selection geometry ~DPR× past the glyphs (fix: both scale vars = `scale`). All three verified live with Playwright at DPR=1.25. Tests added (mergeRects ×3). Frontend 205 pass, typecheck clean.
