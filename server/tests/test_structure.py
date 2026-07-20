"""Document-structure layer tests (AD-13, AD-L8, Story 10.1).

Covers the pure mapping (``domain.structure._map_tree`` + the coordinate flip),
the adapter's totality, the per-doc ``structure_store`` round-trip + error
taxonomy, the ``GET .../structure`` route, and the ``run_extraction`` isolation
(a structure failure never poisons the metadata row). The JVM is NEVER spawned
here — the mapping is fed a captured raw fixture (``tests/fixtures/structure/``)
or a synthetic dict, and the adapter's ``_run`` is monkeypatched.
"""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import domain, storage
from app.domain import structure as structure_mod
from app.domain.structure import OpenDataLoaderExtractor, _map_tree, _to_rect, extract_structure
from app.main import app
from app.models import DocStructure, StructureElement
from tests.conftest import make_pdf_bytes, sha256_hex

client = TestClient(app)

FIXTURES = Path(__file__).parent / "fixtures" / "structure"


def _load(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text())


# --- coordinate flip (_to_rect) --------------------------------------------


def test_to_rect_flips_y_up_to_top_left():
    # A box near the TOP of an 792pt page (high PDF y) must map to a small y
    # (near 0) in top-left normalized space.
    rect = _to_rect((59.087, 670.175, 536.141, 688.839), 612.0, 792.0)
    assert rect.x0 == pytest.approx(59.087 / 612, abs=1e-4)
    assert rect.x1 == pytest.approx(536.141 / 612, abs=1e-4)
    assert rect.y0 == pytest.approx((792 - 688.839) / 792, abs=1e-4)
    assert rect.y1 == pytest.approx((792 - 670.175) / 792, abs=1e-4)
    # canonical: y0 (top edge) < y1 (bottom edge), and it sits in the top ~15%.
    assert rect.y0 < rect.y1 < 0.16


def test_to_rect_clamps_out_of_page_box():
    rect = _to_rect((-10.0, -10.0, 700.0, 900.0), 612.0, 792.0)
    assert rect.x0 == 0.0 and rect.y1 == 1.0
    assert 0.0 <= rect.x1 <= 1.0 and 0.0 <= rect.y0 <= 1.0


# --- tree mapping (_map_tree) ----------------------------------------------


def test_map_tree_synthetic_edgecases():
    raw = _load("odl_synthetic_edgecases.json")
    # 2 pages, both 612x792 (synthetic).
    dims = [(612.0, 792.0), (612.0, 792.0)]
    ds = _map_tree(raw, dims)
    by_type = {}
    for e in ds.elements:
        by_type.setdefault(e.type, []).append(e)

    # Type mapping: image -> figure, text block/formula/unknown -> other,
    # passthroughs kept. list items live under `list items` (not `kids`) so the
    # pure `kids` walk does NOT emit them as separate elements.
    types = [e.type for e in ds.elements]
    assert "figure" in types  # the image inside the text block
    assert "heading" in types and "paragraph" in types
    assert "table" in types and "caption" in types and "list" in types
    assert "list item" not in types  # not walked (only `kids` is)
    # text block + formula + unknown-future-type all fall to `other`.
    assert types.count("other") == 3

    # 0-based page conversion: page-2 elements have page_index == 1.
    table = by_type["table"][0]
    assert table.page_index == 1

    # heading carries its level; a paragraph does not.
    assert by_type["heading"][0].heading_level == 1
    assert by_type["paragraph"][0].heading_level is None


def test_map_tree_coerces_string_page_and_bbox():
    # The text block in the fixture has a STRING page number and a STRING bbox
    # ("[100.0, 400.0, 500.0, 550.0]") — the coercion must still place it.
    raw = _load("odl_synthetic_edgecases.json")
    ds = _map_tree(raw, [(612.0, 792.0), (612.0, 792.0)])
    tb = [e for e in ds.elements if e.id == "3"][0]  # the text block
    assert tb.type == "other"
    assert tb.page_index == 0
    assert 0.0 <= tb.rect.x0 < tb.rect.x1 <= 1.0


def test_map_tree_reading_order_preserved():
    raw = _load("odl_synthetic_edgecases.json")
    ds = _map_tree(raw, [(612.0, 792.0), (612.0, 792.0)])
    ids = [e.id for e in ds.elements]
    # Pre-order kids walk: heading(1) before paragraph(2) before the text
    # block(3) and its child image(4).
    assert ids.index("1") < ids.index("2") < ids.index("3") < ids.index("4")


