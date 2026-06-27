---
baseline_commit: 07dbd824052786615ccf07fadcef50dd82e2c121
---

# Story 1.2: Open a PDF from disk

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a reader,
I want to drop or browse a PDF into the app,
so that it loads into my library and opens for reading.

## Acceptance Criteria

1. **S0 empty state.** Given no PDF is loaded, then the app shows `{component.empty-dropzone}` with primary copy "Drop a PDF here" and secondary "or browse…", token-styled (no inline hex/px). [FR-1, UX-DR3, UX-DR18]
2. **Import + identity + storage.** Given I drop or pick a PDF, when it uploads, then the **storage module** computes `doc_id` = SHA-256 hex of the raw PDF bytes and writes `source.pdf` + `meta.json` under `{data_root}/library/{doc_id}/`. [FR-1, AR-8]
3. **Idempotent re-import.** Given a `{doc_id}/` folder already exists, when I re-import the same PDF, then import is idempotent: an existing `annotations.json`/`meta.json` is **never** overwritten or reset; only `meta.last_opened` is updated. [AR-8]
4. **Boundary + atomic write.** Given any disk write, then **only** the storage module touches `{data_root}`, via atomic temp-file + rename; routes never touch the filesystem and contain no domain logic. [AR-9, AD-7]
5. **Load failure → toast, stay S0.** Given a corrupt, non-PDF, or unsupported file, when load fails, then the API returns the single error envelope `{ "detail": string }` and the client shows `{component.toast}` with the exact copy "Couldn't open this file." and remains in S0. [UX-DR13, UX-DR16, AR-11]
6. **Success → S1 + filename.** Given a successful load, then the top bar shows the filename and the app transitions from S0 to the S1 reader frame. [UX-DR12, EXPERIENCE.md S0→S1]
7. **Generated contract.** Given the upload/import API, then its request/response types are produced by the Pydantic → OpenAPI → `openapi-typescript` pipeline and the client imports the **generated** types; no API types are hand-authored. [AR-3]

> **Scope guard.** This story imports + opens a PDF; it does **not** render pages (Story 1.3), count-driven navigation (1.4), zoom (1.5), or load annotations (Epic 3). On success the client transitions to the existing S1 frame with the filename in the top bar — the canvas stays the empty `reader-backdrop` until 1.3.

## Tasks / Subtasks

- [x] **Task 1 — Storage module: import, hashing, atomic write, layout** (AC: 2, 3, 4)
  - [x] Create the storage module (`server/app/storage/`, currently empty) as the **only** code that touches the data root. Resolve the data root from env `PAPER_MATE_DATA` (default `~/.paper-mate`; the container sets it to `/data`, see Task 6). Layout: `{data_root}/library/{doc_id}/` holding `source.pdf` + `meta.json`. [AR-8, AR-9]
  - [x] `import_pdf(raw_bytes, original_filename) -> (doc_id, DocMeta)`: compute `doc_id` = `hashlib.sha256(raw_bytes).hexdigest()`; validate the bytes parse as a real PDF and extract `page_count` (+ `title` if present in the PDF metadata) via **pypdf** (Task 5). On parse failure raise a domain error (e.g. `InvalidPDFError`) — do **not** write anything.
  - [x] **Idempotency by `doc_id`:** if `{doc_id}/` already exists — ensure `source.pdf` is present (write only if missing), update `meta.last_opened` only, and **never** overwrite/reset an existing `annotations.json` or the rest of `meta.json`. If new, create the folder and write `source.pdf` + a fresh `meta.json`.
  - [x] **Atomic writes only:** write each file to a temp file in the same directory then `os.replace()` (temp + rename). Never write a partial file in place. [AR-8, AR-9]
  - [x] `meta.json` schema (storage-owned, exactly these fields): `{filename, title, page_count, added, last_opened, schema_version}`. `added`/`last_opened` = ISO-8601 UTC strings; `schema_version` = `1`. `doc_id` is the folder name and is **not** stored inside `meta.json` (AD-8). Reject/migrate unknown `schema_version` rather than guessing (no migration needed yet — there is only v1).
