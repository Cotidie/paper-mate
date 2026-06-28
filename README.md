# Paper Mate

A web PDF paper-reading companion: annotation plus AI chat, optimized for reading papers.

Two processes, one container: `client/` (React 19.2 + Vite 8 + TypeScript SPA) and `server/` (FastAPI + Pydantic v2, uv-managed). In production a single container serves both the API and the built SPA from one origin (no CORS). Localhost, single user, no auth.

## Development

There are two ways to run the app. They serve different purposes; pick by what you are doing.

### 1. Host two-process flow (the canonical dev loop)

Use this for day-to-day development. It gives backend auto-reload and frontend HMR.

```sh
# shell 1: backend (auto-reloads on edit)
cd server && uv run uvicorn app.main:app --reload --port 8000

# shell 2: frontend (HMR)
cd client && npm run dev
```

Vite serves the SPA and proxies `/api` to FastAPI (override the target with `PAPER_MATE_API_TARGET`).

- Backend tests: `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q`
- Frontend tests: `cd client && npm test` ; typecheck: `npm run typecheck`

### 2. Docker (prod-like single-command boot)

Use this to run the app the way it ships: one container, FastAPI serving the API plus the built static SPA.

```sh
# 1. Configure (optional): copy the env file and set your data dir / port / uid.
cp .env.example .env        # then edit .env if you want non-defaults

# 2. Pre-create the data dir as your host user, using the SAME value as
#    PAPER_MATE_DATA. This sources .env so it respects a custom location.
set -a; [ -f .env ] && . ./.env; set +a
mkdir -p "${PAPER_MATE_DATA:-$HOME/.paper-mate}"

# 3. Boot.
docker compose up
```

- All configuration is env-driven via `.env` (auto-loaded by Compose); `.env.example` is the canonical list. Data dir: `PAPER_MATE_DATA` (default `~/.paper-mate`, mounted to `/data`). Host port: `PAPER_MATE_PORT` (default 8000).
- The container runs as the host user (`PAPER_MATE_UID`/`PAPER_MATE_GID`, default 1000:1000) so files written under your data dir are host-owned and you can edit or delete them. Override the uid/gid in `.env` if `id -u` / `id -g` differ on your host.
- Step 2 matters: the compose mount uses `create_host_path: false`, so if the data dir does not exist `docker compose up` fails with a clear error rather than letting Docker auto-create it as `root:root` (which the non-root container then cannot write). Pre-create it first.
- If you have a `root:root` data dir from an older run, reclaim it once (use your configured dir/uid): `sudo chown -R "$(id -u)":"$(id -g)" "${PAPER_MATE_DATA:-$HOME/.paper-mate}"`.

> Important: the Docker image is built static. A `docker compose up` container does NOT hot-reload. The backend code is baked in at build time and uvicorn runs without `--reload`, and the SPA is the built bundle (no HMR). After a backend edit, a plain `docker compose up` serves the OLD code: rebuild with `docker compose up --build`. A stale container is a missing rebuild, not a bug. For live iteration use the host two-process flow above.

### Optional: in-container backend reload

If you specifically need backend reload inside Docker, use the dev override, which bind-mounts `server/app` and runs `uvicorn --reload`:

```sh
docker compose -f docker-compose.yml -f compose.dev.yaml up
```

This covers the backend only; for live frontend work use the host flow.

## Planning and architecture

Canonical planning artifacts live under `.bmad/planning-artifacts/` (PRD, architecture spine, epics and stories, UX). Root `DESIGN.md` and `EXPERIENCE.md` are also inputs.
