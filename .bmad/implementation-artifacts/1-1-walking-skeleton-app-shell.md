---
baseline_commit: 04d2a4592a6febb17d2ba29d8b7d4ef988d3073d
---

# Story 1.1: Walking-skeleton app shell

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer-user,
I want a single-command containerized app that boots to an empty reader shell,
so that every later feature lands on a running, same-origin foundation with generated API types.

## Acceptance Criteria

1. **Same-origin serving (prod).** Given `docker compose up` with host `~/.paper-mate` mounted to `/data` and the port supplied via env, when the app starts, then FastAPI/uvicorn serves the built Vite SPA **and** the `/api` surface from one origin with no CORS. [AR-1, AR-10]
2. **Dev proxy + HMR.** Given the dev workflow, when the Vite dev server runs, then `/api` is proxied to FastAPI and HMR works. [AR-10]
3. **Generated contract types.** Given Pydantic models exist, when the contract-generation step runs, then TS types are produced via `openapi-typescript` and the client imports them; **no** API types are hand-authored. [AR-3]
4. **S1 reader frame from tokens.** Given the SPA loads with no PDF, then the S1 reader frame renders — top-bar (48px, hairline bottom), reader-backdrop canvas region, collapsed tool-rail placeholder — all from DESIGN.md tokens with **no inline hex/px**. [UX-DR1, UX-DR2, UX-DR12]
5. **Focus ring.** Given any interactive chrome, when it is focused via keyboard, then a 2px `{colors.ink}` focus ring is visible. [UX-DR17]

## Tasks / Subtasks

- [x] **Task 1 — Repo scaffold & two-process layout** (AC: 1, 2)
  - [x] Create `client/` (React 19.2 + Vite 8 + TypeScript 6.0 SPA, no meta-framework) and `server/` (Python 3.12+ / FastAPI 0.138.x / Pydantic v2 / Uvicorn) per the Structural Seed tree below.
  - [x] Pin exact patch versions at scaffold (spine lists floors/minors: React 19.2, Vite 8, TS 6.0, Node 24 LTS build-only, FastAPI 0.138.x, pdfjs-dist 6.0.x, Zustand 5.0.x, perfect-freehand 1.2.x). pdfjs-dist/Zustand/perfect-freehand are **not used in this story** — install only what the shell needs; do not pull render/store deps in early unless trivially free.
  - [x] Create empty layer dirs as placeholders so later stories have a home: `client/src/{render,anchor,annotations,store,api}/`, `server/app/{routes,storage,agents}/`, `server/app/models.py`. `agents/` is a reserved Phase-3 seam — leave a stub/README, build nothing.
- [x] **Task 2 — FastAPI app + `/api` surface + static serving** (AC: 1)
  - [x] FastAPI app exposes a minimal `/api` (e.g. `GET /api/health` returning `{"status":"ok"}`) so the surface and proxy are provable. Errors use the single envelope `{"detail": string}` (FastAPI default).
  - [x] In prod mode, FastAPI serves the built Vite `dist/` as static assets from the same origin; SPA routes fall back to `index.html`. `/api/*` must not be shadowed by the SPA catch-all.
  - [x] Routes must **not** touch the filesystem (AD-9). No annotation/storage logic in this story.
- [x] **Task 3 — Pydantic→OpenAPI→TS type generation** (AC: 3)
  - [x] Define at least one Pydantic v2 model in `server/app/models.py` surfaced through the health route so OpenAPI has real schema to emit (e.g. a `HealthStatus` response model). Do **not** author the full `Annotation` model here — that is AD-5 work for Epic 2.
  - [x] Wire an `openapi-typescript` generation step (npm script) that reads FastAPI's OpenAPI JSON and emits types into `client/src/api/` (generated file, git-tracked or build-step — pick one and document it). The client imports the generated types; assert no hand-authored API types exist.
- [x] **Task 4 — Dev proxy + HMR** (AC: 2)
  - [x] Vite dev config proxies `/api` → FastAPI dev server; verify HMR round-trips a trivial edit.
  - [x] Document the two run modes (dev: Vite HMR + FastAPI; prod: FastAPI serves dist) — these become the real build/test/run commands recorded in CLAUDE.md.
