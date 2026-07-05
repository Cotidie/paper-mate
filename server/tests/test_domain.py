"""Pure domain layer tests (AD-L2, Story 6.5).

``extract`` is exercised against PDFs built in-code with PyMuPDF (no committed
binaries); ``enrich`` is exercised with a fake ``httpx.Client`` (patched on the
``crossref`` module) and with an injected fake enricher — these tests NEVER hit
the real network.
"""

import pymupdf
import pytest

from app.domain import crossref
from app.domain.crossref import CrossrefEnricher
from app.domain.enrich import enrich
from app.domain.extract import extract
from app.models import ExtractedMeta

# --- PDF builders (in-code, deterministic) ---------------------------------


def _pdf(
    *,
    title: str | None = None,
    author: str | None = None,
    xmp: str | None = None,
    body: str | None = None,
    title_font: tuple[str, float] | None = None,
) -> bytes:
    """Build a one-page PDF with optional /Info, XMP, and page text.

    ``title_font=(text, size)`` inserts a large title span near the top;
    ``body`` inserts smaller text lower down (used for the font heuristic and
    for a DOI in page text).
    """
    doc = pymupdf.open()
    page = doc.new_page()
    if title_font is not None:
        text, size = title_font
        page.insert_text((72, 72), text, fontsize=size)
    if body is not None:
        page.insert_text((72, 400), body, fontsize=10)
    meta = {}
    if title is not None:
        meta["title"] = title
    if author is not None:
        meta["author"] = author
    if meta:
        doc.set_metadata(meta)
    if xmp is not None:
        doc.set_xml_metadata(xmp)
    data = doc.tobytes()
    doc.close()
    return data


# --- extract ----------------------------------------------------------------


def test_extract_reads_info_title_and_author():
    meta = extract(_pdf(title="Info Title", author="Ada Lovelace"))
    assert meta.title == "Info Title"
    assert meta.authors == ["Ada Lovelace"]


def test_extract_treats_blank_info_as_absent():
    meta = extract(_pdf(title="   ", author=""))
    assert meta.title is None
    assert meta.authors == []


def test_extract_falls_back_to_xmp():
    xmp = (
        '<?xml version="1.0"?><x:xmpmeta xmlns:x="adobe:ns:meta/">'
        '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
        '<rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/">'
        "<dc:title><rdf:Alt><rdf:li>XMP Title</rdf:li></rdf:Alt></dc:title>"
        "<dc:creator><rdf:Seq><rdf:li>Grace Hopper</rdf:li>"
        "<rdf:li>Alan Turing</rdf:li></rdf:Seq></dc:creator>"
        "</rdf:Description></rdf:RDF></x:xmpmeta>"
    )
    meta = extract(_pdf(xmp=xmp))
    assert meta.title == "XMP Title"
    assert meta.authors == ["Grace Hopper", "Alan Turing"]


def test_extract_font_heuristic_title_when_info_empty():
    # No /Info title; a big top-of-page span should be picked as the title over
    # the smaller body text below it.
    meta = extract(_pdf(title_font=("The Big Title", 28.0), body="small body text here"))
    assert meta.title == "The Big Title"


def test_extract_ignores_rotated_margin_stamp():
    # An arXiv-style vertical left-margin stamp rendered LARGER than the title
    # must not be picked as the title (rotated text is never a title). Reproduces
    # the real arXiv:1903.03295 failure where a 20pt vertical stamp beat the
    # 14pt horizontal title.
    d = pymupdf.open()
    p = d.new_page()
    p.insert_text((72, 100), "The Real Horizontal Title", fontsize=14)  # title
    p.insert_text((20, 400), "arXiv:1234.56789v1 [cs.CV] 1 Jan 2026", fontsize=22, rotate=90)
    data = d.tobytes()
    d.close()
    assert extract(data).title == "The Real Horizontal Title"


def test_extract_font_heuristic_ignores_larger_lower_banner():
    # A legitimate top title (24pt) with an even-larger lower-page banner (40pt):
    # the heuristic must pick the top title, not return None because the global
    # max font sits below the top-of-page cutoff (Codex review, Med).
    d = pymupdf.open()
    p = d.new_page()
    p.insert_text((72, 72), "Real Top Title", fontsize=24)  # top of page
    p.insert_text((72, 700), "HUGE FOOTER BANNER", fontsize=40)  # bottom, bigger
    data = d.tobytes()
    d.close()
    assert extract(data).title == "Real Top Title"


