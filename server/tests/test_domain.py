"""Pure domain layer tests (AD-L2, Story 6.5).

``extract`` is exercised against PDFs built in-code with PyMuPDF (no committed
binaries); ``enrich`` is exercised with a fake ``httpx.Client`` (patched on
``crossref`` and ``semantic_scholar``), a fake arXiv client (patched on
``arxiv_enrich``), and with injected fake enrichers — these tests NEVER hit
the real network.
"""

import datetime

import pymupdf
import pytest

from app.domain import arxiv_enrich, crossref, semantic_scholar
from app.domain.arxiv_enrich import ArxivEnricher
from app.domain.crossref import CrossrefEnricher
from app.domain.enrich import enrich
from app.domain.extract import extract
from app.domain.semantic_scholar import SemanticScholarEnricher
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


def test_extract_finds_arxiv_id_in_page_text():
    meta = extract(_pdf(title="Has ArXiv Stamp", body="arXiv:2103.12345v2 [cs.CV] 1 Jan 2026"))
    assert meta.arxiv_id == "2103.12345"


def test_extract_arxiv_id_none_without_a_stamp():
    meta = extract(_pdf(title="No ArXiv Stamp"))
    assert meta.arxiv_id is None


def test_extract_empty_on_blank_document():
    meta = extract(_pdf())  # no metadata, no text
    assert meta == ExtractedMeta()


def test_extract_is_total_on_garbage_bytes():
    # A non-PDF must yield an empty result, never raise (AC-2 totality).
    assert extract(b"this is definitely not a pdf") == ExtractedMeta()


# --- enrich (fake httpx.Client, never the network) --------------------------


class _FakeResponse:
    """A response stub: ``.json()`` for Crossref's JSON payloads, ``.text``
    for arXiv's raw Atom XML string payloads."""

    def __init__(self, status_code: int, payload: dict | str):
        self.status_code = status_code
        self._payload = payload

    def json(self) -> dict:
        return self._payload

    @property
    def text(self) -> str:
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


@pytest.fixture
def fake_semantic_scholar_httpx(monkeypatch):
    """Mirrors ``fake_httpx`` but installs on ``semantic_scholar`` (a separate
    module, a separate patch target, same ``_FakeClient``/``_FakeResponse``
    shape)."""
    _FakeClient.calls = []

    def install(handler):
        monkeypatch.setattr(
            semantic_scholar.httpx, "Client", lambda *a, **k: _FakeClient(handler)
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
                    "container-title": ["Journal of Foo"],
                    "issued": {"date-parts": [[2017, 6, 12]]},
                }
            },
        )

    fake_httpx(handler)
    result = enrich(ExtractedMeta(title="rough title", doi="10.1234/abcd"))
    assert result != "skipped"
    assert result.title == "Corrected Title"
    assert result.authors == ["Ada Lovelace", "Alan Turing"]
    assert result.doi == "10.1234/abcd"
    assert result.venue == "Journal of Foo"
    assert result.year == 2017


def test_enrich_title_fallback_success(fake_httpx):
    def handler(url, params):
        assert url.endswith("/works")
        assert params["query.bibliographic"] == "Attention Is All You Need"
        return _FakeResponse(
            200,
            {
                "message": {
                    "items": [
                        {
                            "title": ["Attention Is All You Need"],
                            "author": [],
                            "container-title": ["NeurIPS"],
                            "issued": {"date-parts": [[2017]]},
                            "DOI": "10.9999/should-be-ignored",
                        }
                    ]
                }
            },
        )

    fake_httpx(handler)
    result = enrich(ExtractedMeta(title="Attention Is All You Need"))
    assert result != "skipped"
    assert result.title == "Attention Is All You Need"
    assert result.authors == []
    assert result.venue == "NeurIPS"
    assert result.year == 2017
    # Title-fallback: doi stays None (the passed-in arg), NOT work["DOI"]
    # (scope guard, Story 7.9) -- the fake work carries a DOI to prove it's
    # actually ignored, not just absent.
    assert result.doi is None


