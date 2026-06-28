from fastapi.testclient import TestClient

from app.main import app
from app.version import get_version

client = TestClient(app)


def test_health_returns_ok_with_version() -> None:
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok", "version": get_version()}


def test_health_version_is_nonempty() -> None:
    resp = client.get("/api/health")
    assert resp.json()["version"]


def test_unknown_api_route_uses_detail_envelope() -> None:
    resp = client.get("/api/does-not-exist")
    assert resp.status_code == 404
    assert "detail" in resp.json()
