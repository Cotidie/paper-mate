"""Runtime owner of the document-structure extraction mode (AD-13, Story 10.3+).

Story 10.3 shipped the mode as a restart-scoped env switch resolved once at
import. This module replaces that invariant with a narrower one:

    ONE service owns the mode. Every consumer asks it. Nothing else reads the
    env or touches the hybrid server process.

It holds the current mode, the hybrid Docling server subprocess, and a small
transition state machine, all behind one lock. A flip is split in two so the
HTTP layer never blocks on a multi-second model load: ``begin_transition``
records the intent and returns immediately, ``run_transition`` (a background
task) does the spawn or stop.

Flipping affects extractions that START after the flip. An extraction snapshots
the mode on entry and is refcounted, so a flip to local never kills a hybrid
server out from under work already in flight: the stop is deferred until the
last in-flight hybrid extraction drains.

Lives beside ``structure_hybrid`` in the entrypoint layer, not in ``domain/``,
because it owns a process and touches storage. The domain layer takes the mode
as an argument and stays pure.
"""

import logging
import os
import subprocess
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Literal

from app import storage
from app.structure_hybrid import start_hybrid_server, stop_hybrid_server

logger = logging.getLogger(__name__)

StructureMode = Literal["local", "hybrid"]
ModeTransition = Literal["idle", "starting", "stopping"]

_MODES: frozenset[str] = frozenset({"local", "hybrid"})
#: Default URL of the opendataloader hybrid server (Docling Fast Server), a
#: SEPARATE process the Java core calls over HTTP.
_HYBRID_URL_DEFAULT = "http://localhost:5002"
#: User-facing reason a flip to hybrid did not take. Surfaced by the toggle, so
#: no em-dash (DESIGN.md).
_START_FAILED = "The hybrid structure server did not start. Staying on local."


@dataclass(frozen=True)
class ExtractionSettings:
    """One extraction's snapshot of the mode. Immutable, so a flip mid-run
    cannot change what the running extraction is doing."""

    mode: StructureMode
    hybrid_url: str


@dataclass(frozen=True)
class ModeState:
    """What the API reports: the live mode, whether a flip is in flight, and the
    last failure (cleared by the next successful flip)."""

    mode: StructureMode
    transition: ModeTransition
    error: str | None


class ModeBusyError(RuntimeError):
    """A flip was requested while another was still in flight."""


class _Runtime:
    """The mutable state, all of it, in one place."""

    def __init__(self) -> None:
        self.mode: StructureMode = "local"
        self.transition: ModeTransition = "idle"
        self.error: str | None = None
        self.proc: subprocess.Popen | None = None
        self.pending: StructureMode | None = None
        self.inflight = 0
        self.stop_when_drained = False


#: Re-entrant on purpose: ``_switch_to_local`` persists while holding the lock
#: and ``current_state`` takes it again, which a plain ``Lock`` would deadlock.
_lock = threading.RLock()
_runtime = _Runtime()


# --- configuration ---------------------------------------------------------


def hybrid_url() -> str:
    """The hybrid server URL: ``PAPER_MATE_STRUCTURE_HYBRID_URL``, else the
    local default. A remote host means an operator-run sidecar, which
    ``start_hybrid_server`` declines to launch."""
    return os.environ.get("PAPER_MATE_STRUCTURE_HYBRID_URL", "").strip() or _HYBRID_URL_DEFAULT


def _coerce_mode(raw: str | None) -> StructureMode | None:
    """A known mode, or ``None`` for anything else (unset, a typo, a stale value)."""
    value = (raw or "").strip().lower()
    return value if value in _MODES else None  # type: ignore[return-value]


def resolve_boot_mode() -> StructureMode:
    """The mode this process starts in: the persisted setting, else the env,
    else ``local``.

    The toggle is the primary control, so a persisted choice outranks the env;
    the env stays the initial default for a data root nobody has toggled yet.
    Any unrecognized value at either layer fails safe to ``local``, keeping a
    fresh boot deterministic + offline.
    """
    try:
        persisted = _coerce_mode(storage.read_structure_mode())
    except Exception:
        logger.exception("structure mode: could not read the persisted setting; using the env")
        persisted = None
    if persisted is not None:
        return persisted
    return _coerce_mode(os.environ.get("PAPER_MATE_STRUCTURE_MODE")) or "local"


# --- reads -----------------------------------------------------------------


def current_state() -> ModeState:
    """A consistent snapshot of the mode, the in-flight transition, and the
    last error."""
    with _lock:
        return ModeState(mode=_runtime.mode, transition=_runtime.transition, error=_runtime.error)


# --- transitions -----------------------------------------------------------


