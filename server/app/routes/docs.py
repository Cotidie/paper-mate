"""Documents route (AR-9, AR-11). Thin: no filesystem access, no domain logic.

``POST /api/docs`` imports a PDF by delegating to the storage module and
returns the ``Doc`` contract. A bad PDF becomes the single error envelope
``{ "detail": string }``. ``GET /api/docs/{doc_id}/file`` streams the stored
bytes. ``PUT /api/docs/{doc_id}/annotations`` overwrites the full annotation
set (AR-7, H9: bare list body, disk envelope is storage-internal).
``GET /api/docs/{doc_id}/annotations`` reads it back for hydrate-on-open
(Story 3.5; bare list, ``[]`` when unannotated). ``GET /api/docs/{doc_id}``
returns a document's own metadata (Story 6.1, AD-L6). ``PATCH
/api/docs/{doc_id}`` partially updates ``title``/``authors`` (Story 6.6,
AD-L6). ``POST /api/docs/{doc_id}/open`` advances ``meta.last_opened`` when
a paper opens (Story 6.7) - the only mutation alongside the otherwise-pure
meta ``GET``. Reserved (not built here): ``GET /api/docs``.

The repeated error-envelope ``responses=`` block and the storage-exception
mapping are consolidated into ``_errors`` (``error_response`` / ``storage_errors``)
so each handler stays a thin controller. The extract/enrich/persist orchestrator
lives in ``routes/extraction.py``.
"""

from fastapi import APIRouter, BackgroundTasks, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

from app import storage
from app.models import Annotation, Doc, DocPatch, DocStructure, Library
from app.routes._errors import error_response, storage_errors
from app.routes.extraction import run_extraction

router = APIRouter(tags=["docs"])


@router.post("/docs", response_model=Doc)
async def upload_doc(background_tasks: BackgroundTasks, file: UploadFile = File(...)) -> Doc:
    """Import an uploaded PDF; return its ``doc_id`` + metadata immediately.

    A **new** import lands at ``status="extracting"`` and returns at once; the
    ``extract`` -> ``enrich`` -> persist pipeline runs off the request path as a
    background task (NFR-3). An idempotent re-import keeps its settled status
    and does not re-extract.
    """
    raw = await file.read()
    try:
        doc_id, meta = storage.import_pdf(raw, file.filename or "untitled.pdf")
    except storage.InvalidPDFError as exc:
        # Developer-facing detail; the client renders fixed user copy.
        raise HTTPException(status_code=400, detail="Could not read PDF file") from exc
    except storage.StorageError as exc:
        # Any other storage failure (corrupt/unknown-version metadata, I/O):
        # still answer with the single { detail } envelope, never a bare 500.
        raise HTTPException(status_code=500, detail="Could not store document") from exc
    if meta.status == "extracting":
        background_tasks.add_task(run_extraction, doc_id, raw)
    return Doc(doc_id=doc_id, **meta.model_dump())


@router.get(
    "/docs/{doc_id}",
    response_model=Doc,
    responses={
        404: error_response("No document with this id."),
        500: error_response("The stored document is unreadable."),
    },
)
async def get_doc(doc_id: str) -> Doc:
    """Return a document's own metadata (filename, page_count, ...) (AD-L6).

    Unknown/unresolvable id → 404; a corrupt on-disk record → 500. Both use the
    single ``{ "detail" }`` envelope (AR-11).
    """
    with storage_errors("Could not read document"):
        meta = storage.read_meta(doc_id)
    return Doc(doc_id=doc_id, **meta.model_dump())


@router.patch(
    "/docs/{doc_id}",
    response_model=Doc,
    responses={
        400: error_response("No fields to update."),
        404: error_response("No document with this id."),
        500: error_response("The document could not be updated."),
    },
)
async def patch_doc(doc_id: str, patch: DocPatch) -> Doc:
    """Partially update a document's ``title``/``authors_list``/``venue``/
    ``year`` (Story 6.6; ``venue``/``year`` added by a Story 7.9 fix request;
    ``authors`` -> ``authors_list`` in Story 7.11, AD-L6).

    Only fields present in the request body change (``exclude_unset``); an
    empty body -> 400. A malformed/forbidden field (e.g. ``status``, ``doi``)
    is rejected by ``DocPatch`` itself as FastAPI's standard 422. Unknown id
    -> 404; a storage failure -> 500. Both use the single ``{ "detail" }``
    envelope (AR-11). Editing never touches ``status``/``page_count``/
    ``added``/``last_opened``.
    """
    updates = patch.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    for field in ("title", "venue"):
        if field in updates and updates[field] is not None:
            updates[field] = updates[field].strip() or None
    if updates.get("authors_list") is not None:
        # An empty resulting list is a legitimate "cleared authors" edit, not
        # a no-op (the model derives `authors=None` from it).
        updates["authors_list"] = [a.strip() for a in updates["authors_list"] if a.strip()]
    with storage_errors("Could not update document"):
        meta = storage.update_doc_meta(doc_id, updates)
    return Doc(doc_id=doc_id, **meta.model_dump())


