"""PDF identity/validation: the pypdf parse that gates every import.

Storage validates the bytes are a readable PDF (and pulls ``page_count`` +
embedded title) BEFORE writing anything; any parse failure is surfaced as
``InvalidPDFError`` so nothing lands on disk for a bad upload.
"""

from io import BytesIO

from pypdf import PdfReader

from app.storage.errors import InvalidPDFError


def parse_pdf(raw_bytes: bytes) -> tuple[int, str | None]:
    """Validate the bytes as a PDF and extract ``(page_count, title)``.

    Any parse failure (non-PDF, corrupt, empty) is surfaced as InvalidPDFError.
    """
    try:
        reader = PdfReader(BytesIO(raw_bytes))
        page_count = len(reader.pages)
        if page_count < 1:
            raise InvalidPDFError("PDF has no pages")
        meta = reader.metadata
        title = str(meta.title) if meta and meta.title else None
    except InvalidPDFError:
        raise
    except Exception as exc:  # pypdf raises a variety of read errors
        raise InvalidPDFError(str(exc)) from exc
    return page_count, title
