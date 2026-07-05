"""Pure metadata extraction + enrichment (AD-L2, Story 6.5).

The first tenant of the backend **domain layer**: bytes/data in, data out. This
module NEVER touches the filesystem and NEVER imports ``app.storage`` — the
route composes it with storage, which is the only writer. ``enrich`` is the
only code in the whole backend that makes a network call.

``extract`` is **total** (any PyMuPDF failure yields an empty ``ExtractedMeta``,
never a raise) and the seam is **GROBID-swappable** (its signature is
``bytes -> ExtractedMeta`` with no side effects). ``enrich`` **never raises**:
offline, on any HTTP failure, or with nothing to query it degrades to the
literal ``"skipped"``.
"""

import re
from typing import Literal
from urllib.parse import quote

import httpx
import pymupdf

from app.models import ExtractedMeta
from app.version import get_version

#: A DOI: ``10.<registrant>/<suffix>`` (Crossref's own recommended pattern).
_DOI_RE = re.compile(r"10\.\d{4,9}/[-._;()/:A-Za-z0-9]+", re.IGNORECASE)

#: Trailing punctuation the greedy DOI suffix charset over-captures from prose.
_DOI_TRAILING = ".,;)"

#: Crossref REST base + a short, polite timeout (single-user, best-effort).
_CROSSREF = "https://api.crossref.org"
_TIMEOUT = 5.0

#: A title is only trusted from the font heuristic if it sits in the top of the
#: page (titles do; a large mid-page section header does not).
_TITLE_TOP_FRACTION = 0.5

#: Minimum token-set Jaccard similarity for a Crossref *title-query* hit to be
#: trusted. Crossref's `rows=1` always returns its best match even when the
#: query has none, so a bare `items[0]` accepts keyword-spam papers that merely
#: mention the query terms. Requiring real overlap keeps the local title
#: instead of "correcting" it to an unrelated work. (The DOI path is exact and
#: needs no such guard.)
_TITLE_MATCH_MIN_JACCARD = 0.5


def _clean(value: object) -> str | None:
    """Normalize a metadata value: blank/whitespace-only is *absent*, not ``""``."""
    if not isinstance(value, str):
        return None
    stripped = value.strip()
    return stripped or None


def _rdf_items(block: str) -> list[str]:
    """Pull ``<rdf:li>`` text out of an XMP ``dc:*`` block (Alt/Seq/Bag)."""
    return [
        cleaned
        for raw in re.findall(r"<rdf:li[^>]*>(.*?)</rdf:li>", block, re.DOTALL)
        if (cleaned := _clean(raw))
    ]


def _parse_xmp(xmp: str) -> tuple[str | None, list[str]]:
    """Best-effort ``(title, authors)`` from XMP ``dc:title`` / ``dc:creator``.

    XMP namespaces and whitespace vary wildly across producers, so this is
    lenient regex parsing, not strict RDF: it reads the first ``dc:title``
    entry and every ``dc:creator`` entry.
    """
    title: str | None = None
    title_match = re.search(r"<dc:title>(.*?)</dc:title>", xmp, re.DOTALL)
    if title_match:
        items = _rdf_items(title_match.group(1))
        title = items[0] if items else _clean(title_match.group(1))
    authors: list[str] = []
    creator_match = re.search(r"<dc:creator>(.*?)</dc:creator>", xmp, re.DOTALL)
    if creator_match:
        authors = _rdf_items(creator_match.group(1))
    return title, authors


def _title_from_fonts(page: pymupdf.Page) -> str | None:
    """Rung 2: the largest-font text near the top of page 0 ≈ the title.

    Title-only and best-effort (authors come from ``/Info``/XMP + Crossref). We
    keep only the max-size spans that sit in the top of the page, joined in
    reading order, so a large lower-down section heading can't masquerade as
    the title.
    """
    try:
        blocks = page.get_text("dict")["blocks"]
    except Exception:
        return None
    page_height = page.rect.height or 1.0
    cutoff = page_height * _TITLE_TOP_FRACTION
    spans: list[tuple[float, float, str]] = []  # (size, y_top, text)
    for block in blocks:
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                text = _clean(span.get("text"))
                if text is None:
                    continue
                y_top = span.get("bbox", (0, 0, 0, 0))[1]
                spans.append((round(span.get("size", 0.0), 1), y_top, text))
    # Restrict to the top of the page FIRST, then take the largest font among
    # those candidates. (Taking the global max first would miss a legitimate
    # top-of-page title whenever a lower-page banner/heading uses a bigger font.)
    top_spans = [(size, y, text) for size, y, text in spans if y <= cutoff]
    if not top_spans:
        return None
    max_size = max(size for size, _, _ in top_spans)
    title_spans = sorted(
        ((y, text) for size, y, text in top_spans if size == max_size),
        key=lambda item: item[0],
    )
    joined = " ".join(text for _, text in title_spans)
    return re.sub(r"\s+", " ", joined).strip() or None


