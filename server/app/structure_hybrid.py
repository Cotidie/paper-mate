"""Lifecycle for the bundled opendataloader hybrid server (AD-13, Story 10.3).

Hybrid structure extraction needs a SEPARATE Docling Fast Server
(``opendataloader-pdf-hybrid``) that the opendataloader Java core calls over
HTTP; the binding does NOT auto-start it. In our single container (AD-10) we
launch it from the FastAPI lifespan ONLY when ``PAPER_MATE_STRUCTURE_MODE=hybrid``
and the configured URL is local, so local mode (the default) pays no runtime cost
even though the deps + models sit in the image.

Best-effort + logged, like the ``reconcile_library`` boot step: a launch failure
never bricks boot. If the server is not up, hybrid extraction fails total (empty
``DocStructure`` per Story 10.1), observable via ``GET /api/health`` mode + logs.

GPU-optional (AC #8): ``PAPER_MATE_STRUCTURE_HYBRID_DEVICE`` (default ``auto``)
becomes the server's ``--device``; ``auto`` uses CUDA when the container is given
a GPU and falls back to CPU otherwise, so a GPU-less container still works. Born-
digital papers run with ``--no-ocr`` (skips the EasyOCR model + compute).
"""

import logging
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

#: The hybrid-server console script. Prefer the copy installed next to the
#: running interpreter (the venv's ``bin/``) so the launch does not depend on the
#: process PATH; fall back to the bare name (resolved via PATH) otherwise. In the
#: image ``.venv/bin`` is on PATH anyway, but this is robust for a host run too.
_HYBRID_BIN = "opendataloader-pdf-hybrid"

#: Hosts we own (launch a local server for). A remote URL means the operator runs
#: the hybrid server elsewhere (a sidecar), so we do NOT launch one.
_LOCAL_HOSTS = {"localhost", "127.0.0.1", "0.0.0.0"}
#: Cap on the startup readiness wait (model load + uvicorn boot). With baked
#: models the Docling converter initializes in seconds; this only guards a hang.
_READY_TIMEOUT_S = 120.0
_DEFAULT_PORT = 5002


def _device() -> str:
    return os.environ.get("PAPER_MATE_STRUCTURE_HYBRID_DEVICE", "").strip() or "auto"


def _hybrid_binary() -> str:
    """The hybrid-server executable: the venv copy beside ``sys.executable`` if
    present, else the bare name (PATH-resolved)."""
    candidate = Path(sys.executable).parent / _HYBRID_BIN
    return str(candidate) if candidate.exists() else _HYBRID_BIN


def start_hybrid_server(mode: str, url: str) -> subprocess.Popen | None:
    """Launch the bundled hybrid server iff ``mode`` is hybrid and ``url`` is local.

    Blocking (spawns, then waits for ``/health``); call via ``asyncio.to_thread``
    from the async lifespan, or from a background task on a runtime flip, so the
    event loop is not blocked. Mode and URL are ARGUMENTS rather than module
    globals because the mode is switchable at runtime: ``app.structure_mode``
    owns the value and is the only caller.

    Returns a running, READY process, or ``None`` when nothing usable came up
    (local mode, a remote URL, a spawn failure, or a readiness timeout). A
    process that never became ready is terminated before returning ``None``, so
    the caller can report a failure instead of holding a dead server.
    """
    if mode != "hybrid":
        return None
    parsed = urlparse(url)
    if parsed.hostname not in _LOCAL_HOSTS:
        logger.info("structure hybrid: URL %s is remote; not launching a local server", url)
        return None

    port = str(parsed.port or _DEFAULT_PORT)
    device = _device()
    cmd = [
        _hybrid_binary(),
        "--host", "127.0.0.1",
        "--port", port,
        "--device", device,
        "--no-ocr",
    ]
    try:
        proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception:
        logger.exception("structure hybrid: failed to launch %s (hybrid extraction will be empty)", cmd)
        return None

    if not _wait_ready(url, proc):
        logger.warning(
            "structure hybrid: server not ready within %ss; stopping it (the caller "
            "reports the failure and stays on local)",
            _READY_TIMEOUT_S,
        )
        stop_hybrid_server(proc)
        return None
    logger.info("structure hybrid: server ready on %s (device=%s)", url, device)
    return proc


def _wait_ready(url: str, proc: subprocess.Popen) -> bool:
    """Poll ``<url>/health`` until 200, the process dies, or the timeout."""
    health = url.rstrip("/") + "/health"
    deadline = time.monotonic() + _READY_TIMEOUT_S
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            return False  # server process exited before becoming ready
        try:
            with urllib.request.urlopen(health, timeout=2) as resp:
                if resp.status == 200:
                    return True
        except Exception:
            pass
        time.sleep(1.0)
    return False


def stop_hybrid_server(proc: subprocess.Popen | None) -> None:
    """Terminate the hybrid server (SIGTERM, then SIGKILL on timeout)."""
    if proc is None:
        return
    try:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
    except Exception:
        logger.exception("structure hybrid: error stopping server")
