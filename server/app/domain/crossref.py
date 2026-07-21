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


#: A trailing year token on a Crossref `event.acronym` (e.g. "CHI '25" ->
#: "CHI"; the Year column already carries the year). Matches an optional
#: leading straight/curly apostrophe/backtick then 2-4 trailing digits.
_VENUE_YEAR_SUFFIX = re.compile(r"\s*['‘’`]?\d{2,4}\s*$")

#: A trailing all-caps acronym in parens at the end of `container-title`
#: (e.g. "... Computer Vision (ICCV)" -> "ICCV"). Verified: many IEEE
#: proceedings works (e.g. DOI 10.1109/iccv.2017.226) carry an `event` with
#: no `acronym` key at all, so the only Crossref-supplied short form is this
#: parenthetical in the title itself. Must start with a letter (rejects a
#: bare "(2020)") and contain only uppercase letters/digits (rejects
#: "(Volume 1)", "(SAC '19)") - a tight match so a false positive degrades to
#: `None`, not a wrong guess.
_CONTAINER_TITLE_ACRONYM = re.compile(r"\(([A-Z][A-Z0-9]{1,11})\)\s*$")


def _short_venue_from_work(work: dict) -> str | None:
    """Short venue for the Venue (Short) column (Story 8.5). Cascade over
    Crossref-supplied fields only (never a curated abbreviation dictionary):
    1. ``short-container-title[0]``, when present.
    2. ``event.acronym``, year-stripped (e.g. "CHI '25" -> "CHI"; verified:
       DOI 10.1145/3706598.3713941 has an empty ``short-container-title``
       but ``event.acronym`` == "CHI '25").
    3. A trailing "(ACRONYM)" parenthetical on ``container-title[0]``
       (verified: DOI 10.1109/iccv.2017.226's ``event`` has no ``acronym``
       key at all, but its ``container-title`` ends in "(ICCV)").
    ``None`` when none apply, and the client cell then renders blank."""
    shorts = work.get("short-container-title") or []
    short = clean(shorts[0]) if shorts else None
    if short:
        return short
    event = work.get("event")
    acronym = clean(event.get("acronym")) if isinstance(event, dict) else None
    if acronym:
        stripped = _VENUE_YEAR_SUFFIX.sub("", acronym).strip()
        return stripped or acronym
    venue = _venue_from_work(work)
    if venue:
        match = _CONTAINER_TITLE_ACRONYM.search(venue)
        if match:
            return match.group(1)
    return None


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


def _title_from_work(work: dict) -> str | None:
    """The work's full printed title: ``title[0]``, plus ``subtitle[0]`` when
    Crossref split it across both fields.

    Many publisher records (VLDB/ACM especially) put only the short name in
    ``title`` and the rest in ``subtitle`` — TranAD's DOI returns
    ``title=["TranAD"]`` with the descriptive half in ``subtitle``. Taking
    ``title[0]`` alone stored a 6-character title, which is neither what the
    paper prints nor long enough for the ToC's paper-title suppression to match
    the title heading (live-smoke finding). Joined with ``": "``, Crossref's own
    convention, and skipped when the title already ends with the subtitle so a
    record that repeats it is not doubled.
    """
    titles = work.get("title") or []
    title = clean(titles[0]) if titles else None
    if title is None:
        return None
    subtitles = work.get("subtitle") or []
    subtitle = clean(subtitles[0]) if subtitles else None
    if subtitle is None or title.lower().endswith(subtitle.lower()):
        return title
    return f"{title.rstrip(':')}: {subtitle}"


def _meta_from_work(work: dict, doi: str | None) -> ExtractedMeta | None:
    """Project a Crossref ``message`` work into ``ExtractedMeta`` (``None`` if
    it carries no title — an empty result is a skip, not a correction).

    ``doi`` stays the passed-in, extraction-sourced value (scope guard, Story
    7.9): this does NOT read ``work.get("DOI")``.
    """
    title = _title_from_work(work)
    if title is None:
        return None
    return ExtractedMeta(
        title=title,
        authors=_authors_from_crossref(work),
        doi=doi,
        venue=_venue_from_work(work),
        venue_short=_short_venue_from_work(work),
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
