"""``GET /api/library`` route tests (AR-9, AR-11, Story 6.2).

The route is thin: it delegates to ``storage.read_library()`` and translates
a storage failure into the single ``{ "detail": string }`` error envelope.
Storage is isolated to a temp data root via the ``data_root`` fixture.
"""

from fastapi.testclient import TestClient

from app import storage
from app.main import app
from app.storage import library_index
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


# --- Folder CRUD routes (Story 7.1, AL-6) -----------------------------------


def test_create_folder_returns_folder(data_root):
    resp = client.post("/api/library/folders", json={"name": "Papers", "parent_id": None})
    assert resp.status_code == 200
    body = resp.json()
    assert body["name"] == "Papers"
    assert body["parent_id"] is None
    assert isinstance(body["id"], str) and body["id"]


def test_create_folder_under_missing_parent_returns_404(data_root):
    resp = client.post("/api/library/folders", json={"name": "Orphan", "parent_id": "no-such-id"})
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Folder not found"


def test_create_folder_blank_name_returns_422(data_root):
    resp = client.post("/api/library/folders", json={"name": "   "})
    assert resp.status_code == 422


def test_rename_folder_returns_renamed_folder(data_root):
    created = client.post("/api/library/folders", json={"name": "Original"}).json()
    resp = client.patch(f"/api/library/folders/{created['id']}", json={"name": "Renamed"})
    assert resp.status_code == 200
    assert resp.json() == {**created, "name": "Renamed"}


def test_rename_missing_folder_returns_404(data_root):
    resp = client.patch("/api/library/folders/no-such-id", json={"name": "New Name"})
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Folder not found"


def test_rename_folder_blank_name_returns_422(data_root):
    created = client.post("/api/library/folders", json={"name": "Original"}).json()
    resp = client.patch(f"/api/library/folders/{created['id']}", json={"name": ""})
    assert resp.status_code == 422


def test_delete_folder_returns_rehomed_library(data_root):
    folder = client.post("/api/library/folders", json={"name": "Doomed"}).json()
    raw = make_pdf_bytes(pages=1, title="In Folder")
    up = client.post("/api/docs", files={"file": ("f.pdf", raw, "application/pdf")})
    doc_id = up.json()["doc_id"]
    library_index.mutate_index(lambda index: _assign_folder(index, doc_id, folder["id"]))

    resp = client.delete(f"/api/library/folders/{folder['id']}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["folders"] == []
    row = next(p for p in body["papers"] if p["doc_id"] == doc_id)
    assert row["folder_id"] is None


def _assign_folder(index: dict, doc_id: str, folder_id: str) -> dict:
    for paper in index["papers"]:
        if paper["doc_id"] == doc_id:
            paper["folder_id"] = folder_id
    return index


def test_delete_missing_folder_returns_404(data_root):
    resp = client.delete("/api/library/folders/no-such-id")
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Folder not found"


# --- Move route (Story 7.2, AD-L6) ------------------------------------------


def test_move_papers_returns_updated_library(data_root):
    folder = client.post("/api/library/folders", json={"name": "Papers"}).json()
    raw = make_pdf_bytes(pages=1, title="Movable")
    up = client.post("/api/docs", files={"file": ("m.pdf", raw, "application/pdf")})
    doc_id = up.json()["doc_id"]

    resp = client.post("/api/library/move", json={"doc_ids": [doc_id], "folder_id": folder["id"]})
    assert resp.status_code == 200
    row = next(p for p in resp.json()["papers"] if p["doc_id"] == doc_id)
    assert row["folder_id"] == folder["id"]


def test_move_papers_bad_folder_id_returns_404(data_root):
    raw = make_pdf_bytes(pages=1)
    up = client.post("/api/docs", files={"file": ("m.pdf", raw, "application/pdf")})
    doc_id = up.json()["doc_id"]

    resp = client.post("/api/library/move", json={"doc_ids": [doc_id], "folder_id": "no-such-id"})
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Folder not found"


def test_move_papers_unknown_doc_id_returns_404(data_root):
    resp = client.post("/api/library/move", json={"doc_ids": ["no-such-doc"]})
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Document not found"


def test_move_papers_empty_doc_ids_returns_422(data_root):
    resp = client.post("/api/library/move", json={"doc_ids": []})
    assert resp.status_code == 422


def test_move_papers_forbidden_extra_field_returns_422(data_root):
    resp = client.post("/api/library/move", json={"doc_ids": ["x"], "extra": "nope"})
    assert resp.status_code == 422
