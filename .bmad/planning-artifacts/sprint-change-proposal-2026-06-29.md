# Sprint Change Proposal — 2026-06-29

**Trigger:** Epic 1 retrospective surfaced two things to fold into the plan: (1) deferred-work items, and (2) a new standing guideline "don't reinvent wheels / adopt stable solutions". The user asked to review Epic 2 and place the deferred work appropriately.

**Mode:** Batch. **Scope classification:** Moderate (backlog reorganization — epics + sprint-status + architecture spine).

## 1. Issue summary

Epic 1 is complete and retrospected. Open threads needed a home:
- **Deferred-work items** (`deferred-work.md`): ToC synthesis + persistence + schema bump; upload-size cap; local-Docker dev-experience (root-owned `/data`, no backend hot-reload).
- **New standing guideline:** don't reinvent wheels — adopt stable, proven solutions over from-scratch builds.

A review of Epic 2 ("Annotate") also found that its first story was structurally overloaded.

## 2. Impact analysis

**Deferred-work fit (honest read — most do NOT belong in Epic 2):**

| Item | Fits Epic 2? | Resolution |
|---|---|---|
| ToC synthesis + persistence + schema bump | No — Phase-2 reading feature, not annotation | Stays deferred → v2 epic |
| Upload-size cap | No — server hardening | Stays deferred → Epic 3 backend |
| Docker dev-experience (root `/data`, no hot-reload) | Partly — not a feature, but bites *during* Epic 2's heavy iteration | **Promoted → Epic 2 Story 2.1 (enabler)** |

**Epic 2 story review — the real finding:** the original Story 2.1 ("Highlight text via drag") bundled **five net-new architectural pillars** — the `anchor/` service (AD-4), the `Annotation` entity (AR-5), the Zustand `store/` (AD-7), the `annotations/` overlay, and the quick-box shell (UX-DR5) — **with** the highlight feature. That foundation is the highest-leverage decision of the epic (Epic 1 retro PREP-1) and is too much for one story. Epic 1 handled its big foundation with a dedicated walking-skeleton (Story 1.1); Epic 2 should too.

**Guideline impact:** the anchor stories must adopt stable primitives (pdf.js viewport convert + native Selection) rather than hand-rolling — an architecture-spine clarification (AD-4) + a CLAUDE.md principle, not a scope change.

## 3. Recommended approach

**Direct adjustment** (no rollback, no MVP change):
1. Split the overloaded Story 2.1 into **2.1 Dev-infra enabler** + **2.2 Annotation foundation**, and renumber the six tool stories to **2.3–2.9** so number = execution order (mirrors the Epic 1 correct-course renumber convention).
2. Promote only the **docker dev-experience** deferred item into Epic 2 (Story 2.1); leave ToC-synthesis/persist (v2) and upload-cap (Epic 3) deferred.
3. Thread "adopt stable primitives" + the retro conventions (document-level handlers, overlay-state machine) into the foundation story and the foundational docs.

## 4. Detailed changes applied

**`epics.md` — Epic 2 restructured (7 → 9 stories):**
- NEW **2.1 Dev-infra enabler (local Docker dev loop)** — compose `user:` fix (writable `/data`) + backend reload decision; no product/annotation code.
- NEW **2.2 Annotation foundation (anchor service + store + overlay)** — `anchor/` on pdf.js `convertToPdfPoint`/`convertToViewportPoint` + native Selection `getClientRects()`; `Annotation` entity; Zustand store; `annotations/` overlay + quick-box shell; two-page `group_id` split; zoom-reanchor proof; document-level-handler + overlay-state conventions.
- **2.3 Highlight** (was 2.1, now a thin feature on the foundation, with a "builds on 2.2" note) … **2.9 Drag-to-change-tool quick-box** (was 2.7). Six tool stories renumbered +2.

**`sprint-status.yaml`:** Epic 2 keys replaced with the 9 new keys (all `backlog`); 3 retro action items marked `done` (now codified).

**Architecture spine (`ARCHITECTURE-SPINE.md`):** AD-4 gains an "adopt stable primitives" convention bullet (anchor math on pdf.js viewport convert + native Selection; does not override AD-2's deliberate custom overlay). Source-tree `anchor/` line annotated.

**`CLAUDE.md`:** new "Engineering principles" section — don't-reinvent-wheels, document-level interaction-handler convention, `render/` test-mock sync rule.

**`deferred-work.md`:** docker dev-experience entry marked **PROMOTED → Story 2.1**; ToC-synthesis/persist + upload-cap remain parked.

## 5. Implementation handoff

**Scope:** Moderate. **Route to:** Developer (story cycle).
- Next: `bmad-create-story 2-1` (dev-infra enabler), then `2-2` (annotation foundation — the through-line; build it once, adopt stable primitives), then the tool stories 2.3–2.9.
- **Success criteria:** Epic 2 board has 9 sequenced stories; the anchor foundation is its own story; the dev-loop friction is fixed before the feature stories; foundational docs carry the don't-reinvent principle.

**Left deferred (not in Epic 2):** ToC synthesis + persistence + schema bump (v2 epic); upload-size cap (Epic 3 backend).