def test_enrich_joins_crossref_subtitle_into_title(fake_httpx):
    """Crossref splits many paper titles across `title` + `subtitle` (VLDB/ACM
    records especially): TranAD's DOI returns title `["TranAD"]` with the rest
    of the printed title in `subtitle`. Taking `title[0]` alone stored a
    6-character title, which then failed the ToC's paper-title suppression and
    revived the title as a ToC row (live-smoke finding, TranAD)."""

    def handler(url, params):
        return _FakeResponse(
            200,
            {
                "message": {
                    "title": ["TranAD"],
                    "subtitle": [
                        "deep transformer networks for anomaly detection in "
                        "multivariate time series data"
                    ],
                    "author": [],
                }
            },
        )

    fake_httpx(handler)
    result = enrich(ExtractedMeta(title="rough", doi="10.14778/3514061.3514067"))
    assert result != "skipped"
    assert result.title == (
        "TranAD: deep transformer networks for anomaly detection in "
        "multivariate time series data"
    )


def test_enrich_ignores_blank_and_duplicate_subtitle(fake_httpx):
    """A blank subtitle adds nothing, and a subtitle the title already ends
    with (some records repeat it) must not be appended twice."""

    def handler(url, params):
        return _FakeResponse(
            200,
            {
                "message": {
                    "title": ["Full Title: A Subtitle"],
                    "subtitle": ["  a subtitle  "],
                    "author": [],
                }
            },
        )

    fake_httpx(handler)
    result = enrich(ExtractedMeta(doi="10.1234/dup"))
    assert result != "skipped"
    assert result.title == "Full Title: A Subtitle"


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
    # `crossref.httpx` and `semantic_scholar.httpx` are the same shared module
    # object, so `fake_httpx`'s patch also covers the default
    # `SemanticScholarEnricher`'s client; inject a no-network stub so this
    # test's call-count assertion stays about the Crossref calls only.
    result = enrich(
        ExtractedMeta(title="Found By Title", doi="10.0000/miss"),
        venue_short_fetcher=_RaisingVenueShortFetcher(),
    )
    assert result != "skipped"
    assert result.title == "Found By Title"
    # Both the DOI lookup and the title fallback were attempted.
    assert len(_FakeClient.calls) == 2


# --- _venue_from_work / _year_from_work (Story 7.9) -------------------------


def test_venue_from_work_takes_first_container_title():
    assert crossref._venue_from_work({"container-title": ["Journal of Foo", "Alt"]}) == "Journal of Foo"


def test_venue_from_work_none_when_absent():
    assert crossref._venue_from_work({}) is None
    assert crossref._venue_from_work({"container-title": []}) is None


def test_year_from_work_prefers_issued_over_published_variants():
    work = {
        "issued": {"date-parts": [[2020, 1, 1]]},
        "published-print": {"date-parts": [[2019]]},
    }
    assert crossref._year_from_work(work) == 2020


def test_year_from_work_falls_back_through_published_keys():
    assert crossref._year_from_work({"published-print": {"date-parts": [[2019, 3]]}}) == 2019
    assert crossref._year_from_work({"published-online": {"date-parts": [[2018]]}}) == 2018
    assert crossref._year_from_work({"published": {"date-parts": [[2016]]}}) == 2016


def test_year_from_work_none_on_malformed_date_parts():
    assert crossref._year_from_work({"issued": {"date-parts": [[]]}}) is None
    assert crossref._year_from_work({"issued": {"date-parts": [[None]]}}) is None
    assert crossref._year_from_work({"issued": {}}) is None
    assert crossref._year_from_work({}) is None
    # A malformed external payload where the date key isn't even a dict, or
    # date-parts isn't a list-of-lists, must degrade to None, never raise.
    assert crossref._year_from_work({"issued": "2020"}) is None
    assert crossref._year_from_work({"issued": {"date-parts": "2020"}}) is None
    assert crossref._year_from_work({"issued": {"date-parts": [2020]}}) is None