- [x] **Task 5 — S1 reader frame (token-driven)** (AC: 4, 5)
  - [x] Build the empty S1 shell: top-bar (height 48px, `borderBottom: 1px {colors.hairline}`, bg `{colors.canvas}`, text `{colors.ink}`, `{typography.title-sm}`), reader-backdrop canvas region (`{colors.reader-backdrop}` = pdf-canvas zone), collapsed tool-rail placeholder (`{component.tool-rail}`: 48px, `{colors.surface-card}`, `{rounded.lg}`, `1px {colors.hairline}`).
  - [x] Establish the DESIGN.md token layer (CSS custom properties / theme object generated from the tokens) so components reference `{colors.*}/{spacing.*}/{rounded.*}/{typography.*}` and **never** inline hex/px. Add a lint guard or convention note against raw hex/px in component styles.
  - [x] Global focus style: 2px `{colors.ink}` ring on `:focus-visible` for all interactive chrome (matches DESIGN.md input-focus).
  - [x] No PDF, no tools wired — placeholders only. Visual reference: `.bmad/planning-artifacts/ux-designs/ux-paper-mate-2026-06-28/.working/reader-mock.html` (spine/DESIGN win on conflict).
- [x] **Task 6 — Single-command boot** (AC: 1)
  - [x] `docker-compose.yml`: one container, FastAPI/uvicorn serving API + dist, volume-mount host `~/.paper-mate` → `/data`, host path + port via env. No auth.
  - [x] Verify `docker compose up` boots to the empty S1 shell with the health endpoint reachable same-origin.

### Review Findings

#### Review Follow-ups (AI)

- [x] [AI-Review][High][Review][Patch] Harden SPA fallback path handling so requested files cannot escape the built static directory, and add a regression test for traversal attempts. [server/app/main.py:43] — Fixed: resolve candidate + `is_relative_to(_dist)` containment; added `server/tests/test_static.py` traversal cases.
- [x] [AI-Review][High][Review][Patch] Bind Docker Compose publishing to localhost by default to match the no-auth, single-user localhost deployment model. [docker-compose.yml:10] — Fixed: publish `127.0.0.1:${PAPER_MATE_PORT}:8000`; verified loopback bind.
- [x] [AI-Review][Medium][Review][Patch] Fix the backend test client dependency mismatch causing the documented pytest command and `TestClient.get()` to hang; rerun backend tests after updating the dependency set/lock. [server/pyproject.toml:15] — Not reproduced: with committed `uv.lock` (httpx 0.28.1) `pytest` passes 11/11 in <0.3s. The hang was a reviewer-sandbox artifact, not the locked env. No code change; `httpx2` deprecation warning is benign.
- [x] [AI-Review][Medium][Review][Patch] Make the production Docker image install backend dependencies from the committed lockfile instead of resolving transitive dependencies with `pip install .` at build time. [Dockerfile:17] — Fixed: runtime stage uses `uv sync --frozen --no-dev` from `uv.lock`; rebuilt + booted OK.
- [x] [AI-Review][Low][Review][Patch] Narrow the SPA fallback API guard to reject only `/api` and `/api/*`, not non-API client routes such as `/apiary`. [server/app/main.py:41] — Fixed: guard is now `full_path == "api" or startswith("api/")`; test covers `/apiary`.

## Dev Notes

### Architecture patterns & constraints (binding)