def test_map_tree_real_multicolumn_fixture():
    raw = _load("odl_1903_multicol.json")
    # 10 pages, all 612x792 for this paper.
    dims = [(612.0, 792.0)] * raw["number of pages"]
    ds = _map_tree(raw, dims)
    assert len(ds.elements) > 50
    assert any(e.type == "heading" for e in ds.elements)
    assert any(e.type == "figure" for e in ds.elements)  # `image` -> figure
    # every rect is a normalized, canonical [0,1] box.
    for e in ds.elements:
        assert 0.0 <= e.rect.x0 <= e.rect.x1 <= 1.0
        assert 0.0 <= e.rect.y0 <= e.rect.y1 <= 1.0
        assert 0 <= e.page_index < 10


def test_map_tree_skips_element_on_unknown_page():
    raw = {"kids": [{"type": "paragraph", "id": 1, "page number": 9,
                     "bounding box": [0, 0, 10, 10], "content": "x"}]}
    ds = _map_tree(raw, [(612.0, 792.0)])  # only 1 page known
    assert ds.elements == []  # page_index 8 out of range -> skipped, no crash


# --- adapter totality -------------------------------------------------------


def test_extract_structure_total_on_garbage():
    # Garbage bytes: the adapter must return an empty DocStructure, never raise.
    assert extract_structure(b"not a pdf") == DocStructure()


def test_extract_structure_total_when_run_raises(monkeypatch):
    def boom(self, pdf_bytes):
        raise RuntimeError("JVM exploded")

    monkeypatch.setattr(OpenDataLoaderExtractor, "_run", boom)
    assert extract_structure(make_pdf_bytes()) == DocStructure()


def test_extract_structure_coerces_off_contract_adapter_result(monkeypatch):
    # A swapped adapter that returns a non-DocStructure (here None) without
    # raising must be coerced to an empty structure, never leaked downstream.
    class BadAdapter:
        def extract(self, pdf_bytes):
            return None

    monkeypatch.setattr(structure_mod, "_default_extractor", BadAdapter())
    assert extract_structure(make_pdf_bytes()) == DocStructure()


def test_adapter_maps_when_run_returns_tree(monkeypatch):
    # Feed the adapter a captured raw tree via _run (no JVM) + a real 1-page PDF
    # so _page_dims resolves; assert it produces mapped elements.
    raw = _load("odl_synthetic_edgecases.json")
    monkeypatch.setattr(OpenDataLoaderExtractor, "_run", lambda self, b: raw)
    # A 2-page PDF so page_index 1 (the table) resolves.
    ds = OpenDataLoaderExtractor().extract(make_pdf_bytes(pages=2))
    assert any(e.type == "table" for e in ds.elements)


# --- structure_store round-trip + errors ------------------------------------


def _import(raw: bytes) -> str:
    doc_id, _ = storage.import_pdf(raw, "s.pdf")
    return doc_id


def test_structure_store_round_trip(data_root):
    doc_id = _import(make_pdf_bytes())
    ds = DocStructure(elements=[
        StructureElement(id="1", type="heading", page_index=0,
                         rect={"x0": 0.1, "y0": 0.1, "x1": 0.9, "y1": 0.2},
                         text="Title", heading_level=1),
    ])
    storage.write_structure(doc_id, ds)
    assert storage.read_structure(doc_id) == ds


def test_structure_store_missing_returns_empty(data_root):
    doc_id = _import(make_pdf_bytes())
    # Imported but never analyzed: empty, NOT an error.
    assert storage.read_structure(doc_id) == DocStructure()


def test_structure_status_for_is_three_state():
    # Not analyzed, no structure.json -> absent (grey). The fix for the "dot
    # spins on pre-existing papers" bug: absence is NOT analyzing.
    assert storage.is_structure_analyzing("doc-x") is False
    assert storage.structure_status_for("doc-x", structure_exists=False) == "absent"
    # Analyzed (structure.json exists), not in flight -> ready (green).
    assert storage.structure_status_for("doc-x", structure_exists=True) == "ready"
    # In flight -> analyzing (amber), regardless of file existence (takes
    # precedence).
    storage.mark_structure_analyzing("doc-x")
    assert storage.structure_status_for("doc-x", structure_exists=False) == "analyzing"
    assert storage.structure_status_for("doc-x", structure_exists=True) == "analyzing"
    storage.clear_structure_analyzing("doc-x")
    assert storage.structure_status_for("doc-x", structure_exists=False) == "absent"


def test_structure_exists_reflects_the_file(data_root):
    doc_id = _import(make_pdf_bytes())
    assert storage.structure_exists(doc_id) is False
    storage.write_structure(doc_id, DocStructure())
    assert storage.structure_exists(doc_id) is True


