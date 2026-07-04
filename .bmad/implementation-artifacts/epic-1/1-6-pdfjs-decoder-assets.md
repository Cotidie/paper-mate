---
baseline_commit: 75cafb105e5fb2e9e5dfa146d4a45ae76a555d63
---

# Story 1.6: pdf.js decoder & asset wiring

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> Added 2026-06-28 via correct-course (`.bmad/planning-artifacts/sprint-change-proposals/sprint-change-proposal-2026-06-28-render.md`). Closes a Story 1.3 render gap: `loadDocument` calls `getDocument({ url })` with none of the pdf.js asset URLs wired, so the bundled WASM image decoders and the CMap/ICC/standard-font data are never referenced. JPEG2000 (and JBIG2) figures fail to decode and the console floods with `JpxError: OpenJPEG failed to initialize` + `Dependent image isn't ready yet` (127 warnings observed on a real paper). The decoders already ship inside `pdfjs-dist 6.0.227` — they are simply unreferenced and never emitted into the build. Sequenced ahead of the original pan/ToC stories (now 1.8/1.9): independent, low-risk, and clears the console first.

## Story

As a reader,
I want figures and all glyphs to decode,
so that the page renders fully and the console stays clean.

## Acceptance Criteria

1. **JPEG2000 / JBIG2 images decode, console clean.** Given a PDF with JPEG2000 (`JPXDecode`) and/or JBIG2 (`JBIG2Decode`) images, when it renders, then the images decode and appear, with **no** `JpxError` / `OpenJPEG failed to initialize` / `Dependent image isn't ready yet` warnings in the console. [FR-2, AR-2]
2. **Single asset-config home, consumed by `loadDocument`.** Given the render layer, then the pdf.js asset URLs (`wasmUrl`, `cMapUrl` + `cMapPacked: true`, `iccUrl`, `standardFontDataUrl`) are defined in **one** place — `client/src/render/config.ts` — and `loadDocument` is the consumer that spreads them into `getDocument(...)`. No asset URL is hand-authored anywhere else. [AR-2, AR-9]
3. **Assets emitted into the build, served same-origin.** Given a prod build (`npm run build`), then the decoder (`wasm/`), CMap (`cmaps/`), ICC (`iccs/`), and standard-font (`standard_fonts/`) assets are copied into `client/dist/` at the path the config URLs point to, and FastAPI serves them same-origin (no CORS, no external CDN). The same paths resolve in dev (Vite) without a separate config. [AR-10]
4. **Embedded non-standard font renders from standard-font data.** Given a PDF whose text uses a non-embedded / non-standard font, when it renders, then glyphs render via the pdf.js standard-font data with **no** "fallback font" / missing-standard-font warning in the console. [FR-2]

> **Scope guard.** This story wires pdf.js's *own* bundled assets so the existing render path decodes everything and stops warning. It adds: `client/src/render/config.ts` (the single asset-URL home), the spread of that config into the one `getDocument(...)` call in `loadDocument`, and a Vite static-copy step (+ the dev dependency it needs) that emits the four asset dirs into `dist/` at those URLs. It does **NOT**: change the rendering algorithm, the canvas/text-layer swap, zoom/scroll/nav, the `getPageBox` AD-4 box, or any anchor/annotation math; add a backend route or change the Pydantic contract / `docs/API.md`; introduce an external CDN (assets stay same-origin per AR-10); touch `render/`'s annotation-agnostic boundary (AR-9). Do **not** hand-author any asset URL outside `config.ts`, and do **not** reach the network for decoders.

## Tasks / Subtasks

