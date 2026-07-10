"""Public per-document operations (AD-8, AD-9).

The document store's write/read surface: import (idempotent by ``doc_id`` =
SHA-256 hex of the raw bytes), the source-PDF path resolver, the meta reader,
and the three meta mutators (extraction settle, user edit, open-touch). Each
composes the leaf modules (``pdf``/``paths``/``meta_store``/``atomic``/
``library_index``); this module is where PDF parse + meta write + index refresh
come together.

Import is idempotent by ``doc_id``: re-importing the same bytes never
overwrites an existing ``annotations.json`` or resets ``meta.json`` — only
``meta.last_opened`` advances.
"""

import hashlib
import shutil
from pathlib import Path

from app.models import DocMeta, DocStatus, Library
from app.storage import library_index, meta_store, paper_org, paths
from app.storage.atomic import atomic_write
from app.storage.errors import DocumentNotFoundError, StorageError
from app.storage.meta_store import META_SCHEMA_VERSION
from app.storage.pdf import parse_pdf


def source_path(doc_id: str) -> Path:
    """Resolve a document's stored ``source.pdf`` path (AD-9: storage owns the root).

    Reuses ``paths.doc_dir`` for the same library-root containment guarantee.
    Raises ``DocumentNotFoundError`` when the id is unresolvable, the document
    has no valid ``meta.json`` record, or its ``source.pdf`` is absent — so
    routes never touch the filesystem and a stray ``source.pdf`` with no
    metadata is not served as if it were an imported document. A *corrupt*
    on-disk record still surfaces as its specific ``StorageError`` (not a 404).
    """
    try:
        doc_dir = paths.doc_dir(doc_id)
    except StorageError as exc:
        # An id that can't resolve inside the library root (e.g. a traversal
        # attempt) is, to the caller, simply not a known document.
        raise DocumentNotFoundError(f"unresolvable doc_id {doc_id!r}") from exc
    if meta_store.read(doc_dir) is None:
        raise DocumentNotFoundError(f"no document metadata for doc_id {doc_id!r}")
    source = doc_dir / "source.pdf"
    if not source.is_file():
        raise DocumentNotFoundError(f"no source.pdf for doc_id {doc_id!r}")
    return source


def read_meta(doc_id: str) -> DocMeta:
    """Read a document's own metadata for the ``GET /api/docs/{id}`` route (AD-L6).

    Reuses ``paths.doc_dir``/``meta_store.read`` directly, no PDF re-parse. Same
    error taxonomy as ``read_annotations``: ``DocumentNotFoundError`` for an id
    that doesn't resolve or has no valid ``meta.json``; ``StorageError``
    subclasses (``UnsupportedSchemaError``/``CorruptMetadataError``) propagate
    unchanged for a corrupt or unknown-version on-disk record.
    """
    try:
        doc_dir = paths.doc_dir(doc_id)
    except StorageError as exc:
        raise DocumentNotFoundError(f"unresolvable doc_id {doc_id!r}") from exc
    meta = meta_store.read(doc_dir)
    if meta is None:
        raise DocumentNotFoundError(f"no document metadata for doc_id {doc_id!r}")
    return meta


def import_pdf(raw_bytes: bytes, original_filename: str) -> tuple[str, DocMeta]:
    """Import a PDF and return ``(doc_id, DocMeta)``.

    Validates before writing anything. Idempotent by ``doc_id``: an existing
    document keeps its ``annotations.json``/``meta.json`` and only updates
    ``last_opened``. If the existing document was trashed, the re-import also
    restores it (clears ``trashed``, keeps its retained ``folder_id`` --
    Story 7.5 AC-5), rather than creating a duplicate row.
    """
    page_count, title = parse_pdf(raw_bytes)  # validate FIRST — no write on failure
    doc_id = hashlib.sha256(raw_bytes).hexdigest()
    doc_dir = paths.doc_dir(doc_id)
    now = paths.now_iso()

    existing = meta_store.read(doc_dir) if doc_dir.exists() else None
    if existing is not None:
        # Idempotent re-import: ensure source.pdf is present, bump last_opened only.
        source = doc_dir / "source.pdf"
        if not source.is_file():
            atomic_write(source, raw_bytes)
        updated = existing.model_copy(update={"last_opened": now})
        meta_store.write(doc_dir, updated)
        library_index.mutate_index(
            lambda index: library_index.upsert_paper_entry(index, doc_id, updated, restore=True)
        )
        return doc_id, updated

    # New document: lands at "extracting"; the route schedules the background
    # extract->enrich->apply_extraction pipeline off this status (AD-L4). Its
    # return signature is unchanged (tuple[str, DocMeta]) so no call-site
    # re-unpacks; the route reads meta.status to decide whether to schedule.
    atomic_write(doc_dir / "source.pdf", raw_bytes)
    meta = DocMeta(
        filename=original_filename,
        title=title,
        page_count=page_count,
        added=now,
        last_opened=now,
        status="extracting",
        schema_version=META_SCHEMA_VERSION,
    )
    meta_store.write(doc_dir, meta)
    library_index.mutate_index(lambda index: library_index.upsert_paper_entry(index, doc_id, meta))
    return doc_id, meta


