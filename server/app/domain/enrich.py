"""The ``enrich`` domain surface (AD-L2, Story 6.5).

A stable module-level function so the route composition root (``run_extraction``)
keeps calling ``domain.enrich(meta)`` unchanged. It delegates to an ``Enricher``
port — the default ``CrossrefEnricher`` in production, an injected fake in a
test — so enrichment is swappable and unit-testable without HTTP.
"""

from app.domain.crossref import CrossrefEnricher, EnrichResult, Enricher
from app.models import ExtractedMeta

#: The default production enricher (the only backend network call, behind the port).
_default_enricher: Enricher = CrossrefEnricher()


def enrich(meta: ExtractedMeta, enricher: Enricher | None = None) -> EnrichResult:
    """Correct ``meta`` against the enricher, or degrade to ``"skipped"``.

    Uses the default ``CrossrefEnricher`` unless an ``enricher`` is injected
    (a test passes a fake to avoid HTTP). Never raises, never blocks — the port
    contract holds for every implementation.
    """
    return (enricher or _default_enricher).enrich(meta)
