"""The background extract -> enrich -> persist orchestrator (AD-L2 composition root).

Homed beside the routes (not inside a thin controller): this is where the pure
``domain`` extract/enrich composes with the ``storage`` writer. ``upload_doc``
schedules it as a FastAPI background task; it is not itself an HTTP handler.
"""

from app import domain, storage
from app.models import ExtractedMeta


def run_extraction(doc_id: str, pdf_bytes: bytes) -> None:
    """Extract -> enrich -> persist, off the request path.

    Runs as a **sync** FastAPI background task (Starlette's threadpool, off the
    event loop) — correct for CPU-bound PyMuPDF + sync httpx.

    Resolves the terminal status (AC-5): ``ready`` when Crossref enriched,
    ``enrich-skipped`` when local fields survive but enrich skipped,
    ``parse-failed`` when nothing was found (a never-lost filename row). It
    **never raises**: a purged doc is a best-effort no-op, and any unexpected
    failure still settles the row to ``parse-failed`` rather than leaving it
    stuck ``extracting`` forever.
    """
    try:
        extracted = domain.extract(pdf_bytes)
        enriched = domain.enrich(extracted)
        if isinstance(enriched, ExtractedMeta):
            final, status = enriched, "ready"
        elif extracted.title or extracted.authors:
            final, status = extracted, "enrich-skipped"
        else:
            final, status = extracted, "parse-failed"
        try:
            storage.apply_extraction(
                doc_id,
                title=final.title,
                authors_list=final.authors,  # storage/model own list->display
                status=status,
                doi=final.doi,
                venue=final.venue,
                venue_short=final.venue_short,
                year=final.year,
            )
        except storage.DocumentNotFoundError:
            pass  # purged mid-flight — best-effort no-op
    except Exception:
        # Never leave the row stuck at "extracting" (the client would poll to
        # its cap and give up on a permanently-muted row). Settle it as failed.
        try:
            storage.apply_extraction(
                doc_id,
                title=None,
                authors_list=[],
                status="parse-failed",
                doi=None,
                venue=None,
                venue_short=None,
                year=None,
            )
        except storage.StorageError:
            pass
