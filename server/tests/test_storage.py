"""Storage module unit tests (AD-8, AD-9).

The storage module is the only code that touches the data root: it hashes,
validates, lays out ``library/{doc_id}/``, and writes atomically. These tests
pin that contract.
"""

import json
import shutil
import threading
import uuid

import pytest

from app import storage
from app.models import Annotation, DocMeta
from app.storage import library_index, meta_store
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
    # Exactly the 13-field storage schema (Story 6.2 adds authors/file_type/
    # status; Story 7.9 adds doi/venue/year; Story 7.11 adds authors_list), no
    # doc_id inside meta.json (AD-8).
    assert set(on_disk) == {
        "filename",
        "title",
        "page_count",
        "added",
        "last_opened",
        "authors",
        "authors_list",
        "file_type",
        "status",
        "doi",
        "venue",
        "year",
        "schema_version",
    }
    assert on_disk["filename"] == "a-paper.pdf"
    assert on_disk["title"] == "A Paper"
    assert on_disk["page_count"] == 3
    assert on_disk["schema_version"] == 1
    assert on_disk["authors"] is None
    assert on_disk["authors_list"] == []
    assert on_disk["file_type"] == "pdf"
    # A fresh import lands at "extracting"; the route's background job settles
    # it (Story 6.5). Inline import no longer runs extraction.
    assert on_disk["status"] == "extracting"
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


def test_reimport_of_trashed_paper_restores_it(data_root):
    raw = make_pdf_bytes(pages=1, title="Orig")
    doc_id, _ = storage.import_pdf(raw, "orig.pdf")
    folder = storage.create_folder("Papers", None)
    storage.move_papers([doc_id], folder.id)
    storage.trash_papers([doc_id])

    storage.import_pdf(raw, "orig.pdf")

    paper = next(p for p in storage.read_library().papers if p.doc_id == doc_id)
    assert paper.trashed is False
    assert paper.folder_id == folder.id


def test_apply_extraction_does_not_restore_trashed_paper(data_root):
    doc_id, _ = storage.import_pdf(make_pdf_bytes(pages=1), "a.pdf")
    storage.trash_papers([doc_id])

    storage.apply_extraction(doc_id, title="T", authors_list=["A"], status="ready", doi=None, venue=None, year=None)

    paper = next(p for p in storage.read_library().papers if p.doc_id == doc_id)
    assert paper.trashed is True


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
    assert row.starred is False
    assert row.order == 0
    # Cache matches meta (AC-2).
    assert row.title == meta.title == "Indexed"
    assert row.authors == meta.authors
    assert row.added == meta.added
    assert row.file_type == meta.file_type == "pdf"
    # Fresh import is "extracting" until the background job settles it (6.5).
    assert row.status == meta.status == "extracting"
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
    assert library.papers[0].starred is False


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


def test_reconcile_backfills_last_opened_for_pre_existing_entry(data_root):
    """Story 7.7, AC-4: mirrors the `filename` backfill precedent - a
    library.json entry cached before `last_opened` existed on CollectionRow
    must gain it on the next reconcile, without a re-import."""
    raw = make_pdf_bytes(pages=1)
    doc_id, _ = storage.import_pdf(raw, "backfill-me.pdf")

    library_path = data_root / "library.json"
    payload = json.loads(library_path.read_text())
    del payload["papers"][0]["last_opened"]
    library_path.write_text(json.dumps(payload))

    storage.reconcile_library()

    library = storage.read_library()
    meta = storage.read_meta(doc_id)
    assert library.papers[0].last_opened == meta.last_opened


def test_reconcile_projects_doi_venue_year_from_meta(data_root):
    """Story 7.9, AC-4: `_cache_from_meta` projects doi/venue/year (meta-derived
    cache, mirrors `filename`/`last_opened`) - a DocMeta carrying them is
    reflected in the library.json entry on the next reconcile."""
    raw = make_pdf_bytes(pages=1, title="Has DOI")
    doc_id, meta = storage.import_pdf(raw, "has-doi.pdf")

    doc_dir = data_root / "library" / doc_id
    updated = meta.model_copy(
        update={"doi": "10.1234/abcd", "venue": "Journal of Foo", "year": 2017}
    )
    meta_store.write(doc_dir, updated)

    storage.reconcile_library()

    row = storage.read_library().papers[0]
    assert row.doi == "10.1234/abcd"
    assert row.venue == "Journal of Foo"
    assert row.year == 2017


