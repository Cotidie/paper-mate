"""The background extract -> enrich -> persist orchestrator (AD-L2 composition root).

Homed beside the routes (not inside a thin controller): this is where the pure
``domain`` extract/enrich composes with the ``storage`` writer. ``upload_doc``
schedules it as a FastAPI background task; it is not itself an HTTP handler.

Since Story 10.1 it also runs the **structure-extraction** tenant (AD-13/AD-L8)
after metadata, in the same background task: fully isolated (its own guard) so a
slow JVM or a structure failure never delays or alters the title/authors the
table shows, and never leaves the row stuck.
"""

from app import domain, storage
from app.models import ExtractedMeta


def run_extraction(doc_id: str, pdf_bytes: bytes) -> None:
    """Extract -> enrich -> persist metadata, then extract + persist structure.

    Runs as a **sync** FastAPI background task (Starlette's threadpool, off the
    event loop) — correct for CPU-bound PyMuPDF + sync httpx + a JVM hop.

    Metadata resolves the terminal status (AC-5): ``ready`` when Crossref
    enriched, ``enrich-skipped`` when local fields survive but enrich skipped,
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

    _run_structure(doc_id, pdf_bytes)


def _run_structure(doc_id: str, pdf_bytes: bytes) -> None:
    """Extract + persist the document structure (AD-13/AD-L8), fully isolated.

    Deliberately separate from the metadata path and swallowing everything:
    structure is total + non-blocking (there is NO ``analyzing`` status the
    client polls -- readiness is observed via ``GET .../structure`` returning
    404/empty). A structure failure must NEVER change the metadata status the
    table already settled, and NEVER raise out of the background task. A doc
    purged mid-flight is a best-effort no-op.
    """
    try:
        structure = domain.extract_structure(pdf_bytes)
        storage.write_structure(doc_id, structure)
    except storage.DocumentNotFoundError:
        pass  # purged mid-flight — best-effort no-op
    except Exception:
        pass  # structure is best-effort; never poison the settled metadata row