- [x] **Task 1 — Add the asset-config module `render/config.ts`** (AC: 2)
  - [x] Create `client/src/render/config.ts` exporting a single frozen object (e.g. `PDFJS_ASSET_CONFIG`) with: `wasmUrl`, `cMapUrl`, `cMapPacked: true`, `iccUrl`, `standardFontDataUrl`. These are a subset of pdf.js `DocumentInitParameters` — type it `Pick<…>` or as `Partial<Parameters<typeof getDocument>[0]>` is overkill; a plain typed object literal whose keys match the option names is enough (the spread is validated by `getDocument`'s param type at the call site).
  - [x] Build each URL from a base so dev and prod agree and a future non-root base still works: `const base = \`${import.meta.env.BASE_URL}pdfjs/\`;` then `wasmUrl: \`${base}wasm/\``, `cMapUrl: \`${base}cmaps/\``, `iccUrl: \`${base}iccs/\``, `standardFontDataUrl: \`${base}standard_fonts/\``. **Every URL MUST end with a trailing slash** — pdf.js documents this for all four (`cMapUrl`/`iccUrl`/`standardFontDataUrl`/`wasmUrl` say "Include the trailing slash"); without it the worker requests `…/cmapsAdobe-Japan1-UCS2.bcmap` and 404s.
  - [x] `cMapPacked: true` (the bundled cmaps are binary `.bcmap`; this is also pdf.js's default, but set it explicitly so the config is self-documenting and decoupled from the default).
  - [x] Keep the chosen `pdfjs/` URL prefix in ONE constant so it cannot drift from the Vite copy `dest` in Task 3 (define it once here; reference the same string when reasoning about Task 3).
- [x] **Task 2 — Consume the config in `loadDocument`** (AC: 1, 2)
  - [x] In `client/src/render/index.ts`, import `PDFJS_ASSET_CONFIG` from `./config` and spread it into the existing single `getDocument` call: `getDocument({ url: docFileUrl(docId), ...PDFJS_ASSET_CONFIG }).promise`. This is the ONLY call site (`render/index.ts` `loadDocument`, used once from `Reader.tsx:199`). Do not duplicate the options inline.
  - [x] Leave everything else in `index.ts` untouched (worker wiring, `renderPage`, `getPageBox`, the zoom/scroll/nav helpers). `render/` stays annotation-agnostic (no import from `anchor/`, `annotations/`, `store/`) — AR-9.
- [x] **Task 3 — Emit the assets into the build (Vite static-copy)** (AC: 1, 3, 4)
  - [x] Add the dev dependency: `cd client && npm install -D vite-plugin-static-copy` (latest is 4.x; it provides BOTH a build-time copy and a dev-server middleware that serves the copied targets, so the same `pdfjs/` URLs resolve in `npm run dev` and in the built `dist/` — no per-mode branching).
  - [x] In `client/vite.config.ts`, add the plugin to `plugins: [react(), viteStaticCopy({ targets: [...] })]`. Copy these four pdfjs-dist dirs into `dist/pdfjs/<name>/` (matching the config URLs from Task 1):
    - `node_modules/pdfjs-dist/wasm/*`   → `pdfjs/wasm`
    - `node_modules/pdfjs-dist/cmaps/*`  → `pdfjs/cmaps`
    - `node_modules/pdfjs-dist/iccs/*`   → `pdfjs/iccs`
    - `node_modules/pdfjs-dist/standard_fonts/*` → `pdfjs/standard_fonts`
    - (`src`/`dest` are relative to the project root / `outDir` respectively per the plugin's API; verify the exact `src` glob and `dest` semantics against the installed version's README — do not guess if the build output is empty.)
  - [x] Keep the existing `server.proxy` (`/api` → FastAPI) and `build.outDir: "dist"` and the `test` block exactly as-is — only the `plugins` array changes.
  - [x] **Do not** import the assets via `?url` one-by-one — the worker fetches a whole *directory* of cmaps/fonts by name at runtime (`useWorkerFetch` defaults true in the browser), so they must exist as real files under the URL prefix, which is what static-copy provides.
- [x] **Task 4 — Tests** (AC: 2)
  - [x] Add `client/src/render/config.test.ts` (DOM-free, mirror `fit.test.ts`/`nav.test.ts`/`zoom.test.ts`): assert `PDFJS_ASSET_CONFIG` has `cMapPacked === true`; that `wasmUrl`, `cMapUrl`, `iccUrl`, `standardFontDataUrl` are all defined and **each ends with `/`**; and that they share the `pdfjs/` prefix. This locks the trailing-slash invariant (the #1 silent-404 footgun) into CI.
  - [x] If `Reader.test.tsx` (or any test) `vi.mock("./render")`, the new `config.ts` is internal to `render/` and not imported by tests directly — confirm no existing render mock needs a new export (config is consumed inside `loadDocument`, which is already mocked). Do not broaden the mock surface unnecessarily.
- [x] **Task 5 — Validate + live smoke** (AC: all)
  - [x] `cd client && npm test` (all green, incl. the new `config.test.ts`), `npm run typecheck` (clean — the spread must satisfy `getDocument`'s param type), `npm run build` (succeeds).
  - [x] **Verify the emit (AC-3):** after `npm run build`, confirm the files exist under `client/dist/pdfjs/`: `wasm/openjpeg.wasm`, `wasm/jbig2.wasm`, `wasm/qcms_bg.wasm`, at least one `cmaps/*.bcmap`, `iccs/*.icc`, and a `standard_fonts/*.pfb`.
  - [x] **Live (AC-1, AC-4):** `npm run dev`, open a paper that contains a JPEG2000 figure (most scanned/figure-heavy papers do) in Chrome with DevTools console open. Confirm: figures render (not blank), and the console shows **zero** `JpxError` / `OpenJPEG failed to initialize` / `Dependent image isn't ready yet` / standard-font-fallback warnings. Before/after the fix the count should drop from ~127 to 0 on a JPX-bearing PDF.
  - [x] **Same-origin check (AR-10):** in the DevTools Network tab, confirm the `*.wasm` / `*.bcmap` / `*.pfb` / `*.icc` requests go to the app's own origin (e.g. `localhost:5173/pdfjs/...` in dev), not an external CDN.
  - [x] No backend change this story — do not regenerate the OpenAPI contract or edit `docs/API.md`.

## Dev Notes

### Architecture patterns & constraints (binding)

- **One asset-config home, `loadDocument` is the only consumer (AR-2, AR-9).** AC-2 is explicit that the URLs live in `render/config.ts` and flow through the single `getDocument` call. `render/` is the pdfjs-dist wrapper and the single owner of the page box; it must keep knowing **nothing** about annotations (no import from `anchor/`/`annotations/`/`store/`, no normalize/denormalize math). Adding a config module + spreading it into `getDocument` keeps that boundary intact — it is plain pdf.js plumbing. [Source: ARCHITECTURE-SPINE.md line 170 (`render/` role), epics.md#AR-9; client/src/render/index.ts header comment]
- **Same-origin assets, no CDN (AR-10).** The whole deployment is one container where FastAPI serves the built SPA same-origin (no CORS). Decoder/cmap/icc/font assets must therefore ship **inside** `dist/` and be served by FastAPI, not pulled from `cdnjs`/`unpkg`. This is why we copy the dirs into the build rather than pointing the URLs at a CDN. [Source: ARCHITECTURE-SPINE.md line 111 (#AD-10 deployment); epics.md#AR-10]
- **FastAPI already serves arbitrary files under `dist/` (no server change needed).** `server/app/main.py` mounts `/assets` via `StaticFiles`, and its SPA catch-all `spa_fallback` returns a `FileResponse` for **any** `is_file()` path under the resolved `dist/` (with traversal containment), falling back to `index.html` only when the path isn't a real file. So `GET /pdfjs/wasm/openjpeg.wasm` resolves to the copied file and is served with the correct `application/wasm` content-type — **no route, no `StaticFiles` mount, no server edit is required for this story.** (Assets under `dist/pdfjs/` are served by the catch-all rather than the cache-friendly `/assets` mount; that is acceptable for v1 single-user localhost — do not add cache-header plumbing in this story.) [Source: server/app/main.py:76-93]
- **The decoders already ship in the dependency — do not add new deps for them.** `pdfjs-dist@6.0.227` already contains `wasm/openjpeg.wasm`, `wasm/jbig2.wasm`, `wasm/qcms_bg.wasm` (+ `*_nowasm_fallback.js`), `cmaps/*.bcmap` (169 binary CMaps), `iccs/*.icc`, and `standard_fonts/*.pfb`. The only *new* dependency is the build tool `vite-plugin-static-copy` (devDependency) to emit them. Do not `npm install` any decoder/font package. [Source: `node_modules/pdfjs-dist/{wasm,cmaps,iccs,standard_fonts}/`; sprint-change-proposal-2026-06-28-render.md §1.B]
- **No backend / contract change.** Pure client wiring. No `/api` route, no Pydantic model, no OpenAPI regen, no `docs/API.md` edit. [Source: epics.md Story 1.6 — render-layer only]
- **No design-token surface.** This story writes no UI and no CSS, so `DESIGN.md` tokens / `no-raw-values` are not in play. (`pdf_viewer.css` is already imported in `index.ts` from Story 1.3 — untouched.) [Source: client/src/render/index.ts import block]

### The one real footgun (read before coding)

- **Trailing slash on every URL.** pdf.js builds asset requests by string-concatenating the configured URL with a filename: `cMapUrl + "Adobe-Japan1-UCS2.bcmap"`, `wasmUrl + "openjpeg.wasm"`, etc. The v6 type docs say "Include the trailing slash" for `cMapUrl`, `iccUrl`, `standardFontDataUrl`, **and** `wasmUrl`. Omit it and the worker requests `/pdfjs/cmapsAdobe-Japan1-UCS2.bcmap` → 404 → the **exact** `Dependent image isn't ready yet` / decode failures this story is meant to remove, but now silently (the wasm just won't load). The `config.test.ts` trailing-slash assertion (Task 4) exists to catch this. [Source: node_modules/pdfjs-dist/types/src/display/api.d.ts:620-635]
- **`wasmUrl` is a directory, not a file.** Point it at `…/pdfjs/wasm/` (the dir holding `openjpeg.wasm` / `jbig2.wasm` / `qcms_bg.wasm`); pdf.js appends the specific file. Copying the whole `wasm/` dir also brings the `*_nowasm_fallback.js` and `quickjs-eval.*` files — harmless; leave them. [Source: pdfjs-dist wasm dir listing]
- **Use `import.meta.env.BASE_URL` as the prefix base.** Vite's base defaults to `/`, so `\`${import.meta.env.BASE_URL}pdfjs/\`` is `/pdfjs/` today and stays correct if the app is ever served under a sub-path. A bare leading-slash literal also works now but is more brittle. [Source: Vite base-url convention; vite.config.ts has no custom `base`]

### Current state of files this story touches (read before editing)

- `client/src/render/index.ts` — the pdfjs-dist wrapper. **Today:** `loadDocument(docId)` is `getDocument({ url: docFileUrl(docId) }).promise` (line ~45) — *no* asset options. Worker is wired once at module load via `pdf.worker.min.mjs?url`; `renderPage`/`getPageBox`/zoom/scroll/nav helpers all live here and are **out of scope**. **Change:** add the `import { PDFJS_ASSET_CONFIG } from "./config"` and spread it into that one `getDocument` call. Nothing else. [client/src/render/index.ts:45]
- `client/src/render/config.ts` — **NEW.** The single asset-URL home (Task 1). First non-`index.ts` module in `render/`; mirrors the layer's existing style (pure, DOM-free, annotation-agnostic).
- `client/vite.config.ts` — **Today:** `plugins: [react()]`, a `server.proxy` for `/api`, `build.outDir: "dist"`, and a Vitest `test` block. **Change:** add `viteStaticCopy({ targets })` to `plugins` only; leave proxy/build/test untouched. [client/vite.config.ts]
- `client/package.json` — **Change:** `vite-plugin-static-copy` added under `devDependencies` by `npm install -D`. No runtime dep change.
- `client/src/Reader.tsx` — the single `loadDocument` caller (line ~199). **No change** — it benefits transparently once `loadDocument` carries the asset config. [client/src/Reader.tsx:199]
- `server/app/main.py` — **No change** (see the FastAPI note above; the catch-all already serves `dist/pdfjs/**`).

### Testing standards

- Frontend tests run on **Vitest + jsdom** (`npm test`); typecheck via `npm run typecheck`. DOM-free render helpers get a focused unit test file alongside them in `client/src/render/` (`fit.test.ts`, `nav.test.ts`, `zoom.test.ts` are the precedent — `config.test.ts` joins them). [Source: CLAUDE.md commands; client/src/render/*.test.ts]
- This story's automated coverage is intentionally light (config invariants only) because the real proof is runtime decode behaviour, which jsdom cannot exercise (no WASM image decode, no worker fetch). The **live smoke in Task 5 is the acceptance proof for AC-1/AC-4** — do not claim those ACs met without the console-clean + figures-visible check on a JPX-bearing PDF. [Source: sprint-change-proposal-2026-06-28-render.md §5 success criteria]
- `no-raw-values.test.ts` / `focus-ring.test.ts` are unaffected (no CSS/px in this story) but must stay green. [Source: client/src/no-raw-values.test.ts]

### Previous-story intelligence (1.5 zoom, and 1.3 render)

- **The render path that consumes these assets is settled.** Story 1.5 finished the zoom/render path: `renderPage` paints offscreen and atomically swaps canvas + text layer, sets `--scale-factor`/`--total-scale-factor`, and cancels in-flight renders. None of that changes here — wiring decoders only fixes *what* the existing `page.render(...)` can decode. Do not refactor `renderPage`. [Source: 1-5-zoom.md Dev Notes; client/src/render/index.ts renderPage]
- **The render-perf refactor is Story 1.7, not this one.** `deferred-work.md` tracks scroll-away render cancellation / windowing as **Story 1.7**. Keep this story to decoder/asset wiring only; do not pull windowing or `content-visibility` work forward. [Source: deferred-work.md; epics.md Story 1.7]
- **Worker wiring is the proven pattern to mirror.** Story 1.3 wired the worker with `?url` so Vite fingerprints/serves it (a bare node_modules string breaks prod). The asset story is the directory-level analogue: instead of one `?url` import, copy whole dirs so the worker can fetch many files by name at runtime. [Source: client/src/render/index.ts worker import comment; 1-3 render story]

### Git intelligence

Recent commits are the Epic-1 render path being built up: `9411e04` render pages + text layer (1.3, where the decoder gap was introduced), `a855fff` scroll/page nav (1.4), `75cafb1` zoom controls (1.5, current HEAD = baseline). This story is additive on top of that path — it touches none of those commits' behaviour, only the `getDocument` options and the build's asset emission. [Source: `git log` 75cafb1..]

### Project Structure Notes

- `client/src/render/config.ts` is the natural home: `render/` already owns all pdfjs-dist concerns and the layered-downward-dependency rule keeps pdf.js config out of `Reader`/`App`. The config is consumed only within `render/` (by `loadDocument`), so nothing above the render layer learns about asset URLs. [Source: ARCHITECTURE-SPINE.md source-tree §; CLAUDE.md source-tree]
- The `pdfjs/` URL prefix and the Vite copy `dest` must stay in lockstep — same string in `config.ts` and `vite.config.ts`. If you change one, change the other; the `config.test.ts` prefix assertion guards the config side, and the Task-5 `dist/` file-existence check guards the build side.
- No detected conflicts with the unified structure: this adds one render module, one dev dependency, and a build plugin — all within established seams.

### References

- [Source: .bmad/planning-artifacts/epics.md#Story-1.6 (lines 278-299)] — story statement + 4 ACs.
- [Source: .bmad/planning-artifacts/sprint-change-proposals/sprint-change-proposal-2026-06-28-render.md §1.B, §4, §5] — root cause, evidence (127 console warnings), success criteria.
- [Source: .bmad/planning-artifacts/epics.md AR-2 (line 75), AR-9 (82), AR-10 (83); FR-2 (28)] — referenced requirements.
- [Source: client/src/render/index.ts:45] — the single `getDocument`/`loadDocument` call site to modify.
- [Source: client/vite.config.ts] — plugin array to extend.
- [Source: server/app/main.py:76-93] — the SPA catch-all that already serves `dist/pdfjs/**` same-origin.
- [Source: node_modules/pdfjs-dist/types/src/display/api.d.ts:620-635] — `cMapUrl`/`cMapPacked`/`iccUrl`/`standardFontDataUrl`/`wasmUrl` option semantics + the "Include the trailing slash" note.
- [Source: node_modules/pdfjs-dist/{wasm,cmaps,iccs,standard_fonts}/] — the bundled assets to copy.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Claude Code, bmad-dev-story)

### Debug Log References

- **Vite copy path footgun (resolved).** First two builds emitted assets under `dist/pdfjs/<name>/node_modules/pdfjs-dist/<name>/` — `vite-plugin-static-copy` ALWAYS preserves the src directory structure (README line 82). Fixed by globbing the dir contents (`…/<name>/*`) plus `rename: { stripBase: true }`, which strips the glob base so files land flat at `dist/pdfjs/<name>/`. Verified: `wasm/openjpeg.wasm`, `wasm/jbig2.wasm`, `wasm/qcms_bg.wasm`, 168 `cmaps/*.bcmap`, 1 `iccs/*.icc`, 10 `standard_fonts/*.pfb`.

### Completion Notes List

- **AC-2** ✅ Single asset-config home `client/src/render/config.ts` (`PDFJS_ASSET_CONFIG`, frozen); `loadDocument` is the only consumer, spreading it into the single `getDocument({ url, ...PDFJS_ASSET_CONFIG })` call. No asset URL hand-authored elsewhere. URLs built from `import.meta.env.BASE_URL` so a non-root base still resolves; every URL ends with a trailing slash (locked by `config.test.ts`).
- **AC-3** ✅ `vite-plugin-static-copy` (devDependency) emits the four pdfjs-dist asset dirs into `dist/pdfjs/<name>/`. Verified served same-origin by FastAPI's SPA catch-all: `GET /pdfjs/wasm/openjpeg.wasm` → `200 application/wasm`, cmaps/fonts → `200`. Same `/pdfjs/` URLs resolve in dev (Vite middleware, curl 200) — no per-mode branching, no server edit, no CDN.
- **AC-1 + AC-4** ✅ Live browser smoke on the JPX/JBIG2-bearing fixture `fixtures/sample-pdfs/09-regularization.pdf` (JPXDecode×17, JBIG2Decode×3): served built `dist/` via FastAPI on :8000, uploaded the PDF, scrolled through all 23 pages. Figure 9.3 (color heatmap rasters) and all glyphs render fully — not blank. Console: **zero** messages across the full scroll (no `JpxError` / `OpenJPEG failed to initialize` / `Dependent image isn't ready yet` / standard-font-fallback warnings). Drops from the ~127 observed pre-fix to 0.
- Scope held: no rendering-algorithm change, no backend/contract change (`docs/API.md` untouched), no CSS/token surface, `render/` stays annotation-agnostic.

### File List

- `client/src/render/config.ts` (new) — single pdf.js asset-URL home.
- `client/src/render/config.test.ts` (new) — config invariants (trailing-slash, cMapPacked, shared prefix).
- `client/src/render/index.ts` (modified) — import + spread `PDFJS_ASSET_CONFIG` into `loadDocument`'s `getDocument` call.
- `client/vite.config.ts` (modified) — `viteStaticCopy` plugin emitting the four asset dirs into `dist/pdfjs/`.
- `client/package.json` + `client/package-lock.json` (modified) — `vite-plugin-static-copy` devDependency.
- `.bmad/implementation-artifacts/sprint-status.yaml` (modified) — story status in-progress → review.

## Change Log

| Date | Change |
|------|--------|
| 2026-06-28 | Implemented Story 1.6: wired pdf.js bundled decoder/cmap/icc/standard-font assets via `render/config.ts` + Vite static-copy. Live smoke on JPX fixture: figures decode, console clean (~127 → 0). Status → review. |
