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
from app.models import DocIdSet, Folder, FolderCreate, FolderRename, Library, MoveRequest
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


@router.post(
    "/library/move",
    response_model=Library,
    responses={
        404: error_response("No folder with this id, or an unknown document id."),
        422: error_response("doc_ids must be non-empty."),
        500: error_response("Could not update the collection."),
    },
)
async def move_papers(body: MoveRequest) -> Library:
    """Set-based move (Story 7.2, AD-L6): assign every id in ``doc_ids`` to
    ``folder_id`` (``None`` clears membership, i.e. Uncategorized). A move
    replaces any prior folder, so a paper belongs to at most one folder.
    Returns the whole updated ``Library`` in one round-trip. TWO distinct
    404s: a bad ``folder_id`` -> ``"Folder not found"``, an unknown
    ``doc_id`` -> ``"Document not found"``."""
    with storage_errors(
        "Could not update the collection",
        extra_not_found=[(storage.FolderNotFoundError, _FOLDER_NOT_FOUND)],
    ):
        return storage.move_papers(body.doc_ids, body.folder_id)


@router.post(
    "/library/trash",
    response_model=Library,
    responses={
        404: error_response("An unknown document id."),
        422: error_response("doc_ids must be non-empty."),
        500: error_response("Could not update the collection."),
    },
)
async def trash_papers(body: DocIdSet) -> Library:
    """Set-based soft-delete (Story 7.5 AC-1, AL-5.1, AD-L6): flip ``trashed``
    to ``True`` for every id in ``doc_ids``. ``folder_id``/``order`` and
    ``annotations.json``/``meta.json``/``source.pdf`` are untouched -- this is
    organizational only. Returns the whole updated ``Library`` in one
    round-trip. Unknown ``doc_id`` -> 404 ``"Document not found"``."""
    with storage_errors("Could not update the collection"):
        return storage.trash_papers(body.doc_ids)


@router.post(
    "/library/restore",
    response_model=Library,
    responses={
        404: error_response("An unknown document id."),
        422: error_response("doc_ids must be non-empty."),
        500: error_response("Could not update the collection."),
    },
)
async def restore_papers(body: DocIdSet) -> Library:
    """Set-based restore (Story 7.5 AC-3, AL-5.2, AD-L6): flip ``trashed`` to
    ``False`` for every id in ``doc_ids``, returning it to its retained
    ``folder_id`` (Uncategorized if that folder is gone -- already guaranteed
    by ``delete_folder``'s re-home, no extra guard needed here). Returns the
    whole updated ``Library`` in one round-trip. Unknown ``doc_id`` -> 404
    ``"Document not found"``."""
    with storage_errors("Could not update the collection"):
        return storage.restore_papers(body.doc_ids)


@router.post(
    "/library/star",
    response_model=Library,
    responses={
        404: error_response("An unknown document id."),
        422: error_response("doc_ids must be non-empty."),
        500: error_response("Could not update the collection."),
    },
)
async def star_papers(body: DocIdSet) -> Library:
    """Set-based star (Story 7.8 AC-1, AL-5, AD-L6): flip ``starred`` to
    ``True`` for every id in ``doc_ids``. ``folder_id``/``order``/``trashed``
    and ``annotations.json``/``meta.json``/``source.pdf`` are untouched -- this
    is organizational only. Returns the whole updated ``Library`` in one
    round-trip. Unknown ``doc_id`` -> 404 ``"Document not found"``."""
    with storage_errors("Could not update the collection"):
        return storage.star_papers(body.doc_ids)


@router.post(
    "/library/unstar",
    response_model=Library,
    responses={
        404: error_response("An unknown document id."),
        422: error_response("doc_ids must be non-empty."),
        500: error_response("Could not update the collection."),
    },
)
async def unstar_papers(body: DocIdSet) -> Library:
    """Set-based unstar (Story 7.8 AC-1, AL-5, AD-L6): flip ``starred`` to
    ``False`` for every id in ``doc_ids``. Returns the whole updated
    ``Library`` in one round-trip. Unknown ``doc_id`` -> 404
    ``"Document not found"``."""
    with storage_errors("Could not update the collection"):
        return storage.unstar_papers(body.doc_ids)
