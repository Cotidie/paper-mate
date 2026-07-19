"""Document-structure extraction (AD-13, AD-L8, Story 10.1).

The **second tenant** of the backend domain layer (after metadata extract/enrich):
``extract_structure(pdf_bytes) -> DocStructure`` behind a swappable port, with
**opendataloader-pdf** (Apache-2.0, a Java core via its Python binding) as the
first adapter. Like ``extract`` it is **total** -- any failure yields an empty
``DocStructure``, never a raise -- and never makes a network call (opendataloader
local mode is deterministic + offline; hybrid/OCR mode is out of scope).

Two nuances worth stating out loud:

- **Coordinate flip lives here.** opendataloader emits ``[left, bottom, right,
  top]`` in PDF points, y-UP (origin bottom-left). AD-4 stores normalized
  ``[0,1]`` top-left, y-down rects. This module is the ONE place that flip
  happens server-side, so ``structure.json`` already IS anchors and the client
  ``structure/`` service denormalizes it exactly like an annotation anchor. Page
  dimensions come from PyMuPDF ``page.rect`` (the CropBox in points), the same
  basis the client's ``render/getPageBox`` normalizes against (CropBox + Rotate).
- **A file-based binding uses an OS temp dir.** opendataloader's Python API is
  file-in / file-out (no in-memory return), so the adapter round-trips through a
  ``tempfile.TemporaryDirectory``. This is throwaway scratch and does NOT violate
  AD-9 (storage remains the only writer of ``~/.paper-mate``); it is a surfaced,
  accepted deviation from AD-L2's "domain never touches the filesystem", the same
  way AD-L2 itself was surfaced as amending AD-6.
"""

import tempfile
from pathlib import Path
from typing import Any, Protocol

import pymupdf

from app.models import DocStructure, Rect, StructureElement, StructureType

#: opendataloader raw type -> our vocabulary (AD-13). Anything not listed maps to
#: ``"other"`` (its ``text block`` layout container, ``formula``, and any future
#: type), so an unmapped type can never break contract validation. ``image`` and
#: ``picture`` both mean a figure region. ``footnote`` is listed for the day
#: opendataloader emits it; across the spike corpus it never did.
_TYPE_MAP: dict[str, StructureType] = {
    "heading": "heading",
    "paragraph": "paragraph",
    "table": "table",
    "caption": "caption",
    "list": "list",
    "image": "figure",
    "picture": "figure",
    "footnote": "footnote",
}


def _coerce_bbox(raw: Any) -> tuple[float, float, float, float] | None:
    """Parse a ``bounding box`` that may be a ``[l,b,r,t]`` list OR a string
    repr of one (opendataloader serializes a container element's bbox as a
    string). Return ``None`` for any unparseable shape."""
    if isinstance(raw, str):
        raw = raw.strip().lstrip("[").rstrip("]")
        parts = [p for p in raw.replace(",", " ").split() if p]
    elif isinstance(raw, (list, tuple)):
        parts = list(raw)
    else:
        return None
    if len(parts) != 4:
        return None
    try:
        left, bottom, right, top = (float(p) for p in parts)
    except (TypeError, ValueError):
        return None
    return left, bottom, right, top


def _coerce_int(raw: Any) -> int | None:
    """Parse a ``page number`` / ``heading level`` that may be int or str."""
    if isinstance(raw, bool):
        return None
    if isinstance(raw, int):
        return raw
    if isinstance(raw, str) and raw.strip().lstrip("-").isdigit():
        return int(raw.strip())
    return None


def _to_rect(
    bbox: tuple[float, float, float, float], page_w: float, page_h: float
) -> Rect:
    """Flip + normalize a PDF-points ``[l,b,r,t]`` (y-up) box to an AD-4
    normalized ``[0,1]`` top-left ``Rect``. Canonicalizes (x0<=x1, y0<=y1) and
    clamps to ``[0,1]``."""
    left, bottom, right, top = bbox
    x0, x1 = left / page_w, right / page_w
    # y-up -> y-down: the page's top edge (high PDF y) becomes y=0.
    y0, y1 = (page_h - top) / page_h, (page_h - bottom) / page_h
    return Rect(
        x0=_clamp01(min(x0, x1)),
        y0=_clamp01(min(y0, y1)),
        x1=_clamp01(max(x0, x1)),
        y1=_clamp01(max(y0, y1)),
    )


def _clamp01(v: float) -> float:
    return min(1.0, max(0.0, v))


