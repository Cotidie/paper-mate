"""The per-document ``structure.json`` store (AD-8, AD-L8, Story 10.1).

The document-structure artifact: opendataloader's typed, box-anchored elements
persisted per-doc beside ``source.pdf``/``meta.json``. Mirrors
``annotations_store`` exactly -- disk envelope ``{schema_version, elements}``,
atomic write, gate on ``meta_store.read`` -- with one deliberate difference:
because ``structure.json`` is a **per-doc** artifact (NOT the shared
``library.json`` index), it is written directly, NOT through the ``library_index``
serialized write path (AD-L8: it adds no cross-doc index-concurrency surface).
"""

import json

from pydantic import ValidationError

from app.models import DocStructure
from app.storage import meta_store, paths
from app.storage.atomic import atomic_write
from app.storage.errors import (
    CorruptStructureError,
    DocumentNotFoundError,
    StorageError,
    UnsupportedSchemaError,
)

#: Current ``structure.json`` schema version. Unknown versions are rejected, not
#: guessed (AD-8).
STRUCTURE_SCHEMA_VERSION = 1


def write_structure(doc_id: str, structure: DocStructure) -> None:
    """Overwrite ``library/{doc_id}/structure.json`` with the whole structure.

    The disk file carries the envelope ``{schema_version, elements}``; the API
    body (``DocStructure``) is envelope-free. Whole-file overwrite -- structure
    is import-time and immutable, so there is never a partial update. Raises
    ``DocumentNotFoundError`` for a doc_id with no valid ``meta.json`` (a
    never-imported document never gets a structure file).
    """
    try:
        doc_dir = paths.doc_dir(doc_id)
    except StorageError as exc:
        raise DocumentNotFoundError(f"unresolvable doc_id {doc_id!r}") from exc
    if meta_store.read(doc_dir) is None:
        raise DocumentNotFoundError(f"no document metadata for doc_id {doc_id!r}")
    payload = {
        "schema_version": STRUCTURE_SCHEMA_VERSION,
        "elements": [e.model_dump(mode="json") for e in structure.elements],
    }
    atomic_write(doc_dir / "structure.json", json.dumps(payload, indent=2).encode("utf-8"))


def read_structure(doc_id: str) -> DocStructure:
    """Read ``library/{doc_id}/structure.json`` and return the ``DocStructure``.

    The READ mirror of ``write_structure`` (the ``GET .../structure`` route +
    the client ``structure/`` service). Same error taxonomy as
    ``read_annotations``:

    - ``DocumentNotFoundError`` for a doc_id that doesn't resolve or has no valid
      ``meta.json``.
    - An imported-but-not-yet-analyzed doc (no ``structure.json``) returns an
      **empty** ``DocStructure()`` via a normal return -- the common case while
      background extraction is still running, or for a non-PDF doc, NOT an error.
    - ``UnsupportedSchemaError`` for an unknown ``schema_version``;
      ``CorruptStructureError`` for unreadable JSON or an invalid shape.
    """
    try:
        doc_dir = paths.doc_dir(doc_id)
    except StorageError as exc:
        raise DocumentNotFoundError(f"unresolvable doc_id {doc_id!r}") from exc
    if meta_store.read(doc_dir) is None:
        raise DocumentNotFoundError(f"no document metadata for doc_id {doc_id!r}")
    structure_path = doc_dir / "structure.json"
    if not structure_path.is_file():
        return DocStructure()  # imported but not yet analyzed -- empty, not an error
    try:
        payload = json.loads(structure_path.read_text())
    except (json.JSONDecodeError, OSError) as exc:
        raise CorruptStructureError(f"unreadable structure.json: {exc}") from exc
    version = payload.get("schema_version") if isinstance(payload, dict) else None
    if version != STRUCTURE_SCHEMA_VERSION:
        raise UnsupportedSchemaError(f"unknown structure schema_version: {version!r}")
    try:
        return DocStructure.model_validate({"elements": payload.get("elements", [])})
    except ValidationError as exc:
        raise CorruptStructureError(f"invalid structure.json shape: {exc}") from exc
