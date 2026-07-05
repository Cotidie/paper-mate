"""Library route (AD-L6, AR-11). Thin: no filesystem access, no domain logic.

``GET /api/library`` returns the collection table + folder tree in one read,
straight from ``library.json``'s display cache (Story 6.2). The collection
list is this endpoint, not a ``/api/docs`` scan; that resource stays Reserved.

``POST``/``PATCH``/``DELETE /api/library/folders`` are the folder CRUD (Story
7.1, AL-6): create/rename return the affected ``Folder``; delete is a subtree
delete that re-homes every paper in it to Uncategorized and returns the whole
updated ``Library`` in one round-trip, mirroring ``patch_doc`` returning the
full ``Doc``. A missing folder is a 404 ``"Folder not found"``, distinct from
the doc-specific ``"Document not found"`` literal, via ``storage_errors``'s
``not_found``/``not_found_detail`` override.
"""

from fastapi import APIRouter

from app import storage
from app.models import Folder, FolderCreate, FolderRename, Library
from app.routes._errors import error_response, storage_errors

router = APIRouter(tags=["library"])

_FOLDER_NOT_FOUND = "Folder not found"


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


@router.post(
    "/library/folders",
    response_model=Folder,
    responses={
        404: error_response("No folder with this id (bad parent_id)."),
        422: error_response("Folder name required."),
        500: error_response("Could not update folders."),
    },
)
async def create_folder(body: FolderCreate) -> Folder:
    """Create a folder, optionally nested under ``parent_id`` (AC-1).

    A missing ``parent_id`` -> 404 ``"Folder not found"``; a blank/whitespace
    ``name`` is already rejected by ``FolderCreate`` as a 422 (AR-11).
    """
    with storage_errors(
        "Could not update folders", not_found=storage.FolderNotFoundError, not_found_detail=_FOLDER_NOT_FOUND
    ):
        return storage.create_folder(body.name, body.parent_id)


@router.patch(
    "/library/folders/{folder_id}",
    response_model=Folder,
    responses={
        404: error_response("No folder with this id."),
        422: error_response("Folder name required."),
        500: error_response("Could not update folders."),
    },
)
async def rename_folder(folder_id: str, body: FolderRename) -> Folder:
    """Rename a folder; membership is keyed by id, so this never orphans a
    paper (AC-2). Missing id -> 404 ``"Folder not found"``."""
    with storage_errors(
        "Could not update folders", not_found=storage.FolderNotFoundError, not_found_detail=_FOLDER_NOT_FOUND
    ):
        return storage.rename_folder(folder_id, body.name)


@router.delete(
    "/library/folders/{folder_id}",
    response_model=Library,
    responses={
        404: error_response("No folder with this id."),
        500: error_response("Could not update folders."),
    },
)
async def delete_folder(folder_id: str) -> Library:
    """Delete a folder and its whole subtree, re-homing every paper in it to
    Uncategorized; NO paper is ever deleted (AC-3, ratifies PRD A1). Returns
    the updated ``Library`` (re-homed papers + surviving folders) in one
    round-trip. Missing id -> 404 ``"Folder not found"``."""
    with storage_errors(
        "Could not update folders", not_found=storage.FolderNotFoundError, not_found_detail=_FOLDER_NOT_FOUND
    ):
        return storage.delete_folder(folder_id)
