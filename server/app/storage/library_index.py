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
import uuid
from collections.abc import Callable

from pydantic import ValidationError

from app.models import CollectionRow, DocMeta, Folder, Library
from app.storage import meta_store, paths
from app.storage.atomic import atomic_write
from app.storage.errors import (
    CorruptLibraryError,
    DocumentNotFoundError,
    FolderNotFoundError,
    StorageError,
)

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
    # Every mutator below does raw dict access on these org-authoritative keys
    # (doc_id/order, id/parent_id) before a row ever reaches read_library's
    # Pydantic validation; check them here so a hand-corrupted file surfaces as
    # CorruptLibraryError, never a raw KeyError escaping the StorageError
    # taxonomy (AR-11 single envelope, AC-4 reconcile must never crash boot).
    for entry in payload["papers"]:
        if not isinstance(entry, dict) or "doc_id" not in entry or "order" not in entry:
            raise CorruptLibraryError("library.json has a malformed paper entry")
    for entry in payload["folders"]:
        if not isinstance(entry, dict) or "id" not in entry or "parent_id" not in entry:
            raise CorruptLibraryError("library.json has a malformed folder entry")
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


def upsert_paper_entry(index: dict, doc_id: str, meta: DocMeta, *, restore: bool = False) -> dict:
    """Insert or refresh a paper's ``library.json`` entry from its meta.

    A new import appends an Uncategorized/untrashed entry at the next order.
    An idempotent re-import only refreshes the cache, leaving an existing
    ``folder_id``/``trashed``/``order`` untouched -- UNLESS ``restore=True``
    (Story 7.5 AC-5: a user re-upload of a trashed paper restores it), in
    which case ``trashed`` also clears while ``folder_id``/``order`` still
    stay intact (restore to the remembered folder). Only ``import_pdf``'s
    re-import branch passes ``restore=True``; a background extraction settle
    (``apply_extraction``) or ``reconcile_library`` must never resurrect a
    paper the user trashed mid-extraction, so they keep the default.
    """
    papers = index["papers"]
    for entry in papers:
        if entry["doc_id"] == doc_id:
            entry.update(_cache_from_meta(meta))
            if restore:
                entry["trashed"] = False
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


def _find_folder(folders: list[dict], folder_id: str) -> dict | None:
    return next((f for f in folders if f["id"] == folder_id), None)


def _subtree_ids(folders: list[dict], root_id: str) -> set[str]:
    """The target id plus every transitive descendant (walking ``parent_id``
    edges), for a subtree delete (AL-5)."""
    children_by_parent: dict[str | None, list[str]] = {}
    for f in folders:
        children_by_parent.setdefault(f["parent_id"], []).append(f["id"])
    ids = {root_id}
    frontier = [root_id]
    while frontier:
        for child_id in children_by_parent.get(frontier.pop(), []):
            if child_id not in ids:
                ids.add(child_id)
                frontier.append(child_id)
    return ids


def create_folder(name: str, parent_id: str | None) -> Folder:
    """Append a folder to the tree (AL-5, AL-7). ``parent_id``, if given, must
    reference an existing folder, else ``FolderNotFoundError``. A blank/
    whitespace ``name`` is rejected here too (``StorageError``), not just at
    the route's Pydantic boundary, so a direct storage caller can't persist one."""

    def _create(index: dict) -> dict:
        clean_name = name.strip()
        if not clean_name:
            raise StorageError("Folder name required")
        if parent_id is not None and _find_folder(index["folders"], parent_id) is None:
            raise FolderNotFoundError(f"no folder with id {parent_id!r}")
        index["folders"].append({"id": str(uuid.uuid4()), "name": clean_name, "parent_id": parent_id})
        return index

    index = mutate_index(_create)
    return Folder.model_validate(index["folders"][-1])


def rename_folder(folder_id: str, name: str) -> Folder:
    """Change only a folder's ``name`` (AL-5). Membership is keyed by id, so
    a rename never orphans a paper. Missing id -> ``FolderNotFoundError``. A
    blank/whitespace ``name`` -> ``StorageError`` (see ``create_folder``)."""

    def _rename(index: dict) -> dict:
        clean_name = name.strip()
        if not clean_name:
            raise StorageError("Folder name required")
        folder = _find_folder(index["folders"], folder_id)
        if folder is None:
            raise FolderNotFoundError(f"no folder with id {folder_id!r}")
        folder["name"] = clean_name
        return index

    index = mutate_index(_rename)
    return Folder.model_validate(_find_folder(index["folders"], folder_id))