def test_meta_from_work_no_container_title_yields_venue_none():
    meta = crossref._meta_from_work({"title": ["A Paper"]}, doi=None)
    assert meta is not None
    assert meta.venue is None
    assert meta.year is None


# --- _short_venue_from_work (Story 8.5) --------------------------------------


def test_short_venue_from_work_prefers_short_container_title():
    work = {"short-container-title": ["CHI"], "event": {"acronym": "CHI '25"}}
    assert crossref._short_venue_from_work(work) == "CHI"


def test_short_venue_from_work_falls_back_to_year_stripped_acronym():
    # Verified live: DOI 10.1145/3706598.3713941 returns an empty
    # short-container-title but event.acronym == "CHI '25".
    assert crossref._short_venue_from_work({"event": {"acronym": "CHI '25"}}) == "CHI"
    assert crossref._short_venue_from_work({"event": {"acronym": "WWW 2024"}}) == "WWW"


def test_short_venue_from_work_none_when_neither_exists():
    assert crossref._short_venue_from_work({}) is None
    assert crossref._short_venue_from_work({"short-container-title": [], "event": {}}) is None


def test_short_venue_from_work_acronym_without_year_passes_through_unchanged():
    assert crossref._short_venue_from_work({"event": {"acronym": "NeurIPS"}}) == "NeurIPS"


def test_short_venue_from_work_falls_back_to_container_title_parenthetical_acronym():
    # Verified live: DOI 10.1109/iccv.2017.226's `event` has no `acronym`
    # key at all (only name/location/start/end), but `container-title` ends
    # in "(ICCV)".
    work = {
        "container-title": ["2017 IEEE International Conference on Computer Vision (ICCV)"],
        "event": {"name": "2017 IEEE International Conference on Computer Vision (ICCV)"},
    }
    assert crossref._short_venue_from_work(work) == "ICCV"


def test_short_venue_from_work_container_title_acronym_rejects_non_acronym_parentheticals():
    # A bare year, or a mixed-case/spaced parenthetical, is not a clean
    # acronym - degrades to None rather than a wrong guess.
    assert crossref._short_venue_from_work({"container-title": ["Some Proceedings (2020)"]}) is None
    assert crossref._short_venue_from_work({"container-title": ["Some Proceedings (Volume 1)"]}) is None
    assert crossref._short_venue_from_work({"container-title": ["Some Proceedings (SAC '19)"]}) is None


# --- arxiv_enrich (fix request): venue/year fallback for a Crossref-less preprint --


class _FakeArxivClient:
    """Stands in for ``arxiv.Client``: ``.results(search)`` replays a fixed
    list of ``arxiv.Result``s, or raises to simulate a network failure."""

    def __init__(self, results: list | None = None, error: Exception | None = None):
        self._results = results or []
        self._error = error

    def results(self, search):
        if self._error:
            raise self._error
        return iter(self._results)


def _fake_result(
    *, journal_ref: str = "", year: int = 2019, authors: list[str] | None = None
) -> arxiv_enrich.arxiv.Result:
    return arxiv_enrich.arxiv.Result(
        entry_id="http://arxiv.org/abs/2103.12345",
        journal_ref=journal_ref,
        published=datetime.datetime(year, 3, 8, tzinfo=datetime.timezone.utc),
        authors=[arxiv_enrich.arxiv.Result.Author(name) for name in (authors or [])],
    )


@pytest.fixture
def fake_arxiv_client(monkeypatch):
    """Install a fake arXiv client on ``arxiv_enrich._client``, mirroring
    ``fake_httpx`` above (a separate module, a separate patch target)."""

    def install(results: list | None = None, error: Exception | None = None):
        monkeypatch.setattr(arxiv_enrich, "_client", _FakeArxivClient(results, error))

    return install


def test_arxiv_enricher_fetch_defaults_to_arxiv_venue_without_a_journal_ref(fake_arxiv_client):
    fake_arxiv_client(results=[_fake_result(year=2019)])
    assert ArxivEnricher().fetch("2103.12345") == ("arXiv", 2019, [])