- [x] **Task 2 — Pydantic models + upload route (contract source)** (AC: 2, 5, 7)
  - [x] Add models to `server/app/models.py`: `DocMeta` (the 6 on-disk fields) and a `Doc` API response = `doc_id` + the `DocMeta` fields. Do **not** define the full `Annotation` model here — that is Epic 2 (AD-5). [AR-3, AR-12]
  - [x] Add the upload route under the existing `/api` router: `POST /api/docs` accepting a multipart `UploadFile`. The route is **thin** (AR-9): read bytes from the upload, delegate to `storage.import_pdf(...)`, compose and return the `Doc` response. No hashing, no parsing, no disk access in the route.
  - [x] Map `InvalidPDFError` → `HTTPException(status_code=400, detail="...")` so the error uses the single envelope `{ "detail": string }`. The `detail` is a developer message; the client renders the fixed user copy (AC-5). Validation errors already map to the same envelope (FastAPI default).
  - [x] Register `/api/docs` in `server/app/routes/` mirroring the `health` router pattern (`routes/docs.py` + include in `routes/__init__.py`). Reserved-but-not-built this story: `GET /api/docs`, `GET /api/docs/{doc_id}`, `GET /api/docs/{doc_id}/file`, `/api/docs/{doc_id}/annotations` — do not implement them now. [AR-11]
- [x] **Task 3 — Regenerate contract types** (AC: 7)
  - [x] Run the contract pipeline so the client gets generated types: `cd server && PYTHONPATH= uv run python -m app.export_openapi` (writes `server/openapi.json`), then `cd client && npm run gen:api` (regenerates committed `client/src/api/schema.d.ts`). Commit both. Never hand-author the `Doc`/upload types.
- [x] **Task 4 — Client: dropzone (S0), upload, toast, S0↔S1** (AC: 1, 5, 6)
  - [x] Add an `uploadDoc(file: File)` to `client/src/api/client.ts` (the ONLY client→backend path, AR-9): `POST /api/docs` with `FormData`; on non-OK parse `{ detail }` and throw; return the generated `Doc` type (`components["schemas"]["Doc"]`). Reuse the existing error-envelope handling pattern from `fetchHealth`.
  - [x] Build `{component.empty-dropzone}`: a centered dashed-border dropzone on `reader-backdrop`, copy "Drop a PDF here" + secondary "or browse…", with a keyboard-reachable **browse** affordance (hidden `<input type="file" accept="application/pdf">` triggered by a focusable button/label). Support drag-over/drop AND click-to-browse. Token-styled per DESIGN.md `empty-dropzone` (no inline hex/px). Place it at `client/src/` alongside `App.tsx` (app-shell UI — **not** in the reserved `render/anchor/annotations/store` layer dirs).
  - [x] Build `{component.toast}`: transient bottom-center dark surface; show "Couldn't open this file." on load failure; dismissable; keep it reusable (Epic 3 save-failures reuse it). Token-styled per DESIGN.md `toast`.
  - [x] Refactor `App.tsx` to hold app-shell state for the current doc (no PDF → render S0 dropzone; loaded → render the existing S1 frame). Use lightweight React state/context — do **not** introduce the Zustand annotation store yet (that arrives with annotations in Epic 2/3, AD-7). On success set the current doc and swap the top-bar title from "Paper Mate" to the filename; on failure raise the toast and stay in S0.
  - [x] Add the new typography/component CSS vars to `client/src/theme/components.css` (token layer — px allowed there only): `body-md` (16/400), `body-sm` (14/400), `caption` (13/400) type scales, plus any dropzone/toast/save-indicator dims you reference. Color tokens (`canvas-soft`, `muted`, `hairline-strong`, `surface-dark`, `on-dark`) are already auto-generated into `tokens.css` from DESIGN.md — reference them, do not re-add.
- [x] **Task 5 — Add the server PDF-parse dependency** (AC: 2, 5)
  - [x] Add `pypdf` (current stable, pure-Python) to `server/pyproject.toml` `dependencies` with an exact pin, and refresh `uv.lock` (`uv lock`). pypdf gives page count (`len(reader.pages)`) and document title (`reader.metadata.title`) and doubles as the validity check (it raises on non-PDF/corrupt input). [AR-2]
- [x] **Task 6 — Wire the data root for dev and container** (AC: 2, 4)
  - [x] Container: add `environment: PAPER_MATE_DATA=/data` to the `paper-mate` service in `docker-compose.yml` so the process writes to the mounted `/data` (host `~/.paper-mate`). Dev (host process): the storage default `~/.paper-mate` already matches; no extra config needed. Verify `~/.paper-mate/library/{doc_id}/` appears after an import in both modes.