def delete_folder(folder_id: str) -> Library:
    """Delete a folder and its whole subtree, re-homing every paper in it to
    Uncategorized (AL-5, ratifies PRD A1: NEVER delete a paper). Missing id ->
    ``FolderNotFoundError``. The removal + re-home run inside one ``mutate_index``
    mutator, so the subtree delete is atomic under ``_index_lock``."""

    def _delete(index: dict) -> dict:
        if _find_folder(index["folders"], folder_id) is None:
            raise FolderNotFoundError(f"no folder with id {folder_id!r}")
        removed = _subtree_ids(index["folders"], folder_id)
        index["folders"] = [f for f in index["folders"] if f["id"] not in removed]
        for paper in index["papers"]:
            if paper["folder_id"] in removed:
                paper["folder_id"] = None
        return index

    mutate_index(_delete)
    return read_library()


def move_papers(doc_ids: list[str], folder_id: str | None) -> Library:
    """Set-based move (AL-5, AL-6, AD-L6): assign every id in ``doc_ids`` to
    ``folder_id`` (``None`` clears membership, i.e. Uncategorized). A move
    replaces any prior folder, so a paper belongs to at most one folder.

    Validation runs BEFORE any mutation inside the one ``mutate_index``
    mutator: a bad ``folder_id`` -> ``FolderNotFoundError``, any unknown id in
    ``doc_ids`` -> ``DocumentNotFoundError`` — either aborts with no partial
    write (all-or-nothing). ``trashed``, ``order``, and every other paper are
    untouched. Moving into the same folder is an idempotent no-op write."""

    def _move(index: dict) -> dict:
        if folder_id is not None and _find_folder(index["folders"], folder_id) is None:
            raise FolderNotFoundError(f"no folder with id {folder_id!r}")
        papers_by_id = {p["doc_id"]: p for p in index["papers"]}
        missing = [doc_id for doc_id in doc_ids if doc_id not in papers_by_id]
        if missing:
            raise DocumentNotFoundError(f"no document with id {missing[0]!r}")
        for doc_id in doc_ids:
            papers_by_id[doc_id]["folder_id"] = folder_id
        return index

    mutate_index(_move)
    return read_library()


def trash_papers(doc_ids: list[str]) -> Library:
    """Set-based soft-delete (AL-5.1, AL-6, AD-L6): flip ``trashed`` to
    ``True`` for every id in ``doc_ids``. Mirrors ``move_papers``'s
    validate-before-mutate shape: any unknown id -> ``DocumentNotFoundError``,
    all-or-nothing, no partial write. ``folder_id``, ``order``, and every
    other paper are untouched (a trashed paper keeps its remembered folder)."""

    def _trash(index: dict) -> dict:
        papers_by_id = {p["doc_id"]: p for p in index["papers"]}
        missing = [doc_id for doc_id in doc_ids if doc_id not in papers_by_id]
        if missing:
            raise DocumentNotFoundError(f"no document with id {missing[0]!r}")
        for doc_id in doc_ids:
            papers_by_id[doc_id]["trashed"] = True
        return index

    mutate_index(_trash)
    return read_library()


def restore_papers(doc_ids: list[str]) -> Library:
    """Set-based restore (AL-5.2, AL-6, AD-L6): flip ``trashed`` to ``False``
    for every id in ``doc_ids``. Same validate-before-mutate shape as
    ``move_papers``/``trash_papers``. ``folder_id`` is left as-is: it is the
    remembered folder, and a folder deleted while a paper was trashed already
    re-homed it to Uncategorized (``delete_folder`` re-homes every paper in
    the removed subtree regardless of ``trashed``), so no dangling-folder
    guard is needed here."""

    def _restore(index: dict) -> dict:
        papers_by_id = {p["doc_id"]: p for p in index["papers"]}
        missing = [doc_id for doc_id in doc_ids if doc_id not in papers_by_id]
        if missing:
            raise DocumentNotFoundError(f"no document with id {missing[0]!r}")
        for doc_id in doc_ids:
            papers_by_id[doc_id]["trashed"] = False
        return index

    mutate_index(_restore)
    return read_library()


def purge_entry(doc_id: str) -> Library:
    """Drop a paper's ``library.json`` entry (AL-5.3, AL-7).

    Thin helper so ``documents.purge_document`` can prune the index entry
    under the same ``_index_lock`` it holds for the on-disk ``rmtree`` --
    without exposing the lock object itself across the module boundary.
    Caller MUST have already removed the on-disk dir (crash-safe order: dir
    first, then entry -- see ``documents.purge_document``). Unknown id ->
    ``DocumentNotFoundError``."""

    def _purge(index: dict) -> dict:
        before = len(index["papers"])
        index["papers"] = [p for p in index["papers"] if p["doc_id"] != doc_id]
        if len(index["papers"]) == before:
            raise DocumentNotFoundError(f"no document with id {doc_id!r}")
        return index

    mutate_index(_purge)
    return read_library()


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
