"""App version resolution — single source is ``[project].version`` in
``server/pyproject.toml`` (installed as package metadata by ``uv sync``).

Everything that surfaces a version (the FastAPI app, ``GET /api/health``) reads
it here so there is exactly one place the version lives.
"""

from importlib.metadata import PackageNotFoundError, version as _dist_version

_DIST_NAME = "paper-mate-server"


def get_version() -> str:
    """Return the installed package version, or ``0.0.0`` if metadata is
    missing (e.g. running from an unsynced source tree)."""
    try:
        return _dist_version(_DIST_NAME)
    except PackageNotFoundError:
        return "0.0.0"
