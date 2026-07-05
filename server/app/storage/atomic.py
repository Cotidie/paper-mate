"""Atomic-IO primitives: temp file in the same dir + ``os.replace`` (AD-8).

A reader always sees a complete old-or-new file, never a torn one. Filesystem
failures are wrapped as ``StorageError`` so every caller's ``except
StorageError`` mapping (the single ``{ detail }`` envelope, AR-11) catches them
instead of a raw ``OSError`` bypassing it.
"""

import os
import tempfile
from pathlib import Path

from app.storage.errors import StorageError


def fsync_dir(directory: Path) -> None:
    """Flush a directory entry so a rename survives a crash (best-effort).

    Some platforms/filesystems disallow opening a dir for fsync; ignore those.
    """
    try:
        dir_fd = os.open(directory, os.O_RDONLY)
    except OSError:
        return
    try:
        os.fsync(dir_fd)
    except OSError:
        pass
    finally:
        os.close(dir_fd)


def atomic_write(path: Path, data: bytes, *, create_parents: bool = True) -> None:
    """Write ``data`` to ``path`` atomically (temp in same dir + rename).

    Filesystem failures (disk full, permissions, ...) are wrapped as
    ``StorageError`` so every caller's existing ``except StorageError``
    mapping (the API's single ``{ detail }`` envelope, AR-11) catches them
    instead of letting a raw ``OSError`` bypass it.

    ``create_parents=False`` refuses to (re)create the parent directory — an
    update path (e.g. ``apply_extraction``) uses it so a doc purged mid-write
    is NOT resurrected as a meta-only ghost; a missing parent then surfaces as
    ``StorageError`` rather than silently recreating the dir.
    """
    try:
        if create_parents:
            path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp_name = tempfile.mkstemp(dir=path.parent, prefix=".tmp-", suffix=path.suffix)
    except OSError as exc:
        raise StorageError(f"could not prepare write to {path}: {exc}") from exc
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp_name, path)
        fsync_dir(path.parent)
    except OSError as exc:
        # Never leave a partial temp file behind.
        try:
            os.unlink(tmp_name)
        except FileNotFoundError:
            pass
        raise StorageError(f"could not write {path}: {exc}") from exc
    except BaseException:
        try:
            os.unlink(tmp_name)
        except FileNotFoundError:
            pass
        raise
