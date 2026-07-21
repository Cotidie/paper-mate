# Runtime toggle for structure extraction mode (local / hybrid)

Date: 2026-07-22
Status: design approved, not implemented
Related: Story 10.3 (`.bmad/implementation-artifacts/epic-10/10-3-hybrid-mode-switchable.md`), AD-13, AD-L8

## Problem

Story 10.3 shipped hybrid structure extraction (Docling backend via the
opendataloader hybrid server) as an **env + container restart** switch:
`PAPER_MATE_STRUCTURE_MODE` is read once at module import
(`server/app/domain/structure.py`), and the hybrid server subprocess is launched
from FastAPI's `_lifespan` only when that value is `hybrid`. AC #7 of that story
explicitly says "No new UI is required", and its Dev Notes say "Don't build a
hot-reload watcher".

Consequence: a reader who wants the higher-fidelity structure for one paper has
to edit `.env` and restart the container. The mode is observable
(`GET /api/health.structure_mode`) but not controllable from the app, and the
client currently reads that field only in test mocks.

## Goal

A toggle at the bottom of the Library page's left folder panel that switches
structure extraction between `local` and `hybrid` at runtime, with no restart.

## Decisions

These were settled during brainstorming and are binding for the implementation.

1. **Scope: future imports only.** Flipping the mode affects papers imported
   after the flip. Already-persisted `structure.json` files are untouched and no
   re-extraction is triggered. (Re-extract of existing papers is a separate,
   larger feature: it needs a job, the `analyzing → ready` progress lifecycle
   re-driven, and 30-100s per paper on CPU. Out of scope.)
2. **Persistence: `/data`.** The chosen mode is persisted under the data root.
   On boot: the persisted setting wins if present, else
   `PAPER_MATE_STRUCTURE_MODE`, else `local`. The env var keeps working as the
   initial default for a fresh data dir, so the Story 10.3 compose/`.env`
   workflow is not broken.
