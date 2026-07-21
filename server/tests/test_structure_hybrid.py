"""Bundled hybrid-server lifecycle tests (Story 10.3).

The real ``opendataloader-pdf-hybrid`` subprocess is NEVER spawned here (heavy:
Docling + torch). ``subprocess.Popen`` + the readiness poll are mocked, so this
covers only the launch/skip/stop DECISIONS.
"""

import subprocess
from unittest.mock import MagicMock

import app.structure_hybrid as sh
from app.domain import structure as structure_mod


def _no_spawn(*a, **k):
    raise AssertionError("subprocess should not be spawned in local mode")


def _set_mode(monkeypatch, mode: str, url: str = "http://localhost:5002") -> None:
    """Move the process-wide RESOLVED mode/URL (they are read once at import, so
    setting the env here would be a no-op) -- this is the same source
    ``/api/health`` and the default extractor read."""
    monkeypatch.setattr(structure_mod, "_ACTIVE_MODE", mode)
    monkeypatch.setattr(structure_mod, "_HYBRID_URL", url)


def test_start_returns_none_in_local_mode(monkeypatch):
    _set_mode(monkeypatch, "local")
    # Must not even attempt to spawn.
    monkeypatch.setattr(sh.subprocess, "Popen", _no_spawn)
    assert sh.start_hybrid_server() is None


def test_start_returns_none_for_remote_url(monkeypatch):
    _set_mode(monkeypatch, "hybrid", "http://remote-host:5002")
    spawned = []
    monkeypatch.setattr(sh.subprocess, "Popen", lambda *a, **k: spawned.append(1))
    # A remote hybrid URL means an external server the operator runs -> we skip.
    assert sh.start_hybrid_server() is None
    assert spawned == []


def test_start_launches_local_server_with_device_and_no_ocr(monkeypatch):
    _set_mode(monkeypatch, "hybrid")
    monkeypatch.setenv("PAPER_MATE_STRUCTURE_HYBRID_DEVICE", "cpu")
    fake_proc = MagicMock()
    calls = {}

    def fake_popen(cmd, **kw):
        calls["cmd"] = cmd
        return fake_proc

    monkeypatch.setattr(sh.subprocess, "Popen", fake_popen)
    monkeypatch.setattr(sh, "_wait_ready", lambda url, proc: True)

    proc = sh.start_hybrid_server()
    assert proc is fake_proc
    cmd = calls["cmd"]
    assert cmd[0].endswith("opendataloader-pdf-hybrid")  # venv path or bare name
    assert "--port" in cmd and "5002" in cmd
    assert cmd[cmd.index("--device") + 1] == "cpu"  # GPU-optional device passthrough
    assert "--no-ocr" in cmd  # born-digital default


def test_start_defaults_device_auto(monkeypatch):
    _set_mode(monkeypatch, "hybrid")
    monkeypatch.delenv("PAPER_MATE_STRUCTURE_HYBRID_DEVICE", raising=False)
    calls = {}
    monkeypatch.setattr(sh.subprocess, "Popen", lambda cmd, **k: calls.setdefault("cmd", cmd) or MagicMock())
    monkeypatch.setattr(sh, "_wait_ready", lambda url, proc: True)
    sh.start_hybrid_server()
    cmd = calls["cmd"]
    assert cmd[cmd.index("--device") + 1] == "auto"  # GPU-if-present, else CPU


def test_start_returns_proc_even_when_not_ready(monkeypatch):
    # Best-effort: not ready within the timeout still returns the proc (logged),
    # never raises (extraction then falls back to empty, AC #3).
    _set_mode(monkeypatch, "hybrid")
    fake_proc = MagicMock()
    monkeypatch.setattr(sh.subprocess, "Popen", lambda cmd, **k: fake_proc)
    monkeypatch.setattr(sh, "_wait_ready", lambda url, proc: False)
    assert sh.start_hybrid_server() is fake_proc


def test_start_returns_none_on_spawn_failure(monkeypatch):
    _set_mode(monkeypatch, "hybrid")

    def boom(cmd, **kw):
        raise FileNotFoundError("opendataloader-pdf-hybrid not installed")

    monkeypatch.setattr(sh.subprocess, "Popen", boom)
    # A spawn failure logs and returns None; boot is never bricked.
    assert sh.start_hybrid_server() is None


def test_wait_ready_true_on_200(monkeypatch):
    fake_proc = MagicMock()
    fake_proc.poll.return_value = None  # alive

    class _Resp:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    monkeypatch.setattr(sh.urllib.request, "urlopen", lambda *a, **k: _Resp())
    assert sh._wait_ready("http://localhost:5002", fake_proc) is True


def test_wait_ready_false_if_process_dies(monkeypatch):
    fake_proc = MagicMock()
    fake_proc.poll.return_value = 1  # exited before ready
    assert sh._wait_ready("http://localhost:5002", fake_proc) is False


def test_stop_terminates(monkeypatch):
    fake_proc = MagicMock()
    sh.stop_hybrid_server(fake_proc)
    fake_proc.terminate.assert_called_once()


def test_stop_none_is_noop():
    sh.stop_hybrid_server(None)  # no crash, no call


def test_stop_kills_on_timeout():
    fake_proc = MagicMock()
    fake_proc.wait.side_effect = subprocess.TimeoutExpired(cmd="x", timeout=10)
    sh.stop_hybrid_server(fake_proc)
    fake_proc.kill.assert_called_once()
