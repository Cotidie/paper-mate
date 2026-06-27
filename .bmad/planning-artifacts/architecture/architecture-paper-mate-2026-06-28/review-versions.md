# Review — Version & Technology Currency (Architecture Spine)

**Reviewer lens:** verify every committed technology decision is real, maintained, and current as of June 2026 (not asserted from stale training data).
**Target:** `ARCHITECTURE-SPINE.md`
**Date:** 2026-06-28
**Method:** WebSearch against upstream release notes, npm/PyPI, MDN, endoflife.date.

## Verdict

**PASS WITH CORRECTIONS.** Every named technology exists, is actively maintained, and fits its stated role — the architecture is sound and no decision is fabricated. However, the Stack table's banner claim "Versions confirmed current June 2026" is **partly false**: three pins (TypeScript, Node LTS, Vite) name a version that is one major line behind what is actually current in June 2026. None breaks the design; they should be corrected so the table is honest about being "current."

The two load-bearing factual assertions in the rules — FastAPI auto-generates OpenAPI from Pydantic v2, and Firefox has no local-disk File System Access — are both **confirmed true**.

## Findings (by severity)

### MEDIUM

**M1 — TypeScript pinned to "5.x"; current line is 6.0.**
TypeScript 5.9 (Aug 2025) was the last 5.x release. TypeScript **6.0 went final on 2026-03-17** (latest 6.0.3), with 7.0 (Go-based compiler) targeting mid-2026. The spine's "5.x" is therefore no longer "current." 6.0 maintains API compatibility with 5.9, so this is a label-accuracy issue, not a design risk. Recommend pinning **TypeScript 6.0** (or stating "5.9 / 6.0" if you deliberately want the conservative line).

**M2 — Node pinned to "22 LTS"; current Active LTS is 24.**
As of June 2026: Node **24 is Active LTS** (until Apr 2028), **22 is in Maintenance LTS** (EOL Apr 2027), and 26 is Current (enters LTS Oct 2026). "22 LTS" is technically still LTS but is the *maintenance* line, not the active one. For build tooling Node 22 still satisfies Vite's floor, but the spine should say **Node 24 LTS** to match "current June 2026." Cross-check: Vite 7/8 require Node 20.19+ / 22.12+, so both 22 and 24 are valid.

**M3 — Vite pinned to "7"; current major is 8.**
Vite **8.1.0** is the current release (Vite 8 shipped 2026; 8.1.0 published ~late June 2026). Vite 7 is the prior major and still maintained, but is not "current." Node requirement is unchanged between 7 and 8 (20.19+ / 22.12+). Recommend pinning **Vite 8** unless there is a specific reason to lag one major.

### LOW

**L1 — Python pinned to 3.12 while 3.14 is current.**
Latest is **3.14.6** (2026-06-10); 3.13.14 also current; 3.12 is still in security/maintenance support. 3.12 is a defensible conservative floor, but it is two minor lines behind "current." If the table's intent is "current," bump to 3.13 or 3.14; if the intent is "stable floor," say so. Not a defect.

**L2 — AD-3 names the practice (OpenAPI → generated TS types) but not the tool.**
Generating TS types from a FastAPI-emitted OpenAPI schema is a current, standard practice in 2026. The de-facto tool is **`openapi-typescript`** (openapi-ts.dev; types-only, runtime-free, OpenAPI 3.0/3.1). AD-3 is correct to leave tool choice to scaffold, but recording the expected tool would harden the contract. (Alternatives exist: `openapi-generator` typescript generators, `orval` if a client+hooks are wanted.) No correction required; informational.

**L3 — AD-10 / docker-compose.yml: the `version:` key is obsolete.**
Docker Compose v2 is the standard (latest v2.40+); the Compose Specification has dropped the top-level `version:` field (ignored if present). "Docker Compose v2" in the Stack table is correct. Just ensure the scaffolded `docker-compose.yml` does **not** carry a `version:` line, or it will emit warnings.

## Verified correct (no action)

- **FastAPI + Uvicorn** — current (FastAPI **0.138.1**, 2026-06). Maintained, fits role. ✅
- **Pydantic 2.x** — current (floor pydantic >=2.9 in FastAPI; 2.13 in circulation). ✅
- **FastAPI auto-OpenAPI from Pydantic v2** — confirmed: FastAPI's `_compat/v2.py` + `openapi/utils.py` drive JSON-schema/OpenAPI generation off Pydantic v2. AD-3's chain (Pydantic models → OpenAPI → TS types) is real. ✅
- **React 19.2** — current (latest 19.2.7, 2026-06-01). React 19 stable, includes the React Compiler. ✅
- **pdfjs-dist** — current (**6.0.227**, 2026-05), Mozilla PDF.js generic build, still *the* standard web PDF renderer (3,200+ dependents). AD-2's note that its built-in annotation layer is for embedded form/link annots (not custom marks) is accurate, justifying the custom overlay. ✅
- **Zustand** — current (**5.0.14**), most-downloaded React state lib in 2026, maintained by pmndrs. Fits "client store; seed, swappable." ✅
- **perfect-freehand** — current (**1.2.3**; repo pushed 2026-02), exports `getStroke`. Maintained, fits pen-stroke role. ✅
- **Docker Compose v2** — current (v2.40+). ✅
- **AD-1 Firefox local-disk gap claim** — confirmed: Firefox does **not** support `showOpenFilePicker`/`showSaveFilePicker`/`showDirectoryPicker` in any desktop/Android version (Mozilla's standards position flags them as harmful); it ships only OPFS. This validates the dockerized-backend-owns-disk topology. ✅

## Net recommendation

Replace the three stale pins (TypeScript 5.x → 6.0, Node 22 LTS → 24 LTS, Vite 7 → 8), decide whether Python 3.12 is a "current" pin or a deliberate floor, and optionally name `openapi-typescript` in AD-3. After that, the Stack table's "confirmed current June 2026" banner is truthful. No architectural decision needs to change.