def test_reconcile_projects_authors_list_from_meta(data_root):
    """Story 7.11, AC-2: `_cache_from_meta` projects `authors_list` (peer of
    `doi`/`venue`/`year`) - reflected in the library.json entry on reconcile."""
    raw = make_pdf_bytes(pages=1, title="Has Authors")
    doc_id, meta = storage.import_pdf(raw, "has-authors.pdf")

    doc_dir = data_root / "library" / doc_id
    updated = DocMeta.model_validate({**meta.model_dump(), "authors_list": ["Ada Lovelace", "Alan Turing"]})
    meta_store.write(doc_dir, updated)

    storage.reconcile_library()

    row = storage.read_library().papers[0]
    assert row.authors_list == ["Ada Lovelace", "Alan Turing"]
    assert row.authors == "Ada Lovelace, Alan Turing"


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


# --- apply_extraction (Story 6.5, the sole extraction-result writer) --------


def test_apply_extraction_persists_meta_and_refreshes_cache(data_root):
    raw = make_pdf_bytes(pages=1, title="Rough")
    doc_id, _ = storage.import_pdf(raw, "rough.pdf")

    storage.apply_extraction(
        doc_id,
        title="Corrected Title",
        authors_list=["Ada Lovelace", "Alan Turing"],
        status="ready",
        doi="10.1234/abcd",
        venue="Journal of Foo",
        year=2017,
    )

    # meta.json updated.
    meta = storage.read_meta(doc_id)
    assert meta.title == "Corrected Title"
    assert meta.authors == "Ada Lovelace, Alan Turing"
    assert meta.status == "ready"
    assert meta.doi == "10.1234/abcd"
    assert meta.venue == "Journal of Foo"
    assert meta.year == 2017
    # Display cache refreshed through the AD-L7 index path.
    row = storage.read_library().papers[0]
    assert row.title == "Corrected Title"
    assert row.authors == "Ada Lovelace, Alan Turing"
    assert row.status == "ready"
    assert row.doi == "10.1234/abcd"
    assert row.venue == "Journal of Foo"
    assert row.year == 2017


def test_apply_extraction_parse_failed_keeps_null_title(data_root):
    raw = make_pdf_bytes(pages=1)
    doc_id, _ = storage.import_pdf(raw, "poor.pdf")

    storage.apply_extraction(doc_id, title=None, authors_list=[], status="parse-failed", doi=None, venue=None, year=None)

    meta = storage.read_meta(doc_id)
    assert meta.title is None
    assert meta.status == "parse-failed"
    # filename (the client's fallback) is preserved — the row is never lost.
    assert meta.filename == "poor.pdf"


def test_apply_extraction_preserves_identity_fields(data_root):
    raw = make_pdf_bytes(pages=3, title="Orig")
    doc_id, before = storage.import_pdf(raw, "orig.pdf")

    storage.apply_extraction(doc_id, title="New", authors_list=[], status="enrich-skipped", doi=None, venue=None, year=None)

    meta = storage.read_meta(doc_id)
    # Only title/authors/status change; page_count/added/filename are untouched.
    assert meta.page_count == before.page_count == 3
    assert meta.added == before.added
    assert meta.filename == "orig.pdf"


def test_apply_extraction_is_idempotent(data_root):
    raw = make_pdf_bytes(pages=1, title="X")
    doc_id, _ = storage.import_pdf(raw, "x.pdf")

    storage.apply_extraction(doc_id, title="Once", authors_list=[], status="ready", doi=None, venue=None, year=None)
    storage.apply_extraction(doc_id, title="Once", authors_list=[], status="ready", doi=None, venue=None, year=None)

    library = storage.read_library()
    assert len(library.papers) == 1  # no duplicate entry
    assert library.papers[0].title == "Once"


def test_apply_extraction_missing_doc_raises_not_found(data_root):
    with pytest.raises(storage.DocumentNotFoundError):
        storage.apply_extraction("0" * 64, title="T", authors_list=[], status="ready", doi=None, venue=None, year=None)