def begin_transition(target: StructureMode) -> ModeState:
    """Record the intent to switch to ``target`` and return immediately.

    Fast + non-blocking on purpose: the actual spawn can take a minute, so the
    HTTP handler returns a ``starting``/``stopping`` state the client polls and
    schedules :func:`run_transition` as a background task. A flip to the mode
    already active is a no-op. Raises :class:`ModeBusyError` when another flip
    is still in flight.
    """
    with _lock:
        if _runtime.transition != "idle":
            raise ModeBusyError("A structure mode change is already in progress.")
        if target == _runtime.mode:
            return current_state()
        _runtime.pending = target
        _runtime.transition = "starting" if target == "hybrid" else "stopping"
        return current_state()


def run_transition() -> None:
    """Perform the pending flip. Blocking; run it off the event loop."""
    with _lock:
        target = _runtime.pending
    if target is None:
        return
    if target == "hybrid":
        _switch_to_hybrid()
    else:
        _switch_to_local()


def _switch_to_hybrid() -> None:
    """Spawn the hybrid server and adopt hybrid only once it is ready.

    A server that never comes up leaves the mode on local with the failure
    recorded, so the UI can say so instead of silently extracting nothing.
    """
    proc = start_hybrid_server("hybrid", hybrid_url())
    with _lock:
        if proc is None:
            _runtime.mode = "local"
            _runtime.error = _START_FAILED
        else:
            _runtime.proc = proc
            _runtime.mode = "hybrid"
            _runtime.error = None
            _persist("hybrid")
        _runtime.pending = None
        _runtime.transition = "idle"


def _switch_to_local() -> None:
    """Adopt local at once, and stop the hybrid server as soon as it is unused.

    The mode flips immediately so the NEXT extraction runs local, but the server
    stays up while earlier hybrid extractions are still running; the last one to
    drain terminates it (see :func:`_release_extraction`).
    """
    with _lock:
        _runtime.mode = "local"
        _runtime.error = None
        _runtime.pending = None
        _persist("local")
        if _runtime.inflight > 0:
            _runtime.stop_when_drained = True
            return  # transition stays "stopping" until the drain completes
        proc, _runtime.proc = _runtime.proc, None
        _runtime.transition = "idle"
    stop_hybrid_server(proc)


def _persist(mode: StructureMode) -> None:
    """Save the choice so it survives a restart. Best-effort: a read-only or
    full data dir must not undo a flip that already took effect in memory."""
    try:
        storage.write_structure_mode(mode)
    except Exception:
        logger.exception("structure mode: could not persist %s; it holds until restart", mode)


# --- per-extraction snapshot ----------------------------------------------


@contextmanager
def extraction_mode() -> Iterator[ExtractionSettings]:
    """Yield the settings one extraction should use, start to finish.

    Hybrid extractions are refcounted for the duration, which is what lets a
    concurrent flip to local defer the server shutdown instead of killing work
    in flight.
    """
    with _lock:
        settings = ExtractionSettings(mode=_runtime.mode, hybrid_url=hybrid_url())
        if settings.mode == "hybrid":
            _runtime.inflight += 1
    try:
        yield settings
    finally:
        if settings.mode == "hybrid":
            _release_extraction()


def _release_extraction() -> None:
    """Drop one hybrid refcount and finish a stop that was waiting on it."""
    proc = None
    with _lock:
        _runtime.inflight = max(0, _runtime.inflight - 1)
        if _runtime.inflight == 0 and _runtime.stop_when_drained:
            proc, _runtime.proc = _runtime.proc, None
            _runtime.stop_when_drained = False
            _runtime.transition = "idle"
    if proc is not None:
        stop_hybrid_server(proc)


# --- process lifecycle -----------------------------------------------------


def start_at_boot() -> None:
    """Resolve the boot mode and bring the hybrid server up if it is hybrid.

    Total: any failure lands on local with the reason recorded, so a broken
    hybrid setup degrades to the deterministic default instead of bricking boot.
    """
    mode = resolve_boot_mode()
    if mode != "hybrid":
        with _lock:
            _runtime.mode = "local"
        return
    proc = start_hybrid_server("hybrid", hybrid_url())
    with _lock:
        if proc is None:
            _runtime.mode = "local"
            _runtime.error = _START_FAILED
        else:
            _runtime.proc = proc
            _runtime.mode = "hybrid"


def shutdown() -> None:
    """Stop the hybrid server, if any. Called from the app lifespan."""
    with _lock:
        proc, _runtime.proc = _runtime.proc, None
    stop_hybrid_server(proc)


def reset_state_for_tests() -> None:
    """Drop all runtime state. The process-global runtime would otherwise leak
    between tests; ``conftest`` calls this around each one."""
    global _runtime
    with _lock:
        _runtime = _Runtime()
