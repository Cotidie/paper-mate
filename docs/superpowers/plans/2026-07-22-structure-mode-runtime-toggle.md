# Runtime Structure-Mode Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user switch document-structure extraction between `local` and `hybrid` at runtime from a toggle pinned at the bottom of the Library page's folder panel, with no container restart.

**Architecture:** A new `server/app/structure_mode.py` service becomes the single owner of the extraction mode: it resolves the boot value (persisted setting > env > `local`), owns the hybrid Docling server subprocess, serializes transitions behind a lock, and hands each extraction a snapshot of the mode. `domain/structure.py` loses its import-time globals and takes the mode as a parameter, so the domain layer keeps no process state. Two new routes (`GET`/`PUT /api/settings/structure-mode`) expose the state; the client polls while a transition is in flight.

**Tech Stack:** Python 3.12 / FastAPI / Pydantic v2 / pytest on the server; React 19 + TypeScript + Vitest on the client. Spec: `docs/superpowers/specs/2026-07-22-structure-mode-runtime-toggle-design.md`.

## Global Constraints

- Backend tests run as `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q`. The `PYTHONPATH=` clears a host ROS leak; the autoload flag avoids a stray ROS pytest plugin.
- Frontend tests run as `cd client && npm test`. Typecheck: `cd client && npm run typecheck`.
- Never hand-author client API types. After any Pydantic model change: `cd server && PYTHONPATH= uv run python -m app.export_openapi`, then `cd client && npm run gen:api`. Both `server/openapi.json` and `client/src/schema.d.ts` are committed.
- `docs/API.md` must be updated in the SAME change that adds or alters an `/api` endpoint: the resource entry plus a dated changelog line.
- No em-dash (`—`) in any user-facing string (labels, `title`/tooltip text, aria-labels, toasts). Code comments are exempt.
- No raw hex or px values outside `client/src/theme/**`. Use design tokens (`var(--color-*)`, `var(--space-*)`, `var(--type-*)`, `var(--radius-*)`). `client/src/no-raw-values.test.ts` enforces this.
- Never spawn the real `opendataloader-pdf-hybrid` subprocess in a unit test. It pulls in Docling + torch. Mock `subprocess.Popen` and the readiness poll.
- The real hybrid server and its baked models exist only in the Docker image, so any hybrid live smoke must run in-container (`docker compose up --build`).
- Do not add `Co-Authored-By: Claude` trailers to commits.
- Keep each function at one abstraction level: high-level bodies read as workflow, low-level helpers carry mechanics.

---

## File Structure

**Server, created:**

- `server/app/storage/settings_store.py` — read/write the persisted `settings.json` under the data root. One key today: `structure_mode`.
- `server/app/structure_mode.py` — the runtime mode service: state, lock, transitions, hybrid subprocess ownership, per-extraction snapshot.
- `server/app/routes/settings.py` — the two HTTP handlers, thin (no filesystem, no process logic).
- `server/tests/test_settings_store.py`, `server/tests/test_structure_mode.py`, `server/tests/test_settings_routes.py`.

**Server, modified:**

- `server/app/storage/paths.py` — add `settings_path()`.
- `server/app/storage/__init__.py` — re-export the settings-store functions.
- `server/app/structure_hybrid.py` — `start_hybrid_server` takes `(mode, url)` instead of reading module globals, and returns `None` (after terminating the process) when readiness fails.
- `server/app/domain/structure.py` — drop `_ACTIVE_MODE`, `_HYBRID_URL`, `active_mode()`, `hybrid_url()`, `_default_extractor`; `extract_structure(pdf_bytes, mode, hybrid_url)`.
- `server/app/domain/__init__.py` — drop the `active_mode` re-export.
- `server/app/routes/extraction.py` — wrap the structure call in `structure_mode.extraction_mode()`.
- `server/app/routes/health.py` — report the live runtime mode.
- `server/app/routes/__init__.py` — mount the settings router.
- `server/app/main.py` — lifespan delegates boot start/shutdown to `structure_mode`.
- `server/app/models.py` — `StructureModeState`, `StructureModeRequest`, and a shared `StructureMode` alias.
- `server/tests/conftest.py` — autouse fixture resetting the process-global mode state.
- `server/tests/test_structure_hybrid.py`, `server/tests/test_structure.py`, `server/tests/test_health.py` — follow the signature changes.

**Client, created:**

- `client/src/library/useStructureMode.ts` — fetch, mutate, poll-while-transitioning.
- `client/src/library/StructureModeToggle.tsx` + `StructureModeToggle.css` — the self-contained footer widget.
- `client/src/library/StructureModeToggle.test.tsx`.

**Client, modified:**

- `client/src/api/client.ts` — `fetchStructureMode`, `setStructureMode`, the generated types.
- `client/src/library/FolderPanel/FolderPanel.tsx` + `.css` — a `.library-folder-panel__footer` wrapper holding the toggle above the existing version badge.
- `client/src/library/LibraryPage.test.tsx` — mock the new API calls.
- `server/pyproject.toml` — version bump.
- `docs/API.md` — the new resource plus changelog.

---

### Task 1: Persist the chosen mode under the data root

**Files:**
- Create: `server/app/storage/settings_store.py`
- Modify: `server/app/storage/paths.py` (append after `library_path`), `server/app/storage/__init__.py`
- Test: `server/tests/test_settings_store.py`

**Interfaces:**
- Consumes: `app.storage.paths.data_root`, `app.storage.atomic.atomic_write`, `app.storage.errors.StorageError` (all existing).
- Produces:
  - `settings_path() -> Path`
  - `read_structure_mode() -> str | None` — the persisted value, or `None` when unset/missing/corrupt.
  - `write_structure_mode(mode: str) -> None` — raises `StorageError` on a filesystem failure.

- [ ] **Step 1: Write the failing tests**

Create `server/tests/test_settings_store.py`:

```python
"""Persisted app settings (`settings.json` under the data root).

Only key today: `structure_mode`, written by the runtime mode toggle so the
choice survives a container restart.
"""

import json

import pytest

from app import storage
from app.storage.errors import StorageError


def test_read_returns_none_when_no_settings_file(data_root):
    assert storage.read_structure_mode() is None


def test_write_then_read_round_trips(data_root):
    storage.write_structure_mode("hybrid")
    assert storage.read_structure_mode() == "hybrid"


def test_write_lands_in_settings_json_beside_library(data_root):
    storage.write_structure_mode("hybrid")
    path = data_root / "settings.json"
    assert json.loads(path.read_text()) == {"structure_mode": "hybrid"}


def test_write_preserves_unknown_keys(data_root):
    (data_root / "settings.json").write_text(json.dumps({"future_key": 1}))
    storage.write_structure_mode("hybrid")
    assert json.loads((data_root / "settings.json").read_text()) == {
        "future_key": 1,
        "structure_mode": "hybrid",
    }


def test_read_returns_none_for_corrupt_json(data_root):
    (data_root / "settings.json").write_text("{not json")
    assert storage.read_structure_mode() is None


def test_read_returns_none_when_value_is_not_a_string(data_root):
    (data_root / "settings.json").write_text(json.dumps({"structure_mode": 7}))
    assert storage.read_structure_mode() is None


def test_write_wraps_filesystem_failure_as_storage_error(data_root, monkeypatch):
    def boom(*args, **kwargs):
        raise StorageError("disk full")

    monkeypatch.setattr("app.storage.settings_store.atomic_write", boom)
    with pytest.raises(StorageError):
        storage.write_structure_mode("hybrid")
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest tests/test_settings_store.py -q`
Expected: FAIL, `AttributeError: module 'app.storage' has no attribute 'read_structure_mode'`.

- [ ] **Step 3: Add the path resolver**

In `server/app/storage/paths.py`, directly after `library_path()`:

```python
def settings_path() -> Path:
    """Resolve ``~/.paper-mate/settings.json`` — app-level settings, a sibling of
    ``library.json`` (not a per-doc artifact, so never inside ``library/``)."""
    return data_root() / "settings.json"
```

