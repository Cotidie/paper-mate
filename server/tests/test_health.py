from fastapi.testclient import TestClient

from app import structure_mode
from app.main import app
from app.version import get_version

client = TestClient(app)


def test_health_returns_ok_with_version() -> None:
    resp = client.get("/api/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["version"] == get_version()


def test_health_version_is_nonempty() -> None:
    resp = client.get("/api/health")
    assert resp.json()["version"]


def test_health_reports_structure_mode_default_local() -> None:
    assert structure_mode.current_state().mode == "local"  # default with no env set
    resp = client.get("/api/health")
    assert resp.json()["structure_mode"] == "local"


def test_health_reports_the_runtime_structure_mode(monkeypatch) -> None:
    # Health reads the SAME runtime owner extraction does, so a flip at runtime
    # is visible immediately -- no restart, and no second source to disagree.
    monkeypatch.setattr(structure_mode, "start_hybrid_server", lambda mode, url: object())
    structure_mode.begin_transition("hybrid")
    structure_mode.run_transition()

    resp = client.get("/api/health")
    assert resp.json()["structure_mode"] == "hybrid"


def test_unknown_api_route_uses_detail_envelope() -> None:
    resp = client.get("/api/does-not-exist")
    assert resp.status_code == 404
    assert "detail" in resp.json()
