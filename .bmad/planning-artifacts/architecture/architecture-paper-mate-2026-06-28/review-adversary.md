---
title: Adversarial Review — Architecture Spine (Paper Mate)
type: architecture-review
lens: adversary
target: ARCHITECTURE-SPINE.md
created: 2026-06-28
status: draft
---

# Adversarial Review — Paper Mate Architecture Spine

**Method.** For each hole I name two concrete units one level below the spine, show that *both* obey every relevant AD to the letter, then show how they still build incompatibly (clashing data shapes, two owners of one state, conflicting mutation/projection paths, or a contract the ADs leave open). Each hole ends with a proposed new/tightened AD or convention.

## Verdict

**Conditionally sound, but not yet buildable from the spine alone.** The dependency direction, ownership, and disk-write invariants (AD-6/7/8/9) are strong and largely airtight. The weakness is concentrated where the spine's two through-lines actually touch bytes: the AD-4 anchor model is under-specified enough that two conforming features will serialize geometrically incompatible data, and the AD-5 `type`/`anchor`/`style` union is decoupled from the anchor *shape* in a way that makes type-driven rendering unsound. Several smaller contract gaps (PUT race, import idempotency, meta.json, error envelope, command granularity) are individually fixable but each currently admits two correct-yet-divergent implementations. None require re-paradigming; all close with one added/tightened AD. Fix H1–H7 before scaffold; H8–H12 before the relevant feature lands.

---

## H1 — `type` does not determine anchor shape (Critical)

**Units.** (a) Text-highlight tool: `H` + drag over text → produces a *text anchor* (quads + snapshot). (b) Region-highlight tool: box-select (`M`) → region quick-box → "highlight" (EXPERIENCE IP-3 region picker: *highlight / comment*) → produces a *geometric rect anchor*. The same ambiguity hits Comment: text-selection comment (text anchor) vs FR-11 "pinned to a spot" comment (point anchor).

**Both obey the ADs.** AD-5 lists `type ∈ {highlight,underline,pen,memo,comment}` and one `anchor` per AD-4. AD-4 explicitly offers *both* a text anchor and a geometric anchor as legal anchor values. Nothing forbids `type=highlight` with a geometric anchor, and EXPERIENCE's region picker *requires* exactly that. Both tools emit a valid `Annotation`.

**Incompatibility.** The render layer and the Annotation Bank key behavior on `type` (AD-5 is the only discriminator named). But two annotations with `type=highlight` now carry different anchor shapes (quad-list vs single rect), and two `type=comment` carry quad-list vs point. A renderer that does `if type==highlight: drawQuads(anchor.quads)` crashes on the region highlight; a hit-tester written against rects misses the text highlight. There is no field that tells a consumer which anchor shape it holds without trying every key.

**Fix (new AD).** Add an explicit, discriminated `anchor.kind ∈ {text, rect, point, stroke}` to the AD-4 anchor and publish the **type→allowed-kinds matrix**: highlight/underline = {text, rect}; comment = {text, point}; memo = {rect}; pen = {stroke}. Consumers select *geometry* handling on `anchor.kind` and *style* handling on `type`. Never infer shape from `type`.

---

## H2 — Normalized rect representation is undefined (Critical)

**Units.** (a) Box-select tool serializing its drag as a rect. (b) The anchor service / render layer reading that rect to paint and hit-test.

**Both obey the ADs.** AD-4 says "normalized rect (memo/box)" and "list of normalized quad rects"; the Conventions table says "Normalized `[0,1]` fractions". A rect expressed as `{x,y,w,h}` (origin+size) and a rect expressed as `{x0,y0,x1,y1}` (two corners) are *both* normalized `[0,1]` fractions with top-left origin. A "quad" read literally is four corner points (8 numbers); read loosely it is an axis-aligned `{x,y,w,h}`. Every variant satisfies AD-4 verbatim.

**Incompatibility.** Two tuples, same name. A tool that writes `{x0,y0,x1,y1}` and a renderer that reads `{x,y,w,h}` will interpret `w` as `x1` and draw garbage. Compounded by **negative/inverted drag**: dragging bottom-right→top-left yields `w<0` or `x0>x1`; a renderer assuming `w≥0` and `x≤x+w` mis-clips. AD-4 never mandates canonical ordering or a single tuple form.

**Fix (tightened AD).** Pin one canonical form: **rect = `{x, y, w, h}`, top-left origin, `x,y ∈ [0,1]`, `w,h ≥ 0`**; **quad = ordered 4 points `[TL, TR, BR, BL]`** in `[0,1]`. The anchor service is the sole ingest point and *canonicalizes* (min/max normalize, clamp) every geometry on creation; no other unit constructs anchor geometry.