- [x] **Task 7 — Tests** (AC: all)
  - [x] Backend (pytest): build a tiny valid in-memory PDF with pypdf (`PdfWriter().add_blank_page(...)`) so tests are deterministic with no committed binary. Assert: (a) `import_pdf` writes `source.pdf` + `meta.json` under `library/{sha256(bytes)}/`; (b) `meta.json` has exactly the 6-field schema with correct `page_count` and `schema_version=1`; (c) re-import of identical bytes is idempotent — a pre-seeded `annotations.json` and the original `meta.json` (title/page_count/added) are untouched and only `last_opened` advances; (d) atomic write leaves no `.tmp`/partial files; (e) invalid/corrupt bytes → `InvalidPDFError` and **nothing** is written; (f) `POST /api/docs` returns `Doc` (200) with the right `doc_id`, and a non-PDF upload returns 400 with the `{ "detail" }` envelope. Point storage at a `tmp_path` data root via the `PAPER_MATE_DATA` env (monkeypatch) so tests never touch the real `~/.paper-mate`.
  - [x] Contract: `test_openapi.py` (or a new assertion) confirms the OpenAPI schema contains the `Doc` model and the `POST /api/docs` path; the gen step runs clean.
  - [x] Frontend (Vitest): dropzone renders "Drop a PDF here" + "or browse…"; choosing a file calls `uploadDoc` (mock the fetch) → on success the app transitions to S1 with the filename in the top bar; on failure the toast shows the exact "Couldn't open this file." copy and the app stays in S0. Existing `no-raw-values.test.ts` and `focus-ring.test.ts` must still pass (cover the new components); ensure the browse control and dropzone are keyboard-focusable with the 2px `{colors.ink}` ring.
  - [x] Run the full suites + typecheck + prod build green: backend `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q`; frontend `cd client && npm test`; `npm run typecheck`; `npm run build`.

### Review Findings

Code review 2026-06-28 (reviewer engine: Codex CLI). Outcome: **Changes Requested** — 0 High, 2 Medium, 3 Low actionable. See "Senior Developer Review (AI)" below for full context.

- [x] [Review][Patch] Storage errors (`UnsupportedSchemaError`, JSON/Pydantic parse) escape the `{ "detail": string }` envelope as 500s; route catches only `InvalidPDFError` [server/app/routes/docs.py:24, server/app/storage/__init__.py:111] — Fixed: `_read_meta` wraps parse/JSON failures in `CorruptMetadataError`; route catches `storage.StorageError` → HTTP 500 `{ detail }`. Test `test_corrupt_existing_meta_returns_500_detail`.
- [x] [Review][Patch] FastAPI 422 validation errors return `detail: ValidationError[]` (array), violating the AR-11/AC-5 `{ "detail": string }` contract; needs a `RequestValidationError` handler + regen [server/app/routes/docs.py, client/src/api/schema.d.ts:80] — Fixed: `RequestValidationError` handler returns `{ detail: string }`; custom `app.openapi` documents 422 as `ErrorEnvelope`; contract regenerated (`ValidationError` gone from `schema.d.ts`). Tests in `test_docs.py`/`test_openapi.py`.
- [x] [Review][Patch] Atomic write does not fsync the containing directory after `os.replace`, so the rename may not survive a crash on POSIX FS needing dir fsync (durability primitive Epic 3 reuses) [server/app/storage/__init__.py:76] — Fixed: `_fsync_dir` fsyncs the parent dir after `os.replace` (best-effort, ignores platforms that disallow it).
- [x] [Review][Patch] Client `handleFile` has no in-flight guard; overlapping uploads can show a stale failure toast or clobber the newer doc [client/src/App.tsx:19] — Fixed: `busy` state single-flights uploads and disables the dropzone while in flight. Test "disables the browse control while an upload is in flight".
- [x] [Review][Patch] Browse cannot re-select the same file after a failed upload — input value never cleared, so `change` does not refire [client/src/EmptyDropzone.tsx:47] — Fixed: input `value` reset to `""` after each pick. Test "clears the file input value after a pick".
- [x] [Review][Defer] Upload reads the whole PDF into memory with no size cap (`await file.read()`); a huge file could exhaust memory [server/app/routes/docs.py:21] — deferred: localhost single-user threat model (AD-1/AD-10), no size limit in spec; revisit if multi-user.

