"""Backend domain layer (AD-L2): pure, storage-free business logic.

Its first (and, in Story 6.5, only) tenant is metadata extraction. The layer
takes data in and returns data out — it never touches the filesystem and never
imports ``app.storage``; the route composes it with storage.
"""

from app.domain.extraction import enrich, extract

__all__ = ["extract", "enrich"]