---

## H3 — Normalization basis: page box, rotation, and DPR all unpinned (High)

**Units.** (a) Anchor service computing `frac = px / page_size` at create time. (b) Render layer providing `current_page_pixel_size` and later painting `frac × size`.

**Both obey the ADs.** AD-4: "fractions `[0,1]` of page width/height, top-left origin … Screen position is always derived (`frac × current_page_pixel_size`)". AD-9: anchor service owns the math. But "page width/height" is unspecified across three axes: (1) **MediaBox vs CropBox** — academic PDFs frequently set a CropBox smaller than MediaBox; (2) **/Rotate** — a page with `/Rotate 90` has displayed dims that are the transpose of its box dims; (3) **CSS px vs device px** — on a retina display the canvas backing store is `cssWidth × devicePixelRatio`. Each unit can pick any of these and still claim "fraction of page size".

**Incompatibility.** If the anchor service normalizes against the unrotated MediaBox while render paints into a CropBox-cropped, rotation-applied viewport, the annotation lands offset/transposed. If create captures CSS-px coordinates but a later render divides device-px (or vice versa), every anchor is off by a factor of DPR (2× on retina) — and silently correct on a 1× monitor, so it ships. NFR-3 ("exact PDF coordinates across all zoom levels") is violated by construction.

**Fix (tightened AD-4).** Normalize against `page.getViewport({ scale: 1, rotation: page.rotate })` **CSS-px** dimensions (rotation applied, CropBox-relative) — the same viewport render uses, at scale 1. DPR exists *only* inside the render layer's canvas backing-store sizing and never enters anchor math. The render layer exposes page size to the anchor service as scale-1 CSS px; nothing else.

---

## H4 — Coordinate-origin flip can cross the render→anchor seam (High)

**Units.** (a) Render layer (pdfjs-dist) whose native projection is PDF user space, **bottom-left origin**. (b) Anchor service, whose stored model is **top-left origin** (AD-4).

**Both obey the ADs.** AD-4 constrains only the *stored* anchor to top-left. AD-9 says screen↔normalized math lives only in the anchor service — but pdf.js's viewport/transform that the render layer exposes is bottom-left. If render hands the anchor service raw pdf.js coordinates/transform, the anchor service is still "the only place doing the math," yet it now silently receives bottom-left input. Both units are internally consistent and AD-conformant.

**Incompatibility.** A vertical flip: every annotation is mirrored top↔bottom on the page, or double-flipped (correct only by accident). The ADs pin the storage origin and the *location* of the math but never pin the **origin convention at the render→anchor interface**.

**Fix (new convention).** The render layer's public projection API is defined to emit/consume **top-left CSS-px** coordinates exclusively; the bottom-left↔top-left flip is encapsulated entirely inside render and never appears at the seam. The anchor service may assume top-left at every boundary.

---

## H5 — Multi-page selections are unrepresentable (High)

**Units.** (a) Drag-to-annotate (IP-2) under smooth vertical scroll (FR-4), where a drag naturally crosses a page boundary. (b) The `Annotation` entity (AD-5) with a single `anchor` carrying a single `page_index` (AD-4).

**Both obey the ADs.** The tool produces a legal selection; AD-4's text anchor is "a list of normalized quad rects" — but AD-4 scopes an anchor to *one* `page_index`. A cross-page highlight has quads on two pages and cannot fit one anchor.

