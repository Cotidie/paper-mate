# Story 4.2 Cross-Model Code Review

Ran via `codex exec --sandbox read-only` (Codex 0.142.4, gpt-5.5) against the working-tree diff (`8f8a22e8ab2f048ebae000689e6d0c7ce9eef820`..working-tree, uncommitted).

## Verdict

Approved with low-risk findings. Part A is contract-neutral and correctly scoped to `mergeRects`. Part B is deferred per the story's pre-authorized design gate and should not be treated as missing implementation.

## Findings

| Severity | Finding | Evidence | Recommendation |
| --- | --- | --- | --- |
| Low | Threshold boundary is ambiguous | `client/src/anchor/index.ts:243` says "at or above" this fraction is a gutter, but the merge condition (`gap <= GUTTER_GAP_FRACTION`) merges AT the exact threshold value, contradicting "at or above is gutter." | Align comment/code and add an exact-boundary test. |
| Low | One-pass clustering may miss transitive coalescing | `mergeRects` expands one compatible row but does not re-check whether it now connects to another existing row after expansion. | Add a regression test if pdf.js can emit that ordering; coalesce rows after expansion if needed. |
| Low | Working tree/file-list hygiene mismatch | `git status` shows the untracked story file; File List omits it and `sprint-status.yaml`. | Dismissed by reviewer (Claude): matches project convention — Story 4.1's File List likewise excludes the story file itself and `sprint-status.yaml` (bookkeeping, not implementation files). |

Dismissed: Part B incompleteness and sprint `review` status concerns, because the story's scope note explicitly defines Part B as deferred and Story 4.2 as review-ready for Part A.

## Acceptance-Criteria Audit

| AC | Status | Audit |
| --- | --- | --- |
| AC 1 | Pass with caveat | Gutter split implemented behind `Rect[]`; tests cover split, normal spacing, ordering trap, stable order. Boundary semantics needed cleanup (addressed post-review). |
| AC 2/3/4-B | Deferred | Properly deferred per design gate; not a review failure. |
| AC 4-A | Claimed complete | Dev record documents DPR=2 live smoke; Codex could not rerun live smoke in its read-only sandbox (no browser access). |
| AC 5 | Partially verified | `npm test`/`npm run typecheck` blocked by read-only sandbox writes (EROFS on `.vite-temp`/`.tsbuildinfo`); equivalent non-incremental `npx tsc --noEmit` passed. Claude separately ran the real suites (630/630, typecheck clean) before requesting this review. |

## Verification

- `npm test -- --run`: blocked in Codex's sandbox by EROFS writing `client/node_modules/.vite-temp`.
- `npm run typecheck`: blocked by `.tsbuildinfo` writes; equivalent passed: `npx tsc -p tsconfig.app.json --noEmit --incremental false && npx tsc -p tsconfig.node.json --noEmit --incremental false`.
- No backend/Python files touched this story; the AE-7 sandbox-pytest caveat does not apply.

## Behavior/Contract Neutrality

No backend/API/OpenAPI impact. `Rect[]` shape is unchanged. `rectsFromSelection` still groups by page before `mergeRects`. No `render/` export or mock-barrel update needed.

## Post-review resolution

- [x] LOW (threshold ambiguity) — fixed: comment reworded to match the `<=` merge condition exactly, near-boundary unit test added (an exact-bit-boundary test proved floating-point-fragile and was simplified).
- [ ] LOW (transitive coalescing) — deferred as a known, undemonstrated theoretical edge case; not fixed (see story Dev Agent Record for rationale).

## Post-review addendum: real-world bug found after this review ran (2026-07-02)

The user reported a live bug on a real two-column PDF (Microsoft COCO paper, arXiv:1405.0312) AFTER this Codex review completed. Investigation found the `GUTTER_GAP_FRACTION = 0.03` threshold this review examined (page-width fraction) was too coarse: this real document's actual gutter measured only ~2% of page width, below the 3% threshold, so the bug this review's own `mergeRects` change was meant to fix still reproduced on that document. Fixed by switching to a row-height-relative threshold (`GUTTER_GAP_HEIGHT_MULTIPLE = 0.5`), which is dimensionally robust across page widths and font sizes. This change was NOT re-reviewed by Codex (made directly in response to the user's live bug report, verified via the exact repro + full regression suite + typecheck + build). See the story's Dev Agent Record and Change Log for the full writeup. A fresh Codex pass on the CURRENT diff would be reasonable before this story is considered fully closed, given the core threshold logic changed again after this review's approval.
