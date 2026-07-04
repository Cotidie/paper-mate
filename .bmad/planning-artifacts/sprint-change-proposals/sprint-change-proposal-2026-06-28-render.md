# Sprint Change Proposal — Render perf + pdf.js decoder wiring

- **Date:** 2026-06-28
- **Author:** Wonseok (dev)
- **Trigger stories:** 1.3 (render), 1.4 (scroll); surfaced while validating 1.5 (zoom)
- **Mode:** Batch
- **Scope classification:** Moderate (backlog reorganization)
- **Status:** Approved 2026-06-28

> Note: this is the second change proposal dated 2026-06-28. The first (`sprint-change-proposal-2026-06-28.md`) moved the zoom control to the top bar (UX-DR10). This file is separate and does not supersede it.

## 1. Issue summary

Two defects in already-done Epic 1 stories, plus a structural cleanup that delivers both fixes.

### A — Scroll jitter (NFR-2 not actually met)

`PageCard` marks a page `visible` once and never releases its painted canvas + text layer (`client/src/Reader.tsx:469-477`; paint lifecycle `:487-526`). Every page scrolled past keeps a full hi-DPI canvas plus a text-layer DOM forever; the cost scales with zoom². The off-screen skeleton infinite animation (`client/src/Reader.css`, `page-skeleton-pulse … infinite`) keeps compositing on every unpainted card. Result: lag/jitter scrolling up and down — the NFR-2 "~60fps, no jank on 50+ pages" bar that Story 1.4 claims is not met. Already logged in `deferred-work.md:12`.

### B — pdf.js WASM decoders never wired

`loadDocument` (`client/src/render/index.ts:45`) calls `getDocument({ url })` with no `wasmUrl` / `cMapUrl` / `iccUrl` / `standardFontDataUrl`. JPEG2000 figures fail to decode, flooding the console with `JpxError: OpenJPEG failed to initialize` and `Dependent image isn't ready yet` (127 warnings observed). The decoders already ship in `pdfjs-dist 6.0.227` at `node_modules/pdfjs-dist/wasm/` (`openjpeg.wasm`, `jbig2.wasm`, `qcms_bg.wasm`) — they are simply unreferenced. The `wasmUrl` option is confirmed present in the v6 types (`api.d.ts:97`).

### Evidence

- DevTools console: 127 messages, all `JpxError` / dependent-image warnings.
- Code line references above.
- `deferred-work.md:12` (scroll-away cancellation / virtualization, deferred from 1.5).

## 2. Impact analysis

- **Epic 1:** completable as planned; these two stories complete it properly (B closes a Story 1.3 render gap; A closes the Story 1.4 NFR-2 claim). No epic added or removed.
- **Stories:** 1.3/1.4 ACs were marked met but A/B reveal a figure-render gap and an unmet NFR-2. Cleanest path is two **new** Epic 1 stories rather than reopening done stories — preserves done history and keeps each fix independently reviewable.
- **PRD / MVP:** unaffected. No scope change; NFR-2 (smoothness) is already in scope and this satisfies it.
- **Architecture:** no spine change. The refactor is render-layer-internal; the AR-9 boundary (render knows nothing of annotations) is preserved. One AR-10-adjacent detail: the wasm/cmap/icc/font assets must be emitted into `dist/` so FastAPI serves them same-origin — covered by a Story 1.6 AC.
- **UX:** none.
- **Other artifacts:** `client/vite.config.*` (static-copy of decoder assets), `client` dependencies (`vite-plugin-static-copy`).

## 3. Recommended path — Option 1 (Direct Adjustment), Hybrid

Insert two render-fix stories as **1.6 / 1.7** and renumber the original pan/ToC stories to **1.8 / 1.9**, so the story number tracks execution order. Neither pan nor ToC had a story file or code under the old numbers, so renumbering breaks no links.

**Execution order = numbering: 1.6 (decoder) → 1.7 (perf/refactor) → 1.8 (pan) → 1.9 (toc).** Story 1.7 restructures `Reader.tsx`; pan and ToC build on it, so the refactor goes before them. Story 1.6 is cheap and independent, so it goes first.

