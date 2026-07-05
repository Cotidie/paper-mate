"""The per-document ``meta.json`` store (storage-owned schema, AD-8).

``read`` is schema-version-gated: an unknown version is rejected, not guessed.
This module is the single reader/writer of ``meta.json``; the collection index
and the public document API compose it, never re-parsing the file themselves.
"""

import json
from pathlib import Path

from pydantic import ValidationError

from app.models import DocMeta
from app.storage.atomic import atomic_write
from app.storage.errors import CorruptMetadataError, UnsupportedSchemaError

#: Current ``meta.json`` schema version. Unknown versions are rejected, not guessed.
META_SCHEMA_VERSION = 1


def read(doc_dir: Path) -> DocMeta | None:
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


def write(doc_dir: Path, meta: DocMeta, *, create_parents: bool = True) -> None:
    atomic_write(
        doc_dir / "meta.json",
        meta.model_dump_json(indent=2).encode("utf-8"),
        create_parents=create_parents,
    )
