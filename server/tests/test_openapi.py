from app.main import app


def test_openapi_contains_pydantic_model_schema() -> None:
    """AC-3: OpenAPI JSON must carry a real Pydantic schema for type-gen."""
    schema = app.openapi()
    assert "HealthStatus" in schema["components"]["schemas"]
    health = schema["components"]["schemas"]["HealthStatus"]
    assert "status" in health["properties"]


def test_health_route_registered_under_api() -> None:
    schema = app.openapi()
    assert "/api/health" in schema["paths"]
