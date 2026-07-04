"""Documents route (AR-9, AR-11). Thin: no filesystem access, no domain logic.

``POST /api/docs`` imports a PDF by delegating to the storage module and
returns the ``Doc`` contract. A bad PDF becomes the single error envelope
``{ "detail": string }``. ``GET /api/docs/{doc_id}/file`` streams the stored
bytes. ``PUT /api/docs/{doc_id}/annotations`` overwrites the full annotation
set (AR-7, H9: bare list body, disk envelope is storage-internal).
``GET /api/docs/{doc_id}/annotations`` reads it back for hydrate-on-open
(Story 3.5; bare list, ``[]`` when unannotated). ``GET /api/docs/{doc_id}``
returns a document's own metadata (Story 6.1, AD-L6). Reserved (not built
here): ``GET /api/docs``.
"""

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

from app import storage
from app.models import Annotation, Doc

router = APIRouter(tags=["docs"])


@router.post("/docs", response_model=Doc)
async def upload_doc(file: UploadFile = File(...)) -> Doc:
    """Import an uploaded PDF; return its ``doc_id`` + metadata."""
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
    return Doc(doc_id=doc_id, **meta.model_dump())


@router.get(
    "/docs/{doc_id}",
    response_model=Doc,
    responses={
        404: {
            "description": "No document with this id.",
            "content": {
                "application/json": {"schema": {"$ref": "#/components/schemas/ErrorEnvelope"}}
            },
        },
        500: {
            "description": "The stored document is unreadable.",
            "content": {
                "application/json": {"schema": {"$ref": "#/components/schemas/ErrorEnvelope"}}
            },
        },
    },
)
async def get_doc(doc_id: str) -> Doc:
    """Return a document's own metadata (filename, page_count, ...) (AD-L6).

    Unknown/unresolvable id → 404; a corrupt on-disk record → 500. Both use the
    single ``{ "detail" }`` envelope (AR-11).
    """
    try:
        meta = storage.read_meta(doc_id)
    except storage.DocumentNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Document not found") from exc
    except storage.StorageError as exc:
        raise HTTPException(status_code=500, detail="Could not read document") from exc
    return Doc(doc_id=doc_id, **meta.model_dump())


@router.get(
    "/docs/{doc_id}/file",
    response_class=FileResponse,
    responses={
        200: {
            "content": {"application/pdf": {}},
            "description": "The stored PDF bytes.",
        },
        404: {
            "description": "No document with this id.",
            "content": {
                "application/json": {"schema": {"$ref": "#/components/schemas/ErrorEnvelope"}}
            },
        },
        500: {
            "description": "The stored document is unreadable.",
            "content": {
                "application/json": {"schema": {"$ref": "#/components/schemas/ErrorEnvelope"}}
            },
        },
    },
)
async def get_doc_file(doc_id: str) -> FileResponse:
    """Stream a stored document's PDF bytes. Storage owns the path (AR-9).

    Unknown/unresolvable id → 404; a corrupt on-disk record → 500. Both use the
    single ``{ "detail" }`` envelope (AR-11).
    """
    try:
        path = storage.source_path(doc_id)
    except storage.DocumentNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Document not found") from exc
    except storage.StorageError as exc:
        raise HTTPException(status_code=500, detail="Could not read document") from exc
    return FileResponse(path, media_type="application/pdf")


@router.get(
    "/docs/{doc_id}/annotations",
    response_model=list[Annotation],
    responses={
        404: {
            "description": "No document with this id.",
            "content": {
                "application/json": {"schema": {"$ref": "#/components/schemas/ErrorEnvelope"}}
            },
        },
        500: {
            "description": "The stored annotation set is unreadable.",
            "content": {
                "application/json": {"schema": {"$ref": "#/components/schemas/ErrorEnvelope"}}
            },
        },
    },
)
async def get_annotations(doc_id: str) -> list[Annotation]:
    """Return a document's saved annotation set for hydrate-on-open (AR-6, H9).

    The response body is the bare list (H9); the on-disk envelope is stripped
    only inside storage. An imported-but-unannotated doc returns ``[]`` (200,
    not 404). Unknown/unresolvable id → 404; a corrupt or unknown-version disk
    file → 500. Both use the single ``{ "detail" }`` envelope (AR-11).
    """
    try:
        return storage.read_annotations(doc_id)
    except storage.DocumentNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Document not found") from exc
    except storage.StorageError as exc:
        raise HTTPException(status_code=500, detail="Could not read annotations") from exc


@router.put(
    "/docs/{doc_id}/annotations",
    response_model=list[Annotation],
    responses={
        404: {
            "description": "No document with this id.",
            "content": {
                "application/json": {"schema": {"$ref": "#/components/schemas/ErrorEnvelope"}}
            },
        },
        500: {
            "description": "The annotation set could not be saved.",
            "content": {
                "application/json": {"schema": {"$ref": "#/components/schemas/ErrorEnvelope"}}
            },
        },
    },
)
async def put_annotations(doc_id: str, annotations: list[Annotation]) -> list[Annotation]:
    """Overwrite the document's full annotation set, atomically (AR-7, H6).

    The request/response body is the bare list (H9); the on-disk envelope
    is added/stripped only inside storage. No history, undo, or merge here:
    this overwrites with exactly what it received.
    """
    try:
        storage.write_annotations(doc_id, annotations)
    except storage.DocumentNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Document not found") from exc
    except storage.StorageError as exc:
        raise HTTPException(status_code=500, detail="Could not save annotations") from exc
    return annotations