def test_apply_extraction_purged_mid_flight_raises_not_found(data_root):
    raw = make_pdf_bytes(pages=1, title="Purge")
    doc_id, _ = storage.import_pdf(raw, "purge.pdf")
    shutil.rmtree(data_root / "library" / doc_id)  # purged while extracting

    with pytest.raises(storage.DocumentNotFoundError):
        storage.apply_extraction(doc_id, title="T", authors_list=[], status="ready", doi=None, venue=None, year=None)


def test_apply_extraction_does_not_resurrect_dir_purged_after_read(data_root, monkeypatch):
    """Codex review (Med): a purge racing AFTER apply_extraction reads meta but
    BEFORE it writes must NOT recreate the dir (create_parents=False) and leave
    a meta-only ghost row in library.json."""
    raw = make_pdf_bytes(pages=1, title="Racy")
    doc_id, meta = storage.import_pdf(raw, "racy.pdf")
    doc_dir = data_root / "library" / doc_id

    real_read_meta = meta_store.read

    def read_then_purge(path):
        result = real_read_meta(path)
        # Simulate the doc being purged right after the read, before the write.
        if result is not None and path == doc_dir:
            shutil.rmtree(doc_dir)
        return result

    monkeypatch.setattr(meta_store, "read", read_then_purge)

    with pytest.raises(storage.DocumentNotFoundError):
        storage.apply_extraction(doc_id, title="Ghost", authors_list=[], status="ready", doi=None, venue=None, year=None)

    # The dir was NOT recreated (no meta-only ghost written back) and the index
    # was NOT refreshed with the ghost values — apply_extraction wrote nothing.
    # (The stale index row is the ORIGINAL import entry; boot reconcile prunes
    # it. What matters: it never took the "Ghost"/"ready" update.)
    assert not doc_dir.exists()
    monkeypatch.setattr(meta_store, "read", real_read_meta)
    rows = storage.read_library().papers
    assert all(r.title != "Ghost" and r.status != "ready" for r in rows)


# --- update_doc_meta (Story 6.6, shares apply_extraction's core) -----------


def test_update_doc_meta_refreshes_library_cache(data_root):
    raw = make_pdf_bytes(pages=1, title="Rough")
    doc_id, _ = storage.import_pdf(raw, "rough.pdf")

    updated = storage.update_doc_meta(doc_id, {"title": "Fixed Title"})

    assert updated.title == "Fixed Title"
    meta = storage.read_meta(doc_id)
    assert meta.title == "Fixed Title"
    row = storage.read_library().papers[0]
    assert row.title == "Fixed Title"


def test_update_doc_meta_partial_leaves_authors_untouched(data_root):
    raw = make_pdf_bytes(pages=1, title="X")
    doc_id, _ = storage.import_pdf(raw, "x.pdf")
    storage.apply_extraction(
        doc_id, title="X", authors_list=["Original Author"], status="ready", doi=None, venue=None, year=None
    )

    storage.update_doc_meta(doc_id, {"title": "New Title"})

    meta = storage.read_meta(doc_id)
    assert meta.title == "New Title"
    assert meta.authors == "Original Author"


def test_update_doc_meta_authors_list_update_rederives_authors(data_root):
    """Story 7.11 (the model_copy write-path trap): an `authors_list` update
    through `update_meta_and_reindex` must re-derive `authors` (the write
    path re-validates rather than `model_copy`, which does not run
    validators) — both on-disk and in the refreshed `library.json` cache."""
    raw = make_pdf_bytes(pages=1, title="X")
    doc_id, _ = storage.import_pdf(raw, "x.pdf")
    storage.apply_extraction(
        doc_id, title="X", authors_list=["Original Author"], status="ready", doi=None, venue=None, year=None
    )

    updated = storage.update_doc_meta(doc_id, {"authors_list": ["Ada Lovelace", "Alan Turing"]})

    assert updated.authors_list == ["Ada Lovelace", "Alan Turing"]
    assert updated.authors == "Ada Lovelace, Alan Turing"
    meta = storage.read_meta(doc_id)
    assert meta.authors == "Ada Lovelace, Alan Turing"
    row = storage.read_library().papers[0]
    assert row.authors_list == ["Ada Lovelace", "Alan Turing"]
    assert row.authors == "Ada Lovelace, Alan Turing"


