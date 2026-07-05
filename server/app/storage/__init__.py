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
import threading
from collections.abc import Callable
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path

from pydantic import ValidationError
from pypdf import PdfReader

from app.models import Annotation, CollectionRow, DocMeta, DocStatus, Folder, Library

#: Current ``meta.json`` schema version. Unknown versions are rejected, not guessed.
META_SCHEMA_VERSION = 1

#: Current ``annotations.json`` schema version (H9: disk envelope, API body is bare).
ANNOTATIONS_SCHEMA_VERSION = 1

#: Current ``library.json`` schema version (AD-L1). Additive-only evolution.
LIBRARY_SCHEMA_VERSION = 1


class StorageError(Exception):
    """Base class for storage-layer failures."""


class InvalidPDFError(StorageError):
    """The uploaded bytes are not a readable PDF."""


class UnsupportedSchemaError(StorageError):
    """An on-disk file carries a ``schema_version`` this code cannot handle."""


class CorruptMetadataError(StorageError):
    """An on-disk ``meta.json`` is unreadable or has an invalid shape."""


class CorruptAnnotationsError(StorageError):
    """An on-disk ``annotations.json`` is unreadable or has an invalid shape.

    A distinct fault from ``CorruptMetadataError`` (a precise taxonomy for
    future logging/handling); both are ``StorageError`` so the route maps them
    to the single 500 envelope with no extra handling.
    """


class DocumentNotFoundError(StorageError):
    """No imported document (or its ``source.pdf``) exists for the given ``doc_id``."""


class CorruptLibraryError(StorageError):
    """An on-disk ``library.json`` is unreadable or has an invalid shape."""


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


def _library_path() -> Path:
    """Resolve ``~/.paper-mate/library.json`` — a sibling of ``library/``, not
    inside it (the collection index is not a per-doc artifact)."""
    return _data_root() / "library.json"


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


def _atomic_write(path: Path, data: bytes, *, create_parents: bool = True) -> None:
    """Write ``data`` to ``path`` atomically (temp in same dir + rename).

    Filesystem failures (disk full, permissions, ...) are wrapped as
    ``StorageError`` so every caller's existing ``except StorageError``
    mapping (the API's single ``{ detail }`` envelope, AR-11) catches them
    instead of letting a raw ``OSError`` bypass it.

    ``create_parents=False`` refuses to (re)create the parent directory — an
    update path (e.g. ``apply_extraction``) uses it so a doc purged mid-write
    is NOT resurrected as a meta-only ghost; a missing parent then surfaces as
    ``StorageError`` rather than silently recreating the dir.
    """
    try:
        if create_parents:
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


def _write_meta(doc_dir: Path, meta: DocMeta, *, create_parents: bool = True) -> None:
    _atomic_write(
        doc_dir / "meta.json",
        meta.model_dump_json(indent=2).encode("utf-8"),
        create_parents=create_parents,
    )


# --- Collection index: library.json (AD-L1/AD-L7, Story 6.2) ---------------
#
# ``library.json`` is the authoritative cross-doc index (folder tree,
# membership, trash, order) plus a non-authoritative meta-derived display
# cache, refreshed on every write. Every mutation is a serialized
# read-modify-write under one process-level lock (AD-L7); reads are
# lock-free — the atomic temp+rename write means a reader always sees a
# complete old-or-new file, never a torn one.

_index_lock = threading.Lock()


def _default_index() -> dict:
    return {"schema_version": LIBRARY_SCHEMA_VERSION, "folders": [], "papers": []}


