"""``GET /api/library`` route tests (AR-9, AR-11, Story 6.2).

The route is thin: it delegates to ``storage.read_library()`` and translates
a storage failure into the single ``{ "detail": string }`` error envelope.
Storage is isolated to a temp data root via the ``data_root`` fixture.
"""

from fastapi.testclient import TestClient

from app import storage
from app.main import app
from tests.conftest import make_pdf_bytes

client = TestClient(app)


def test_get_library_empty_collection(data_root):
    resp = client.get("/api/library")
    assert resp.status_code == 200
    assert resp.json() == {"papers": [], "folders": []}


def test_get_library_returns_row_after_import(data_root):
    """Persistence-proof shape (AC-6): an imported doc appears in one read."""
    raw = make_pdf_bytes(pages=2, title="Uploaded")
    up = client.post("/api/docs", files={"file": ("u.pdf", raw, "application/pdf")})
    doc_id = up.json()["doc_id"]

    resp = client.get("/api/library")
    assert resp.status_code == 200
    body = resp.json()
    assert body["folders"] == []
    assert len(body["papers"]) == 1
    row = body["papers"][0]
    assert row["doc_id"] == doc_id
    assert row["title"] == "Uploaded"
    assert row["file_type"] == "pdf"
    # The TestClient runs the background extraction synchronously after the POST
    # (enrich stubbed to "skipped" by conftest), so by the time we read the
    # library the row has settled — its embedded title kept, enrich skipped.
    assert row["status"] == "enrich-skipped"
    assert row["folder_id"] is None
    assert row["trashed"] is False
    assert row["order"] == 0


def test_get_library_storage_failure_returns_500_detail(data_root, monkeypatch):
    monkeypatch.setattr(storage, "read_library", lambda: (_ for _ in ()).throw(storage.CorruptLibraryError("x")))
    resp = client.get("/api/library")
    assert resp.status_code == 500
    assert isinstance(resp.json()["detail"], str)


def test_app_startup_runs_reconcile(data_root):
    """AC-4/AC-6: prove the lifespan wiring itself invokes reconcile_library()
    at startup, not just that the function works in isolation (the module-level
    `client = TestClient(app)` used above never enters the lifespan context, so
    it cannot exercise this path — must use TestClient as a context manager)."""
    raw = make_pdf_bytes(pages=1, title="Pre-existing")
    doc_id, _ = storage.import_pdf(raw, "pre.pdf")
    (data_root / "library.json").unlink()  # simulate a pre-6.2 on-disk doc

    with TestClient(app) as boot_client:
        resp = boot_client.get("/api/library")

    assert resp.status_code == 200
    assert [p["doc_id"] for p in resp.json()["papers"]] == [doc_id]
