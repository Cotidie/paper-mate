"""FastAPI application entrypoint.

Prod (AD-10): one process serves the ``/api`` surface AND the built Vite SPA
from the same origin (no CORS). Dev: this serves only ``/api``; the Vite dev
server serves the SPA and proxies ``/api`` here.

Static serving is enabled only when a built ``dist`` is present (resolved from
``PAPER_MATE_STATIC_DIR``, default ``<repo>/server/static``). The SPA catch-all
never shadows ``/api/*`` — the API router is registered first and the catch-all
explicitly rejects ``api`` paths.
"""

import asyncio
import logging
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.openapi.utils import get_openapi
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app import storage
from app.domain.structure import active_mode, hybrid_url
from app.routes import api_router
from app.structure_hybrid import start_hybrid_server, stop_hybrid_server
from app.version import get_version

logger = logging.getLogger(__name__)


@asynccontextmanager
async def _lifespan(_: FastAPI) -> AsyncIterator[None]:
    """Boot reconcile (AC-4/AC-6): align ``library.json`` with what is on disk
    before serving. The data root resolves lazily inside ``reconcile_library``
    so the test ``data_root`` fixture is honored. Best-effort: a reconcile
    failure logs and never aborts boot (a corrupt single doc must not brick
    the app).

    In hybrid structure mode (Story 10.3) also launch the bundled Docling hybrid
    server off the event loop; local mode (the default) launches nothing. Both
    the launch and shutdown are best-effort + logged, so neither can brick boot."""
    try:
        storage.reconcile_library()
    except storage.StorageError:
        logger.exception("library reconcile failed at startup; continuing")
    hybrid_proc = None
    try:
        hybrid_proc = await asyncio.to_thread(start_hybrid_server, active_mode(), hybrid_url())
    except Exception:
        logger.exception("structure hybrid server launch failed at startup; continuing")
    try:
        yield
    finally:
        try:
            await asyncio.to_thread(stop_hybrid_server, hybrid_proc)
        except Exception:
            logger.exception("structure hybrid server shutdown failed")


app = FastAPI(title="Paper Mate", version=get_version(), lifespan=_lifespan)

# API first so /api/* always wins over the SPA catch-all.
app.include_router(api_router)


@app.exception_handler(RequestValidationError)
async def _validation_to_envelope(_: Request, exc: RequestValidationError) -> JSONResponse:
    """Map request-validation failures to the single ``{ "detail": string }``
    envelope (AR-11) instead of FastAPI's default array of error objects."""
    errors = exc.errors()
    detail = errors[0].get("msg", "Invalid request") if errors else "Invalid request"
    return JSONResponse(status_code=422, content={"detail": detail})


def _custom_openapi() -> dict[str, Any]:
    """OpenAPI with every 422 response documented as the string envelope, so the
    generated client contract matches the runtime envelope (AR-11)."""
    if app.openapi_schema:
        return app.openapi_schema
    schema = get_openapi(title=app.title, version=app.version, routes=app.routes)
    components = schema.setdefault("components", {}).setdefault("schemas", {})
    components["ErrorEnvelope"] = {
        "type": "object",
        "title": "ErrorEnvelope",
        "properties": {"detail": {"type": "string", "title": "Detail"}},
        "required": ["detail"],
    }
    for path_item in schema.get("paths", {}).values():
        for operation in path_item.values():
            if not isinstance(operation, dict):
                continue
            resp = operation.get("responses", {}).get("422")
            if resp is not None:
                resp["content"] = {
                    "application/json": {"schema": {"$ref": "#/components/schemas/ErrorEnvelope"}}
                }
    # Drop the now-unreferenced default validation schemas.
    for name in ("HTTPValidationError", "ValidationError"):
        components.pop(name, None)
    app.openapi_schema = schema
    return schema


app.openapi = _custom_openapi  # type: ignore[method-assign]


def _static_dir() -> Path:
    return Path(os.environ.get("PAPER_MATE_STATIC_DIR", Path(__file__).parent.parent / "static"))


_dist = _static_dir().resolve()
if (_dist / "index.html").is_file():
    # Hashed build assets.
    if (_dist / "assets").is_dir():
        app.mount("/assets", StaticFiles(directory=_dist / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa_fallback(full_path: str) -> FileResponse:
        """Serve index.html for all non-API routes (client-side routing)."""
        # Reject the API surface only (not lookalikes like /apiary).
        if full_path == "api" or full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not Found")
        if full_path:
            candidate = (_dist / full_path).resolve()
            # Containment: never serve a file outside the built dist (no traversal).
            if candidate.is_file() and candidate.is_relative_to(_dist):
                return FileResponse(candidate)
        return FileResponse(_dist / "index.html")
