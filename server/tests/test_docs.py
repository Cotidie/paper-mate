"""``POST /api/docs`` route tests (AR-9, AR-11).

The route is thin: it delegates to the storage module and translates a bad
PDF into the single ``{ "detail": string }`` error envelope. Storage is
isolated to a temp data root via the ``data_root`` fixture.
"""

import json

from fastapi.testclient import TestClient

from app.main import app
from tests.conftest import make_pdf_bytes, sha256_hex

client = TestClient(app)


def annotation_payload(doc_id: str, ann_id: str = "11111111-1111-1111-1111-111111111111") -> dict:
    return {
        "id": ann_id,
        "doc_id": doc_id,
        "type": "highlight",
        "group_id": None,
        "anchor": {
            "kind": "text",
            "page_index": 0,
            "rects": [{"x0": 0, "y0": 0, "x1": 1, "y1": 1}],
            "text": "hi",
        },
        "style": {"color": "annotation-default"},
        "body": None,
        "created_at": "2026-07-01T00:00:00+00:00",
        "updated_at": "2026-07-01T00:00:00+00:00",
    }


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


def test_get_file_returns_pdf_bytes(data_root):
    """GET /api/docs/{doc_id}/file streams the exact stored bytes as application/pdf."""
    raw = make_pdf_bytes(pages=2, title="Readable")
    up = client.post("/api/docs", files={"file": ("r.pdf", raw, "application/pdf")})
    doc_id = up.json()["doc_id"]

    resp = client.get(f"/api/docs/{doc_id}/file")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"
    assert resp.content == raw


def test_get_file_unknown_doc_returns_404_detail(data_root):
    """An unknown doc_id → 404 with the single { detail } envelope, no FS leak in the route."""
    resp = client.get(f"/api/docs/{'0' * 64}/file")
    assert resp.status_code == 404
    assert isinstance(resp.json()["detail"], str)


def test_get_file_missing_meta_returns_404(data_root):
    """A stray source.pdf with no meta.json is not an imported document → 404."""
    raw = make_pdf_bytes(pages=1)
    doc_id = client.post(
        "/api/docs", files={"file": ("m.pdf", raw, "application/pdf")}
    ).json()["doc_id"]
    (data_root / "library" / doc_id / "meta.json").unlink()

    resp = client.get(f"/api/docs/{doc_id}/file")
    assert resp.status_code == 404
    assert isinstance(resp.json()["detail"], str)


def test_get_file_corrupt_meta_returns_500(data_root):
    """A corrupt on-disk record is a server fault, not a 404 — still { detail }."""
    raw = make_pdf_bytes(pages=1)
    doc_id = client.post(
        "/api/docs", files={"file": ("c.pdf", raw, "application/pdf")}
    ).json()["doc_id"]
    (data_root / "library" / doc_id / "meta.json").write_text("{ corrupt")

    resp = client.get(f"/api/docs/{doc_id}/file")
    assert resp.status_code == 500
    assert isinstance(resp.json()["detail"], str)


def test_put_annotations_returns_list_and_persists_envelope(data_root):
    """AC-2/3: PUT body is bare Annotation[]; disk gets the {schema_version} envelope."""
    raw = make_pdf_bytes(pages=1)
    doc_id = client.post("/api/docs", files={"file": ("p.pdf", raw, "application/pdf")}).json()[
        "doc_id"
    ]
    body = [annotation_payload(doc_id)]

    resp = client.put(f"/api/docs/{doc_id}/annotations", json=body)

    assert resp.status_code == 200
    assert resp.json()[0]["id"] == body[0]["id"]
    on_disk = json.loads((data_root / "library" / doc_id / "annotations.json").read_text())
    assert on_disk["schema_version"] == 1
    assert on_disk["annotations"][0]["id"] == body[0]["id"]


def test_put_annotations_overwrites_full_set(data_root):
    """AC-3: the backend has no merge logic, a PUT replaces whatever was there."""
    raw = make_pdf_bytes(pages=1)
    doc_id = client.post("/api/docs", files={"file": ("p2.pdf", raw, "application/pdf")}).json()[
        "doc_id"
    ]
    client.put(f"/api/docs/{doc_id}/annotations", json=[annotation_payload(doc_id, "a" * 8 + "-1111-1111-1111-111111111111")])
    resp = client.put(f"/api/docs/{doc_id}/annotations", json=[annotation_payload(doc_id, "b" * 8 + "-2222-2222-2222-222222222222")])

    assert resp.status_code == 200
    on_disk = json.loads((data_root / "library" / doc_id / "annotations.json").read_text())
    assert [a["id"] for a in on_disk["annotations"]] == ["b" * 8 + "-2222-2222-2222-222222222222"]


def test_put_annotations_unknown_doc_returns_404_detail(data_root):
    resp = client.put(f"/api/docs/{'0' * 64}/annotations", json=[])
    assert resp.status_code == 404
    assert isinstance(resp.json()["detail"], str)


def test_put_annotations_malformed_body_returns_422_string_detail(data_root):
    raw = make_pdf_bytes(pages=1)
    doc_id = client.post("/api/docs", files={"file": ("p3.pdf", raw, "application/pdf")}).json()[
        "doc_id"
    ]
    resp = client.put(f"/api/docs/{doc_id}/annotations", json=[{"id": "not-a-full-annotation"}])
    assert resp.status_code == 422
    assert isinstance(resp.json()["detail"], str)
