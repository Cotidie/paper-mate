"""Semantic Scholar venue-acronym fallback (Story 8.5 fix request): when
Crossref's own cascade (``short-container-title`` / ``event.acronym`` / a
``container-title`` parenthetical) still leaves ``venue_short`` unset for an
otherwise-resolved paper, query Semantic Scholar's Graph API by DOI for its
``publicationVenue.alternate_names`` - a curated list of venue name variants
that often includes the bare acronym (e.g. "ICCV") even when Crossref's own
record carries none (verified: DOI 10.1109/iccv.2017.226). A third bounded,
never-raising, never-blocking network call alongside Crossref's and arXiv's
(mirrors ``crossref.py``'s ``Enricher`` shape).
"""

import re
from typing import Protocol
from urllib.parse import quote

import httpx

from app.domain._text import clean

#: Semantic Scholar's public Graph API (no key required at this call volume).
_SEMANTIC_SCHOLAR = "https://api.semanticscholar.org/graph/v1/paper"
_TIMEOUT = 5.0

#: An acronym-shaped `alternate_names` entry: all-uppercase letters/digits,
#: no spaces. `alternate_names` is NOT ordered acronym-first (code-review
#: fix, verified live: DOI 10.18653/v1/2020.acl-main.1 returns
#: ``["Annu Meet Assoc Comput Linguistics", "Meeting of the Association for
#: Computational Linguistics", "ACL", "Meet Assoc Comput Linguistics"]`` -
#: the bare acronym sits at index 2, not 0), so this scans for the acronym
#: shape rather than trusting list order.
_ACRONYM_NAME = re.compile(r"^[A-Z][A-Z0-9]{1,11}$")


class VenueShortFetcher(Protocol):
    """The Semantic Scholar venue-acronym lookup port: resolve a DOI to a
    short venue form, or ``None`` on any failure or miss."""

    def fetch(self, doi: str) -> str | None: ...


class SemanticScholarEnricher:
    """The default ``VenueShortFetcher``: query Semantic Scholar's Graph API
    by DOI and scan ``publicationVenue.alternate_names`` for an acronym-shaped
    entry (never just the first one — see ``_ACRONYM_NAME``). Never raises,
    never blocks the add (LFR-9/NFR-1 parity with ``CrossrefEnricher``/
    ``ArxivEnricher``): offline, non-200, or no acronym-shaped name all
    degrade to ``None`` rather than surfacing an error or a wrong guess."""

    def fetch(self, doi: str) -> str | None:
        try:
            with httpx.Client(timeout=_TIMEOUT) as client:
                resp = client.get(
                    f"{_SEMANTIC_SCHOLAR}/DOI:{quote(doi, safe='/')}",
                    params={"fields": "publicationVenue"},
                )
                if resp.status_code != 200:
                    return None
                venue = resp.json().get("publicationVenue") or {}
                names = venue.get("alternate_names") or []
                for name in names:
                    cleaned = clean(name)
                    if cleaned and _ACRONYM_NAME.match(cleaned):
                        return cleaned
                return None
        except Exception:
            return None
