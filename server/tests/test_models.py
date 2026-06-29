"""Annotation entity tests (AD-5, Story 2.2 + 2.13): the discriminated-union
anchor round-trips and the model is surfaced into OpenAPI (so the client gets a
generated TS type) without adding endpoints. Story 2.13 adds Style.alpha."""

import pytest
from pydantic import ValidationError

from app.main import app
from app.models import Annotation, PathAnchor, RectAnchor, Style, TextAnchor

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


def test_annotation_surfaced_in_openapi_without_endpoints() -> None:
    """AD-3: the Annotation schema is generated into the contract; AD-5/Reserved:
    its /annotations endpoints stay Epic 3 (not present yet)."""
    schema = app.openapi()
    schemas = schema["components"]["schemas"]
    assert "Annotation" in schemas
    # The hoisted $defs resolve (no dangling refs).
    for name in ("TextAnchor", "RectAnchor", "PathAnchor", "Rect", "Point", "Style"):
        assert name in schemas
    # No annotations endpoint yet.
    assert not any("annotations" in path for path in schema["paths"])
