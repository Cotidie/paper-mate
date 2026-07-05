"""Data-root resolution + path containment (AD-9).

Every filesystem path the storage package touches is resolved here, so the
data-root escape guard (a ``doc_id`` can never resolve outside ``library/``)
lives in exactly one place.
"""

import os
from datetime import datetime, timezone
from pathlib import Path

from app.storage.errors import StorageError


def data_root() -> Path:
    """Resolve the storage root: ``PAPER_MATE_DATA`` env, default ``~/.paper-mate``.

    The container sets ``PAPER_MATE_DATA=/data`` (the host volume mount).
    """
    raw = os.environ.get("PAPER_MATE_DATA") or str(Path.home() / ".paper-mate")
    return Path(raw).resolve()


def doc_dir(doc_id: str) -> Path:
    """Resolve ``library/{doc_id}/`` and contain it inside the data root.

    ``doc_id`` is a SHA-256 hex digest (fixed charset, not user input), but we
    still verify containment so the data root can never be escaped.
    """
    library = (data_root() / "library").resolve()
    candidate = (library / doc_id).resolve()
    if not candidate.is_relative_to(library):
        raise StorageError("resolved document path escapes the library root")
    return candidate


def library_path() -> Path:
    """Resolve ``~/.paper-mate/library.json`` — a sibling of ``library/``, not
    inside it (the collection index is not a per-doc artifact)."""
    return data_root() / "library.json"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
