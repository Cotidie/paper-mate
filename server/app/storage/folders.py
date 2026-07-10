"""Folder-tree operations over ``library.json`` (AL-5, AL-7).

The folder half of the collection index: create / rename / delete, plus the
subtree walk a delete uses to re-home every paper it removes. Every mutation
goes through the index-core's single serialized ``mutate_index`` writer
(``library_index``); this module never touches the filesystem directly and
holds no lock of its own, so ``_index_lock`` stays the ONE serialized
``library.json`` writer (AL-7).
"""

import uuid

from app.models import Folder, Library
from app.storage.errors import FolderNotFoundError, StorageError
from app.storage.library_index import mutate_index, read_library


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
