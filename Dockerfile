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
WORKDIR /app
COPY server/pyproject.toml ./pyproject.toml
COPY server/app ./app
RUN pip install --no-cache-dir .
COPY --from=client /build/client/dist ./static
ENV PAPER_MATE_STATIC_DIR=/app/static
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
