"""Library route (AD-L6, AR-11). Thin: no filesystem access, no domain logic.

``GET /api/library`` returns the collection table + folder tree in one read,
straight from ``library.json``'s display cache (Story 6.2). The collection
list is this endpoint, not a ``/api/docs`` scan; that resource stays Reserved.
"""

from fastapi import APIRouter

from app import storage
from app.models import Library
from app.routes._errors import error_response, storage_errors

router = APIRouter(tags=["library"])


@router.get(
    "/library",
    response_model=Library,
    responses={500: error_response("The stored collection index is unreadable.")},
)
async def get_library() -> Library:
    """Return the collection in one lock-free read (AC-3).

    An absent ``library.json`` is an empty collection, not an error. A
    corrupt on-disk index surfaces as the single ``{ "detail" }`` envelope
    (AR-11), mirroring ``get_annotations``.
    """
    with storage_errors("Could not read library"):
        return storage.read_library()
