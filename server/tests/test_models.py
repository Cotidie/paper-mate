"""Annotation entity tests (AD-5, Story 2.2 + 2.13): the discriminated-union
anchor round-trips and the model is surfaced into OpenAPI (so the client gets a
generated TS type) without adding endpoints. Story 2.13 adds Style.alpha.
Memo collapse/expand (user feature request, 2026-07-02) adds Style.collapsed."""

import pytest
from pydantic import ValidationError

from app.main import app
from app.models import (
    Annotation,
    CollectionRow,
    DocIdSet,
    DocMeta,
    Folder,
    Library,
    MoveRequest,
    PathAnchor,
    RectAnchor,
    Style,
    TextAnchor,
)

BASE = {
    "id": "11111111-1111-1111-1111-111111111111",
    "doc_id": "doc-1",
    "type": "highlight",
    "group_id": None,
    "style": {"color": "annotation-default"},
    "body": None,
    "created_at": "2026-06-29T00:00:00+00:00",
    "updated_at": "2026-06-29T00:00:00+00:00",
}


def test_text_anchor_parses_via_discriminator() -> None:
    ann = Annotation.model_validate(
        {**BASE, "anchor": {"kind": "text", "page_index": 0, "rects": [{"x0": 0, "y0": 0, "x1": 1, "y1": 1}], "text": "hi"}}
    )
    assert isinstance(ann.anchor, TextAnchor)
    assert ann.anchor.rects[0].x1 == 1.0


def test_rect_anchor_parses_via_discriminator() -> None:
    ann = Annotation.model_validate(
        {**BASE, "type": "memo", "anchor": {"kind": "rect", "page_index": 2, "rect": {"x0": 0, "y0": 0, "x1": 1, "y1": 1}}}
    )
    assert isinstance(ann.anchor, RectAnchor)
    assert ann.anchor.page_index == 2


def test_path_anchor_parses_via_discriminator() -> None:
    ann = Annotation.model_validate(
        {**BASE, "type": "pen", "style": {"color": "ink", "stroke_width": 2.0}, "anchor": {"kind": "path", "page_index": 0, "points": [{"x": 0.1, "y": 0.2}]}}
    )
    assert isinstance(ann.anchor, PathAnchor)
    assert ann.style.stroke_width == 2.0


def test_style_alpha_null_by_default() -> None:
    """Story 2.13: alpha defaults to None (backward-compatible, AD-8)."""
    s = Style(color="annotation-default")
    assert s.alpha is None
    assert s.stroke_width is None


def test_style_alpha_round_trips() -> None:
    """Story 2.13: alpha is stored and retrieved exactly."""
    s = Style(color="annotation-ink", stroke_width=4.0, alpha=0.4)
    assert s.alpha == pytest.approx(0.4)


def test_style_alpha_rejects_out_of_range() -> None:
    """Story 2.13: Pydantic rejects alpha outside [0, 1]."""
    with pytest.raises(ValidationError):
        Style(color="x", alpha=1.5)
    with pytest.raises(ValidationError):
        Style(color="x", alpha=-0.1)


def test_pen_annotation_with_alpha_round_trips() -> None:
    """Story 2.13: a pen Annotation with alpha parses correctly."""
    ann = Annotation.model_validate(
        {
            **BASE,
            "type": "pen",
            "style": {"color": "ink", "stroke_width": 2.0, "alpha": 0.6},
            "anchor": {"kind": "path", "page_index": 0, "points": [{"x": 0.1, "y": 0.2}]},
        }
    )
    assert isinstance(ann.anchor, PathAnchor)
    assert ann.style.alpha == pytest.approx(0.6)


def test_pen_annotation_null_alpha_backward_compatible() -> None:
    """Story 2.13 / AD-8: a pre-2.13 pen mark (no alpha field) parses fine."""
    ann = Annotation.model_validate(
        {
            **BASE,
            "type": "pen",
            "style": {"color": "ink", "stroke_width": 2.0},
            "anchor": {"kind": "path", "page_index": 0, "points": [{"x": 0.1, "y": 0.2}]},
        }
    )
    assert ann.style.alpha is None


def test_style_collapsed_null_by_default() -> None:
    """Memo collapse/expand: collapsed defaults to None (backward-compatible, AD-8)."""
    s = Style(color="annotation-default")
    assert s.collapsed is None


def test_style_collapsed_round_trips() -> None:
    """Memo collapse/expand: collapsed is stored and retrieved exactly."""
    s = Style(color="annotation-default", collapsed=True)
    assert s.collapsed is True


def test_memo_annotation_with_collapsed_round_trips() -> None:
    """Memo collapse/expand: a memo Annotation with collapsed=True parses correctly."""
    ann = Annotation.model_validate(
        {
            **BASE,
            "type": "memo",
            "style": {"color": "annotation-default", "collapsed": True},
            "body": "a note",
            "anchor": {"kind": "rect", "page_index": 0, "rect": {"x0": 0, "y0": 0, "x1": 0.1, "y1": 0.1}},
        }
    )
    assert isinstance(ann.anchor, RectAnchor)
    assert ann.style.collapsed is True