- [ ] **Step 4: Write the store**

Create `server/app/storage/settings_store.py`:

```python
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

    Returns the raw string without validating it against the mode vocabulary —
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
```

- [ ] **Step 5: Re-export from the storage package**

In `server/app/storage/__init__.py`, add the import beside the other module imports (after the `structure_progress` import block):

```python
from app.storage.settings_store import (
    read_structure_mode,
    write_structure_mode,
)
```

and add both names to `__all__`:

```python
    "read_structure_mode",
    "write_structure_mode",
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest tests/test_settings_store.py -q`
Expected: PASS, 7 passed.

- [ ] **Step 7: Commit**

```bash
git add server/app/storage/settings_store.py server/app/storage/paths.py server/app/storage/__init__.py server/tests/test_settings_store.py
git commit -m "Feat: Persist app settings in settings.json under the data root"
```

---

### Task 2: Make the hybrid-server launcher callable at runtime

The launcher currently reads the process-wide resolved mode from `domain.structure`, which only works at boot. Make it a pure function of its arguments, and make readiness failure an honest failure (terminate the process, return `None`) so a runtime flip can report an error instead of silently sitting on a dead server.

**Files:**
- Modify: `server/app/structure_hybrid.py`, `server/app/main.py:52`
- Test: `server/tests/test_structure_hybrid.py` (rewrite the helper and calls)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `start_hybrid_server(mode: str, url: str) -> subprocess.Popen | None` — returns the running, ready process, or `None` when nothing was launched (mode is not hybrid, the URL is remote, the spawn failed) or when readiness timed out (the spawned process is terminated first).
  - `stop_hybrid_server(proc: subprocess.Popen | None) -> None` — unchanged.

- [ ] **Step 1: Rewrite the tests for the new signature**

Replace the whole of `server/tests/test_structure_hybrid.py` with:

```python
"""Bundled hybrid-server lifecycle tests (Story 10.3, runtime-toggle update).

The real ``opendataloader-pdf-hybrid`` subprocess is NEVER spawned here (heavy:
Docling + torch). ``subprocess.Popen`` + the readiness poll are mocked, so this
covers only the launch/skip/stop DECISIONS.
"""

import subprocess
from unittest.mock import MagicMock

import app.structure_hybrid as sh

_URL = "http://localhost:5002"


def _no_spawn(*a, **k):
    raise AssertionError("subprocess should not be spawned in local mode")


def test_start_returns_none_in_local_mode(monkeypatch):
    monkeypatch.setattr(sh.subprocess, "Popen", _no_spawn)
    assert sh.start_hybrid_server("local", _URL) is None


def test_start_returns_none_for_remote_url(monkeypatch):
    spawned = []
    monkeypatch.setattr(sh.subprocess, "Popen", lambda *a, **k: spawned.append(1))
    # A remote hybrid URL means an external server the operator runs -> we skip.
    assert sh.start_hybrid_server("hybrid", "http://remote-host:5002") is None
    assert spawned == []


def test_start_launches_local_server_with_device_and_no_ocr(monkeypatch):
    monkeypatch.setenv("PAPER_MATE_STRUCTURE_HYBRID_DEVICE", "cpu")
    captured = {}
    proc = MagicMock()
    proc.poll.return_value = None

    def fake_popen(cmd, **kwargs):
        captured["cmd"] = cmd
        return proc

    monkeypatch.setattr(sh.subprocess, "Popen", fake_popen)
    monkeypatch.setattr(sh, "_wait_ready", lambda url, p: True)

    assert sh.start_hybrid_server("hybrid", _URL) is proc
    assert "--no-ocr" in captured["cmd"]
    assert captured["cmd"][captured["cmd"].index("--device") + 1] == "cpu"
    assert captured["cmd"][captured["cmd"].index("--port") + 1] == "5002"


def test_start_returns_none_and_stops_process_when_not_ready(monkeypatch):
    proc = MagicMock()
    monkeypatch.setattr(sh.subprocess, "Popen", lambda *a, **k: proc)
    monkeypatch.setattr(sh, "_wait_ready", lambda url, p: False)

    # A server that never becomes ready is an honest failure: kill it and say so,
    # rather than leaving a dead process the caller believes in.
    assert sh.start_hybrid_server("hybrid", _URL) is None
    proc.terminate.assert_called_once()


def test_start_returns_none_when_spawn_raises(monkeypatch):
    def boom(*a, **k):
        raise OSError("no such binary")

    monkeypatch.setattr(sh.subprocess, "Popen", boom)
    assert sh.start_hybrid_server("hybrid", _URL) is None


def test_stop_is_a_noop_for_none():
    sh.stop_hybrid_server(None)  # must not raise


def test_stop_terminates_then_kills_on_timeout():
    proc = MagicMock()
    proc.wait.side_effect = subprocess.TimeoutExpired(cmd="x", timeout=10)
    sh.stop_hybrid_server(proc)
    proc.terminate.assert_called_once()
    proc.kill.assert_called_once()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest tests/test_structure_hybrid.py -q`
Expected: FAIL, `TypeError: start_hybrid_server() takes 0 positional arguments but 2 were given`.

- [ ] **Step 3: Change the launcher signature**

In `server/app/structure_hybrid.py`, delete the import line

```python
from app.domain.structure import active_mode, hybrid_url
```

and replace `start_hybrid_server` (lines 59-98) with:

```python
def start_hybrid_server(mode: str, url: str) -> subprocess.Popen | None:
    """Launch the bundled hybrid server iff ``mode`` is hybrid and ``url`` is local.

    Blocking (spawns, then waits for ``/health``); call via ``asyncio.to_thread``
    from the async lifespan, or from a background task on a runtime flip, so the
    event loop is not blocked. Mode and URL are ARGUMENTS rather than module
    globals because the mode is now switchable at runtime: ``app.structure_mode``
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
        logger.warning("structure hybrid: server not ready within %ss; stopping it", _READY_TIMEOUT_S)
        stop_hybrid_server(proc)
        return None
    logger.info("structure hybrid: server ready on %s (device=%s)", url, device)
    return proc
```

- [ ] **Step 4: Keep the boot caller compiling**

In `server/app/main.py`, change line 52 from `hybrid_proc = await asyncio.to_thread(start_hybrid_server)` to:

```python
        hybrid_proc = await asyncio.to_thread(start_hybrid_server, active_mode(), hybrid_url())
```

and add `hybrid_url` to the existing `from app.domain.structure import ...` usage by importing it at the top of `main.py`:

```python
from app.domain.structure import active_mode, hybrid_url
```

(Task 4 removes this again once `structure_mode` owns boot.)

- [ ] **Step 5: Run the hybrid + health suites**

Run: `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest tests/test_structure_hybrid.py -q`
Expected: PASS, 7 passed.

- [ ] **Step 6: Commit**

```bash
git add server/app/structure_hybrid.py server/app/main.py server/tests/test_structure_hybrid.py
git commit -m "Refactor: Pass mode and URL into the hybrid server launcher

Readiness failure now terminates the process and returns None so a caller
can report the failure instead of holding a dead server."
```

---

### Task 3: The runtime mode service

The heart of the feature. Owns the mode, the subprocess, the transition state machine, and the per-extraction snapshot.

**Files:**
- Create: `server/app/structure_mode.py`
- Modify: `server/tests/conftest.py`
- Test: `server/tests/test_structure_mode.py`

**Interfaces:**
- Consumes: `app.storage.read_structure_mode` / `write_structure_mode` (Task 1), `app.structure_hybrid.start_hybrid_server(mode, url)` / `stop_hybrid_server(proc)` (Task 2).
- Produces:
  - `StructureMode = Literal["local", "hybrid"]`, `ModeTransition = Literal["idle", "starting", "stopping"]`
  - `ExtractionSettings` — frozen dataclass with `mode: StructureMode` and `hybrid_url: str`.
  - `ModeState` — frozen dataclass with `mode: StructureMode`, `transition: ModeTransition`, `error: str | None`.
  - `ModeBusyError(RuntimeError)`
  - `current_state() -> ModeState`
  - `begin_transition(target: StructureMode) -> ModeState` — fast, non-blocking; raises `ModeBusyError` if a transition is already running.
  - `run_transition() -> None` — blocking; performs the pending spawn or stop.
  - `extraction_mode() -> ContextManager[ExtractionSettings]`
  - `start_at_boot() -> None`, `shutdown() -> None`
  - `reset_state_for_tests() -> None`

