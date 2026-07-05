"""Storage module unit tests (AD-8, AD-9).

The storage module is the only code that touches the data root: it hashes,
validates, lays out ``library/{doc_id}/``, and writes atomically. These tests
pin that contract.
"""

import json
import shutil
import threading

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
    # Exactly the 9-field storage schema (Story 6.2 adds authors/file_type/
    # status), no doc_id inside meta.json (AD-8).
    assert set(on_disk) == {
        "filename",
        "title",
        "page_count",
        "added",
        "last_opened",
        "authors",
        "file_type",
        "status",
        "schema_version",
    }
    assert on_disk["filename"] == "a-paper.pdf"
    assert on_disk["title"] == "A Paper"
    assert on_disk["page_count"] == 3
    assert on_disk["schema_version"] == 1
    assert on_disk["authors"] is None
    assert on_disk["file_type"] == "pdf"
    assert on_disk["status"] == "ready"
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


def test_read_meta_round_trips_imported_doc(data_root):
    raw = make_pdf_bytes(pages=5, title="Read Meta")
    doc_id, imported = storage.import_pdf(raw, "rm.pdf")
    meta = storage.read_meta(doc_id)
    assert meta == imported
    assert meta.page_count == 5
    assert meta.title == "Read Meta"


def test_read_meta_unknown_doc_raises_not_found(data_root):
    with pytest.raises(storage.DocumentNotFoundError):
        storage.read_meta("0" * 64)


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


# --- library.json: collection index (Story 6.2, AC 1/2/4/5/7) --------------


def test_read_library_on_fresh_root_returns_empty(data_root):
    library = storage.read_library()
    assert library.papers == []
    assert library.folders == []


def test_import_indexes_paper_as_uncategorized(data_root):
    raw = make_pdf_bytes(pages=2, title="Indexed")
    doc_id, meta = storage.import_pdf(raw, "indexed.pdf")

    library = storage.read_library()
    assert len(library.papers) == 1
    row = library.papers[0]
    assert row.doc_id == doc_id
    assert row.folder_id is None
    assert row.trashed is False
    assert row.order == 0
    # Cache matches meta (AC-2).
    assert row.title == meta.title == "Indexed"
    assert row.authors == meta.authors
    assert row.added == meta.added
    assert row.file_type == meta.file_type == "pdf"
    assert row.status == meta.status == "ready"
    assert row.filename == meta.filename == "indexed.pdf"


def test_reimport_refreshes_cache_without_duplicate_or_disturbing_order(data_root):
    raw1 = make_pdf_bytes(pages=1, title="First")
    doc_id1, _ = storage.import_pdf(raw1, "first.pdf")
    raw2 = make_pdf_bytes(pages=1, title="Second")
    doc_id2, _ = storage.import_pdf(raw2, "second.pdf")

    # Re-import the first doc's bytes; its meta title is stable (idempotent
    # import doesn't change title), but the entry must not duplicate or move.
    storage.import_pdf(raw1, "renamed-first.pdf")

    library = storage.read_library()
    assert [p.doc_id for p in library.papers] == [doc_id1, doc_id2]
    assert [p.order for p in library.papers] == [0, 1]


def test_reconcile_adds_dir_missing_from_index(data_root):
    raw = make_pdf_bytes(pages=1, title="Pre-existing")
    doc_id, _ = storage.import_pdf(raw, "pre.pdf")
    # Simulate a pre-6.2 import: strip its library.json entry.
    (data_root / "library.json").unlink()

    storage.reconcile_library()

    library = storage.read_library()
    assert len(library.papers) == 1
    assert library.papers[0].doc_id == doc_id
    assert library.papers[0].folder_id is None
    assert library.papers[0].trashed is False


def test_reconcile_backfills_filename_for_pre_existing_entry(data_root):
    """Fix: a library.json entry cached before `filename` existed on
    CollectionRow (e.g. one written by an earlier server version) must gain it
    on the next reconcile, without waiting for a re-import."""
    raw = make_pdf_bytes(pages=1)
    doc_id, _ = storage.import_pdf(raw, "backfill-me.pdf")

    library_path = data_root / "library.json"
    payload = json.loads(library_path.read_text())
    del payload["papers"][0]["filename"]
    library_path.write_text(json.dumps(payload))

    storage.reconcile_library()

    library = storage.read_library()
    assert library.papers[0].filename == "backfill-me.pdf"


def test_reconcile_prunes_entry_whose_dir_vanished(data_root):
    raw = make_pdf_bytes(pages=1)
    doc_id, _ = storage.import_pdf(raw, "gone.pdf")

    shutil.rmtree(data_root / "library" / doc_id)

    storage.reconcile_library()

    library = storage.read_library()
    assert library.papers == []


def test_reconcile_skips_dir_with_missing_or_corrupt_meta(data_root):
    raw = make_pdf_bytes(pages=1)
    doc_id, _ = storage.import_pdf(raw, "corrupt.pdf")
    (data_root / "library.json").unlink()
    (data_root / "library" / doc_id / "meta.json").write_text("{ not json")

    storage.reconcile_library()  # must not raise

    library = storage.read_library()
    assert library.papers == []


def test_reconcile_is_idempotent(data_root):
    raw = make_pdf_bytes(pages=1)
    storage.import_pdf(raw, "idem.pdf")

    storage.reconcile_library()
    first = storage.read_library()
    storage.reconcile_library()
    second = storage.read_library()

    assert [p.model_dump() for p in first.papers] == [p.model_dump() for p in second.papers]


def test_malformed_paper_row_raises_corrupt_not_keyerror(data_root):
    """Codex review: a hand-corrupted row missing doc_id/order must surface as
    CorruptLibraryError (AR-11 envelope, AC-4 never-crash-boot), not a raw
    KeyError from _upsert_paper_entry/_reconcile/_next_order's bracket access."""
    raw = make_pdf_bytes(pages=1)
    storage.import_pdf(raw, "v.pdf")
    library_path = data_root / "library.json"
    payload = json.loads(library_path.read_text())
    payload["papers"][0].pop("order")
    library_path.write_text(json.dumps(payload))

    with pytest.raises(storage.CorruptLibraryError):
        storage.read_library()

    raw2 = make_pdf_bytes(pages=1, title="Other")
    with pytest.raises(storage.CorruptLibraryError):
        storage.import_pdf(raw2, "other.pdf")

    with pytest.raises(storage.CorruptLibraryError):
        storage.reconcile_library()


def test_read_library_unknown_schema_version_raises_corrupt(data_root):
    raw = make_pdf_bytes(pages=1)
    storage.import_pdf(raw, "v.pdf")
    library_path = data_root / "library.json"
    payload = json.loads(library_path.read_text())
    payload["schema_version"] = 99
    library_path.write_text(json.dumps(payload))

    with pytest.raises(storage.CorruptLibraryError):
        storage.read_library()


def test_concurrent_imports_serialize_without_lost_updates(data_root):
    """AL-7: fire concurrent imports from threads; the lock must prevent a
    lost update to the index (every doc ends up indexed exactly once)."""
    raws = [make_pdf_bytes(pages=1, title=f"Doc {i}") for i in range(8)]
    expected_ids = {sha256_hex(r) for r in raws}

    threads = [threading.Thread(target=storage.import_pdf, args=(r, f"{i}.pdf")) for i, r in enumerate(raws)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    library = storage.read_library()
    assert {p.doc_id for p in library.papers} == expected_ids
    assert len(library.papers) == len(expected_ids)
    # Orders are unique (no lost/overwritten append).
    assert sorted(p.order for p in library.papers) == list(range(len(expected_ids)))