3. **Process lifecycle: eager.** Flipping to hybrid spawns the hybrid server and
   waits for readiness; flipping to local terminates it, so local keeps paying no
   RAM/model-load cost (Story 10.3 AC #5 preserved). A launch or readiness
   failure reverts the mode to local and surfaces an error.
4. **In-flight flip: drain, do not kill.** Each extraction snapshots the mode at
   start. A refcount keeps the hybrid server alive until in-flight hybrid
   extractions finish; the stop completes when the count reaches zero.
5. **UI: a pinned footer row** in the folder panel, hairline-separated, always
   visible, label plus switch plus a status line.

## Architecture

### Invariant change

Story 10.3's invariant was "resolve the mode ONCE at import so the extractor, the
health route, and the hybrid-server lifecycle can never disagree". That invariant
is replaced, not discarded:

> **One service owns the mode. Every consumer asks it. Nothing reads the env
> except that service's boot resolution.**

### Server

**New: `server/app/structure_mode.py`** (entrypoint layer, beside the existing
`structure_hybrid.py`; it owns a process, so it does not belong in `domain/`).
All mutable state lives here behind a `threading.Lock`:

- state: `current: "local" | "hybrid"`, `transition: "idle" | "starting" |
  "stopping"`, `last_error: str | None`, the hybrid `Popen | None`, and an
  in-flight hybrid extraction refcount.
- `resolve_boot_mode() -> StructureMode` — persisted setting, else env, else
  `local`.
- `request_mode(target)` — idempotent. To hybrid: spawn + bounded readiness poll.
  To local: mark `stopping`, terminate once the refcount drains. Persists the new
  value on success.
- `extraction_mode()` — context manager yielding the snapshotted mode; increments
  the refcount for hybrid and, on exit, completes a pending stop when it reaches
  zero.

**Changed: `server/app/structure_hybrid.py`** — `start_hybrid_server` /
`stop_hybrid_server` take the mode and URL as arguments instead of reading
`domain.structure.active_mode()` / `hybrid_url()`, so they are callable both from
`_lifespan` (boot) and from `request_mode` (runtime flip).

**Changed: `server/app/domain/structure.py`** — drop the import-time
`_ACTIVE_MODE` / `_HYBRID_URL` / `_default_extractor` globals and the
`active_mode()` / `hybrid_url()` accessors. `extract_structure(pdf_bytes, mode,
hybrid_url)` takes the mode as an argument; the domain layer keeps no process
state and stays pure. Env parsing moves to `structure_mode.py`'s boot
resolution.

**Changed: `server/app/routes/extraction.py`** (the composition root) —

```python
with structure_mode.extraction_mode() as mode:
    structure = domain.extract_structure(pdf_bytes, mode=mode)
```

**Changed: `server/app/main.py` `_lifespan`** — resolve the boot mode via
`structure_mode`, spawn the hybrid server only if that resolves to `hybrid`, and
terminate on shutdown. Still best-effort + logged; a launch failure never bricks
boot.

**New: `server/app/storage/settings_store.py`** — reads/writes a
`settings.json` under the data root through the existing `storage/atomic.py`
writer, with a single `structure_mode` key today. A missing or corrupt file
resolves to "no setting" (fall through to env) rather than raising.

### API

The spawn takes seconds to minutes (model load), so the mutation does not block
on readiness. This mirrors the existing structure-status polling pattern.

- `PUT /api/settings/structure-mode`, body `{ "mode": "local" | "hybrid" }` —
  returns the state immediately with `transition: "starting"` (or `"stopping"`)
  and runs the transition as a background task.
- `GET /api/settings/structure-mode` — returns
  `{ mode, transition, error }`. The client polls this while `transition` is not
  `idle`.
- `GET /api/health.structure_mode` — unchanged shape, but now reports the live
  runtime mode from `structure_mode` instead of the env.

Contract regenerated in the same change (`cd server && PYTHONPATH= uv run python
-m app.export_openapi`, then `cd client && npm run gen:api`). `docs/API.md` gets
the new resource entry plus a dated changelog line, per CLAUDE.md.

### Client

- `client/src/api/client.ts`: `fetchStructureMode()` and
  `setStructureMode(mode)`, typed from the regenerated `schema.d.ts` (never
  hand-authored).
- `client/src/library/useStructureMode.ts`: fetch on mount, mutate, poll while
  `transition !== "idle"`, stop polling once settled or on error.
- `client/src/library/StructureModeToggle.tsx`: label `Structure`, a switch, and
  a status line reading `Local` / `Starting hybrid...` / `Hybrid` /
  `Hybrid failed`. The switch is disabled while a transition is in flight.
- `client/src/library/FolderPanel/FolderPanel.tsx` + `.css`: a
  `.folder-panel__footer` pinned to the panel bottom with a hairline
  `border-top`, holding the toggle. The folder list above it scrolls
  independently.

Layout:

```
┌ Folders ──────────────┐
│ ▸ All Papers      124 │
│ ▸ Inbox            12 │
│ ▸ Anomaly Det.     31 │
│                       │
│         ...           │
├───────────────────────┤  <- hairline
│ Structure    ( ●──)   │  <- footer
│ Hybrid                │
└───────────────────────┘
```

Copy rules: tokens only (no raw hex/px outside `src/theme/**`, enforced by
`src/no-raw-values.test.ts`), and no em-dash in any user-facing string. Tooltip
text: `Hybrid: higher fidelity, slower imports. Applies to papers imported after
the switch.`

## Error handling

- **Spawn or readiness failure on flip to hybrid:** mode reverts to `local`,
  `last_error` is set, `transition` returns to `idle`. The footer shows
  `Hybrid failed` with the reason in the tooltip and the switch back to off.
- **Hybrid server dies while mode is hybrid:** unchanged from Story 10.3 -
  extraction fails total and yields an empty `DocStructure`; the import still
  settles, the row never sticks.
- **Corrupt or unreadable settings file:** treated as unset; boot falls through
  to the env default. Logged, never fatal.
- **Concurrent flips:** serialized by the lock; a flip requested while a
  transition is in flight is rejected with `409` and the `{ "detail": string }`
  envelope (AR-11). The UI disables the control during a transition anyway, so
  this is a race guard, not a normal path.

## Testing

Backend (`cd server && PYTHONPATH= PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q`):

- `settings_store` round-trip, missing file, corrupt file.
- boot resolution precedence: persisted > env > `local`.
- `request_mode` with a mocked subprocess: local→hybrid spawns and settles;
  hybrid→local terminates; readiness timeout reverts to local with an error;
  idempotent same-mode call is a no-op.
- refcount: a stop requested during an in-flight hybrid extraction defers the
  terminate until the context manager exits.
- routes: `GET`/`PUT` shapes, invalid mode → 422 string envelope,
  `GET /api/health` reflects a runtime flip.

Frontend (`cd client && npm test`):

- toggle renders both modes from the fetched state.
- flipping calls `setStructureMode` and shows the transitional state.
- polling stops once settled.
- error state renders and the switch returns to off.
- switch is disabled during a transition.

## Out of scope

- Re-extracting already-imported papers after a flip.
- A generic settings page or any second setting; `settings.json` gains exactly
  one key.
- Exposing the hybrid device (`PAPER_MATE_STRUCTURE_HYBRID_DEVICE`) or the hybrid
  URL in the UI; both stay env-only.
- Surfacing the mode anywhere other than the folder-panel footer.

## Process notes

This is Epic 10 follow-on work and is **not** part of Story 10.3 (currently
`review`, with one live-smoke item outstanding: the DPR-2 `?debugStructure=1`
overlay check). The `10-4` slot is already taken by
`10-4-figures-tables-index`, so this needs a new story number allocated in
`.bmad/implementation-artifacts/sprint-status.yaml` rather than reusing one.

Live smoke must follow the CLAUDE.md rule: launch fresh dev servers bound to this
working tree, never reuse a running one. The hybrid path additionally needs an
in-container run (`docker compose up --build`), since the hybrid server and baked
models only exist in the image.