def test_arxiv_enricher_fetch_uses_journal_ref_when_present(fake_arxiv_client):
    fake_arxiv_client(results=[_fake_result(journal_ref="IEEE Access, vol. 7, 2019", year=2019)])
    assert ArxivEnricher().fetch("2103.12345") == ("IEEE Access, vol. 7, 2019", 2019, [])


def test_arxiv_enricher_fetch_returns_authors(fake_arxiv_client):
    fake_arxiv_client(results=[_fake_result(year=2019, authors=["Yi Zhu", "Shawn Newsam"])])
    venue, year, authors = ArxivEnricher().fetch("2103.12345")
    assert authors == ["Yi Zhu", "Shawn Newsam"]


def test_arxiv_enricher_fetch_none_on_no_results(fake_arxiv_client):
    fake_arxiv_client(results=[])
    assert ArxivEnricher().fetch("2103.12345") == (None, None, [])


def test_arxiv_enricher_fetch_none_on_failure(fake_arxiv_client):
    fake_arxiv_client(error=RuntimeError("offline"))
    assert ArxivEnricher().fetch("2103.12345") == (None, None, [])


# --- enrich composition: Crossref then the arXiv fallback (fix request) ----


class _RaisingArxivFetcher:
    """A fetcher that fails the test if called - proves Crossref, when it
    already has a venue, is authoritative and the arXiv fallback never fires."""

    def fetch(self, arxiv_id: str) -> tuple[str | None, int | None, list[str]]:
        raise AssertionError("arXiv fallback must not fire when Crossref already has a venue")


def test_enrich_arxiv_fallback_fires_when_crossref_skips_entirely(fake_httpx):
    def handler(url, params):
        raise crossref.httpx.ConnectError("offline")

    fake_httpx(handler)

    class FakeArxiv:
        def fetch(self, arxiv_id: str) -> tuple[str | None, int | None, list[str]]:
            assert arxiv_id == "2103.12345"
            return "arXiv", 2021, ["Ada Lovelace"]

    result = enrich(
        ExtractedMeta(title="A Preprint", arxiv_id="2103.12345"),
        arxiv_fetcher=FakeArxiv(),
    )
    assert result != "skipped"
    assert result.title == "A Preprint"  # Crossref skipped: original title kept
    assert result.venue == "arXiv"
    # User fix request: arXiv-only (no journal_ref) -> Venue (Short) matches
    # Venue (Full), both "arXiv".
    assert result.venue_short == "arXiv"
    assert result.year == 2021
    # PDF carried no DOI/authors either: arXiv-only, so its own record fills both in.
    assert result.doi == "10.48550/arXiv.2103.12345"
    assert result.authors == ["Ada Lovelace"]


def test_enrich_arxiv_fallback_fires_when_crossref_has_no_venue(fake_httpx):
    def handler(url, params):
        return _FakeResponse(200, {"message": {"title": ["A Paper"], "author": []}})

    fake_httpx(handler)

    class FakeArxiv:
        def fetch(self, arxiv_id: str) -> tuple[str | None, int | None, list[str]]:
            return "arXiv", 2020, ["Grace Hopper"]

    result = enrich(
        ExtractedMeta(title="A Paper", doi="10.1/x", arxiv_id="2103.12345"),
        arxiv_fetcher=FakeArxiv(),
    )
    assert result != "skipped"
    assert result.title == "A Paper"
    assert result.doi == "10.1/x"  # untouched: DOI stays extraction-sourced
    assert result.venue == "arXiv"
    assert result.venue_short == "arXiv"  # user fix request: matches Venue (Full)
    assert result.year == 2020
    # Crossref's own author list came back empty: arXiv's fills in.
    assert result.authors == ["Grace Hopper"]