def apply_extraction(
    doc_id: str,
    *,
    title: str | None,
    authors_list: list[str],
    status: DocStatus,
    doi: str | None,
    venue: str | None,
    year: int | None,
) -> None:
    """Persist a background extraction's result — the ONLY writer of it (AD-L2).

    ``authors_list`` is the domain's honest ``list[str]`` shape (Story 7.11);
    storage/the model derive the joined ``authors`` display string from it
    (moved out of the extraction route, aligning code with this docstring's
    long-standing claim). A doc purged mid-extraction raises
    ``DocumentNotFoundError``; the orchestrator swallows it (best-effort,
    never a crash). Storage imports nothing from ``domain``.
    """
    library_index.update_meta_and_reindex(
        doc_id,
        {
            "title": title,
            "authors_list": authors_list,
            "status": status,
            "doi": doi,
            "venue": venue,
            "year": year,
        },
    )


def update_doc_meta(doc_id: str, updates: dict[str, str | int | list[str] | None]) -> DocMeta:
    """Persist a user-driven title/authors/venue/year edit (Story 6.6, AC-2/
    AC-8/AC-9; venue/year added by a Story 7.9 fix request; ``authors`` ->
    ``authors_list`` in Story 7.11).

    ``updates`` keys are ⊆ ``{"title", "authors_list", "venue", "year"}``; the
    string fields are already normalized (``.strip()``, empty -> ``None``)
    by the route. Reuses the same
    re-read/TOCTOU-guard/write/reindex core as ``apply_extraction`` — never a
    second copy of that dance. Raises ``DocumentNotFoundError`` for an
    unresolvable id, a missing ``meta.json``, or a dir purged mid-write.
    """
    return library_index.update_meta_and_reindex(doc_id, updates)


def touch_last_opened(doc_id: str) -> DocMeta:
    """Advance ``meta.last_opened`` when a paper is opened from the Library (Story 6.7, AC-4).

    Only ``last_opened`` changes; every other field is preserved. Reuses the
    shared ``update_meta_and_reindex`` core (Story 6.6), so it inherits the
    same re-read/TOCTOU-guard/write/reindex behavior: raises
    ``DocumentNotFoundError`` for an unknown or purged doc_id, and never
    resurrects a dir purged mid-write (``create_parents=False`` + the
    ``doc_dir.is_dir()`` re-check).

    ``import_pdf``'s idempotent re-import already bumps ``last_opened`` too,
    but opening from the Library navigates rather than re-imports, so the
    open path needs its own touch — this is that touch.
    """
    return library_index.update_meta_and_reindex(doc_id, {"last_opened": paths.now_iso()})


def purge_document(doc_id: str) -> Library:
    """Permanently delete a document (AL-5.3, AL-6): remove its whole
    ``library/{doc_id}/`` dir AND its ``library.json`` entry. Manual only, no
    auto-purge, no undo.

    Crash-safe order (do not invert): ``rmtree`` the dir FIRST, then prune the
    index entry, both under ``library_index._index_lock``. ``reconcile_library``
    treats an on-disk dir absent from the index as prunable, and an index
    entry whose dir vanished as a fresh Uncategorized add -- so pruning the
    entry before removing the dir would let a crash in between resurrect the
    purged paper on the next boot's reconcile. An unresolvable or already-gone
    doc_id raises ``DocumentNotFoundError``.
    """
    try:
        doc_dir = paths.doc_dir(doc_id)
    except StorageError as exc:
        raise DocumentNotFoundError(f"unresolvable doc_id {doc_id!r}") from exc
    with library_index._index_lock:
        if not doc_dir.is_dir():
            raise DocumentNotFoundError(f"no document with id {doc_id!r}")
        shutil.rmtree(doc_dir)
        return paper_org.purge_entry(doc_id)
