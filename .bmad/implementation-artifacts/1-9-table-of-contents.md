---
baseline_commit: 39755cc1d01912a354333fe6a4d81f9d58a61673
---

# Story 1.9: Table of contents

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> Renumbered from Story 1.7 → 1.9 on 2026-06-28 (correct-course). No code or story file existed under the old number. **This is the LAST story of Epic 1 (the read-a-paper epic).** It adds a read-only Table-of-Contents overlay that lists the PDF's embedded outline and jumps the canvas to a section on click. It is the final FR-1..FR-6 ("view/scroll/zoom/pan/ToC") capability; with it the reader is feature-complete for Epic 1.

## Story

As a reader,
I want a table of contents I can open and click,
so that I can jump to a section without scroll-hunting.

## Acceptance Criteria

1. **Toggle opens a 280px overlay listing the outline (no reflow).** Given a PDF with an embedded outline, when I toggle the ToC (the top-bar `ToC` button), then `{component.toc-panel}` (280px) opens as an overlay listing the document's sections, **overlays the canvas, and never reflows it** — page geometry, scroll height, and card positions are unchanged; only the panel appears on top (NFR-1). Toggling again (button, the panel's close affordance, or `Esc`) closes it. [FR-3, UX-DR11, UX-DR12, NFR-1]
2. **Clicking a row jumps the canvas to that section.** Given a ToC row, when I click it, then the canvas scrolls so the row's target page is at the top of the viewport (same scroll-to-page mechanic as `PgUp`/`PgDn`), respecting `prefers-reduced-motion` (smooth scroll, or instant when reduced motion is set). The jump moves only the scroll offset — it never changes `scale`, card geometry, or the page box (NFR-1), and does no screen↔PDF coordinate math (AR-9). [FR-3, UX-DR17]
3. **No-outline PDF shows an empty state, not an error.** Given a PDF with no embedded outline, when I toggle the ToC, then the panel opens and shows a calm empty/unavailable message (e.g. "This PDF has no table of contents.") rather than erroring, staying blank, or crashing. The reader remains fully usable. [FR-3, edge case]

> **Scope guard.** Adds: an outline reader in `render/` (`getOutline(pdf)` → a flattened, page-resolved `TocEntry[]`); a new `TocPanel` chrome component (presentational, mirrors `ZoomControl`/`ToolRail`); App-level `tocOpen` + `toc` state wiring the **existing top-bar `ToC` placeholder button** to the panel; a `Reader` `onOutline` report + a `jumpToPage(pageNumber)` method on `ReaderHandle` (refactored from the existing PgUp/PgDn scroll); the `toc-panel` + `title-md` token dims in `components.css` and the `.toc-panel` CSS in `App.css`. It does **NOT**: add the **rail** ToC button (DESIGN lists one at the rail bottom — defer to a later rail story; this story wires only the top-bar toggle that EXPERIENCE/UX-DR12 specify and that already exists as a placeholder); resolve a section's **within-page y-offset** (jump is page-level — see Dev Notes "deliberately page-level"); add a keyboard shortcut (`T` is already memo in UX-DR15 — do NOT bind a ToC key); touch zoom/pan/scroll-nav/windowing/the AD-4 page box/anchor math; introduce Zustand or any new dependency; or add any backend route, Pydantic model, OpenAPI, or `docs/API.md` change (pure client; the outline is read from the already-loaded pdf.js document).

## Tasks / Subtasks

- [x] **Task 1 — `getOutline` outline reader in `render/`** (AC: 1, 2, 3)
  - [x] Add to `client/src/render/index.ts` (next to the other pdf.js wrappers like `getPageBox`): an exported type and async reader.
    ```ts
    /** One flattened outline row, resolved to a 1-based page. `depth` (0-based)
     *  drives indentation; only entries that resolve to a page are included. */
    export interface TocEntry { title: string; pageNumber: number; depth: number; }

    export async function getOutline(pdf: PDFDocumentProxy): Promise<TocEntry[]> { … }
    ```
  - [x] Call `pdf.getOutline()`. It returns `Array<{ title, dest: string | any[] | null, items: OutlineNode[], … }>` (or `null`/`[]` when the PDF has no outline). Recurse `items` to flatten the tree, carrying `depth` (top level = 0). **Trim** `title` and skip entries with an empty title.
  - [x] Resolve each node's `dest` to a 1-based page, tolerating every shape (see the footguns):
    - `dest` is a **string** → `const explicit = await pdf.getDestination(dest)` (named destination); if it returns `null`, the entry is unresolvable → **skip it**.
    - `dest` is an **array** → use it directly as the explicit destination.
    - The explicit destination's **first element** is the page reference: if it is an **object** (a `RefProxy` `{ num, gen }`), `const idx = await pdf.getPageIndex(ref)` → `pageNumber = idx + 1`; if it is already a **number**, treat it as a 0-based page index → `pageNumber = dest[0] + 1`. Clamp the result to `[1, pdf.numPages]`.
    - `dest` is `null`/missing, or resolution throws → **skip the entry** (a url-only or broken bookmark is not a section jump). Wrap each node's resolution in `try/catch` so one bad bookmark never aborts the whole outline.
  - [x] Return `[]` when there is no outline (so the panel shows the empty state, AC-3). The function is async and touches only the pdf.js proxy — **no DOM, no anchor/normalize math** (it stays a `render/` viewport concern, AD-9). Resolve nodes with `Promise.all`/sequential awaits — correctness over micro-perf; outlines are small.
  - [x] Keep `render/`'s import discipline: **no import from `anchor/`, `annotations/`, or `store/`** (AD-9). `getOutline` sits beside `loadDocument`/`getPageBox` as another thin pdf.js wrapper.