def _read_index_unlocked() -> dict:
    path = _library_path()
    if not path.is_file():
        return _default_index()
    try:
        payload = json.loads(path.read_text())
    except (json.JSONDecodeError, OSError) as exc:
        raise CorruptLibraryError(f"unreadable library.json: {exc}") from exc
    if not isinstance(payload, dict):
        raise CorruptLibraryError("library.json is not an object")
    version = payload.get("schema_version")
    if version != LIBRARY_SCHEMA_VERSION:
        raise CorruptLibraryError(f"unknown library schema_version: {version!r}")
    if not isinstance(payload.get("folders"), list) or not isinstance(payload.get("papers"), list):
        raise CorruptLibraryError("library.json has an invalid shape")
    # Every mutator below does raw dict access on these two org-authoritative
    # keys (doc_id/order) before a row ever reaches read_library's Pydantic
    # validation; check them here so a hand-corrupted file surfaces as
    # CorruptLibraryError, never a raw KeyError escaping the StorageError
    # taxonomy (AR-11 single envelope, AC-4 reconcile must never crash boot).
    for entry in payload["papers"]:
        if not isinstance(entry, dict) or "doc_id" not in entry or "order" not in entry:
            raise CorruptLibraryError("library.json has a malformed paper entry")
    return payload


def _write_index(index: dict) -> None:
    _atomic_write(_library_path(), json.dumps(index, indent=2).encode("utf-8"))


def _mutate_index(mutator: Callable[[dict], dict]) -> dict:
    """Serialize one read-modify-write of the whole index (AL-7).

    Every ``library.json`` write goes through this single path: acquire the
    process-level lock, read the current index (or a fresh default), let
    ``mutator`` update it in place, then commit atomically.
    """
    with _index_lock:
        index = mutator(_read_index_unlocked())
        _write_index(index)
        return index


def _cache_from_meta(meta: DocMeta) -> dict:
    """Project a ``DocMeta`` to the display-cache fields cached in a paper's
    ``library.json`` entry (meta always wins on conflict, AC-2)."""
    return {
        "title": meta.title,
        "authors": meta.authors,
        "added": meta.added,
        "file_type": meta.file_type,
        "status": meta.status,
        "filename": meta.filename,
    }


def _next_order(papers: list[dict]) -> int:
    return max((p["order"] for p in papers), default=-1) + 1


def _upsert_paper_entry(index: dict, doc_id: str, meta: DocMeta) -> dict:
    """Insert or refresh a paper's ``library.json`` entry from its meta.

    A new import appends an Uncategorized/untrashed entry at the next order.
    An idempotent re-import only refreshes the cache, leaving an existing
    ``folder_id``/``trashed``/``order`` untouched.
    """
    papers = index["papers"]
    for entry in papers:
        if entry["doc_id"] == doc_id:
            entry.update(_cache_from_meta(meta))
            return index
    papers.append(
        {
            "doc_id": doc_id,
            "folder_id": None,
            "trashed": False,
            "order": _next_order(papers),
            **_cache_from_meta(meta),
        }
    )
    return index


def read_library() -> Library:
    """Read the collection in one lock-free read (AC-3).

    Projects straight from ``library.json``'s stored display cache — no
    ``meta.json`` fan-out (that is the whole point of the cache, LNFR-4).
    An absent file is an empty collection, not an error.
    """
    index = _read_index_unlocked()
    try:
        papers = [CollectionRow.model_validate(p) for p in index["papers"]]
        folders = [Folder.model_validate(f) for f in index["folders"]]
    except (ValidationError, TypeError, KeyError) as exc:
        raise CorruptLibraryError(f"invalid library.json shape: {exc}") from exc
    return Library(papers=papers, folders=folders)


