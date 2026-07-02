"""Guard (AE3-6): ``pyproject.toml`` ``[project].version`` and the version
``uv.lock`` records for the ``paper-mate-server`` package must match.

They drift when ``[project].version`` is bumped without re-running ``uv lock``.
That drift is silent but real: ``app/version.py`` reads the INSTALLED package
metadata (which ``uv sync`` writes from the lock), and ``GET /api/health`` +
the top-bar badge surface that metadata — so a stale lock ships the wrong
version. This test fails loudly on the mismatch instead.
"""

import tomllib
from pathlib import Path

_SERVER = Path(__file__).resolve().parents[1]
_PACKAGE = "paper-mate-server"


def _pyproject_version() -> str:
    data = tomllib.loads((_SERVER / "pyproject.toml").read_text())
    return data["project"]["version"]


def _lock_version() -> str:
    data = tomllib.loads((_SERVER / "uv.lock").read_text())
    for pkg in data["package"]:
        if pkg["name"] == _PACKAGE:
            return pkg["version"]
    raise AssertionError(f"{_PACKAGE} not found in uv.lock")


def test_pyproject_and_lock_version_match() -> None:
    assert _pyproject_version() == _lock_version(), (
        "pyproject.toml [project].version and uv.lock are out of sync — run "
        "`uv lock` after bumping the version so the installed package metadata "
        "(and the /api/health badge) match."
    )