@router.delete(
    "/docs/{doc_id}",
    response_model=Library,
    responses={
        404: error_response("No document with this id."),
        500: error_response("Could not purge document."),
    },
)
async def purge_doc(doc_id: str) -> Library:
    """Permanently delete a document (Story 7.5 AC-4, AL-5.3, AL-6): removes
    the whole ``library/{doc_id}/`` dir (source PDF + annotations + meta) AND
    its ``library.json`` entry. Manual only -- no auto-purge, no undo. Unknown
    or already-purged id -> 404 ``"Document not found"``. Returns the whole
    updated ``Library`` in one round-trip."""
    with storage_errors("Could not purge document"):
        return storage.purge_document(doc_id)


@router.post(
    "/docs/{doc_id}/open",
    response_model=Doc,
    responses={
        404: error_response("No document with this id."),
        500: error_response("The document could not be updated."),
    },
)
async def mark_doc_opened(doc_id: str) -> Doc:
    """Advance ``meta.last_opened`` when a paper is opened from the Library (Story 6.7, AC-4/AC-9).

    A mutation, so ``POST`` rather than a side-effecting ``GET`` — ``GET
    /docs/{doc_id}`` stays a pure, side-effect-free read. Unknown id -> 404;
    a storage failure -> 500. Both use the single ``{ "detail" }`` envelope
    (AR-11). The client fires this as a best-effort side effect (AC-8); a
    failure here must never gate the reader opening the paper.
    """
    with storage_errors("Could not update document"):
        meta = storage.touch_last_opened(doc_id)
    return Doc(doc_id=doc_id, **meta.model_dump())


@router.get(
    "/docs/{doc_id}/file",
    response_class=FileResponse,
    responses={
        200: {
            "content": {"application/pdf": {}},
            "description": "The stored PDF bytes.",
        },
        404: error_response("No document with this id."),
        500: error_response("The stored document is unreadable."),
    },
)
async def get_doc_file(doc_id: str) -> FileResponse:
    """Stream a stored document's PDF bytes. Storage owns the path (AR-9).

    Unknown/unresolvable id → 404; a corrupt on-disk record → 500. Both use the
    single ``{ "detail" }`` envelope (AR-11).
    """
    with storage_errors("Could not read document"):
        path = storage.source_path(doc_id)
    return FileResponse(path, media_type="application/pdf")


@router.get(
    "/docs/{doc_id}/annotations",
    response_model=list[Annotation],
    responses={
        404: error_response("No document with this id."),
        500: error_response("The stored annotation set is unreadable."),
    },
)
async def get_annotations(doc_id: str) -> list[Annotation]:
    """Return a document's saved annotation set for hydrate-on-open (AR-6, H9).

    The response body is the bare list (H9); the on-disk envelope is stripped
    only inside storage. An imported-but-unannotated doc returns ``[]`` (200,
    not 404). Unknown/unresolvable id → 404; a corrupt or unknown-version disk
    file → 500. Both use the single ``{ "detail" }`` envelope (AR-11).
    """
    with storage_errors("Could not read annotations"):
        return storage.read_annotations(doc_id)


@router.get(
    "/docs/{doc_id}/structure",
    response_model=DocStructure,
    responses={
        404: error_response("No document with this id."),
        500: error_response("The stored structure is unreadable."),
    },
)
async def get_structure(doc_id: str) -> DocStructure:
    """Return a document's structure layer (AD-13, FR-34, Story 10.1).

    The typed, box-anchored elements opendataloader extracted at import. An
    imported-but-not-yet-analyzed doc (structure still running, or a non-PDF)
    returns ``{"elements": []}`` (200, not 404) -- the client polls/re-reads it.
    Unknown/unresolvable id -> 404; a corrupt or unknown-version disk file ->
    500. Both use the single ``{ "detail" }`` envelope (AR-11).
    """
    with storage_errors("Could not read structure"):
        return storage.read_structure(doc_id)


@router.put(
    "/docs/{doc_id}/annotations",
    response_model=list[Annotation],
    responses={
        404: error_response("No document with this id."),
        500: error_response("The annotation set could not be saved."),
    },
)
async def put_annotations(doc_id: str, annotations: list[Annotation]) -> list[Annotation]:
    """Overwrite the document's full annotation set, atomically (AR-7, H6).

    The request/response body is the bare list (H9); the on-disk envelope
    is added/stripped only inside storage. No history, undo, or merge here:
    this overwrites with exactly what it received.
    """
    with storage_errors("Could not save annotations"):
        storage.write_annotations(doc_id, annotations)
    return annotations
