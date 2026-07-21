"""API layer (AD-9). Routes are thin: no filesystem access, no domain logic.

Exposes ``health``, ``docs`` (PDF import + per-doc metadata/file/annotations),
``library`` (the collection index, ``GET /api/library``, Story 6.2), and
``settings`` (the runtime document-structure mode).
Reserved (not built): ``GET /api/docs`` (list) — the collection list is
``GET /api/library``, not a docs-list scan (AD-L6).
"""

from fastapi import APIRouter

from app.routes.docs import router as docs_router
from app.routes.health import router as health_router
from app.routes.library import router as library_router
from app.routes.settings import router as settings_router

api_router = APIRouter(prefix="/api")
api_router.include_router(health_router)
api_router.include_router(docs_router)
api_router.include_router(library_router)
api_router.include_router(settings_router)