def test_memo_annotation_no_collapsed_field_backward_compatible() -> None:
    """AD-8: a pre-collapse memo mark (no collapsed field) parses fine, defaults expanded."""
    ann = Annotation.model_validate(
        {
            **BASE,
            "type": "memo",
            "style": {"color": "annotation-default"},
            "body": "a note",
            "anchor": {"kind": "rect", "page_index": 0, "rect": {"x0": 0, "y0": 0, "x1": 0.1, "y1": 0.1}},
        }
    )
    assert ann.style.collapsed is None


def test_annotation_surfaced_in_openapi_via_annotations_route() -> None:
    """AD-3: the real PUT + GET /annotations routes emit the Annotation schema
    (Story 3.4 PUT, Story 3.5 GET); the manual injection is gone."""
    schema = app.openapi()
    schemas = schema["components"]["schemas"]
    assert "Annotation" in schemas
    # The $defs resolve as components (no dangling refs).
    for name in ("TextAnchor", "RectAnchor", "PathAnchor", "Rect", "Point", "Style"):
        assert name in schemas
    annotations_paths = [p for p in schema["paths"] if "annotations" in p]
    assert len(annotations_paths) == 1
    operations = schema["paths"][annotations_paths[0]]
    assert "put" in operations
    assert "get" in operations  # Story 3.5: hydrate-on-open GET now live


# --- Library models (Story 6.2, AD-8 additive extension) --------------------


def test_doc_meta_defaults_additive_fields() -> None:
    """AD-8: a bare DocMeta (as a pre-6.2 v1 meta.json would validate) fills in
    the new fields' defaults."""
    meta = DocMeta(filename="f.pdf", page_count=1, added="t", last_opened="t")
    assert meta.authors is None
    assert meta.file_type == "pdf"
    assert meta.status == "ready"


def test_doc_meta_round_trips_new_fields() -> None:
    meta = DocMeta(
        filename="f.pdf",
        page_count=1,
        added="t",
        last_opened="t",
        authors="A. Author",
        file_type="note",
        status="extracting",
    )
    assert meta.authors == "A. Author"
    assert meta.file_type == "note"
    assert meta.status == "extracting"


def test_folder_round_trips() -> None:
    folder = Folder(id="11111111-1111-1111-1111-111111111111", name="Reading List")
    assert folder.parent_id is None


def test_collection_row_round_trips() -> None:
    row = CollectionRow(
        doc_id="d1",
        title="A Paper",
        authors=None,
        added="2026-07-05T00:00:00+00:00",
        file_type="pdf",
        status="ready",
        folder_id=None,
        trashed=False,
        order=0,
    )
    assert row.doc_id == "d1"
    assert row.trashed is False


def test_collection_row_accepts_and_round_trips_last_opened() -> None:
    """Story 7.7, AC-4: additive display-cache field, mirrors `filename`."""
    row = CollectionRow(
        doc_id="d1",
        title="A Paper",
        authors=None,
        added="2026-07-05T00:00:00+00:00",
        last_opened="2026-07-06T00:00:00+00:00",
        file_type="pdf",
        status="ready",
        folder_id=None,
        trashed=False,
        order=0,
    )
    assert row.last_opened == "2026-07-06T00:00:00+00:00"


def test_collection_row_defaults_last_opened_when_missing() -> None:
    """A dict missing `last_opened` (a pre-existing library.json entry cached
    before the field existed) still validates."""
    row = CollectionRow(
        doc_id="d1",
        title="A Paper",
        authors=None,
        added="2026-07-05T00:00:00+00:00",
        file_type="pdf",
        status="ready",
        folder_id=None,
        trashed=False,
        order=0,
    )
    assert row.last_opened is None


def test_collection_row_accepts_and_round_trips_starred() -> None:
    """Story 7.8, AC-4: additive org-state field, mirrors `trashed`."""
    row = CollectionRow(
        doc_id="d1",
        title="A Paper",
        authors=None,
        added="2026-07-05T00:00:00+00:00",
        file_type="pdf",
        status="ready",
        folder_id=None,
        trashed=False,
        starred=True,
        order=0,
    )
    assert row.starred is True


def test_collection_row_defaults_starred_when_missing() -> None:
    """A dict missing `starred` (a pre-existing library.json entry cached
    before the field existed) still validates as unstarred."""
    row = CollectionRow(
        doc_id="d1",
        title="A Paper",
        authors=None,
        added="2026-07-05T00:00:00+00:00",
        file_type="pdf",
        status="ready",
        folder_id=None,
        trashed=False,
        order=0,
    )
    assert row.starred is False


def test_library_wraps_papers_and_folders() -> None:
    row = CollectionRow(
        doc_id="d1",
        title=None,
        authors=None,
        added="t",
        file_type="pdf",
        status="ready",
        folder_id=None,
        trashed=False,
        order=0,
    )
    library = Library(papers=[row], folders=[])
    assert library.papers == [row]
    assert library.folders == []


def test_doc_id_set_rejects_empty_doc_ids() -> None:
    with pytest.raises(ValidationError):
        DocIdSet(doc_ids=[])


def test_doc_id_set_rejects_extra_field() -> None:
    with pytest.raises(ValidationError):
        DocIdSet(doc_ids=["d1"], folder_id="f1")


def test_move_request_still_validates_doc_ids_and_folder_id() -> None:
    move = MoveRequest(doc_ids=["d1", "d2"], folder_id="f1")
    assert move.doc_ids == ["d1", "d2"]
    assert move.folder_id == "f1"