- [ ] **Step 1: Write the failing tests**

Create `server/tests/test_structure_mode.py`:

```python
"""The runtime structure-mode service: boot resolution, transitions, drain.

The real hybrid server is never spawned; `start_hybrid_server` /
`stop_hybrid_server` are patched on the `app.structure_mode` module so these
tests cover only the state machine.
"""

import threading

import pytest

from app import structure_mode as sm


@pytest.fixture
def fake_hybrid(monkeypatch):
    """Patch the subprocess boundary; record start/stop calls."""
    calls = {"started": [], "stopped": [], "proc": object()}

    def start(mode, url):
        calls["started"].append((mode, url))
        return calls["proc"]

    monkeypatch.setattr(sm, "start_hybrid_server", start)
    monkeypatch.setattr(sm, "stop_hybrid_server", lambda proc: calls["stopped"].append(proc))
    return calls


# --- boot resolution -------------------------------------------------------

def test_boot_mode_is_local_when_nothing_is_set(data_root, monkeypatch):
    monkeypatch.delenv("PAPER_MATE_STRUCTURE_MODE", raising=False)
    assert sm.resolve_boot_mode() == "local"


def test_boot_mode_falls_back_to_env_when_unpersisted(data_root, monkeypatch):
    monkeypatch.setenv("PAPER_MATE_STRUCTURE_MODE", "hybrid")
    assert sm.resolve_boot_mode() == "hybrid"


def test_persisted_setting_wins_over_env(data_root, monkeypatch):
    monkeypatch.setenv("PAPER_MATE_STRUCTURE_MODE", "hybrid")
    from app import storage

    storage.write_structure_mode("local")
    assert sm.resolve_boot_mode() == "local"


def test_unknown_persisted_value_fails_safe_to_local(data_root, monkeypatch):
    monkeypatch.delenv("PAPER_MATE_STRUCTURE_MODE", raising=False)
    from app import storage

    storage.write_structure_mode("hybrd")
    assert sm.resolve_boot_mode() == "local"


# --- transitions -----------------------------------------------------------

def test_initial_state_is_local_and_idle():
    state = sm.current_state()
    assert (state.mode, state.transition, state.error) == ("local", "idle", None)


def test_begin_transition_to_same_mode_is_a_noop():
    state = sm.begin_transition("local")
    assert state.transition == "idle"


def test_flip_to_hybrid_starts_the_server_and_persists(data_root, fake_hybrid):
    pending = sm.begin_transition("hybrid")
    assert pending.transition == "starting"
    assert pending.mode == "local"  # not hybrid until the server is up

    sm.run_transition()

    state = sm.current_state()
    assert (state.mode, state.transition, state.error) == ("hybrid", "idle", None)
    assert fake_hybrid["started"] == [("hybrid", "http://localhost:5002")]

    from app import storage

    assert storage.read_structure_mode() == "hybrid"


def test_failed_start_reverts_to_local_with_an_error(data_root, monkeypatch):
    monkeypatch.setattr(sm, "start_hybrid_server", lambda mode, url: None)
    sm.begin_transition("hybrid")
    sm.run_transition()

    state = sm.current_state()
    assert state.mode == "local"
    assert state.transition == "idle"
    assert state.error is not None


def test_flip_back_to_local_stops_the_server(data_root, fake_hybrid):
    sm.begin_transition("hybrid")
    sm.run_transition()

    sm.begin_transition("local")
    sm.run_transition()

    state = sm.current_state()
    assert (state.mode, state.transition) == ("local", "idle")
    assert fake_hybrid["stopped"] == [fake_hybrid["proc"]]


def test_second_transition_while_one_is_pending_is_rejected(data_root, fake_hybrid):
    sm.begin_transition("hybrid")
    with pytest.raises(sm.ModeBusyError):
        sm.begin_transition("local")


def test_error_clears_on_the_next_successful_flip(data_root, monkeypatch, fake_hybrid):
    monkeypatch.setattr(sm, "start_hybrid_server", lambda mode, url: None)
    sm.begin_transition("hybrid")
    sm.run_transition()
    assert sm.current_state().error is not None

    monkeypatch.setattr(sm, "start_hybrid_server", lambda mode, url: fake_hybrid["proc"])
    sm.begin_transition("hybrid")
    sm.run_transition()
    assert sm.current_state().error is None


# --- per-extraction snapshot + drain ---------------------------------------

def test_extraction_mode_yields_the_current_mode_and_url(data_root, fake_hybrid):
    with sm.extraction_mode() as settings:
        assert settings.mode == "local"
        assert settings.hybrid_url == "http://localhost:5002"


def test_extraction_keeps_the_snapshot_after_a_mid_flight_flip(data_root, fake_hybrid):
    sm.begin_transition("hybrid")
    sm.run_transition()

    with sm.extraction_mode() as settings:
        assert settings.mode == "hybrid"
        sm.begin_transition("local")
        sm.run_transition()
        # The in-flight extraction keeps its snapshot and its live server.
        assert settings.mode == "hybrid"
        assert fake_hybrid["stopped"] == []
        assert sm.current_state().transition == "stopping"

    # Draining the last in-flight extraction completes the pending stop.
    assert fake_hybrid["stopped"] == [fake_hybrid["proc"]]
    assert sm.current_state().transition == "idle"
    assert sm.current_state().mode == "local"


def test_stop_waits_for_every_in_flight_extraction(data_root, fake_hybrid):
    sm.begin_transition("hybrid")
    sm.run_transition()

    outer = sm.extraction_mode()
    inner = sm.extraction_mode()
    outer.__enter__()
    inner.__enter__()

    sm.begin_transition("local")
    sm.run_transition()

    outer.__exit__(None, None, None)
    assert fake_hybrid["stopped"] == []  # one extraction still running
    inner.__exit__(None, None, None)
    assert fake_hybrid["stopped"] == [fake_hybrid["proc"]]


def test_refcount_survives_an_extraction_that_raises(data_root, fake_hybrid):
    sm.begin_transition("hybrid")
    sm.run_transition()

    with pytest.raises(ValueError):
        with sm.extraction_mode():
            raise ValueError("extraction blew up")

    sm.begin_transition("local")
    sm.run_transition()
    assert fake_hybrid["stopped"] == [fake_hybrid["proc"]]


def test_concurrent_extractions_refcount_correctly(data_root, fake_hybrid):
    sm.begin_transition("hybrid")
    sm.run_transition()

    barrier = threading.Barrier(4)

    def work():
        with sm.extraction_mode():
            barrier.wait()

    threads = [threading.Thread(target=work) for _ in range(3)]
    for t in threads:
        t.start()
    barrier.wait()
    for t in threads:
        t.join()

    sm.begin_transition("local")
    sm.run_transition()
    assert fake_hybrid["stopped"] == [fake_hybrid["proc"]]


# --- boot + shutdown -------------------------------------------------------

def test_start_at_boot_launches_nothing_in_local_mode(data_root, monkeypatch):
    monkeypatch.delenv("PAPER_MATE_STRUCTURE_MODE", raising=False)
    monkeypatch.setattr(sm, "start_hybrid_server", lambda mode, url: pytest.fail("spawned"))
    sm.start_at_boot()
    assert sm.current_state().mode == "local"


def test_start_at_boot_launches_in_hybrid_mode(data_root, monkeypatch, fake_hybrid):
    monkeypatch.setenv("PAPER_MATE_STRUCTURE_MODE", "hybrid")
    sm.start_at_boot()
    assert sm.current_state().mode == "hybrid"
    assert fake_hybrid["started"] == [("hybrid", "http://localhost:5002")]


def test_boot_failure_falls_back_to_local_and_never_raises(data_root, monkeypatch):
    monkeypatch.setenv("PAPER_MATE_STRUCTURE_MODE", "hybrid")
    monkeypatch.setattr(sm, "start_hybrid_server", lambda mode, url: None)
    sm.start_at_boot()
    state = sm.current_state()
    assert state.mode == "local"
    assert state.error is not None


def test_shutdown_stops_a_running_server(data_root, fake_hybrid):
    sm.begin_transition("hybrid")
    sm.run_transition()
    sm.shutdown()
    assert fake_hybrid["stopped"] == [fake_hybrid["proc"]]
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest tests/test_structure_mode.py -q`
Expected: FAIL at collection, `ModuleNotFoundError: No module named 'app.structure_mode'`.

