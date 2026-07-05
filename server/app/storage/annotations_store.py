"""The per-document ``annotations.json`` store (AR-7, H9).

The disk file carries the envelope ``{schema_version, annotations}``; the API
body is the bare list. This module adds the envelope on write and strips it on
read, rejecting an unknown version or a corrupt/foreign-id shape rather than
guessing (AD-8). A document must have valid ``meta.json`` before it can hold
annotations, so both entry points gate on ``meta_store.read``.
"""

import json

from pydantic import ValidationError

from app.models import Annotation
from app.storage import meta_store, paths
from app.storage.atomic import atomic_write
from app.storage.errors import (
    CorruptAnnotationsError,
    DocumentNotFoundError,
    StorageError,
    UnsupportedSchemaError,
)

#: Current ``annotations.json`` schema version (H9: disk envelope, API body is bare).
ANNOTATIONS_SCHEMA_VERSION = 1


def write_annotations(doc_id: str, annotations: list[Annotation]) -> None:
    """Overwrite ``library/{doc_id}/annotations.json`` with the full given set.

    AR-7 / H9: the disk file carries the envelope ``{schema_version,
    annotations}``; the API body (caller's ``annotations`` list) is bare. No
    history, merge, or partial update — every call replaces the whole file.
    Raises ``DocumentNotFoundError`` for a doc_id with no valid ``meta.json``,
    so a never-imported document never gets an annotations file.
    """
    try:
        doc_dir = paths.doc_dir(doc_id)
    except StorageError as exc:
        raise DocumentNotFoundError(f"unresolvable doc_id {doc_id!r}") from exc
    if meta_store.read(doc_dir) is None:
        raise DocumentNotFoundError(f"no document metadata for doc_id {doc_id!r}")
    payload = {
        "schema_version": ANNOTATIONS_SCHEMA_VERSION,
        "annotations": [a.model_dump(mode="json") for a in annotations],
    }
    atomic_write(doc_dir / "annotations.json", json.dumps(payload, indent=2).encode("utf-8"))


def read_annotations(doc_id: str) -> list[Annotation]:
    """Read ``library/{doc_id}/annotations.json`` and return the BARE list (H9).

    The READ mirror of ``write_annotations`` (Story 3.5, hydrate-on-open). Same
    error taxonomy as ``meta_store.read``: an unknown ``schema_version`` or a
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
        doc_dir = paths.doc_dir(doc_id)
    except StorageError as exc:
        raise DocumentNotFoundError(f"unresolvable doc_id {doc_id!r}") from exc
    if meta_store.read(doc_dir) is None:
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
