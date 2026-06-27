"""``POST /api/docs`` route tests (AR-9, AR-11).

The route is thin: it delegates to the storage module and translates a bad
PDF into the single ``{ "detail": string }`` error envelope. Storage is
isolated to a temp data root via the ``data_root`` fixture.
"""

from fastapi.testclient import TestClient

from app.main import app
from tests.conftest import make_pdf_bytes, sha256_hex

client = TestClient(app)


def test_upload_returns_doc(data_root):
    raw = make_pdf_bytes(pages=4, title="Uploaded")
    resp = client.post(
        "/api/docs",
        files={"file": ("uploaded.pdf", raw, "application/pdf")},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["doc_id"] == sha256_hex(raw)
    assert body["filename"] == "uploaded.pdf"
    assert body["page_count"] == 4
    assert body["title"] == "Uploaded"
    assert body["schema_version"] == 1
    # Persisted under the isolated data root.
    assert (data_root / "library" / body["doc_id"] / "source.pdf").is_file()


def test_upload_non_pdf_returns_400_detail_envelope(data_root):
    resp = client.post(
        "/api/docs",
        files={"file": ("bad.pdf", b"not a pdf at all", "application/pdf")},
    )
    assert resp.status_code == 400
    assert "detail" in resp.json()
    assert not (data_root / "library").exists()


def test_missing_file_field_returns_422_string_detail(data_root):
    """Validation errors use the single { detail: string } envelope (AR-11)."""
    resp = client.post("/api/docs")
    assert resp.status_code == 422
    assert isinstance(resp.json()["detail"], str)


def test_corrupt_existing_meta_returns_500_detail(data_root):
    """A storage failure beyond a bad PDF still answers with { detail }, not a bare 500."""
    raw = make_pdf_bytes(pages=1)
    first = client.post("/api/docs", files={"file": ("x.pdf", raw, "application/pdf")})
    doc_id = first.json()["doc_id"]
    (data_root / "library" / doc_id / "meta.json").write_text("{ corrupt")

    resp = client.post("/api/docs", files={"file": ("x.pdf", raw, "application/pdf")})
    assert resp.status_code == 500
    assert isinstance(resp.json()["detail"], str)