- [ ] **Step 3: Write the service**

Create `server/app/structure_mode.py`:

```python
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
        self.proc = None
        self.pending: StructureMode | None = None
        self.inflight = 0
        self.stop_when_drained = False


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
            raise ModeBusyError("a structure-mode change is already in progress")
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
    url = hybrid_url()
    proc = start_hybrid_server("hybrid", url)
    with _lock:
        if proc is None:
            _runtime.mode = "local"
            _runtime.error = "The hybrid structure server did not start. Staying on local."
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
            _runtime.error = "The hybrid structure server did not start. Staying on local."
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
    between tests; ``conftest`` calls this before each one."""
    global _runtime
    with _lock:
        _runtime = _Runtime()
```

- [ ] **Step 4: Reset the global state between tests**

In `server/tests/conftest.py`, add after the `_reset_structure_analyzing` fixture:

```python
@pytest.fixture(autouse=True)
def _reset_structure_mode():
    """The runtime structure-mode service holds process-global state (mode, the
    hybrid subprocess handle, refcounts); reset it so tests never leak into
    each other."""
    from app import structure_mode

    structure_mode.reset_state_for_tests()
    yield
    structure_mode.reset_state_for_tests()
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest tests/test_structure_mode.py -q`
Expected: PASS, 19 passed.

- [ ] **Step 6: Commit**

```bash
git add server/app/structure_mode.py server/tests/test_structure_mode.py server/tests/conftest.py
git commit -m "Feat: Add the runtime structure-mode service

Owns the mode, the hybrid server process, and the transition state machine.
Flips affect extractions that start after them; a flip to local defers the
server shutdown until in-flight hybrid extractions drain."
```

---

### Task 4: Take the mode out of the domain layer

`domain/structure.py` still resolves the mode at import and holds a pre-built extractor. Move that state out entirely so the domain is a pure function of its arguments, and point every consumer at the service.

**Files:**
- Modify: `server/app/domain/structure.py:36-84` and `:295-317`, `server/app/domain/__init__.py`, `server/app/routes/extraction.py:84`, `server/app/routes/health.py`, `server/app/main.py`
- Test: `server/tests/test_structure.py` (adjust calls), `server/tests/test_health.py` (adjust the mode assertions)

**Interfaces:**
- Consumes: `app.structure_mode.extraction_mode()`, `current_state()`, `start_at_boot()`, `shutdown()` (Task 3).
- Produces:
  - `domain.extract_structure(pdf_bytes: bytes, *, mode: str = "local", hybrid_url: str = "http://localhost:5002") -> DocStructure` — still total, never raises.
  - `domain.active_mode` and `domain.structure.hybrid_url` no longer exist.

- [ ] **Step 1: Write the failing tests**

Append to `server/tests/test_structure.py`:

```python
def test_extract_structure_defaults_to_local_mode(monkeypatch):
    """The domain surface takes the mode as an argument now; nothing in the
    domain layer reads the env or holds a pre-built extractor."""
    from app.domain import structure as structure_mod

    seen = {}

    class Spy:
        def __init__(self, mode, hybrid_url, **kwargs):
            seen["mode"] = mode
            seen["hybrid_url"] = hybrid_url

        def extract(self, pdf_bytes):
            from app.models import DocStructure

            return DocStructure()

    monkeypatch.setattr(structure_mod, "OpenDataLoaderExtractor", Spy)
    structure_mod.extract_structure(b"%PDF-1.4")
    assert seen["mode"] == "local"


def test_extract_structure_passes_hybrid_settings_through(monkeypatch):
    from app.domain import structure as structure_mod

    seen = {}

    class Spy:
        def __init__(self, mode, hybrid_url, **kwargs):
            seen["mode"] = mode
            seen["hybrid_url"] = hybrid_url

        def extract(self, pdf_bytes):
            from app.models import DocStructure

            return DocStructure()

    monkeypatch.setattr(structure_mod, "OpenDataLoaderExtractor", Spy)
    structure_mod.extract_structure(b"%PDF-1.4", mode="hybrid", hybrid_url="http://h:5002")
    assert seen == {"mode": "hybrid", "hybrid_url": "http://h:5002"}


def test_extract_structure_is_total_when_the_extractor_explodes(monkeypatch):
    from app.models import DocStructure
    from app.domain import structure as structure_mod

    class Boom:
        def __init__(self, mode, hybrid_url, **kwargs):
            pass

        def extract(self, pdf_bytes):
            raise RuntimeError("JVM died")

    monkeypatch.setattr(structure_mod, "OpenDataLoaderExtractor", Boom)
    assert structure_mod.extract_structure(b"%PDF-1.4") == DocStructure()


def test_domain_no_longer_exports_active_mode():
    from app import domain

    assert not hasattr(domain, "active_mode")
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest tests/test_structure.py -q`
Expected: FAIL, `TypeError: extract_structure() got an unexpected keyword argument 'mode'` and the `active_mode` assertion failing.

- [ ] **Step 3: Strip the globals from the domain module**

In `server/app/domain/structure.py`, delete lines 36-84 (the `StructureMode` alias through `hybrid_url()`) and replace with:

```python
StructureMode = Literal["local", "hybrid"]

#: Default URL of the opendataloader hybrid server (Docling Fast Server). The
#: hybrid backend is a SEPARATE process the Java core calls over HTTP; the
#: runtime owner (``app.structure_mode``) launches it and passes the URL in.
_HYBRID_URL_DEFAULT = "http://localhost:5002"
#: Per-request hybrid timeout (ms). The spike measured ~16s GPU / ~37-98s CPU per
#: paper; 120s leaves CPU-fallback headroom. ``hybrid_fallback`` degrades a stuck
#: page to the Java result rather than emptying the whole structure.
_HYBRID_TIMEOUT_MS = 120_000
```

(Keep the `import os` line only if another symbol still uses it; if nothing does, remove it and let the linter confirm.)

- [ ] **Step 4: Make the domain surface take the mode**

In the same file, replace lines 295-317 (the `_default_extractor` global and `extract_structure`) with:

```python
def extract_structure(
    pdf_bytes: bytes,
    *,
    mode: StructureMode = "local",
    hybrid_url: str = _HYBRID_URL_DEFAULT,
) -> DocStructure:
    """Extract a document's structure, best-effort (FR-34, AD-13, AD-L8).

    The domain surface. ``mode`` and ``hybrid_url`` are ARGUMENTS, not module
    state: the mode is switchable at runtime and ``app.structure_mode`` owns it,
    so the domain layer stays a pure function of its inputs and two callers can
    never disagree about which mode is active.

    **Total** -- any failure returns ``DocStructure()``, never raises -- so the
    background import pipeline can call it without a guard of its own. Also
    enforces the return CONTRACT: a swapped adapter that returns a non-
    ``DocStructure`` (e.g. ``None``) is coerced to an empty structure rather than
    leaking an off-contract value downstream.
    """
    try:
        extractor = OpenDataLoaderExtractor(mode=mode, hybrid_url=hybrid_url)
        result = extractor.extract(pdf_bytes)
    except Exception:
        return DocStructure()
    return result if isinstance(result, DocStructure) else DocStructure()
```

- [ ] **Step 5: Update the domain facade**

