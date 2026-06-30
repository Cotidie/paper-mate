"""Storage module — the ONLY code that touches the data root (AD-8, AD-9).

Owns: PDF identity (``doc_id`` = SHA-256 hex of the raw bytes), the
``library/{doc_id}/`` layout, ``meta.json`` (storage-owned schema), and atomic
writes (temp file in the same dir + ``os.replace``). Routes never call the
filesystem directly; they go through here.

Import is idempotent by ``doc_id``: re-importing the same bytes never
overwrites an existing ``annotations.json`` or resets ``meta.json`` — only
``meta.last_opened`` advances.
"""

import hashlib
import json
import os
import tempfile
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path

from pydantic import ValidationError
from pypdf import PdfReader

from app.models import Annotation, DocMeta

#: Current ``meta.json`` schema version. Unknown versions are rejected, not guessed.
META_SCHEMA_VERSION = 1

#: Current ``annotations.json`` schema version (H9: disk envelope, API body is bare).
ANNOTATIONS_SCHEMA_VERSION = 1


class StorageError(Exception):
    """Base class for storage-layer failures."""


class InvalidPDFError(StorageError):
    """The uploaded bytes are not a readable PDF."""


class UnsupportedSchemaError(StorageError):
    """An on-disk file carries a ``schema_version`` this code cannot handle."""


class CorruptMetadataError(StorageError):
    """An on-disk ``meta.json`` is unreadable or has an invalid shape."""


class DocumentNotFoundError(StorageError):
    """No imported document (or its ``source.pdf``) exists for the given ``doc_id``."""


def _data_root() -> Path:
    """Resolve the storage root: ``PAPER_MATE_DATA`` env, default ``~/.paper-mate``.

    The container sets ``PAPER_MATE_DATA=/data`` (the host volume mount).
    """
    raw = os.environ.get("PAPER_MATE_DATA") or str(Path.home() / ".paper-mate")
    return Path(raw).resolve()


def _doc_dir(doc_id: str) -> Path:
    """Resolve ``library/{doc_id}/`` and contain it inside the data root.

    ``doc_id`` is a SHA-256 hex digest (fixed charset, not user input), but we
    still verify containment so the data root can never be escaped.
    """
    library = (_data_root() / "library").resolve()
    candidate = (library / doc_id).resolve()
    if not candidate.is_relative_to(library):
        raise StorageError("resolved document path escapes the library root")
    return candidate


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _fsync_dir(directory: Path) -> None:
    """Flush a directory entry so a rename survives a crash (best-effort).

    Some platforms/filesystems disallow opening a dir for fsync; ignore those.
    """
    try:
        dir_fd = os.open(directory, os.O_RDONLY)
    except OSError:
        return
    try:
        os.fsync(dir_fd)
    except OSError:
        pass
    finally:
        os.close(dir_fd)


def _atomic_write(path: Path, data: bytes) -> None:
    """Write ``data`` to ``path`` atomically (temp in same dir + rename).

    Filesystem failures (disk full, permissions, ...) are wrapped as
    ``StorageError`` so every caller's existing ``except StorageError``
    mapping (the API's single ``{ detail }`` envelope, AR-11) catches them
    instead of letting a raw ``OSError`` bypass it.
    """
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp_name = tempfile.mkstemp(dir=path.parent, prefix=".tmp-", suffix=path.suffix)
    except OSError as exc:
        raise StorageError(f"could not prepare write to {path}: {exc}") from exc
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp_name, path)
        _fsync_dir(path.parent)
    except OSError as exc:
        # Never leave a partial temp file behind.
        try:
            os.unlink(tmp_name)
        except FileNotFoundError:
            pass
        raise StorageError(f"could not write {path}: {exc}") from exc
    except BaseException:
        try:
            os.unlink(tmp_name)
        except FileNotFoundError:
            pass
        raise


def _parse_pdf(raw_bytes: bytes) -> tuple[int, str | None]:
    """Validate the bytes as a PDF and extract ``(page_count, title)``.

    Any parse failure (non-PDF, corrupt, empty) is surfaced as InvalidPDFError.
    """
    try:
        reader = PdfReader(BytesIO(raw_bytes))
        page_count = len(reader.pages)
        if page_count < 1:
            raise InvalidPDFError("PDF has no pages")
        meta = reader.metadata
        title = str(meta.title) if meta and meta.title else None
    except InvalidPDFError:
        raise
    except Exception as exc:  # pypdf raises a variety of read errors
        raise InvalidPDFError(str(exc)) from exc
    return page_count, title