def test_update_doc_meta_authors_list_clear_does_not_resurrect(data_root):
    """Story 7.11 (decision 1): clearing `authors_list` to `[]` must derive
    `authors=None`, never resurrect the prior joined string."""
    raw = make_pdf_bytes(pages=1, title="X")
    doc_id, _ = storage.import_pdf(raw, "x.pdf")
    storage.apply_extraction(
        doc_id, title="X", authors_list=["Original Author"], status="ready", doi=None, venue=None, year=None
    )

    updated = storage.update_doc_meta(doc_id, {"authors_list": []})

    assert updated.authors_list == []
    assert updated.authors is None
    meta = storage.read_meta(doc_id)
    assert meta.authors is None


def test_update_doc_meta_missing_doc_raises_not_found(data_root):
    with pytest.raises(storage.DocumentNotFoundError):
        storage.update_doc_meta("0" * 64, {"title": "T"})


def test_update_doc_meta_purged_dir_raises_not_found_no_ghost_row(data_root, monkeypatch):
    """Mirrors test_apply_extraction_does_not_resurrect_dir_purged_after_read:
    a purge racing between the read and the write must not recreate the dir
    or leave a ghost cache entry."""
    raw = make_pdf_bytes(pages=1, title="Racy")
    doc_id, _ = storage.import_pdf(raw, "racy.pdf")
    doc_dir = data_root / "library" / doc_id

    real_read_meta = meta_store.read

    def read_then_purge(path):
        result = real_read_meta(path)
        if result is not None and path == doc_dir:
            shutil.rmtree(doc_dir)
        return result

    monkeypatch.setattr(meta_store, "read", read_then_purge)

    with pytest.raises(storage.DocumentNotFoundError):
        storage.update_doc_meta(doc_id, {"title": "Ghost"})

    assert not doc_dir.exists()
    monkeypatch.setattr(meta_store, "read", real_read_meta)
    rows = storage.read_library().papers
    assert all(r.title != "Ghost" for r in rows)


# --- touch_last_opened (Story 6.7, shares apply_extraction's core) --------


def test_touch_last_opened_advances_field_only(data_root):
    raw = make_pdf_bytes(pages=4, title="Original")
    doc_id, before = storage.import_pdf(raw, "orig.pdf")
    storage.apply_extraction(
        doc_id, title="Original", authors_list=["Ada Lovelace"], status="ready", doi=None, venue=None, year=None
    )
    settled = storage.read_meta(doc_id)

    updated = storage.touch_last_opened(doc_id)

    assert updated.last_opened >= settled.last_opened
    assert updated.title == settled.title
    assert updated.authors == settled.authors
    assert updated.status == settled.status
    assert updated.page_count == settled.page_count == before.page_count
    assert updated.added == settled.added
    assert updated.filename == settled.filename
    meta = storage.read_meta(doc_id)
    assert meta.last_opened == updated.last_opened


def test_touch_last_opened_refreshes_library_cache_unchanged(data_root):
    """AC-7: touch only advances last_opened, so title/authors/status stay
    byte-identical on the displayed row."""
    raw = make_pdf_bytes(pages=1, title="Cached")
    doc_id, _ = storage.import_pdf(raw, "cached.pdf")
    before_row = storage.read_library().papers[0]

    storage.touch_last_opened(doc_id)

    after_row = storage.read_library().papers[0]
    assert after_row.title == before_row.title
    assert after_row.authors == before_row.authors
    assert after_row.status == before_row.status


def test_touch_last_opened_advances_cached_last_opened(data_root):
    """Story 7.7, AC-3: opening a paper floats it in the Recent lens because
    the cached `last_opened` (projected through `_cache_from_meta`) advances,
    not just the meta.json field."""
    raw = make_pdf_bytes(pages=1, title="Cached")
    doc_id, _ = storage.import_pdf(raw, "cached.pdf")
    before_row = storage.read_library().papers[0]

    updated_meta = storage.touch_last_opened(doc_id)

    after_row = storage.read_library().papers[0]
    assert after_row.last_opened == updated_meta.last_opened
    assert after_row.last_opened >= before_row.last_opened


