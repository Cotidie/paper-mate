"""In-flight document-structure analysis tracking (the "analyzing" indicator).

The honest signal for "opendataloader-pdf is running against this paper RIGHT
NOW" is NOT "``structure.json`` is absent" -- a paper imported before the
structure layer existed (or one whose extraction produced nothing) also has no
``structure.json``, yet nothing is running against it. Structure extraction runs
**only** at import, inside ``run_extraction``'s background task; it never
re-runs for an already-imported paper. So "analyzing" must mean exactly "that
import-time extraction task is in flight".

This is a **process-runtime** fact, so it lives in memory, not on disk: a
module-level set of the doc_ids currently being analyzed, marked when extraction
is queued and cleared when the pass finishes (success OR failure). A server
restart clears it -- correct, because the background tasks did not survive the
restart either, so nothing is analyzing after a restart. No stale marker files,
no boot cleanup.
"""

import threading

# Guarded by `_lock`: the doc_ids whose import-time structure extraction is in
# flight in THIS process. Add/discard/membership are each cheap; the lock keeps
# the route-thread reads and the extraction-threadpool writes unambiguous.
_analyzing: set[str] = set()
_lock = threading.Lock()


def mark_structure_analyzing(doc_id: str) -> None:
    """Record that structure extraction is now in flight for ``doc_id``."""
    with _lock:
        _analyzing.add(doc_id)


def clear_structure_analyzing(doc_id: str) -> None:
    """Record that structure extraction for ``doc_id`` has finished (either
    outcome). A no-op if it was never marked."""
    with _lock:
        _analyzing.discard(doc_id)


def is_structure_analyzing(doc_id: str) -> bool:
    """Whether opendataloader is currently running against ``doc_id``."""
    with _lock:
        return doc_id in _analyzing


def structure_status_for(doc_id: str, structure_exists: bool) -> str:
    """Derive the response-only 3-state ``StructureStatus`` for the status dot:

    - ``"analyzing"`` while this doc's import-time extraction is in flight
      (amber, pulsing) — takes precedence, so a paper actively being processed
      always reads as working.
    - else ``"ready"`` when its ``structure.json`` exists (green): analyzed.
    - else ``"absent"`` (grey): never analyzed / no structure (a pre-layer
      paper, a failed extraction, or a non-PDF).

    Pure given the two inputs (the caller pairs it with
    ``structure_store.structure_exists``), so this module needs no import of the
    storage disk layer and stays cycle-free. Returns the ``StructureStatus``
    literal as a plain ``str``; the route annotates the field.
    """
    if is_structure_analyzing(doc_id):
        return "analyzing"
    return "ready" if structure_exists else "absent"
