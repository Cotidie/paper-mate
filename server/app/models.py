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

from pydantic import BaseModel, ConfigDict, Field, field_validator

#: The document extraction lifecycle (AD-L4, Story 6.5): a new import lands
#: ``extracting``; the background pipeline settles it to ``ready`` (Crossref
#: enriched), ``enrich-skipped`` (local fields kept, no external correction),
#: or ``parse-failed`` (no title/authors found — a never-lost filename row).
#: Shared by ``DocMeta`` (own field) and ``CollectionRow`` (display cache) so
#: the two can never drift.
DocStatus = Literal["extracting", "ready", "enrich-skipped", "parse-failed"]


class HealthStatus(BaseModel):
    """Liveness response for ``GET /api/health``. Also carries the app version
    (single source: ``server/pyproject.toml`` via ``app.version``)."""

    status: Literal["ok"] = "ok"
    version: str


class ExtractedMeta(BaseModel):
    """Result of the pure domain extraction pipeline (AD-L2, Story 6.5).

    Internal to the backend: ``extract()`` returns it, ``enrich()`` corrects
    it, and the route projects it onto storage — no route references it, so it
    stays OUT of the OpenAPI schema and needs no generated client type.
    ``authors`` is the domain's honest ``list[str]`` shape; storage joins it to
    the single ``DocMeta.authors`` display string.
    """

    title: str | None = None
    authors: list[str] = []
    doi: str | None = None
    # Captured from Crossref (`container-title` / `issued`); the domain's
    # honest shape before storage projects them.
    venue: str | None = None
    year: int | None = None


class DocMeta(BaseModel):
    """Per-document metadata — the exact on-disk ``meta.json`` schema (AD-8).

    Storage-owned. ``doc_id`` is the library folder name and is intentionally
    NOT a field here; the API surfaces it via ``Doc``.

    ``authors``/``file_type``/``status`` are additive (Story 6.2, no
    ``schema_version`` bump): an existing v1 file missing them still validates
    via defaults. A 6.2 import has no extraction pipeline yet, so it lands
    immediately at ``status="ready"`` with ``authors=None``; Story 6.5 drives
    the ``extracting -> ready | enrich-skipped | parse-failed`` transitions.
    """

    filename: str
    title: str | None = None
    page_count: int
    added: str  # ISO-8601 UTC
    last_opened: str  # ISO-8601 UTC
    authors: str | None = None
    file_type: Literal["pdf", "note"] = "pdf"
    status: DocStatus = "ready"
    # Additive (Story 7.9, no schema_version bump): meta-derived, Crossref-
    # sourced (venue/year) or extraction-sourced (doi). An existing meta.json
    # missing them still validates via defaults.
    doi: str | None = None
    venue: str | None = None
    year: int | None = None
    schema_version: int = 1


class Doc(DocMeta):
    """API representation of an imported document = ``doc_id`` + its metadata."""

    doc_id: str


class DocPatch(BaseModel):
    """Request body for ``PATCH /api/docs/{doc_id}`` (Story 6.6): a partial
    title/authors edit. Request-only (no route returns it) — surfaced into
    OpenAPI by the route's body parameter, not by a model injection.

    Both fields default unset so ``model_dump(exclude_unset=True)`` yields
    only what the client actually sent (true PATCH semantics: a title-only
    edit leaves authors untouched). ``extra="forbid"`` turns an attempt to
    patch a non-editable field (e.g. ``status``) into a loud 422 instead of a
    silently-ignored no-op.
    """

    model_config = ConfigDict(extra="forbid")

    title: str | None = None
    authors: str | None = None


# --- Library / collection index (AD-L1, Story 6.2) --------------------------
#
# ``library.json`` is the authoritative cross-doc index: folder tree,
# membership, trash state, and paper order. Per-paper own fields stay
# authoritative in ``meta.json``; ``CollectionRow`` merges the organizational
# fields (authoritative here) with a meta-derived, non-authoritative display
# cache (title/authors/added/file_type/status) so ``GET /api/library`` renders
# the table from one file read (LNFR-4). Meta always wins on conflict.


class Folder(BaseModel):
    """A folder in the collection's organizing tree (Epic 7 CRUD; the type is
    generated here so the client contract exists ahead of that epic). ``name``
    is mutable and the folder is keyed by ``id``, so a rename never orphans
    membership."""

    id: str  # UUIDv4
    name: str
    parent_id: str | None = None


