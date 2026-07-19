# Single-container image (AD-10): build the Vite SPA, then run FastAPI/uvicorn
# serving both /api and the built dist from one origin.

# --- Stage 1: build the client ---
FROM node:24-slim AS client
WORKDIR /build
COPY client/package.json client/package-lock.json client/.npmrc ./client/
RUN cd client && npm ci
# gen:tokens reads ../DESIGN.md; gen:api output (schema.d.ts) is committed.
COPY DESIGN.md ./DESIGN.md
COPY client ./client
RUN cd client && npm run build

# --- Stage 2: runtime ---
FROM python:3.13-slim AS runtime
COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/uv
WORKDIR /app
# opendataloader-pdf (AD-13 document-structure extraction, Story 10.1) is a Java
# core spawned via its Python binding, so the runtime needs a JRE (Java 11+).
# default-jre-headless (Debian trixie: JRE 21) satisfies it with the smallest
# footprint; it runs in-container at import, never a host CLI (AD-13).
RUN apt-get update \
    && apt-get install -y --no-install-recommends default-jre-headless \
    && rm -rf /var/lib/apt/lists/*
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
# Install deps from the committed lockfile (reproducible; no fresh resolve).
COPY server/pyproject.toml server/uv.lock ./
COPY server/app ./app
RUN uv sync --frozen --no-dev
ENV PATH="/app/.venv/bin:$PATH"
COPY --from=client /build/client/dist ./static
ENV PAPER_MATE_STATIC_DIR=/app/static
# 0.0.0.0 inside the container; the host publish is loopback-bound in compose.
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