def test_touch_last_opened_missing_doc_raises_not_found(data_root):
    with pytest.raises(storage.DocumentNotFoundError):
        storage.touch_last_opened("0" * 64)


def test_touch_last_opened_purged_dir_raises_not_found_no_ghost_row(data_root, monkeypatch):
    """Mirrors test_apply_extraction_does_not_resurrect_dir_purged_after_read:
    a purge racing between the read and the write must not recreate the dir
    or leave a ghost cache entry."""
    raw = make_pdf_bytes(pages=1, title="Racy")
    doc_id, _ = storage.import_pdf(raw, "racy.pdf")
    doc_dir = data_root / "library" / doc_id

    real_read_meta = meta_store.read

    def read_then_purge(path):
        result = real_read_meta(path)
        if result is not None and path == doc_dir:
            shutil.rmtree(doc_dir)
        return result

    monkeypatch.setattr(meta_store, "read", read_then_purge)

    with pytest.raises(storage.DocumentNotFoundError):
        storage.touch_last_opened(doc_id)

    # The dir was NOT recreated (create_parents=False) — no meta-only ghost
    # written back for a doc purged mid-write.
    assert not doc_dir.exists()


def test_read_library_unknown_schema_version_raises_corrupt(data_root):
    raw = make_pdf_bytes(pages=1)
    storage.import_pdf(raw, "v.pdf")
    library_path = data_root / "library.json"
    payload = json.loads(library_path.read_text())
    payload["schema_version"] = 99
    library_path.write_text(json.dumps(payload))

    with pytest.raises(storage.CorruptLibraryError):
        storage.read_library()


def test_read_library_malformed_folder_entry_raises_corrupt(data_root):
    """A hand-corrupted folder entry (missing `id`/`parent_id`) must surface
    as CorruptLibraryError, never a raw KeyError escaping the StorageError
    taxonomy (Codex review; the same class of leak already guarded for
    paper entries above)."""
    storage.create_folder("Fine", None)
    library_path = data_root / "library.json"
    payload = json.loads(library_path.read_text())
    payload["folders"].append({})
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


# --- Folder CRUD (Story 7.1, AL-5/AL-7) -------------------------------------


def test_create_folder_appends_with_uuid_name_and_parent(data_root):
    folder = storage.create_folder("Papers", None)
    assert folder.parent_id is None
    assert folder.name == "Papers"
    uuid.UUID(folder.id)  # a real UUIDv4-shaped id, raises if not

    library = storage.read_library()
    assert [f.id for f in library.folders] == [folder.id]


def test_create_folder_under_parent_nests(data_root):
    parent = storage.create_folder("Parent", None)
    child = storage.create_folder("Child", parent.id)
    assert child.parent_id == parent.id


def test_create_folder_under_missing_parent_raises(data_root):
    with pytest.raises(storage.FolderNotFoundError):
        storage.create_folder("Orphan", "does-not-exist")


def test_create_folder_blank_name_raises_at_storage_boundary(data_root):
    """A direct storage caller (not just the route's Pydantic model) must
    never be able to persist a blank/whitespace folder name (Codex review)."""
    with pytest.raises(storage.StorageError):
        storage.create_folder("   ", None)
    assert storage.read_library().folders == []


def test_rename_folder_changes_only_name(data_root):
    folder = storage.create_folder("Original", None)
    doc_id, _ = storage.import_pdf(make_pdf_bytes(pages=1), "p.pdf")
    library_index.mutate_index(lambda index: _set_folder(index, doc_id, folder.id))

    renamed = storage.rename_folder(folder.id, "Renamed")
    assert renamed.id == folder.id
    assert renamed.name == "Renamed"
    assert renamed.parent_id is None

    library = storage.read_library()
    paper = next(p for p in library.papers if p.doc_id == doc_id)
    assert paper.folder_id == folder.id  # membership untouched by the rename


def test_rename_missing_folder_raises(data_root):
    with pytest.raises(storage.FolderNotFoundError):
        storage.rename_folder("does-not-exist", "New Name")


def test_rename_folder_blank_name_raises_at_storage_boundary(data_root):
    folder = storage.create_folder("Original", None)
    with pytest.raises(storage.StorageError):
        storage.rename_folder(folder.id, "   ")
    assert storage.read_library().folders[0].name == "Original"


