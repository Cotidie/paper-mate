"""Pure PyMuPDF metadata extraction (AD-L2, Story 6.5).

``extract`` is **total** (any PyMuPDF failure yields an empty ``ExtractedMeta``,
never a raise) and the seam is **GROBID-swappable** (its signature is
``bytes -> ExtractedMeta`` with no side effects). This module NEVER touches the
filesystem, NEVER imports ``app.storage``, and NEVER makes a network call — the
Crossref hop lives in ``enrich``/``crossref``.
"""

import re

import pymupdf

from app.domain._text import clean
from app.models import ExtractedMeta

#: A DOI: ``10.<registrant>/<suffix>`` (Crossref's own recommended pattern).
_DOI_RE = re.compile(r"10\.\d{4,9}/[-._;()/:A-Za-z0-9]+", re.IGNORECASE)

#: Trailing punctuation the greedy DOI suffix charset over-captures from prose.
_DOI_TRAILING = ".,;)"

#: The common new-style arXiv id stamp PDFs carry, e.g. the left-margin
#: "arXiv:2103.12345v2 [cs.CV] 1 Jan 2026" footer (fix request, LFR-32 follow-up):
#: routes a preprint Crossref has no record of to the arXiv venue/year fallback.
#: Old-style ids (``subject-class/YYMMNNN``) are out of scope.
_ARXIV_ID_RE = re.compile(r"arxiv:\s*(\d{4}\.\d{4,5})(?:v\d+)?", re.IGNORECASE)

#: A title is only trusted from the font heuristic if it sits in the top of the
#: page (titles do; a large mid-page section header does not).
_TITLE_TOP_FRACTION = 0.5


def _rdf_items(block: str) -> list[str]:
    """Pull ``<rdf:li>`` text out of an XMP ``dc:*`` block (Alt/Seq/Bag)."""
    return [
        cleaned
        for raw in re.findall(r"<rdf:li[^>]*>(.*?)</rdf:li>", block, re.DOTALL)
        if (cleaned := clean(raw))
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
        title = items[0] if items else clean(title_match.group(1))
    authors: list[str] = []
    creator_match = re.search(r"<dc:creator>(.*?)</dc:creator>", xmp, re.DOTALL)
    if creator_match:
        authors = _rdf_items(creator_match.group(1))
    return title, authors


def _is_horizontal(direction: object) -> bool:
    """True for a left-to-right text line (``dir`` ≈ ``(1, 0)``).

    PyMuPDF gives each line a unit writing-direction vector. Horizontal body
    text is ``(1, 0)``; a vertical margin stamp is ``(0, -1)`` / ``(0, 1)``.
    A missing/degenerate dir is treated as horizontal (the common case).
    """
    if not isinstance(direction, (tuple, list)) or len(direction) != 2:
        return True
    dx, dy = direction
    return dx > 0.9 and abs(dy) < 0.1


def _title_from_fonts(page: pymupdf.Page) -> str | None:
    """Rung 2: the largest-font *horizontal* text near the top of page 0 ≈ the title.

    Title-only and best-effort (authors come from ``/Info``/XMP + Crossref). We
    keep only the max-size spans that sit in the top of the page, joined in
    reading order, so a large lower-down section heading can't masquerade as
    the title. **Only horizontal lines count** (line ``dir`` ≈ ``(1, 0)``):
    rotated margin furniture (the arXiv left-margin ``arXiv:… [cs.CV] …`` stamp,
    journal side-watermarks) is often rendered LARGER than the title but is never
    the title — including it makes the stamp win the max-size pick.
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
            if not _is_horizontal(line.get("dir")):
                continue  # skip rotated margin stamps / watermarks
            for span in line.get("spans", []):
                text = clean(span.get("text"))
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


def _find_arxiv_id(*texts: str | None) -> str | None:
    """First new-style arXiv id found across the given text sources."""
    for text in texts:
        if not text:
            continue
        match = _ARXIV_ID_RE.search(text)
        if match:
            return match.group(1)
    return None


def extract(pdf_bytes: bytes) -> ExtractedMeta:
    """Resolve Title + Authors + DOI from PDF bytes, best-effort (LFR-8, AD-L2).

    Rung 1 = embedded ``/Info`` (``doc.metadata``) + XMP (``dc:title`` /
    ``dc:creator``); rung 2 = a font-size heuristic on page 0 for the title
    when rung 1 gives none. A DOI, and separately an arXiv id (fix request),
    are each pulled from ``/Info`` + XMP + first-page text for ``enrich`` to
    key on. **Total**: any PyMuPDF failure on a pathological PDF returns an
    empty ``ExtractedMeta()`` — it never raises.
    """
    try:
        doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    except Exception:
        return ExtractedMeta()
    try:
        info = doc.metadata or {}
        title = clean(info.get("title"))
        author = clean(info.get("author"))
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
        arxiv_id = _find_arxiv_id(info.get("title"), info.get("subject"), xmp, page0_text)
        return ExtractedMeta(title=title, authors=authors, doi=doi, arxiv_id=arxiv_id)
    except Exception:
        return ExtractedMeta()
    finally:
        doc.close()