- [x] **Task 2 — `Reader`: report outline + expose `jumpToPage`** (AC: 1, 2)
  - [x] Extend `ReaderHandle` (the imperative API App drives) with `jumpToPage(pageNumber: number): void`. Add `getOutline` to the `./render` import list.
  - [x] **Refactor the PgUp/PgDn scroll into a shared internal `scrollToPage(pageNumber)`**: lift the body of `handleKeyDown`'s scroll (`cards.current.get(target)` → `container.scrollTo({ top: card.offsetTop, behavior: reduced ? "auto" : "smooth" })`, with the existing `prefers-reduced-motion` + `typeof scrollTo === "function"` guards) into one `useCallback`. `handleKeyDown` calls `scrollToPage(pageNavTarget(...))`; the new `jumpToPage` clamps its arg to `[1, doc.page_count]` then calls `scrollToPage`. DRY — one scroll mechanic, identical no-reflow behavior (NFR-1). [client/src/Reader.tsx:373-394]
  - [x] Add `jumpToPage` to the `useImperativeHandle` object (alongside `zoomIn`/`zoomOut`/`resetZoom`), with the right dep array. [client/src/Reader.tsx:188]
  - [x] Add an `onOutline?: (entries: TocEntry[]) => void` prop. In the **document-load effect** (the `useEffect` that already does `loadDocument` → reserve boxes → `setPhase("ready")`), after the doc is ready and **before/just as** geometry is set, call `getOutline(loaded)` and report it up — guarded by the existing `cancelled` flag so a unmount-in-flight never calls back. Report `[]` on failure (wrap in try/catch; a missing/broken outline must NOT fail the render — AC-3). Do not block the page-box reservation on the outline (await it separately / fire-and-report). [client/src/Reader.tsx:213-248]
  - [x] Add a `import type { TocEntry } from "./render"` (export it from the barrel in Task 1). No other Reader behavior changes — zoom, pan, windowing, the `usePageViewport` observer, and PgUp/PgDn all stay intact (PgUp/PgDn now routes through `scrollToPage` but behaves identically).
