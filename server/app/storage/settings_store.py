"""App-level settings persisted under the data root (AD-8/AD-9).

One small JSON object, ``settings.json``, holding user choices that must survive
a container restart. Today that is the document-structure extraction mode chosen
from the Library toggle; the env var stays the initial default for a data root
that has never been toggled.

Reads are TOTAL: a missing, unreadable, or corrupt file resolves to "no setting"
so a bad file falls through to the env default instead of bricking boot. Writes
go through ``atomic_write``, so a reader always sees a complete old-or-new file
and a filesystem failure surfaces as ``StorageError`` like every other writer.
"""

import json

from app.storage.atomic import atomic_write
from app.storage.paths import settings_path

_STRUCTURE_MODE_KEY = "structure_mode"


def _read_all() -> dict:
    """The whole settings object, or ``{}`` when it is missing or unusable."""
    try:
        raw = settings_path().read_text()
    except OSError:
        return {}
    try:
        parsed = json.loads(raw)
    except ValueError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def read_structure_mode() -> str | None:
    """The persisted structure-extraction mode, or ``None`` when unset.

    Returns the raw string without validating it against the mode vocabulary --
    the caller (``app.structure_mode``) owns that check, so an unknown value
    fails safe there in exactly one place.
    """
    value = _read_all().get(_STRUCTURE_MODE_KEY)
    return value if isinstance(value, str) else None


def write_structure_mode(mode: str) -> None:
    """Persist the structure-extraction mode, preserving any other keys."""
    settings = _read_all()
    settings[_STRUCTURE_MODE_KEY] = mode
    atomic_write(settings_path(), json.dumps(settings, indent=2).encode())
