"""Documents route (AR-9, AR-11). Thin: no filesystem access, no domain logic.

``POST /api/docs`` imports a PDF by delegating to the storage module and
returns the ``Doc`` contract. A bad PDF becomes the single error envelope
``{ "detail": string }``. Reserved (not built here): ``GET /api/docs``,
``GET /api/docs/{doc_id}``, ``GET /api/docs/{doc_id}/file``,
``/api/docs/{doc_id}/annotations``.
"""

from fastapi import APIRouter, File, HTTPException, UploadFile

from app import storage
from app.models import Doc

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