class FolderCreate(BaseModel):
    """Request body for ``POST /api/library/folders`` (Story 7.1). A blank/
    whitespace ``name`` is rejected here (422) so it can never persist;
    ``parent_id`` nests the new folder (storage validates it exists)."""

    model_config = ConfigDict(extra="forbid")

    name: str
    parent_id: str | None = None

    @field_validator("name")
    @classmethod
    def _name_not_blank(cls, v: str) -> str:
        stripped = v.strip()
        if not stripped:
            raise ValueError("Folder name required")
        return stripped


class FolderRename(BaseModel):
    """Request body for ``PATCH /api/library/folders/{folder_id}`` (Story 7.1):
    a name-only rename. Membership (``parent_id``, paper ``folder_id``) is
    untouched: renaming never orphans a paper."""

    model_config = ConfigDict(extra="forbid")

    name: str

    @field_validator("name")
    @classmethod
    def _name_not_blank(cls, v: str) -> str:
        stripped = v.strip()
        if not stripped:
            raise ValueError("Folder name required")
        return stripped


class DocIdSet(BaseModel):
    """Base request body for a set-based library organization op (AD-L6):
    ``doc_ids`` must be non-empty (an op on nothing is a client bug). Bare
    for trash/restore (``POST /api/library/trash|restore``); ``MoveRequest``
    subclasses it to add a target ``folder_id``."""

    model_config = ConfigDict(extra="forbid")

    doc_ids: list[str] = Field(min_length=1)


class MoveRequest(DocIdSet):
    """Request body for ``POST /api/library/move`` (Story 7.2, AD-L6):
    ``folder_id=None`` clears membership (Uncategorized). A move replaces
    any prior folder, so a paper belongs to at most one folder."""

    folder_id: str | None = None


class CollectionRow(BaseModel):
    """One row of the collection table: organizational fields (authoritative
    in ``library.json``) plus the meta-derived display projection (cached,
    non-authoritative — refreshed from ``meta.json`` on every index write)."""

    doc_id: str
    title: str | None
    authors: str | None
    added: str  # ISO-8601 UTC
    # Additive (Recent lens, no schema_version bump): the client orders the
    # Recent view by this. Optional so a pre-existing library.json entry
    # cached before this field existed still validates; reconcile backfills it.
    last_opened: str | None = None
    file_type: Literal["pdf", "note"]
    status: DocStatus
    folder_id: str | None
    trashed: bool
    # Additive (Star lens, no schema_version bump): org state authoritative in
    # library.json (peer of `trashed`), not meta-derived. Optional so a
    # pre-existing library.json entry cached before this field existed still
    # validates as unstarred; a star mutation writes the key.
    starred: bool = False
    order: int
    # Additive (fix, no schema_version bump): the client falls back to this
    # when `title` is null. Optional so a pre-existing library.json entry
    # cached before this field existed still validates; reconcile backfills it.
    filename: str | None = None
    # Additive (Story 7.9, no schema_version bump): meta-derived cache
    # (like `filename`/`last_opened`), NOT org state like `starred`. Optional
    # so a pre-existing library.json entry cached before these fields existed
    # still validates; reconcile_library backfills them.
    doi: str | None = None
    venue: str | None = None
    year: int | None = None


class Library(BaseModel):
    """The ``GET /api/library`` response envelope: table + folder tree in one
    read. ``folders`` is empty until Epic 7 builds folder CRUD."""

    papers: list[CollectionRow]
    folders: list[Folder]


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
    ``stroke_width`` is pen-only (``None`` for text/region marks);
    ``alpha`` is transparency 0..1 for pen strokes (``None`` = render at the
    default highlighter opacity); ``collapsed`` is memo-only (``None``/``False``
    = expanded, the default; ``True`` = show only the memo's first line).
    ``bubble_width``/``bubble_height`` are comment-only: the note popup's own
    CSS-px chrome size (NOT page-anchored geometry, scale-independent, mirrors
    ``--comment-bubble-width``); ``None`` = the default CSS size, until the
    user drags the bubble's corner handle to resize it.
    Additive + optional (AD-8)."""

    color: str
    stroke_width: float | None = None
    alpha: float | None = Field(default=None, ge=0, le=1)
    collapsed: bool | None = None
    bubble_width: float | None = None
    bubble_height: float | None = None


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
