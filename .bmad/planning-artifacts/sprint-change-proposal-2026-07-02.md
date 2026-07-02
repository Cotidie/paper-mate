# Sprint Change Proposal — Address open sprint action items (2026-07-02)

**Trigger:** `bmad-correct-course` invoked to address the open/in-progress action
items in `.bmad/implementation-artifacts/sprint-status.yaml` after the Epic-3
retrospective. **Mode:** incremental. **Scope classification:** Minor (direct
implementation) for the three closed items; Moderate (backlog change → new story)
for the doc-scope-store refactor.

## 1. Issue summary

The Epic-3 retro appended action items AE3-1..AE3-7 and left several Epic-2 items
(AE-4..AE-7) open. Duplication existed: **AE-4 ≡ AE3-3** (doc-scope the store),
**AE-7 ≡ AE3-4** (Codex-sandbox backend-pytest), **AE-5 ⊇ AE3-5** (DPR>1 smoke
backfill). This pass triages every open/in-progress item to a decision.

## 2. Impact analysis

- **Epics:** No epic scope change. One story added to Epic 5 (in-progress):
  `5-6-doc-scope-store` (backlog).
- **Stories:** None modified. New backlog entry only.
- **Artifacts:** `CLAUDE.md` (conventions + sandbox note), `sprint-status.yaml`
  (statuses + story), one new test file. No PRD/architecture/UX/contract change.
- **Contract:** none (`server/openapi.json` + generated TS untouched).

## 3. Recommended approach — Direct Adjustment (+ one backlog add)

Address the small/doc items directly now; route the subtle async refactor to its
own story. Rationale: version-guard + doc changes are low-risk and self-contained;
the store refactor carries a real async-race (the Story 3.4 HIGH-finding
`generationRef` guard) and needs a doc-switch DPR>1 live smoke, which is
`bmad-dev-story` + cross-model-review territory, not a grooming-pass hand-edit.

## 4. Detailed change proposals (applied)

| Item | Decision | Change |
| --- | --- | --- |
| **AE3-6** version-match guard | done | `server/tests/test_version.py` asserts `pyproject.toml [project].version` == `uv.lock` `paper-mate-server` version. Runs in the backend suite (no CI/pre-commit framework exists in-repo). Verified: 1 passed. |
| **AE-7 / AE3-4** sandbox backend-pytest | done | Documented in `CLAUDE.md`: Backend-tests bullet gains a Sandbox note (`UV_CACHE_DIR=/tmp/uv-cache`, `TestClient` hang, run-it-yourself); Auto-code-review bullet notes the sandboxed reviewer does not run backend pytest. Took the item's documented-fallback branch; a real root-cause fix stays open only if the hang later blocks host runs. |
| **AE-6** cross-model review | done | Already codified (Auto code-review after dev-story). Marked done. |
| **AE3-1** sprint-status at PR-merge | done | New CLAUDE.md BMad-workflow convention. |
| **AE3-2** Dev Agent Record before done | done | New CLAUDE.md BMad-workflow convention. |
| **AE-4 / AE3-3** doc-scope the store | in-progress | Routed to new Epic-5 story `5-6-doc-scope-store` (backlog): store owns `(docId, annotations)` atomically, autosave binds to `store.docId`, the `useAutosave` `generationRef` cross-doc guard retires. Run `bmad-create-story` next. |
| **AE-5** DPR>1 smoke (in-progress) | unchanged | Not in this session's scope. |
| **AE3-5** backfill 2.11/3.3 smoke | open | Not in this session's scope. |
| **AE3-7** Story 3.8 investigation | open | Open by design (no deadline). |

## 5. Implementation handoff

- **Done this session (Developer, direct):** test file + CLAUDE.md + sprint-status
  edits on branch `chore-address-sprint-action-items`.
- **Next (fresh context):** `bmad-create-story` for `5-6-doc-scope-store`, then
  `bmad-dev-story` (Sonnet 5 xHigh) + Codex `bmad-code-review` + a doc-switch
  DPR>1 live smoke before it reaches done.
