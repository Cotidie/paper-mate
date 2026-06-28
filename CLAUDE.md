# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

Paper Mate is a **web** PDF paper-reading companion: annotation + AI chat optimized for reading papers. **Scaffolded (Story 1.1 done): the walking-skeleton app shell boots to an empty S1 reader frame.** Two processes, one container (AD-1/AD-10): `client/` (React 19.2 + Vite 8 + TS 6.0 SPA) and `server/` (FastAPI + Pydantic v2, uv-managed).

**Commands** (run client commands from `client/`, server from `server/`):

- **Dev** (HMR + proxy): in one shell `cd server && uv run uvicorn app.main:app --reload --port 8000`; in another `cd client && npm run dev`. Vite serves the SPA and proxies `/api` → FastAPI (override target with `PAPER_MATE_API_TARGET`).
- **Backend tests:** `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q`. (`PYTHONPATH=` clears a host ROS leak; `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1` avoids a stray ROS pytest plugin — we use no pytest plugins.)
- **Frontend tests:** `cd client && npm test` (Vitest). **Typecheck:** `npm run typecheck`.
- **Contract types:** `cd server && PYTHONPATH= uv run python -m app.export_openapi` writes `server/openapi.json`, then `cd client && npm run gen:api` regenerates `client/src/api/schema.d.ts` (committed). Never hand-author API types.
- **API reference:** `docs/API.md` is the human-readable HTTP-surface reference (the generated OpenAPI/Pydantic contract is the source of truth). **Maintain it in the same change that adds or alters any `/api` endpoint** — update the resource entry and the changelog.
- **Design tokens:** `cd client && npm run gen:tokens` regenerates `client/src/theme/tokens.css` from `DESIGN.md` (gitignored build artifact; `dev`/`build` run it automatically). Component dims/typography live hand-authored in `client/src/theme/components.css`. Both are the token layer; raw hex/px are allowed ONLY in `src/theme/**` — `src/no-raw-values.test.ts` enforces this.
- **Prod build:** `cd client && npm run build` emits `client/dist/`, which FastAPI serves same-origin.
- **Single-command boot:** `docker compose up` (host port `PAPER_MATE_PORT`, default 8000; data dir `PAPER_MATE_DATA`, default `~/.paper-mate` → `/data`). FastAPI serves API + built SPA from one origin (no CORS).

Canonical planning artifacts live under `.bmad/planning-artifacts/` — PRD, architecture spine, epics + stories, UX, and an implementation-readiness report. Root `README.md`, `DESIGN.md`, and `EXPERIENCE.md` are also inputs. These override the older "Obsidian note / bootstrap prompt" as the spec of record.

**v1 scope = Phase 1 (Viewer / Annotator) only.** Phases 2–3 are directional; the architecture reserves their seams but they are not built. Note: **export-with-highlights is deferred to Phase 2** (the older brief listed it as v1; the canonical PRD/SPEC/architecture win).

**Stack (chosen, `AD-2` ADOPTED — pin exact patches at scaffold):**

- Frontend: **React 19.2 + Vite 8 + TypeScript 6.0** SPA (no meta-framework), **pdfjs-dist 6.0.x** (raw, custom overlay — not its built-in annotation layer), **Zustand 5.0.x** store + command stack, **perfect-freehand 1.2.x** for pen.
- Backend: **Python 3.12+ / FastAPI 0.138.x / Pydantic v2**, Uvicorn. Pydantic models are the single source of the annotation model + API contract → OpenAPI → **generated** TS client types via `openapi-typescript` (never hand-author client API types).
- Deploy: single **Docker Compose** container; FastAPI serves both API and built Vite `dist/` (same-origin, no CORS). Volume-mounts host `~/.paper-mate` → `/data`. No auth (localhost, single user).
- Source tree: `client/` (`render/`, `anchor/`, `annotations/`, `store/`, `api/`) and `server/app/` (`routes/`, `storage/`, `agents/` reserved, `models.py`). See architecture spine for the layered downward-dependency rule.

## Code navigation (CodeGraph)

This repo is indexed by **CodeGraph** (`.codegraph/` at root). Reach for it BEFORE grep/find or reading files when locating or understanding code:

