"""Backend domain layer (AD-L2): pure, storage-free business logic.

Its tenant is metadata extraction + enrichment. The layer takes data in and
returns data out — it never touches the filesystem and never imports
``app.storage``; the route composes it with storage (the only writer).

Split into focused modules behind this facade:

- ``extract``   — the pure PyMuPDF ``extract`` (total, GROBID-swappable).
- ``crossref``  — the ``Enricher`` port + the ``CrossrefEnricher`` (the only
                  backend network call).
- ``enrich``    — the ``enrich`` domain surface delegating to the port.
- ``structure`` — the ``StructureExtractor`` port + the ``OpenDataLoaderExtractor``
                  (structure extraction, AD-13/AD-L8, the domain's second tenant).
"""

from app.domain.crossref import CrossrefEnricher, Enricher
from app.domain.enrich import enrich
from app.domain.extract import extract
from app.domain.structure import (
    OpenDataLoaderExtractor,
    StructureExtractor,
    active_mode,
    extract_structure,
)

__all__ = [
    "extract",
    "enrich",
    "Enricher",
    "CrossrefEnricher",
    "extract_structure",
    "StructureExtractor",
    "OpenDataLoaderExtractor",
    "active_mode",
]