In `server/app/domain/__init__.py`, drop `active_mode` from both the import block and `__all__`:

```python
from app.domain.structure import (
    OpenDataLoaderExtractor,
    StructureExtractor,
    extract_structure,
)
```

- [ ] **Step 6: Point the composition root at the service**

In `server/app/routes/extraction.py`, add the import:

```python
from app import domain, storage, structure_mode
```

and replace line 84 (`structure = domain.extract_structure(pdf_bytes)`) with:

```python
        with structure_mode.extraction_mode() as settings:
            structure = domain.extract_structure(
                pdf_bytes, mode=settings.mode, hybrid_url=settings.hybrid_url
            )
```

- [ ] **Step 7: Report the live mode from health**

Replace `server/app/routes/health.py` in full:

```python
"""Health route — proves the ``/api`` surface and dev proxy work end-to-end."""

from fastapi import APIRouter

from app.models import HealthStatus
from app.structure_mode import current_state
from app.version import get_version

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthStatus)
def get_health() -> HealthStatus:
    """Return liveness + app version + active structure mode. No filesystem
    access (AD-9). ``structure_mode`` comes from ``app.structure_mode``, the
    single runtime owner, so the reported mode is always the mode the next
    extraction will actually run in — including after a runtime flip."""
    return HealthStatus(version=get_version(), structure_mode=current_state().mode)
```

- [ ] **Step 8: Hand the lifespan to the service**

In `server/app/main.py`, replace the import added in Task 2 (`from app.domain.structure import active_mode, hybrid_url`) and the `from app.structure_hybrid import start_hybrid_server, stop_hybrid_server` line with:

```python
from app import structure_mode
```

then replace the hybrid block inside `_lifespan` (lines 50-61) with:

```python
    try:
        await asyncio.to_thread(structure_mode.start_at_boot)
    except Exception:
        logger.exception("structure mode: boot start failed; continuing in local mode")
    try:
        yield
    finally:
        try:
            await asyncio.to_thread(structure_mode.shutdown)
        except Exception:
            logger.exception("structure hybrid server shutdown failed")
```

Update the `_lifespan` docstring's second paragraph to:

```python
    In hybrid structure mode also launch the bundled Docling hybrid server off
    the event loop; local mode (the default) launches nothing. The mode resolves
    through ``app.structure_mode`` (persisted setting > env > local), which then
    owns the process for the rest of the run. Both the launch and shutdown are
    best-effort + logged, so neither can brick boot.
```

- [ ] **Step 9: Fix the health test's mode assertions**

In `server/tests/test_health.py`, any test that monkeypatches the env or `structure_mod._ACTIVE_MODE` to assert the reported mode must instead drive the service. Replace those with:

```python
def test_health_reports_the_runtime_structure_mode(monkeypatch):
    from app import structure_mode

    monkeypatch.setattr(structure_mode, "start_hybrid_server", lambda mode, url: object())
    structure_mode.begin_transition("hybrid")
    structure_mode.run_transition()

    res = client.get("/api/health")
    assert res.json()["structure_mode"] == "hybrid"
```

- [ ] **Step 10: Run the whole backend suite**

Run: `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q`
Expected: PASS. Every reference to `active_mode`, `hybrid_url`, or `_ACTIVE_MODE` outside `structure_mode.py` should now be gone; if a test still imports one, update it to drive the service the same way Step 9 does.

- [ ] **Step 11: Commit**

```bash
git add server/app/domain/structure.py server/app/domain/__init__.py server/app/routes/extraction.py server/app/routes/health.py server/app/main.py server/tests/test_structure.py server/tests/test_health.py
git commit -m "Refactor: Pass the structure mode into the domain layer

The mode is now owned by app.structure_mode and snapshotted per extraction,
so the domain layer holds no process state and health reports the live mode."
```

---

### Task 5: The settings endpoints

**Files:**
- Create: `server/app/routes/settings.py`, `server/tests/test_settings_routes.py`
- Modify: `server/app/models.py` (after `HealthStatus`), `server/app/routes/__init__.py`, `server/openapi.json` (generated), `client/src/api/schema.d.ts` (generated), `docs/API.md`

**Interfaces:**
- Consumes: `app.structure_mode.current_state`, `begin_transition`, `run_transition`, `ModeBusyError` (Task 3).
- Produces:
  - `GET /api/settings/structure-mode` → `StructureModeState` `{ mode, transition, error }`
  - `PUT /api/settings/structure-mode` body `StructureModeRequest` `{ mode }` → `StructureModeState`; `409` when busy, `422` for an unknown mode.

- [ ] **Step 1: Write the failing tests**

Create `server/tests/test_settings_routes.py`:

```python
"""`/api/settings/structure-mode` — the runtime mode toggle's HTTP surface."""

from fastapi.testclient import TestClient

from app import structure_mode
from app.main import app

client = TestClient(app)


def _stub_server(monkeypatch, proc=object()):
    monkeypatch.setattr(structure_mode, "start_hybrid_server", lambda mode, url: proc)
    monkeypatch.setattr(structure_mode, "stop_hybrid_server", lambda p: None)


def test_get_returns_the_default_state(data_root):
    res = client.get("/api/settings/structure-mode")
    assert res.status_code == 200
    assert res.json() == {"mode": "local", "transition": "idle", "error": None}


def test_put_hybrid_reports_starting_then_settles(data_root, monkeypatch):
    _stub_server(monkeypatch)
    res = client.put("/api/settings/structure-mode", json={"mode": "hybrid"})
    assert res.status_code == 200
    # TestClient runs background tasks after the response, so by the time the
    # next request is served the transition has already completed.
    assert client.get("/api/settings/structure-mode").json() == {
        "mode": "hybrid",
        "transition": "idle",
        "error": None,
    }


def test_put_the_active_mode_is_a_noop(data_root):
    res = client.put("/api/settings/structure-mode", json={"mode": "local"})
    assert res.status_code == 200
    assert res.json()["transition"] == "idle"


def test_put_rejects_an_unknown_mode(data_root):
    res = client.put("/api/settings/structure-mode", json={"mode": "turbo"})
    assert res.status_code == 422
    assert isinstance(res.json()["detail"], str)


def test_put_conflicts_while_a_transition_is_in_flight(data_root, monkeypatch):
    # Leave a transition pending by never running it.
    structure_mode.begin_transition("hybrid")
    res = client.put("/api/settings/structure-mode", json={"mode": "local"})
    assert res.status_code == 409
    assert isinstance(res.json()["detail"], str)


def test_failed_start_surfaces_the_error_on_the_next_get(data_root, monkeypatch):
    monkeypatch.setattr(structure_mode, "start_hybrid_server", lambda mode, url: None)
    client.put("/api/settings/structure-mode", json={"mode": "hybrid"})
    body = client.get("/api/settings/structure-mode").json()
    assert body["mode"] == "local"
    assert body["error"]
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest tests/test_settings_routes.py -q`
Expected: FAIL, 404 on every request (the router is not mounted).

Note the CLAUDE.md sandbox caveat: `TestClient`-backed tests can hang inside the Codex review sandbox. On the host they run normally.

- [ ] **Step 3: Add the contract models**

In `server/app/models.py`, directly after `HealthStatus`:

```python
#: The document-structure extraction mode (AD-13). ``local`` is the
#: deterministic + offline default; ``hybrid`` uses the higher-fidelity Docling
#: backend and costs a model load plus a slower import.
StructureMode = Literal["local", "hybrid"]
#: Whether a mode change is in flight. ``starting`` = bringing the hybrid server
#: up, ``stopping`` = waiting for in-flight hybrid extractions to drain.
ModeTransition = Literal["idle", "starting", "stopping"]


class StructureModeState(BaseModel):
    """Response for ``GET``/``PUT /api/settings/structure-mode``: the live mode,
    any in-flight transition, and the last failure (cleared by the next
    successful change)."""

    mode: StructureMode = "local"
    transition: ModeTransition = "idle"
    error: str | None = None


class StructureModeRequest(BaseModel):
    """Body of ``PUT /api/settings/structure-mode``."""

    mode: StructureMode
```

