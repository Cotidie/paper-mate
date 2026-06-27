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


def test_openapi_contains_doc_model_and_upload_path() -> None:
    """AC-7: the import contract is generated, not hand-authored."""
    schema = app.openapi()
    assert "Doc" in schema["components"]["schemas"]
    doc = schema["components"]["schemas"]["Doc"]
    assert "doc_id" in doc["properties"]
    assert "page_count" in doc["properties"]
    assert "/api/docs" in schema["paths"]
    assert "post" in schema["paths"]["/api/docs"]


def test_validation_errors_documented_as_string_envelope() -> None:
    """AR-11: the 422 contract is the single { detail: string } envelope."""
    schema = app.openapi()
    schemas = schema["components"]["schemas"]
    assert "HTTPValidationError" not in schemas
    assert schemas["ErrorEnvelope"]["properties"]["detail"]["type"] == "string"
    resp422 = schema["paths"]["/api/docs"]["post"]["responses"]["422"]
    ref = resp422["content"]["application/json"]["schema"]["$ref"]
    assert ref.endswith("/ErrorEnvelope")
