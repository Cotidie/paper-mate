"""The arXiv venue/year/doi/authors fallback (fix request, follows LFR-32):
when Crossref has no venue for a paper (no match, or a match with no
``container-title``), and the PDF carries an arXiv id, look the id up
against arXiv itself instead. A second bounded, never-raising,
never-blocking network call alongside Crossref's (mirrors ``crossref.py``'s
``Enricher`` shape exactly).

Uses the maintained ``arxiv`` client library (lukasschwab/arxiv.py) rather
than hand-rolling Atom-XML parsing over ``export.arxiv.org`` (CLAUDE.md:
adopt a proven library over a from-scratch build).
"""

from typing import Protocol

import arxiv

from app.domain._text import clean

#: The fallback venue for a preprint that carries no ``journal_ref`` (arXiv
#: itself IS the venue in that case, not blank).
ARXIV_VENUE = "arXiv"

#: A shared client (its rate-limit bookkeeping is meant to persist across
#: calls, per the library's own design). A single retry and a short courtesy
#: delay keep it bounded, close in spirit to Crossref's 5s timeout (LFR-9/
#: NFR-1 parity) - the library exposes no raw socket timeout to tighten further.
_client = arxiv.Client(num_retries=1, delay_seconds=1.0)


class ArxivFetcher(Protocol):
    """The arXiv-lookup port (mirrors Crossref's ``Enricher``): resolve an
    arXiv id to ``(venue, year, authors)``, or ``(None, None, [])`` on any
    failure."""

    def fetch(self, arxiv_id: str) -> tuple[str | None, int | None, list[str]]: ...


class ArxivEnricher:
    """The default ``ArxivFetcher``: query arXiv via the ``arxiv`` package.
    Never raises, never blocks the add (LFR-9/NFR-1 parity with
    ``CrossrefEnricher``): offline, no match, or a malformed result all
    degrade to ``(None, None, [])`` rather than surfacing an error."""

    def fetch(self, arxiv_id: str) -> tuple[str | None, int | None, list[str]]:
        try:
            results = list(_client.results(arxiv.Search(id_list=[arxiv_id])))
        except Exception:
            return None, None, []
        if not results:
            return None, None, []
        result = results[0]
        venue = clean(result.journal_ref) or ARXIV_VENUE
        year = result.published.year if result.published else None
        authors = [a.name for a in result.authors or [] if clean(a.name)]
        return venue, year, authors


def arxiv_doi(arxiv_id: str) -> str:
    """arXiv's own auto-assigned DOI for the preprint itself (fix request):
    every arXiv paper gets one via DataCite, the deterministic
    ``10.48550/arXiv.<id>`` pattern shown on its abstract page. This is NOT
    looked up from the API (the Atom ``<arxiv:doi>`` field is reserved for a
    THIRD-PARTY journal's DOI, ``journal_ref``'s sibling, and is usually
    empty for a preprint) - it's derived directly from the id, no extra
    network round-trip needed."""
    return f"10.48550/arXiv.{arxiv_id}"
