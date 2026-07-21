from fastapi.testclient import TestClient

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


def test_health_reports_structure_mode_default_local(monkeypatch) -> None:
    monkeypatch.delenv("PAPER_MATE_STRUCTURE_MODE", raising=False)
    resp = client.get("/api/health")
    assert resp.json()["structure_mode"] == "local"


def test_health_reports_structure_mode_hybrid(monkeypatch) -> None:
    monkeypatch.setenv("PAPER_MATE_STRUCTURE_MODE", "hybrid")
    resp = client.get("/api/health")
    assert resp.json()["structure_mode"] == "hybrid"


def test_unknown_api_route_uses_detail_envelope() -> None:
    resp = client.get("/api/does-not-exist")
    assert resp.status_code == 404
    assert "detail" in resp.json()
