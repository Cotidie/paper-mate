"""Storage module unit tests (AD-8, AD-9).

The storage module is the only code that touches the data root: it hashes,
validates, lays out ``library/{doc_id}/``, and writes atomically. These tests
pin that contract.
"""

import json

import pytest

from app import storage
from tests.conftest import make_pdf_bytes, sha256_hex


def test_import_writes_source_and_meta(data_root):
    raw = make_pdf_bytes(pages=3, title="A Paper")
    doc_id, meta = storage.import_pdf(raw, "a-paper.pdf")

    assert doc_id == sha256_hex(raw)
    doc_dir = data_root / "library" / doc_id
    assert (doc_dir / "source.pdf").read_bytes() == raw

    on_disk = json.loads((doc_dir / "meta.json").read_text())
    # Exactly the 6-field storage schema, no doc_id inside meta.json (AD-8).
    assert set(on_disk) == {
        "filename",
        "title",
        "page_count",
        "added",
        "last_opened",
        "schema_version",
    }
    assert on_disk["filename"] == "a-paper.pdf"
    assert on_disk["title"] == "A Paper"
    assert on_disk["page_count"] == 3
    assert on_disk["schema_version"] == 1
    assert meta.page_count == 3


def test_import_no_title_yields_null_title(data_root):
    raw = make_pdf_bytes(pages=1)
    _, meta = storage.import_pdf(raw, "untitled.pdf")
    assert meta.title is None


def test_reimport_is_idempotent(data_root):
    raw = make_pdf_bytes(pages=2, title="Orig")
    doc_id, first = storage.import_pdf(raw, "orig.pdf")
    doc_dir = data_root / "library" / doc_id

    # Seed an annotations.json the way Epic 3 would; re-import must not touch it.
    annotations = {"schema_version": 1, "annotations": [{"id": "keep-me"}]}
    (doc_dir / "annotations.json").write_text(json.dumps(annotations))
    original_meta = json.loads((doc_dir / "meta.json").read_text())

    _, second = storage.import_pdf(raw, "renamed-but-same-bytes.pdf")
    after_meta = json.loads((doc_dir / "meta.json").read_text())

    # annotations.json untouched.
    assert json.loads((doc_dir / "annotations.json").read_text()) == annotations
    # Identity-bearing meta fields preserved (original filename/title/added/page_count).
    assert after_meta["filename"] == original_meta["filename"]
    assert after_meta["title"] == original_meta["title"]
    assert after_meta["page_count"] == original_meta["page_count"]
    assert after_meta["added"] == original_meta["added"]
    # Only last_opened advances (>=, since clock resolution may collide).
    assert after_meta["last_opened"] >= original_meta["last_opened"]
    assert second.added == first.added


def test_invalid_bytes_raise_and_write_nothing(data_root):
    with pytest.raises(storage.InvalidPDFError):
        storage.import_pdf(b"this is not a pdf", "bad.pdf")
    assert not (data_root / "library").exists()


def test_empty_bytes_raise(data_root):
    with pytest.raises(storage.InvalidPDFError):
        storage.import_pdf(b"", "empty.pdf")


def test_reimport_with_corrupt_meta_raises_storage_error(data_root):
    raw = make_pdf_bytes(pages=1)
    doc_id, _ = storage.import_pdf(raw, "x.pdf")
    (data_root / "library" / doc_id / "meta.json").write_text("{ not json")
    with pytest.raises(storage.StorageError):
        storage.import_pdf(raw, "x.pdf")


def test_reimport_with_unknown_schema_raises(data_root):
    raw = make_pdf_bytes(pages=1)
    doc_id, _ = storage.import_pdf(raw, "x.pdf")
    meta = data_root / "library" / doc_id / "meta.json"
    meta.write_text(meta.read_text().replace('"schema_version": 1', '"schema_version": 99'))
    with pytest.raises(storage.UnsupportedSchemaError):
        storage.import_pdf(raw, "x.pdf")


def test_atomic_write_leaves_no_temp_files(data_root):
    raw = make_pdf_bytes(pages=1)
    doc_id, _ = storage.import_pdf(raw, "clean.pdf")
    doc_dir = data_root / "library" / doc_id
    leftovers = [p.name for p in doc_dir.iterdir() if ".tmp" in p.name or p.name.endswith("~")]
    assert leftovers == []