def test_enrich_arxiv_fallback_never_fires_when_crossref_already_has_a_venue(fake_httpx):
    def handler(url, params):
        return _FakeResponse(
            200,
            {
                "message": {
                    "title": ["A Paper"],
                    "author": [],
                    "container-title": ["Journal of Foo"],
                    "issued": {"date-parts": [[2017]]},
                }
            },
        )

    fake_httpx(handler)
    result = enrich(
        ExtractedMeta(title="A Paper", doi="10.1/x", arxiv_id="2103.12345"),
        arxiv_fetcher=_RaisingArxivFetcher(),
    )
    assert result != "skipped"
    assert result.venue == "Journal of Foo"  # Crossref's own venue, untouched
    assert result.year == 2017


def test_enrich_arxiv_fallback_never_fires_without_an_arxiv_id(fake_httpx):
    fake_httpx(lambda url, params: _FakeResponse(200, {"message": {"items": []}}))
    result = enrich(ExtractedMeta(title="No ArXiv Id"), arxiv_fetcher=_RaisingArxivFetcher())
    assert result == "skipped"  # no arxiv_id to route the fallback on


def test_enrich_arxiv_only_paper_gets_venue_short_arxiv_without_a_semantic_scholar_lookup(fake_httpx):
    """User fix request: a paper that exists on arXiv only (no journal_ref -
    ArxivFetcher.fetch's own fallback to the literal ARXIV_VENUE) gets
    venue_short filled to "arXiv" directly, matching venue, rather than
    staying blank or triggering the Semantic Scholar fallback (which would
    only look up arXiv's own self-assigned DOI anyway)."""

    def handler(url, params):
        raise crossref.httpx.ConnectError("offline")

    fake_httpx(handler)

    class FakeArxiv:
        def fetch(self, arxiv_id: str) -> tuple[str | None, int | None, list[str]]:
            return arxiv_enrich.ARXIV_VENUE, 2021, []

    result = enrich(
        ExtractedMeta(title="A Preprint", arxiv_id="2103.12345"),
        arxiv_fetcher=FakeArxiv(),
        venue_short_fetcher=_RaisingVenueShortFetcher(),
    )
    assert result != "skipped"
    assert result.venue == "arXiv"
    assert result.venue_short == "arXiv"


def test_enrich_arxiv_fallback_with_a_journal_ref_does_not_force_venue_short_to_arxiv(fake_httpx):
    """The venue_short == "arXiv" shortcut only applies when the arXiv
    fallback's venue IS the literal ARXIV_VENUE (no journal_ref). A formally-
    published journal_ref still goes through the normal Semantic-Scholar-by-
    DOI cascade below - it is NOT forced to "arXiv"."""

    def handler(url, params):
        raise crossref.httpx.ConnectError("offline")

    fake_httpx(handler)

    class FakeArxiv:
        def fetch(self, arxiv_id: str) -> tuple[str | None, int | None, list[str]]:
            return "IEEE Access, vol. 7, 2019", 2019, []

    class FakeVenueShort:
        def fetch(self, doi: str) -> str | None:
            assert doi == "10.48550/arXiv.2103.12345"
            return "IEEE Access"

    result = enrich(
        ExtractedMeta(title="A Preprint", arxiv_id="2103.12345"),
        arxiv_fetcher=FakeArxiv(),
        venue_short_fetcher=FakeVenueShort(),
    )
    assert result != "skipped"
    assert result.venue == "IEEE Access, vol. 7, 2019"
    assert result.venue_short == "IEEE Access"


def test_enrich_arxiv_fallback_failure_leaves_crossref_result_unchanged(fake_httpx):
    def handler(url, params):
        raise crossref.httpx.ConnectError("offline")

    fake_httpx(handler)

    class FailingArxiv:
        def fetch(self, arxiv_id: str) -> tuple[str | None, int | None, list[str]]:
            return None, None, []

    result = enrich(
        ExtractedMeta(title="A Preprint", arxiv_id="2103.12345"),
        arxiv_fetcher=FailingArxiv(),
    )
    assert result == "skipped"  # arXiv found nothing either: still a total skip


def test_arxiv_doi_is_the_deterministic_datacite_pattern():
    assert arxiv_enrich.arxiv_doi("2103.12345") == "10.48550/arXiv.2103.12345"


