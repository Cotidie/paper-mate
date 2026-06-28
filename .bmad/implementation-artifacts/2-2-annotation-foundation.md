---
baseline_commit: c267bbb987ae7f66d50e1323494572f34d6bc98a
---

# Story 2.2: Annotation foundation (anchor service + store + overlay)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a reader,
I want a single mark to land anchored to exact PDF coordinates and survive zoom,
so that every annotation tool is built on one proven spatial foundation.

> **The architectural through-line of Epic 2 (AD-4/AD-5/AD-7/AD-9).** This story stands up five net-new pillars — the `anchor/` service, the `Annotation` entity (Pydantic-sourced → generated TS), the Zustand `store/`, the `annotations/` overlay, and the `{component.quick-box}` shell — and proves them end-to-end with **the simplest possible mark** (a default text highlight). Stories 2.3–2.9 are then thin features that reuse this foundation, not rebuilds.
>
> **Standing principle in force (Epic 1 retro AP-4 / PREP-1): adopt stable primitives, do NOT hand-roll.** The anchor math is built on pdf.js `viewport.convertToPdfPoint` / `convertToViewportPoint`; text rects come from the native Selection API + `Range.getClientRects()`; UUIDs come from `crypto.randomUUID()`. This applies to the primitives *under* the custom overlay; it does NOT override AD-2 (raw pdf.js + custom overlay).

## Scope boundary — READ FIRST

**IN (this story):**
- `client/src/anchor/` — normalized↔screen projection service (AD-4/AD-9), the ONLY home of that math.
- `client/src/store/` — Zustand working copy keyed by `id` (AD-7 store shape only; NO command stack, NO autosave — those are Epic 3).
- `client/src/annotations/` — the overlay (view, renders off `anchor.kind`), the armed-tool state machine, and the `{component.quick-box}` **shell** (position + dismiss + focus).
- `server/app/models.py` — the Pydantic `Annotation` entity (AD-5) + its `Anchor`/`Rect`/`Style` parts, surfaced into OpenAPI so the client gets a **generated** TS type (AD-3). Regenerate `openapi.json` + `schema.d.ts`.
- One proof tool path: drag-select text → quick-box shell → create a default text-highlight `Annotation` → render in overlay → survives zoom + two-page split.

**OUT (later stories — do NOT build):**
- The highlight *feature* polish: rail Highlight button, `H` hotkey, color-swatch recolor row → **Story 2.3**. (2.2 builds the shell + a minimal proof trigger; 2.3 swaps in the real tool, reusing the shell.)
- Underline / pen / memo / comment / box-select tools → **2.4–2.8**. Cursor-mode drag-to-change-tool picker → **2.9**.
- The `/api/docs/{doc_id}/annotations` GET/PUT **endpoints**, storage annotation file IO, the command stack (do/undo), dirty flag, debounced autosave, single-flight PUT, save-indicator, hydrate-on-open → **Epic 3** (stories 3.1, 3.2, 3.4, 3.5). This story defines the entity *contract* and an **in-memory** store only; it does not persist to disk or talk to the backend.

## Acceptance Criteria

