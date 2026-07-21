"""Health route — proves the ``/api`` surface and dev proxy work end-to-end."""

from fastapi import APIRouter

from app.models import HealthStatus
from app.structure_mode import current_state
from app.version import get_version

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthStatus)
def get_health() -> HealthStatus:
    """Return liveness + app version + active structure mode. No filesystem
    access (AD-9). ``structure_mode`` comes from ``app.structure_mode``, the
    single runtime owner, so the reported mode is always the mode the next
    extraction will actually run in -- including after a runtime flip."""
    return HealthStatus(version=get_version(), structure_mode=current_state().mode)
