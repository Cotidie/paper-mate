"""Pydantic v2 models — single source of the API contract (AD-3, AD-5).

Pydantic models here feed FastAPI's OpenAPI schema, which is generated into TS
types for the client via ``openapi-typescript``. Client API types are generated,
never hand-authored.

The ``Annotation`` entity (AD-5) is defined here (Epic 2, Story 2.2). Its
GET/PUT ``/annotations`` endpoints are Epic 3 — so the model is surfaced into
OpenAPI by an injection in ``app.main`` (no endpoint references yet), and the
client consumes a generated type for its in-memory store.
"""

from typing import Annotated, Literal, Union

from pydantic import BaseModel, Field


class HealthStatus(BaseModel):
    """Liveness response for ``GET /api/health``. Also carries the app version
    (single source: ``server/pyproject.toml`` via ``app.version``)."""

    status: Literal["ok"] = "ok"
    version: str


class DocMeta(BaseModel):
    """Per-document metadata — the exact on-disk ``meta.json`` schema (AD-8).

    Storage-owned. ``doc_id`` is the library folder name and is intentionally
    NOT a field here; the API surfaces it via ``Doc``.
    """

    filename: str
    title: str | None = None
    page_count: int
    added: str  # ISO-8601 UTC
    last_opened: str  # ISO-8601 UTC
    schema_version: int = 1


class Doc(DocMeta):
    """API representation of an imported document = ``doc_id`` + its metadata."""

    doc_id: str


# --- Annotation entity (AD-4, AD-5) -----------------------------------------
#
# The spatial-anchor model: every annotation carries an ``anchor`` that maps it
# to precise PDF coordinates (page + normalized [0,1] rect/points), so it
# survives zoom and re-layout. Coordinates are normalized fractions of the
# scale-1.0 page box, top-left origin, y-down — NEVER screen pixels (the client
# anchor/ service derives screen position at the current scale). ``anchor.kind``
# is the rendering discriminator; ``type`` is the user-facing tool. The two are
# distinct on purpose (AD-5): e.g. a ``comment`` renders off a ``text`` anchor.


class Rect(BaseModel):
    """A normalized rect on a page: ``[0,1]`` fractions of the scale-1.0 page
    box, canonical (``x0<=x1, y0<=y1``), top-left origin, y-down."""

    x0: float
    y0: float
    x1: float
    y1: float


class Point(BaseModel):
    """A normalized point on a page (``[0,1]`` fractions), for pen paths."""

    x: float
    y: float


class TextAnchor(BaseModel):
    """Anchor over runs of selected text (highlight / underline / comment). The
    ``rects`` are the per-line boxes from the native Selection API."""

    kind: Literal["text"] = "text"
    page_index: int
    rects: list[Rect]
    text: str


class RectAnchor(BaseModel):
    """Anchor over a single rectangular region (box-select, memo)."""

    kind: Literal["rect"] = "rect"
    page_index: int
    rect: Rect


class PathAnchor(BaseModel):
    """Anchor over a freehand pen stroke (Story 2.5)."""

    kind: Literal["path"] = "path"
    page_index: int
    points: list[Point]


# Discriminated union: ``anchor.kind`` selects the variant. Rendering keys off
# this kind, never off ``Annotation.type`` (AD-5).
Anchor = Annotated[
    Union[TextAnchor, RectAnchor, PathAnchor],
    Field(discriminator="kind"),
]


class Style(BaseModel):
    """Visual style. ``color`` is a token-name or hex resolved by the client;
    ``stroke_width`` is pen-only (``None`` for text/region marks)."""

    color: str
    stroke_width: float | None = None


class Annotation(BaseModel):
    """One annotation (AD-5). Stored keyed by ``id`` in the client store and,
    in Epic 3, persisted to ``annotations.json``. ``group_id`` ties the split
    halves of a two-page selection together (``None`` for a single-page mark).
    ``body`` is non-null only for memo/comment."""

    id: str  # crypto.randomUUID() / UUIDv4
    doc_id: str
    type: Literal["highlight", "underline", "pen", "memo", "comment"]
    group_id: str | None = None
    anchor: Anchor
    style: Style
    body: str | None = None
    created_at: str  # ISO-8601 UTC
    updated_at: str  # ISO-8601 UTC
