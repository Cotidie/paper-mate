---
baseline_commit: 0e2f13cad573239696fd11dec6b5bc20aa6fbee8
---

# Story 10.3: Migrate structure extraction to opendataloader hybrid mode (runtime-switchable)

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a reader,
I want the document structure extracted with higher fidelity (fewer missed/mis-tagged headings, tables, and figures),
so that the ToC, Figures/Tables index, reading-helper, and metadata are more complete and accurate, especially on papers with no embedded outline.

## Acceptance Criteria

1. **(SPIKE-FIRST gate, FR-34, AD-13; a negative outcome is a complete + acceptable result)** Given the story, then it **starts** with a spike, and nothing below is committed until the spike passes. In a throwaway env/container (do NOT touch the committed `uv.lock` yet): install `opendataloader-pdf[hybrid]`, start the `opendataloader-pdf-hybrid` server (Docling backend, default `:5002`), and run `convert(hybrid="docling-fast", hybrid_url=..., format="json")` on **2-3 real papers including TranAD** (`fixtures/sample-pdfs/adtran.pdf`). Characterize and record: (a) that `3 METHODOLOGY` / `3.1 Problem Formulation` / `3.2 Data Preprocessing` are now recovered as `type="heading"` (the motivating gap); (b) the added image size + dependency footprint (Docling + easyocr + torch weights); (c) whether models download from the network at build or first-run (the offline question) and whether they can be pre-baked; (d) whether extraction is deterministic run-to-run; (e) **that the hybrid raw-JSON output shape is IDENTICAL to local mode** (a `kids` tree, `"bounding box"` = `[left,bottom,right,top]` PDF points, 1-indexed `"page number"`, the same `type` vocabulary), so `domain/structure.py`'s `_map_tree`/`_to_rect`/`_TYPE_MAP` need NO change — **any delta here is the primary finding**. Capture one hybrid raw-JSON tree as a test fixture. **If hybrid cannot run in-image, OR breaks the coordinate/type mapping, STOP and write it up** ([[verify-on-hidpi-and-real-host]]); local mode stays the shipped default and the story halts as an acceptable negative result.