def test_extract_pulls_doi_from_page_text():
    meta = extract(_pdf(title="Has DOI", body="Available at https://doi.org/10.1234/abcd.5678."))
    # Trailing sentence period is stripped from the greedy suffix.
    assert meta.doi == "10.1234/abcd.5678"


def test_extract_doi_from_info_subject():
    doc = pymupdf.open()
    doc.new_page()
    doc.set_metadata({"title": "T", "subject": "doi:10.5555/xyz123"})
    data = doc.tobytes()
    doc.close()
    assert extract(data).doi == "10.5555/xyz123"


def test_extract_empty_on_blank_document():
    meta = extract(_pdf())  # no metadata, no text
    assert meta == ExtractedMeta()


def test_extract_is_total_on_garbage_bytes():
    # A non-PDF must yield an empty result, never raise (AC-2 totality).
    assert extract(b"this is definitely not a pdf") == ExtractedMeta()


# --- enrich (fake httpx.Client, never the network) --------------------------


class _FakeResponse:
    def __init__(self, status_code: int, payload: dict):
        self.status_code = status_code
        self._payload = payload

    def json(self) -> dict:
        return self._payload


class _FakeClient:
    """Records requested URLs and replays a routing ``handler(url, params)``."""

    calls: list[tuple[str, dict | None]] = []

    def __init__(self, handler):
        self._handler = handler

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def get(self, url: str, params: dict | None = None) -> _FakeResponse:
        _FakeClient.calls.append((url, params))
        return self._handler(url, params)


@pytest.fixture
def fake_httpx(monkeypatch):
    """Install a fake ``httpx.Client`` on the ``crossref`` module (where the
    enricher constructs it); return a setter that takes a
    ``handler(url, params) -> _FakeResponse`` (or raises)."""
    _FakeClient.calls = []

    def install(handler):
        monkeypatch.setattr(
            crossref.httpx, "Client", lambda *a, **k: _FakeClient(handler)
        )

    return install


def test_enrich_skips_without_doi_or_title_and_makes_no_call(fake_httpx):
    def handler(url, params):  # pragma: no cover - must never run
        raise AssertionError("enrich must not call the network with nothing to query")

    fake_httpx(handler)
    assert enrich(ExtractedMeta()) == "skipped"
    assert _FakeClient.calls == []


def test_enrich_treats_blank_title_and_doi_as_nothing_to_query(fake_httpx):
    # A whitespace-only title/doi must not fire a blank Crossref query
    # (Codex review, Low): normalized to absent, so zero HTTP calls.
    def handler(url, params):  # pragma: no cover - must never run
        raise AssertionError("enrich must not query with whitespace-only metadata")

    fake_httpx(handler)
    assert enrich(ExtractedMeta(title="   ", doi="  ")) == "skipped"
    assert _FakeClient.calls == []


def test_enrich_doi_first_success(fake_httpx):
    def handler(url, params):
        assert "/works/10.1234/abcd" in url
        return _FakeResponse(
            200,
            {
                "message": {
                    "title": ["Corrected Title"],
                    "author": [
                        {"given": "Ada", "family": "Lovelace"},
                        {"given": "Alan", "family": "Turing"},
                    ],
                }
            },
        )

    fake_httpx(handler)
    result = enrich(ExtractedMeta(title="rough title", doi="10.1234/abcd"))
    assert result != "skipped"
    assert result.title == "Corrected Title"
    assert result.authors == ["Ada Lovelace", "Alan Turing"]
    assert result.doi == "10.1234/abcd"


def test_enrich_title_fallback_success(fake_httpx):
    def handler(url, params):
        assert url.endswith("/works")
        assert params["query.bibliographic"] == "Attention Is All You Need"
        return _FakeResponse(
            200,
            {"message": {"items": [{"title": ["Attention Is All You Need"], "author": []}]}},
        )

    fake_httpx(handler)
    result = enrich(ExtractedMeta(title="Attention Is All You Need"))
    assert result != "skipped"
    assert result.title == "Attention Is All You Need"
    assert result.authors == []


def test_enrich_offline_returns_skipped(fake_httpx):
    def handler(url, params):
        raise crossref.httpx.ConnectError("offline")

    fake_httpx(handler)
    assert enrich(ExtractedMeta(title="Some Paper")) == "skipped"


