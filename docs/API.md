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

### `PUT /api/docs/{doc_id}/annotations` — overwrite the full annotation set

Client autosave path (AR-7, H6): a debounced, single-flight PUT that sends the
**entire current annotation set** for the document, every time. The backend is
a dumb store: it has no history, undo, or merge logic, and overwrites
`{data_root}/library/{doc_id}/annotations.json` atomically (temp + rename)
with exactly what it received.

- **Request body:** bare `Annotation[]` (H9: the API body is bare; the
  `{schema_version, annotations}` envelope is added only on disk, inside
  storage).
- **200** → the same `Annotation[]` it received (echoed; the client ignores
  the body).
- **404** → `{ "detail": "Document not found" }` — `doc_id` has no `meta.json`
  (never imported). An annotations file is never created for an unknown doc.
- **422** → `{ "detail": string }` — malformed body (AR-11 envelope).
- **500** → `{ "detail": "Could not save annotations" }` — a storage failure
  other than an unknown doc.

> On-disk shape (internal, never sent/received over the API): `{ "schema_version": 1, "annotations": [Annotation, ...] }`.

## Reserved (not yet built)

Declared by the architecture (AR-11), implemented in later stories. Do not
assume these exist until they appear above.

| Method & path | Purpose | Story |
| --- | --- | --- |
| `GET /api/docs` | List library documents | TBD |
| `GET /api/docs/{doc_id}` | Get one document's metadata | TBD |
| `GET /api/docs/{doc_id}/annotations` | Fetch the saved annotation set (hydrate-on-open) | Story 3.5 |

> **`Style` fields:** `color` (token name), `stroke_width` (pen-only, scale-1.0 px; `null` for text/region marks), `alpha` (pen-only transparency 0..1; `null` = render at the default highlighter opacity `0.4`; additive optional field, Story 2.13, AD-8).

## Changelog

- **2026-07-01 (Story 3.4):** added `PUT /api/docs/{doc_id}/annotations` (overwrite full set, atomic). GET stays reserved (3.5). The manual `Annotation` OpenAPI injection in `app/main.py` is removed: the real PUT route now emits `Annotation` (+ its anchor variants) into the contract.
- **2026-06-30 (Story 2.13):** `Style` gains `alpha: float | null` (pen stroke transparency, 0..1; optional with default `null` = render at highlighter opacity; additive, no format break, AD-8). No endpoints added.
- **2026-06-29 (Story 2.2):** added the `Annotation` entity (+ `Anchor` variants `TextAnchor`/`RectAnchor`/`PathAnchor`, `Rect`, `Point`, `Style`) to `components.schemas` for the generated client type. No endpoints added (the `/annotations` GET/PUT stay Epic 3).
- **2026-06-29:** `HealthStatus` gains `version` (app version, single source `server/pyproject.toml`); surfaced for the top-bar version badge.
- **2026-06-28 (Story 1.3):** added `GET /api/docs/{doc_id}/file` (stream stored PDF bytes).
- **2026-06-28 (Story 1.2):** added `POST /api/docs` (PDF import) + `Doc`/`DocMeta` models.
- **2026-06-28 (Story 1.1):** `GET /api/health` + the contract-generation pipeline.