def _read_meta(doc_dir: Path) -> DocMeta | None:
    meta_path = doc_dir / "meta.json"
    if not meta_path.is_file():
        return None
    try:
        payload = json.loads(meta_path.read_text())
    except (json.JSONDecodeError, OSError) as exc:
        raise CorruptMetadataError(f"unreadable meta.json: {exc}") from exc
    version = payload.get("schema_version") if isinstance(payload, dict) else None
    if version != META_SCHEMA_VERSION:
        raise UnsupportedSchemaError(f"unknown meta schema_version: {version!r}")
    try:
        return DocMeta.model_validate(payload)
    except ValidationError as exc:
        raise CorruptMetadataError(f"invalid meta.json shape: {exc}") from exc


def _write_meta(doc_dir: Path, meta: DocMeta) -> None:
    _atomic_write(doc_dir / "meta.json", meta.model_dump_json(indent=2).encode("utf-8"))


def source_path(doc_id: str) -> Path:
    """Resolve a document's stored ``source.pdf`` path (AD-9: storage owns the root).

    Reuses ``_doc_dir`` for the same library-root containment guarantee. Raises
    ``DocumentNotFoundError`` when the id is unresolvable, the document has no
    valid ``meta.json`` record, or its ``source.pdf`` is absent — so routes never
    touch the filesystem and a stray ``source.pdf`` with no metadata is not
    served as if it were an imported document. A *corrupt* on-disk record still
    surfaces as its specific ``StorageError`` (not a 404).
    """
    try:
        doc_dir = _doc_dir(doc_id)
    except StorageError as exc:
        # An id that can't resolve inside the library root (e.g. a traversal
        # attempt) is, to the caller, simply not a known document.
        raise DocumentNotFoundError(f"unresolvable doc_id {doc_id!r}") from exc
    if _read_meta(doc_dir) is None:
        raise DocumentNotFoundError(f"no document metadata for doc_id {doc_id!r}")
    source = doc_dir / "source.pdf"
    if not source.is_file():
        raise DocumentNotFoundError(f"no source.pdf for doc_id {doc_id!r}")
    return source


def import_pdf(raw_bytes: bytes, original_filename: str) -> tuple[str, DocMeta]:
    """Import a PDF and return ``(doc_id, DocMeta)``.

    Validates before writing anything. Idempotent by ``doc_id``: an existing
    document keeps its ``annotations.json``/``meta.json`` and only updates
    ``last_opened``.
    """
    page_count, title = _parse_pdf(raw_bytes)  # validate FIRST — no write on failure
    doc_id = hashlib.sha256(raw_bytes).hexdigest()
    doc_dir = _doc_dir(doc_id)
    now = _now_iso()

    existing = _read_meta(doc_dir) if doc_dir.exists() else None
    if existing is not None:
        # Idempotent re-import: ensure source.pdf is present, bump last_opened only.
        source = doc_dir / "source.pdf"
        if not source.is_file():
            _atomic_write(source, raw_bytes)
        updated = existing.model_copy(update={"last_opened": now})
        _write_meta(doc_dir, updated)
        return doc_id, updated

    # New document.
    _atomic_write(doc_dir / "source.pdf", raw_bytes)
    meta = DocMeta(
        filename=original_filename,
        title=title,
        page_count=page_count,
        added=now,
        last_opened=now,
        schema_version=META_SCHEMA_VERSION,
    )
    _write_meta(doc_dir, meta)
    return doc_id, meta


def write_annotations(doc_id: str, annotations: list[Annotation]) -> None:
    """Overwrite ``library/{doc_id}/annotations.json`` with the full given set.

    AR-7 / H9: the disk file carries the envelope ``{schema_version,
    annotations}``; the API body (caller's ``annotations`` list) is bare. No
    history, merge, or partial update — every call replaces the whole file.
    Raises ``DocumentNotFoundError`` for a doc_id with no valid ``meta.json``,
    so a never-imported document never gets an annotations file.
    """
    try:
        doc_dir = _doc_dir(doc_id)
    except StorageError as exc:
        raise DocumentNotFoundError(f"unresolvable doc_id {doc_id!r}") from exc
    if _read_meta(doc_dir) is None:
        raise DocumentNotFoundError(f"no document metadata for doc_id {doc_id!r}")
    payload = {
        "schema_version": ANNOTATIONS_SCHEMA_VERSION,
        "annotations": [a.model_dump(mode="json") for a in annotations],
    }
    _atomic_write(doc_dir / "annotations.json", json.dumps(payload, indent=2).encode("utf-8"))
