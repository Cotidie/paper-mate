"""App settings routes (AD-9). Thin: no filesystem access, no process logic.

Today one resource, the document-structure extraction mode. Bringing the hybrid
server up costs a model load, far longer than a request should hold, so the PUT
returns the ``starting``/``stopping`` state immediately and does the work in a
background task; the client polls the GET until ``transition`` is ``idle``. Same
shape as the structure-status dot's settle polling.
"""

from fastapi import APIRouter, BackgroundTasks, HTTPException

from app import structure_mode
from app.models import StructureModeRequest, StructureModeState

router = APIRouter(prefix="/settings", tags=["settings"])


def _to_response(state: structure_mode.ModeState) -> StructureModeState:
    return StructureModeState(mode=state.mode, transition=state.transition, error=state.error)


@router.get("/structure-mode", response_model=StructureModeState)
def get_structure_mode() -> StructureModeState:
    """The live extraction mode plus any in-flight transition."""
    return _to_response(structure_mode.current_state())


@router.put("/structure-mode", response_model=StructureModeState)
def put_structure_mode(
    body: StructureModeRequest, background: BackgroundTasks
) -> StructureModeState:
    """Request a mode change. Returns the transitional state at once and runs
    the spawn or shutdown in the background."""
    try:
        state = structure_mode.begin_transition(body.mode)
    except structure_mode.ModeBusyError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if state.transition != "idle":
        background.add_task(structure_mode.run_transition)
    return _to_response(state)