def _set_folder(index: dict, doc_id: str, folder_id: str | None) -> dict:
    for paper in index["papers"]:
        if paper["doc_id"] == doc_id:
            paper["folder_id"] = folder_id
    return index


def test_delete_folder_removes_subtree_and_rehomes_all_papers(data_root):
    """A nested subtree with papers at multiple depths: delete the root and
    every folder in the subtree is gone, every paper anywhere in it re-homes
    to Uncategorized, and NO paper is deleted (AL-5, ratifies PRD A1)."""
    root = storage.create_folder("Root", None)
    child = storage.create_folder("Child", root.id)
    grandchild = storage.create_folder("Grandchild", child.id)
    sibling = storage.create_folder("Sibling", None)  # outside the subtree

    doc_root, _ = storage.import_pdf(make_pdf_bytes(pages=1, title="At root"), "a.pdf")
    doc_child, _ = storage.import_pdf(make_pdf_bytes(pages=1, title="At child"), "b.pdf")
    doc_grandchild, _ = storage.import_pdf(make_pdf_bytes(pages=1, title="At grandchild"), "c.pdf")
    doc_sibling, _ = storage.import_pdf(make_pdf_bytes(pages=1, title="At sibling"), "d.pdf")
    library_index.mutate_index(
        lambda index: _set_folder(_set_folder(_set_folder(_set_folder(
            index, doc_root, root.id), doc_child, child.id), doc_grandchild, grandchild.id),
            doc_sibling, sibling.id)
    )

    library = storage.delete_folder(root.id)

    remaining_ids = {f.id for f in library.folders}
    assert remaining_ids == {sibling.id}
    assert {p.doc_id for p in library.papers} == {doc_root, doc_child, doc_grandchild, doc_sibling}
    by_id = {p.doc_id: p for p in library.papers}
    assert by_id[doc_root].folder_id is None
    assert by_id[doc_child].folder_id is None
    assert by_id[doc_grandchild].folder_id is None
    assert by_id[doc_sibling].folder_id == sibling.id  # untouched, outside the subtree


def test_delete_missing_folder_raises(data_root):
    with pytest.raises(storage.FolderNotFoundError):
        storage.delete_folder("does-not-exist")


def test_folders_survive_read_library_round_trip(data_root):
    folder = storage.create_folder("Persisted", None)
    library = storage.read_library()
    assert [f.model_dump() for f in library.folders] == [folder.model_dump()]


def test_reconcile_library_leaves_folders_intact(data_root):
    folder = storage.create_folder("Untouched", None)
    raw = make_pdf_bytes(pages=1)
    storage.import_pdf(raw, "r.pdf")

    storage.reconcile_library()

    library = storage.read_library()
    assert [f.model_dump() for f in library.folders] == [folder.model_dump()]


def test_concurrent_create_and_delete_serialize_without_lost_folder(data_root):
    """AL-7: a folder create racing a delete of an unrelated folder must not
    lose either mutation (the lock serializes the whole read-modify-write)."""
    survivor = storage.create_folder("Will be deleted", None)

    created_ids: list[str] = []
    created_lock = threading.Lock()

    def create_one(name: str) -> None:
        folder = storage.create_folder(name, None)
        with created_lock:
            created_ids.append(folder.id)

    threads = [threading.Thread(target=create_one, args=(f"Folder {i}",)) for i in range(8)]
    threads.append(threading.Thread(target=storage.delete_folder, args=(survivor.id,)))
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    library = storage.read_library()
    assert survivor.id not in {f.id for f in library.folders}
    assert set(created_ids) == {f.id for f in library.folders}
    assert len(created_ids) == 8


def test_move_papers_sets_folder_id_for_one_id(data_root):
    folder = storage.create_folder("Papers", None)
    doc_id, _ = storage.import_pdf(make_pdf_bytes(pages=1), "a.pdf")

    library = storage.move_papers([doc_id], folder.id)

    paper = next(p for p in library.papers if p.doc_id == doc_id)
    assert paper.folder_id == folder.id


