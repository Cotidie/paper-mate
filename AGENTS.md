# AGENTS.md

Guidance for Codex and other coding agents working in this repository. This project has been driven heavily through Claude Code, so `CLAUDE.md` is the fuller source of truth. Read it when context matters; this file is the Codex-facing quick reference.

## Project Shape

Paper Mate is a local-first web PDF paper-reading companion for annotation and later AI chat. It has two processes:

- `client/`: React 19.2, Vite 8, TypeScript 6.0, pdfjs-dist 6, Zustand, perfect-freehand.
- `server/`: FastAPI, Pydantic v2, uv-managed Python backend.

Production is one Docker container: FastAPI serves the API and built SPA from one origin. v1 scope is Phase 1 viewer/annotator only; Phases 2 and 3 are directional unless a story says otherwise.

Canonical product and architecture context lives in:

- `CLAUDE.md`
- `.bmad/planning-artifacts/`
- `.bmad/specs/spec-paper-mate/SPEC.md`
- `README.md`
- `DESIGN.md`
- `EXPERIENCE.md`

## CodeGraph

This repo is indexed by CodeGraph (`.codegraph/` exists at the repo root). Use it before grep/find or manually reading code when locating symbols or understanding flows.

- Preferred when available: `codegraph_explore` with `projectPath` set to this repo root.
- Shell fallback: `codegraph explore "<symbols or question>"`

Do not run `codegraph init` unless the user explicitly asks.

## Development Commands

Run client commands from `client/` and server commands from `server/`.

Dev servers:

```sh
cd server && uv run uvicorn app.main:app --reload --port 8000
cd client && npm run dev
```

Checks:

```sh
cd client && npm test
cd client && npm run typecheck
cd client && npm run build
cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q
```

Contract generation:

```sh
cd server && PYTHONPATH= uv run python -m app.export_openapi
cd client && npm run gen:api
```

Never hand-author generated API types. `server/openapi.json` and `client/src/api/schema.d.ts` come from the Pydantic/OpenAPI contract. If an `/api` endpoint changes, update `docs/API.md` in the same change.

Design tokens:

```sh
cd client && npm run gen:tokens
```

`client/src/theme/tokens.css` is generated from `DESIGN.md`. Raw hex/px values are allowed only under `client/src/theme/**`; tests enforce this.

## Engineering Guardrails

- Follow `CLAUDE.md` and the current BMad story before changing behavior.
- Prefer stable libraries and browser/pdf.js primitives over hand-rolled math.
- Document-level key/pointer handlers are the project pattern; exempt editable fields and buttons.
- Selection geometry must go through the `anchor/` text-rect pipeline. Do not use raw `Range.getClientRects()` for selection-driven annotations.
- If adding a `render/index.ts` export, update both `vi.mock("./render")` barrels in `App.test.tsx` and `Reader.test.tsx`.
- For live smoke tests, launch fresh dev servers from this working tree. Do not reuse user-launched servers.
- Multi-page selection is high risk and jsdom cannot validate the geometry. Live-smoke cross-page selection features at DPR greater than 1.
- No em dash in user-facing UI strings. Use a colon, comma, parentheses, or period.

## Versioning

The single version source is `[project].version` in `server/pyproject.toml`.

- Patch bumps happen once when a story is done or for standalone fixes.
- Minor bumps happen when an epic is completed.
- Major bumps happen for persisted data/API compatibility breaks or v1 launch.

Do not hard-code the version elsewhere.

## BMad Workflow

BMad Method artifacts are part of the working process, not noise.

- Planning artifacts: `.bmad/planning-artifacts/`
- Story/dev artifacts: `.bmad/implementation-artifacts/`
- Generated BMad install/config: `_bmad/`

Story files live in `.bmad/implementation-artifacts/{epic}-{story}-{title}.md`. When working a story, keep implementation, tests, docs, sprint status, and versioning aligned with the story instructions.

## Git Hygiene

The worktree may contain user changes. Do not revert changes you did not make. Stage explicit paths, not `git add -A`, when the tree is mixed.