def test_enrich_non_200_returns_skipped(fake_httpx):
    def handler(url, params):
        return _FakeResponse(404, {})

    fake_httpx(handler)
    assert enrich(ExtractedMeta(doi="10.9999/missing")) == "skipped"


def test_enrich_empty_result_returns_skipped(fake_httpx):
    def handler(url, params):
        return _FakeResponse(200, {"message": {"items": []}})

    fake_httpx(handler)
    assert enrich(ExtractedMeta(title="No Match Here")) == "skipped"


def test_enrich_rejects_implausible_title_match(fake_httpx):
    """Crossref `rows=1` always returns a top result; an unrelated one (e.g. a
    keyword-spam paper) must be rejected so the local title is kept, not
    'corrected' to a different work."""
    def handler(url, params):
        return _FakeResponse(
            200,
            {"message": {"items": [{"title": ["Totally Unrelated Paper About Frogs"], "author": []}]}},
        )

    fake_httpx(handler)
    assert enrich(ExtractedMeta(title="Microsoft COCO Common Objects in Context")) == "skipped"


def test_enrich_accepts_plausible_title_match(fake_httpx):
    def handler(url, params):
        return _FakeResponse(
            200,
            {
                "message": {
                    "items": [
                        {
                            "title": ["Microsoft COCO: Common Objects in Context"],
                            "author": [{"given": "Tsung-Yi", "family": "Lin"}],
                        }
                    ]
                }
            },
        )

    fake_httpx(handler)
    result = enrich(ExtractedMeta(title="Microsoft COCO Common Objects in Context"))
    assert result != "skipped"
    assert result.title == "Microsoft COCO: Common Objects in Context"
    assert result.authors == ["Tsung-Yi Lin"]


def test_enrich_falls_back_to_title_when_doi_misses(fake_httpx):
    def handler(url, params):
        if "/works/" in url:  # DOI lookup misses
            return _FakeResponse(404, {})
        return _FakeResponse(
            200, {"message": {"items": [{"title": ["Found By Title"], "author": []}]}}
        )

    fake_httpx(handler)
    result = enrich(ExtractedMeta(title="Found By Title", doi="10.0000/miss"))
    assert result != "skipped"
    assert result.title == "Found By Title"
    # Both the DOI lookup and the title fallback were attempted.
    assert len(_FakeClient.calls) == 2


def test_domain_modules_are_pure():
    """AD-L2: NO domain module imports storage or filesystem access.

    Parse the actual imports (not the docstring) of every ``app/domain/*.py``
    module so a prose mention of ``app.storage`` in a module header can't trip
    the guard — and so the split into extract/enrich/crossref is covered, not
    just one file. (``crossref`` legitimately imports ``httpx``: enrichment is
    the one allowed network hop; the filesystem/storage ban is what we assert.)
    """
    import ast
    import pathlib

    from app import domain

    forbidden = {"os", "pathlib", "app.storage"}
    domain_dir = pathlib.Path(domain.__file__).parent
    leaks: dict[str, set[str]] = {}
    for module_file in sorted(domain_dir.glob("*.py")):
        tree = ast.parse(module_file.read_text())
        imported: set[str] = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported.update(alias.name for alias in node.names)
            elif isinstance(node, ast.ImportFrom):
                imported.add(node.module or "")
        module_leaks = {
            name for name in imported if name in forbidden or name.startswith("app.storage")
        }
        if module_leaks:
            leaks[module_file.name] = module_leaks
    assert not leaks, f"domain must stay pure: found imports {leaks}"


def test_enrich_delegates_to_injected_enricher():
    """AD-L2 port: ``enrich`` uses an injected ``Enricher`` (no HTTP, no default
    CrossrefEnricher) — the seam that makes enrichment swappable/testable."""

    class _FakeEnricher:
        def __init__(self):
            self.seen: list[ExtractedMeta] = []

        def enrich(self, meta: ExtractedMeta):
            self.seen.append(meta)
            return ExtractedMeta(title="Injected", authors=["Fake Author"])

    fake = _FakeEnricher()
    meta = ExtractedMeta(title="local", doi="10.1/x")
    result = enrich(meta, enricher=fake)

    assert result != "skipped"
    assert result.title == "Injected"
    assert fake.seen == [meta]  # the injected port, not the default, was called


def test_default_enricher_is_a_crossref_enricher():
    """The production default behind the ``enrich`` facade is CrossrefEnricher."""
    from app.domain.enrich import _default_enricher

    assert isinstance(_default_enricher, CrossrefEnricher)
