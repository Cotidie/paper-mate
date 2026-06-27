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
