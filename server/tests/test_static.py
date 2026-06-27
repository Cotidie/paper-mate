"""Static-serving + SPA-fallback behavior, incl. path-traversal containment."""

import importlib

import pytest
from fastapi.testclient import TestClient

SECRET = "TOPSECRET-do-not-serve"


@pytest.fixture
def client(tmp_path, monkeypatch):
    dist = tmp_path / "static"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><div id=\"root\"></div>")
    # A file OUTSIDE the dist that must never be reachable via the fallback.
    (tmp_path / "secret.txt").write_text(SECRET)

    monkeypatch.setenv("PAPER_MATE_STATIC_DIR", str(dist))
    import app.main as m

    importlib.reload(m)
    yield TestClient(m.app)
    # Restore the default module state for other test modules.
    monkeypatch.delenv("PAPER_MATE_STATIC_DIR", raising=False)
    importlib.reload(m)


def test_spa_fallback_serves_index_for_client_route(client) -> None:
    resp = client.get("/library")
    assert resp.status_code == 200
    assert 'id="root"' in resp.text


def test_api_surface_not_shadowed_by_fallback(client) -> None:
    assert client.get("/api/health").json() == {"status": "ok"}


def test_non_api_lookalike_is_not_blocked(client) -> None:
    # /apiary is a client route, not the API surface — must fall through to SPA.
    resp = client.get("/apiary")
    assert resp.status_code == 200
    assert 'id="root"' in resp.text


@pytest.mark.parametrize(
    "path",
    [
        "/../secret.txt",
        "/..%2f..%2fsecret.txt",
        "/%2e%2e/secret.txt",
        "/assets/../../secret.txt",
    ],
)
def test_path_traversal_never_serves_outside_dist(client, path) -> None:
    resp = client.get(path)
    assert SECRET not in resp.text