def test_move_papers_sets_folder_id_for_many_ids(data_root):
    folder = storage.create_folder("Papers", None)
    doc_a, _ = storage.import_pdf(make_pdf_bytes(pages=1, title="A"), "a.pdf")
    doc_b, _ = storage.import_pdf(make_pdf_bytes(pages=1, title="B"), "b.pdf")

    library = storage.move_papers([doc_a, doc_b], folder.id)

    by_id = {p.doc_id: p for p in library.papers}
    assert by_id[doc_a].folder_id == folder.id
    assert by_id[doc_b].folder_id == folder.id


def test_move_papers_to_none_clears_membership(data_root):
    folder = storage.create_folder("Papers", None)
    doc_id, _ = storage.import_pdf(make_pdf_bytes(pages=1), "a.pdf")
    storage.move_papers([doc_id], folder.id)

    library = storage.move_papers([doc_id], None)

    paper = next(p for p in library.papers if p.doc_id == doc_id)
    assert paper.folder_id is None


def test_move_papers_replaces_prior_folder(data_root):
    first = storage.create_folder("First", None)
    second = storage.create_folder("Second", None)
    doc_id, _ = storage.import_pdf(make_pdf_bytes(pages=1), "a.pdf")
    storage.move_papers([doc_id], first.id)

    library = storage.move_papers([doc_id], second.id)

    paper = next(p for p in library.papers if p.doc_id == doc_id)
    assert paper.folder_id == second.id


def test_move_papers_bad_folder_id_raises_and_writes_nothing(data_root):
    doc_id, _ = storage.import_pdf(make_pdf_bytes(pages=1), "a.pdf")

    with pytest.raises(storage.FolderNotFoundError):
        storage.move_papers([doc_id], "does-not-exist")

    paper = next(p for p in storage.read_library().papers if p.doc_id == doc_id)
    assert paper.folder_id is None


def test_move_papers_unknown_doc_id_raises_all_or_nothing(data_root):
    """One valid id plus one unknown id in the SAME set must abort with no
    partial write: the valid id must NOT move either (AL-6, all-or-nothing)."""
    folder = storage.create_folder("Papers", None)
    doc_id, _ = storage.import_pdf(make_pdf_bytes(pages=1), "a.pdf")

    with pytest.raises(storage.DocumentNotFoundError):
        storage.move_papers([doc_id, "does-not-exist"], folder.id)

    paper = next(p for p in storage.read_library().papers if p.doc_id == doc_id)
    assert paper.folder_id is None


def test_move_papers_never_touches_trashed_order_or_other_papers(data_root):
    folder = storage.create_folder("Papers", None)
    doc_a, _ = storage.import_pdf(make_pdf_bytes(pages=1, title="A"), "a.pdf")
    doc_b, _ = storage.import_pdf(make_pdf_bytes(pages=1, title="B"), "b.pdf")
    library_index.mutate_index(lambda index: _set_trashed(index, doc_a, True))
    before = {p.doc_id: (p.trashed, p.order) for p in storage.read_library().papers}

    library = storage.move_papers([doc_a], folder.id)

    after = {p.doc_id: (p.trashed, p.order) for p in library.papers}
    assert after == before
    by_id = {p.doc_id: p for p in library.papers}
    assert by_id[doc_a].folder_id == folder.id
    assert by_id[doc_b].folder_id is None  # untouched, not in doc_ids


def _set_trashed(index: dict, doc_id: str, trashed: bool) -> dict:
    for paper in index["papers"]:
        if paper["doc_id"] == doc_id:
            paper["trashed"] = trashed
    return index


def test_move_papers_membership_survives_read_library_round_trip(data_root):
    folder = storage.create_folder("Papers", None)
    doc_id, _ = storage.import_pdf(make_pdf_bytes(pages=1), "a.pdf")
    storage.move_papers([doc_id], folder.id)

    library = storage.read_library()

    paper = next(p for p in library.papers if p.doc_id == doc_id)
    assert paper.folder_id == folder.id


def test_move_papers_into_same_folder_is_idempotent(data_root):
    folder = storage.create_folder("Papers", None)
    doc_id, _ = storage.import_pdf(make_pdf_bytes(pages=1), "a.pdf")
    storage.move_papers([doc_id], folder.id)

    library = storage.move_papers([doc_id], folder.id)

    paper = next(p for p in library.papers if p.doc_id == doc_id)
    assert paper.folder_id == folder.id


