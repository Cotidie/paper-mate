"""The collection index: ``library.json`` (AD-L1/AD-L7, Story 6.2).

``library.json`` is the authoritative cross-doc index (folder tree, membership,
trash, order) plus a non-authoritative meta-derived display cache, refreshed on
every write. Every mutation is a serialized read-modify-write under ONE
process-level lock (AD-L7); reads are lock-free — the atomic temp+rename write
means a reader always sees a complete old-or-new file, never a torn one.

This module also homes ``update_meta_and_reindex`` — the shared write core that
re-reads ``meta.json``, applies an update, guards the purge TOCTOU, writes, and
refreshes the index cache under the same lock. It composes ``meta_store`` (calls
are module-qualified so a test can monkeypatch ``meta_store.read`` and have the
production TOCTOU path exercise the patched name).
"""

import json
import threading
from collections.abc import Callable

from pydantic import ValidationError

from app.models import CollectionRow, DocMeta, Folder, Library
from app.storage import meta_store, paths
from app.storage.atomic import atomic_write
from app.storage.errors import CorruptLibraryError, DocumentNotFoundError, StorageError

#: Current ``library.json`` schema version (AD-L1). Additive-only evolution.
LIBRARY_SCHEMA_VERSION = 1

#: One process-level lock serializes every ``library.json`` read-modify-write.
_index_lock = threading.RLock()


def _default_index() -> dict:
    return {"schema_version": LIBRARY_SCHEMA_VERSION, "folders": [], "papers": []}


def _read_index_unlocked() -> dict:
    path = paths.library_path()
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
    atomic_write(paths.library_path(), json.dumps(index, indent=2).encode("utf-8"))


def mutate_index(mutator: Callable[[dict], dict]) -> dict:
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


def upsert_paper_entry(index: dict, doc_id: str, meta: DocMeta) -> dict:
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
        library_dir = paths.data_root() / "library"
        on_disk_ids: set[str] = set()
        if library_dir.is_dir():
            on_disk_ids = {child.name for child in library_dir.iterdir() if child.is_dir()}

        papers[:] = [entry for entry in papers if entry["doc_id"] in on_disk_ids]

        for entry in papers:
            try:
                meta = meta_store.read(library_dir / entry["doc_id"])
            except StorageError:
                continue  # missing/corrupt meta.json — best-effort skip
            if meta is None:
                continue
            entry.update(_cache_from_meta(meta))

        for doc_id in sorted(on_disk_ids - indexed_ids):
            try:
                meta = meta_store.read(library_dir / doc_id)
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

    mutate_index(_reconcile)


def update_meta_and_reindex(doc_id: str, updates: dict) -> DocMeta:
    """Shared core: re-read ``meta.json`` -> apply ``updates`` -> guard the
    purge TOCTOU -> write -> refresh the ``library.json`` display cache.

    Used by ``apply_extraction`` (background pipeline result), ``update_doc_meta``
    (user-driven title/authors edit, Story 6.6), and ``touch_last_opened`` (open,
    Story 6.7) — the same re-read/guard/write/reindex dance with a different
    update dict, so it lives in one place (CLAUDE.md: don't duplicate a pattern).

    The whole re-read -> write -> reindex sequence runs under ``_index_lock``
    (``RLock``, so the nested ``mutate_index`` call doesn't self-deadlock):
    without it, two concurrent callers (e.g. a background extraction settling
    while the user's next open fires `touch_last_opened`) could each read the
    same pre-update snapshot and the second writer's read-then-write would
    silently discard the first writer's update (a lost-update race) — the
    re-read alone only protects against a STALE snapshot the caller fetched
    earlier, not against another concurrent call to this function.

    A doc purged mid-flight (its dir/``meta.json`` gone) raises
    ``DocumentNotFoundError``; callers decide whether that is fatal or a
    best-effort no-op.
    """
    with _index_lock:
        try:
            doc_dir = paths.doc_dir(doc_id)
        except StorageError as exc:
            raise DocumentNotFoundError(f"unresolvable doc_id {doc_id!r}") from exc
        current = meta_store.read(doc_dir)
        if current is None:
            raise DocumentNotFoundError(f"no document metadata for doc_id {doc_id!r}")
        updated = current.model_copy(update=updates)
        # Guard the TOCTOU window: a purge between the read above and the write
        # below must NOT recreate the dir (create_parents=False) and re-index a
        # meta-only ghost row. Re-check first so the common purge is a clean
        # DocumentNotFoundError, then only refresh the cache if the write landed.
        if not doc_dir.is_dir():
            raise DocumentNotFoundError(f"document dir gone for doc_id {doc_id!r}")
        meta_store.write(doc_dir, updated, create_parents=False)
        mutate_index(lambda index: upsert_paper_entry(index, doc_id, updated))
        return updated