- **Two processes, one container** (AD-1, AD-10). Localhost SPA ↔ dockerized FastAPI that owns all disk I/O via host volume mount. Client never touches the filesystem. Prod = FastAPI serves `dist/` + `/api` same-origin (no CORS). Dev = Vite HMR proxies `/api` to FastAPI. [Source: ARCHITECTURE-SPINE.md#AD-1, #AD-10]
- **Stack** (AD-2): backend Python/FastAPI + Pydantic v2; frontend React + Vite SPA + TS, no meta-framework. [Source: ARCHITECTURE-SPINE.md#AD-2, #Stack]
- **Contract sync** (AD-3): Pydantic models → FastAPI OpenAPI → generated TS via `openapi-typescript`. Client API types are **generated, never hand-authored**. This story stands up the pipeline with a minimal model; the real `Annotation` model (AD-5) and `/api/docs*` resources come in later stories. [Source: ARCHITECTURE-SPINE.md#AD-3]
- **Layered client, strict downward deps** (Design Paradigm): `render → anchor → annotation/tool → store → api-client`. Create the dirs now; do not let any layer import upward. [Source: ARCHITECTURE-SPINE.md#Design-Paradigm]
- **Boundary invariants** (AD-9): (1) anchor math lives only in `anchor/` (N/A this story, but don't put coordinate math in render); (2) only the storage module touches `~/.paper-mate` (no disk access in routes); (3) client reaches backend only via the generated API client. [Source: ARCHITECTURE-SPINE.md#AD-9]
- **Error envelope**: one shape only — FastAPI default `{"detail": string}`; client surfaces via `{component.toast}` later. [Source: ARCHITECTURE-SPINE.md#Consistency-Conventions]
- **API shape** (for the health stub and future): REST/JSON under `/api`. Future resources reserved: `/api/docs`, `/api/docs/{doc_id}`, `/api/docs/{doc_id}/file`, `/api/docs/{doc_id}/annotations` — do not build them now. [Source: ARCHITECTURE-SPINE.md#Consistency-Conventions]

### Source tree (scaffold this — code owns the detail)

```text
paper-mate/
  client/                # React + Vite SPA (TypeScript)
    src/
      render/            # pdfjs-dist wrapper (later story)
      anchor/            # anchor service (later story)
      annotations/       # annotation layer + tools (later story)
      store/             # Zustand + command stack (later story)
      api/               # GENERATED OpenAPI client (this story: pipeline + minimal types)
  server/
    app/
      routes/            # API layer: health now; docs/file/annotations later
      storage/           # ONLY disk writer (later story) — empty now
      agents/            # reserved Phase-3 seam — stub only
      models.py          # Pydantic models -> OpenAPI (minimal model this story)
  docker-compose.yml     # single container, ~/.paper-mate volume, port via env
```
[Source: ARCHITECTURE-SPINE.md#Structural-Seed]

### DESIGN.md token references (S1 frame)

- top-bar: `height 48px`, `backgroundColor {colors.canvas}`, `textColor {colors.ink}`, `typography {typography.title-sm}`, `borderBottom 1px {colors.hairline}`. [Source: DESIGN.md#components.top-bar]
- reader-backdrop / canvas zone: `{colors.reader-backdrop}` (#f5f5f7), pdf-canvas card on `{colors.canvas}`. [Source: DESIGN.md#colors, #components]
- tool-rail (collapsed placeholder): `width 48px`, `backgroundColor {colors.surface-card}`, `rounded {rounded.lg}`, `border 1px {colors.hairline}`, `padding {spacing.xs}`. [Source: DESIGN.md#components.tool-rail]
- focus ring: 2px `{colors.ink}` (#171717). [Source: DESIGN.md input focus; EXPERIENCE.md line 129]
- **Rule: reference tokens, never inline hex/px** (CLAUDE.md design conventions). [Source: CLAUDE.md#Design-conventions]
- **Caveat:** DESIGN.md frontmatter component catalog beyond reader UI (hero/pricing/device-mockup) is leftover Expo content — ignore it; use the token *scales* + reader components only. [Source: CLAUDE.md#Design-conventions]

### UX states (EXPERIENCE.md)

- **S0** — empty/open (no PDF): `{component.empty-dropzone}` (built in Story 1.2, not here). **S1** — reader: fixed canvas with three overlay zones (top-bar/status, tool-rail left, zoom control). This story renders the empty S1 frame only. Overlays must never reflow the canvas (NFR-1) — design chrome as overlays from the start. [Source: EXPERIENCE.md lines 26-37]
- Visible focus rings on all interactive chrome, 2px `{colors.ink}`. [Source: EXPERIENCE.md line 129]

### Testing standards

No test framework is chosen yet — **this story chooses and records it** (Vitest is the conventional Vite/React pairing; pytest for FastAPI). Minimum bar for this story:
- Backend: `GET /api/health` returns 200 + `{"status":"ok"}`; OpenAPI JSON contains the Pydantic model schema.
- Type-gen: generation step runs clean and emits importable types into `client/src/api/`; a smoke import compiles.
- Frontend: S1 frame renders top-bar + backdrop + collapsed rail; no raw hex/px in component styles (lint/convention check); focus-visible produces the 2px ink ring.
- Boot: `docker compose up` serves SPA + `/api` same-origin.
Record the exact test/run/build commands in CLAUDE.md once chosen.

### Project Structure Notes

- Greenfield: no code, `package.json`, or build exists yet (CLAUDE.md "code is not scaffolded yet"). This story creates the skeleton the whole project sits on — get the layer dirs and the two run modes right.
- After this story, **update CLAUDE.md Project status**: replace "code is not scaffolded yet" with the real build/test/run commands.
- `agents/` dir is a reserved Phase-3 seam — create it empty/stubbed, build nothing (the host-cannot-exec-CLI problem is unresolved and deferred). [Source: ARCHITECTURE-SPINE.md#Deferred; CLAUDE.md]

### References

- [Source: .bmad/planning-artifacts/epics.md#Story-1.1] — story statement + ACs
- [Source: .bmad/planning-artifacts/architecture/architecture-paper-mate-2026-06-28/ARCHITECTURE-SPINE.md] — AD-1, AD-2, AD-3, AD-9, AD-10, Structural Seed, Stack, Consistency Conventions
- [Source: DESIGN.md] — token scales + reader component specs (top-bar, tool-rail, colors)
- [Source: EXPERIENCE.md] — S0/S1 states, focus rings, overlay-no-reflow
- [Source: CLAUDE.md] — design conventions, stack pins, project status

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Claude Code, bmad-dev-story workflow).

### Debug Log References

- Backend `pytest` aborted importing a host ROS pytest plugin (`launch_testing` →
  `osrf_pycommon`) leaked via `PYTHONPATH`. Fixed by running with `PYTHONPATH=`
  and `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1` (we use no pytest plugins). Recorded in CLAUDE.md.
- `npm install` ERESOLVE: `openapi-typescript@7` peer `typescript@^5` vs the pinned
  TS 6.0 (AD-2). Resolved with `client/.npmrc` `legacy-peer-deps=true` (TS 6 works; documented).
- `@testing-library/react` needs peer `@testing-library/dom`; pinned it explicitly (legacy-peer-deps skips peers).
- Vitest filesystem tests failed under jsdom (`import.meta.url` not `file:` scheme) → tagged
  `// @vitest-environment node`. `no-raw-values` flagged "2px" inside a CSS comment → strip comments before scanning.
- Typecheck needed `@types/node` + `vite/client` ambient types (CSS side-effect imports) → added `src/vite-env.d.ts` and `"node"` to tsconfig types.

### Completion Notes List

- **AC-1** verified in the real container: `docker compose up` → `/api/health` `{"status":"ok"}`,
  `/` serves the SPA, `/assets/*` served, SPA fallback 200, `/api/*` returns the `{"detail"}` envelope. Host `~/.paper-mate`→`/data`, port via `PAPER_MATE_PORT`.
- **AC-2** verified live: Vite dev server proxied `/api/health` to FastAPI (8000) and served the SPA; HMR enabled via `@vitejs/plugin-react`.
- **AC-3**: `HealthStatus` Pydantic model → OpenAPI (asserted in `test_openapi.py`) → `openapi-typescript` →
  `client/src/api/schema.d.ts` (git-tracked); `client.ts` imports the generated `components` type. No hand-authored API types.
- **AC-4**: empty S1 frame (top-bar 48px hairline-bottom, reader-backdrop canvas zone, collapsed tool-rail placeholder) from DESIGN.md tokens; `no-raw-values.test.ts` enforces no raw hex/px outside the token layer.
- **AC-5**: global `:focus-visible` = 2px `{colors.ink}` ring; `focus-ring.test.ts` asserts the token-driven rule.
- Chrome is laid out as overlays (NFR-1): tool-rail floats over the absolute-positioned canvas zone.
- Reserved seams created empty/stubbed only: `server/app/agents/` (Phase-3), `server/app/storage/`, and client layer dirs `render/anchor/annotations/store`.
- Versions pinned: fastapi 0.138.1, uvicorn 0.49.0, pydantic 2.13.4; react/react-dom 19.2.7, vite 8.1.0, typescript 6.0.3, vitest 4.1.9, openapi-typescript 7.13.0, @types/node 24.13.2.
- Tests: backend 4 passed (pytest), frontend 12 passed (vitest), typecheck clean, prod build clean.

### File List

**Added — server/**
- `server/pyproject.toml`
- `server/app/__init__.py`
- `server/app/main.py`
- `server/app/models.py`
- `server/app/export_openapi.py`
- `server/app/routes/__init__.py`
- `server/app/routes/health.py`
- `server/app/storage/__init__.py`
- `server/app/agents/__init__.py`
- `server/tests/test_health.py`
- `server/tests/test_openapi.py`
- `server/tests/test_static.py` (added in review follow-up)

**Added — client/**
- `client/package.json`
- `client/.npmrc`
- `client/tsconfig.json`
- `client/tsconfig.app.json`
- `client/tsconfig.node.json`
- `client/vite.config.ts`
- `client/index.html`
- `client/scripts/generate-tokens.mjs`
- `client/src/main.tsx`
- `client/src/App.tsx`
- `client/src/App.css`
- `client/src/index.css`
- `client/src/vite-env.d.ts`
- `client/src/theme/components.css`
- `client/src/api/client.ts`
- `client/src/api/schema.d.ts` (generated, committed)
- `client/src/render/README.md`
- `client/src/anchor/README.md`
- `client/src/annotations/README.md`
- `client/src/store/README.md`
- `client/src/App.test.tsx`
- `client/src/no-raw-values.test.ts`
- `client/src/focus-ring.test.ts`

**Added — root**
- `Dockerfile`
- `docker-compose.yml`
- `.dockerignore`
- `.gitignore`
- `.env.example`

**Modified**
- `CLAUDE.md` (Project status → real build/test/run commands)
- `.bmad/implementation-artifacts/sprint-status.yaml` (1-1 → review)

**Generated/uncommitted (gitignored):** `client/src/theme/tokens.css`, `server/openapi.json`, `client/dist/`.

## Change Log

| Date | Change |
| --- | --- |
| 2026-06-28 | Story 1.1 implemented: scaffolded client/ + server/, FastAPI `/api/health` + same-origin static serving, Pydantic→OpenAPI→TS type-gen pipeline, dev proxy/HMR, token-driven empty S1 frame + focus ring, single-command Docker boot. Backend 4 + frontend 12 tests pass; typecheck + prod build clean. Status → review. |
| 2026-06-28 | Addressed code review findings — 4 resolved (2 High, 1 Med, 1 Low): SPA-fallback path-traversal containment + regression tests, Compose loopback bind, Dockerfile installs from `uv.lock`, API guard narrowed. 1 Med (test hang) not reproduced with committed lock. Backend 11 + frontend 12 tests pass; image rebuilt + booted OK. |

## Senior Developer Review (AI)

### Review Outcome

Changes Requested.

### Review Date

2026-06-28

### Scope Reviewed

- Diff: `04d2a45..HEAD` on `feat/story-1-1-walking-skeleton`.
- In scope: `client/`, `server/`, `Dockerfile`, `docker-compose.yml`, `.gitignore`, `.env.example`, `CLAUDE.md`.
- Out of scope: bundled BMad/planning tooling (`.claude/`, `_bmad/`, `.bmad/` except this story file).
- Generated lockfiles (`client/package-lock.json`, `server/uv.lock`) were skimmed only.

### Review Summary

The walking skeleton is close, and the frontend token shell/build path is in good shape. The blocking issues are in the production/server foundation: static file fallback needs path containment, Compose should not publish an unauthenticated local app on all interfaces, backend verification currently hangs with the pinned test dependency set, and the Docker image does not consume the committed backend lockfile.

### Severity Breakdown

- High: 2
- Medium: 2
- Low: 1
- Dismissed during triage: 2

### Action Items

- [x] [High] Harden SPA fallback path handling so requested files cannot escape the built static directory, and add a regression test for traversal attempts. [server/app/main.py:43]
- [x] [High] Bind Docker Compose publishing to localhost by default to match the no-auth, single-user localhost deployment model. [docker-compose.yml:10]
- [x] [Medium] Fix the backend test client dependency mismatch causing the documented pytest command and `TestClient.get()` to hang; rerun backend tests after updating the dependency set/lock. [server/pyproject.toml:15] — Not reproduced with committed lock (httpx 0.28.1); tests pass 11/11. No change.
- [x] [Medium] Make the production Docker image install backend dependencies from the committed lockfile instead of resolving transitive dependencies with `pip install .` at build time. [Dockerfile:17]
- [x] [Low] Narrow the SPA fallback API guard to reject only `/api` and `/api/*`, not non-API client routes such as `/apiary`. [server/app/main.py:41]

### Verification Notes

- `cd client && npm test` passed: 3 files, 12 tests.
- `cd client && npm run typecheck` passed.
- `cd client && npm run build` passed.
- `cd server && UV_CACHE_DIR=/tmp/paper-mate-uv-cache PYTHONPATH= uv run python -m app.export_openapi /tmp/paper-mate-openapi.json && diff -u /tmp/paper-mate-openapi.json openapi.json` passed.
- `cd server && UV_CACHE_DIR=/tmp/paper-mate-uv-cache PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q` hung and was interrupted; a direct `TestClient(app).get("/api/health")` reproduced the hang after emitting Starlette's `httpx` deprecation warning recommending `httpx2`.

### Triage Notes

- Dismissed: the top-bar overlay finding was not treated as a defect for Story 1.1 because the story/design also specify a fixed 48px top bar with the PDF canvas filling the remaining viewport.
- Dismissed: the `HealthStatus` alias in `client/src/api/client.ts` was not treated as a hand-authored API shape because it aliases the generated OpenAPI `components` type rather than redefining the schema.