**Incompatibility.** The tool can express a selection the entity cannot store. Any workaround chosen independently diverges: (i) clamp to start page (silent truncation — surprising); (ii) split into N per-page annotations (then one user gesture = N entities → one `Ctrl+Z` only undoes part, AD-7's "one command" is violated, and the Bank lists one drag as N rows, breaking FR-19/F2 expectations). Two implementers will pick differently.

**Fix (new AD).** v1 rule: a text selection **clamps to the page where the drag started**; cross-page drags are truncated at the page boundary (document this in EXPERIENCE). Reserve a future `group_id` on `Annotation` so Phase-2 can model multi-page marks as a group without reshaping the entity.

---

## H6 — Whole-document PUT: overlapping in-flight saves lose updates (High)

**Units.** (a) The debounced autosave scheduler (AD-7). (b) The generated api-client issuing `PUT /api/docs/{id}/annotations` with the full set.

**Both obey the ADs.** AD-7: "dirty flag → debounced autosave … `PUT` overwrites with the full current set … atomic write." AD-6: "single user, one session per doc, no concurrency." Both units do exactly this. AD-6's "no concurrency" addresses *multi-client* concurrency; it says nothing about *overlapping requests from the one client*.

**Incompatibility.** User edits → debounce fires → PUT-A (set S1) in flight. User keeps editing → dirty again → debounce fires → PUT-B (set S2). The two requests race; if PUT-A's atomic rename lands *after* PUT-B's, the disk ends at S1 — the older, smaller set. Last-write-wins at the filesystem (AD-8 atomic write) does **not** equal last-edit-wins when requests overlap. NFR-4 ("never silently lost") is violated by a timing window the spine permits.

**Fix (new AD).** **Single-flight autosave**: at most one PUT in flight per doc; while one is in flight, new dirty state is coalesced and flushed once the current PUT resolves (then re-checked). Optionally carry a monotonic client `revision`; the server rejects a PUT whose revision is older than the last persisted one. Server LWW is only safe *under* single-flight.

---

## H7 — Import idempotency is asserted as a goal but not enforced (High)

**Units.** (a) The import route writing `library/{doc_id}/source.pdf` + `annotations.json` + `meta.json`. (b) The same route on a *re-import* of bytes whose SHA-256 already exists.

**Both obey the ADs.** AD-8 says doc_id is the content hash and the layout is fixed; it *states* the goal "prevents annotation loss on re-import" but gives **no rule** governing what import does when the folder already exists. A route that always (re)writes a fresh empty `annotations.json` on every import is fully AD-8-conformant in letter, and wipes prior annotations — defeating the stated goal.

**Incompatibility.** Two correct implementations: (i) "create folder + files unconditionally" (clobbers annotations on re-open-by-import); (ii) "if folder exists, open existing untouched." The spine's prose wants (ii) but its rule permits (i). Whoever writes the route picks one.

**Fix (new AD).** Import is **idempotent**: if `{doc_id}` exists, do not touch `annotations.json`; write `source.pdf`/`meta.json` only if absent; return the existing doc. `annotations.json` is created exactly once (empty list) at first import. (Separately note the *known limitation*: same paper, different bytes ⇒ different doc_id ⇒ split folders; AD-8's "identical paper" guarantee is really "identical bytes.")

---

## H8 — meta.json has no schema and no owner (Medium)

**Units.** (a) The storage module writing `meta.json` at import. (b) The `routes/` layer reading it to build the `GET /api/docs` list response.

**Both obey the ADs.** AD-8 lists `meta.json` in the layout; AD-9 routes it through storage (only disk writer). But **no AD names its schema or owner**, and AD-3 ("Pydantic is the single source of the annotation model + API contract") covers *annotations*, not meta. So storage can write an ad-hoc dict while `/api/docs` returns a Pydantic-typed projection — both conformant.

**Incompatibility.** The on-disk dict and the API response model drift independently (a field renamed in the response model but not on disk, or vice versa). A second future writer (Phase-2 metadata extraction, or a title-rename feature) becomes a *second owner* of meta.json with no arbiter. The "single source of truth" guarantee (AD-6) is silent on meta.

**Fix (new AD).** `meta.json` is a **Pydantic model under AD-3** (doc_id, original_filename, page_count, imported_at). Written **only by storage, only at import; immutable in v1** (title/metadata edits deferred to Phase 2 with their own route). `GET /api/docs` responses are pure projections of these models.

---

## H9 — On-disk annotations format vs API body is unspecified (Medium)

**Units.** (a) Storage serializing the set to `annotations.json`. (b) The api-client GET/PUT body shape (generated from Pydantic per AD-3).

**Both obey the ADs.** AD-7: "`PUT` overwrites with the full current set"; AD-3: Pydantic → OpenAPI → TS. Neither says whether the disk file is the *bare* `[Annotation]` list or an enveloped `{schema_version, annotations:[…]}`. Both are AD-conformant.

**Incompatibility.** If storage writes a bare list and a later version needs a schema migration, there is no version marker — old files are indistinguishable from new. If storage writes an envelope but the route returns the bare list (or the reverse), the read/write paths disagree on shape. No migration story = the durability guarantee (NFR-4) silently breaks on the first model change.

**Fix (new convention).** Disk file = `{schema_version:int, annotations:[Annotation]}`; **API GET/PUT body = bare `[Annotation]`**. Storage is the sole place that adds the envelope on write and strips it (with migration) on read. Bump `schema_version` for any breaking model change.

---

## H10 — Command granularity & the restyle-reopen path are undefined (Medium)

**Units.** (a) The create quick-box (sets initial color on a *new* mark). (b) The reopened restyle quick-box (changes color on an *existing* mark, IP-6 / EXPERIENCE). Plus pen drag and memo typing as continuous gestures.

**Both obey the ADs.** AD-7: "every annotation change flows through one path — a command stack (do/undo)" and "no component mutates annotations outside the command path." Pushing a command *per swatch click*, *per stroke point*, *per keystroke*, OR *once per completed gesture* all route through the command stack — all conformant.

**Incompatibility.** Undo becomes non-deterministic across features. Creation that pushes `create(default)` then `restyle(color)` makes the first `Ctrl+Z` only revert the color; creation that folds color into one `create` makes `Ctrl+Z` delete the mark. A pen tool that pushes one command per point makes `Ctrl+Z` peel off one freehand point; one-per-stroke undoes the whole stroke. A memo that commands per keystroke makes undo crawl character-by-character. Two tool authors will diverge, and IP-7 ("undo/redo") has no stable meaning.

**Fix (new AD).** **One command per completed user gesture.** Transient/preview state (in-progress drag, live color hover, mid-typing buffer) lives in a non-command working slot and is *committed* as a single command on gesture end. Creation folds the chosen initial style into the single `create` command; the reopened restyle emits exactly one `update` command; text edits coalesce per focus session.

---

## H11 — `{detail}` error envelope has two shapes (Medium)

**Units.** (a) Pydantic/FastAPI request-validation failures (422). (b) Explicit `HTTPException(detail=...)` raises (404 unknown doc_id, 500 save failure).

**Both obey the ADs.** Conventions: "FastAPI JSON error envelope `{detail}`; client surfaces via `{component.toast}`." FastAPI's 422 emits `detail` as an **array of objects** `[{loc,msg,type}]`; `HTTPException` emits `detail` as a **string**. Both are literally `{detail}`.

**Incompatibility.** The toast (EXPERIENCE copy like "Couldn't save…") expects a human string. Rendering the 422 array yields `[object Object]`. The generated api-client (AD-3) types the *success* schema; the error envelope isn't in OpenAPI, so the client has no typed error to switch on. Two error producers, one client renderer, two shapes.

**Fix (new convention).** Install a global exception handler that normalizes **all** errors to one envelope `{ error: { code: string, message: string } }` (including a 422 handler that flattens validation detail into `message`). Register it in OpenAPI so the generated client surfaces `error.message`; the toast always reads `error.message`.

---

## H12 — Store internal structure: Bank order vs command-stack lookup (Low–Medium)

**Units.** (a) The Annotation Bank rendering "all annotations" (FR-19). (b) The command stack doing by-id update/delete (AD-7).

**Both obey the ADs.** AD-5: "a flat collection keyed by `doc_id`." Whether the per-doc collection is an ordered `[Annotation]` list or an `id → Annotation` map both satisfy "flat collection." AD-7 needs O(1) by-id mutation; the Bank needs a stable display order.

**Incompatibility.** A map gives the command stack fast lookup but loses order, so the Bank's row order is non-deterministic (JS object/Map insertion order is *technically* stable but couples display order to mutation order — restyling a mark could reorder rows). A list preserves order but makes update/delete O(n) and id-collision-prone in the command path. Two authors pick opposite structures and the Bank's F2 "scan my 6 marks" experience shifts unpredictably.

**Fix (new convention).** Store keeps both: a `byId` map (command-stack source of truth) and a derived display order **sorted by `(page_index, y, x)`** (reading order) computed in the Bank selector. Mutation never reorders display; the Bank is a pure projection.

---

## Summary of proposed AD additions/tightenings

| # | Severity | Closes |
|---|---|---|
| H1 | Critical | Add `anchor.kind` discriminator + type→kind matrix |
| H2 | Critical | Pin canonical rect `{x,y,w,h≥0}` / quad `[TL,TR,BR,BL]`; anchor service canonicalizes |
| H3 | High | Normalize against scale-1 CSS-px rotated CropBox viewport; DPR stays in render |
| H4 | High | Render exposes only top-left CSS-px; flip encapsulated in render |
| H5 | High | Selection clamps to start page in v1; reserve `group_id` |
| H6 | High | Single-flight autosave + optional revision token |
| H7 | High | Idempotent import: never touch existing annotations.json |
| H8 | Medium | meta.json = Pydantic, storage-owned, immutable in v1 |
| H9 | Medium | Disk envelope `{schema_version,annotations}`; API body bare list |
| H10 | Medium | One command per completed gesture; preview state off-stack |
| H11 | Medium | Single normalized error envelope `{error:{code,message}}` |
| H12 | Low–Med | `byId` + reading-order projection in Bank |
