"""Shared test fixtures.

``data_root`` points the storage module at a throwaway ``tmp_path`` via the
``PAPER_MATE_DATA`` env so tests never touch the real ``~/.paper-mate``.
"""

import hashlib
import io

import pytest
from pypdf import PdfWriter


@pytest.fixture
def data_root(tmp_path, monkeypatch):
    """Isolate storage to a temp data root for the duration of a test."""
    monkeypatch.setenv("PAPER_MATE_DATA", str(tmp_path))
    return tmp_path


@pytest.fixture(autouse=True)
def _stub_enrich(monkeypatch):
    """Never hit the real Crossref network anywhere in the suite (Story 6.5).

    FastAPI's ``TestClient`` runs a route's background task synchronously after
    the response, so every ``POST /api/docs`` test would otherwise execute the
    real ``domain.enrich`` (a live HTTP call). Default it to ``"skipped"`` on
    the ``app.domain`` package (what ``run_extraction`` resolves); a test that
    needs the enriched path re-patches ``domain.enrich`` in its own body. The
    ``domain.enrich`` unit tests bind the function (or patch ``crossref.httpx``)
    directly, so they are unaffected by this package-level stub.
    """
    from app import domain

    monkeypatch.setattr(domain, "enrich", lambda meta: "skipped")


@pytest.fixture(autouse=True)
def _reset_structure_analyzing():
    """The structure "analyzing" in-flight set is process-global; clear it
    around every test so a mark leaked by one test can't bleed into the next."""
    from app.storage import structure_progress

    structure_progress._analyzing.clear()
    yield
    structure_progress._analyzing.clear()


@pytest.fixture(autouse=True)
def _stub_structure(monkeypatch):
    """Keep the JVM out of the general suite (Story 10.1).

    ``run_extraction`` runs structure extraction after metadata, and the
    ``TestClient`` runs that background task synchronously — so every
    ``POST /api/docs`` test would otherwise spawn opendataloader's JVM (slow,
    and it can hang under the review sandbox). Default ``domain.extract_structure``
    to an empty result everywhere; a test exercising the real path feeds
    ``_map_tree`` a captured fixture directly or re-patches this itself.
    """
    from app import domain
    from app.models import DocStructure

    monkeypatch.setattr(domain, "extract_structure", lambda pdf_bytes: DocStructure())


def make_pdf_bytes(pages: int = 1, title: str | None = None) -> bytes:
    """Build a minimal, deterministic valid PDF in memory (no committed binary)."""
    writer = PdfWriter()
    for _ in range(pages):
        writer.add_blank_page(width=72, height=72)
    if title is not None:
        writer.add_metadata({"/Title": title})
    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue()


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()
