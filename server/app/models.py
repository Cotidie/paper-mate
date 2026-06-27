"""Pydantic v2 models — single source of the API contract (AD-3, AD-5).

Pydantic models here feed FastAPI's OpenAPI schema, which is generated into TS
types for the client via ``openapi-typescript``. Client API types are generated,
never hand-authored.

This story (1.1) defines only a minimal ``HealthStatus`` so the contract
pipeline has a real schema to emit. The full ``Annotation`` model (AD-5) is
Epic-2 work and is intentionally NOT defined here.
"""

from typing import Literal

from pydantic import BaseModel


class HealthStatus(BaseModel):
    """Liveness response for ``GET /api/health``."""

    status: Literal["ok"] = "ok"
