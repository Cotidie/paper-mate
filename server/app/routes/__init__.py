"""API layer (AD-9). Routes are thin: no filesystem access, no domain logic.

Exposes ``health``, ``docs`` (PDF import + per-doc metadata/file/annotations),
and ``library`` (the collection index, ``GET /api/library``, Story 6.2).
Reserved (not built): ``GET /api/docs`` (list) — the collection list is
``GET /api/library``, not a docs-list scan (AD-L6).
"""

from fastapi import APIRouter

from app.routes.docs import router as docs_router
from app.routes.health import router as health_router
from app.routes.library import router as library_router

api_router = APIRouter(prefix="/api")
api_router.include_router(health_router)
api_router.include_router(docs_router)
api_router.include_router(library_router)