- MCP `codegraph_explore` (when available) — verbatim symbol source + call paths in one call. The server has no default project, so pass `projectPath` = repo root.
- Shell (always works): `codegraph explore "<symbols or question>"`.
- Index updates live; no restart needed. Re-run `codegraph init` only if it ever drifts.

## Product shape

Three phases, build in order (full spec: `.bmad/planning-artifacts/` PRD + epics + architecture spine):

1. **PDF Viewer/Annotator** — left toolbox drawer (zoom with ctrl +/-, underline, highlight, comment, table-of-contents), drag-to-annotate, a right-side Annotation Bank that toggles open/closed.
2. **Paper Reading Helper** — inline previews triggered by clicking references in the text: `Figure N`/`Table N`, footnotes, citation markers (`[1]`, `[2]`). Plus paper metadata extraction, export of PDF-with-highlights, and a folder-based Library page.
3. **AI Companion** — Q&A against **local CLI agents** (Claude, Codex, Antigravity) with vendor switching; paper digest injected into the context window by default; visual explanation via Codex image generation; drag/click-to-chat that resolves the exact PDF location (or a Figure/Table selection) the user pointed at.

The two architectural through-lines that cut across phases:

- **Spatial anchoring.** Annotations (Phase 1), inline preview triggers (Phase 2), and click/drag-to-chat targeting (Phase 3) all depend on mapping screen interactions back to precise PDF coordinates (page + rect/text range). Design this coordinate/anchor model once; all three phases consume it.
- **Agent abstraction.** AI features call local agent CLIs, not a hosted API. Claude/Codex/Antigravity must sit behind one switchable interface so vendor selection and the default paper-digest context are vendor-agnostic. Open architectural problem (deferred to Phase 3): a dockerized backend cannot exec host agent CLIs — the abstraction must not assume same-process exec. `server/app/agents/` reserves the seam.

## Design conventions

`DESIGN.md` is the design-token contract. Rules that matter when writing UI:

- **Reference tokens, never inline hex/px.** Use `{colors.*}`, `{typography.*}`, `{spacing.*}`, `{rounded.*}` as defined in `DESIGN.md`.
- **No em-dash (—) in user-facing text.** Tooltips/`title`, labels, aria-labels, copy, toasts, etc. must never contain an em-dash; use a colon, comma, parentheses, or period instead. Code comments are exempt. Grep new UI strings for `—` before committing.
- Type: **Inter** for all text (display 600, body 400), **JetBrains Mono** for code surfaces.
- The overriding UI principle is **immersive, non-distracting reading** — minimal Obsidian-style chrome. UI must recede behind the PDF content; default to hairlines and restraint over heavy surfaces.
- Caveat: `DESIGN.md` frontmatter is currently `name: Expo-design-analysis` — token *scales* are the convention, but the component catalog (hero, pricing, device-mockup, etc.) is from an Expo marketing site and does not map to this app. Retarget the component layer to Paper Mate's reader UI rather than treating those component entries as a spec.

## BMad workflow

BMad Method v6.9.0 is installed (project-scoped). Treat it as the planning/dev pipeline, not noise:

- `_bmad/` — config and agents (`config.toml`, `config.user.toml`). Installer-managed; for durable overrides edit `_bmad/custom/`, never the generated files.
- `.bmad/planning-artifacts/` — populated: `briefs/`, `prds/`, `architecture/`, `ux-designs/`, `epics.md`, `implementation-readiness-report-2026-06-28.md`. `.bmad/specs/spec-paper-mate/SPEC.md` is the machine contract.
- `.bmad/implementation-artifacts/` — where dev outputs land. `sprint-status.yaml` exists (3 epics, 20 stories, all `backlog` until story files are created). Story files go here as `{epic}-{story}-{title}.md`.
- `.claude/skills/bmad-*` — BMad skills. `bmad-help` orients you; greenfield path is product-brief → PRD → architecture → epics/stories → sprint. Planning steps are done; next is `bmad-create-story` (start story 1-1), then `bmad-dev-story`. Run each BMad workflow in a fresh context window.
- Some BMad workflows run Python via `uv run`; install `uv` if a workflow needs it.
