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


def test_openapi_contains_library_models_and_path() -> None:
    """AC-3: CollectionRow/Folder/Library are generated, and GET /api/library
    is registered, so the client type-gen never hand-authors these."""
    schema = app.openapi()
    schemas = schema["components"]["schemas"]
    for name in ("CollectionRow", "Folder", "Library"):
        assert name in schemas
    assert "doc_id" in schemas["CollectionRow"]["properties"]
    assert "folder_id" in schemas["CollectionRow"]["properties"]
    assert "/api/library" in schema["paths"]
    assert "get" in schema["paths"]["/api/library"]


def test_openapi_contains_doc_patch_model_and_path() -> None:
    """Story 6.6: DocPatch and the PATCH /api/docs/{doc_id} path are generated."""
    schema = app.openapi()
    assert "DocPatch" in schema["components"]["schemas"]
    patch = schema["components"]["schemas"]["DocPatch"]
    assert "title" in patch["properties"]
    assert "authors" in patch["properties"]
    assert "patch" in schema["paths"]["/api/docs/{doc_id}"]


def test_openapi_contains_open_path_no_new_schema() -> None:
    """Story 6.7: POST /api/docs/{doc_id}/open is generated and its response
    is the existing Doc schema (no new schema added for this endpoint)."""
    schema = app.openapi()
    path = schema["paths"]["/api/docs/{doc_id}/open"]
    assert "post" in path
    resp200 = path["post"]["responses"]["200"]
    ref = resp200["content"]["application/json"]["schema"]["$ref"]
    assert ref.endswith("/Doc")


def test_openapi_contains_folder_models_and_paths() -> None:
    """Story 7.1: FolderCreate/FolderRename are generated, and the three
    /api/library/folders paths are registered with the right verbs."""
    schema = app.openapi()
    schemas = schema["components"]["schemas"]
    assert "FolderCreate" in schemas
    assert "name" in schemas["FolderCreate"]["properties"]
    assert "parent_id" in schemas["FolderCreate"]["properties"]
    assert "FolderRename" in schemas
    assert "name" in schemas["FolderRename"]["properties"]

    assert "post" in schema["paths"]["/api/library/folders"]
    folder_path = schema["paths"]["/api/library/folders/{folder_id}"]
    assert "patch" in folder_path
    assert "delete" in folder_path
