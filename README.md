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
# pre-create the data dir so the bind-mount target is host-owned, not root
mkdir -p "${PAPER_MATE_DATA:-$HOME/.paper-mate}"

docker compose up
```

- Host port: `PAPER_MATE_PORT` (default 8000). Data dir: `PAPER_MATE_DATA` (default `~/.paper-mate`), mounted to `/data`.
- The container runs as the host user (`PAPER_MATE_UID`/`PAPER_MATE_GID`, default 1000:1000) so files written under `~/.paper-mate` are host-owned and you can edit or delete them. Override the uid/gid in `.env` if `id -u` / `id -g` differ on your host. See `.env.example`.
- If you already have a `root:root` data dir from an older run, reclaim it once: `sudo chown -R "$USER":"$USER" ~/.paper-mate`.

> Important: the Docker image is built static. A `docker compose up` container does NOT hot-reload. The backend code is baked in at build time and uvicorn runs without `--reload`, and the SPA is the built bundle (no HMR). After a backend edit, a plain `docker compose up` serves the OLD code: rebuild with `docker compose up --build`. A stale container is a missing rebuild, not a bug. For live iteration use the host two-process flow above.

### Optional: in-container backend reload

If you specifically need backend reload inside Docker, use the dev override, which bind-mounts `server/app` and runs `uvicorn --reload`:

```sh
docker compose -f docker-compose.yml -f compose.dev.yaml up
```

This covers the backend only; for live frontend work use the host flow.

## Planning and architecture

Canonical planning artifacts live under `.bmad/planning-artifacts/` (PRD, architecture spine, epics and stories, UX). Root `DESIGN.md` and `EXPERIENCE.md` are also inputs.