Then change `HealthStatus.structure_mode` to reuse the alias:

```python
    structure_mode: StructureMode = "local"
```

(Define the alias above `HealthStatus` if the ordering requires it.)

- [ ] **Step 4: Write the route module**

Create `server/app/routes/settings.py`:

```python
"""App settings routes (AD-9). Thin: no filesystem access, no process logic.

Today one resource, the document-structure extraction mode. Bringing the hybrid
server up takes a model load, far longer than a request should hold, so the PUT
returns the ``starting``/``stopping`` state immediately and does the work in a
background task; the client polls the GET until ``transition`` is ``idle``. Same
shape as the structure-status dot's settle polling.
"""

from fastapi import APIRouter, BackgroundTasks, HTTPException

from app import structure_mode
from app.models import StructureModeRequest, StructureModeState

router = APIRouter(prefix="/settings", tags=["settings"])


def _to_response(state: structure_mode.ModeState) -> StructureModeState:
    return StructureModeState(mode=state.mode, transition=state.transition, error=state.error)


@router.get("/structure-mode", response_model=StructureModeState)
def get_structure_mode() -> StructureModeState:
    """The live extraction mode plus any in-flight transition."""
    return _to_response(structure_mode.current_state())


@router.put("/structure-mode", response_model=StructureModeState)
def put_structure_mode(body: StructureModeRequest, background: BackgroundTasks) -> StructureModeState:
    """Request a mode change. Returns the transitional state at once and runs
    the spawn or shutdown in the background."""
    try:
        state = structure_mode.begin_transition(body.mode)
    except structure_mode.ModeBusyError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if state.transition != "idle":
        background.add_task(structure_mode.run_transition)
    return _to_response(state)
```

- [ ] **Step 5: Mount the router**

In `server/app/routes/__init__.py`, add the import and the include:

```python
from app.routes.settings import router as settings_router
```

```python
api_router.include_router(settings_router)
```

and extend the module docstring's first paragraph with `, and ``settings`` (the runtime document-structure mode)`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest tests/test_settings_routes.py -q`
Expected: PASS, 6 passed.

- [ ] **Step 7: Regenerate the contract**

Run:

```bash
cd server && PYTHONPATH= uv run python -m app.export_openapi
cd ../client && npm run gen:api
```

Expected: `server/openapi.json` gains the two paths and the `StructureModeState`/`StructureModeRequest` schemas; `client/src/api/schema.d.ts` regenerates.

- [ ] **Step 8: Document the endpoints**

In `docs/API.md`, add a resource entry for `/api/settings/structure-mode` matching the file's existing format for other resources: both methods, the request body, the response fields (`mode`, `transition`, `error`), the `409` conflict, and the `422` envelope. Add a dated changelog line:

```markdown
- 2026-07-22: Added `GET`/`PUT /api/settings/structure-mode` (runtime document-structure mode toggle). `GET /api/health.structure_mode` now reports the live runtime mode rather than the boot-time env value.
```

Check the entry for em-dashes before saving.

- [ ] **Step 9: Run the full backend suite**

Run: `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add server/app/routes/settings.py server/app/routes/__init__.py server/app/models.py server/openapi.json client/src/api/schema.d.ts server/tests/test_settings_routes.py docs/API.md
git commit -m "Feat: Add the structure-mode settings endpoints

GET/PUT /api/settings/structure-mode expose the runtime extraction mode.
The PUT returns the transitional state and spawns or stops the hybrid
server in the background; the client polls until it settles."
```

---

### Task 6: Client API + the mode hook

**Files:**
- Modify: `client/src/api/client.ts` (types near line 38, functions after `fetchHealth`)
- Create: `client/src/library/useStructureMode.ts`
- Test: covered by Task 7's component test, which drives the hook through the component.

**Interfaces:**
- Consumes: `components["schemas"]["StructureModeState"]` from the regenerated schema (Task 5); `useSettlePolling` from `client/src/library/useSettlePolling.ts`.
- Produces:
  - `export type StructureModeState`, `export type StructureModeValue = StructureModeState["mode"]`
  - `fetchStructureMode(): Promise<StructureModeState>`
  - `setStructureMode(mode: StructureModeValue): Promise<StructureModeState>`
  - `useStructureMode(): { state: StructureModeState | null; busy: boolean; failed: boolean; toggle: () => void }`

- [ ] **Step 1: Add the API types**

In `client/src/api/client.ts`, after the structure-layer type block (line 38):

```ts
// Runtime document-structure mode (the Library toggle). Generated, never
// hand-authored (AD-3).
export type StructureModeState = components["schemas"]["StructureModeState"];
export type StructureModeValue = StructureModeState["mode"];
```

- [ ] **Step 2: Add the two calls**

In the same file, directly after `fetchHealth`:

```ts
/** Read the live document-structure extraction mode and any in-flight change. */
export async function fetchStructureMode(): Promise<StructureModeState> {
  const res = await fetch("/api/settings/structure-mode");
  if (!res.ok) throw await envelopeError(res);
  return (await res.json()) as StructureModeState;
}

/**
 * Request a document-structure mode change. Returns immediately with the
 * transitional state (`starting`/`stopping`); the caller polls
 * `fetchStructureMode` until `transition` is `idle`, since bringing the hybrid
 * server up costs a model load.
 */
export async function setStructureMode(mode: StructureModeValue): Promise<StructureModeState> {
  const res = await fetch("/api/settings/structure-mode", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode }),
  });
  if (!res.ok) throw await envelopeError(res);
  return (await res.json()) as StructureModeState;
}
```

- [ ] **Step 3: Write the hook**

Create `client/src/library/useStructureMode.ts`:

```ts
import { useCallback, useEffect, useState } from "react";
import {
  fetchStructureMode,
  setStructureMode,
  type StructureModeState,
  type StructureModeValue,
} from "@/api/client";
import { useSettlePolling } from "./useSettlePolling";

/** How often to re-check a mode change that is still in flight. */
const POLL_MS = 2000;
/** Safety cap: a hybrid model load is slow but bounded (the server gives up at
 *  120s), so ~2 minutes of polling is enough to never spin forever. */
const MAX_POLLS = 60;

/**
 * Owns the Library toggle's view of the runtime document-structure mode: read
 * it on mount, flip it, and poll while the backend is bringing the hybrid
 * server up or draining in-flight extractions.
 *
 * A failed flip is not thrown at the caller: the backend reverts to local and
 * reports `error`, which the toggle renders in place, so the control stays the
 * single place this state is visible.
 */
export function useStructureMode() {
  const [state, setState] = useState<StructureModeState | null>(null);

  const polling = useSettlePolling<StructureModeState>({
    fetch: fetchStructureMode,
    isSettled: (latest) => latest.transition === "idle",
    onResult: setState,
    intervalMs: POLL_MS,
    maxPolls: MAX_POLLS,
  });

  useEffect(() => {
    let cancelled = false;
    fetchStructureMode()
      .then((latest) => {
        if (cancelled) return;
        setState(latest);
        if (latest.transition !== "idle") polling.start();
      })
      .catch(() => {
        // A backend that cannot report its mode leaves the toggle hidden
        // rather than showing a mode we cannot vouch for.
        if (!cancelled) setState(null);
      });
    return () => {
      cancelled = true;
    };
    // `polling.start` is stable; run this once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = useCallback(() => {
    const current = state;
    if (!current || current.transition !== "idle") return;
    const next: StructureModeValue = current.mode === "hybrid" ? "local" : "hybrid";
    setStructureMode(next)
      .then((latest) => {
        setState(latest);
        if (latest.transition !== "idle") polling.start();
      })
      .catch((err: Error) => {
        setState({ ...current, error: err.message });
      });
  }, [state, polling]);

  return {
    state,
    busy: state !== null && state.transition !== "idle",
    failed: state !== null && state.error !== null && state.transition === "idle",
    toggle,
  };
}
```

- [ ] **Step 4: Typecheck**

