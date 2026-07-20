"""Decorate API responses with the derived ``structure_status`` (the status dot).

``structure_status`` is response-only and derived (an in-flight marker +
``structure.json`` existence), never persisted. EVERY route that returns a
``Doc`` or a ``Library`` must stamp it, or the client — which replaces its state
with each response — would see a green/amber dot fall back to the default
``"absent"`` (grey) after a mutation (move/trash/star/patch/open/…). This is the
single place that decoration happens, so no route can forget it.
"""

from app import storage
from app.models import Doc, Library


def _status(doc_id: str) -> str:
    # Marker-first (the lazy existence predicate is only stat'd when not
    # analyzing) — closes the TOCTOU window, see ``structure_status_for``.
    return storage.structure_status_for(doc_id, lambda: storage.structure_exists(doc_id))


def decorate_doc(doc: Doc) -> Doc:
    """Return ``doc`` with its derived ``structure_status`` filled in."""
    return doc.model_copy(update={"structure_status": _status(doc.doc_id)})


def decorate_library(library: Library) -> Library:
    """Return ``library`` with every row's derived ``structure_status`` filled in
    (one marker check + at most one stat per row; kept out of ``read_library``
    so the index projection stays a straight ``library.json`` read, LNFR-4)."""
    papers = [
        row.model_copy(update={"structure_status": _status(row.doc_id)})
        for row in library.papers
    ]
    return library.model_copy(update={"papers": papers})
