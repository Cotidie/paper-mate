from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_returns_ok() -> None:
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_unknown_api_route_uses_detail_envelope() -> None:
    resp = client.get("/api/does-not-exist")
    assert resp.status_code == 404
    assert "detail" in resp.json()
