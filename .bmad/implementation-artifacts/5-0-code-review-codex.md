# Story 5.0 Cross-Model Code Review

## Verdict

Changes Requested

## Findings

| Severity | File:line | Problem | Concrete fix |
| --- | --- | --- | --- |
| Med | `server/pyproject.toml:3` | The story bumps the package version to `0.2.1`, but the branch does not include the matching generated lockfile update. In `HEAD`, `server/uv.lock:184` still records `paper-mate-server` as `0.1.10`; the current worktree already has the required one-line change to `0.2.1`, proving the branch artifact is stale. This leaves locked/server environment metadata inconsistent with the committed project version. | Include the generated `server/uv.lock` change in the story commit, or rerun the server lock update from `server/` and commit the resulting lockfile. |

## Acceptance-Criteria Audit

| AC | Status | Evidence |
| --- | --- | --- |
| AC-1: Per-kind/per-tool dispatch replaces conditional sprawl | Met under approved scope | `client/src/annotations/marks.ts` adds `MARK_DESCRIPTORS` and `quickBoxSpec`; selection quick-box rows and labels consume it via `client/src/annotations/gestures/useSelection.ts:224`. Store mutation twins are consolidated through `patchAnnotations` at `client/src/store/index.ts:139`. `AnnotationLayer` preamble duplication is consolidated with `markState`/`markClass` at `client/src/annotations/AnnotationLayer.ts:149` and `:60`. The deliberately retained layer group filters and heterogeneous create builders match the stated scope decisions. |
| AC-2: Loose shapes become typed data contracts | Met under approved scope | `client/src/annotations/create.ts:31` defines `CreateBase`, `TextCreateRequest`, `PenCreateRequest`, and `RectPlacement`; builders still return the generated `Annotation` type. `AnnotationInteraction` uses one internal `defaultsRef` at `client/src/annotations/AnnotationInteraction.tsx:112`; public store/App/ToolRail `active*` API is unchanged per the explicit decision. |
| AC-3: Fragmented interaction state consolidates | Met under approved scope | The literal async reducer was intentionally rejected. The extracted hooks own synchronous refs and document handlers: `usePenGesture` (`client/src/annotations/gestures/usePenGesture.ts:18`), `useBoxGesture` (`client/src/annotations/gestures/useBoxGesture.ts:27`), `useMemoPlacement` (`client/src/annotations/gestures/useMemoPlacement.ts:15`), and `useSelection` (`client/src/annotations/gestures/useSelection.ts:44`). The synchronous-read semantics are preserved through refs passed in `GestureContext` (`client/src/annotations/gestures/shared.ts:22`). |
| AC-4: Oversized modules split cleanly | Met | `AnnotationInteraction.tsx` now composes extracted gesture/selection hooks at `client/src/annotations/AnnotationInteraction.tsx:148`; `MemoBox` and `CommentBubble` are split into `client/src/annotations/MemoBox.tsx` and `client/src/annotations/CommentBubble.tsx`. AD-9 check found no imports from `anchor/`, `api/`, or `render/` upward into `annotations/`. No `render/` exports moved. |

## Behavior And Contract Neutrality

The behavior-neutral and API-contract-neutral bar mostly held. I found no behavior regression in the reviewed annotation interaction, selection, store mutation, descriptor, or layer-render paths.

Contract guard: `git diff --stat -- server/openapi.json client/src/api/schema.d.ts` is empty, and neither file appears in `git diff b45880f..HEAD`.

Test guard: no existing test file changed; only `client/src/annotations/marks.test.ts` was added. Verified `cd client && npm run typecheck` passed, and targeted annotation/store tests passed: 4 files, 151 tests.

Remaining blocker is release-artifact consistency: commit the matching `server/uv.lock` version update.
