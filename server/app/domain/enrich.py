"""The ``enrich`` domain surface (AD-L2, Story 6.5).

A stable module-level function so the route composition root (``run_extraction``)
keeps calling ``domain.enrich(meta)`` unchanged. It delegates to an ``Enricher``
port — the default ``CrossrefEnricher`` in production, an injected fake in a
test — so enrichment is swappable and unit-testable without HTTP. It then
layers a second, conditional fallback (fix request): if Crossref left ``venue``
unset and the PDF carried an arXiv id, arXiv's own record fills venue/year
(and, when the PDF carried no DOI/authors of its own either, arXiv's
self-assigned DOI and its author list).
"""

from app.domain.arxiv_enrich import ArxivEnricher, ArxivFetcher, arxiv_doi
from app.domain.crossref import CrossrefEnricher, EnrichResult, Enricher
from app.models import ExtractedMeta

#: The default production enrichers (the only two backend network calls,
#: each behind its own port).
_default_enricher: Enricher = CrossrefEnricher()
_default_arxiv_fetcher: ArxivFetcher = ArxivEnricher()


def enrich(
    meta: ExtractedMeta,
    enricher: Enricher | None = None,
    arxiv_fetcher: ArxivFetcher | None = None,
) -> EnrichResult:
    """Correct ``meta`` against the enricher, then the arXiv venue/year
    fallback, or degrade to ``"skipped"``.

    Uses the default ``CrossrefEnricher``/``ArxivEnricher`` unless injected
    (a test passes a fake to avoid HTTP). Never raises, never blocks: the
    facade enforces the degrade-to-``"skipped"``/no-op contract even if a
    misbehaving injected enricher throws, so a raise can never leak into the
    add path.

    The arXiv fallback only fires when Crossref's result (or a total skip)
    left ``venue`` unset AND ``meta.arxiv_id`` was found in the PDF (fix
    request): Crossref, when it has an answer, is authoritative (a formally
    published paper's real venue beats the arXiv preprint listing). A
    successful arXiv fill turns a Crossref ``"skipped"`` into a real
    ``ExtractedMeta`` (the paper WAS externally corroborated, just via arXiv
    instead of Crossref). When the paper is arXiv-only this way, its own
    self-assigned DOI and author list ALSO fill in (fix request) wherever
    extraction/Crossref left them empty - never overwriting a real value.
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
    return result