def reconcile_library() -> None:
    """Align ``library.json`` with what is actually on disk (AC-4).

    A ``library/{doc_id}/`` dir absent from the index is added as
    Uncategorized (its cache built from its ``meta.json``); an index entry
    whose dir has vanished is pruned. A dir already indexed has its display
    cache refreshed from its current ``meta.json`` (honors the "refreshed on
    every index write" invariant for entries cached before a cache field
    existed, e.g. `filename`). Best-effort: a dir whose ``meta.json`` is
    missing or corrupt is skipped, never fatal. Idempotent.
    """

    def _reconcile(index: dict) -> dict:
        papers = index["papers"]
        indexed_ids = {entry["doc_id"] for entry in papers}
        library_dir = _data_root() / "library"
        on_disk_ids: set[str] = set()
        if library_dir.is_dir():
            on_disk_ids = {child.name for child in library_dir.iterdir() if child.is_dir()}

        papers[:] = [entry for entry in papers if entry["doc_id"] in on_disk_ids]

        for entry in papers:
            try:
                meta = _read_meta(library_dir / entry["doc_id"])
            except StorageError:
                continue  # missing/corrupt meta.json — best-effort skip
            if meta is None:
                continue
            entry.update(_cache_from_meta(meta))

        for doc_id in sorted(on_disk_ids - indexed_ids):
            try:
                meta = _read_meta(library_dir / doc_id)
            except StorageError:
                continue  # missing/corrupt meta.json — best-effort skip
            if meta is None:
                continue
            papers.append(
                {
                    "doc_id": doc_id,
                    "folder_id": None,
                    "trashed": False,
                    "order": _next_order(papers),
                    **_cache_from_meta(meta),
                }
            )
        return index

    _mutate_index(_reconcile)


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


def read_meta(doc_id: str) -> DocMeta:
    """Read a document's own metadata for the ``GET /api/docs/{id}`` route (AD-L6).

    Reuses ``_doc_dir``/``_read_meta`` directly, no PDF re-parse. Same error
    taxonomy as ``read_annotations``: ``DocumentNotFoundError`` for an id that
    doesn't resolve or has no valid ``meta.json``; ``StorageError`` subclasses
    (``UnsupportedSchemaError``/``CorruptMetadataError``) propagate unchanged
    for a corrupt or unknown-version on-disk record.
    """
    try:
        doc_dir = _doc_dir(doc_id)
    except StorageError as exc:
        raise DocumentNotFoundError(f"unresolvable doc_id {doc_id!r}") from exc
    meta = _read_meta(doc_dir)
    if meta is None:
        raise DocumentNotFoundError(f"no document metadata for doc_id {doc_id!r}")
    return meta


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
        _mutate_index(lambda index: _upsert_paper_entry(index, doc_id, updated))
        return doc_id, updated

    # New document: lands at "extracting"; the route schedules the background
    # extract->enrich->apply_extraction pipeline off this status (AD-L4). Its
    # return signature is unchanged (tuple[str, DocMeta]) so no call-site
    # re-unpacks; the route reads meta.status to decide whether to schedule.
    _atomic_write(doc_dir / "source.pdf", raw_bytes)
    meta = DocMeta(
        filename=original_filename,
        title=title,
        page_count=page_count,
        added=now,
        last_opened=now,
        status="extracting",
        schema_version=META_SCHEMA_VERSION,
    )
    _write_meta(doc_dir, meta)
    _mutate_index(lambda index: _upsert_paper_entry(index, doc_id, meta))
    return doc_id, meta


def apply_extraction(
    doc_id: str,
    *,
    title: str | None,
    authors: str | None,
    status: DocStatus,
) -> None:
    """Persist a background extraction's result — the ONLY writer of it (AD-L2).

    Re-reads the current ``meta.json`` first (so a stale in-flight snapshot
    can't clobber a concurrent ``last_opened`` write), applies the resolved
    ``title``/``authors``/``status``, writes it back, and refreshes the
    ``library.json`` display cache through the serialized index-write path
    (``_mutate_index`` under ``_index_lock``, AD-L7). ``authors`` is the
    display string (storage owns the domain ``list[str]`` -> ``str`` join).

    A doc purged mid-extraction (its dir/``meta.json`` gone) raises
    ``DocumentNotFoundError``; the orchestrator swallows it (best-effort, never
    a crash). Storage imports nothing from ``domain``.
    """
    try:
        doc_dir = _doc_dir(doc_id)
    except StorageError as exc:
        raise DocumentNotFoundError(f"unresolvable doc_id {doc_id!r}") from exc
    current = _read_meta(doc_dir)
    if current is None:
        raise DocumentNotFoundError(f"no document metadata for doc_id {doc_id!r}")
    updated = current.model_copy(update={"title": title, "authors": authors, "status": status})
    # Guard the TOCTOU window: a purge between the read above and the write
    # below must NOT recreate the dir (create_parents=False) and re-index a
    # meta-only ghost row. Re-check first so the common purge is a clean
    # DocumentNotFoundError, then only refresh the cache if the write landed.
    if not doc_dir.is_dir():
        raise DocumentNotFoundError(f"document dir gone for doc_id {doc_id!r}")
    _write_meta(doc_dir, updated, create_parents=False)
    _mutate_index(lambda index: _upsert_paper_entry(index, doc_id, updated))


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


