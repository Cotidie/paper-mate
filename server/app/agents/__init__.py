"""Reserved Phase-3 agent boundary (NOT built).

The dockerized backend cannot exec host agent CLIs (Claude/Codex/Antigravity);
the execution mechanism is deferred to Phase 3 (host bridge / mounted docker
socket / agents-in-image / sidecar). This package only reserves the seam — the
agent abstraction must not assume same-process exec. Build nothing here in v1.
"""
