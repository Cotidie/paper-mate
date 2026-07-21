"""The runtime structure-mode service: boot resolution, transitions, drain.

The real hybrid server is never spawned; ``start_hybrid_server`` /
``stop_hybrid_server`` are patched on the ``app.structure_mode`` module so these
tests cover only the state machine.
"""

import threading

import pytest

from app import storage
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
    storage.write_structure_mode("local")
    assert sm.resolve_boot_mode() == "local"


def test_unknown_persisted_value_fails_safe_to_local(data_root, monkeypatch):
    monkeypatch.delenv("PAPER_MATE_STRUCTURE_MODE", raising=False)
    storage.write_structure_mode("hybrd")
    assert sm.resolve_boot_mode() == "local"


def test_unknown_env_value_fails_safe_to_local(data_root, monkeypatch):
    monkeypatch.setenv("PAPER_MATE_STRUCTURE_MODE", "turbo")
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
    assert storage.read_structure_mode() == "hybrid"


def test_failed_start_reverts_to_local_with_an_error(data_root, monkeypatch):
    monkeypatch.setattr(sm, "start_hybrid_server", lambda mode, url: None)
    sm.begin_transition("hybrid")
    sm.run_transition()

    state = sm.current_state()
    assert state.mode == "local"
    assert state.transition == "idle"
    assert state.error is not None


def test_failed_start_does_not_persist_hybrid(data_root, monkeypatch):
    monkeypatch.setattr(sm, "start_hybrid_server", lambda mode, url: None)
    sm.begin_transition("hybrid")
    sm.run_transition()
    # A restart must not retry a configuration that just failed.
    assert storage.read_structure_mode() is None


def test_flip_back_to_local_stops_the_server(data_root, fake_hybrid):
    sm.begin_transition("hybrid")
    sm.run_transition()

    sm.begin_transition("local")
    sm.run_transition()

    state = sm.current_state()
    assert (state.mode, state.transition) == ("local", "idle")
    assert fake_hybrid["stopped"] == [fake_hybrid["proc"]]
    assert storage.read_structure_mode() == "local"


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
        assert sm.current_state().mode == "local"  # the NEXT extraction is local

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