def _page_dims(pdf_bytes: bytes) -> list[tuple[float, float]]:
    """Per-page ``(width, height)`` in PDF points via PyMuPDF ``page.rect`` (the
    CropBox), the same page box the client normalizes against (AD-4). Returns an
    empty list on any parse failure (the caller then emits no elements)."""
    try:
        doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    except Exception:
        return []
    try:
        return [(page.rect.width, page.rect.height) for page in doc]
    except Exception:
        return []
    finally:
        doc.close()


def _map_tree(raw: dict[str, Any], page_dims: list[tuple[float, float]]) -> DocStructure:
    """Pure: opendataloader's JSON tree -> a ``DocStructure`` in reading order.

    A pre-order walk of ``kids`` yields the elements in the paper's reading order
    (opendataloader's XY-Cut++ order). Every node carrying a ``type`` + a valid
    ``bounding box`` on a known page becomes a ``StructureElement``; a node whose
    page or box can't be resolved is skipped (never crashes the walk). No JVM,
    no I/O -- unit-testable with a captured raw fixture.
    """
    elements: list[StructureElement] = []

    def visit(node: Any) -> None:
        if not isinstance(node, dict):
            return
        raw_type = node.get("type")
        bbox = _coerce_bbox(node.get("bounding box"))
        page_no = _coerce_int(node.get("page number"))
        if raw_type and bbox is not None and page_no is not None:
            page_index = page_no - 1  # opendataloader is 1-indexed; AD-4 is 0-based
            if 0 <= page_index < len(page_dims):
                page_w, page_h = page_dims[page_index]
                if page_w > 0 and page_h > 0:
                    elements.append(
                        StructureElement(
                            id=str(node.get("id", len(elements))),
                            type=_TYPE_MAP.get(raw_type, "other"),
                            page_index=page_index,
                            rect=_to_rect(bbox, page_w, page_h),
                            text=str(node.get("content") or ""),
                            heading_level=_coerce_int(node.get("heading level")),
                        )
                    )
        for kid in node.get("kids") or []:
            visit(kid)

    visit(raw)
    return DocStructure(elements=elements)


class StructureExtractor(Protocol):
    """The structure-extraction port (mirrors ``domain.Enricher``). An adapter
    turns PDF bytes into a ``DocStructure``; it MUST be total (never raise)."""

    def extract(self, pdf_bytes: bytes) -> DocStructure: ...


class OpenDataLoaderExtractor:
    """First adapter: opendataloader-pdf (Java core via its Python binding).

    File-based, so it round-trips through an OS temp dir (see module docstring).
    ``_run`` (the JVM hop) is split from ``_map_tree`` (pure) so unit tests feed a
    captured raw JSON tree without spawning Java.
    """

    def extract(self, pdf_bytes: bytes) -> DocStructure:
        try:
            raw = self._run(pdf_bytes)
            page_dims = _page_dims(pdf_bytes)
            if not page_dims:
                return DocStructure()
            return _map_tree(raw, page_dims)
        except Exception:
            # Total: a bad PDF, a JVM error, or malformed output yields an empty
            # structure, never a raise (never blocks the paper reaching `ready`).
            return DocStructure()

    def _run(self, pdf_bytes: bytes) -> dict[str, Any]:
        """Spawn opendataloader on the bytes and return its parsed JSON tree.

        Writes the bytes to a temp file, runs a JSON-only, image-off, offline
        (local-mode) conversion into a temp dir, and reads the single produced
        ``.json`` back. The temp dir is throwaway scratch (AD-9 unaffected).
        """
        import json

        import opendataloader_pdf

        with tempfile.TemporaryDirectory() as td:
            src = Path(td) / "input.pdf"
            src.write_bytes(pdf_bytes)
            out = Path(td) / "out"
            out.mkdir()
            opendataloader_pdf.convert(
                input_path=str(src),
                output_dir=str(out),
                format="json",
                image_output="off",
                quiet=True,
            )
            produced = [p for p in out.rglob("*.json")]
            if not produced:
                return {}
            return json.loads(produced[0].read_text())


#: The default adapter the domain surface delegates to (swappable, like the
#: ``Enricher`` default).
_default_extractor: StructureExtractor = OpenDataLoaderExtractor()


def extract_structure(pdf_bytes: bytes) -> DocStructure:
    """Extract a document's structure, best-effort (FR-34, AD-13, AD-L8).

    The domain surface: delegates to the default adapter (opendataloader).
    **Total** -- any failure returns ``DocStructure()``, never raises -- so the
    background import pipeline can call it without a guard of its own. Also
    enforces the return CONTRACT: a swapped adapter that returns a non-
    ``DocStructure`` (e.g. ``None``) is coerced to an empty structure rather than
    leaking an off-contract value downstream.
    """
    try:
        result = _default_extractor.extract(pdf_bytes)
    except Exception:
        return DocStructure()
    return result if isinstance(result, DocStructure) else DocStructure()