def test_enrich_arxiv_doi_fill_only_fires_alongside_a_successful_venue_fallback(fake_httpx):
    """Fix request: arXiv's self-assigned DOI is a bonus fill on the SAME
    arXiv-only branch as venue/year, never fired on its own (there is no
    'DOI missing but venue present' path to key it off, per Crossref
    already being authoritative once it has an answer)."""

    def handler(url, params):
        return _FakeResponse(
            200,
            {
                "message": {
                    "items": [
                        {
                            "title": ["A Paper"],
                            "author": [],
                            "container-title": ["Journal of Foo"],
                            "issued": {"date-parts": [[2017]]},
                        }
                    ]
                }
            },
        )

    fake_httpx(handler)
    result = enrich(
        ExtractedMeta(title="A Paper", arxiv_id="2103.12345"),  # doi=None, but Crossref has a venue
        arxiv_fetcher=_RaisingArxivFetcher(),
    )
    assert result != "skipped"
    assert result.doi is None  # Crossref found no DOI; arXiv fallback never ran to fill one either


# --- semantic_scholar (Story 8.5 fix request): venue-acronym fallback -------


def test_semantic_scholar_enricher_returns_acronym_shaped_alternate_name(fake_semantic_scholar_httpx):
    def handler(url, params):
        assert url == "https://api.semanticscholar.org/graph/v1/paper/DOI:10.1109/iccv.2017.226"
        assert params == {"fields": "publicationVenue"}
        return _FakeResponse(
            200,
            {"publicationVenue": {"name": "IEEE International Conference on Computer Vision", "alternate_names": ["ICCV", "IEEE Int Conf Comput Vis"]}},
        )

    fake_semantic_scholar_httpx(handler)
    assert SemanticScholarEnricher().fetch("10.1109/iccv.2017.226") == "ICCV"


def test_semantic_scholar_enricher_scans_past_a_non_acronym_first_entry(fake_semantic_scholar_httpx):
    """Code-review fix: `alternate_names` is NOT ordered acronym-first.
    Verified live: DOI 10.18653/v1/2020.acl-main.1 returns the bare acronym
    ("ACL") at index 2, behind two longer non-acronym-shaped variants."""

    def handler(url, params):
        return _FakeResponse(
            200,
            {
                "publicationVenue": {
                    "name": "Annual Meeting of the Association for Computational Linguistics",
                    "alternate_names": [
                        "Annu Meet Assoc Comput Linguistics",
                        "Meeting of the Association for Computational Linguistics",
                        "ACL",
                        "Meet Assoc Comput Linguistics",
                    ],
                }
            },
        )

    fake_semantic_scholar_httpx(handler)
    assert SemanticScholarEnricher().fetch("10.18653/v1/2020.acl-main.1") == "ACL"


def test_semantic_scholar_enricher_none_when_no_alternate_name_is_acronym_shaped(fake_semantic_scholar_httpx):
    fake_semantic_scholar_httpx(
        lambda url, params: _FakeResponse(
            200, {"publicationVenue": {"alternate_names": ["IEEE Int Conf Comput Vis", "ICCV Workshops"]}}
        )
    )
    assert SemanticScholarEnricher().fetch("10.1/x") is None


def test_semantic_scholar_enricher_none_on_empty_or_missing_alternate_names(fake_semantic_scholar_httpx):
    fake_semantic_scholar_httpx(lambda url, params: _FakeResponse(200, {"publicationVenue": {"alternate_names": []}}))
    assert SemanticScholarEnricher().fetch("10.1/x") is None

    fake_semantic_scholar_httpx(lambda url, params: _FakeResponse(200, {}))
    assert SemanticScholarEnricher().fetch("10.1/x") is None


def test_semantic_scholar_enricher_none_on_non_200(fake_semantic_scholar_httpx):
    fake_semantic_scholar_httpx(lambda url, params: _FakeResponse(404, {}))
    assert SemanticScholarEnricher().fetch("10.1/x") is None


