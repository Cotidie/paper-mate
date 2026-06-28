# Paper Mate API

Human-readable reference for the backend HTTP surface.

> **Source of truth = the Pydantic models, not this file.** The contract is
> generated `Pydantic (server/app/models.py) → FastAPI OpenAPI → server/openapi.json → client/src/api/schema.d.ts` (AD-3). This doc is a maintained companion — **update it in the same change that adds or alters an endpoint.** When in doubt, the running app's `/docs` (Swagger UI) and `server/openapi.json` win.

## Conventions

- **Base path:** all endpoints live under `/api`. Same-origin in prod (FastAPI serves API + built SPA); dev proxies `/api` → FastAPI (AD-10).
- **Format:** REST/JSON.
- **Errors:** one envelope only — FastAPI default `{ "detail": string }` — for every error, including validation failures (AR-11). Clients map failures to fixed user copy (e.g. the load-failure toast); the `detail` string is developer-facing.
- **IDs:** `doc_id` = SHA-256 hex of the original PDF bytes; `annotation.id`/`group_id` = UUIDv4 (Epic 2). **Dates:** ISO-8601 UTC strings.
- **Auth:** none (localhost, single user).

## Resources

### `GET /api/health`

Liveness probe. No filesystem access.

- **200** → `HealthStatus`
  ```json
  { "status": "ok", "version": "0.0.1" }
  ```
  `version` is the running app version. Single source = `server/pyproject.toml`
  (`[project].version`), read at runtime via `app.version.get_version()`.

### `POST /api/docs` — import a PDF

Upload a PDF from disk. The storage module computes `doc_id` = SHA-256 of the
bytes and stores `source.pdf` + `meta.json` under
`{data_root}/library/{doc_id}/`. Import is **idempotent by `doc_id`**: re-importing
the same bytes never overwrites an existing `annotations.json`/`meta.json` — only
`meta.last_opened` advances (AD-8).

- **Request:** `multipart/form-data`, field `file` = the PDF.
- **200** → `Doc`
  ```json
  {
    "doc_id": "40cb003b…c0347f4",
    "filename": "paper.pdf",
    "title": "A Paper",          // string | null (from PDF metadata)
    "page_count": 12,
    "added": "2026-06-28T00:00:00+00:00",
    "last_opened": "2026-06-28T00:00:00+00:00",
    "schema_version": 1
  }
  ```
- **400** → `{ "detail": "Could not read PDF file" }` — corrupt, empty, or non-PDF bytes. Nothing is written.

> `Doc` = `doc_id` + the on-disk `meta.json` schema (`DocMeta`:
> `filename, title, page_count, added, last_opened, schema_version`). `doc_id`
> is the library folder name and is **not** stored inside `meta.json` (AD-8).

### `GET /api/docs/{doc_id}/file` — stream the stored PDF

Return the raw bytes of a document's stored `source.pdf`. The render layer
fetches this by `doc_id` (never the filesystem); storage owns the path (AR-9).

- **200** → `application/pdf` (the exact stored bytes; `FileResponse`).
- **404** → `{ "detail": "Document not found" }` — no document or `source.pdf` for `doc_id`.

## Reserved (not yet built)

Declared by the architecture (AR-11), implemented in later stories. Do not
assume these exist until they appear above.

| Method & path | Purpose | Story |
| --- | --- | --- |
| `GET /api/docs` | List library documents | TBD |
| `GET /api/docs/{doc_id}` | Get one document's metadata | TBD |
| `GET /api/docs/{doc_id}/annotations` | Fetch the saved annotation set | Epic 3 |
| `PUT /api/docs/{doc_id}/annotations` | Overwrite the full annotation set (atomic) | Epic 3 |

## Changelog

- **2026-06-29:** `HealthStatus` gains `version` (app version, single source `server/pyproject.toml`); surfaced for the top-bar version badge.
- **2026-06-28 (Story 1.3):** added `GET /api/docs/{doc_id}/file` (stream stored PDF bytes).
- **2026-06-28 (Story 1.2):** added `POST /api/docs` (PDF import) + `Doc`/`DocMeta` models.
- **2026-06-28 (Story 1.1):** `GET /api/health` + the contract-generation pipeline.