def test_trash_papers_flips_trashed_leaves_folder_and_order(data_root):
    folder = storage.create_folder("Papers", None)
    doc_id, _ = storage.import_pdf(make_pdf_bytes(pages=1), "a.pdf")
    storage.move_papers([doc_id], folder.id)
    before = next(p for p in storage.read_library().papers if p.doc_id == doc_id)

    library = storage.trash_papers([doc_id])

    paper = next(p for p in library.papers if p.doc_id == doc_id)
    assert paper.trashed is True
    assert paper.folder_id == folder.id
    assert paper.order == before.order


def test_trash_papers_unknown_doc_id_raises_all_or_nothing(data_root):
    doc_id, _ = storage.import_pdf(make_pdf_bytes(pages=1), "a.pdf")

    with pytest.raises(storage.DocumentNotFoundError):
        storage.trash_papers([doc_id, "does-not-exist"])

    paper = next(p for p in storage.read_library().papers if p.doc_id == doc_id)
    assert paper.trashed is False


def test_restore_papers_clears_trashed_keeps_folder_id(data_root):
    folder = storage.create_folder("Papers", None)
    doc_id, _ = storage.import_pdf(make_pdf_bytes(pages=1), "a.pdf")
    storage.move_papers([doc_id], folder.id)
    storage.trash_papers([doc_id])

    library = storage.restore_papers([doc_id])

    paper = next(p for p in library.papers if p.doc_id == doc_id)
    assert paper.trashed is False
    assert paper.folder_id == folder.id


def test_restore_papers_unknown_doc_id_raises(data_root):
    with pytest.raises(storage.DocumentNotFoundError):
        storage.restore_papers(["does-not-exist"])


def test_restore_after_folder_delete_lands_uncategorized(data_root):
    """Locks the AC-3 'else Uncategorized' invariant: a paper trashed while in
    folder F, whose folder F is then deleted, already has folder_id cleared
    to None (delete_folder re-homes trashed papers too) -- so restoring it
    finds it already in Uncategorized, not a dangling folder id."""
    folder = storage.create_folder("Papers", None)
    doc_id, _ = storage.import_pdf(make_pdf_bytes(pages=1), "a.pdf")
    storage.move_papers([doc_id], folder.id)
    storage.trash_papers([doc_id])
    storage.delete_folder(folder.id)
    trashed = next(p for p in storage.read_library().papers if p.doc_id == doc_id)
    assert trashed.folder_id is None

    library = storage.restore_papers([doc_id])

    paper = next(p for p in library.papers if p.doc_id == doc_id)
    assert paper.trashed is False
    assert paper.folder_id is None


def test_trash_does_not_touch_annotations(data_root):
    doc_id, _ = storage.import_pdf(make_pdf_bytes(pages=1), "a.pdf")
    ann = make_annotation(doc_id)
    storage.write_annotations(doc_id, [ann])

    storage.trash_papers([doc_id])

    annotations = storage.read_annotations(doc_id)
    assert annotations == [ann]


def test_purge_document_removes_dir_and_index_entry(data_root):
    doc_id, _ = storage.import_pdf(make_pdf_bytes(pages=1), "a.pdf")
    doc_dir = data_root / "library" / doc_id

    library = storage.purge_document(doc_id)

    assert not doc_dir.exists()
    assert all(p.doc_id != doc_id for p in library.papers)


def test_purge_document_unknown_doc_id_raises_not_found(data_root):
    with pytest.raises(storage.DocumentNotFoundError):
        storage.purge_document("does-not-exist")


def test_purge_then_reconcile_does_not_resurrect(data_root):
    """Locks the crash-safe ordering rationale: rmtree-then-prune means a dir
    removed by rmtree (simulating the purge's first step) is never re-added
    by reconcile, because prune already happened atomically alongside it in
    purge_document. This test isolates just the rmtree half to prove
    reconcile treats a vanished dir as prunable, not as a resurrection
    candidate."""
    doc_id, _ = storage.import_pdf(make_pdf_bytes(pages=1), "a.pdf")
    doc_dir = data_root / "library" / doc_id
    shutil.rmtree(doc_dir)

    storage.reconcile_library()

    assert all(p.doc_id != doc_id for p in storage.read_library().papers)