def test_semantic_scholar_enricher_none_on_network_failure(fake_semantic_scholar_httpx):
    def handler(url, params):
        raise crossref.httpx.ConnectError("offline")

    fake_semantic_scholar_httpx(handler)
    assert SemanticScholarEnricher().fetch("10.1/x") is None


class _RaisingVenueShortFetcher:
    """A fetcher that fails the test if called - proves the Semantic Scholar
    fallback never fires when it isn't supposed to."""

    def fetch(self, doi: str) -> str | None:
        raise AssertionError("Semantic Scholar fallback must not fire here")


def test_enrich_semantic_scholar_fallback_fills_venue_short_when_crossref_leaves_it_unset(fake_httpx):
    def handler(url, params):
        return _FakeResponse(
            200,
            {
                "message": {
                    "title": ["A Paper"],
                    "author": [],
                    "container-title": ["2017 IEEE International Conference on Computer Vision"],
                    "issued": {"date-parts": [[2017]]},
                }
            },
        )

    fake_httpx(handler)

    class FakeVenueShort:
        def fetch(self, doi: str) -> str | None:
            assert doi == "10.1109/iccv.2017.226"
            return "ICCV"

    result = enrich(
        ExtractedMeta(title="A Paper", doi="10.1109/iccv.2017.226"),
        venue_short_fetcher=FakeVenueShort(),
    )
    assert result != "skipped"
    assert result.venue_short == "ICCV"
    assert result.venue == "2017 IEEE International Conference on Computer Vision"  # untouched


def test_enrich_semantic_scholar_fallback_never_fires_when_crossref_already_has_a_short_venue(fake_httpx):
    def handler(url, params):
        return _FakeResponse(
            200,
            {
                "message": {
                    "title": ["A Paper"],
                    "author": [],
                    "container-title": ["Proceedings of the 2025 CHI Conference"],
                    "short-container-title": ["CHI"],
                    "issued": {"date-parts": [[2025]]},
                }
            },
        )

    fake_httpx(handler)
    result = enrich(
        ExtractedMeta(title="A Paper", doi="10.1145/xyz"),
        venue_short_fetcher=_RaisingVenueShortFetcher(),
    )
    assert result != "skipped"
    assert result.venue_short == "CHI"  # Crossref's own short form, untouched


def test_enrich_semantic_scholar_fallback_never_fires_without_a_doi(fake_httpx):
    def handler(url, params):
        return _FakeResponse(
            200,
            {"message": {"items": [{"title": ["A Paper"], "author": [], "container-title": ["Some Journal"]}]}},
        )

    fake_httpx(handler)
    result = enrich(
        ExtractedMeta(title="A Paper"),  # no doi extracted, and Crossref's title-query result carries none either
        venue_short_fetcher=_RaisingVenueShortFetcher(),
    )
    assert result != "skipped"
    assert result.doi is None
    assert result.venue_short is None


def test_enrich_semantic_scholar_fallback_never_fires_on_a_total_skip(fake_httpx):
    def handler(url, params):
        raise crossref.httpx.ConnectError("offline")

    fake_httpx(handler)
    result = enrich(ExtractedMeta(title="A Paper"), venue_short_fetcher=_RaisingVenueShortFetcher())
    assert result == "skipped"


def test_enrich_semantic_scholar_fallback_failure_leaves_result_unchanged(fake_httpx):
    def handler(url, params):
        return _FakeResponse(
            200,
            {
                "message": {
                    "title": ["A Paper"],
                    "author": [],
                    "container-title": ["Some Journal"],
                    "issued": {"date-parts": [[2020]]},
                }
            },
        )

    fake_httpx(handler)

    class FailingVenueShort:
        def fetch(self, doi: str) -> str | None:
            return None

    result = enrich(
        ExtractedMeta(title="A Paper", doi="10.1/x"),
        venue_short_fetcher=FailingVenueShort(),
    )
    assert result != "skipped"
    assert result.venue_short is None


