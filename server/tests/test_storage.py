"""Storage module unit tests (AD-8, AD-9).

The storage module is the only code that touches the data root: it hashes,
validates, lays out ``library/{doc_id}/``, and writes atomically. These tests
pin that contract.
"""

import json

import pytest

from app import storage
from app.models import Annotation
from tests.conftest import make_pdf_bytes, sha256_hex


def make_annotation(doc_id: str, ann_id: str = "11111111-1111-1111-1111-111111111111") -> Annotation:
    return Annotation.model_validate(
        {
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
    )


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


def test_source_path_returns_stored_pdf(data_root):
    raw = make_pdf_bytes(pages=2)
    doc_id, _ = storage.import_pdf(raw, "s.pdf")
    path = storage.source_path(doc_id)
    assert path.read_bytes() == raw
    assert path == data_root / "library" / doc_id / "source.pdf"


def test_source_path_unknown_doc_raises_not_found(data_root):
    with pytest.raises(storage.DocumentNotFoundError):
        storage.source_path("0" * 64)


def test_source_path_without_meta_raises_not_found(data_root):
    raw = make_pdf_bytes(pages=1)
    doc_id, _ = storage.import_pdf(raw, "n.pdf")
    (data_root / "library" / doc_id / "meta.json").unlink()
    with pytest.raises(storage.DocumentNotFoundError):
        storage.source_path(doc_id)


def test_source_path_corrupt_meta_raises_storage_error(data_root):
    raw = make_pdf_bytes(pages=1)
    doc_id, _ = storage.import_pdf(raw, "n.pdf")
    (data_root / "library" / doc_id / "meta.json").write_text("{ corrupt")
    with pytest.raises(storage.StorageError):
        storage.source_path(doc_id)


def test_write_annotations_round_trips_envelope(data_root):
    raw = make_pdf_bytes(pages=1)
    doc_id, _ = storage.import_pdf(raw, "w.pdf")
    ann = make_annotation(doc_id)

    storage.write_annotations(doc_id, [ann])

    on_disk = json.loads((data_root / "library" / doc_id / "annotations.json").read_text())
    assert on_disk["schema_version"] == storage.ANNOTATIONS_SCHEMA_VERSION
    assert len(on_disk["annotations"]) == 1
    assert on_disk["annotations"][0]["id"] == ann.id
    assert on_disk["annotations"][0]["anchor"]["kind"] == "text"


def test_write_annotations_overwrites_full_set(data_root):
    raw = make_pdf_bytes(pages=1)
    doc_id, _ = storage.import_pdf(raw, "w2.pdf")
    storage.write_annotations(doc_id, [make_annotation(doc_id, "11111111-1111-1111-1111-111111111111")])

    # A second PUT with a different (smaller) set REPLACES, never merges (AC-3).
    storage.write_annotations(doc_id, [make_annotation(doc_id, "22222222-2222-2222-2222-222222222222")])

    on_disk = json.loads((data_root / "library" / doc_id / "annotations.json").read_text())
    ids = [a["id"] for a in on_disk["annotations"]]
    assert ids == ["22222222-2222-2222-2222-222222222222"]


def test_write_annotations_empty_list_round_trips(data_root):
    raw = make_pdf_bytes(pages=1)
    doc_id, _ = storage.import_pdf(raw, "empty.pdf")
    storage.write_annotations(doc_id, [])
    on_disk = json.loads((data_root / "library" / doc_id / "annotations.json").read_text())
    assert on_disk == {"schema_version": storage.ANNOTATIONS_SCHEMA_VERSION, "annotations": []}


def test_write_annotations_atomic_no_tmp_left(data_root):
    raw = make_pdf_bytes(pages=1)
    doc_id, _ = storage.import_pdf(raw, "clean2.pdf")
    storage.write_annotations(doc_id, [make_annotation(doc_id)])
    doc_dir = data_root / "library" / doc_id
    leftovers = [p.name for p in doc_dir.iterdir() if ".tmp" in p.name or p.name.endswith("~")]
    assert leftovers == []


def test_write_annotations_unknown_doc_raises_not_found(data_root):
    with pytest.raises(storage.DocumentNotFoundError):
        storage.write_annotations("0" * 64, [])


def test_write_annotations_without_meta_raises_not_found(data_root):
    raw = make_pdf_bytes(pages=1)
    doc_id, _ = storage.import_pdf(raw, "nometa.pdf")
    (data_root / "library" / doc_id / "meta.json").unlink()
    with pytest.raises(storage.DocumentNotFoundError):
        storage.write_annotations(doc_id, [])


def test_read_annotations_round_trips_written_set(data_root):
    """AC-5: read_annotations returns exactly what write_annotations persisted
    (same ids/anchors/styles/body/group_id), stripping the disk envelope (H9)."""
    raw = make_pdf_bytes(pages=1)
    doc_id, _ = storage.import_pdf(raw, "r.pdf")
    ann = make_annotation(doc_id)
    storage.write_annotations(doc_id, [ann])

    restored = storage.read_annotations(doc_id)
    assert len(restored) == 1
    assert restored[0] == ann
    assert restored[0].id == ann.id
    assert restored[0].anchor.kind == "text"


def test_read_annotations_no_file_returns_empty(data_root):
    """AC-1: an imported-but-never-annotated doc restores as [] (not a 404/error)."""
    raw = make_pdf_bytes(pages=1)
    doc_id, _ = storage.import_pdf(raw, "unann.pdf")
    assert storage.read_annotations(doc_id) == []


def test_read_annotations_unknown_doc_raises_not_found(data_root):
    with pytest.raises(storage.DocumentNotFoundError):
        storage.read_annotations("0" * 64)


def test_read_annotations_without_meta_raises_not_found(data_root):
    raw = make_pdf_bytes(pages=1)
    doc_id, _ = storage.import_pdf(raw, "nm.pdf")
    (data_root / "library" / doc_id / "meta.json").unlink()
    with pytest.raises(storage.DocumentNotFoundError):
        storage.read_annotations(doc_id)


def test_read_annotations_unknown_schema_version_raises(data_root):
    """AC-3: an unknown schema_version is rejected, never guessed."""
    raw = make_pdf_bytes(pages=1)
    doc_id, _ = storage.import_pdf(raw, "v.pdf")
    (data_root / "library" / doc_id / "annotations.json").write_text(
        json.dumps({"schema_version": 99, "annotations": []})
    )
    with pytest.raises(storage.UnsupportedSchemaError):
        storage.read_annotations(doc_id)


def test_read_annotations_malformed_json_raises_corrupt(data_root):
    """AC-3: unreadable JSON is rejected, not treated as empty."""
    raw = make_pdf_bytes(pages=1)
    doc_id, _ = storage.import_pdf(raw, "c.pdf")
    (data_root / "library" / doc_id / "annotations.json").write_text("{ not json")
    with pytest.raises(storage.CorruptAnnotationsError):
        storage.read_annotations(doc_id)


def test_read_annotations_wrong_shape_raises_corrupt(data_root):
    """AC-3: valid JSON of the wrong shape (annotations not a list, or a member
    missing required fields) is rejected as corrupt."""
    raw = make_pdf_bytes(pages=1)
    doc_id, _ = storage.import_pdf(raw, "s.pdf")
    ann_path = data_root / "library" / doc_id / "annotations.json"

    # 'annotations' is not a list.
    ann_path.write_text(json.dumps({"schema_version": 1, "annotations": {"id": "x"}}))
    with pytest.raises(storage.CorruptAnnotationsError):
        storage.read_annotations(doc_id)

    # A member is missing required fields.
    ann_path.write_text(json.dumps({"schema_version": 1, "annotations": [{"id": "x"}]}))
    with pytest.raises(storage.CorruptAnnotationsError):
        storage.read_annotations(doc_id)


def test_read_annotations_duplicate_id_raises_corrupt(data_root):
    """AC-5: a duplicate id would be collapsed by the client's id-keyed Map (silent
    loss) — reject it instead of guessing."""
    raw = make_pdf_bytes(pages=1)
    doc_id, _ = storage.import_pdf(raw, "dup.pdf")
    dup = make_annotation(doc_id).model_dump(mode="json")
    (data_root / "library" / doc_id / "annotations.json").write_text(
        json.dumps({"schema_version": 1, "annotations": [dup, dup]})
    )
    with pytest.raises(storage.CorruptAnnotationsError):
        storage.read_annotations(doc_id)


def test_read_annotations_foreign_doc_id_raises_corrupt(data_root):
    """AC-5: an entry whose doc_id belongs to another document would restore into
    the wrong reader — reject it as corrupt."""
    raw = make_pdf_bytes(pages=1)
    doc_id, _ = storage.import_pdf(raw, "foreign.pdf")
    foreign = make_annotation("some-other-doc-id").model_dump(mode="json")
    (data_root / "library" / doc_id / "annotations.json").write_text(
        json.dumps({"schema_version": 1, "annotations": [foreign]})
    )
    with pytest.raises(storage.CorruptAnnotationsError):
        storage.read_annotations(doc_id)
