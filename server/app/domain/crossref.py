"""The Crossref enricher: the primary bibliographic network call (AD-L2).
``arxiv_enrich.py`` (fix request) is the other, a conditional fallback
``enrich.py`` layers on top when this one leaves ``venue`` unset.

``enrich`` (the domain surface, in ``enrich.py``) delegates to an ``Enricher``
port; ``CrossrefEnricher`` is its default implementation. Abstracting Crossref
behind the port keeps enrichment swappable and unit-testable without HTTP (a
test injects a fake enricher, or patches ``crossref.httpx``).

``CrossrefEnricher.enrich`` **never raises** and **never blocks** the add
(LFR-9, NFR-1): offline, on any timeout / non-200 / no-match, or with nothing
to query, it degrades to the literal ``"skipped"``, and it makes no more than
the two bounded Crossref calls (DOI first, then a bibliographic title fallback).
"""

import re
from typing import Literal, Protocol
from urllib.parse import quote

import httpx

from app.domain._text import clean
from app.models import ExtractedMeta
from app.version import get_version

#: The domain-level result of an enrichment attempt: a corrected meta or a skip.
EnrichResult = ExtractedMeta | Literal["skipped"]

#: Crossref REST base + a short, polite timeout (single-user, best-effort).
_CROSSREF = "https://api.crossref.org"
_TIMEOUT = 5.0

#: Minimum token-set Jaccard similarity for a Crossref *title-query* hit to be
#: trusted. Crossref's `rows=1` always returns its best match even when the
#: query has none, so a bare `items[0]` accepts keyword-spam papers that merely
#: mention the query terms. Requiring real overlap keeps the local title
#: instead of "correcting" it to an unrelated work. (The DOI path is exact and
#: needs no such guard.)
_TITLE_MATCH_MIN_JACCARD = 0.5

#: Preference order for a Crossref work's publication year: the canonical
#: `issued` date, falling back through the `published-*` variants.
_YEAR_KEYS = ("issued", "published-print", "published-online", "published")


class Enricher(Protocol):
    """The metadata-enrichment port (AD-L2): correct an ``ExtractedMeta`` against
    an external authority, or degrade to ``"skipped"``. Never raises, never
    blocks — so the add pipeline can compose it unconditionally."""

    def enrich(self, meta: ExtractedMeta) -> EnrichResult: ...


def _user_agent() -> str:
    """Crossref polite-pool etiquette: identify the app + a contact address."""
    return f"PaperMate/{get_version()} (mailto:paper-mate@localhost)"


def _authors_from_crossref(work: dict) -> list[str]:
    names: list[str] = []
    for author in work.get("author", []) or []:
        given = (author.get("given") or "").strip()
        family = (author.get("family") or "").strip()
        full = f"{given} {family}".strip()
        if full:
            names.append(full)
    return names


def _venue_from_work(work: dict) -> str | None:
    containers = work.get("container-title") or []
    return clean(containers[0]) if containers else None


def _year_from_work(work: dict) -> int | None:
    for key in _YEAR_KEYS:
        entry = work.get(key)
        if not isinstance(entry, dict):
            continue
        date_parts = entry.get("date-parts") or []
        if not date_parts:
            continue
        first = date_parts[0]
        if isinstance(first, list) and first and isinstance(first[0], int):
            return first[0]
    return None


def _meta_from_work(work: dict, doi: str | None) -> ExtractedMeta | None:
    """Project a Crossref ``message`` work into ``ExtractedMeta`` (``None`` if
    it carries no title — an empty result is a skip, not a correction).

    ``doi`` stays the passed-in, extraction-sourced value (scope guard, Story
    7.9): this does NOT read ``work.get("DOI")``.
    """
    titles = work.get("title") or []
    title = clean(titles[0]) if titles else None
    if title is None:
        return None
    return ExtractedMeta(
        title=title,
        authors=_authors_from_crossref(work),
        doi=doi,
        venue=_venue_from_work(work),
        year=_year_from_work(work),
    )


def _titles_match(query_title: str, result_title: str) -> bool:
    """Token-set Jaccard >= threshold — a plausibility gate for title-query
    hits so an unrelated top result can't overwrite a correct local title."""
    query_tokens = set(re.findall(r"[a-z0-9]+", query_title.lower()))
    result_tokens = set(re.findall(r"[a-z0-9]+", result_title.lower()))
    if not query_tokens or not result_tokens:
        return False
    jaccard = len(query_tokens & result_tokens) / len(query_tokens | result_tokens)
    return jaccard >= _TITLE_MATCH_MIN_JACCARD


class CrossrefEnricher:
    """The default ``Enricher``: correct ``meta`` against Crossref, DOI-first."""

    def enrich(self, meta: ExtractedMeta) -> EnrichResult:
        """Correct ``meta`` against Crossref, DOI-first, or degrade to ``"skipped"``.

        DOI-first (``/works/{doi}``) then a bibliographic title fallback
        (``/works?query.bibliographic=...&rows=1``). Offline, on any timeout /
        non-200 / no-match, OR when there is neither a DOI nor a title to query,
        it returns the literal ``"skipped"``. It NEVER raises and NEVER blocks
        the add (LFR-9, NFR-1), and makes no more than the two bounded Crossref
        calls.
        """
        # Normalize first: a whitespace-only title/doi is nothing to query, and
        # a blank bibliographic query would otherwise hit Crossref for no reason.
        doi = clean(meta.doi)
        title = clean(meta.title)
        if doi is None and title is None:
            return "skipped"  # nothing to query — no network call
        try:
            with httpx.Client(timeout=_TIMEOUT, headers={"User-Agent": _user_agent()}) as client:
                if doi:
                    resp = client.get(f"{_CROSSREF}/works/{quote(doi, safe='/')}")
                    if resp.status_code == 200:
                        corrected = _meta_from_work(resp.json().get("message", {}), doi)
                        if corrected is not None:
                            return corrected
                if title:
                    params = {"query.bibliographic": title, "rows": "1"}
                    if meta.authors:
                        params["query.author"] = " ".join(meta.authors)
                    resp = client.get(f"{_CROSSREF}/works", params=params)
                    if resp.status_code == 200:
                        items = resp.json().get("message", {}).get("items", [])
                        if items:
                            corrected = _meta_from_work(items[0], doi)
                            # Only trust a title-query hit that actually resembles
                            # the query (Crossref always returns a top result).
                            if corrected is not None and _titles_match(title, corrected.title or ""):
                                return corrected
        except Exception:
            return "skipped"
        return "skipped"
