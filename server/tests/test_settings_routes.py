"""`/api/settings/structure-mode` -- the runtime mode toggle's HTTP surface."""

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


def test_put_hybrid_settles_after_the_background_task(data_root, monkeypatch):
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


def test_put_reports_the_transition_before_it_settles(data_root, monkeypatch):
    _stub_server(monkeypatch)
    res = client.put("/api/settings/structure-mode", json={"mode": "hybrid"})
    # The response is the state at REQUEST time: the spawn has not happened yet,
    # so the client sees "starting" and polls.
    assert res.json() == {"mode": "local", "transition": "starting", "error": None}


def test_put_the_active_mode_is_a_noop(data_root):
    res = client.put("/api/settings/structure-mode", json={"mode": "local"})
    assert res.status_code == 200
    assert res.json()["transition"] == "idle"


def test_put_rejects_an_unknown_mode(data_root):
    res = client.put("/api/settings/structure-mode", json={"mode": "turbo"})
    assert res.status_code == 422
    assert isinstance(res.json()["detail"], str)


def test_put_conflicts_while_a_transition_is_in_flight(data_root):
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


def test_health_agrees_with_the_settings_resource(data_root, monkeypatch):
    _stub_server(monkeypatch)
    client.put("/api/settings/structure-mode", json={"mode": "hybrid"})
    assert client.get("/api/health").json()["structure_mode"] == "hybrid"
