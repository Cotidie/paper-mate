"""Pydantic v2 models — single source of the API contract (AD-3, AD-5).

Pydantic models here feed FastAPI's OpenAPI schema, which is generated into TS
types for the client via ``openapi-typescript``. Client API types are generated,
never hand-authored.

The full ``Annotation`` model (AD-5) is Epic-2 work and is intentionally NOT
defined here.
"""

from typing import Literal

from pydantic import BaseModel


class HealthStatus(BaseModel):
    """Liveness response for ``GET /api/health``."""

    status: Literal["ok"] = "ok"


class DocMeta(BaseModel):
    """Per-document metadata — the exact on-disk ``meta.json`` schema (AD-8).

    Storage-owned. ``doc_id`` is the library folder name and is intentionally
    NOT a field here; the API surfaces it via ``Doc``.
    """

    filename: str
    title: str | None = None
    page_count: int
    added: str  # ISO-8601 UTC
    last_opened: str  # ISO-8601 UTC
    schema_version: int = 1


class Doc(DocMeta):
    """API representation of an imported document = ``doc_id`` + its metadata."""

    doc_id: str
