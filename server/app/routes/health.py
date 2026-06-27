"""Health route — proves the ``/api`` surface and dev proxy work end-to-end."""

from fastapi import APIRouter

from app.models import HealthStatus

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthStatus)
def get_health() -> HealthStatus:
    """Return liveness. No filesystem access (AD-9)."""
    return HealthStatus()
