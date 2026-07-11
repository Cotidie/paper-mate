"""The ``enrich`` domain surface (AD-L2, Story 6.5).

A stable module-level function so the route composition root (``run_extraction``)
keeps calling ``domain.enrich(meta)`` unchanged. It delegates to an ``Enricher``
port — the default ``CrossrefEnricher`` in production, an injected fake in a
test — so enrichment is swappable and unit-testable without HTTP. It then
layers two further conditional fallbacks: if Crossref left ``venue`` unset and
the PDF carried an arXiv id, arXiv's own record fills venue/year (fix
request); and if the paper resolved but still carries no ``venue_short``,
Semantic Scholar's venue-acronym lookup fills that in (Story 8.5 fix request).
"""

from app.domain.arxiv_enrich import ArxivEnricher, ArxivFetcher, arxiv_doi
from app.domain.crossref import CrossrefEnricher, EnrichResult, Enricher
from app.domain.semantic_scholar import SemanticScholarEnricher, VenueShortFetcher
from app.models import ExtractedMeta

#: The default production enrichers (the only three backend network calls,
#: each behind its own port).
_default_enricher: Enricher = CrossrefEnricher()
_default_arxiv_fetcher: ArxivFetcher = ArxivEnricher()
_default_venue_short_fetcher: VenueShortFetcher = SemanticScholarEnricher()


def enrich(
    meta: ExtractedMeta,
    enricher: Enricher | None = None,
    arxiv_fetcher: ArxivFetcher | None = None,
    venue_short_fetcher: VenueShortFetcher | None = None,
) -> EnrichResult:
    """Correct ``meta`` against the enricher, then the arXiv venue/year
    fallback, then the Semantic Scholar venue-acronym fallback, or degrade to
    ``"skipped"``.

    Uses the default ``CrossrefEnricher``/``ArxivEnricher``/
    ``SemanticScholarEnricher`` unless injected (a test passes a fake to avoid
    HTTP). Never raises, never blocks: the facade enforces the
    degrade-to-``"skipped"``/no-op contract even if a misbehaving injected
    enricher throws, so a raise can never leak into the add path.

    The arXiv fallback only fires when Crossref's result (or a total skip)
    left ``venue`` unset AND ``meta.arxiv_id`` was found in the PDF (fix
    request): Crossref, when it has an answer, is authoritative (a formally
    published paper's real venue beats the arXiv preprint listing). A
    successful arXiv fill turns a Crossref ``"skipped"`` into a real
    ``ExtractedMeta`` (the paper WAS externally corroborated, just via arXiv
    instead of Crossref). When the paper is arXiv-only this way, its own
    self-assigned DOI and author list ALSO fill in (fix request) wherever
    extraction/Crossref left them empty - never overwriting a real value.

    The Semantic Scholar fallback only fires on top of an already-resolved
    paper (a real ``ExtractedMeta``, from either Crossref or the arXiv
    fallback above) that still has no ``venue_short`` and DOES have a
    ``doi`` to key the lookup on - it only upgrades the short form, never
    conjures a venue/doi/authors from nothing.
    """
    try:
        result = (enricher or _default_enricher).enrich(meta)
    except Exception:
        result = "skipped"

    current = result if isinstance(result, ExtractedMeta) else None
    if (current.venue if current else None) is None and meta.arxiv_id:
        try:
            venue, year, authors = (arxiv_fetcher or _default_arxiv_fetcher).fetch(meta.arxiv_id)
        except Exception:
            venue, year, authors = None, None, []
        if venue is not None:
            base = current or meta
            updates = {"venue": venue, "year": base.year or year}
            if base.doi is None:
                updates["doi"] = arxiv_doi(meta.arxiv_id)
            if not base.authors and authors:
                updates["authors"] = authors
            result = base.model_copy(update=updates)

    if isinstance(result, ExtractedMeta) and result.venue_short is None and result.doi:
        try:
            short = (venue_short_fetcher or _default_venue_short_fetcher).fetch(result.doi)
        except Exception:
            short = None
        if short:
            result = result.model_copy(update={"venue_short": short})

    return result