_FORBIDDEN_IMPORTS = {"os", "pathlib", "app.storage"}


def _import_leaks(source: str) -> set[str]:
    """Names a module imports that violate AD-L2 (storage/filesystem access).

    Records both the bare module and the fully-qualified ``module.name`` for
    ``from X import Y`` so ``from app import storage`` (which records only
    ``app`` for ``node.module``) is caught via ``app.storage``, not just the
    ``import app.storage`` / ``from app.storage import ...`` forms.
    """
    import ast

    imported: set[str] = set()
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):
            imported.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            module = node.module or ""
            imported.add(module)
            for alias in node.names:
                imported.add(f"{module}.{alias.name}" if module else alias.name)
    return {name for name in imported if name in _FORBIDDEN_IMPORTS or name.startswith("app.storage")}


#: The OS-scratch stdlib ``structure.py`` may use (Story 10.1, AD-L8, a SURFACED
#: AD-L2 deviation): opendataloader-pdf is a file-based binding, so its adapter
#: round-trips PDF bytes through a throwaway ``tempfile.TemporaryDirectory``.
#: That temp dir is transient OS scratch, NOT ``~/.paper-mate`` — storage remains
#: the sole writer of the data root (AD-9), and structure.py still must NEVER
#: import ``app.storage`` (it returns data; the route composes it with storage).
#: Exempting these stdlib fs names for THIS module only keeps the guard's real
#: intent (no data-root writes, no storage import) intact.
_STRUCTURE_OS_SCRATCH = {"os", "pathlib", "tempfile"}


def test_domain_modules_are_pure():
    """AD-L2: NO domain module imports storage or filesystem access.

    Parse the actual imports (not the docstring) of every ``app/domain/*.py``
    module so a prose mention of ``app.storage`` in a module header can't trip
    the guard — and so the split into extract/enrich/crossref/structure is
    covered, not just one file. (``crossref`` legitimately imports ``httpx``:
    enrichment is the one allowed network hop; ``structure`` legitimately uses
    OS temp scratch for the file-based opendataloader binding — see
    ``_STRUCTURE_OS_SCRATCH``. The ``app.storage`` ban holds for EVERY module,
    structure included.)
    """
    import pathlib

    from app import domain

    domain_dir = pathlib.Path(domain.__file__).parent
    leaks = {}
    for module_file in sorted(domain_dir.glob("*.py")):
        found = _import_leaks(module_file.read_text())
        if module_file.name == "structure.py":
            found -= _STRUCTURE_OS_SCRATCH  # allowed OS scratch; app.storage still caught
        if found:
            leaks[module_file.name] = found
    assert not leaks, f"domain must stay pure: found imports {leaks}"


def test_purity_check_catches_every_storage_import_form():
    """The guard must catch all three storage-import spellings, including the
    `from app import storage` facade form (which records only `app` as the
    module) — otherwise the AD-L2 landmine would false-green."""
    assert _import_leaks("from app import storage") == {"app.storage"}
    assert _import_leaks("import app.storage") == {"app.storage"}
    assert _import_leaks("from app.storage import documents") >= {"app.storage"}
    assert _import_leaks("import os\nimport pathlib") == {"os", "pathlib"}
    # A legitimate domain import is not a leak.
    assert _import_leaks("from app.models import ExtractedMeta") == set()


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


def test_enrich_degrades_to_skipped_when_injected_enricher_raises():
    """The facade enforces the port's never-raises contract: a misbehaving
    injected enricher degrades to "skipped" rather than leaking into the add."""

    class _BoomEnricher:
        def enrich(self, meta: ExtractedMeta):
            raise RuntimeError("boom")

    assert enrich(ExtractedMeta(title="x"), enricher=_BoomEnricher()) == "skipped"


def test_default_enricher_is_a_crossref_enricher():
    """The production default behind the ``enrich`` facade is CrossrefEnricher."""
    from app.domain.enrich import _default_enricher

    assert isinstance(_default_enricher, CrossrefEnricher)
