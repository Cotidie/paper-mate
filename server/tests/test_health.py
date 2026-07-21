from fastapi.testclient import TestClient

from app.domain import structure as structure_mod
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
    # The mode is resolved once at import (restart-scoped switch), so the tests
    # move the RESOLVED value, not the env, which is also what proves health and
    # the extractor read the same source.
    assert structure_mod._ACTIVE_MODE == "local"  # default with no env set
    resp = client.get("/api/health")
    assert resp.json()["structure_mode"] == "local"


def test_health_reports_structure_mode_hybrid(monkeypatch) -> None:
    monkeypatch.setattr(structure_mod, "_ACTIVE_MODE", "hybrid")
    resp = client.get("/api/health")
    assert resp.json()["structure_mode"] == "hybrid"


def test_unknown_api_route_uses_detail_envelope() -> None:
    resp = client.get("/api/does-not-exist")
    assert resp.status_code == 404
    assert "detail" in resp.json()