1. **Anchor service = the only home of coordinate math (AD-4, AD-9, NFR-3).** Given the render layer's scale-1.0 page box (`getPageBox`), the `anchor/` service provides normalize (screen rect → page-normalized `[0,1]` fractions) and denormalize (normalized → screen rect at the current scale). **The pdf.js viewport projection (bottom-left→top-left + `/Rotate`) is adopted UPSTREAM via `render/getViewport`→`getPageBox` — so the anchor service consumes that already-baked, already-top-left box and does pure `[0,1]` scale-normalization (`box * scale`) on top; it does NOT re-invoke `convertToPdfPoint`/`convertToViewportPoint`, because those return y-up PDF points and would force the `height - y` re-flip the Dev Notes forbid AND violate AC-2's top-left y-down requirement.** This is the adopt-stable primitive in its correct layer; do NOT hand-roll the bottom-left→top-left projection (render already owns it). No other module (`render/`, `annotations/`, `store/`, components) computes screen↔PDF coordinates. [Source: ARCHITECTURE-SPINE.md#AD-4, #AD-9; amended 2026-06-29 per code-review to resolve the AC-1↔AC-2 wording conflict]

2. **Text-run rects from the native Selection API (AD-4).** Given a drag text selection over the pdf.js text layer, text-run rects come from `window.getSelection()` + `Range.getClientRects()` (stable primitive, NOT a glyph hit-test), each normalized to canonical `{x0,y0,x1,y1}` with `x0≤x1, y0≤y1`, top-left origin, against the rendered page box. Screen position is always derived, never persisted. [Source: ARCHITECTURE-SPINE.md#AD-4]

3. **The `Annotation` entity is Pydantic-sourced and stored keyed by `id` (AD-3, AD-5, AD-7).** Given a created mark, it stores in the Zustand `store/` as `Annotation {id (crypto.randomUUID), doc_id, type, group_id (uuid|null), anchor (carries its own kind), style {color, stroke_width?}, body (text|null), created_at, updated_at (ISO-8601 UTC)}`, keyed by `id` in a map. The TS type is **generated** from the Pydantic model in `server/app/models.py` (never hand-authored, AD-3). Rendering keys off `anchor.kind`, never off `type`. [Source: ARCHITECTURE-SPINE.md#AD-3, #AD-5, #AD-7, Consistency-Conventions]

4. **Overlay renders without reflow + quick-box shell exists for reuse (NFR-1, UX-DR5).** Given the annotations overlay, it renders each annotation in the `annotations/` layer positioned via the anchor service over the page card, never reflowing or resizing `.pdf-canvas` (NFR-1). The `{component.quick-box}` **shell** exists: it pops on drag-release, is positioned at the selection (nudged to stay on-screen), never shifts the canvas, and dismisses on pick / outside-click / `Esc`. Its mode-specific *contents* are filled by later tool stories; this story wires the shell + one proof action. [Source: ARCHITECTURE-SPINE.md#AD-9; EXPERIENCE.md#Quick-box (lines 61, 100-112); DESIGN.md#quick-box (lines 195-204)]

5. **Two-page selection splits sharing a `group_id` (AD-4).** Given a selection spanning two pages, it splits into one `Annotation` per page, each with a single-page anchor, the two sharing one `group_id` (UUIDv4). A single-page selection has `group_id = null`. [Source: ARCHITECTURE-SPINE.md#AD-4]

6. **Anchor fidelity across zoom (NFR-3).** Given a mark created at one zoom level, when the user zooms (`Ctrl +/-`, `Ctrl 0`, `Ctrl+scroll`), it re-renders at its exact PDF location at every zoom level — proven on the simplest mark. The overlay derives screen position from the normalized anchor on each scale change; it never reads back a stale pixel rect. [Source: ARCHITECTURE-SPINE.md#AD-4; epics.md#Story-2.2 AC6]

7. **Document-level handlers + overlay state machine (Epic 1 retro AP-1, PREP-3).** Given tool-arm keys and overlay pointer interactions, they bind at the `document` level (phase-gated, exempting `INPUT`/`TEXTAREA`/`SELECT`/`BUTTON`/`contentEditable`), NOT to `.pdf-canvas`. The transient-overlay state machine distinguishes **armed-tool / annotating / pending-quick-box / empty** states, with focus moving into the quick-box on open and returning on dismiss (`Esc`-dismissable, keyboard-reachable). [Source: CLAUDE.md#Engineering-principles; epics.md#Story-2.2 AC7; EXPERIENCE.md#Accessibility-Floor (line 131)]

8. **No regression; layering preserved (AD-9).** Existing Epic-1 behavior (load, render, scroll, zoom, pan, ToC) is unchanged and its tests still pass. The new layers respect the strict downward dependency `render → anchor → annotations → store → api`: `render/` imports nothing from `anchor/`/`annotations/`/`store/`; `annotations/` imports `anchor/` + `store/` only; `store/` imports `api/` only. `no-raw-values.test.ts` stays green (no inline hex/px outside `theme/**`). [Source: ARCHITECTURE-SPINE.md#AD-9, Design-Paradigm; CLAUDE.md#Design-conventions]

## Tasks / Subtasks

- [x] **Task 1 — Install Zustand; scaffold the layer dirs (AC: 3, 8)**
  - [x] `cd client && npm install zustand@^5.0` (pin exact patch; architecture seeds 5.0.x). Do NOT install perfect-freehand (pen is Story 2.5) or any uuid lib (use `crypto.randomUUID()`).
  - [x] Confirm `client/src/anchor/`, `client/src/annotations/`, `client/src/store/` exist (they hold README placeholders today) and will gain real `index.ts` modules.

- [x] **Task 2 — Define the `Annotation` Pydantic entity + generate the TS type (AC: 3)**
  - [x] In `server/app/models.py` define (AD-5): `Rect {x0,y0,x1,y1: float}`; `TextAnchor {kind:"text", page_index:int, rects:list[Rect], text:str}`, `RectAnchor {kind:"rect", page_index:int, rect:Rect}`, `PathAnchor {kind:"path", page_index:int, points:list[Point]}`; `Anchor = Annotated[Union[...], Field(discriminator="kind")]`; `Style {color:str, stroke_width:float|None=None}`; `Annotation {id, doc_id, type:Literal["highlight","underline","pen","memo","comment"], group_id:str|None, anchor:Anchor, style:Style, body:str|None, created_at:str, updated_at:str}`. Remove the "intentionally NOT defined here" comment in `models.py` for the entity.
  - [x] Surface `Annotation` into the OpenAPI `components.schemas` WITHOUT adding endpoints (the GET/PUT endpoints are Epic 3, per `docs/API.md#Reserved`). Override `app.openapi` in `server/app/main.py` with a `custom_openapi()` that builds the base schema via `get_openapi(...)` then injects `Annotation.model_json_schema(ref_template="#/components/schemas/{model}")`, **hoisting its Pydantic v2 `$defs` (Anchor variants, Rect, Style, Point) into `components.schemas`**. Add a comment: Epic 3 replaces this injection with real `/annotations` endpoint references. (See Dev Notes "Annotation contract decision" for the rationale + the exact pattern.)
  - [x] Regenerate the contract: `cd server && PYTHONPATH= uv run python -m app.export_openapi` then `cd client && npm run gen:api`. Commit the updated `server/openapi.json` + `client/src/api/schema.d.ts`.
  - [x] Re-export the generated type in `client/src/api/client.ts`: `export type Annotation = components["schemas"]["Annotation"];` (and `Anchor`/`Rect`/`Style` as needed). The store/overlay import from here — never hand-author the shape.

- [x] **Task 3 — Anchor service (AC: 1, 2, 5, 6)**
  - [x] `client/src/anchor/index.ts`. The page box is the render layer's `getPageBox(page)` (scale-1.0 CSS-px box). Provide: `normalizeRect(screenRect, pageRect, scale) → Rect` and `denormalizeRect(rect, pageRect, scale) → screen rect`, built on the pdf.js viewport `convertToViewportPoint` / `convertToPdfPoint` so the projection is the library's, not hand-rolled. Canonicalize on create (`x0≤x1, y0≤y1`), top-left origin y-down (the render layer already hands us top-left CSS-px space — see Dev Notes).
  - [x] `rectsFromSelection(selection, pageEl, pageBox, scale) → {page_index, rects: Rect[], text}[]`: read `Range.getClientRects()`, map each client rect into the page card's local box, drop the device-pixel-ratio (the card is in CSS px), normalize each via `normalizeRect`. Group by page card; a selection crossing two cards yields two entries (drives the AC-5 split). Keep this DOM-free-where-possible / thin so it is unit-testable like the `render/` pure helpers.
  - [x] Pure helpers get focused unit tests (jsdom zeroes `getClientRects`, so test the math by feeding rect inputs, mirroring `render/fit.test.ts` / `nav.test.ts`).

- [x] **Task 4 — Zustand store (AC: 3)**
  - [x] `client/src/store/index.ts`: a Zustand store holding `annotations: Map<string, Annotation>` (or `Record<string, Annotation>`) keyed by `id`, with an `addAnnotation(a)` action and selectors (`all()` ordered by `created_at` ascending per AR-12). NO command stack, NO undo, NO dirty flag, NO persistence — Epic 3. Build IDs with `crypto.randomUUID()`; timestamps with `new Date().toISOString()`.
  - [x] Keep `store/` dependency-clean: it may import `api/` types only (AD-9). It must not import `anchor/`, `annotations/`, or `render/`.

- [x] **Task 5 — Annotations overlay + armed-tool state machine + quick-box shell (AC: 4, 6, 7)**
  - [x] `client/src/annotations/` overlay component: for each `Annotation` in the store, render a positioned element keyed off `anchor.kind` (`text` → one box per rect at `{colors.annotation-*}` ~0.4 opacity for the proof highlight). Position via the anchor service `denormalizeRect` against the live page card + scale, so it re-derives on every zoom (AC-6). The overlay is an absolutely-positioned layer over `.pdf-canvas` / the page cards; it must NOT change card geometry (NFR-1). Render keys off `anchor.kind`, never `type`.
  - [x] Armed-tool + quick-box state machine (PREP-3): a small state model `{ armedTool, pendingSelection, quickBoxAt }` with states armed-tool / annotating / pending-quick-box / empty. Tool-arm keys + overlay pointer handlers bind at `document` level, phase-gated (`phase === "ready"`), exempting editable fields + buttons (mirror the Reader's hold-Space `isExempt` and App's tool-key effect exactly).
  - [x] `{component.quick-box}` shell: a floating popup at the drag-release point (`{colors.surface-card}`, `{rounded.md}`, 1px `{colors.hairline}`, soft drop — add the dims to `components.css` from DESIGN.md#quick-box). Pops on drag-release; positioned at the selection, nudged to stay on-screen; never shifts the canvas; dismiss on pick / outside-click / `Esc`; focus moves in on open and returns on dismiss. For THIS story the contents are minimal — one default "highlight" proof action that creates the mark; later stories fill mode-specific contents (swatch row, tool picker).
  - [x] Proof path: in the overlay's interaction layer, a drag text-selection on release → build anchor(s) via `rectsFromSelection` → pop quick-box → on the proof action, create a default `type="highlight"` text `Annotation` (style.color = `{colors.annotation-default}`) in the store → overlay renders it. Two-page selection → two annotations sharing a `group_id` (AC-5).

- [x] **Task 6 — Mount the overlay in the reader without breaking layering (AC: 6, 8)**
  - [x] Wire the overlay into the S1 reader so it shares the page-card geometry + scale. Preferred: mount inside `Reader`'s page column / per-card so it tracks `scale` and the card box, OR an overlay layer in `App`'s `<main className="stage">` that reads the same scale. The overlay needs the page card element + box + current `scale` + the `PDFPageProxy` viewport for the anchor math. Decide the minimal prop/seam that keeps `render/` ignorant of annotations (AD-9): the overlay (in `annotations/`) consumes the page box + scale; `render/` exports nothing annotation-aware. Document the chosen seam in the component header.
  - [x] Reuse the existing zoom path: the overlay re-renders from normalized anchors whenever `scale` changes (the same `scale` state that drives `PageCard`). Do NOT add a second zoom listener.

- [x] **Task 7 — Tests + regression bar (AC: 1, 2, 5, 6, 8)**
  - [x] Unit-test the anchor pure math (normalize/denormalize round-trip; canonicalization of a negative drag; two-page grouping logic).
  - [x] Component-test the overlay + store: creating a mark adds it to the store keyed by `id`; the overlay renders it; a re-render at a new `scale` repositions it (assert the derived style/position changed, proving AC-6 in jsdom terms); a two-card selection produces two annotations sharing `group_id`.
  - [x] **Render-mock barrels:** if (and only if) you add any new export to `render/index.ts`, add it to BOTH `vi.mock("./render")` barrels (`App.test.tsx`, `Reader.test.tsx`) in the same change (CLAUDE.md rule; the recurring Epic-1 break). If the overlay consumes existing exports only (`getPageBox`), no barrel change is needed — prefer that.
  - [x] Backend: add a model test asserting the `Annotation` discriminated union round-trips (a `text` anchor parses to `TextAnchor`, a `rect` to `RectAnchor`) and that `Annotation` appears in `app.openapi()["components"]["schemas"]`.
  - [x] Full regression: `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q` and `cd client && npm test` + `npm run typecheck` — all green. Verify the contract is in sync (no uncommitted diff after re-running `export_openapi` + `gen:api`).

- [x] **Task 8 — Docs (AC: 3, 8)**
  - [x] `docs/API.md`: the `Annotation` schema is now part of the contract even though the endpoints stay reserved. Add a note under the reserved-annotations rows that the `Annotation` model is defined (Epic 2) and the endpoints that consume it are Epic 3; add a changelog entry. (Do NOT mark the endpoints built.)
  - [x] Update the `anchor/`, `annotations/`, `store/` `README.md` placeholders to describe what now exists (drop the "Empty placeholder" line for the two built this story; `store/` notes the command-stack/persistence half is still Epic 3).

## Dev Notes

### Annotation contract decision (the one non-obvious scoping call) — confirm before building

Two planning signals collide and the dev MUST NOT hand-author the client `Annotation` type to dodge it:
- **AD-3 / AD-5** (architecture, higher authority): the `Annotation` entity is Pydantic-sourced → OpenAPI → **generated** TS; client API types are never hand-authored. The foundation story's stated job is "stands up the `Annotation` entity."
- **`docs/API.md#Reserved` + epics**: the `/api/docs/{doc_id}/annotations` GET/PUT **endpoints** are Epic 3.

**Chosen resolution (build this):** define the Pydantic `Annotation` model NOW and inject it into `components.schemas` via a `custom_openapi()` override **without** adding endpoints, so the client store consumes a generated type while persistence (endpoints + storage IO + client autosave/restore) stays a coherent Epic-3 slice. This keeps Story 2.2 strictly client-foundation (its ACs never mention disk or the API), honors AD-3, and respects the API.md endpoint labeling.

Exact pattern for `main.py`:
```python
from fastapi.openapi.utils import get_openapi
from app.models import Annotation

def custom_openapi():
    if app.openapi_schema:
        return app.openapi_schema
    schema = get_openapi(title=app.title, version=app.version, routes=app.routes)
    ann = Annotation.model_json_schema(ref_template="#/components/schemas/{model}")
    defs = ann.pop("$defs", {})
    schema.setdefault("components", {}).setdefault("schemas", {})
    schema["components"]["schemas"].update(defs)        # Anchor variants, Rect, Style, Point
    schema["components"]["schemas"]["Annotation"] = ann  # Epic 3 replaces this with endpoint refs
    app.openapi_schema = schema
    return schema

app.openapi = custom_openapi
```
**This is the single decision flagged for the user (see "Questions" at the end).** The alternative — building the two thin GET/PUT endpoints + storage annotation IO now — is also defensible but pulls Epic-3 persistence forward; if the user prefers it, swap Task 2's injection for real endpoints and update `docs/API.md` to "built."

### The coordinate model — exactly what render/ already gives you (AD-4)

- The render layer is the **single source** of the page box: `getPageBox(page)` returns `{width, height}` = the PDF.js viewport at **scale 1.0**, CropBox + `/Rotate` baked in, **CSS px (DPR divided out)** (`render/index.ts:158`). The anchor service normalizes against THIS box and nothing else (AD-4, AD-9).
- pdf.js space is bottom-left/y-up; **the render layer already converts to top-left once** via `getViewport` — `renderPage` positions the text layer in top-left CSS-px space. So the anchor service works purely in top-left, y-down space and must NOT re-flip y. Use `page.getViewport({scale})`'s `convertToPdfPoint`/`convertToViewportPoint` for the projection (adopt-stable), not manual `height - y` math.
- Canonical rect is `{x0,y0,x1,y1}` with `x0≤x1, y0≤y1`, normalized to `[0,1]` fractions of the page box. Canonicalize a negative drag on create.
- Screen position is **always derived** from the normalized anchor at the current `scale` — never stored, never read back from a painted pixel rect (that breaks across zoom, AC-6).

### Integration points (read these files; they are the seams)

- `client/src/render/index.ts` — `getPageBox` (the AD-4 box), `renderPage` (paints canvas + `.textLayer` selectable text). The text layer is what `Range.getClientRects()` runs over. **Do not add annotation awareness here** (AD-9); the overlay reads the box/scale, render exports stay annotation-free.
- `client/src/Reader.tsx` — owns `scale` state (`scaleRef`), the `.pdf-canvas` scroll container, `PageCard` (per-page `.page-surface` card with `.textLayer`), and `usePageViewport` (the single IntersectionObserver). The overlay must hang off the same per-card geometry + `scale`. The `.textLayer` div is `textRef` inside `PageCard` (`Reader.tsx:683`). Document-level handlers here (zoom keys, hold-Space) are the convention to mirror: phase-gated `phase === "ready"`, `isExempt` skips editable+buttons (`Reader.tsx:376-387`).
- `client/src/App.tsx` — owns `mode: ToolMode` (`"cursor"|"hand"|"box-select"`), the document-level tool-key effect (`V`/`Esc`/`[`, `App.tsx:65-85`), and renders `<ToolRail>`. The armed *annotation* tool is new state; decide whether it extends `ToolMode` or lives in the annotations layer/store (recommend: keep it in the annotations layer's state machine so App's pointer `ToolMode` stays cursor/hand/box and the annotation tools layer on top — note the seam in the component header). The proof trigger for 2.2 can fire from a text drag-selection in cursor mode (no rail button needed); the real Highlight rail button + `H` is 2.3.
- `client/src/ToolRail.tsx` — `ToolMode` is defined here and shared. The annotation tool buttons (highlight/underline/...) arrive in their own stories; do NOT add them now beyond what the proof needs.
- `server/app/models.py` — currently `HealthStatus`, `DocMeta`, `Doc`. Add the annotation models here (single source, AD-3). `server/app/main.py` builds the FastAPI app + mounts routes; the `custom_openapi` override lands there. `server/app/export_openapi.py` dumps `app.openapi()` → `openapi.json` (no server needed); the override flows through it automatically.
- `client/src/api/client.ts` — the ONLY client→backend path; re-export the generated `Annotation`/`Anchor`/`Rect`/`Style` types here.

### Design tokens (no inline hex/px — `no-raw-values.test.ts` enforces it outside `theme/**`)

- Annotation accent palette already in `tokens.css`: `--color-annotation-{yellow,green,pink,blue,purple,orange,default}` (default = yellow). The proof highlight uses `var(--color-annotation-default)` at ~0.4 opacity.
- `quick-box` / `color-swatch` dims are NOT in `components.css` yet — add them hand-authored from DESIGN.md#components (lines 195-204): quick-box = `{colors.surface-card}` bg, `{rounded.md}`, `{spacing.xxs}` padding, 1px `{colors.hairline}`, soft drop `0 4px 12px rgba(0,0,0,0.04)`; color-swatch = `{rounded.pill}`, 20px, 1px `{colors.hairline-strong}` (swatch is mostly 2.3, but the shell padding/border is this story). `components.css` is the hand-authored token layer (CLAUDE.md); raw values are allowed only under `src/theme/**`.
- `annotation-highlight` component token (DESIGN.md:205) = `{colors.annotation-default}` bg at `opacity 0.4` over the run — add it to `components.css`.
- **No em-dash (—) in any user-facing string** (tooltips, aria-labels, copy). Code comments exempt. [[no-emdash-user-facing]]

### Engineering conventions in force (CLAUDE.md#Engineering-principles)

- **Adopt stable primitives, don't reinvent** (PREP-1): pdf.js viewport convert + native Selection `getClientRects()` + `crypto.randomUUID()`. Surface the build-vs-adopt tradeoff if a primitive doesn't fit, rather than hand-rolling silently.
- **Document-level interaction handlers** (AP-1): the focus bug recurred three times in Epic 1 (zoom keys 1-5, hold-Space 1-8, focus-after-jump 1-9). Bind the tool-arm/overlay key handlers on `document`, phase-gated, exempting editable+buttons — NOT on `.pdf-canvas`.
- **`render/` mock-barrel sync** (AP-2): any new `render/index.ts` export → update BOTH `vi.mock("./render")` barrels (`App.test.tsx`, `Reader.test.tsx`) the same change. Prefer consuming existing exports so no barrel edit is needed.

### Testing standards

- Frontend Vitest + jsdom. jsdom returns zeroed `getBoundingClientRect`/`getClientRects` — so test the **pure anchor math** by feeding rect inputs (mirror `render/fit.test.ts`, `nav.test.ts`, `pan.test.ts`), and test store/overlay wiring at the component level. Real cross-zoom *visual* fidelity (NFR-3) can only be fully proven live (Epic-1 retro: jsdom proves wiring, not movement) — assert the derived-position-recomputes-on-scale-change contract in jsdom, and note live verification is the final proof.
- Backend pytest. Run with the project incantation: `PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q` (CLAUDE.md: `PYTHONPATH=` clears a host ROS leak; the disable-autoload avoids a stray ROS plugin).
- Keep cross-model code review (`bmad-code-review` via Codex) as standing practice when implemented (Epic-1 retro AP-3).

### Project Structure Notes

- New modules land exactly where the source-tree spine places them: `client/src/anchor/` (anchor service — only home of normalize↔screen, AD-4/AD-9), `client/src/annotations/` (overlay view + tool system + quick-box), `client/src/store/` (Zustand working copy; command-stack half is Epic 3). `server/app/models.py` holds the entity (AD-3/AD-5). No new top-level dirs. [Source: ARCHITECTURE-SPINE.md#Structural-Seed (lines 167-183)]
- Strict downward dependency (AD-9, the layer rule): `render → anchor → annotations → store → api`. No upward imports; no sibling reach from `render/` into annotations.

### References

- [Source: .bmad/planning-artifacts/epics.md#Story-2.2-Annotation-foundation] — story statement + 7 ACs (the AC numbering here expands them; AC8 is the implicit no-regression/layering bar).
- [Source: .bmad/planning-artifacts/epics.md#Epic-2 (restructure note, lines 368-372)] — why 2.2 is the foundation split out of the old 2.1; adopt-stable principle.
- [Source: ARCHITECTURE-SPINE.md#AD-4] — spatial-anchor model: normalized `[0,1]`, top-left y-down, page-box basis, canonical rect, `anchor.kind` discriminator, one-anchor-one-page + `group_id` split, adopt-stable-primitives bullet.
- [Source: ARCHITECTURE-SPINE.md#AD-5] — `Annotation` entity shape, type-vs-kind, allowed pairings, style field-scoping, `body` non-null only for memo/comment.
- [Source: ARCHITECTURE-SPINE.md#AD-3] — Pydantic → OpenAPI → generated TS; never hand-author client API types.
- [Source: ARCHITECTURE-SPINE.md#AD-7] — store keys by `id`; Bank order `created_at` asc; (command stack + autosave are Epic 3, called out as OUT of scope here).
- [Source: ARCHITECTURE-SPINE.md#AD-9] — boundary invariants: anchor-only math, storage-only disk, api-only backend access; the layer rule.
- [Source: EXPERIENCE.md (lines 61, 100-112, 131)] — quick-box behavior (pop on drag-release, dismiss on pick/outside/Esc, positioned at selection, never shifts canvas), IP-3 contents mapping, focus-in/return accessibility.
- [Source: DESIGN.md (lines 36-42, 195-207)] — annotation accent palette tokens; quick-box / color-swatch / annotation-highlight component dims.
- [Source: CLAUDE.md#Engineering-principles, #Design-conventions, #Commands] — adopt-stable / document-level-handler / render-mock-barrel; token rules; contract-gen + test incantations.
- [Source: .bmad/implementation-artifacts/2-1-dev-infra-enabler.md] — previous story (infra-only; renumber awareness: anchor foundation is 2.2, not 2.1).

## Previous Story Intelligence

From Story 2.1 (dev-infra enabler) and the Epic-1 retro carried forward:

- **Renumber awareness (critical).** Epic 2 was restructured 2026-06-29: 2.1 = dev-infra enabler (done, infra/docs only, NO anchor code), **2.2 = this foundation**, 2.3–2.9 = the six tool stories. Any older text (`epic-1-retro-2026-06-29.md`, some Epic-2 prose) that says "Story 2-1 stands up the anchor layer / Zustand / command stack" predates the renumber — that work is THIS story. The PREP-1/PREP-2/PREP-3 critical-path items apply here.
- **PREP-1 (anchor primitives):** adopt pdf.js `convertToPdfPoint`/`convertToViewportPoint` + native Selection `getClientRects()`, do NOT hand-roll. (This story.)
- **PREP-3 (overlay state machine):** design the transient-overlay state machine once (armed-tool + quick-box + pending/empty), reusing the ToC-overlay lessons. (This story — the shell every tool story reuses.)
- **PREP-2 (command stack: zundo vs immer-patches vs bespoke)** is Epic 3, NOT this story — the store here is a plain keyed map, no do/undo.
- **Live smoke is the real verifier for movement/layout** (Epic-1 retro): jsdom proved wiring but never real zoom/scroll fidelity. Verify AC-6 (anchor survives zoom) by actually creating a mark and zooming in the running app, not only in jsdom.
- **Document-level handler bug recurred 3× in Epic 1** — bind tool/overlay handlers at `document`, phase-gated, editable/buttons exempt (AC-7).
- Story 2.1 changed only infra/docs (`docker-compose.yml`, `compose.dev.yaml` folded into base, `.env.example`, `README.md`, `CLAUDE.md`); no `client/src` or `server/app` logic moved, so the Epic-1 code baseline is intact for this story.

## Git Intelligence

Recent commits are all planning/infra chores: `c267bbb` (mark 2-1 done), `2e63c9d` (harden Docker dev loop = story 2-1), `8edfdc8`/`b769df0` (app-version surfacing), `3b7ef4d` (correct-course Epic 2 split). No annotation/anchor code exists yet — `anchor/`, `annotations/`, `store/` are README-only placeholders; `models.py` has no `Annotation`; `routes/docs.py` reserves the annotations routes. This is genuinely net-new foundation. Branch off `main` (do not commit to `main` directly, per the global git convention); the dev loop is now the canonical host two-process flow (`uvicorn --reload` + `vite dev`) per Story 2.1.

## Project Context Reference

- Two processes, one container (AD-1/AD-10): `client/` (React 19.2 + Vite 8 + TS 6.0 SPA) and `server/` (FastAPI + Pydantic v2, uv-managed). Prod = single Docker image, FastAPI serves API + built SPA same-origin (no CORS).
- Client layering (AD-9): `render → anchor → annotations → store → api`, strict downward. This story builds the middle three.
- Spatial-anchor model (AD-4) is the cross-phase invariant: annotations (Phase 1), ref-previews (Phase 2), click-to-chat (Phase 3) all consume it. Build it once here.
- No auth, localhost single-user. v1 scope = Phase 1 (viewer/annotator).

## Story Completion Status

Story context engineered and ready for dev. One scoping decision (the `Annotation` contract surfacing approach, Task 2 / Dev Notes) is flagged for user confirmation below but has a chosen default so dev is not blocked.

## Questions / decisions to confirm (non-blocking — defaults chosen)

1. **`Annotation` contract surfacing (primary).** Default = define the Pydantic model + inject into OpenAPI via `custom_openapi()`, NO endpoints (keeps persistence an Epic-3 slice; honors `docs/API.md#Reserved` + AD-3). Alternative = build the thin GET/PUT `/annotations` endpoints + storage annotation IO now. Confirm the default, or switch to the alternative (then Task 2 builds endpoints and `docs/API.md` flips to "built").
2. **Proof-trigger thinness.** Default = the 2.2 mark is created from a cursor-mode text drag-selection → quick-box shell → one default "highlight" action; the real Highlight rail button + `H` hotkey + swatch recolor are Story 2.3 reusing the shell. Confirm this is thin enough, or pull the rail Highlight button into 2.2.
3. **Overlay mount seam.** Default = the overlay lives in `annotations/` and consumes the page-card box + `scale` (render stays annotation-free per AD-9); precise mount point (inside `PageCard` vs. a `stage` overlay layer) left to the dev with the AD-9 constraint stated. Flag if you want a specific mount prescribed.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Claude Code, bmad-dev-story workflow).

### Debug Log References

- Backend: `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q` → 38 passed.
- Frontend: `cd client && npm test` → 19 files, 169 passed; `npm run typecheck` clean.
- Contract: `python -m app.export_openapi` + `npm run gen:api` is idempotent (re-run yields no further diff); `server/openapi.json` is a gitignored build artifact, so only `client/src/api/schema.d.ts` is committed.

### Completion Notes List

- **AC-1 wording reconciliation (flagged).** The story's AC-1/Dev Notes both say "build on pdf.js `convertToPdfPoint`/`convertToViewportPoint`" AND "render already converted to top-left once, so work in top-left y-down and do NOT re-flip y." These pull opposite ways: `convertToPdfPoint` returns y-up PDF points, which would force the manual `height - y` flip the same notes forbid. Resolution (adopt-stable, surfaced per PREP-1): the bottom-left→top-left projection + rotation is adopted from pdf.js `getViewport` via `render/getPageBox`; the anchor service consumes that baked box and does pure scale-normalization (`box * scale` divide/multiply), which round-trips correctly across zoom and rotation. This keeps the math unit-testable (the Dev Notes' own testing guidance) and avoids re-introducing the hand-rolled y-flip. Documented in `anchor/index.ts` header + `anchor/README.md`.
- **Annotation contract (decision #1, default taken).** Defined the Pydantic `Annotation` entity and injected it into `components.schemas` via the EXISTING `_custom_openapi()` override in `main.py` (merged the injection in rather than adding a second override), WITHOUT adding endpoints. The `/annotations` GET/PUT stay Epic 3; the client store consumes a generated type for an in-memory working copy.
- **Proof trigger (decision #2, default taken).** The 2.2 mark is created from a cursor-mode text drag-selection → quick-box shell → one default "Highlight" action. The rail Highlight button + `H` hotkey + swatch recolor are Story 2.3, reusing this shell + machine.
- **Overlay mount seam (decision #3).** `AnnotationLayer` (per-page view) mounts inside `PageCard`; `AnnotationInteraction` (quick-box + machine) mounts once in the Reader. Both live in `annotations/` and consume `anchor/` + `store/`; `render/` exports nothing annotation-aware (AD-9). Reader is the composition root that passes the live page-card geometry (`getPages`) + `scale` in; no second zoom listener (reuses the existing `scale` state).
- **Live verification still owed (Epic-1 retro).** jsdom proves the wiring + the derived-position-recomputes-on-scale-change contract (AC-6), but real cross-zoom/scroll visual fidelity and the actual drag-select→quick-box→render flow must be smoke-tested in the running app (`uvicorn --reload` + `vite dev`).
- No new runtime deps beyond `zustand@5.0.14`. perfect-freehand (pen, 2.5) and any uuid lib deliberately NOT added (`crypto.randomUUID()`).

### File List

**Added (client):**
- `client/src/anchor/index.ts` — anchor service (normalize/denormalize/canonicalize/pickPage/rectsFromSelection).
- `client/src/anchor/anchor.test.ts`
- `client/src/store/index.ts` — Zustand `useAnnotationStore`.
- `client/src/annotations/machine.ts` — overlay state machine (PREP-3).
- `client/src/annotations/create.ts` — `buildAnnotations` (pure, group_id split).
- `client/src/annotations/position.ts` — `clampToViewport`.
- `client/src/annotations/AnnotationLayer.tsx` — per-page mark view.
- `client/src/annotations/AnnotationInteraction.tsx` — quick-box shell + interaction.
- `client/src/annotations/Annotations.css`
- `client/src/annotations/index.ts` — barrel.
- `client/src/annotations/{machine,create,position,AnnotationLayer,AnnotationInteraction}.test.{ts,tsx}`

**Modified (client):**
- `client/src/api/client.ts` — re-export generated `Annotation`/`Anchor`/`Rect`/`Point`/`Style` + variants.
- `client/src/api/schema.d.ts` — regenerated (new Annotation schemas).
- `client/src/Reader.tsx` — mount `AnnotationLayer` (in `PageCard`) + `AnnotationInteraction`; `getPages` seam.
- `client/src/theme/components.css` — quick-box action / color-swatch / annotation-highlight tokens.
- `client/package.json` / `client/package-lock.json` — add `zustand@^5.0`.

**Added/Modified (server):**
- `server/app/models.py` — `Rect`, `Point`, `TextAnchor`, `RectAnchor`, `PathAnchor`, `Anchor`, `Style`, `Annotation`.
- `server/app/main.py` — inject `Annotation` (+ hoisted `$defs`) into `components.schemas`.
- `server/tests/test_models.py` — discriminated-union round-trip + OpenAPI-surface tests.

**Docs:**
- `docs/API.md` — reserved-annotations note + changelog entry.
- `client/src/{anchor,annotations,store}/README.md` — describe what now exists.

### Change Log

- 2026-06-29 (Story 2.2): Annotation foundation. Added the `anchor/` projection service, the `store/` Zustand working copy, the `annotations/` overlay (per-page view + state machine + quick-box shell + one highlight proof action), and the Pydantic `Annotation` entity surfaced into OpenAPI → generated TS. Mounted the overlay in the Reader (AD-9 layering preserved). Tests: anchor math, reducer, build/group, clamp, store→layer reposition, proof-path commit, backend model round-trip + OpenAPI presence. No regressions (frontend 169, backend 38).

## Review Findings (code-review via Codex gpt-5.5, 2026-06-29)

Cross-model review (Opus implemented, Codex reviewed). Verdict: Changes-Requested.

- [x] [Review][Decision] AC-1 anchor math does not call pdf.js `convertToPdfPoint`/`convertToViewportPoint` (AC-2/AD-4). RESOLVED: amended AC-1 (user decision 2026-06-29). Literal `convertToPdfPoint` returns y-up → would force the `height - y` flip the Dev Notes forbid AND violate AC-2 (top-left y-down); the pure `box*scale` normalization on top of render's already-baked top-left box is the correct adopt-stable layering. Math verified correct across zoom + baked `/Rotate`. AC-1 reworded accordingly.
- [x] [Review][Patch] Dismiss now clears the browser selection so the global pointerup cannot re-pop the quick-box [client/src/annotations/AnnotationInteraction.tsx] (AC-4/AC-7) — `dismiss()` calls `removeAllRanges()` then dispatches; covered by a no-reopen test.
- [x] [Review][Patch] AnnotationLayer now filters by `doc_id` AND `page_index` so the singleton store cannot bleed one doc's marks onto another [client/src/annotations/AnnotationLayer.tsx] (AC-3/AC-8) — `docId` threaded through `PageCard`; cross-doc test added.
- [x] [Review][Patch] Layering fixed: `PageBox` type now owned by `anchor/`; `anchor/` and `annotations/` no longer import from `render/` (the box VALUE still flows down from render, structurally compatible) [client/src/anchor/index.ts, client/src/annotations/AnnotationLayer.tsx] (AC-8).
- [x] [Review][Patch] `normalizeRect` now clamps fractions to `[0,1]` after canonicalization [client/src/anchor/index.ts] (AC-2/AD-4) — overshoot test added.

- 2026-06-29 (Story 2.2, post-review): addressed code-review (Codex) findings — 5 items resolved. Amended AC-1 wording (AC-1↔AC-2 conflict); cleared selection on quick-box dismiss; filtered AnnotationLayer by doc_id; moved the PageBox type into anchor/ to remove the upward render import (AD-9); clamped normalizeRect to [0,1]. Tests added: normalize clamp, cross-doc no-bleed, dismiss-no-reopen. Frontend 171 pass, backend 38 pass, typecheck clean.
