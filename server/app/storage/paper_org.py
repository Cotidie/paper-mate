"""Set-based paper-organization mutators over ``library.json`` (AL-5/AL-6, AD-L6).

The membership half of the collection index: move / trash / restore / star /
unstar over a ``doc_id`` set, plus the single-entry ``purge_entry``. Each is a
validate-before-mutate write through the index-core's serialized ``mutate_index``
(``library_index``), so ``_index_lock`` stays the ONE serialized ``library.json``
writer (AL-7). The four boolean flippers share one ``_apply_to_papers`` spine;
``move_papers`` reuses ``folders._find_folder`` for its extra ``folder_id`` check.
"""

from collections.abc import Callable

from app.models import Library
from app.storage.errors import DocumentNotFoundError, FolderNotFoundError
from app.storage.folders import _find_folder
from app.storage.library_index import mutate_index, read_library


def _apply_to_papers(index: dict, doc_ids: list[str], apply: Callable[[dict], None]) -> dict:
    """The shared spine of the set-based mutators (AL-6): build ``papers_by_id``
    -> validate every id exists (any unknown id -> ``DocumentNotFoundError`` on
    the FIRST missing one, all-or-nothing, no partial write) -> run ``apply`` on
    each matching paper entry. Returns the mutated ``index`` so a ``mutate_index``
    mutator can ``return _apply_to_papers(...)`` directly."""
    papers_by_id = {p["doc_id"]: p for p in index["papers"]}
    missing = [doc_id for doc_id in doc_ids if doc_id not in papers_by_id]
    if missing:
        raise DocumentNotFoundError(f"no document with id {missing[0]!r}")
    for doc_id in doc_ids:
        apply(papers_by_id[doc_id])
    return index


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
        return _apply_to_papers(index, doc_ids, lambda paper: paper.__setitem__("folder_id", folder_id))

    mutate_index(_move)
    return read_library()


def trash_papers(doc_ids: list[str]) -> Library:
    """Set-based soft-delete (AL-5.1, AL-6, AD-L6): flip ``trashed`` to
    ``True`` for every id in ``doc_ids``. Mirrors ``move_papers``'s
    validate-before-mutate shape: any unknown id -> ``DocumentNotFoundError``,
    all-or-nothing, no partial write. ``folder_id``, ``order``, and every
    other paper are untouched (a trashed paper keeps its remembered folder)."""
    mutate_index(lambda index: _apply_to_papers(index, doc_ids, lambda paper: paper.__setitem__("trashed", True)))
    return read_library()


def restore_papers(doc_ids: list[str]) -> Library:
    """Set-based restore (AL-5.2, AL-6, AD-L6): flip ``trashed`` to ``False``
    for every id in ``doc_ids``. Same validate-before-mutate shape as
    ``move_papers``/``trash_papers``. ``folder_id`` is left as-is: it is the
    remembered folder, and a folder deleted while a paper was trashed already
    re-homed it to Uncategorized (``delete_folder`` re-homes every paper in
    the removed subtree regardless of ``trashed``), so no dangling-folder
    guard is needed here."""
    mutate_index(lambda index: _apply_to_papers(index, doc_ids, lambda paper: paper.__setitem__("trashed", False)))
    return read_library()


def star_papers(doc_ids: list[str]) -> Library:
    """Set-based star (AL-5, AL-6, AD-L6): flip ``starred`` to ``True`` for
    every id in ``doc_ids``. Same validate-before-mutate shape as
    ``trash_papers``/``restore_papers``. ``folder_id``, ``order``, ``trashed``,
    and every other paper are untouched."""
    mutate_index(lambda index: _apply_to_papers(index, doc_ids, lambda paper: paper.__setitem__("starred", True)))
    return read_library()


def unstar_papers(doc_ids: list[str]) -> Library:
    """Set-based unstar (AL-5, AL-6, AD-L6): flip ``starred`` to ``False`` for
    every id in ``doc_ids``. Same validate-before-mutate shape as
    ``trash_papers``/``restore_papers``."""
    mutate_index(lambda index: _apply_to_papers(index, doc_ids, lambda paper: paper.__setitem__("starred", False)))
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