def test_clear_structure_analyzing_is_a_noop_when_unmarked():
    # Never marked (e.g. a re-import that skipped extraction): clearing is safe.
    storage.clear_structure_analyzing("never-marked")
    assert storage.structure_status_for("never-marked", structure_exists=False) == "absent"


def test_structure_store_unknown_id_not_found(data_root):
    with pytest.raises(storage.DocumentNotFoundError):
        storage.read_structure("deadbeef")
    with pytest.raises(storage.DocumentNotFoundError):
        storage.write_structure("deadbeef", DocStructure())


def test_structure_store_rejects_unknown_version(data_root):
    doc_id = _import(make_pdf_bytes())
    path = data_root / "library" / doc_id / "structure.json"
    path.write_text(json.dumps({"schema_version": 999, "elements": []}))
    with pytest.raises(storage.UnsupportedSchemaError):
        storage.read_structure(doc_id)


def test_structure_store_rejects_corrupt(data_root):
    doc_id = _import(make_pdf_bytes())
    path = data_root / "library" / doc_id / "structure.json"
    path.write_text("{ not json")
    with pytest.raises(storage.CorruptStructureError):
        storage.read_structure(doc_id)


def test_structure_store_rejects_bad_shape(data_root):
    doc_id = _import(make_pdf_bytes())
    path = data_root / "library" / doc_id / "structure.json"
    path.write_text(json.dumps({"schema_version": 1, "elements": [{"nope": 1}]}))
    with pytest.raises(storage.CorruptStructureError):
        storage.read_structure(doc_id)


def test_structure_store_rejects_missing_elements_key(data_root):
    # A file with a valid schema_version but NO `elements` list is corrupt data,
    # not an empty structure (only an absent structure.json is empty-not-error).
    doc_id = _import(make_pdf_bytes())
    path = data_root / "library" / doc_id / "structure.json"
    path.write_text(json.dumps({"schema_version": 1}))
    with pytest.raises(storage.CorruptStructureError):
        storage.read_structure(doc_id)
    path.write_text(json.dumps({"schema_version": 1, "elements": "notalist"}))
    with pytest.raises(storage.CorruptStructureError):
        storage.read_structure(doc_id)


def test_structure_store_rejects_non_utf8(data_root):
    doc_id = _import(make_pdf_bytes())
    path = data_root / "library" / doc_id / "structure.json"
    path.write_bytes(b"\xff\xfe\x00bad bytes")
    with pytest.raises(storage.CorruptStructureError):
        storage.read_structure(doc_id)


def test_structure_store_write_does_not_recreate_purged_dir(data_root, monkeypatch):
    # create_parents=False: a purge landing BETWEEN the meta-read gate and the
    # write must make the write fail, not resurrect a structure-only doc dir
    # (which reconcile_library would re-add as an Uncategorized paper). Simulate
    # the race by letting the meta gate pass while the dir is already gone.
    import shutil

    from app.storage import meta_store, structure_store

    doc_id = _import(make_pdf_bytes())
    doc_dir = data_root / "library" / doc_id
    meta = meta_store.read(doc_dir)
    shutil.rmtree(doc_dir)  # the "purge" between gate and write
    monkeypatch.setattr(structure_store.meta_store, "read", lambda _dir: meta)  # gate passes
    # atomic_write(create_parents=False) on a missing dir wraps the OSError as
    # StorageError (the caller's { detail } mapping catches it) and does NOT
    # recreate the dir.
    with pytest.raises(storage.StorageError):
        storage.write_structure(doc_id, DocStructure())
    assert not doc_dir.exists()  # NOT recreated


# --- route ------------------------------------------------------------------


def test_get_structure_unknown_id_404(data_root):
    resp = client.get("/api/docs/deadbeef/structure")
    assert resp.status_code == 404


def test_get_structure_imported_unanalyzed_returns_empty(data_root):
    raw = make_pdf_bytes()
    up = client.post("/api/docs", files={"file": ("s.pdf", raw, "application/pdf")})
    doc_id = up.json()["doc_id"]
    # The autouse stub writes an EMPTY structure in the background task; either
    # way the endpoint returns {elements: []} for an unanalyzed doc.
    resp = client.get(f"/api/docs/{doc_id}/structure")
    assert resp.status_code == 200
    assert resp.json() == {"elements": []}