Run: `cd client && npm run typecheck`
Expected: no errors. If `useSettlePolling`'s returned object names differ (`start`), match the actual export.

- [ ] **Step 5: Commit**

```bash
git add client/src/api/client.ts client/src/library/useStructureMode.ts
git commit -m "Feat: Add the client structure-mode API and hook"
```

---

### Task 7: The toggle in the folder-panel footer

**Files:**
- Create: `client/src/library/StructureModeToggle.tsx`, `client/src/library/StructureModeToggle.css`, `client/src/library/StructureModeToggle.test.tsx`
- Modify: `client/src/library/FolderPanel/FolderPanel.tsx:294-298`, `client/src/library/FolderPanel/FolderPanel.css:280-289`, `client/src/library/LibraryPage.test.tsx:23`

**Interfaces:**
- Consumes: `useStructureMode()` (Task 6).
- Produces: `StructureModeToggle` (default export, no props) rendered inside `.library-folder-panel__footer`.

- [ ] **Step 1: Write the failing test**

Create `client/src/library/StructureModeToggle.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/api/client";
import StructureModeToggle from "./StructureModeToggle";

function state(over: Partial<api.StructureModeState> = {}): api.StructureModeState {
  return { mode: "local", transition: "idle", error: null, ...over };
}

describe("StructureModeToggle", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the active mode once loaded", async () => {
    vi.spyOn(api, "fetchStructureMode").mockResolvedValue(state({ mode: "hybrid" }));
    render(<StructureModeToggle />);
    expect(await screen.findByText("Hybrid")).toBeInTheDocument();
    expect(screen.getByRole("switch")).toBeChecked();
  });

  it("flips to hybrid when clicked", async () => {
    vi.spyOn(api, "fetchStructureMode").mockResolvedValue(state());
    const put = vi
      .spyOn(api, "setStructureMode")
      .mockResolvedValue(state({ transition: "starting" }));

    render(<StructureModeToggle />);
    await screen.findByText("Local");
    await userEvent.click(screen.getByRole("switch"));

    expect(put).toHaveBeenCalledWith("hybrid");
    expect(await screen.findByText("Starting hybrid...")).toBeInTheDocument();
  });

  it("disables the switch while a change is in flight", async () => {
    vi.spyOn(api, "fetchStructureMode").mockResolvedValue(state({ transition: "starting" }));
    render(<StructureModeToggle />);
    await waitFor(() => expect(screen.getByRole("switch")).toBeDisabled());
  });

  it("shows a failed start and leaves the switch off", async () => {
    vi.spyOn(api, "fetchStructureMode").mockResolvedValue(
      state({ mode: "local", error: "The hybrid structure server did not start." }),
    );
    render(<StructureModeToggle />);
    expect(await screen.findByText("Hybrid failed")).toBeInTheDocument();
    expect(screen.getByRole("switch")).not.toBeChecked();
  });

  it("renders nothing when the mode cannot be read", async () => {
    vi.spyOn(api, "fetchStructureMode").mockRejectedValue(new Error("offline"));
    const { container } = render(<StructureModeToggle />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("keeps every user-facing string free of em-dashes", async () => {
    vi.spyOn(api, "fetchStructureMode").mockResolvedValue(state());
    const { container } = render(<StructureModeToggle />);
    await screen.findByText("Local");
    expect(container.innerHTML).not.toContain("—");
    expect(screen.getByRole("switch").getAttribute("title") ?? "").not.toContain("—");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd client && npm test -- StructureModeToggle`
Expected: FAIL, cannot resolve `./StructureModeToggle`.

- [ ] **Step 3: Write the component**

Create `client/src/library/StructureModeToggle.tsx`:

```tsx
import { useStructureMode } from "./useStructureMode";
import type { StructureModeState } from "@/api/client";
import "./StructureModeToggle.css";

const TOGGLE_TITLE =
  "Hybrid: higher fidelity, slower imports. Applies to papers imported after the switch.";

/** The one line of status under the label, derived from the backend state. */
function statusLabel(state: StructureModeState): string {
  if (state.transition === "starting") return "Starting hybrid...";
  if (state.transition === "stopping") return "Stopping hybrid...";
  if (state.error) return "Hybrid failed";
  return state.mode === "hybrid" ? "Hybrid" : "Local";
}

/**
 * The document-structure extraction mode toggle, pinned in the folder panel's
 * footer. Self-contained: it owns its own fetch/flip/poll through
 * `useStructureMode` rather than threading state through `LibraryPage`, because
 * nothing else on the page reads or writes the mode.
 *
 * Switching affects papers imported after the flip; already-extracted structure
 * is untouched, which the tooltip says out loud. A failed start is rendered in
 * place (the backend has already reverted to local) instead of raising a toast,
 * so the control stays the single home for this state.
 */
export default function StructureModeToggle() {
  const { state, busy, failed, toggle } = useStructureMode();
  if (!state) return null;

  return (
    <div className="structure-mode-toggle">
      <div className="structure-mode-toggle__row">
        <span className="structure-mode-toggle__label">Structure</span>
        <button
          type="button"
          role="switch"
          aria-checked={state.mode === "hybrid"}
          aria-label="Hybrid structure extraction"
          title={failed && state.error ? state.error : TOGGLE_TITLE}
          disabled={busy}
          onClick={toggle}
          className="structure-mode-toggle__switch"
          data-testid="structure-mode-switch"
        >
          <span className="structure-mode-toggle__knob" />
        </button>
      </div>
      <span
        className="structure-mode-toggle__status"
        data-failed={failed ? "true" : undefined}
        data-testid="structure-mode-status"
      >
        {statusLabel(state)}
      </span>
    </div>
  );
}
```

- [ ] **Step 4: Write the styles**

Create `client/src/library/StructureModeToggle.css`:

```css
/* Structure-mode toggle: the folder panel's footer control. Tokens only
   (CLAUDE.md); the hairline + bottom pinning belong to the footer wrapper in
   FolderPanel.css, not here. */

.structure-mode-toggle {
  display: flex;
  flex-direction: column;
  gap: var(--space-xxs);
}

.structure-mode-toggle__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.structure-mode-toggle__label {
  font-family: var(--font-sans);
  font-size: var(--type-caption-uppercase-size);
  font-weight: var(--type-caption-uppercase-weight);
  line-height: var(--type-caption-uppercase-leading);
  letter-spacing: var(--type-caption-uppercase-letter-spacing);
  text-transform: uppercase;
  color: var(--color-muted);
}

.structure-mode-toggle__switch {
  display: inline-flex;
  align-items: center;
  width: var(--switch-track-width);
  height: var(--switch-track-height);
  padding: var(--switch-track-padding);
  background: var(--color-surface-strong);
  border: var(--hairline-width) solid var(--color-hairline);
  border-radius: var(--radius-pill);
  cursor: pointer;
}

.structure-mode-toggle__switch[aria-checked="true"] {
  background: var(--color-ink);
  border-color: var(--color-ink);
}

.structure-mode-toggle__switch:disabled {
  cursor: default;
  opacity: var(--opacity-disabled);
}

.structure-mode-toggle__switch:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 var(--focus-ring-width) var(--color-ink);
}

.structure-mode-toggle__knob {
  width: var(--switch-knob-size);
  height: var(--switch-knob-size);
  background: var(--color-surface-card);
  border-radius: var(--radius-pill);
  transition: transform var(--motion-fast) ease;
}

.structure-mode-toggle__switch[aria-checked="true"] .structure-mode-toggle__knob {
  transform: translateX(var(--switch-knob-travel));
}

.structure-mode-toggle__status {
  font-family: var(--font-sans);
  font-size: var(--type-caption-size);
  font-weight: var(--type-caption-weight);
  line-height: var(--type-caption-leading);
  color: var(--color-muted);
}

.structure-mode-toggle__status[data-failed="true"] {
  color: var(--color-danger);
}
```

