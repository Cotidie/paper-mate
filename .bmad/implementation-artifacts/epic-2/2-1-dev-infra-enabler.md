---
baseline_commit: 7851169033bbbbe1ed7683f582af0d478c0a4cae
---

# Story 2.1: Dev-infra enabler (local Docker dev loop)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want the local Docker dev loop usable (writable data dir, documented live-backend path),
so that Epic 2's heavy iteration isn't blocked by stale containers or root-owned files.

> **Enabler story, not a product feature.** Sequenced first in Epic 2 so the rest of the epic develops without the dev-experience friction surfaced in Epic 1. **Touches only Dockerfile / docker-compose / dev docs / env files. NO product code, NO annotation code, NO `client/src` or `server/app` logic changes.**

## Acceptance Criteria

1. **Writable `/data` (host-owned files).** Given `docker compose up`, when the container writes to the mounted `/data`, then new files are owned by the host user (not `root:root`), so the host user can edit/delete library files from the file manager. Achieved via a compose `user:` mapping plus a documented host-dir pre-create step. [Source: epics.md#Story-2.1; deferred-work.md#local-Docker-dev-experience; ARCHITECTURE-SPINE.md#AD-8, #AD-10]

2. **Backend dev-loop decision recorded.** Given a backend code change, then the dev loop is documented so a stale container is never mistaken for a bug: **(a)** the host two-process flow (`uvicorn --reload` + `vite dev`) is the canonical day-to-day dev loop (frontend HMR), **AND (b)** the single `docker compose up` is local-first: it bind-mounts `./server/app` and runs `uvicorn --reload` so the backend hot-reloads with no override file (the frontend stays the built static SPA; a dependency/frontend change needs `--build`). The decision lives in the dev docs (CLAUDE.md + README). [Source: epics.md#Story-2.1; deferred-work.md#local-Docker-dev-experience; CLAUDE.md#Commands]
   > Simplified 2026-06-29 (post-review, per user): the earlier two-file `compose.dev.yaml` override was folded into `docker-compose.yml` as the default and the override file removed, so `docker compose up` needs no extra flags. A pure prod-style run remains available straight from the image (`docker build` + `docker run`, no mounts/reload).

3. **No behavior change, infra-only.** Given the enabler, then it changes no product behavior and touches no annotation code — Dockerfile / docker-compose / dev docs / env files only. Existing `docker compose up` prod-like boot (same-origin API + SPA) still works; backend + frontend test suites still pass unchanged. [Source: epics.md#Story-2.1]

## Tasks / Subtasks

- [x] **Task 1 — Host-owned `/data` via compose `user:` (AC: 1)**
  - [x] Add `user: "${PAPER_MATE_UID:-1000}:${PAPER_MATE_GID:-1000}"` to the `paper-mate` service in `docker-compose.yml`.
  - [x] Add `PAPER_MATE_UID` / `PAPER_MATE_GID` to `.env.example` with a comment (default 1000:1000; the typical single-user host uid/gid — override if `id -u` / `id -g` differ).
  - [x] Document the one-time host-dir pre-create in README: `mkdir -p "${PAPER_MATE_DATA:-$HOME/.paper-mate}"` **before** the first `docker compose up`, so the bind-mount target isn't auto-created `root:root` by the Docker daemon. Include the one-line recovery for already-root-owned dirs: `sudo chown -R "$USER":"$USER" ~/.paper-mate`.
  - [x] Verify the app still only writes under `/data` at runtime (it does — `storage/__init__.py` resolves `PAPER_MATE_DATA`; `main.py` reads static read-only). Running as a non-root uid is safe: the image's `/app/.venv` + `/app/static` are root-owned but world-readable, and bytecode is precompiled at build (`UV_COMPILE_BYTECODE=1`), so no runtime write to `/app` is needed.

- [x] **Task 2 — Document the dev loop + add the optional in-container override (AC: 2)**
  - [x] In README (currently a stub) add a "Development" section: declare **host two-process flow** (`cd server && uv run uvicorn app.main:app --reload --port 8000` + `cd client && npm run dev`) as the canonical dev loop, and **`docker compose up`** as the prod-like single-command boot (built static SPA, no HMR, no `--reload`). State explicitly: a Docker container does NOT hot-reload backend changes — a backend edit requires `docker compose up --build`, and a forgotten rebuild silently serves stale code.
  - [x] Add `compose.dev.yaml` (a compose override) that, on top of the base service, bind-mounts `./server/app` → `/app/app` and overrides the command to `uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload`. Carry the same `user:` mapping (inherited from base; no need to redeclare). Document its use: `docker compose -f docker-compose.yml -f compose.dev.yaml up`.
  - [x] Note in CLAUDE.md's "Single-command boot" / Commands area that `compose.dev.yaml` is the optional in-container reload path and that host two-process is the default; keep it one line, consistent with the existing terse command list.

- [x] **Task 3 — Verify no regression, infra-only (AC: 3)**
  - [x] Pre-create the host data dir, run `docker compose up --build`, confirm the app serves at `http://127.0.0.1:8000` and the SPA + `/api/health` respond.
  - [x] From the host (not via sudo), create/import something that writes to `~/.paper-mate` (or `touch` inside via the running container) and confirm the resulting files are owned by the host user and are editable/deletable from the host file manager — not `root:root`.
  - [x] Run `docker compose -f docker-compose.yml -f compose.dev.yaml up`, edit a trivial line in a `server/app` file (e.g. a docstring), confirm uvicorn reloads in the container logs without a rebuild. Revert the trivial edit.
  - [x] Confirm no `client/src` or `server/app` logic changed (only an optional revertible probe edit). Run backend tests (`cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q`) and frontend (`cd client && npm test`) — both green, unchanged from before.

## Dev Notes

### Scope guardrail — READ FIRST

- **This story is infra/docs only.** Files in play: `docker-compose.yml`, `compose.dev.yaml` (new), `.env.example`, `README.md`, `CLAUDE.md`, optionally `Dockerfile`. Do **not** touch `client/src/**` or `server/app/**` logic. No `anchor/`, no Zustand, no `Annotation` entity, no overlay — those are **Story 2.2** (annotation foundation), a separate story.
- **Watch for stale retro language.** `epic-1-retro-2026-06-29.md` and some Epic-2 prose say "Story 2-1 stands up the anchor layer / Zustand / command stack." That text predates the 2026-06-29 correct-course renumber. After the renumber, **the anchor foundation is Story 2.2**; the PREP-1/PREP-2/PREP-3 critical-path items apply to **2.2, not this story.** Ignore any instruction to build coordinate math here. [Source: sprint-change-proposal-2026-06-29.md; epics.md#Epic-2 (restructure note)]

### Root cause being fixed (why this story exists)

Two coupled dev-environment defects surfaced running `docker compose up` during Epic 1 (both in `deferred-work.md#local-Docker-dev-experience`):

1. **`/data` is root-owned.** The runtime image declares no `USER`, so the container runs as root (uid 0). Everything it writes to the bind-mounted `/data` (host `~/.paper-mate`, the AD-8 storage root) lands `root:root`. The host user (uid 1000) can read (dirs 0755) but **cannot edit or delete** — file-manager lock badges. Re-occurs on every `docker compose up`. Fix: run the container as the host user via compose `user:` so new files land host-owned.
2. **No backend hot-reload in Docker.** The Dockerfile `COPY`s `server/app` at build time (baked in, not mounted) and the CMD runs `uvicorn` with **no `--reload`**; compose mounts no source. Any backend edit needs a full `docker compose up --build`; a forgotten rebuild silently serves stale code. Fix: document the host two-process flow as the dev default (already CLAUDE.md's stated flow) + provide an optional bind-mount override for in-container reload.

### Current state of the files being modified

- **`docker-compose.yml`** — one `paper-mate` service: `build` from root `Dockerfile`; `environment: PAPER_MATE_DATA: /data`; `ports: 127.0.0.1:${PAPER_MATE_PORT:-8000}:8000`; `volumes: ${PAPER_MATE_DATA:-${HOME}/.paper-mate}:/data`; `restart: unless-stopped`. **No `user:` key today** — this is the gap. Preserve the loopback port bind and the env-driven path/port.
- **`Dockerfile`** — 2-stage: `node:24-slim` builds `client/dist`; `python:3.13-slim` runtime, `uv sync --frozen --no-dev`, `UV_COMPILE_BYTECODE=1`, copies `dist`→`static`, `CMD ["uvicorn","app.main:app","--host","0.0.0.0","--port","8000"]`. **Likely no Dockerfile change needed** — prefer the portable compose `user:` form over baking a fixed-uid `USER` (a baked uid mismatches if the host uid differs; compose `user:` is more portable for single-user local). Only touch the Dockerfile if a runtime non-root write path forces it (it shouldn't — app writes only `/data`).
- **`.env.example`** — documents `PAPER_MATE_PORT` and `PAPER_MATE_DATA`. Add the two new uid/gid vars here in the same style.
- **`README.md`** — currently just `# paper-mate` (a stub). This is where the "Development" section lands. CLAUDE.md already documents the host two-process commands; mirror/point to them rather than duplicating divergent copy.
- **`server/app/storage/__init__.py:51-55`** — resolves storage root from `PAPER_MATE_DATA` (default `~/.paper-mate`); container sets `/data`. Confirms the app's only write root is the mount. **Read-only reference — do not edit.**

### Decision to lock in (AC 2)

Adopt the `deferred-work.md` recommendation: **(a) as the documented default + (b) as an optional override.** Don't make it either/or. (a) costs nothing — it's already CLAUDE.md's stated flow; just make it explicit in README so a stale container is never mistaken for a bug. (b) is a small `compose.dev.yaml` for anyone who wants in-container reload. Front-end true in-container HMR is out of scope (would require running Vite in the container = basically the host flow, containerized) — the override covers backend reload only; frontend HMR stays on the host `vite dev`.

### Engineering conventions in force (CLAUDE.md "Engineering principles")

- **Don't reinvent wheels — adopt stable solutions.** Here that means the standard compose `user:` mapping and a standard compose override file, not a bespoke entrypoint script that `chown`s at boot.
- **No em-dash (—) in user-facing text.** README/CLAUDE.md prose and `.env.example` comments are user-facing-ish docs; avoid em-dash per the project rule (code comments are technically exempt, but keep docs clean). [[no-emdash-user-facing]]
- The document-level-handler and render-mock-barrel conventions in CLAUDE.md are **not relevant** to this infra story (no handlers, no `render/` exports here) — they bind to Story 2.2+.

### Testing standards

- No new automated tests are expected (infra/docs change; there is no unit-test surface for compose files). The verification is the **live `docker compose up` smoke** in Task 3 — Epic 1's retro flagged that real environment behavior (here: file ownership, container reload) can only be proven live, not in jsdom/pytest.
- Regression bar: existing suites must stay green and unchanged. Backend: `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q`. Frontend: `cd client && npm test`. [Source: CLAUDE.md#Commands]
- Keep cross-model code review (`bmad-code-review` via Codex) as standing practice when the story is implemented (Epic 1 retro AP-3) — even for infra, a second model can catch a compose footgun.

### Project Structure Notes

- New file `compose.dev.yaml` sits at repo root beside `docker-compose.yml` (compose override convention). Matches the source-tree spine which lists `docker-compose.yml` at root (AD-10). [Source: ARCHITECTURE-SPINE.md#source-tree, line ~182]
- `.dockerignore` already excludes `.git`, `.bmad`, `_bmad`, `node_modules`, `dist`, `.venv` — no change needed; the dev override bind-mounts `./server/app` at runtime (not via build context), so dockerignore doesn't affect it.
- No conflicts with the unified structure. This story adds no module under `client/` or `server/app/`.

### References

- [Source: .bmad/planning-artifacts/epics.md#Story-2.1-Dev-infra-enabler] — story statement + 3 ACs.
- [Source: .bmad/implementation-artifacts/deferred-work.md#local-Docker-dev-experience-2026-06-29] — root cause + the proper-fix recommendations (compose `user:`, host-dir pre-create, dev override, (a)+(b) decision).
- [Source: .bmad/planning-artifacts/sprint-change-proposals/sprint-change-proposal-2026-06-29.md] — why 2.1 is the enabler and the anchor foundation moved to 2.2.
- [Source: ARCHITECTURE-SPINE.md#AD-8] — storage layout: host `~/.paper-mate` mounted to `/data`, the only write root.
- [Source: ARCHITECTURE-SPINE.md#AD-10] — single-container deployment; dev = Vite HMR proxy to FastAPI, prod = FastAPI serves dist.
- [Source: CLAUDE.md#Commands, #Single-command-boot] — host two-process dev flow + `docker compose up` boot, env vars `PAPER_MATE_PORT` / `PAPER_MATE_DATA`.
- [Source: .bmad/implementation-artifacts/epic-1/epic-1-retro-2026-06-29.md] — AP-3 (cross-model review), live-smoke-as-AC-verifier; note its anchor/2-1 language predates the renumber.

## Previous Story Intelligence

This is the first story of Epic 2; there is no prior Epic-2 story. Carry-over from Epic 1 (retro 2026-06-29):

- **Live smoke is the AC verifier for environment behavior.** jsdom/pytest proved wiring, never real movement/layout/IO. File ownership and container reload here are exactly that class — verify by running `docker compose up`, not by asserting in a test.
- **Deferred work was captured with root cause, not lost.** This story is the payoff: the docker dev-experience entry in `deferred-work.md` is now being actioned. Mark that entry resolved when done.
- **Renumber awareness.** Epic 2 was restructured 2026-06-29 (7→9 stories): 2.1 = this enabler, 2.2 = annotation foundation, 2.3–2.9 = the six tool stories. Any source that says "2-1 builds the anchor layer" is pre-renumber.

## Git Intelligence

Recent commits are planning/retro chores (`3b7ef4d` correct-course Epic 2, `5785991` Epic 1 retro, `c8a437a`/`72142e2` Docker dev-experience deferred notes). The last two directly concern this story's subject — the Docker dev-experience notes that became this enabler's ACs. No code commits since Epic 1 merged (PR #9). Implement on a fresh branch off `main` (don't commit to `main` directly, per global git convention).

## Project Context Reference

- Two processes, one container (AD-1/AD-10): `client/` (React 19.2 + Vite 8 SPA) and `server/` (FastAPI + Pydantic v2, uv-managed). Prod = single Docker image, FastAPI serves API + built SPA same-origin (no CORS).
- Storage (AD-8): host `~/.paper-mate` ↔ container `/data`, the only write root. `doc_id` = SHA-256 of PDF bytes; `library/{doc_id}/` holds `source.pdf` + `annotations.json` + `meta.json`.
- No auth, localhost single-user. v1 scope = Phase 1 (viewer/annotator).

## Story Completion Status

Implemented and verified live; cross-model code review (codex) applied. Status: review.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Claude Code, bmad-dev-story)

### Debug Log References

Live verification (Docker available: v29.6.0, compose v5.2.0; host uid/gid 1000:1000):

- `docker compose config` / `... -f compose.dev.yaml config` both parse; `user:` resolves to `1000:1000`; dev override merges both bind mounts (`/data` + `./server/app:/app/app`) and the `--reload` command.
- Prod-like boot (`docker compose up -d`): `/api/health` → 200 in 2s, SPA `/` → 200, container `id` = `uid=1000 gid=1000`.
- Ownership (AC1): container wrote `/data/.ownership-probe` owned `1000:1000`; visible host-side as `cotidie:cotidie`; host user deleted it with no sudo.
- Reload (AC2): dev override `/proc/1/cmdline` shows `uvicorn ... --reload`; editing bind-mounted `server/app/main.py` logged `WatchFiles detected changes in 'app/main.py'. Reloading...`; probe edit reverted via `git checkout` (working tree clean).
- Regression (AC3): backend `pytest` 33 passed; frontend `vitest` 126 passed. No `client/src` or `server/app` logic changed.

### Completion Notes List

- AC1 (writable `/data`): added compose `user: "${PAPER_MATE_UID:-1000}:${PAPER_MATE_GID:-1000}"`; `PAPER_MATE_UID`/`PAPER_MATE_GID` documented in `.env.example`; README documents the one-time `mkdir -p ~/.paper-mate` pre-create + the `sudo chown` recovery. Proven live: container-written files are host-owned and host-deletable.
- AC2 (dev-loop decision recorded): adopted deferred-work recommendation **(a)+(b)**. README "Development" section declares the host two-process flow canonical and Docker prod-like (built static, no hot-reload); new `compose.dev.yaml` adds optional in-container `uvicorn --reload` via a `server/app` bind-mount; CLAUDE.md "Single-command boot" line updated. Reload proven live.
- AC3 (infra-only, no regression): only infra/docs files changed (`docker-compose.yml`, `compose.dev.yaml`, `.env.example`, `README.md`, `CLAUDE.md`); no Dockerfile change needed (compose `user:` is the portable fix); both test suites green.
- No Dockerfile change: the portable compose `user:` form was sufficient; baking a fixed-uid `USER` would mismatch other hosts.
- Frontend in-container HMR intentionally out of scope (would require running Vite in the container = the host flow containerized); the override covers backend reload only.
- Em-dash check: no em-dash introduced in any authored doc/comment (per project + global writing rule).
- Follow-up for whoever runs `code-review`: mark the `deferred-work.md#local-Docker-dev-experience` entry resolved once this story is merged.

### File List

- `docker-compose.yml` (modified) — `user:` mapping, long `/data` bind with `create_host_path:false`, and (folded in post-review) the `./server/app` bind-mount + `uvicorn --reload` command as the default.
- `.env.example` (modified) — added `PAPER_MATE_UID` / `PAPER_MATE_GID`.
- `README.md` (modified) — added "Development" section (host two-process canonical, Docker prod-like boot, data-dir pre-create, ownership, optional in-container reload).
- `CLAUDE.md` (modified) — updated "Single-command boot" line (host-user run, pre-create, no-hot-reload caveat, dev override).
- `.bmad/implementation-artifacts/epic-2/2-1-dev-infra-enabler.md` (modified) — story tracking (frontmatter, checkboxes, Dev Agent Record, Change Log, Status).
- `.bmad/implementation-artifacts/sprint-status.yaml` (modified) — story status transitions.

## Change Log

- 2026-06-29 — Implemented dev-infra enabler: compose `user:` mapping for host-owned `/data`, `PAPER_MATE_UID/GID` env, README Development section + `compose.dev.yaml` optional in-container reload, CLAUDE.md boot-line update. Verified live (ownership + reload) and regression-clean (backend 33, frontend 126). Status → review.
- 2026-06-29 — Simplification (post-review, per user): folded the `compose.dev.yaml` override into `docker-compose.yml` as the default (bind-mount `./server/app` + `uvicorn --reload`) and deleted the override file, so plain `docker compose up` gives a live backend with no two-file incantation. README/CLAUDE updated; pure prod-style run documented via `docker build`/`docker run`. Verified live (reload + ownership + fail-loud).
- 2026-06-29 — Cross-model code review (codex) fixes: closed the AC1 gap where a missing host data dir was auto-created `root:root` (the non-root container then can't write). Switched the `/data` mount to long bind syntax with `create_host_path: false` (fails loudly if the dir is absent); made the README/CLAUDE pre-create + chown-recovery env-aware (source `.env`, use configured dir/uid); rewrote `.env.example` as the canonical env file with the data dir documented as user-defined; qualified the compose "writes only /data" comment to "persistent writes". Verified live: missing dir → `bind source path does not exist` error; existing dir → boots, files owned 1000, host-deletable.
