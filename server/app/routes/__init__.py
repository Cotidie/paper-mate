"""API layer (AD-9). Routes are thin: no filesystem access, no domain logic.

This story exposes ``health`` and ``docs`` (PDF import). Reserved future
resources (do not build now): ``/api/docs/{doc_id}``,
``/api/docs/{doc_id}/file``, ``/api/docs/{doc_id}/annotations``.
"""

from fastapi import APIRouter

from app.routes.docs import router as docs_router
from app.routes.health import router as health_router

api_router = APIRouter(prefix="/api")
api_router.include_router(health_router)
api_router.include_router(docs_router)