- [x] **Task 3 — `TocPanel` chrome component** (AC: 1, 2, 3)
  - [x] Create `client/src/TocPanel.tsx` at the `client/src/` root (mirror `ZoomControl.tsx`/`ToolRail.tsx`: presentational top-level chrome, owns no scroll/scale/pdf state). Props: `{ open: boolean; entries: TocEntry[]; onJump: (pageNumber: number) => void; onClose: () => void }`. Import `TocEntry` as a type from `./render`.
  - [x] When `!open`, render nothing (`return null`). When open, render `{component.toc-panel}`: an `<aside aria-label="Table of contents">` 280px overlay. Include a small title ("Contents", `{typography.title-md}`) and a close affordance (`<button aria-label="Close table of contents">`, e.g. a Phosphor `X` glyph to match the rail's icon idiom). Rows are `<button>`s (keyboard-operable, UX-DR17) in `{typography.body-sm}`; each shows the entry `title`, indented by `depth` (e.g. inline `paddingLeft` computed from a token step, or nested `data-depth`), and on click calls `onJump(entry.pageNumber)`. Keep `data-testid="toc-panel"` and per-row `data-testid` hooks.
  - [x] **Empty state (AC-3):** when `entries.length === 0`, render the calm message ("This PDF has no table of contents.", `{colors.muted}`) instead of a list. No em-dash in the copy (project rule).
  - [x] **Esc closes** (UX-DR17): a `keydown` listener (mounted only while `open`) calls `onClose` on `Escape`; clean it up on close/unmount. (Outside-click-to-close is optional/nice; Esc + the toggle button + the panel close button are the required dismissals.) Closing returns focus sanely (the panel is an overlay; no focus trap required for v1, but the close button should be reachable).
  - [x] **Accessibility / focus ring:** rows and the close button are real `<button>`s so they get the standard 2px `{colors.ink}` focus ring (`focus-ring.test.ts` must stay green). Do not color-code rows; text only.
- [x] **Task 4 — Wire it in `App`** (AC: 1, 2, 3)
  - [x] In `client/src/App.tsx` add `const [tocOpen, setTocOpen] = useState(false)` and `const [toc, setToc] = useState<TocEntry[]>([])` (lightweight React state — NOT Zustand; matches the App header note). Import `TocEntry` type from `./render` (or re-export through `TocPanel`).
  - [x] Pass `onOutline={setToc}` to `<Reader>` (next to `onVisiblePageChange`/`onZoomChange`).
  - [x] Replace the **existing placeholder** top-bar `ToC` `<button className="pill">ToC</button>` (App.tsx:108-111) with a real toggle: `onClick={() => setTocOpen((o) => !o)}`, `aria-pressed={tocOpen}`, `aria-label="Table of contents"`, keep `className="pill"` and the `ToC` text. (Leave the `Bank` placeholder pill untouched — it is Story 3.6.)
  - [x] Render `<TocPanel open={tocOpen} entries={toc} onJump={(p) => { readerRef.current?.jumpToPage(p); setTocOpen(false); }} onClose={() => setTocOpen(false)} />` inside `<main className="stage">` (a sibling of `<Reader>`/`<ToolRail>`, so it overlays the same stage). Clicking a row jumps **and** closes the panel (reading-flow: you picked a section, get out of the way).
  - [x] **Reset `tocOpen`/`toc` on doc change is automatic** because `App` re-mounts nothing, but `toc` is refilled by the next `onOutline`; if you ever support swapping docs in place, the new `onOutline([])`→`onOutline(entries)` already replaces it. No extra wiring needed for the single-doc v1.
- [x] **Task 5 — Tokens + CSS** (AC: 1, 2, 3)
  - [x] In `client/src/theme/components.css` add the missing hand-authored dims (px allowed ONLY here): `--toc-panel-width: 280px` (DESIGN toc-panel), a `--toc-panel-offset` (top/right inset, reuse the rail's 16px feel), a `--toc-row-gap`, a `--toc-indent-step` (per-depth indent), and the **`title-md`** typography tokens the panel title needs: `--type-title-md-size: 18px`, `--type-title-md-weight: 600`, `--type-title-md-leading` (DESIGN typography title-md, used by panel titles). [DESIGN.md components.toc-panel; typography title-md line 376]
  - [x] In `client/src/App.css` add a `.toc-panel` block (mirror the `.tool-rail` overlay precedent): `position: absolute`, **right-edge** inset (`right`/`top` from `--toc-panel-offset`, below the top bar via `top`), `width: var(--toc-panel-width)`, `background: var(--color-surface-card)`, `border: var(--hairline-width) solid var(--color-hairline)`, `border-radius: var(--radius-lg)`, `box-shadow: var(--shadow-card)`, a `z-index` above the canvas (and above/around the rail — pick a value consistent with the existing rail `z-index: 4` / flyout `6`; the panel should sit above the canvas, e.g. `z-index: 5`). The list scrolls inside the panel (`overflow-y: auto`, capped `max-height` so a long outline never grows past the viewport) — the panel scrolls, the **canvas never moves** (NFR-1). Row/title/close styles use the tokens above. **Raw px/hex only ever in `src/theme/**`** — `no-raw-values.test.ts` enforces this for `App.css`/`TocPanel.tsx`.
- [x] **Task 6 — Tests** (AC: 1, 2, 3)
  - [x] `client/src/render/outline.test.ts` (new; DOM-free, mirrors `render/pan.test.ts`/`nav.test.ts`): drive `getOutline` with a **fake pdf proxy** exposing `getOutline`, `getDestination`, `getPageIndex`, `numPages`. Cover: a nested outline flattens with correct `depth` + 1-based `pageNumber`; a **string** dest resolves via `getDestination`; an **array** dest with a `RefProxy` first element resolves via `getPageIndex`; an array dest with a **numeric** first element maps `n → n+1`; a `null`/unresolvable dest entry is **skipped**; `getOutline()` returning `null`/`[]` yields `[]`; a throwing node is skipped without rejecting the whole call.
  - [x] `client/src/TocPanel.test.tsx` (new; mirror `ZoomControl.test.tsx` — DOM-only, no pdf.js): `open=false` renders nothing; `open=true` with entries renders the rows (`data-testid="toc-panel"`); clicking a row calls `onJump` with that entry's `pageNumber`; empty `entries` shows the empty-state copy (and NOT a row list); the close button and `Escape` both call `onClose`.
  - [x] `client/src/App.test.tsx` additions: clicking the top-bar `ToC` button opens the panel (`toc-panel` appears) and toggles it closed; with a non-empty `toc` (drive via the Reader mock's `onOutline`, or assert the panel renders rows), clicking a row calls `readerRef`'s `jumpToPage` (spy on the handle or assert the panel closes). **Add `getOutline: vi.fn(async () => [])` to the `vi.mock("./render", …)` barrel** (App.test.tsx:9-29) — the Reader now imports it, so the mocked barrel must export it or the load effect throws.
  - [x] `client/src/Reader.test.tsx` additions: **add `getOutline: vi.fn(async () => [])` to its render mock** (Reader.test.tsx:9-35); assert `onOutline` is called after load; assert `ref.current.jumpToPage(2)` calls `container.scrollTo` with the page-2 card's `offsetTop` (mirror the existing PgUp/PgDn scroll assertion). Confirm the existing PgUp/PgDn nav tests still pass (the `scrollToPage` refactor must be behavior-preserving).
  - [x] `no-raw-values.test.ts` + `focus-ring.test.ts` stay green (new panel rows/close button show the standard focus ring; no raw px/hex outside `theme/**`).
- [x] **Task 7 — Validate + live smoke** (AC: all)
  - [x] `cd client && npm test` (all green incl. the new `outline`/`TocPanel` tests + the two mock additions), `npm run typecheck` (clean), `npm run build` (succeeds).
  - [x] **Live (AC-1/2/3):** `npm run dev`, open a paper **with** an embedded outline (most arXiv papers have one), then:
    - Click the top-bar **`ToC`** → the 280px panel opens as an overlay listing sections; the page **does not reflow** (scroll height + card positions unchanged, panel floats on top). Click again / press `Esc` / click the panel close → it closes.
    - Click a **section row** → the canvas **jumps** so that section's page is at the top (smooth, or instant under `prefers-reduced-motion`); zoom/scale/geometry unchanged. The panel closes on the jump.
    - Open a PDF **without** an outline → the panel opens and shows "This PDF has no table of contents." (no error, no crash, reader still works). A scanned/no-outline PDF is the test case.
    - Sanity: `PgUp`/`PgDn`, zoom (`Ctrl +/-/0`, `Ctrl+scroll`), pan (hand / Space), and plain scroll still work (the `scrollToPage` refactor changed nothing for them).
  - [x] No backend change — do not regenerate the OpenAPI contract or edit `docs/API.md`.

### Review Follow-ups (AI)

- [ ] [Review][Medium] Distinguish outline loading from no-outline empty state. `toc` initializes as `[]`, and `TocPanel` renders "This PDF has no table of contents." whenever `entries.length === 0`; an outlined PDF opened before `Reader` resolves `getOutline` can show the no-outline message instead of a pending state. Use a distinct pending state (`TocEntry[] | null` or equivalent) so AC-1 PDFs do not show AC-3 empty copy until outline resolution has completed. [client/src/App.tsx:35, client/src/TocPanel.tsx:58, client/src/Reader.tsx:294]
- [ ] [Review][Medium] Restore keyboard focus to the reader after a ToC row jump. Row activation closes the panel and unmounts the focused row button, but PgUp/PgDn navigation is still bound to `.pdf-canvas`; keyboard users can lose reader navigation immediately after a successful jump. Focus the canvas as part of `jumpToPage` or the row-jump handoff without introducing an extra scroll. [client/src/App.tsx:147, client/src/Reader.tsx:423]
- [ ] [Review][Low] Constrain the ToC overlay on narrow stages. `.toc-panel` is fixed at `--toc-panel-width` plus the right offset; below roughly the panel width plus both offsets, the overlay can clip row text or the close affordance. Cap width against the available stage width while preserving the 280px token at normal sizes. [client/src/App.css:201]

## Dev Notes

### Architecture patterns & constraints (binding)

- **ToC is a `render/` (viewport) concern.** The capability map puts **FR-1..FR-6 (view/scroll/zoom/pan/ToC) in client `render/`**. The outline reader (`getOutline`) is another thin pdf.js wrapper next to `loadDocument`/`getPageBox` — it reads the document's outline + resolves dests to page numbers. It is NOT screen↔PDF coordinate math, so it does not touch `anchor/` and does not violate AD-9/AR-9. The jump is pure `scrollTo` (page-level), the same mechanic PgUp/PgDn already uses. [Source: ARCHITECTURE-SPINE.md capability map line 190 (FR-1..FR-6 → render/); AD-9 lines 103-128]
- **Tool/panel state is lightweight React state — NOT Zustand.** Zustand is the *chosen* store lib (AD-2) but is **not installed**; the Epic 2/3 annotation+command system is where it lands. `App.tsx` already states "Lightweight React state only; the Zustand annotation store arrives with annotations (Epic 2/3)." Keep `tocOpen`/`toc` in `App`; do not add a dependency. [Source: client/src/App.tsx:10-16; ARCHITECTURE-SPINE.md AD-2]
- **NFR-1 layout stability is the bar.** The panel is an **overlay** (`position: absolute`, `z-index` above the canvas) that never consumes canvas width or reflows it — the same rule the top-bar chrome, tool-rail, and flyout already follow (DESIGN line 317: "The PDF canvas is sacred — no UI ever reflows or resizes it"). The jump changes only `scrollTop` via `scrollTo` — never `scale`, card geometry, or the page box. [Source: epics.md NFR-1 (line 64), UX-DR11 (101), UX-DR12 (102); DESIGN.md line 317; client/src/App.css `.tool-rail` overlay block]
- **The jump is deliberately page-level (no within-page y).** AC-2 = "jump to that section"; v1 resolves a section to its **page** and scrolls the page to the viewport top, reusing the PgUp/PgDn `scrollTo(card.offsetTop)` mechanic. Computing a precise within-page y from the dest array (`dest[3]` is a PDF-space y, bottom-left origin) would require viewport→screen projection — that is `anchor/` territory (AD-4/AR-9) and out of scope for a `render/` ToC. Keep it page-level; a y-refinement can come later if needed. [Source: ARCHITECTURE-SPINE.md AD-9 line 117 (coordinates live in anchor/); client/src/Reader.tsx:373-394]
- **No keyboard shortcut for ToC.** The UX-DR15 keyboard map assigns `T` to **memo**, not ToC — do NOT bind `T` (or any key) to the panel. The toggle is the top-bar button only (UX-DR12/EXPERIENCE line 28). [Source: epics.md UX-DR15 line 105; EXPERIENCE.md line 28]
- **No backend / contract / token-generation change.** Pure client UI + a pdf.js read of the already-loaded document. `components.css` is the **hand-authored** dims layer (not generated) — adding `toc-panel`/`title-md` dims there is correct and does not require `gen:tokens`. No `/api`, Pydantic, OpenAPI, or `docs/API.md` edit. [Source: CLAUDE.md design-tokens + API note; ARCHITECTURE-SPINE.md capability map]

### The footguns (read before coding)

- **`dest` has many shapes — resolve defensively.** A bookmark's `dest` is `string | any[] | null`. A string is a **named** destination (resolve via `pdf.getDestination(name)`, which can return `null`). An array is an **explicit** destination whose `[0]` is the page: usually a `RefProxy` object `{num, gen}` (→ `pdf.getPageIndex(ref)`, a 0-based index), sometimes a bare number (already a 0-based index). url-only bookmarks, `null` dests, and resolution errors are **not** section jumps → skip them. Wrap each node in `try/catch` so one malformed bookmark never aborts the whole outline (a real-world PDF hazard). [Source: pdfjs-dist types api.d.ts getOutline (969-984), getDestination (902), getPageIndex (886)]
- **`getOutline()` is `null`/`[]` for a no-outline PDF — that is the empty state, not an error.** Many scanned or simple PDFs have no outline. `getOutline` must return `[]` (Task 1) and the panel must render the calm AC-3 message. Do not throw, do not leave the panel blank-with-no-explanation. [Source: AC-3; pdfjs-dist getOutline returns the tree "if it has one"]
- **The render mock must export `getOutline` or the Reader load effect throws.** Both `App.test.tsx` and `Reader.test.tsx` `vi.mock("./render", …)`; the Reader now imports `getOutline`, so add `getOutline: vi.fn(async () => [])` to **both** mock barrels (as the Story 1.7 windowing change had to add `pageWindow`/`WINDOW_RADIUS`). Forgetting this breaks every Reader/App test, not just the new ones. [Source: client/src/App.test.tsx:9-29; client/src/Reader.test.tsx:9-35]
- **`scrollToPage` refactor must be behavior-preserving.** PgUp/PgDn currently inlines the scroll in `handleKeyDown`; lifting it into a shared `scrollToPage` is for DRY (jumpToPage reuses it). Keep the **exact** guards: `cards.current.get(target)`, `typeof container.scrollTo === "function"` (jsdom lacks it), and the `prefers-reduced-motion` → `"auto"` branch. The existing PgUp/PgDn tests must still pass unchanged. [Source: client/src/Reader.tsx:373-394]
- **Resolution is async; don't block the page-box reservation on it.** The load effect's first job is reserving geometry (NFR-1 — pages must lay out at final size before paint). `getOutline` involves extra awaits (`getDestination`/`getPageIndex`); run/report it **separately** from the box loop (e.g. after `setPhase("ready")`, or as its own awaited step that doesn't gate the boxes), guarded by `cancelled`. The panel can populate a beat after the pages — that is fine; the pages must not wait on the outline. [Source: client/src/Reader.tsx:213-248]

### Current state of files this story touches (read before editing)

- `client/src/render/index.ts` — the pdf.js wrapper + DOM-free helpers (`loadDocument`, `getPageBox`, `fitToWidthScale`, `nextZoom`, `focalScroll`, `panScroll`, `currentPageInView`, `pageNavTarget`, `pageWindow`, `renderPage`). **Change:** add `TocEntry` + `getOutline(pdf)`. It already imports `PDFDocumentProxy`/`PDFPageProxy` types. Keep the no-anchor/no-DOM discipline (file header). [client/src/render/index.ts:1-72]
- `client/src/Reader.tsx` — owns the pdf proxy, the `.pdf-canvas` scroll container, `ReaderHandle` (zoom), `handleKeyDown` (PgUp/PgDn scroll), and the document-load effect. **Change:** add `jumpToPage` to `ReaderHandle` + `useImperativeHandle`; refactor PgUp/PgDn scroll into `scrollToPage`; add `onOutline` prop + a `getOutline` call in the load effect. Nothing else moves (zoom, pan, windowing, observer untouched). [client/src/Reader.tsx:32-37 (ReaderHandle), 188 (useImperativeHandle), 213-248 (load effect), 373-394 (handleKeyDown scroll)]
- `client/src/App.tsx` — the shell. **Today:** holds `doc`/`currentPage`/`zoomPercent`/`mode`/`railCollapsed` React state + `readerRef`; renders the top-bar with `ZoomControl` + **placeholder** `ToC`/`Bank` pills (lines 107-114) and `<main className="stage">` with `<Reader>` + `<ToolRail>`. **Change:** add `tocOpen`/`toc` state; wire the `ToC` pill to toggle; pass `onOutline={setToc}` to Reader; render `<TocPanel>` in `<main>`. Leave the `Bank` pill placeholder (Story 3.6). [client/src/App.tsx:18-135]
- `client/src/TocPanel.tsx` — **NEW.** Presentational chrome, mirrors `ZoomControl.tsx`/`ToolRail.tsx`. 280px overlay, rows + close + empty state.
- `client/src/App.css` — has `.top-bar`, `.pill`, `.zoom-control`, `.stage`, `.tool-rail`/`.tool-button`/`.tool-flyout` overlay blocks. **Change:** add a `.toc-panel` overlay block (mirror `.tool-rail`). Tokens only. [client/src/App.css:45-185]
- `client/src/theme/components.css` — hand-authored dims; has `--top-bar-*`, `--tool-rail-*`, `--tool-button-*`, `--zoom-control-*`, `title-sm`/`body`/`caption` type. **Change:** add `--toc-panel-*` + `title-md` type tokens. [client/src/theme/components.css]

### Testing standards

- Vitest + jsdom (`npm test`), typecheck `npm run typecheck`. New presentational components get a `*.test.tsx` next to them (mirror `ZoomControl.test.tsx`); DOM-free `render/` functions get a unit test in `render/` (mirror `pan.test.ts`/`nav.test.ts` — `outline.test.ts` joins them). [Source: CLAUDE.md commands; client/src/*.test.tsx]
- **jsdom can't prove the scroll movement** (no layout → `scrollTo` is a stub that records args but moves nothing — the existing PgUp/PgDn tests assert the `scrollTo` **call**, not pixels). So automated coverage = `getOutline` resolution math + `TocPanel` interactions + the `jumpToPage`→`scrollTo(offsetTop)` **wiring**. The **visual no-reflow + real jump proof is the Task-7 live smoke** — do not claim AC-1/AC-2 without it. [Source: existing Reader.test.tsx PgUp/PgDn assertions]
- `no-raw-values.test.ts` (no hex/px outside `theme/**`) and `focus-ring.test.ts` must stay green — the new panel rows + close button must show the standard focus ring. [Source: client/src/no-raw-values.test.ts; client/src/focus-ring.test.ts]

### Previous-story intelligence (1.8 tool-rail, 1.7 windowing, 1.5 zoom, 1.1 shell)

- **1.8 set the chrome-component + imperative-handle precedent — reuse both.** `ToolRail`/`ZoomControl` are presentational top-level chrome at `client/src/` root; `TocPanel` joins them. The `ReaderHandle` imperative pattern (`useImperativeHandle` driven by App via `readerRef`) is exactly how `jumpToPage` should be exposed — extend the existing handle, don't invent a new channel. App's "lightweight React state" note is the standing guidance against premature Zustand. [Source: 1-8-pan-hand-tool.md; client/src/ToolRail.tsx; client/src/Reader.tsx:32-37,188]
- **1.8 added `@phosphor-icons/react`** (relaxing the earlier no-new-dep guard, by user request) — so a Phosphor glyph for the panel close button (`X`) and any ToC chrome is consistent with the rail. Paint with `currentColor`, size via a token (like `--tool-icon-size`). No NEW dependency needed for this story. [Source: 1-8-pan-hand-tool.md Change Log 2026-06-28 last row]
- **1.7 unified the observer; 1.5 set the doc-level keyboard precedent — neither is disturbed here.** ToC adds no scroll listener (the jump is a one-shot `scrollTo`, picked up by the single `usePageViewport` observer like any scroll). The panel's `Esc` listener is component-local (mounted only while open), not a doc-level map — it does not collide with App's `V`/`Esc`→cursor handler (both can fire; closing the flyout/panel + returning to cursor is harmless). [Source: 1-7-render-perf-windowing.md; client/src/render/usePageViewport.ts; client/src/App.tsx:41-61]
- **1.1 left the `ToC` pill as a focusable placeholder** (App.tsx comment "behavior wired in later stories (ToC 1.7, Bank 3.6)" — the "1.7" there is the OLD pre-renumber number; this IS that story, now 1.9). This story gives the pill its behavior; keep `className="pill"` + the `ToC` label so the top-bar layout is unchanged. [Source: client/src/App.tsx:107-114]

### Project Structure Notes

- `TocPanel.tsx` at `client/src/` root mirrors `ZoomControl.tsx`/`ToolRail.tsx`/`Toast.tsx`/`EmptyDropzone.tsx` (top-level chrome), keeping it out of the `render/`→`anchor/`→`annotations/` layer dirs. The full annotation/bank panel system moves into `annotations/` in Epic 3; a single read-only ToC overlay driven by App state is fine at root. [Source: client/src tree; ARCHITECTURE-SPINE.md source-tree lines 168-178]
- `getOutline` + `TocEntry` belong in `render/index.ts` with the other pdf.js wrappers; ToC is viewport-layer (FR-1..FR-6 → render/). No conflict with the layered downward-dependency rule. [Source: ARCHITECTURE-SPINE.md capability map line 190]
- **Panel edge = right (decision).** The spec pins the size (280px) and that it overlays (UX-DR11), but not the edge. Chosen **right-edge** because the toggle lives in the top-bar right (UX-DR12) so the panel appears near its trigger, and the **left edge is occupied by the tool-rail** — a left ToC drawer would cover the 48px rail. The future Annotation Bank (320px, right, `Ctrl B`, Story 3.6) is a mutually-exclusive toggle, so right-edge parity is intentional. A dev/designer can flip to left by changing the one `.toc-panel` CSS block (offset side) — low-stakes, reversible. [Source: DESIGN.md toc-panel (256-260) — size only; EXPERIENCE.md line 28; epics.md UX-DR12 line 102]

### References

- [Source: .bmad/planning-artifacts/epics.md#Story-1.9 (lines 347-366)] — story statement + 3 ACs (toggle→280px overlay no-reflow, row→jump, no-outline empty state).
- [Source: .bmad/planning-artifacts/epics.md FR-3 (29/114), NFR-1 (64), UX-DR11 (101), UX-DR12 (102), UX-DR15 (105), UX-DR17 (107)] — ToC requirement, layout stability, panel + top-bar specs, keyboard map (T=memo, so no ToC key), accessibility floor (keyboard rows, focus ring, prefers-reduced-motion).
- [Source: .bmad/planning-artifacts/prds/prd-paper-mate-2026-06-28/prd.md FR-3] — table-of-contents jump-to-section.
- [Source: .bmad/planning-artifacts/architecture/.../ARCHITECTURE-SPINE.md capability map line 190 (ToC in render/), AD-2 (store/lib), AD-4/AD-9 (anchor boundary), source-tree 168-178] — ToC-in-render, no-Zustand-yet, no anchor math, file homes.
- [Source: DESIGN.md toc-panel (256-260), typography title-md (376), line 317 (canvas sacred), rounded.lg panels (425)] — toc-panel 280px / surface-card / hairline / body-sm rows, panel-title type, overlay rule, panel radius.
- [Source: EXPERIENCE.md lines 28, 32-33, 132] — top-bar ToC toggle, transient overlay, prefers-reduced-motion degrades jumps to instant.
- [Source: client/src/App.tsx:107-114] — the placeholder `ToC` pill to wire + the lightweight-state note.
- [Source: client/src/ZoomControl.tsx; client/src/ToolRail.tsx] — the presentational chrome-component pattern to mirror.
- [Source: client/src/Reader.tsx:32-37,188,213-248,373-394] — `ReaderHandle`, `useImperativeHandle`, the load effect, and the PgUp/PgDn scroll to refactor into `scrollToPage`.
- [Source: client/src/render/index.ts:47-72] — `loadDocument`/`getPageBox`, the neighbors for `getOutline`.
- [Source: client/node_modules/pdfjs-dist/types/src/display/api.d.ts:886,902,969-984] — `getPageIndex`/`getDestination`/`getOutline` signatures + the `OutlineNode` shape (`dest: string | any[] | null`, `items`).
- [Source: client/src/theme/components.css; client/src/App.css:45-185] — the token + CSS homes to extend.
- [Source: client/src/App.test.tsx:9-29; client/src/Reader.test.tsx:9-35] — the `vi.mock("./render")` barrels that must gain `getOutline`.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (BMad dev-story workflow)

### Debug Log References

- **Unit tests:** `124 passed` (added `render/outline.test.ts` 10 cases, `TocPanel.test.tsx` 6 cases, plus Reader cases for `onOutline`/`jumpToPage` + clamp, App cases for the ToC toggle/empty-state/row-jump-closes). `npm run typecheck` clean; `npm run build` succeeds (the >500kB chunk warning is pre-existing, not from this story). PgUp/PgDn nav tests stay green after the `scrollToPage` refactor.
- **Live browser smoke** (Vite dev `:5173`, FastAPI `:8000`, driven via Playwright):
  - **AC-1:** imported `outlined-sample.pdf` → top-bar `ToC` opens `{component.toc-panel}` at **280px, right-edge 16px inset**, listing 3 rows ("Section 1: Introduction", "Section 2: Methods", "Section 2.1: Setup") with depth indentation (2.1 at `calc(var(--toc-indent-step) * 2)`). Toggle button and `Esc` both close it; `aria-pressed` tracks open/closed.
  - **AC-2:** clicking "Section 2.1: Setup" jumped to **Page 4 of 4** (`scrollTop` 0 → 3834); **`scrollHeight` (5104) and `scrollWidth` (1011) unchanged across the jump** (NFR-1: offset-only, no reflow); the panel closed on the jump.
  - **AC-3:** imported `no-outline.pdf` → panel opens showing "This PDF has no table of contents.", 0 rows, reader stays usable (no crash).
- **Finding (logged for reviewers):** the repo's existing fixture `09-regularization.pdf` HAS an `/Outlines` tree, but its bookmark destinations are name objects (`/Dest /3b` …) with **no `/Names` or `/Dests` dictionary in the file** — so pdf.js's `getDestination`/`getDestinations` resolve them to nothing (`getDestinations()` returns `{}`). These bookmarks are genuinely unresolvable by pdf.js (its own viewer would fail to jump too), so `getOutline` correctly skips them and the panel shows the empty state for that file. This is why the two new fixtures (`outlined-sample.pdf` with standard explicit-array dests, `no-outline.pdf`) were added to prove the resolvable + empty paths live.

### Completion Notes List

- **`render/getOutline(pdf)` + `TocEntry`** (FR-3, render/ layer): reads the embedded outline, recurses `items` carrying 0-based `depth`, resolves each node's `dest` to a clamped 1-based page across all shapes (named string → `getDestination`; explicit array → first element is a `RefProxy` via `getPageIndex`, or a bare numeric 0-based index). Unresolvable/url-only/throwing nodes are skipped per-node; `getOutline` itself never throws (returns `[]` on any failure or no outline). Pure pdf.js read — no DOM, no anchor math (AD-9/AR-9).
- **Reader**: refactored the PgUp/PgDn scroll into a shared `scrollToPage(pageNumber)` (clamp → find card → `scrollTo(offsetTop)`, `prefers-reduced-motion` aware, jsdom-safe); added `jumpToPage` to `ReaderHandle` (delegates to `scrollToPage`); added an `onOutline` prop reported from a dedicated effect keyed on `pdf` (so a changing callback can't reload the document and the outline never gates page-box reservation, NFR-1).
- **`TocPanel`** (new presentational chrome, mirrors `ZoomControl`/`ToolRail`): 280px overlay, title + Phosphor `X` close, depth-indented row `<button>`s, calm empty state, `Esc`-to-close. Rows + close are real buttons (focus ring, UX-DR17).
- **App**: lightweight `tocOpen`/`toc` React state (no Zustand); wired the existing top-bar `ToC` placeholder pill to toggle (kept its visible "ToC" name as the accessible name so the prior zoom-order test stays green); `onOutline={setToc}`; renders `<TocPanel>` in `<main>`; a row click calls `jumpToPage` then closes the panel.
- **Tokens/CSS**: added `title-md` typography + `toc-panel`/indent/icon dims to `components.css` (px only in the token layer); a `.toc-panel` right-edge overlay block in `App.css` (tokens only). `no-raw-values` + `focus-ring` stay green; row indentation uses `calc(var(--toc-indent-step) * depth)` so no raw px leaks into `TocPanel.tsx`.
- **Decisions held from the story**: jump is page-level (no within-page y — that is anchor/ territory); panel is right-edge (toggle lives top-bar right; left edge holds the rail); no keyboard shortcut (`T` is memo). No backend/OpenAPI/`docs/API.md` change.

### File List

- client/src/render/index.ts (added `TocEntry` + `getOutline` + private `resolveDestPage`)
- client/src/render/outline.test.ts (new)
- client/src/Reader.tsx (import `getOutline`/`TocEntry`; `jumpToPage` on `ReaderHandle`; `scrollToPage` refactor; `onOutline` prop + outline effect)
- client/src/Reader.test.tsx (render mock `getOutline`; `onOutline` + `jumpToPage` + clamp tests)
- client/src/TocPanel.tsx (new)
- client/src/TocPanel.test.tsx (new)
- client/src/App.tsx (import `TocPanel`/`TocEntry`; `tocOpen`/`toc` state; wire top-bar ToC toggle; `onOutline`; render `TocPanel`)
- client/src/App.test.tsx (render mock `getOutline`; ToC toggle/empty/jump-closes tests)
- client/src/theme/components.css (title-md type + toc-panel/indent/icon dims)
- client/src/App.css (`.toc-panel` overlay block)
- fixtures/sample-pdfs/outlined-sample.pdf (new — 4-page PDF with a standard explicit-array outline; the resolvable-outline smoke fixture)
- fixtures/sample-pdfs/no-outline.pdf (new — minimal 1-page PDF with no outline; the empty-state smoke fixture)
- .bmad/implementation-artifacts/sprint-status.yaml (1-9 → in-progress → review)

## Change Log

| Date | Change |
|------|--------|
| 2026-06-28 | Created Story 1.9 (table of contents): `getOutline` outline reader in `render/`, new `TocPanel` overlay (280px, rows + empty state + Esc/close), Reader `onOutline` report + `jumpToPage` on `ReaderHandle` (PgUp/PgDn scroll refactored into shared `scrollToPage`), App wires the existing top-bar ToC pill. Page-level jump, overlay never reflows canvas (NFR-1), no anchor math (AR-9), no backend change. Status → ready-for-dev. |
| 2026-06-28 | Implemented Story 1.9: `getOutline`+`TocEntry` (all dest shapes, never throws), `TocPanel` (280px right overlay, depth-indented rows, empty state, Esc/close), Reader `scrollToPage` refactor + `jumpToPage` + `onOutline` effect, App top-bar ToC toggle. 124 unit tests pass; typecheck/build clean. All 3 ACs verified via live Playwright smoke (resolvable outline → rows + page-4 jump with no reflow; no-outline → empty state). Added `outlined-sample.pdf`/`no-outline.pdf` fixtures (the existing `09-regularization.pdf` has pdf.js-unresolvable named dests). Status → review. |
| 2026-06-28 | Addressed codex `bmad-code-review` findings (Changes Requested → 3 resolved): [Med] loading vs no-outline state (`toc: TocEntry[] \| null` + `TocPanel` loading note); [Med] restore canvas focus after a ToC jump (`scrollToPage` focuses `.pdf-canvas`, live-verified PgDn works post-jump); [Low] `.toc-panel` `max-width` so it shrinks on narrow stages. Hardened the two `jumpToPage` tests against a React 19 + jsdom last-card registration race. 125 tests pass; typecheck/build clean. |

## Senior Developer Review (AI)

### Outcome

Changes Requested

### Review Date

2026-06-28

### Reviewer Engine

Codex CLI as an independent senior reviewer. Ran the project BMad `bmad-code-review` workflow with Blind Hunter, Edge Case Hunter, and Acceptance Auditor layers, then triaged findings against Story 1.9 and the binding architecture constraints.

### Scope Reviewed

- Diff `39755cc..HEAD` on branch `story-1-9-table-of-contents` at commit `18574f4`.
- In scope: `client/src/render/index.ts`, `client/src/Reader.tsx`, `client/src/TocPanel.tsx`, `client/src/App.tsx`, `client/src/App.css`, `client/src/theme/components.css`, added/updated client tests, and the two sample PDF fixtures.
- Confirmed no backend, package/dependency, OpenAPI, or `docs/API.md` changes in the story diff.

### Acceptance Criteria Assessment

- AC-1 / NFR-1 overlay listing: Mostly satisfied. The panel is an absolute overlay and does not reflow the canvas, and resolved outlines render as rows. However, App cannot distinguish "outline still loading" from "loaded with no outline", so an outlined PDF can temporarily show the no-outline empty state if ToC is opened before `getOutline` resolves.
- AC-2 / page-level jump: Mostly satisfied. `jumpToPage` reuses the same scroll-offset-only mechanic as PgUp/PgDn and does no coordinate math. However, activating a ToC row can leave keyboard focus on an unmounted button/body, so PgUp/PgDn reader navigation is not reliably available after a keyboard-initiated jump.
- AC-3 / no-outline empty state: Satisfied for a resolved no-outline PDF. The same empty copy is currently also used for the pending-outline state, which is tracked as an AC-1 follow-up above.
- AD-9 / AR-9 render boundary: Satisfied. `render/` imports no anchor/annotation/store modules and performs no screen-to-PDF coordinate math.
- Dependency/API/token guardrails: Satisfied by diff inspection. No new dependency, no Zustand, no backend/API docs change, and raw px additions are confined to `client/src/theme/**`.

### Verification

- `cd client && npm test` - passed, 13 files / 124 tests.
- `cd client && npm run typecheck` - passed.
- `cd client && npm run build` - passed; Vite emitted only the existing large-chunk warning.
- `git diff --check 39755cc..HEAD` reports trailing spaces in the hand-authored PDF fixture xref rows; not elevated to a story defect because the requested client validation passes and those lines are fixture internals, not product behavior.

### Severity Breakdown

- High: 0
- Medium: 2
- Low: 1
- Deferred: 0
- Dismissed during triage: 5

### Action Items

- [x] [Medium] Distinguish outline loading from no-outline empty state. [client/src/App.tsx:35, client/src/TocPanel.tsx:58, client/src/Reader.tsx:294]
- [x] [Medium] Restore keyboard focus to the reader after a ToC row jump. [client/src/App.tsx:147, client/src/Reader.tsx:423]
- [x] [Low] Constrain the ToC overlay on narrow stages. [client/src/App.css:201]

### Review Follow-ups (AI) — Resolutions

All three findings addressed (2026-06-28) and re-validated (`npm test` 125 passing, typecheck + build clean; M2 re-verified live):

- ✅ Resolved review finding [Medium] — outline loading vs no-outline: `App.toc` is now `TocEntry[] | null` (`null` until the Reader reports). `TocPanel` renders a "Loading contents…" note (`data-testid="toc-loading"`) for `null`, the "This PDF has no table of contents." empty state only for a resolved `[]`. New `TocPanel` test covers the loading branch. [client/src/App.tsx, client/src/TocPanel.tsx]
- ✅ Resolved review finding [Medium] — focus after jump: `Reader.scrollToPage` now calls `container.focus({ preventScroll: true })` after the scroll, so PgUp/PgDn nav stays live after a ToC row click (a row click unmounts the panel, which otherwise drops focus to `<body>`). `preventScroll` keeps it from fighting the smooth scroll. Live-verified: post-jump `document.activeElement` is the `.pdf-canvas` and PgDn moves the page. [client/src/Reader.tsx]
- ✅ Resolved review finding [Low] — narrow-stage clip: `.toc-panel` gains `max-width: calc(100% - var(--toc-panel-offset) * 2)`, so the panel shrinks instead of clipping off the left edge on a narrow viewport. [client/src/App.css]
- Test-hardening (incidental): the two `jumpToPage` Reader tests now retry the call via `waitFor` — the last page's card registers on a deferred effect under React 19 + jsdom, so a single immediate jump to the final page could race registration (the PgUp/PgDn tests already dodge this by asserting the delta, not the scroll). [client/src/Reader.test.tsx]

### Triage Notes

- Dismissed: out-of-range numeric PDF destinations are explicitly clamped by the story task, not skipped.
- Dismissed: stale ToC on future in-place document swapping is outside the current single-doc v1 flow.
- Dismissed: ToC `Escape` also reaching App's cursor reset is consistent with prior story notes and UX-DR15.
- Dismissed: the Reader outline effect relies on `getOutline`'s internal guards; no current rejected-path evidence was found.
- Dismissed: moving focus into the panel on open and changing the ToC trigger from `aria-pressed` to disclosure semantics would contradict explicit story instructions for this implementation.