def test_get_structure_returns_written_elements(data_root):
    doc_id = _import(make_pdf_bytes())
    storage.write_structure(doc_id, DocStructure(elements=[
        StructureElement(id="7", type="figure", page_index=2,
                         rect={"x0": 0.1, "y0": 0.2, "x1": 0.5, "y1": 0.6}),
    ]))
    resp = client.get(f"/api/docs/{doc_id}/structure")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["elements"]) == 1
    assert body["elements"][0] == {
        "id": "7", "type": "figure", "page_index": 2,
        "rect": {"x0": 0.1, "y0": 0.2, "x1": 0.5, "y1": 0.6},
        "text": "", "heading_level": None,
    }


def test_get_structure_500_on_corrupt(data_root):
    doc_id = _import(make_pdf_bytes())
    (data_root / "library" / doc_id / "structure.json").write_text("{ bad")
    resp = client.get(f"/api/docs/{doc_id}/structure")
    assert resp.status_code == 500
    assert "detail" in resp.json()


# --- structure_status on Doc / library (the "analyzing" indicator) ----------


def test_get_doc_structure_status_is_three_state(data_root):
    # `_import` lands the doc WITHOUT queuing extraction and with no
    # structure.json -> "absent" (grey), NOT analyzing (the bug fix: an
    # already-imported paper never spins).
    doc_id = _import(make_pdf_bytes())
    assert client.get(f"/api/docs/{doc_id}").json()["structure_status"] == "absent"
    # Mark it in-flight -> analyzing.
    storage.mark_structure_analyzing(doc_id)
    assert client.get(f"/api/docs/{doc_id}").json()["structure_status"] == "analyzing"
    # Finish: clear the marker + write structure.json -> ready.
    storage.clear_structure_analyzing(doc_id)
    storage.write_structure(doc_id, DocStructure())
    assert client.get(f"/api/docs/{doc_id}").json()["structure_status"] == "ready"


def test_get_library_reports_structure_status_per_row(data_root):
    analyzing = _import(make_pdf_bytes(title="Analyzing"))
    ready = _import(make_pdf_bytes(title="Ready"))
    absent = _import(make_pdf_bytes(title="Absent"))
    storage.mark_structure_analyzing(analyzing)  # running now
    storage.write_structure(ready, DocStructure())  # analyzed
    # `absent` gets neither -> grey.

    rows = {r["doc_id"]: r for r in client.get("/api/library").json()["papers"]}
    assert rows[analyzing]["structure_status"] == "analyzing"
    assert rows[ready]["structure_status"] == "ready"
    assert rows[absent]["structure_status"] == "absent"


def test_upload_marks_analyzing_then_settles_ready(data_root):
    # A real POST reports "analyzing" immediately (marked synchronously before
    # the response); the TestClient then runs the background task synchronously,
    # which clears the marker AND writes structure.json -> a follow-up GET is
    # "ready".
    raw = make_pdf_bytes()
    up = client.post("/api/docs", files={"file": ("s.pdf", raw, "application/pdf")})
    assert up.status_code == 200
    doc_id = up.json()["doc_id"]
    # The upload response is built before the background task runs, so it caught
    # the analyzing mark.
    assert up.json()["structure_status"] == "analyzing"
    # The background task (structure extraction) already ran, wrote an (empty,
    # via the stub) structure.json, and cleared the mark -> ready.
    assert client.get(f"/api/docs/{doc_id}").json()["structure_status"] == "ready"


# --- run_extraction isolation ----------------------------------------------


def test_run_extraction_structure_failure_does_not_poison_metadata(data_root, monkeypatch):
    from app.routes.extraction import run_extraction

    raw = make_pdf_bytes(pages=2, title="Solid Title")
    doc_id, _ = storage.import_pdf(raw, "s.pdf")

    def boom(pdf_bytes):
        raise RuntimeError("structure blew up")

    monkeypatch.setattr(domain, "extract_structure", boom)
    # Must NOT raise even though structure extraction raises.
    run_extraction(doc_id, raw)
    meta = storage.read_meta(doc_id)
    # Metadata still settled (title survived, not parse-failed by the structure error).
    assert meta.status in ("enrich-skipped", "ready")
    assert meta.title == "Solid Title"


def test_run_extraction_persists_structure(data_root, monkeypatch):
    from app.routes.extraction import run_extraction

    raw = make_pdf_bytes(pages=1)
    doc_id, _ = storage.import_pdf(raw, "s.pdf")
    ds = DocStructure(elements=[
        StructureElement(id="1", type="heading", page_index=0,
                         rect={"x0": 0, "y0": 0, "x1": 1, "y1": 0.1}, text="H"),
    ])
    monkeypatch.setattr(domain, "extract_structure", lambda b: ds)
    run_extraction(doc_id, raw)
    assert storage.read_structure(doc_id) == ds