Any token above that does not already exist (`--switch-track-width`, `--switch-track-height`, `--switch-track-padding`, `--switch-knob-size`, `--switch-knob-travel`, `--opacity-disabled`, `--motion-fast`, `--radius-pill`, `--color-danger`) must be added by hand to `client/src/theme/components.css` alongside the existing component dims, since raw px/hex are only legal inside `src/theme/**`. Check which exist first:

```bash
cd client && grep -oE "\-\-(switch|opacity|motion|radius|color)-[a-z-]+" src/theme/components.css src/theme/tokens.css | sort -u
```

- [ ] **Step 5: Give the panel a real footer**

In `client/src/library/FolderPanel/FolderPanel.tsx`, add the import beside the other local imports:

```tsx
import StructureModeToggle from "@/library/StructureModeToggle";
```

and replace the version block (lines 294-298) with:

```tsx
      <div className="library-folder-panel__footer">
        <StructureModeToggle />
        {version && (
          <span className="library-folder-panel__version" data-testid="library-version">
            v{version}
          </span>
        )}
      </div>
```

- [ ] **Step 6: Move the pinning onto the footer**

In `client/src/library/FolderPanel/FolderPanel.css`, replace the `.library-folder-panel__version` rule (lines 280-289) with:

```css
/* The panel's pinned footer: the structure-mode toggle above the version
   badge, held at the bottom by the column flex layout. */
.library-folder-panel__footer {
  margin-top: auto;
  padding-top: var(--space-xs);
  border-top: var(--hairline-width) solid var(--color-hairline);
  display: flex;
  flex-direction: column;
  gap: var(--space-xxs);
}

.library-folder-panel__version {
  font-family: var(--font-sans);
  font-size: var(--type-caption-size);
  font-weight: var(--type-caption-weight);
  line-height: var(--type-caption-leading);
  color: var(--color-muted);
}
```

Also update the file's header comment: the version badge is no longer what `margin-top: auto` is on.

- [ ] **Step 7: Stop the Library tests hitting the network**

In `client/src/library/LibraryPage.test.tsx`, wherever `fetchHealth` is stubbed (line 23 and line 826), add alongside it:

```ts
  vi.spyOn(api, "fetchStructureMode").mockResolvedValue({
    mode: "local",
    transition: "idle",
    error: null,
  });
```

- [ ] **Step 8: Run the client suite**

Run: `cd client && npm test`
Expected: PASS, including `no-raw-values.test.ts`. A failure there means a raw px/hex slipped into `StructureModeToggle.css`; move the value into `src/theme/components.css` as a token.

- [ ] **Step 9: Typecheck**

Run: `cd client && npm run typecheck`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add client/src/library/StructureModeToggle.tsx client/src/library/StructureModeToggle.css client/src/library/StructureModeToggle.test.tsx client/src/library/FolderPanel/FolderPanel.tsx client/src/library/FolderPanel/FolderPanel.css client/src/library/LibraryPage.test.tsx client/src/theme/components.css
git commit -m "Feat: Add the structure-mode toggle to the folder panel footer"
```

---

### Task 8: Verify end to end, document, and bump the version

**Files:**
- Modify: `server/pyproject.toml:3`, `.env.example`, `CLAUDE.md` (the structure-mode note, if it claims restart-only)

**Interfaces:**
- Consumes: everything above.
- Produces: a verified running feature and `0.6.3`.

- [ ] **Step 1: Run both suites clean**

Run:

```bash
cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q
cd ../client && npm test && npm run typecheck
```

Expected: both green. Record the counts; do not proceed past a failure.

- [ ] **Step 2: Smoke the local path on your own dev servers**

Never reuse a server the user already has running (CLAUDE.md): it predates these edits. Start your own on free ports:

```bash
cd server && PYTHONPATH= uv run uvicorn app.main:app --port 8010 &
cd client && PAPER_MATE_API_TARGET=http://localhost:8010 npm run dev -- --port 5183
```

Open the Library page. Verify: the footer shows `Structure` + a switch reading `Local`; the version badge still sits below it; the folder list still scrolls above the footer.

- [ ] **Step 3: Verify the local flip round-trips**

With the same servers up:

```bash
curl -s localhost:8010/api/settings/structure-mode
curl -s -X PUT localhost:8010/api/settings/structure-mode -H 'Content-Type: application/json' -d '{"mode":"hybrid"}'
curl -s localhost:8010/api/settings/structure-mode
```

On a host with no hybrid server binary, expect the third call to report `mode: "local"` with a non-null `error`, and the UI to show `Hybrid failed`. That is the correct failure path. Confirm `settings.json` was NOT written with `hybrid` (only a successful start persists):

```bash
cat "${PAPER_MATE_DATA:-$HOME/.paper-mate}/settings.json" 2>/dev/null
```

Shut both servers down when done.

- [ ] **Step 4: Smoke the hybrid path in-container**

The hybrid server and its baked models only exist in the image. Use an isolated compose project, a throwaway data dir, and a spare port so the user's own container is untouched:

```bash
export PAPER_MATE_DATA=/tmp/pm-toggle-smoke && mkdir -p "$PAPER_MATE_DATA"
PAPER_MATE_PORT=8899 docker compose -p pmtoggle up --build -d
```

Then, against `localhost:8899`: flip to hybrid from the UI, watch the status go `Starting hybrid...` → `Hybrid`, confirm `GET /api/health` reports `structure_mode: "hybrid"`, import `fixtures/sample-pdfs/adtran.pdf` and confirm the ToC includes `3 METHODOLOGY` / `3.1` / `3.2`. Then flip back to local, confirm the status returns to `Local` and `localhost:5002` inside the container refuses connections again:

```bash
docker compose -p pmtoggle exec paper-mate curl -sf localhost:5002/health || echo "hybrid server stopped, as expected"
```

Restart the container and confirm the persisted choice survives:

```bash
docker compose -p pmtoggle restart
curl -s localhost:8899/api/health
```

Tear down: `docker compose -p pmtoggle down` and remove the throwaway data dir.

- [ ] **Step 5: Correct the docs that say restart-only**

In `.env.example`, under the `# --- Document structure ---` section, change the "hybrid needs a restart" wording to say that the env var is the INITIAL default and the Library toggle switches it at runtime, with the toggle's choice persisted in `settings.json` and winning on the next boot. No em-dash in the comment prose.

In `CLAUDE.md`, update the document-structure through-line sentence about the mode switch the same way, if it states restart-only.

- [ ] **Step 6: Bump the version**

In `server/pyproject.toml`, change line 3 to:

```toml
version = "0.6.3"
```

PATCH +1 for one completed unit of work, per the versioning rule. Confirm it flows through:

```bash
cd server && PYTHONPATH= uv run python -c "from app.version import get_version; print(get_version())"
```

Expected: `0.6.3`.

- [ ] **Step 7: Commit**

```bash
git add server/pyproject.toml .env.example CLAUDE.md
git commit -m "Docs: Record the runtime structure-mode toggle and bump to 0.6.3"
```

- [ ] **Step 8: Record the sprint entry**

This work is Epic 10 follow-on and has no story number yet; `10-4` is taken by `10-4-figures-tables-index`. Allocate a new key in `.bmad/implementation-artifacts/sprint-status.yaml` (e.g. `10-10-structure-mode-runtime-toggle`) with the appropriate status, and update `last_updated`. Do not renumber existing entries.

---

## Notes for the implementer

- **The lock is re-entrant on purpose.** `_switch_to_local` persists while holding it and `current_state` takes it again; a plain `Lock` would deadlock.
- **Never hold the lock across a spawn or a stop.** `start_hybrid_server` blocks for up to 120 seconds. Every place that calls it releases the lock first and re-takes it to record the result. A `GET` served during a flip must not block.
- **`begin_transition` deliberately does not change `mode`.** The mode only becomes `hybrid` once the server is actually ready, so `/api/health` never advertises a mode extraction cannot deliver. Flipping to local is the reverse: the mode changes immediately (the next extraction should be local) and only the process shutdown is deferred.
- **Only a successful flip persists.** A failed hybrid start leaves `settings.json` alone, so a restart does not retry a broken configuration on the user's behalf.
