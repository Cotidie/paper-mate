"""Bundled hybrid-server lifecycle tests (Story 10.3, runtime-toggle update).

The real ``opendataloader-pdf-hybrid`` subprocess is NEVER spawned here (heavy:
Docling + torch). ``subprocess.Popen`` + the readiness poll are mocked, so this
covers only the launch/skip/stop DECISIONS.

Mode + URL are ARGUMENTS now (``app.structure_mode`` owns them and is the only
caller), so these tests pass them directly instead of moving module globals.
"""

import subprocess
from unittest.mock import MagicMock

import app.structure_hybrid as sh

_URL = "http://localhost:5002"


def _no_spawn(*a, **k):
    raise AssertionError("subprocess should not be spawned in local mode")


def test_start_returns_none_in_local_mode(monkeypatch):
    # Must not even attempt to spawn.
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
    fake_proc = MagicMock()
    calls = {}

    def fake_popen(cmd, **kw):
        calls["cmd"] = cmd
        return fake_proc

    monkeypatch.setattr(sh.subprocess, "Popen", fake_popen)
    monkeypatch.setattr(sh, "_wait_ready", lambda url, proc: True)

    proc = sh.start_hybrid_server("hybrid", _URL)
    assert proc is fake_proc
    cmd = calls["cmd"]
    assert cmd[0].endswith("opendataloader-pdf-hybrid")  # venv path or bare name
    assert "--port" in cmd and "5002" in cmd
    assert cmd[cmd.index("--device") + 1] == "cpu"  # GPU-optional device passthrough
    assert "--no-ocr" in cmd  # born-digital default


def test_start_defaults_device_auto(monkeypatch):
    monkeypatch.delenv("PAPER_MATE_STRUCTURE_HYBRID_DEVICE", raising=False)
    calls = {}
    monkeypatch.setattr(sh.subprocess, "Popen", lambda cmd, **k: calls.setdefault("cmd", cmd) or MagicMock())
    monkeypatch.setattr(sh, "_wait_ready", lambda url, proc: True)
    sh.start_hybrid_server("hybrid", _URL)
    cmd = calls["cmd"]
    assert cmd[cmd.index("--device") + 1] == "auto"  # GPU-if-present, else CPU


def test_start_stops_the_process_and_returns_none_when_not_ready(monkeypatch):
    # A server that never becomes ready is an honest failure now: kill it and
    # say so, so a runtime flip can report it instead of holding a dead server.
    # Extraction still degrades to empty rather than raising (AC #3).
    fake_proc = MagicMock()
    monkeypatch.setattr(sh.subprocess, "Popen", lambda cmd, **k: fake_proc)
    monkeypatch.setattr(sh, "_wait_ready", lambda url, proc: False)
    assert sh.start_hybrid_server("hybrid", _URL) is None
    fake_proc.terminate.assert_called_once()


def test_start_returns_none_on_spawn_failure(monkeypatch):
    def boom(cmd, **kw):
        raise FileNotFoundError("opendataloader-pdf-hybrid not installed")

    monkeypatch.setattr(sh.subprocess, "Popen", boom)
    # A spawn failure logs and returns None; boot is never bricked.
    assert sh.start_hybrid_server("hybrid", _URL) is None


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
