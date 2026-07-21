"""Health route — proves the ``/api`` surface and dev proxy work end-to-end."""

from fastapi import APIRouter

from app.domain import active_mode
from app.models import HealthStatus
from app.version import get_version

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthStatus)
def get_health() -> HealthStatus:
    """Return liveness + app version + active structure mode. No filesystem
    access (AD-9). ``structure_mode`` comes from ``domain.active_mode`` (resolved
    once at import from ``PAPER_MATE_STRUCTURE_MODE``), the same value the
    extractor and the hybrid-server lifecycle use, so the reported mode is always
    the mode extraction actually runs in."""
    return HealthStatus(version=get_version(), structure_mode=active_mode())