def _find_doi(*texts: str | None) -> str | None:
    """First DOI found across the given text sources, trailing prose stripped."""
    for text in texts:
        if not text:
            continue
        match = _DOI_RE.search(text)
        if match:
            return match.group(0).rstrip(_DOI_TRAILING)
    return None


def extract(pdf_bytes: bytes) -> ExtractedMeta:
    """Resolve Title + Authors + DOI from PDF bytes, best-effort (LFR-8, AD-L2).

    Rung 1 = embedded ``/Info`` (``doc.metadata``) + XMP (``dc:title`` /
    ``dc:creator``); rung 2 = a font-size heuristic on page 0 for the title
    when rung 1 gives none. A DOI is pulled from ``/Info`` + XMP + first-page
    text for ``enrich`` to key on. **Total**: any PyMuPDF failure on a
    pathological PDF returns an empty ``ExtractedMeta()`` — it never raises.
    """
    try:
        doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    except Exception:
        return ExtractedMeta()
    try:
        info = doc.metadata or {}
        title = _clean(info.get("title"))
        author = _clean(info.get("author"))
        authors = [author] if author else []

        try:
            xmp = doc.get_xml_metadata() or ""
        except Exception:
            xmp = ""
        if xmp:
            xmp_title, xmp_authors = _parse_xmp(xmp)
            title = title or xmp_title
            authors = authors or xmp_authors

        page0_text = ""
        if doc.page_count:
            page = doc[0]
            if title is None:
                title = _title_from_fonts(page)
            try:
                page0_text = page.get_text() or ""
            except Exception:
                page0_text = ""

        doi = _find_doi(info.get("title"), info.get("subject"), xmp, page0_text)
        return ExtractedMeta(title=title, authors=authors, doi=doi)
    except Exception:
        return ExtractedMeta()
    finally:
        doc.close()


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


def _meta_from_work(work: dict, doi: str | None) -> ExtractedMeta | None:
    """Project a Crossref ``message`` work into ``ExtractedMeta`` (``None`` if
    it carries no title — an empty result is a skip, not a correction)."""
    titles = work.get("title") or []
    title = _clean(titles[0]) if titles else None
    if title is None:
        return None
    return ExtractedMeta(title=title, authors=_authors_from_crossref(work), doi=doi)


def _titles_match(query_title: str, result_title: str) -> bool:
    """Token-set Jaccard >= threshold — a plausibility gate for title-query
    hits so an unrelated top result can't overwrite a correct local title."""
    query_tokens = set(re.findall(r"[a-z0-9]+", query_title.lower()))
    result_tokens = set(re.findall(r"[a-z0-9]+", result_title.lower()))
    if not query_tokens or not result_tokens:
        return False
    jaccard = len(query_tokens & result_tokens) / len(query_tokens | result_tokens)
    return jaccard >= _TITLE_MATCH_MIN_JACCARD


def enrich(meta: ExtractedMeta) -> ExtractedMeta | Literal["skipped"]:
    """Correct ``meta`` against Crossref, DOI-first, or degrade to ``"skipped"``.

    DOI-first (``/works/{doi}``) then a bibliographic title fallback
    (``/works?query.bibliographic=...&rows=1``). Offline, on any timeout /
    non-200 / no-match, OR when there is neither a DOI nor a title to query, it
    returns the literal ``"skipped"``. It NEVER raises and NEVER blocks the add
    (LFR-9, NFR-1), and makes no more than the two bounded Crossref calls.
    """
    # Normalize first: a whitespace-only title/doi is nothing to query, and a
    # blank bibliographic query would otherwise hit Crossref for no reason.
    doi = _clean(meta.doi)
    title = _clean(meta.title)
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
