"""Health route — proves the ``/api`` surface and dev proxy work end-to-end."""

from fastapi import APIRouter

from app.domain import active_mode
from app.models import HealthStatus
from app.version import get_version

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthStatus)
def get_health() -> HealthStatus:
    """Return liveness + app version + active structure mode. No filesystem
    access (AD-9). ``structure_mode`` reads ``PAPER_MATE_STRUCTURE_MODE`` via the
    same ``domain.active_mode`` the extractor uses (single source of truth)."""
    return HealthStatus(version=get_version(), structure_mode=active_mode())