| Story | Effort | Risk | Notes |
|-------|--------|------|-------|
| 1.6 pdf.js decoder & asset wiring | Low | Low | Config + Vite static-copy |
| 1.7 Render perf — windowing & viewport unification | Medium | Medium | Touches core render path; mitigated by existing zoom/render tests + manual scroll verify |

### Path options considered

- **Option 1 — Direct Adjustment (SELECTED):** add two stories within Epic 1, resequence. Maintains scope and timeline; both fixes land cleanly.
- **Option 2 — Rollback:** reverting 1.3/1.4 buys nothing — the gaps are additive, not wrong foundations. Not viable.
- **Option 3 — MVP review:** MVP unaffected; no scope reduction needed. Not applicable.

## 4. Detailed artifact changes

1. **`sprint-status.yaml`** (done): under epic-1, inserted `1-6-pdfjs-decoder-assets: backlog` and `1-7-render-perf-windowing: backlog`, and renumbered the original `1-6-pan-hand-tool` → `1-8-pan-hand-tool` and `1-7-table-of-contents` → `1-9-table-of-contents`.
2. **`epics.md`** (done): inserted Story 1.6 and Story 1.7 (full ACs) and renumbered the pan/ToC stories to 1.8/1.9, with provenance notes.
3. **This proposal**: written to `.bmad/planning-artifacts/sprint-change-proposals/sprint-change-proposal-2026-06-28-render.md` (the plain-dated name was already taken by the zoom-control proposal).

### Story 1.6: pdf.js decoder & asset wiring

As a reader, I want figures and all glyphs to decode, so the page renders fully and the console stays clean.

- Given a PDF with JPEG2000 / JBIG2 images, when it renders, then images decode with no `JpxError` / OpenJPEG console warnings (FR-2, AR-2).
- Given the render layer, then pdf.js asset URLs (`wasmUrl`, `cMapUrl` + `cMapPacked`, `iccUrl`, `standardFontDataUrl`) are configured in one place (`render/config.ts`) consumed by `loadDocument` (AR-2, AR-9).
- Given a prod build, then decoder/cmap/icc/standard-font assets are emitted into `dist/` and served same-origin by FastAPI (AR-10).
- Given an embedded non-standard font, then it renders via standard-font data with no fallback-font warning.

### Story 1.7: Render performance — windowing & viewport unification

As a reader, I want scroll to stay fluid on a long paper, so reading never stutters.

- Given a 50+ page paper, when I scroll up and down, then it holds ~60fps with no jitter (FR-4, NFR-2).
- Given pages scrolled out of view, then their canvas/text-layer bitmaps are released beyond a ±N-page window (bounded live canvases), card geometry preserved (NFR-1).
- Given off-screen cards, then they incur no continuous paint (`content-visibility: auto` + `contain-intrinsic-size`; skeleton animation only near the viewport) (NFR-2, NFR-5).
- Given the render layer, then a single `IntersectionObserver` (a `usePageViewport` hook) drives both current-page tracking and per-card paint/release; `PageCard` holds no lifecycle logic and `Reader` is a pure shell (AR-9).
- Given zoom, page-in-view, and PgUp/PgDn, then all existing Story 1.4 / 1.5 behaviors and tests still pass.

## 5. Implementation handoff

- **Scope:** Moderate (backlog reorganization).
- **Route:** create-story → dev-story cycle, per story, each in a fresh context window:
  - `[CS] bmad-create-story` → `[DS] bmad-dev-story` → `[CR] bmad-code-review`.
- **Start with Story 1.6** (independent, low-risk, clears the console), then Story 1.7.
- **Success criteria:** 1.6 — zero JpxError/OpenJPEG warnings on a JPX-bearing PDF, figures visible; 1.7 — no scroll jitter on a 50+ page paper, bounded live-canvas count, all existing render/zoom/nav tests green.
