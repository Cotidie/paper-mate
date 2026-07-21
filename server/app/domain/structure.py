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

import os
import tempfile
from pathlib import Path
from typing import Any, Literal, Protocol

import pymupdf

from app.models import DocStructure, Rect, StructureElement, StructureType

StructureMode = Literal["local", "hybrid"]

#: Default URL of the opendataloader hybrid server (Docling Fast Server). The
#: hybrid backend is a SEPARATE process the Java core calls over HTTP; in our
#: single container it is launched by ``app.main`` only in hybrid mode.
_HYBRID_URL_DEFAULT = "http://localhost:5002"
#: Per-request hybrid timeout (ms). The spike measured ~16s GPU / ~37-98s CPU per
#: paper; 120s leaves CPU-fallback headroom. ``hybrid_fallback`` degrades a stuck
#: page to the Java result rather than emptying the whole structure.
_HYBRID_TIMEOUT_MS = 120_000


def _env_mode() -> StructureMode:
    """Parse ``PAPER_MATE_STRUCTURE_MODE``.

    ``"hybrid"`` selects the higher-fidelity Docling backend; ANY other value
    (unset, ``"local"``, or a typo) resolves to ``"local"`` so a misconfig fails
    safe to the deterministic + offline default."""
    return "hybrid" if os.environ.get("PAPER_MATE_STRUCTURE_MODE", "").strip().lower() == "hybrid" else "local"


def _env_hybrid_url() -> str:
    """Parse ``PAPER_MATE_STRUCTURE_HYBRID_URL`` (default
    ``http://localhost:5002``). A local host means the bundled server is launched
    in-container; a remote host means an external/sidecar server."""
    return os.environ.get("PAPER_MATE_STRUCTURE_HYBRID_URL", "").strip() or _HYBRID_URL_DEFAULT


#: Resolved ONCE at import: the switch is restart-scoped (env + restart, no
#: rebuild), so every consumer must agree on ONE value for the process lifetime.
#: Reading the env live instead would let ``/api/health`` and the hybrid-server
#: lifecycle disagree with the already-constructed ``_default_extractor``.
_ACTIVE_MODE: StructureMode = _env_mode()
_HYBRID_URL: str = _env_hybrid_url()


def active_mode() -> StructureMode:
    """The structure-extraction mode this process runs in (resolved at import).

    The single source of truth: the default extractor below, the hybrid-server
    lifecycle (``app.structure_hybrid``), and ``app.routes.health`` all read it,
    so the reported mode is always the mode extraction actually uses."""
    return _ACTIVE_MODE


def hybrid_url() -> str:
    """The hybrid Docling-server URL this process uses (resolved at import,
    alongside :func:`active_mode`)."""
    return _HYBRID_URL


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

    Runs in one of two runtime-switchable modes (AD-13, Story 10.3): **local**
    (deterministic + offline, born-digital PDFs) or **hybrid** (the Docling Fast
    Server backend, higher fidelity). The mode only changes the ``convert()``
    kwargs in ``_run``; both modes emit opendataloader's SAME JSON tree, so the
    ``_map_tree`` mapping downstream is identical (spike-confirmed parity).

    File-based, so it round-trips through an OS temp dir (see module docstring).
    ``_run`` (the JVM hop) is split from ``_map_tree`` (pure) so unit tests feed a
    captured raw JSON tree without spawning Java.
    """

    def __init__(
        self,
        mode: StructureMode = "local",
        hybrid_url: str = _HYBRID_URL_DEFAULT,
        hybrid_timeout_ms: int = _HYBRID_TIMEOUT_MS,
    ) -> None:
        self._mode: StructureMode = mode
        self._hybrid_url = hybrid_url
        self._hybrid_timeout_ms = hybrid_timeout_ms

    def extract(self, pdf_bytes: bytes) -> DocStructure:
        try:
            raw = self._run(pdf_bytes)
            page_dims = _page_dims(pdf_bytes)
            if not page_dims:
                return DocStructure()
            return _map_tree(raw, page_dims)
        except Exception:
            # Total: a bad PDF, a JVM error, or (in hybrid) a hybrid-server
            # error/timeout/OOM yields an empty structure, never a raise (never
            # blocks the paper reaching `ready`). Local mode stays the fallback.
            return DocStructure()

    def _run(self, pdf_bytes: bytes) -> dict[str, Any]:
        """Spawn opendataloader on the bytes and return its parsed JSON tree.

        Writes the bytes to a temp file, runs a JSON-only, image-off conversion
        into a temp dir, and reads the single produced ``.json`` back. In hybrid
        mode the Java core POSTs pages to the already-running Docling Fast Server
        at ``hybrid_url`` (``hybrid_fallback`` degrades a failed page to the Java
        result). The temp dir is throwaway scratch (AD-9 unaffected).
        """
        import json

        import opendataloader_pdf

        kwargs: dict[str, Any] = dict(
            format="json",
            image_output="off",
            quiet=True,
        )
        if self._mode == "hybrid":
            kwargs.update(
                hybrid="docling-fast",
                hybrid_url=self._hybrid_url,
                hybrid_mode="auto",
                hybrid_fallback=True,
                hybrid_timeout=str(self._hybrid_timeout_ms),
            )

        with tempfile.TemporaryDirectory() as td:
            src = Path(td) / "input.pdf"
            src.write_bytes(pdf_bytes)
            out = Path(td) / "out"
            out.mkdir()
            opendataloader_pdf.convert(input_path=str(src), output_dir=str(out), **kwargs)
            produced = [p for p in out.rglob("*.json")]
            if not produced:
                return {}
            return json.loads(produced[0].read_text())


#: The default adapter the domain surface delegates to (swappable, like the
#: ``Enricher`` default). Mode + hybrid URL are read ONCE from the env at import
#: (the switch is restart-scoped): ``PAPER_MATE_STRUCTURE_MODE`` selects the mode.
_default_extractor: StructureExtractor = OpenDataLoaderExtractor(
    mode=active_mode(), hybrid_url=hybrid_url()
)


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