## Dev Notes

### Architecture patterns & constraints (binding)

- **Dumb store, thin routes** (AD-1, AD-6, AD-7, AD-9). The backend is a thin durable persistence layer with no domain logic. Routes orchestrate and translate HTTP; the storage module owns hashing, the data root, the on-disk layout, and atomic writes. Routes must not touch the filesystem. [Source: ARCHITECTURE-SPINE.md#Design-Paradigm, #AD-9]
- **Storage layout & identity** (AD-8). `{data_root}/library/{doc_id}/` = `source.pdf` + `annotations.json` (Epic 3) + `meta.json`. `doc_id` = SHA-256 hex of original PDF bytes, computed **once** at import, never recomputed (annotations live in separate files, so `doc_id` is stable across annotating). Import is **idempotent by `doc_id`**: existing `annotations.json`/`meta.json` are never overwritten; only `meta.last_opened` updates. `meta.json` is storage-owned, schema `{filename, title, page_count, added, last_opened, schema_version}`; unknown `schema_version` is rejected/migrated, never guessed. [Source: ARCHITECTURE-SPINE.md#AD-8]
- **Atomic write** (AD-8, AD-9): every file write is temp-file-in-same-dir + `os.replace()`. This is the durability primitive Epic 3 autosave reuses — get it right here. [Source: ARCHITECTURE-SPINE.md#AD-8, #Consistency-Conventions]
- **Contract sync** (AD-3): Pydantic `Doc`/`DocMeta` → FastAPI OpenAPI → generated TS via `openapi-typescript`. Client imports `components["schemas"]["Doc"]`; never hand-author. The pipeline + minimal model already exist from Story 1.1 — this story adds the first real domain models. [Source: ARCHITECTURE-SPINE.md#AD-3]
- **API surface** (AR-11): REST/JSON under `/api`. This story builds `POST /api/docs` (import). Reserved, do **not** build now: `GET /api/docs`, `GET /api/docs/{doc_id}`, `GET /api/docs/{doc_id}/file`, `/api/docs/{doc_id}/annotations`. One error envelope only: FastAPI default `{ "detail": string }`. [Source: ARCHITECTURE-SPINE.md#Consistency-Conventions]
- **IDs & dates** (AR-12): `doc_id` = SHA-256 hex; dates = ISO-8601 UTC strings. (UUIDv4 `annotation.id`/`group_id` are Epic 2, not here.) [Source: ARCHITECTURE-SPINE.md#Consistency-Conventions]
- **Layered client, downward deps** (Design Paradigm): app-shell UI (dropzone, toast, App state) is **not** an architecture layer — keep it at `client/src/`, not inside `render/anchor/annotations/store`. The only client→backend path is the generated API client in `api/`. [Source: ARCHITECTURE-SPINE.md#Design-Paradigm, #AD-9]

### Current state of files this story touches (read before editing)

- `server/app/main.py` — app entrypoint; registers `api_router` first, then a SPA catch-all that rejects `api`/`api/*` and contains path-traversal to `_dist`. **Do not disturb** the API-first ordering or the catch-all guard; adding routes under `/api` is automatically shielded. [server/app/main.py]
- `server/app/routes/__init__.py` — `api_router = APIRouter(prefix="/api")` includes `health_router`. Add `docs_router` here the same way. [server/app/routes/__init__.py]
- `server/app/routes/health.py` — the thin-route pattern to mirror (`APIRouter(tags=[...])`, `response_model`, no FS). [server/app/routes/health.py]
- `server/app/models.py` — currently only `HealthStatus`. Add `DocMeta` + `Doc` here. [server/app/models.py]
- `server/app/storage/__init__.py` — empty placeholder; this story fills it (the sole disk writer). [server/app/storage/__init__.py]
- `server/app/export_openapi.py` — exports `server/openapi.json` for the type-gen step (already wired). Re-run after adding models. [Source: Story 1.1 File List]
- `server/pyproject.toml` — deps `fastapi==0.138.1`, `uvicorn[standard]==0.49.0`, `pydantic==2.13.4`; dev `pytest`, `httpx`. Add `pypdf` to `dependencies`. [server/pyproject.toml]
- `client/src/App.tsx` — currently **always** renders the S1 frame with a hardcoded "Paper Mate" title and placeholder ToC/Bank pills. Refactor to render S0 (dropzone) when no doc is loaded and S1 (existing frame, title = filename) when loaded. Preserve the overlay layout (NFR-1) and the focusable chrome. [client/src/App.tsx]
- `client/src/App.css` — S1 frame styles, tokens only. Add S0/dropzone/toast styles here or a sibling CSS, tokens only. [client/src/App.css]
- `client/src/api/client.ts` — the single backend path; `fetchHealth` shows the `{ detail }` error-envelope handling to reuse for `uploadDoc`. [client/src/api/client.ts]
- `client/src/theme/components.css` — hand-authored token layer (px allowed here only); currently only `title-sm` + top-bar/tool-rail dims. Add `body-md`/`body-sm`/`caption` type scales + any dropzone/toast dims. [client/src/theme/components.css]
- `client/src/theme/tokens.css` — **generated** from DESIGN.md colors/spacing/rounded by `gen:tokens` (gitignored build artifact). All color/spacing/radius vars (`--color-canvas-soft`, `--color-muted`, `--color-hairline-strong`, `--color-surface-dark`, `--color-on-dark`, `--space-*`, `--radius-*`) already exist — reference them. [client/scripts/generate-tokens.mjs]

### DESIGN.md token references (S0 + toast)

- `empty-dropzone`: bg `{colors.canvas-soft}` (#fafafa), text `{colors.muted}` (#999), `{typography.body-md}`, `{rounded.lg}` (12px), border `1px dashed {colors.hairline-strong}` (#dcdee0). [Source: DESIGN.md#components.empty-dropzone]
- `toast`: bg `{colors.surface-dark}` (#171717), text `{colors.on-dark}` (#fff), `{typography.body-sm}`, `{rounded.md}` (8px), padding `{spacing.sm} {spacing.base}`. [Source: DESIGN.md#components.toast]
- `save-indicator` (top bar, lands fully in Epic 3 — not built now, token noted for context): bg transparent, text `{colors.muted}`, `{typography.caption}`. [Source: DESIGN.md#components.save-indicator]
- `top-bar` filename: bg `{colors.canvas}`, text `{colors.ink}`, `{typography.title-sm}`, 48px, `borderBottom 1px {colors.hairline}` — already built; swap the title text to the filename. [Source: DESIGN.md#components.top-bar]
- **Rule: reference tokens, never inline hex/px** outside `src/theme/**`; `no-raw-values.test.ts` enforces it. [Source: CLAUDE.md#Design-conventions]
- **Caveat:** ignore DESIGN.md's leftover Expo component entries (hero/pricing/device-mockup); use the token *scales* + reader components only. [Source: CLAUDE.md#Design-conventions]

### UX states & copy (EXPERIENCE.md — use verbatim)

- **S0 · Empty / Open** — no PDF: `{component.empty-dropzone}`, drag-drop or browse; lands in S1 on load. **S1 · Reader** — the existing fixed canvas + overlay chrome. Overlays never reflow the canvas (NFR-1). [Source: EXPERIENCE.md lines 26-37, 71]
- Copy table (verbatim): Empty state primary `Drop a PDF here`, secondary `or browse…`; Load failure `Couldn't open this file.`; Save failure `Couldn't save — changes kept in this session.` (Epic 3). Voice: Obsidian-quiet, lowercase-leaning, no exclamation marks, no emoji; state the fact then the fallback. [Source: EXPERIENCE.md lines 45-49; UX-DR18]
- Error(load) → `{component.toast}` + return to S0. [Source: EXPERIENCE.md lines 79-80]
- Accessibility floor: browse + dropzone keyboard-operable; visible 2px `{colors.ink}` focus ring; toast keyboard-reachable/dismissable. [Source: epics.md UX-DR17; EXPERIENCE.md line 129]

### Previous story intelligence (Story 1.1)

- **Test commands carry host-env workarounds — use them exactly.** Backend: `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q` (`PYTHONPATH=` clears a host ROS leak; the disable-autoload avoids a stray ROS pytest plugin). Frontend: `cd client && npm test`. [Source: 1-1 Debug Log; CLAUDE.md]
- **`legacy-peer-deps=true`** is set in `client/.npmrc` (openapi-typescript@7 peers TS ^5 vs pinned TS 6). Any new client dep installs under this — pin explicit peers if one needs them. [Source: 1-1 Debug Log]
- **Filesystem-touching Vitest tests** must be tagged `// @vitest-environment node` (jsdom's `import.meta.url` is not a `file:` URL). The client side of this story shouldn't touch the FS, but keep it in mind if a test reads files. [Source: 1-1 Debug Log]
- **`no-raw-values.test.ts` strips CSS comments before scanning** and flags any hex/px outside `src/theme/**`. Keep all new component styles token-referencing; put any px in `components.css`. [Source: 1-1 Debug Log]
- **Generated `schema.d.ts` is committed**; regenerate via the two-step pipeline (export_openapi → gen:api) and commit it. [Source: 1-1 Completion Notes AC-3]
- **Security/atomic-write precedent from review:** Story 1.1's review hardened path containment and lockfile-based installs. Mirror that rigor: validate before write, atomic temp+rename, never let a doc-folder write escape the data root (use `doc_id` hex directly as the folder name — it's a fixed-charset hash, not user input, so no traversal, but still resolve+contain the path). [Source: 1-1 Review Findings]
- **Docker:** Compose binds loopback (`127.0.0.1`), installs backend deps from `uv.lock` (`uv sync --frozen --no-dev`). After adding `pypdf`, refresh `uv.lock` or the image build breaks. [Source: 1-1 Review Findings; Dockerfile]

### Testing standards

- Frameworks already chosen (Story 1.1): **pytest** (backend), **Vitest + Testing Library** (frontend). No new frameworks.
- Backend tests live in `server/tests/` (`test_health.py`, `test_openapi.py`, `test_static.py` exist). Add `test_docs.py` (route) and `test_storage.py` (storage unit). Use `tmp_path` + monkeypatched `PAPER_MATE_DATA` so tests never write to the real `~/.paper-mate`.
- Build deterministic PDF fixtures in-memory with pypdf (no committed binary). A known-bytes PDF gives a known `doc_id` for assertions.
- Frontend tests live in `client/src/` next to components. Mock `fetch`/`uploadDoc`; assert S0↔S1 transition and exact toast copy.

### Project Structure Notes

- The two reserved future files this story does **not** create: client `render/`, `anchor/`, `annotations/`, `store/` stay as their Story-1.1 README stubs (PDF rendering = 1.3, anchors/tools = Epic 2, store/command-stack = Epic 2/3). [Source: ARCHITECTURE-SPINE.md#Structural-Seed]
- `meta.json` deliberately **omits `doc_id`** (the folder name is the id); the API `Doc` response **adds** `doc_id`. Don't store the id twice. [Source: ARCHITECTURE-SPINE.md#AD-8]
- After this story, the backend gains its first filesystem-owning module and first domain route — `CLAUDE.md` "Scaffolded (Story 1.1 done)" status line may want a follow-up note, but defer doc updates unless they drift.

### References

- [Source: .bmad/planning-artifacts/epics.md#Story-1.2] — story statement + ACs (FR-1, AR-8, AR-9, UX-DR3/12/13/16/18)
- [Source: .bmad/planning-artifacts/architecture/architecture-paper-mate-2026-06-28/ARCHITECTURE-SPINE.md] — AD-1, AD-3, AD-6, AD-7, AD-8, AD-9, AD-10, AR-11/12, Consistency Conventions, Structural Seed
- [Source: DESIGN.md] — colors, `empty-dropzone`, `toast`, `save-indicator`, `top-bar`, typography scales
- [Source: EXPERIENCE.md] — S0/S1 states, copy table (lines 45-49), focus rings (line 129)
- [Source: .bmad/implementation-artifacts/1-1-walking-skeleton-app-shell.md] — test commands, npmrc, type-gen pipeline, atomic-write/security precedent, File List
- [Source: CLAUDE.md] — design conventions, stack pins, test commands, contract-type workflow

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Claude Code, bmad-dev-story workflow).

### Debug Log References

- `@testing-library/user-event` is not a project dep; rather than add a dependency outside story scope, the App upload tests drive the hidden file input with `fireEvent.change(input, { target: { files: [...] } })`.
- FastAPI multipart `UploadFile` parsing requires `python-multipart` — added as a runtime dep (the upload route is unusable without it).
- Backend pytest still emits the benign Starlette `httpx`/`httpx2` deprecation warning carried over from Story 1.1; tests pass 20/20.

### Completion Notes List

- **AC-1**: S0 `{component.empty-dropzone}` renders "Drop a PDF here" + "or browse…" (token-styled, `no-raw-values` passes). Browse is a keyboard-focusable button triggering a visually-hidden `<input type=file accept=application/pdf>`; drag-drop also supported.
- **AC-2**: storage `import_pdf` computes `doc_id` = SHA-256 hex of raw bytes and writes `source.pdf` + `meta.json` under `{data_root}/library/{doc_id}/`. Verified live: a 2-page PDF yielded `doc_id 40cb003b…` with `page_count=2`, `title="Smoke Paper"`.
- **AC-3**: re-import of identical bytes is idempotent — `added` preserved, only `last_opened` advanced; a seeded `annotations.json` is left untouched (unit `test_reimport_is_idempotent` + live second upload).
- **AC-4**: only the storage module touches the data root; every write is temp-file (`.tmp-*`) + `os.replace` with fsync; `test_atomic_write_leaves_no_temp_files` confirms no leftovers. Route is thin (no FS, no hashing, no parse). Path containment guards the library root.
- **AC-5**: invalid/non-PDF/empty bytes → `InvalidPDFError` → HTTP 400 `{ "detail": "Could not read PDF file" }`; the client maps any failure to the fixed `{component.toast}` copy "Couldn't open this file." and stays in S0 (verified live + Vitest).
- **AC-6**: on success the app swaps from S0 to the S1 reader frame with the filename in the top bar (`paper.pdf` shown; `reader-backdrop` appears).
- **AC-7**: `Doc`/`DocMeta` Pydantic models → OpenAPI → regenerated `client/src/api/schema.d.ts` (committed); client imports the generated `Doc` type. `openapi.json` re-export diffs clean (in sync).
- App-shell doc state is lightweight React `useState`; the Zustand annotation store is intentionally deferred to Epic 2/3. No page rendering (Story 1.3).
- Deps pinned: `pypdf==6.1.1`, `python-multipart==0.0.32`; `uv.lock` refreshed (both are runtime deps, so `uv sync --frozen --no-dev` in the Docker image keeps them).
- Tests: backend 20 passed (pytest), frontend 17 passed (vitest), typecheck clean, prod build clean. Live uvicorn smoke: upload / idempotent re-import / bad-file-400 / disk layout all confirmed.
- **Post-review fixes (2026-06-28):** all 5 code-review patch findings resolved — storage errors now answer via the `{ detail }` envelope (`CorruptMetadataError` + route catches `StorageError`); 422 validation maps to `{ detail: string }` (handler + custom OpenAPI → `ErrorEnvelope`, contract regenerated); `_atomic_write` fsyncs the parent dir; client single-flights uploads (busy guard + dropzone disabled) and resets the file input after each pick. Added tests. Re-ran green: backend 25, frontend 19, typecheck + build clean. 1 finding deferred (upload size cap), 1 dismissed (per-doc lock — AD-6 no concurrency).

### File List

**Added — server/**
- `server/app/routes/docs.py`
- `server/tests/conftest.py`
- `server/tests/test_storage.py`
- `server/tests/test_docs.py`

**Added — client/**
- `client/src/EmptyDropzone.tsx`
- `client/src/EmptyDropzone.css`
- `client/src/Toast.tsx`
- `client/src/Toast.css`

**Modified — server/**
- `server/app/main.py` (RequestValidationError → string envelope; custom OpenAPI `ErrorEnvelope` for 422)
- `server/app/models.py` (DocMeta + Doc)
- `server/app/storage/__init__.py` (import_pdf, hashing, atomic write, idempotency)
- `server/app/routes/__init__.py` (register docs router)
- `server/pyproject.toml` (pypdf, python-multipart)
- `server/uv.lock`
- `server/tests/test_openapi.py` (Doc model + /api/docs path assertions)

**Modified — client/**
- `client/src/App.tsx` (S0/S1 doc state + upload handling)
- `client/src/App.test.tsx` (S0/S1 behavior tests)
- `client/src/api/client.ts` (uploadDoc + Doc type)
- `client/src/api/schema.d.ts` (regenerated, committed)
- `client/src/theme/components.css` (body-md/body-sm/caption + dropzone/toast dims)

**Modified — root**
- `docker-compose.yml` (PAPER_MATE_DATA=/data container env)
- `.bmad/implementation-artifacts/sprint-status.yaml` (1-2 → in-progress → review → done)

**Added — review**
- `.bmad/implementation-artifacts/deferred-work.md` (deferred upload size-cap item)

**Generated/uncommitted (gitignored):** `server/openapi.json`, `client/src/theme/tokens.css`, `client/dist/`.

## Change Log

| Date | Change |
| --- | --- |
| 2026-06-28 | Story 1.2 implemented: storage module (SHA-256 `doc_id`, atomic temp+rename, idempotent import, `meta.json`), `POST /api/docs` thin route, `DocMeta`/`Doc` models → regenerated TS contract, S0 dropzone + reusable toast + S0↔S1 transition, pypdf/python-multipart deps, `PAPER_MATE_DATA=/data` container env. Backend 20 + frontend 17 tests pass; typecheck + build clean; live upload smoke verified. Status → review. |
| 2026-06-28 | Code review (Codex CLI reviewer): 7 raw findings → triaged to 5 patch, 1 defer, 1 dismissed. Outcome: Changes Requested (2 Medium, 3 Low). Findings recorded under Tasks/Subtasks → Review Findings. |
| 2026-06-28 | Applied all 5 review patches: storage `{ detail }` envelope for non-PDF storage errors, 422 → string envelope (handler + OpenAPI `ErrorEnvelope`, regenerated contract), dir fsync after rename, client upload single-flight guard, file-input reset. Added tests; backend 25 + frontend 19 pass, typecheck + build clean. Status → done. |

## Senior Developer Review (AI)

### Review Outcome

Changes Requested.

### Review Date

2026-06-28

### Reviewer Engine

Codex CLI (`codex exec`, GPT-class model) — run as an independent reviewer (different model than the implementer) across three layers: blind correctness, edge cases, and acceptance-vs-spec. Triage performed in the BMad `code-review` workflow.

### Scope Reviewed

- Diff `07dbd82..HEAD` on `feat/story-1-2-open-pdf` (24 files, +1092/-38).
- In scope: `server/app/{models,storage,routes}`, `client/src/**` (App, EmptyDropzone, Toast, api client), `docker-compose.yml`, `docs/API.md`, generated `schema.d.ts`, tests.

### Severity Breakdown

- High: 0
- Medium: 2 (actionable) + 1 dismissed
- Low: 3 (actionable) + 1 deferred

### Action Items

- [x] [Medium] Storage `UnsupportedSchemaError`/JSON/Pydantic parse failures escape the `{ "detail": string }` envelope as 500s — route catches only `InvalidPDFError`. [server/app/routes/docs.py:24, server/app/storage/__init__.py:111] — Resolved.
- [x] [Medium] FastAPI 422 validation errors return `detail: ValidationError[]`, violating AR-11/AC-5's `{ "detail": string }` contract — add a `RequestValidationError` handler returning a string detail, then regen OpenAPI/TS. [client/src/api/schema.d.ts:80] — Resolved.
- [x] [Low] `_atomic_write` does not fsync the parent directory after `os.replace`; rename may not be crash-durable on POSIX FS requiring dir fsync (Epic 3 reuses this primitive — NFR-4). [server/app/storage/__init__.py:76] — Resolved.
- [x] [Low] Client `handleFile` lacks an in-flight guard; overlapping uploads can show a stale toast or clobber the newer doc. [client/src/App.tsx:19] — Resolved.
- [x] [Low] Browse cannot re-select the same file after a failed upload (input value not cleared → no `change` event). [client/src/EmptyDropzone.tsx:47] — Resolved.

### Triage Notes

- **Deferred:** upload reads the whole PDF into memory with no size cap (`server/app/routes/docs.py:21`). Real, but the threat model is localhost single-user (AD-1/AD-10) and no limit is specified; revisit if the app ever serves multiple users. Logged in `deferred-work.md`.
- **Dismissed:** "idempotency is check-then-act without a per-doc lock" — AD-6 mandates single user, one session per doc, **no concurrency**. Concurrent same-`doc_id` imports are out of scope by architecture decision, so the race is not a defect for v1.
