"""Shared route error plumbing (AR-11): one error-envelope definition, one
storage-exception mapping seam.

Every ``/api`` handler answers faults as the single ``{ "detail": string }``
envelope. Two pieces of that were copy-pasted across ``docs.py``/``library.py``:

- the OpenAPI ``responses=`` entry that points a status code at
  ``ErrorEnvelope`` (identical but for its human ``description``), and
- the ``DocumentNotFoundError -> 404 / StorageError -> 500`` try/except in
  every handler body.

``error_response`` builds the first; ``storage_errors`` is the second. This
keeps each handler a thin controller (AD-9) and the envelope defined once.
"""

from collections.abc import Iterator
from contextlib import contextmanager

from fastapi import HTTPException

from app import storage

#: The one place the ErrorEnvelope ``content`` block is spelled out.
_ENVELOPE_CONTENT = {
    "application/json": {"schema": {"$ref": "#/components/schemas/ErrorEnvelope"}}
}

#: The constant 404 detail for any resolvable-but-absent document.
_NOT_FOUND_DETAIL = "Document not found"


def error_response(description: str) -> dict:
    """An OpenAPI ``responses`` entry pointing a status code at ``ErrorEnvelope``.

    Only the human ``description`` varies per route; the ``content`` envelope is
    shared, so the generated contract stays byte-identical while the block is
    written once.
    """
    return {"description": description, "content": _ENVELOPE_CONTENT}


@contextmanager
def storage_errors(
    server_error: str,
    *,
    not_found: type[storage.StorageError] = storage.DocumentNotFoundError,
    not_found_detail: str = _NOT_FOUND_DETAIL,
) -> Iterator[None]:
    """Map storage faults to the ``{ detail }`` envelope inside a handler body.

    ``not_found`` -> 404 ``not_found_detail`` (defaults to
    ``DocumentNotFoundError`` -> ``"Document not found"``, the constant 404
    detail across every doc route); any other ``StorageError`` -> 500 with the
    route-specific ``server_error`` message. A route whose "not found" fault is
    a different taxonomy member (e.g. ``FolderNotFoundError`` -> ``"Folder not
    found"``) passes both kwargs rather than duplicating this try/except.
    """
    try:
        yield
    except not_found as exc:
        raise HTTPException(status_code=404, detail=not_found_detail) from exc
    except storage.StorageError as exc:
        raise HTTPException(status_code=500, detail=server_error) from exc