def read_annotations(doc_id: str) -> list[Annotation]:
    """Read ``library/{doc_id}/annotations.json`` and return the BARE list (H9).

    The READ mirror of ``write_annotations`` (Story 3.5, hydrate-on-open). Same
    error taxonomy as ``_read_meta``: an unknown ``schema_version`` or a
    corrupt/wrong-shape file is REJECTED, never guessed (AD-8). Strips the
    ``{schema_version, annotations}`` disk envelope and returns the annotations
    list; the caller (route/client) only ever sees the bare list.

    - ``DocumentNotFoundError`` for a doc_id that doesn't resolve or has no valid
      ``meta.json`` (a never-imported doc has no annotations to invent).
    - An imported-but-never-annotated doc (no ``annotations.json``) restores as
      an EMPTY list via a normal return — this is the common first-open case,
      NOT an error.
    - ``UnsupportedSchemaError`` for an unknown ``schema_version``;
      ``CorruptAnnotationsError`` for unreadable JSON or an invalid shape.
    """
    try:
        doc_dir = _doc_dir(doc_id)
    except StorageError as exc:
        raise DocumentNotFoundError(f"unresolvable doc_id {doc_id!r}") from exc
    if _read_meta(doc_dir) is None:
        raise DocumentNotFoundError(f"no document metadata for doc_id {doc_id!r}")
    annotations_path = doc_dir / "annotations.json"
    if not annotations_path.is_file():
        return []  # imported but never annotated — an empty set, not an error
    try:
        payload = json.loads(annotations_path.read_text())
    except (json.JSONDecodeError, OSError) as exc:
        raise CorruptAnnotationsError(f"unreadable annotations.json: {exc}") from exc
    version = payload.get("schema_version") if isinstance(payload, dict) else None
    if version != ANNOTATIONS_SCHEMA_VERSION:
        raise UnsupportedSchemaError(f"unknown annotations schema_version: {version!r}")
    raw = payload.get("annotations")
    if not isinstance(raw, list):
        raise CorruptAnnotationsError("annotations.json 'annotations' is not a list")
    try:
        parsed = [Annotation.model_validate(a) for a in raw]
    except ValidationError as exc:
        raise CorruptAnnotationsError(f"invalid annotations.json shape: {exc}") from exc
    # Collection-level integrity the client can't recover from silently: a
    # duplicate id would be collapsed by the store's id-keyed Map (last wins,
    # NFR-4 loss) and an entry belonging to another doc would restore into the
    # wrong reader. Reject both as corrupt rather than guess (AC-3/AC-5, AD-8).
    seen: set[str] = set()
    for ann in parsed:
        if ann.id in seen:
            raise CorruptAnnotationsError(f"duplicate annotation id {ann.id!r} in annotations.json")
        seen.add(ann.id)
        if ann.doc_id != doc_id:
            raise CorruptAnnotationsError(
                f"annotation {ann.id!r} doc_id {ann.doc_id!r} does not match {doc_id!r}"
            )
    return parsed