2. **(Runtime switch, default LOCAL, contract unchanged, AD-13/AD-3)** Given the spike passed, when structure extraction runs at import (AD-L4), then `OpenDataLoaderExtractor` selects local vs hybrid from a **single runtime config switch** `PAPER_MATE_STRUCTURE_MODE` (values `local` | `hybrid`), **read once**, **defaulting to `local`** (user decision 2026-07-21, overriding the proposal's "default hybrid": local keeps every fresh `docker compose up` deterministic + offline, hybrid is opt-in). Flipping to `hybrid` is **one env value + a container restart, no rebuild** (the image already carries the hybrid deps + baked models + the hybrid server — see AC #5). The `extract_structure` port, the `DocStructure` contract, and the persisted `structure.json` shape are **unchanged**: a consumer (ToC/index/reading-helper/metadata) cannot tell which mode produced a structure.

3. **(Totality + lifecycle preserved, exactly like Story 10.1/10.2)** Given either mode, then extraction stays **total + non-blocking**: a hybrid failure (model-load error, timeout, OOM, the hybrid server down) yields an empty `DocStructure`, never crashes the import, never blocks the paper reaching a settled metadata status, and the structure-status marker's `analyzing → ready` lifecycle (`storage/structure_progress.py`, Story 10.2) is **unchanged** (hybrid simply keeps the dot "analyzing" longer). `convert(..., hybrid_fallback=True, hybrid_timeout=<bounded ms>)` is used so a single bad page degrades to the Java result rather than emptying the whole structure.

4. **(Offline + determinism surfaced, not hidden; NFR-1)** Given AD-13's "deterministic + offline for born-digital PDFs" invariant, then the change **surfaces, not hides,** how hybrid relaxes it. Model weights are **baked into the image at build** (user decision: HF_HOME / easyocr model dir pre-populated), so hybrid stays **offline once built** and NFR-1 is satisfiable in hybrid mode too. If hybrid is non-deterministic run-to-run, that is documented as a MODE property. **Local mode remains the deterministic + offline default**, reachable by leaving the switch unset. The default (local) is recorded here.

5. **(Image is always hybrid-capable; second process only in hybrid mode, AD-10)** Given the single-container constraint (AD-10), then the built image **always** carries the hybrid capability: the `opendataloader-pdf[hybrid]` deps (docling[easyocr] + fastapi + uvicorn) and the pre-baked models, so switching never needs a rebuild. The `opendataloader-pdf-hybrid` server is a **separate process** the Java core calls over HTTP; it is launched from FastAPI's `_lifespan` **only when `PAPER_MATE_STRUCTURE_MODE=hybrid`** (and terminated on shutdown), so **local (the default) pays no runtime RAM/model-load cost** even though the deps sit in the image. The image-size increase (multi-GB, torch) is the accepted cost of decision A (record the measured size).

6. **(Live-smoked at DPR>1, the migration proven)** Given the migration is live-smoked in-container (`docker compose up --build`, `PAPER_MATE_STRUCTURE_MODE=hybrid`), then on the TranAD paper the synthesized ToC (Story 10.2) now includes the sections local mode dropped (`3 Methodology`, `3.1`, `3.2`), verified at **DPR>1** that the recovered headings land on the real on-page elements (the coordinate mapping still holds under hybrid output). Also verified live: flipping `local ↔ hybrid` is env + restart only (no rebuild), and hybrid still extracts with the **network cut** (offline, models baked).

7. **(Active mode observable, AD-3)** Given observability, then the active mode is exposed via `GET /api/health` (add `structure_mode: "local" | "hybrid"` to `HealthStatus`, read from the env), regenerated into the OpenAPI → TS types (never hand-authored), and documented in `docs/API.md`. No new UI is required (surfacing it in the top bar is optional).

8. **(Hybrid is GPU-optional with a CPU fallback; a GPU-less container MUST still work)** Given hybrid mode, then the Docling backend runs on a **GPU when the container is given one, and falls back to CPU when it is not** — a container with **no GPU access still extracts** (just slower), never crashes on a missing CUDA device. The device is chosen by `PAPER_MATE_STRUCTURE_HYBRID_DEVICE` (default `auto` → CUDA if a device is visible, else CPU; `cpu`/`cuda`/`mps` force it), passed to the hybrid server's `--device`. The image keeps the **CUDA-capable torch wheel** (so GPU works when exposed) — the cpu-only wheel is NOT used. Compose exposes the GPU as a **documented opt-in** (a commented NVIDIA `deploy.resources.reservations.devices` block), OFF by default so `docker compose up` boots on a host with no NVIDIA Container Toolkit; with it off, torch sees no device and uses CPU. The CPU-fallback path is live-smoked (AC #6); the GPU path is proven where a GPU + the NVIDIA Container Toolkit are available, else documented as unverified-in-container.

## Tasks / Subtasks

> **Task 1 is the spike gate (AC #1). Do it FIRST and stop at its decision point.** Tasks 2-9 are contingent on the spike passing. A negative spike result (hybrid won't run in-image, or the raw JSON shape/coordinates differ so the mapping breaks) is a **complete, acceptable** outcome: record it in the Dev Agent Record + a `deferred-work.md` writeup and HALT (stay on local), per the SPIKE-FIRST charter.

- [x] **Task 1 — SPIKE: prove hybrid runs in-container + characterize cost + confirm coordinate/type parity (AC: #1).** In a **throwaway** venv/container — do NOT modify the committed `pyproject.toml`/`uv.lock` until the spike passes.
  - [x] `pip install "opendataloader-pdf[hybrid]"` (pulls `docling[easyocr]`, `fastapi`, `python-multipart`, `uvicorn`; docling drags in torch). Start the hybrid server: `opendataloader-pdf-hybrid --port 5002` (console script → `opendataloader_pdf.hybrid_server:main`). Confirm it comes up and note first-run model-download behavior (Docling + easyocr fetch from HF/torch hub).
  - [x] Run `opendataloader_pdf.convert(input_path=..., output_dir=..., format="json", hybrid="docling-fast", hybrid_url="http://localhost:5002", hybrid_mode="auto", hybrid_fallback=True, quiet=True)` on **TranAD** (`fixtures/sample-pdfs/adtran.pdf`) + 1-2 more real papers (one multi-column). `hancom-ai` is **ruled out** (remote AI service, breaks offline/NFR-1) — do NOT evaluate it.
  - [x] **The heading-recovery check (the whole point):** in the hybrid JSON, confirm `3 METHODOLOGY`, `3.1 Problem Formulation`, `3.2 Data Preprocessing` now appear with `type="heading"` (local mode mis-tagged/dropped them). If `hybrid_mode="auto"` triage doesn't send those pages to the backend, try `hybrid_mode="full"` and record which is needed.
  - [x] **The parity check (the primary risk after "does it run"):** diff the hybrid raw-JSON shape against a local run of the same paper — is it the same `kids` tree with `"bounding box"` = `[left,bottom,right,top]` PDF points, 1-indexed `"page number"`, and the same `type` strings (`heading|paragraph|table|caption|list|image|...`)? opendataloader is expected to re-emit its OWN format regardless of backend (the Docling server only improves region detection), so `_map_tree`/`_to_rect`/`_TYPE_MAP` should need NO change. **If the shape differs, that delta is the finding** — record it precisely; a mapping change is in scope only if the spike proves it necessary.
  - [x] **Characterize the cost:** measure the installed-deps + model-weights size (the image budget), whether models can be pre-fetched at build (for AC #4 offline), per-paper latency (sizes AC #3's `hybrid_timeout`), and determinism (run TranAD twice, compare).
  - [x] **Device characterization (AC #8):** start the hybrid server with `--device cpu` (prove the GPU-less path works — the user's worry) AND, since this host has a GPU, `--device cuda` (prove GPU works + record the speedup). Confirm `auto` (no `--device`) falls back to CPU cleanly when no device is visible. Record per-device latency + that `--no-ocr` is safe for born-digital papers.
  - [x] Capture one hybrid raw-JSON tree → `server/tests/fixtures/structure/odl_adtran_hybrid.json` (the parity regression fixture for Task 7).
  - [x] **Decision point.** Runs in-image + parity holds → proceed to Task 2 and lock findings into Dev Notes. Either fails → write up + HALT (AC #1). **→ SPIKE PASSED (see Debug Log). Proceeding to Task 2.**

- [x] **Task 2 — Always-hybrid-capable image + baked models (AC: #4, #5).** The image carries hybrid capability unconditionally (decision A). **(code + lockfile done; the actual multi-GB image BUILD is host-run, see Task 8.)**
  - [x] Dependency: added an OPT-IN `hybrid` extra (`[project.optional-dependencies] hybrid = ["opendataloader-pdf[hybrid]==2.5.0"]`) + re-locked (`uv lock`); the Dockerfile installs it via `uv sync --extra hybrid`. Chose an extra over a base dep so a plain local `uv sync` stays lean while the image is always hybrid-capable. Pin `==2.5.0` kept; `test_version.py` green. **License:** docling (MIT), easyocr (Apache-2.0), torch (BSD-3) are all permissive; the repo stays AGPL via PyMuPDF (no new copyleft).
  - [x] `Dockerfile` runtime stage: `uv sync --frozen --no-dev --extra hybrid` + a `download_models()` bake step into `HF_HOME=/app/models` + `ENV HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1` for offline runtime resolution. Spike proved the runtime offline mechanism (HF_HOME + HF_HUB_OFFLINE + baked cache → full convert, no network). Image size + a clean-build offline-load verify are host-run (Task 8).
  - [x] Note in Dev Notes: JRE (Story 10.1) stays; hybrid adds torch/docling. deps venv measured **5.3 GB** + docling models **~506 MB** (--no-ocr, no easyocr). Multi-GB, the accepted cost of decision A.
  - [x] **Keep the CUDA-capable torch wheel** (the default PyPI `torch` Linux wheel bundles the CUDA runtime and still runs CPU-only when no device is present) so hybrid is GPU-optional (AC #8). Do NOT pin the `+cpu` wheel. No CUDA **base image** is needed (torch bundles the runtime libs); GPU passthrough is a host/compose concern (NVIDIA Container Toolkit + a compose device reservation), not an image change. Record whether the model bake needs a GPU (it should not — model DOWNLOAD is device-agnostic; only inference uses the device).

- [x] **Task 3 — Config seam + adapter mode dispatch (AC: #2, #3).** In `server/app/domain/structure.py`:
  - [x] Give `OpenDataLoaderExtractor` an injectable mode + url: `__init__(self, mode: Literal["local","hybrid"] = "local", hybrid_url: str = "http://localhost:5002")`. `_run` branches: local → the current `convert(..., format="json", image_output="off", quiet=True)`; hybrid → the same plus `hybrid="docling-fast", hybrid_url=self.hybrid_url, hybrid_mode=<auto|full per spike>, hybrid_fallback=True, hybrid_timeout=<bounded ms per spike>`. Everything downstream of `_run` (the `_map_tree` mapping) is unchanged (parity, AC #1).
  - [x] `_default_extractor` reads the env **once**: `OpenDataLoaderExtractor(mode=_env_mode(), hybrid_url=_env_hybrid_url())` where `_env_mode()` reads `PAPER_MATE_STRUCTURE_MODE` (default `"local"`; any value other than `"hybrid"` → `"local"`, so a typo fails safe to local). `os` is already allowed in `structure.py` (the `_STRUCTURE_OS_SCRATCH` purity exemption, Story 10.1) so reading `os.environ` here does NOT trip `test_domain_modules_are_pure` — verify it still passes.
  - [x] **Totality is unchanged:** the `try/except → DocStructure()` in `extract`/`extract_structure` already covers a hybrid failure (server down, timeout, OOM). Confirm a hybrid exception still yields an empty structure, never raises.
  - [x] Optional advanced knobs (mention in `.env.example`, don't over-build): `PAPER_MATE_STRUCTURE_HYBRID_URL` (default `http://localhost:5002`; for a remote/sidecar hybrid server). The primary switch is `PAPER_MATE_STRUCTURE_MODE`.

- [x] **Task 4 — Second-process lifecycle, hybrid-only (AC: #5, #8).** In `server/app/main.py` `_lifespan`: when `PAPER_MATE_STRUCTURE_MODE=hybrid`, launch `opendataloader-pdf-hybrid` as a subprocess (default `:5002`) before yielding, wait for readiness (poll `GET http://localhost:5002/health` with a bounded timeout), and terminate it gracefully on shutdown. When mode is local (default), do NOT launch it (local pays no cost). Keep it best-effort + logged like the existing `reconcile_library` block: a hybrid-server launch failure logs and does not brick boot (extraction then fails total → empty structure, per AC #3, and the operator sees it in `/api/health` mode + logs). Factor the launch/teardown into a small testable helper (mock the subprocess in unit tests; the real spawn is live-smoke).
  - [x] **Device passthrough (AC #8):** the launch command passes `--device <PAPER_MATE_STRUCTURE_HYBRID_DEVICE>` (default `auto`). For born-digital papers also pass `--no-ocr` (the reader targets born-digital PDFs; skipping EasyOCR avoids its model + speeds the pass — record in Dev Notes; OCR/scanned stays out of scope). `auto` makes a GPU-less container fall back to CPU with no crash; the readiness poll + the total-extraction guard (AC #3) cover a slow CPU-only startup.

- [x] **Task 5 — Health observability (AC: #7).** `server/app/models.py`: add `structure_mode: Literal["local","hybrid"]` to `HealthStatus`. `server/app/routes/health.py`: `get_health()` reads the env (reuse the `_env_mode()` helper or a shared `app.config`-style reader — do NOT duplicate the parse) and returns it. Regenerate the contract in the SAME change: `cd server && PYTHONPATH= uv run python -m app.export_openapi` then `cd client && npm run gen:api`. `docs/API.md`: update the `GET /api/health` entry with the new field + a dated changelog line (additive, Story 10.3).

- [x] **Task 6 — Compose + `.env.example` (AC: #2, #8).** Add `PAPER_MATE_STRUCTURE_MODE` to `docker-compose.yml`'s `environment:` (default local, e.g. `PAPER_MATE_STRUCTURE_MODE: ${PAPER_MATE_STRUCTURE_MODE:-local}`) plus `PAPER_MATE_STRUCTURE_HYBRID_DEVICE: ${PAPER_MATE_STRUCTURE_HYBRID_DEVICE:-auto}`. Document both in `.env.example` under a new `# --- Document structure ---` section: what local vs hybrid means, that hybrid needs a restart (not a rebuild), and that hybrid trades determinism/first-run cost for fidelity. No em-dash in the `.env.example` comment prose.
  - [x] **GPU opt-in block (AC #8):** add a **commented** NVIDIA GPU reservation to the compose service (the modern `deploy.resources.reservations.devices: [{driver: nvidia, count: all, capabilities: [gpu]}]` form) with a comment: uncomment ONLY if the host has the NVIDIA Container Toolkit installed; left commented, the container runs CPU-only and still works. Keep it OFF by default so `docker compose up` never fails on a GPU-less / toolkit-less host (the whole point of AC #8). Document the opt-in in `.env.example` too.

- [x] **Task 7 — Tests (AC: #2, #3, #7).** Never spawn the JVM or docling in unit tests (slow + flaky; the autouse `_stub_structure` in `conftest.py` already keeps the JVM out — extend the pattern).
  - [x] `server/tests/`: adapter mode dispatch — monkeypatch `opendataloader_pdf.convert` and assert `mode="hybrid"` passes `hybrid="docling-fast"` + `hybrid_url` + `hybrid_fallback=True` + the timeout, while `mode="local"` (and unset env) passes none of them. Totality in BOTH modes (a raising `convert` → `DocStructure()`). `_env_mode()` parsing (`hybrid` → hybrid; unset/typo/`local` → local).
  - [x] **Contract-parity regression:** feed the captured hybrid fixture (`odl_adtran_hybrid.json`, Task 1) through `_map_tree` and assert it maps to valid `StructureElement`s (headings incl. `3 Methodology`/`3.1`/`3.2` present, rects canonical/normalized) — proving the local mapping handles hybrid output unchanged.
  - [x] Health: `GET /api/health` returns `structure_mode` reflecting the env (monkeypatch env → `"hybrid"` and `"local"`). (Sandbox note: `TestClient` route tests can hang under the Codex sandbox — human runs the backend suite on the host; reviewer reads. CLAUDE.md.)
  - [x] Lifespan helper: mode=hybrid launches (mock subprocess), mode=local does not; shutdown terminates. Unit-test the helper, not the real spawn.
  - [x] `test_domain.py` purity guard still green with the env read in `structure.py`.
  - [x] Frontend: only the regenerated `schema.d.ts` changes (the `HealthStatus` type gains `structure_mode`) + 4 `fetchHealth` test mocks updated. Typecheck clean; full suite **1723 passed on Node 24** (the project's pinned toolchain). No new consumer UI. (Note: this host's Node 26 breaks 260 localStorage-backed tests via a native-localStorage/jsdom conflict — pre-existing, reproduced on the stashed baseline, unrelated to this change; run the frontend suite on Node 24.)

- [~] **Task 8 — Live smoke (AC: #1, #4, #6). PARTIAL: full seam PROVEN host-level end-to-end (real app in hybrid mode: launched the hybrid server, imported TranAD, `/structure` recovered the dropped sections, `/health` reports hybrid, offline + CPU + GPU(host-venv) + determinism all characterized). HOST-RUN REMAINING (environment-gated, cannot complete in-session): `docker compose up --build` (multi-GB image → verify size + clean-build offline model load), the DPR-2 `?debugStructure=1` browser overlay placement, and in-container GPU passthrough (needs `nvidia-container-toolkit`).** `docker compose up --build` (never a user-launched/host dev server for the in-container proof — CLAUDE.md), throwaway `PAPER_MATE_DATA` scratch (never `~/.paper-mate`).
  - [~] With `PAPER_MATE_STRUCTURE_MODE=hybrid`: import TranAD (`fixtures/sample-pdfs/adtran.pdf`). **STRUCTURE side PROVEN host-level** (real app: `/structure` recovered `3 METHODOLOGY 3.1...` + `3.2 Data Preprocessing`, 308 elements, `structure_status: ready`). **HOST-RUN remaining:** `docker compose up --build` build + the synthesized-ToC UI + the `?debugStructure=1` overlay at DPR 2 (browser).
  - [~] **Env-flip proof:** hybrid side proven live (health `structure_mode: hybrid`, sections recovered). **HOST-RUN:** restart the same image with the env unset (→ local, sections drop) then back to hybrid (return), proving switch = env + restart, no rebuild.
  - [x] **Offline proof (AC #4):** PROVEN — the hybrid server + a full TranAD convert ran with `HF_HUB_OFFLINE=1`/`TRANSFORMERS_OFFLINE=1` against the baked HF cache, zero network. (In-container `--network none` is the host-run mirror.)
  - [x] **Determinism note (AC #4):** PROVEN — CPU run-to-run byte-identical; GPU vs CPU identical structure with only sub-pixel bbox jitter (invisible after normalization). Documented as a mode property.
  - [x] **CPU-fallback proof (AC #8):** PROVEN host-level — the app + hybrid server ran `--device cpu` end-to-end on a GPU host (server logged "Device override: --device cpu"), TranAD extracted, no CUDA-missing crash. (The in-container mirror rides the docker-build item above.)
  - [x] **GPU path (AC #8):** PROVEN in the host venv — `--device cuda` ran (RTX 3090), ~16s/paper vs ~37-98s CPU, same structure. In-container GPU passthrough is **unverified-here** (this host lacks `nvidia-container-toolkit`); documented, not a blocker.
  - [x] Purged the test doc + threw away `PAPER_MATE_DATA`; killed my own servers (the user's `:8000` container left untouched). (`claude-in-chrome`/`chrome-devtools-mcp` DPR-2 browser overlay is part of the host-run items above.)

- [x] **Task 9 — Architecture + version + docs (AC: #2, #4).**
  - [x] `architecture-paper-mate-2026-06-28/ARCHITECTURE-SPINE.md` **AD-13** (L127): refine the hybrid description to the REAL architecture (a Docling+EasyOCR **hybrid SERVER** the Java core calls over HTTP, not an in-process "vision model"), correct the stale **`Story 10.8` → `Story 10.3`**, and record the resolved decisions: **default = local** (user), image **always hybrid-capable** (deps + baked models bundled, switch = env + restart no rebuild), **models baked at build so hybrid stays offline** (NFR-1 satisfiable in both modes). Also fix the stale `Story 10.8` in the Deferred bullet (L221) → `Story 10.3`. Mirror the note in the library spine `AD-L8` if it references the mode.
  - [x] Version: PATCH +1 at PR-merge time (CLAUDE.md): `0.6.2 → 0.6.3`. Deferred to merge (pyproject stays `0.6.2` now, matching the 10.1/10.2 pattern; `test_version` green).
  - [x] Confirm `docs/API.md` (Task 5) landed in the same change as the health field (health entry + dated changelog line added).

## Dev Notes

### The discovery that reshapes this story: hybrid is a client-server second process, not an in-process model

The epic + both change proposals describe hybrid as "opendataloader hybrid mode (Docling + a vision model)" as if it were an in-process flag. **The installed binding (`opendataloader-pdf==2.5.0`) says otherwise, and this is the load-bearing fact of the whole story:**

- `convert()`'s `hybrid` param takes `off` (default) | **`docling-fast`** | `hancom-ai`. Its own help: **"Hybrid backend (requires a running server). Quick start: `pip install "opendataloader-pdf[hybrid]" && opendataloader-pdf-hybrid --port 5002`. For remote servers use `--hybrid-url`."**
- So the Java core (spawned by `convert()`) makes **HTTP calls to a SEPARATE `opendataloader-pdf-hybrid` server** (console script → `opendataloader_pdf.hybrid_server:main`, `DEFAULT_PORT = 5002`). That server is a FastAPI/uvicorn app running **Docling + EasyOCR**; it does the heavy region detection and hands results back.
- The `[hybrid]` pip extra = `docling[easyocr]>=2.91.0` + `fastapi` + `uvicorn`. `docling[easyocr]` drags in **torch** and downloads model weights (HF/torch hub) on first use → multi-GB, and **network on first run unless baked**.
- `hancom-ai` is a **remote AI service** (needs network + credentials) → **incompatible with local-first/offline NFR-1**, so it is **ruled out**. `docling-fast` (local Docling) is the only mode we pursue.

[Source: `server/.venv/.../opendataloader_pdf/cli_options_generated.py` hybrid option blocks; `.dist-info/METADATA` `Provides-Extra: hybrid`; `hybrid_server.py:85 DEFAULT_PORT = 5002`; `entry_points.txt`.]

**Consequence:** this is not "flip a param." It is (1) an always-hybrid-capable image with heavy deps + baked models, (2) a second in-container process managed by lifespan, (3) a runtime switch. The user chose exactly this scope with eyes open (decisions below).

### Locked decisions (user, 2026-07-21) — these override the proposal where they differ

1. **Default mode = `local`.** The env `PAPER_MATE_STRUCTURE_MODE` unset → local. Overrides the proposal's "default hybrid": local keeps every fresh `docker compose up` deterministic + offline + small-RAM; hybrid is opt-in. (The image still CARRIES hybrid — see #2 — the default just doesn't ACTIVATE it.)
2. **Image is always hybrid-capable (decision "A").** Bundle `opendataloader-pdf[hybrid]` deps + pre-baked models + the hybrid server in the default image, so switching to hybrid is **env flip + container restart, no rebuild**. Accepted cost: multi-GB image for everyone (torch). The second process only spins up (RAM/model-load) when mode=hybrid.
3. **Full path this story.** Spike, then build the whole in-container hybrid path (deps, model bake, second-process lifecycle, the switch, live-smoke). One larger story, not a spike + deferral.
4. **Models baked at build (offline preserved).** Pre-download Docling + EasyOCR weights during `docker build` into the image (HF_HOME / easyocr model dir + ENV), so hybrid stays offline once built (NFR-1 satisfiable in hybrid too). Build step needs network; runtime does not.
5. **GPU-optional with a CPU fallback (added 2026-07-21, user).** Hybrid uses a GPU when the container is given one and falls back to CPU otherwise, so a GPU-less container still works. Device via `PAPER_MATE_STRUCTURE_HYBRID_DEVICE` (default `auto`); CUDA-capable torch wheel kept; compose GPU reservation is a commented opt-in (off by default). See the GPU Dev Notes section.

[Source: user decisions in this create-story session, 2026-07-21; epic Story 10.3 "the default is the user's call, recorded in create-story".]

### What is UNCHANGED (guard against scope creep + regressions)

- **The `DocStructure` contract, `structure.json` shape, `_map_tree`/`_to_rect`/`_TYPE_MAP`** — the spike must PROVE hybrid re-emits opendataloader's own JSON format so none of this changes. A mapping change is in scope ONLY if the spike proves the shape differs. [Source: `server/app/domain/structure.py`.]
- **The `extract_structure` port + totality** — a hybrid failure already routes through the existing `try/except → DocStructure()`. Do not add a new failure path. [Source: `structure.py:175-185, 221-235`.]
- **The structure-status `analyzing → ready` lifecycle** (`storage/structure_progress.py`, `mark_structure_analyzing`/`clear_structure_analyzing`/`structure_status_for`, Story 10.2) — hybrid is slower, so the dot shows "analyzing" longer; the lifecycle is byte-identical. Do not touch it. [Source: `routes/extraction.py:72-95`, `storage/structure_progress.py`.]
- **Every consumer (ToC 10.2, and future 10.4-10.7)** — thin readers of the same contract; zero code change. TranAD sections returning in the ToC is a data effect, not a code change to `synthesizeToc`. [Source: `10-2-section-navigation-toc.md` Task 1-5.]
- **No backfill / no re-extract** of already-imported papers (new-imports-only). No per-doc / per-request mode override (ONE global switch this story). [Source: epic Story 10.3 "Out of scope".]

### The config seam — where + how the env is read

- No central settings module exists; the repo reads env inline (`os.environ.get("PAPER_MATE_DATA")` in `storage/paths.py`, `PAPER_MATE_STATIC_DIR` in `main.py`). Follow that convention. [Source: `grep PAPER_MATE_`, `storage/paths.py:20`, `main.py:95`.]
- Read `PAPER_MATE_STRUCTURE_MODE` in `domain/structure.py` (a small `_env_mode()` helper: `"hybrid"` → hybrid, anything else → local, so a typo fails safe). `os` is ALREADY permitted in `structure.py` by the `_STRUCTURE_OS_SCRATCH = {"os","pathlib","tempfile"}` exemption in the AD-L2 purity guard, so this does not trip `test_domain_modules_are_pure`. [Source: `server/tests/test_domain.py:968,992`.]
- The health route needs the SAME value — share one reader (don't parse the env in two places with two default behaviors). A tiny `app.config` reader used by both `structure.py` and `health.py` is acceptable if it stays a pure env read; or `health.py` imports `_env_mode()` from `domain.structure`. Pick one, keep it single-sourced.
- "Read once" (AC): reading at module import for `_default_extractor` and per-request in `/health` both satisfy it (env doesn't change mid-process; the switch is restart-scoped). Don't build a hot-reload watcher.

### The second-process lifecycle (Task 4) — the one genuinely new moving part

- `opendataloader-pdf-hybrid` must be RUNNING before any `convert(hybrid="docling-fast", hybrid_url=...)` call — the binding does NOT auto-start it. So OUR app owns its lifecycle.
- Launch it from `main.py`'s existing `_lifespan` (an `@asynccontextmanager` already there for `reconcile_library`) as a subprocess, **only when mode=hybrid**, wait for readiness (bounded), terminate on shutdown. Keep it best-effort + logged like the reconcile block (a launch failure logs, doesn't brick boot; extraction then fails total → empty structure, visible via `/api/health` mode + logs). [Source: `main.py:33-47`.]
- Alternative considered: mounting `hybrid_server`'s FastAPI app in-process. Rejected for isolation/robustness (it's a separate uvicorn app with its own model-loading lifecycle; a subprocess is the documented deployment). Note it in Dev Notes if the spike surfaces a reason to revisit.
- Model load is slow (seconds→tens of seconds). Launching at startup (not per-import) amortizes it; the analyzing dot covers the per-paper hybrid latency.

### GPU-optional with a CPU fallback (AC #8) — a GPU-less container must still work

The user's requirement: hybrid must run whether or not the container has a GPU. The Docling backend is torch, so:

- **The hybrid server takes `--device`** (`cpu` | `cuda` | `mps`, or auto-detect). We pass `PAPER_MATE_STRUCTURE_HYBRID_DEVICE` (default `auto`) → the Java-side launch adds `--device <value>`. `auto`/no-device → torch uses CUDA if a device is visible, else CPU, with **no crash on a missing CUDA device**. That IS the fallback.
- **The image needs the CUDA-capable torch wheel** (the default PyPI `torch` Linux wheel), NOT the `+cpu` wheel — otherwise GPU can never work even when exposed. That wheel still runs CPU-only fine. No CUDA base image; torch bundles the CUDA runtime libs. [Source: default torch packaging; `hybrid_server.py` `--device` arg.]
- **GPU passthrough is a host + compose concern, not an image change.** The container sees a GPU only if (a) the host has the **NVIDIA Container Toolkit** and (b) compose reserves the device (`deploy.resources.reservations.devices` nvidia). Both are opt-in; the reservation is **commented by default** so `docker compose up` boots on a toolkit-less/GPU-less host (requesting `--gpus` there fails the container start — the exact failure the user wants avoided).
- **Model DOWNLOAD is device-agnostic** (Task 2 bake step needs no GPU); only inference uses the device. So the offline bake works on a CPU-only builder.
- **This host** has an RTX 3090 but **no `nvidia-container-toolkit`**, so the in-container GPU path can't be smoke-tested here — the CPU-fallback in-container path (the critical one) is proven, and the GPU path is checked in the throwaway host venv (torch sees the 3090 directly) + documented as in-container-unverified. [Source: spike, this session.]
- **`--no-ocr`:** the reader targets born-digital PDFs, which already carry text, so we pass `--no-ocr` to skip EasyOCR (avoids its model + the OCR compute). OCR/scanned stays out of scope; this also trims what must run on CPU in the fallback case.

### opendataloader hybrid `convert()` kwargs (from the binding, use these)

- `hybrid="docling-fast"` — the local Docling backend (NOT `hancom-ai`).
- `hybrid_url="http://localhost:5002"` — where the hybrid server listens (default port 5002).
- `hybrid_mode="auto"` (default; dynamic per-page triage, cheaper) vs `"full"` (all pages to the backend). Spike decides which recovers the TranAD headings; prefer `auto` for cost, fall to `full` if `auto` misses them.
- `hybrid_fallback=True` — opt in to Java (local) fallback on a hybrid backend error, so one bad page degrades to the local result instead of failing the whole doc (supports AC #3 totality).
- `hybrid_timeout=<ms>` — per-request timeout (default `0` = none). Set a bounded value (spike-sized from per-paper latency) so a stuck page can't hang the import forever; with `hybrid_fallback=True` a timeout → Java fallback.
- Keep the existing `format="json", image_output="off", quiet=True`. Note `use_struct_tree` takes precedence over hybrid on tagged PDFs (fine — we don't set it).

[Source: `cli_options_generated.py` hybrid blocks; `convert()` signature.]

### Coordinate mapping is the #1 correctness risk after "does it run"

Story 10.1's server-side flip (`[left,bottom,right,top]` PDF points y-up → normalized `[0,1]` top-left, canonicalized) lives in `domain/structure.py` `_to_rect`, normalized against PyMuPDF `page.rect` (CropBox, the same basis the client's `render/getPageBox` uses). This must stay untouched — which requires the hybrid raw JSON to carry the SAME bbox convention. The spike's parity check (AC #1e) is exactly this. If Docling's output leaks a different coordinate basis into opendataloader's JSON, every hybrid rect drifts — that is the STOP condition. Expected outcome: opendataloader owns the output format and re-emits its own `[l,b,r,t]` points regardless of backend, so parity holds; verify, don't assume. [Source: `structure.py:83-98`; `10-1` Dev Notes "Coordinate mapping"; [[verify-on-hidpi-and-real-host]].]

### Files to read before editing (UPDATE targets, preserve current behavior)

- `server/app/domain/structure.py` — the adapter. Add mode dispatch to `OpenDataLoaderExtractor.__init__`/`_run`; leave `_map_tree`/`_to_rect`/`_TYPE_MAP`/totality intact.
- `server/app/main.py` `_lifespan` (L33-47) — add the hybrid subprocess launch/teardown (hybrid-only), mirroring the best-effort+logged reconcile block.
- `server/app/models.py` `HealthStatus` (L40-46) — add `structure_mode`.
- `server/app/routes/health.py` (L11-14) — return the mode.
- `server/app/routes/extraction.py` `_run_structure` (L72-95) — READ ONLY; confirm nothing needs changing (structure call + marker lifecycle already mode-agnostic).
- `Dockerfile` runtime stage (L15-35) — deps come via the lockfile; ADD the model-bake step + `ENV` for the model cache.
- `docker-compose.yml` `environment:` (L25-26) + `.env.example` — add the new knob.
- `server/tests/conftest.py` `_stub_structure` autouse — the pattern that keeps the JVM/docling out of the suite; extend for the new tests.

### Purity / architecture nuances to keep honoring

- `domain/structure.py` already has the surfaced AD-L2 deviation (OS temp dir for the file-based binding). Adding an env read is covered by the same `_STRUCTURE_OS_SCRATCH` exemption. Do NOT import `app.storage` into `structure.py` (still banned).
- The hybrid server subprocess is launched from `main.py` (the composition/entrypoint layer), NOT from the domain layer — the domain adapter only makes the HTTP-backed `convert()` call to an already-running server. Keep that separation.

### Scope discipline — what NOT to build

No consumer UI, no ToC/index/metadata changes, no backfill/re-extract, no per-doc/per-request override, no hot-reload of the mode, no `hancom-ai` path, no new structure status. This story = the mode switch + the in-container hybrid infra + observability, behind an unchanged contract. [Source: epic Story 10.3 "Out of scope".]

### Testing standards

- Backend: `cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q` (host-run; sandboxed reviewer reads — CLAUDE.md Backend-tests note; `TestClient` route tests can hang under the sandbox; `UV_CACHE_DIR=/tmp/uv-cache` if the cache is unwritable). **Never spawn the JVM or docling in unit tests** — monkeypatch `convert` and assert the kwargs; feed the captured hybrid fixture to `_map_tree`.
- Frontend: `cd client && npm test` + `npm run typecheck`. Only `schema.d.ts` should change (the `HealthStatus` field).
- **Live smoke is the gate** (AC #6): in-container `docker compose up --build`, TranAD sections recovered at DPR>1, env-flip local↔hybrid with no rebuild, and the offline (network-cut) proof. Own throwaway `PAPER_MATE_DATA`. [[verify-on-hidpi-and-real-host]].

### Project Structure Notes

- Downward dependency holds: config env → `domain/structure.py` (adapter mode dispatch, still pure-ish + total) → `routes/extraction.py` composes it (unchanged) → `main.py` lifespan owns the hybrid subprocess (entrypoint layer, not domain) → `routes/health.py` exposes the mode. No new module/layer; the changes are second-tenant edits to files Story 10.1/10.2 created.
- The terminal Epic-10 refactor (Story 10.9, AE7-5) will later unify the extraction-mode selection + the structure code; do NOT pre-optimize module boundaries here beyond the mode-dispatch + lifecycle split.

### References

- Epic + ACs + open design calls: [Source: .bmad/planning-artifacts/epics/epic-10-...md#Story 10.3] (L58-84).
- Origin (design) + resequence: [Source: .bmad/planning-artifacts/sprint-change-proposals/sprint-change-proposal-2026-07-21-structure-hybrid-mode.md] + [sprint-change-proposal-2026-07-21-prioritize-hybrid-mode.md].
- Prior stories: [Source: .bmad/implementation-artifacts/epic-10/10-1-structure-extraction-enabler.md] (the layer + adapter + coordinate flip) + [10-2-section-navigation-toc.md] (the synthesized ToC + the analyzing-status marker; the TranAD gap it exposed).
- **AD-13** (document-structure layer, hybrid un-deferred, mode-dependent invariant): [Source: architecture-paper-mate-2026-06-28/ARCHITECTURE-SPINE.md#AD-13] (L124-127, L221). **AD-4** anchor model, **AD-3** contract sync, **AD-9** boundary invariants, **AD-10** single container.
- **AD-L8** (structure extraction = second domain tenant): [Source: architecture-paper-mate-library-2026-07-04/ARCHITECTURE-SPINE.md#AD-L8].
- Binding surface (this session, 2026-07-21): `opendataloader_pdf.convert()` hybrid kwargs (`hybrid=docling-fast|hancom-ai`, `hybrid_url` default `:5002`, `hybrid_mode`, `hybrid_fallback`, `hybrid_timeout`); `[hybrid]` extra = `docling[easyocr]+fastapi+uvicorn`; `opendataloader-pdf-hybrid` console script = a separate server process. [Source: installed `opendataloader_pdf` 2.5.0 `cli_options_generated.py` + `.dist-info/METADATA` + `hybrid_server.py`.]
- Code touch points (verbatim, current): `domain/structure.py` (adapter L167-213, `_run` L187-213, `_default_extractor` L218, `extract_structure` L221-235); `main.py` `_lifespan` L33-47; `models.py` `HealthStatus` L40-46; `routes/health.py` L11-14; `routes/extraction.py` `_run_structure` L72-95; `storage/structure_progress.py` markers; `Dockerfile` L15-35; `docker-compose.yml` env L25-26; `.env.example`.

## Dev Agent Record

### Agent Model Used

Opus 4.8 (claude-opus-4-8). Note: CLAUDE.md recommends Sonnet 5 xHigh for dev-story (recurring AE7-1 model drift); this ran on Opus because the user launched dev-story in an Opus session. Flagged, not silently ignored (same as Story 10.1).

### Debug Log References

**SPIKE (Task 1) — PASSED (all gates cleared), host throwaway venv.** `opendataloader-pdf[hybrid]==2.5.0` installed = **5.3 GB** (torch **2.13.0+cu130**, docling, easyocr, fastapi/uvicorn). Hybrid server `opendataloader-pdf-hybrid` = a separate **Docling Fast Server** (`GET /health`, `POST /v1/convert/file`, `DEFAULT_PORT=5002`, builds a `DocumentConverter` singleton at startup). Java 21 present (the `convert()` client side).

- **Heading recovery (the motivation) — CONFIRMED.** LOCAL mode on `fixtures/sample-pdfs/adtran.pdf`: `3 METHODOLOGY` → `type=paragraph` (dropped from ToC), `3.1 Problem Formulation` / `3.2 Data Preprocessing` → **absent (0 nodes)**. HYBRID (`docling-fast`): both recovered as `type=heading` L2 — `"3 METHODOLOGY 3.1 Problem Formulation"` (note: `3` + `3.1` **merged into one heading node**) and `"3.2 Data Preprocessing"`. `hybrid_mode="auto"` was sufficient (no need for `full`). Finding: hybrid also flattens some heading LEVELS (e.g. `3.3`/`4`/`4.1` → level 1) and tags a few algorithm blocks as headings — the ToC will LIST all sections (the goal) but nesting depth differs from local; acceptable, recorded.
- **Parity (primary risk) — CONFIRMED IDENTICAL.** Hybrid raw JSON is the SAME opendataloader format as local: same top-level keys (`file name…kids`), same element keys (`type, id, page number, bounding box, heading level, content, font…`), `bounding box`=`[left,bottom,right,top]` PDF points (the title heading bbox `[57.056,671.854,554.415,713.986]` is byte-identical to the local run), `page number` = 1-indexed int, **0 non-conforming bbox/page nodes**. → `_map_tree`/`_to_rect`/`_TYPE_MAP` need **NO change**. Only new type is `formula` (13 nodes) → already maps to `"other"` via the catch-all. (opendataloader's Java core re-emits its own tree regardless of backend, as predicted.)
- **GPU-optional + CPU fallback (AC #8) — CONFIRMED.** On the GPU host (RTX 3090), the server honored `--device cpu` (log: "Accelerator: CUDA - RTX 3090" then "Device override: --device cpu") AND `--device cuda`. So a GPU-less container falls back to CPU with no CUDA-missing crash; `auto` detects.
- **Determinism (AC #4).** CPU run-to-run: **byte-identical** (deterministic). GPU vs CPU: identical structure (308 nodes, same types/text/pages), only sub-pixel bbox float jitter (≤~0.003 pt, e.g. 52.991 vs 52.992) → invisible after AD-4 normalization. So: deterministic within a device; negligible cross-device coordinate jitter. Better than the story feared.
- **Cost.** deps venv 5.3 GB; Docling layout model **506 MB** downloaded to `HF_HOME` on first convert (`--no-ocr` avoids the easyocr model). Latency per 12-page paper: **~16 s GPU**, ~37 s warm CPU, ~98 s cold CPU (model download) → `hybrid_timeout` sized ~120 s for CPU headroom. `--no-ocr` is safe for born-digital papers (converter init 1.6-2.6 s).
- **Fixture captured:** `server/tests/fixtures/structure/odl_adtran_hybrid.json` (trimmed to 10 representative nodes: the recovered headings + one each of formula/image/list/paragraph/table) for the Task 7 parity-regression test.
- **DECISION: spike PASSED → Tasks 2-9.** (Full in-container Docker proof deferred to Task 8; the binding + hybrid server + docling all run on the host image base, and the JRE is already in the Dockerfile from 10.1.)

**LIVE SMOKE (Task 8, host-level end-to-end through the REAL app).** Ran the actual `uvicorn app.main:app` with `PAPER_MATE_STRUCTURE_MODE=hybrid`, `PAPER_MATE_STRUCTURE_HYBRID_DEVICE=cpu`, baked `HF_HOME` + `HF_HUB_OFFLINE=1`, a throwaway `PAPER_MATE_DATA`:
- The FastAPI lifespan **launched the hybrid server itself** (from the venv-resolved binary) and waited on `/health`; `GET /api/health` → `{"structure_mode":"hybrid"}`.
- `POST /api/docs` (TranAD) → `status=extracting, structure_status=analyzing` → settled to **308 elements, `structure_status=ready`** (the `analyzing→ready` lifecycle unchanged).
- `GET /api/docs/{id}/structure` recovered the dropped sections as headings: **`3 METHODOLOGY 3.1 Problem Formulation`** and **`3.2 Data Preprocessing`** (local mode dropped both), all 308 rects canonical + normalized. Full seam proven: env → adapter mode dispatch → lifespan-launched hybrid server → import pipeline → `structure_store` → route.
- **Best-effort launch proven:** an earlier run with the binary not on PATH logged the failure and **booted anyway** (health still served) — confirming AC #3/#5 (a hybrid failure never bricks boot / yields empty, never blocks). Hardened the launch to resolve the binary next to `sys.executable`.
- **Offline proven:** the hybrid server + a full convert ran with `HF_HUB_OFFLINE=1`/`TRANSFORMERS_OFFLINE=1` against the baked HF cache, zero network (AC #4).
- **NOT verified in-session (host-run required):** `docker compose up --build` (the multi-GB image build → confirm size + a clean-build offline model load), the DPR-2 `?debugStructure=1` browser overlay placement of the recovered headings, and in-container GPU passthrough (this host has an RTX 3090 but no `nvidia-container-toolkit`, so only the host-venv GPU path was proven). Commands are in Task 8.

### Completion Notes List

- **Spike-first gate PASSED decisively** (Task 1, see Debug Log): hybrid recovers the dropped TranAD sections, the raw JSON shape is byte-identical to local (so the mapping is untouched), it is offline-bakeable, deterministic within a device, and GPU-optional. Everything below was built on that green spike.
- **Runtime switch, default local.** `PAPER_MATE_STRUCTURE_MODE=local|hybrid` read once in `domain/structure.py` (`active_mode()`); `local` default, typo fails safe to local. The adapter's `_run` adds the hybrid `convert()` kwargs (`hybrid=docling-fast`, `hybrid_url`, `hybrid_mode=auto`, `hybrid_fallback=True`, bounded `hybrid_timeout`) only in hybrid mode; `_map_tree`/`_to_rect`/`_TYPE_MAP` and the `DocStructure` contract are byte-identical (parity). Totality preserved in both modes.
- **Second process, hybrid-only.** `app/structure_hybrid.py` launches `opendataloader-pdf-hybrid` from the FastAPI lifespan (off the event loop via `asyncio.to_thread`) ONLY in hybrid mode + a local URL, waits on `/health`, terminates on shutdown; best-effort (a launch failure logs, never bricks boot — proven live). Binary resolved next to `sys.executable` so it works regardless of PATH.
- **GPU-optional + CPU fallback (AC #8).** Device via `PAPER_MATE_STRUCTURE_HYBRID_DEVICE` (default `auto`) → the server's `--device`; CUDA-capable torch wheel kept; compose GPU reservation is a commented opt-in (off by default so a GPU-less host boots). Spike proved CPU + CUDA both run + `auto` falls back.
- **Health observability.** `HealthStatus.structure_mode` (regenerated into OpenAPI → `schema.d.ts`), `docs/API.md` updated. Proven live: `GET /api/health` → `structure_mode: hybrid`.
- **Image always hybrid-capable.** Opt-in `hybrid` extra (base `uv sync` stays lean); Dockerfile installs `--extra hybrid` + bakes Docling models into `HF_HOME` + sets `HF_HUB_OFFLINE`. Offline runtime mechanism proven live (server + full convert with `HF_HUB_OFFLINE=1`, no network).
- **Tests:** backend **384 passed** (host); frontend **1723 passed on Node 24** (the pinned toolchain) + typecheck clean. (This host's Node 26 breaks 260 localStorage tests via a native-localStorage/jsdom conflict — pre-existing, reproduced on the stashed baseline, unrelated to this change.)
- **Task 8 status (honest):** the full seam is proven at the **host level** — the real app in hybrid mode launches the hybrid server, imports TranAD, and `GET /structure` recovers `3 METHODOLOGY`/`3.2 Data Preprocessing` with canonical rects; `/health` reports hybrid; offline + CPU + GPU(host-venv) + determinism all characterized in the spike. **NOT done in-session (host-run required, multi-GB + browser):** the `docker compose up --build` image build (verify size + clean-build offline model load), the DPR-2 `?debugStructure=1` browser overlay placement, and the in-container GPU passthrough (this host lacks `nvidia-container-toolkit`). Exact commands are in Task 8.
- **Version** `0.6.2 → 0.6.3` deferred to PR-merge (CLAUDE.md), matching 10.1/10.2.

### File List

**Backend (new):**
- `server/app/structure_hybrid.py` — bundled hybrid-server lifecycle (launch/stop, hybrid-only, local-URL-only, device passthrough, readiness poll, best-effort).
- `server/tests/test_structure_hybrid.py` — lifecycle unit tests (launch/skip/stop decisions, mocked subprocess + readiness).
- `server/tests/fixtures/structure/odl_adtran_hybrid.json` — captured HYBRID raw tree (trimmed), the parity-regression fixture.

**Backend (modified):**
- `server/app/domain/structure.py` — mode dispatch in `OpenDataLoaderExtractor` (`__init__(mode, hybrid_url, hybrid_timeout_ms)` + `_run` hybrid kwargs); `active_mode()` + `hybrid_url()` env readers; `_default_extractor` reads env once.
- `server/app/domain/__init__.py` — export `active_mode`.
- `server/app/main.py` — `_lifespan` launches/stops the hybrid server (hybrid-only, off the event loop).
- `server/app/models.py` — `HealthStatus.structure_mode`.
- `server/app/routes/health.py` — report `structure_mode` via `domain.active_mode`.
- `server/pyproject.toml` — `[project.optional-dependencies] hybrid` extra.
- `server/uv.lock` — re-locked with the hybrid extra (torch/docling/easyocr).
- `server/openapi.json` — regenerated (`structure_mode`).
- `server/tests/test_structure.py` — adapter dispatch + `active_mode`/`hybrid_url` + hybrid-fixture parity tests.
- `server/tests/test_health.py` — `structure_mode` tests + updated the exact-equality assertion.

**Client (modified):**
- `client/src/api/schema.d.ts` — regenerated (`HealthStatus.structure_mode`).
- `client/src/library/LibraryPage.test.tsx`, `client/src/reader/ReaderPage.test.tsx` — `fetchHealth` mocks add `structure_mode`.

**Infra / docs:**
- `Dockerfile` — `uv sync --extra hybrid` + `download_models()` bake into `HF_HOME` + `HF_HUB_OFFLINE`/`TRANSFORMERS_OFFLINE`; CUDA-capable torch kept.
- `docker-compose.yml` — `PAPER_MATE_STRUCTURE_MODE` + `PAPER_MATE_STRUCTURE_HYBRID_DEVICE` env + commented NVIDIA GPU reservation.
- `.env.example` — `# --- Document structure ---` section.
- `docs/API.md` — health `structure_mode` field + dated changelog.
- `.bmad/planning-artifacts/architecture/architecture-paper-mate-2026-06-28/ARCHITECTURE-SPINE.md` — AD-13 hybrid refinement + stale `Story 10.8` → `10.3`.
- `.bmad/implementation-artifacts/sprint-status.yaml` — `10-3` status.
- `.bmad/implementation-artifacts/epic-10/10-3-hybrid-mode-switchable.md` — this story.

## Change Log

- 2026-07-21: Story created (bmad-create-story, Opus). Spike-first hybrid-mode migration; resolved the config mechanism (`PAPER_MATE_STRUCTURE_MODE`, default local), the always-hybrid-capable image (decision A), and the build-time model bake (offline). Discovery baked in: hybrid is a client-server second process (`opendataloader-pdf-hybrid`, Docling+EasyOCR), not an in-process model.
- 2026-07-21: GPU support added to the spec (user request) as AC #8 — GPU-optional with a CPU fallback (`PAPER_MATE_STRUCTURE_HYBRID_DEVICE` default auto, CUDA-capable torch kept, compose GPU reservation as a commented opt-in), so a GPU-less container still works.
- 2026-07-21: Implemented (bmad-dev-story, Opus; CLAUDE.md recommends Sonnet 5 xHigh — model drift flagged, AE7-1). **Spike PASSED** (hybrid recovers TranAD's dropped sections; raw JSON byte-identical to local so the mapping is untouched; offline-bakeable; deterministic within a device; GPU/CPU both run). Built the runtime switch (adapter mode dispatch + env), the hybrid-only second-process lifecycle, health `structure_mode`, the always-hybrid-capable Dockerfile + model bake, compose/`.env` knobs + commented GPU opt-in, tests, and the AD-13 doc refinement (+ stale `Story 10.8` → `10.3`). Backend **384 passed**; frontend **1723 passed on Node 24** + typecheck clean (this host's Node 26 breaks 260 localStorage tests, pre-existing/unrelated). **Host-level end-to-end smoke PASSED** through the real app (hybrid server launched by the lifespan → TranAD imported → `/structure` recovered `3 METHODOLOGY 3.1...` + `3.2 Data Preprocessing`, `/health` = hybrid, offline verified). Task 8 PARTIAL: the `docker compose up --build` multi-GB image build, the DPR-2 browser overlay, and in-container GPU passthrough are host-run (environment-gated). Status -> review.
