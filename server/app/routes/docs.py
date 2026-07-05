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
"""

from fastapi import APIRouter, BackgroundTasks, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

from app import domain, storage
from app.models import Annotation, Doc, DocPatch, ExtractedMeta

router = APIRouter(tags=["docs"])


def run_extraction(doc_id: str, pdf_bytes: bytes) -> None:
    """Background orchestrator (AD-L2 composition root): extract -> enrich ->
    persist. Runs as a **sync** FastAPI background task (Starlette's threadpool,
    off the event loop) — correct for CPU-bound PyMuPDF + sync httpx.

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
        authors = ", ".join(final.authors) or None  # storage owns list->display
        try:
            storage.apply_extraction(doc_id, title=final.title, authors=authors, status=status)
        except storage.DocumentNotFoundError:
            pass  # purged mid-flight — best-effort no-op
    except Exception:
        # Never leave the row stuck at "extracting" (the client would poll to
        # its cap and give up on a permanently-muted row). Settle it as failed.
        try:
            storage.apply_extraction(doc_id, title=None, authors=None, status="parse-failed")
        except storage.StorageError:
            pass


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


@router.patch(
    "/docs/{doc_id}",
    response_model=Doc,
    responses={
        400: {
            "description": "No fields to update.",
            "content": {
                "application/json": {"schema": {"$ref": "#/components/schemas/ErrorEnvelope"}}
            },
        },
        404: {
            "description": "No document with this id.",
            "content": {
                "application/json": {"schema": {"$ref": "#/components/schemas/ErrorEnvelope"}}
            },
        },
        500: {
            "description": "The document could not be updated.",
            "content": {
                "application/json": {"schema": {"$ref": "#/components/schemas/ErrorEnvelope"}}
            },
        },
    },
)
async def patch_doc(doc_id: str, patch: DocPatch) -> Doc:
    """Partially update a document's ``title``/``authors`` (Story 6.6, AD-L6).

    Only fields present in the request body change (``exclude_unset``); an
    empty body -> 400. A malformed/forbidden field (e.g. ``status``) is
    rejected by ``DocPatch`` itself as FastAPI's standard 422. Unknown id ->
    404; a storage failure -> 500. Both use the single ``{ "detail" }``
    envelope (AR-11). Editing never touches ``status``/``page_count``/
    ``added``/``last_opened``.
    """
    updates = patch.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    for field in ("title", "authors"):
        if field in updates and updates[field] is not None:
            updates[field] = updates[field].strip() or None
    try:
        meta = storage.update_doc_meta(doc_id, updates)
    except storage.DocumentNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Document not found") from exc
    except storage.StorageError as exc:
        raise HTTPException(status_code=500, detail="Could not update document") from exc
    return Doc(doc_id=doc_id, **meta.model_dump())


@router.post(
    "/docs/{doc_id}/open",
    response_model=Doc,
    responses={
        404: {
            "description": "No document with this id.",
            "content": {
                "application/json": {"schema": {"$ref": "#/components/schemas/ErrorEnvelope"}}
            },
        },
        500: {
            "description": "The document could not be updated.",
            "content": {
                "application/json": {"schema": {"$ref": "#/components/schemas/ErrorEnvelope"}}
            },
        },
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
    try:
        meta = storage.touch_last_opened(doc_id)
    except storage.DocumentNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Document not found") from exc
    except storage.StorageError as exc:
        raise HTTPException(status_code=500, detail="Could not update document") from exc
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
