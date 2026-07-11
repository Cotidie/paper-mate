# annotations/

Annotation layer (view) + tool system + quick-box. Depends downward on
anchor + store only (AD-9 layering).

Built in Story 2.2 (foundation the tool stories 2.3-2.9 reuse):

- `AnnotationLayer`: the per-page VIEW. Renders each stored annotation off
  `anchor.kind` (text marks for the highlight proof), positioned via the anchor
  service against the live card box + scale, so it re-derives on every zoom
  (AC-6) and never reflows the canvas (NFR-1).
- `machine.ts`: the transient-overlay state machine (PREP-3): armed-tool /
  annotating / pending-quick-box / empty. Since Story 2.4 it is driven by the
  ONE tool model (AD-11): the armed annotation tool is derived from App's single
  `activeTool` and mirrored down via the `armedTool` prop, which is its sole
  writer — the machine never self-arms (it only carries the armed tool through
  its transient states). The tool union lives in the zero-import `lib/tools.ts` leaf;
  `AnnotationTool` is re-exported from this barrel for back-compat.
- `AnnotationInteraction`: document-level selection handling + the
  `{component.quick-box}` shell with one proof action (creates a default
  text-highlight). Tool-specific quick-box contents arrive in 2.3-2.9.
- `create.ts` (`buildAnnotations`) + `position.ts` (`clampToViewport`): the pure
  entity-build (two-page `group_id` split) and on-screen-nudge helpers.

Story 2.3 (highlight tool) adds the first real tool on this foundation:

- The Highlight tool is armed from the rail button or `H`. App owns the single
  `activeTool` (AD-11); when it is an annotation tool the rail shows it armed and
  `AnnotationInteraction` consumes it via `armedTool`. Sticky until
  `V`/`Esc`/another tool.
- With highlight armed, a text drag-release LANDS a default-color highlight
  immediately (create-on-release). Since Story 2.5 the just-made mark is then
  SELECTED, so the unified selection quick-box (recolor + delete) takes over —
  there is no separate create quick-box (one affordance for "act on a mark",
  whether just-created or clicked later). Cursor-mode drag keeps the 2.2
  single-action proof button, which also selects the mark after it creates (the
  cursor tool-type picker is Story 2.12).
- `ColorSwatchRow`: the shared 5-color swatch row (Story 2.6 trimmed it to five).
  Exported from the barrel and reused by BOTH the overlay's selection recolor
  (2.5) AND the rail's Highlight color sub-toolbox (2.6's arm-time picker).

Story 2.4 unified the tool state into one `activeTool` FSM (AD-11): mutual
exclusion is by construction (no `mode`+`armedTool` pair to keep in sync), pan
derives from `activeTool === "hand"`, and a rail click switches the tool in a
single click. Story 2.6 uses the active-tool transition to show the Highlight color
picker after the switch lands; Story 2.5 adds click-to-select safely on this one
model.

Story 2.6 (arm-time color + 5-color palette): the active color is a DEFAULT new
marks land in. It lives in the annotation store as `activeColor` because the rail's
Highlight color sub-toolbox and this overlay's recolor row both update it; App
subscribes only to pass it into the rail, and the create path reads it directly
from the store instead of a hardcoded `annotation-default`. The Highlight button
still arms in one click; once highlight becomes active, its color sub-toolbox opens
with the same `ColorSwatchRow` (swatches stacked vertically, like the pointer
flyout), and clicking the already-active Highlight button toggles that sub-toolbox.
The post-create recolor row still recolors the selected mark and now also updates
the session default, so the active color is whatever was chosen LAST by EITHER path
(sub-toolbox or recolor). The accent palette was trimmed to
five colors (yellow default / green / pink / blue / purple), edited in `DESIGN.md`
(the token source) and regenerated into `tokens.css`.

Story 2.5 adds the selection seam (AD-12) — the first way to act on an EXISTING
mark, decoupled from the create machine and the Epic-3 command stack:

- One `selectedId: string | null` in the store is the single source of truth for
  selection (`select`/`clearSelection`), plus a group-aware `deleteAnnotation`
  (removes the id AND its `group_id` siblings, so a two-page highlight deletes
  both pages; clears `selectedId` if it was in the set). Client-only — no
  persistence/undo yet (that is the seed Story 3.3 reuses).
- The highlight marks are now pointer-interactive (Decision A): each mark rect IS
  the page-normalized anchor rect (`denormalizeRect`), so `pointer-events:auto` +
  `cursor:pointer` make it the hit surface. Hovering outlines the WHOLE annotation
  and shows the pointer cursor (NOT the text I-beam) — so you cannot start a new
  highlight over an existing one. Clicking selects it (a `--selected` ring,
  stronger than the hover outline). Recent-wins: marks render sorted by
  `created_at` ascending (newest on top wins overlap). The rest of the layer sheet
  stays `pointer-events:none`, so non-highlighted text stays selectable (trade-off:
  you cannot text-select over a highlight).
- Hover AND selection are GROUP-AWARE and both live in the store (`hoveredId` +
  `selectedId`). A two-page highlight is two annotations in two per-page layers, so
  each layer reads the shared ids and lights any mark that matches by id OR shares
  a non-null `group_id` (`inActiveGroup`) — both pages outline on hover and ring on
  select as one. Hover is store state (not per-layer `useState`) precisely so the
  sibling on the other page's layer sees it.
- The selection quick-box is a SEPARATE render path off `selectedId` (Decision B,
  NOT `machine.ts`): it reuses `ColorSwatchRow` (armed to the mark's current
  color → `store.recolorAnnotation`, reused from 2.3) + a Delete action, reusing
  the `.quick-box` shell + `clampToViewport`. A pick dismisses the box but keeps
  the mark selected/ringed; clicking a mark again reopens its box. `Del`
  deletes (`Backspace` is intentionally NOT a delete trigger: it is a frequent
  text-editing key and dropping it prevents accidental annotation loss -- Story
  3.3); `Esc` or a pointerdown on empty page content clears the
  selection (document-level, phase-gated, editable/buttons/chrome exempt so the
  toolbar/zoom keep it). Scroll (including zoom recenters) only CLOSES the
  floating box — the ring rides the denormalized rect and stays glued (NFR-3). Selection works in cursor mode AND while a highlight
  tool is active (a pointerdown on a mark selects; empty text falls through to the
  2.3 create path). a11y: the layer stays decorative (`aria-hidden`); selection is
  a pointer affordance with document-level Del/Esc — a keyboard-reachable list
  comes with the Epic-3 Annotation Bank.

Story 2.7 (underline tool) is the second tool, and mostly a PAINT variant of
highlight — no new machinery:

- The create path no longer hardcodes `type: "highlight"`. `AnnotationInteraction`'s
  create-on-release fires for highlight OR underline and passes `type: armedTool`,
  so a drag while underline is armed lands a `type=underline` mark through the SAME
  text-anchor path (`rectsFromSelection` → `buildAnnotations`, incl. the two-page
  `group_id` split) at the active color. The new mark is selected, so the same 2.5
  selection quick-box (recolor + delete) takes over (no new quick-box).
- Rendering follows AD-5 strictly: GEOMETRY keys off `anchor.kind` (shared by every
  text tool), STYLE keys off `type`. `AnnotationLayer` splits marks into the
  `.annotation-highlights` opacity group (highlights, ~0.4 fill) and a full-opacity
  `.annotation-underlines` group (underlines). An underline mark keeps the
  `.annotation-highlight` base class — so the 2.5 selection hit-test, hover outline,
  and selected ring all work unchanged — plus an `.annotation-highlight--underline`
  modifier that swaps the fill for a 2px accent `border-bottom` in the mark's own
  `style.color` (width from `--annotation-underline-width`).
- The rail has an Underline button (twin of Highlight) with its own color
  sub-toolbox (reusing `ToolFlyout` + `ColorSwatchRow` + the shared `flyoutOpen` +
  the open-on-tool-change effect); `U` arms it. Underline shares the one
  `activeColor` with highlight.

Story 2.8 (pen tool) is the FIRST non-text tool, so it adds real machinery (a
gesture-capture path + a new `anchor.kind`), not just a paint variant:

- A pen mark is a freehand pointer GESTURE, not a text selection. `AnnotationInteraction`
  has a SEPARATE document-level path, active only while `armedTool === "pen"`:
  `pointerdown` over a page starts a draft (client-space points), `pointermove`
  accumulates points + drives a live preview, `pointerup` resolves the page
  (`pickPage` on the first point), converts client→card-local→normalized points
  (`anchor/normalizePoint`), and stores ONE `type=pen` / `kind=path` mark via
  `buildPenAnnotation`, then selects it. `preventDefault` on down/move suppresses
  native text selection; the Reader sets `data-draw` on `.pdf-canvas` (a pure
  derivation of `armedTool==="pen"`) for `user-select:none` + a crosshair cursor.
  A draft with < 2 points (a click) makes no mark; `Esc`/pointercancel/blur abort.
- Point math lives in `anchor/` (AD-9): `normalizePoint`/`denormalizePoint` are the
  point twins of the rect pair (`[0,1]` fractions of `box*scale`, clamped). The
  freehand outline + its SVG path `d` come from `pen.ts` (perfect-freehand, AD-2),
  used by BOTH the live preview AND `AnnotationLayer` so what-you-draw is what lands.
- Rendering follows AD-5: GEOMETRY keys off `anchor.kind` = `path` (an SVG `<path>`
  from `points`), STYLE off `style`. `AnnotationLayer` renders pen marks in a
  full-opacity `.annotation-pens` SVG sheet (sibling of the highlight/underline
  groups); the path is filled in the mark's `style.color`. The stroke diameter is
  `style.stroke_width * scale`, so it stays glued AND thickens with zoom (NFR-3).
  The path is the 2.5 selection hit surface (`.annotation-pen`, added to both
  `.closest()` hit-tests); hover/selected add an ink SVG stroke around the fill.
- `stroke_width` is stored at scale 1.0 (path-only style per AR-5). The rail has a
  Pen button whose sub-toolbox carries BOTH a `ColorSwatchRow` AND a
  `StrokeWidthRow` (UX-DR5); `D` arms it. The shared store state is `activeColor`
  (with highlight/underline) + a new `activeStrokeWidth`. The selection quick-box
  is type-aware: a selected pen mark also shows the `StrokeWidthRow` (restroke via
  `store.restrokeAnnotation`), and its box anchors below the stroke's bounding box.

Story 2.9 (memo tool) is the FIRST `kind=rect` tool AND the first mark with a
`body`, so it adds an INTERACTIVE on-page control, not a paint mark:

- A memo is placed by a CLICK, not a drag or a text selection. `AnnotationInteraction`
  has a SEPARATE document-level path, active only while `armedTool === "memo"`: a
  primary-button `pointerdown` on a `.page-surface` (excluding chrome, the quick-box,
  and an existing `.annotation-memo`) resolves the page (`pickPage`), builds a
  default-size rect at the click point from the `activeMemoSize` preset (scale-1.0
  px), normalizes it (`anchor/normalizeRect`), and stores ONE `type=memo`/`kind=rect`
  mark with `body:""` via `buildMemoAnnotation`, then selects it so the layer
  autofocuses its textarea. `preventDefault` stops the click starting a selection.
- A memo RENDERS as an interactive `<textarea>` (not a pointer-transparent paint
  sheet). `AnnotationLayer` branches on `anchor.kind === "rect"` + `type === "memo"`
  and renders the box in a NEW, NOT aria-hidden `.annotation-memos` group (a
  focusable control can't live in an aria-hidden subtree), positioned via
  `denormalizeRect` (left/top/width + a min-height) so it rides zoom (NFR-3) and
  never reflows the page (absolute overlay). `value = body`; every edit writes
  through `retextAnnotation` (the body twin of `recolorAnnotation`). The accent
  (border) color is `style.color`; the body text stays ink. The box is the 2.5
  selection hit surface (`.annotation-memo`, added to both `.closest()` hit-tests).
- An EMPTY memo is not persisted (Decision 5): when `selectedId` moves off a memo
  whose `body` is still blank, it is deleted (keyed on DESELECT, not a raw textarea
  blur, so clicking a quick-box swatch mid-edit doesn't nuke it). A memo with text
  stays.
- Memo "size" IS the rect (no contract field, AD-5): the `SizeRow` preset picks a
  scale-1.0 px box; placement bakes it into the rect, and `resizeMemoAnnotation`
  rewrites the rect's width/height (normalized against the page, keeping the
  top-left) — guarded to `kind=rect`+`type=memo`. `activeMemoSize` is the client
  default (the size twin of `activeColor`/`activeStrokeWidth`).
- The rail has a Memo button (below Pen) whose sub-toolbox carries a `ColorSwatchRow`
  AND `SizeRow` (a COLLAPSIBLE single control, not a step row — the pen
  `StrokeWidthRow` row-widening is being converted to match separately); `T` arms it.
  The selection quick-box is type-aware: a selected memo shows `ColorSwatchRow` +
  `SizeRow` + delete, anchored below the box. The memo's own textarea is the inline
  text-input the AC names; color/size are the quick-box rows.
- **Opacity (fix request, post-3.1):** `SizeRow` was later dropped (a memo resizes via
  the Story 3.1 edit frame's corner handles instead), and an `AlphaRow` was added in
  its place — the memo twin of Pen's opacity (Story 2.13). `activeAlpha` in the store
  is PER-TOOL (`Record<"pen"|"memo", number>`, mirrors `activeColors`'s per-tool
  split), so tuning one tool's default never touches the other's. `style.alpha`
  (0..1) sets the strength of the `color-mix()` in `MemoBox.tsx` that blends
  `style.color` toward **`transparent`** (a second fix request: an EARLIER version
  of this feature mixed toward `--color-surface-card` white instead, which only
  desaturated the box and never let the page content underneath actually show
  through — `color-mix(in srgb, color A%, transparent)` is the alpha-channel
  equivalent of `rgba(color, A)`) — 1 = fully saturated/opaque, 0 = fully
  see-through. `.annotation-memo__body`'s own `background: transparent`
  (Annotations.css) means the textarea zone shows through identically to the
  padding/border zone. A memo created before this feature (`alpha: null`) falls
  back to 35%, the old fixed ratio. `realphaAnnotation`'s guard covers `kind=path`
  (pen) OR `kind=rect && type=memo`.

## Story 2.10 — comment (text+pin OR pin, + bubble)

Story 2.10 (comment tool) adds the LEAST new code of any tool: it REUSES two
existing gestures behind `type=comment` (AD-5: `comment → text` OR `rect`). The
genuinely new pieces are a `body` param, a pin button, and a `CommentBubble`.

- A comment is created TWO ways, branched on `pages.length` in the SAME `pointerup`:
  - **DRAG across text → a `kind=text` comment** (highlight fill + a pin). This is
    the highlight/underline create path VERBATIM — `buildAnnotations` with
    `type:"comment"` and the ONE delta `body:""` (a non-null body, AD-5). Because a
    `type=comment` mark is `type !== "underline"`, it is ALREADY in `highlightMarks`,
    so its ~0.4 fill paints for FREE in the `.annotation-highlights` opacity group —
    there is NO second fill path.
  - **CLICK a spot (no selection) → a `kind=rect` comment** (a pin only, no fill).
    The memo click-to-place twin: `buildCommentPin` builds a degenerate (point) rect
    at the click via `pickPage`/`normalizeRect`, `type:"comment"`/`body:""`. Branched
    on the empty-selection `pointerup` (guarded over `.page-surface`, off the
    quick-box / an existing pin / bubble / mark — never stacks a second pin).
- Both kinds render a round PIN (`{component.annotation-comment-pin}`,
  `rounded.full`, accent fill) — a real `<button>` at the first rect's start
  (`kind=text`) or the rect's top-left (`kind=rect`), in a NEW, NOT aria-hidden
  `.annotation-comments` group (a focusable control can't live in the decorative
  aria-hidden mark sheet — same rule memos follow). The pin rides `denormalizeRect`
  so it stays glued on zoom (NFR-3).
- Clicking the pin selects the comment and opens the `{component.comment-bubble}`
  (the `CommentBubble`, the `MemoBox` twin): a positioned surface with a `<textarea>`
  bound to `body` (every edit → `retextAnnotation`, REUSED unchanged — it has no type
  guard), a `ColorSwatchRow` (recolor tints the fill AND the pin via
  `recolorAnnotation` + sets the active default), and a delete. Focus moves into the
  textarea on open and RETURNS to the prior element on close (mount/unmount effect);
  local `Esc` blurs + `clearSelection`.
- The bubble REPLACES the generic selection quick-box for comments (UX-DR5,
  Decision 4): `showSelectionBox` excludes `type === "comment"`, so a selected
  comment shows the bubble, never the shared color/delete box. The pin + bubble are
  added to the empty-space-deselect hit-test so clicking them keeps the selection.
- An empty comment is KEPT (Decision 5 — the INVERSE of the 2.9 empty-memo cleanup,
  which stays gated on `type === "memo"`): a clicked pin with no note is a deliberate
  marker, so deselecting an empty comment leaves it in place.
- The rail has a Comment button (below Memo, `ChatCircle`) whose sub-toolbox is a
  `ColorSwatchRow` only (color, no width/size); `C` arms it. Client-only — the
  contract already carries `type:"comment"`/`kind=text`/`kind=rect`/`body`, so the
  tracked OpenAPI + generated TS types stay byte-identical.

## Story 2.11 -- box-highlight a region (generalized in Story 8.4 to box-comment)

Box-highlight is a MODE of the Highlight tool, not its own tool: a `boxHighlight`
flag App threads down. While Highlight is active AND box mode is on, a pointer DRAG
over a page creates a `type=highlight` / `kind=rect` region annotation with a fill
(not text-based). The region lands as a highlight and the 2.5 selection quick-box
(recolor + delete) takes over. There is no region tool-type picker (removed): a box
drag under Highlight always makes a highlight. **Story 8.4 adds a second box mode,
`boxComment`, as the twin under the Comment tool** — see that section below for the
generalization; this section describes the shared mechanics both modes ride.

- Box mode lives UNDER its tool's own flyout (a Text/Box `menuitemradio` pair beside
  the color row): `highlight-box-toggle` for Highlight (keyed `M`), `comment-box-toggle`
  for Comment (no hotkey, Story 8.4). Box is NOT a pointer sub-mode and NOT a
  top-level rail tool. App resets each tool's box flag to false whenever the active
  tool leaves it, so re-arming a tool always starts in plain text mode.
- The overlay's box-drag gesture (`useBoxGesture`) gates on a single `boxMode:
  "highlight" | "comment" | null` prop (`BoxMode`, exported from `gestures/useBoxGesture.ts`
  and re-exported by `annotations/index.ts`), derived in ReaderPage as
  `activeTool === "highlight" && boxHighlight ? "highlight" : activeTool === "comment"
  && boxComment ? "comment" : null` and threaded ReaderPage → Reader → AnnotationInteraction.
  The armed tool is `highlight`/`comment`, but a box drag is a rectangle, not a text
  selection or a click, so it needs this separate signal. Box-highlight and
  box-comment are mutually exclusive for free: they are modes of two DIFFERENT tools,
  and only one `activeTool` is ever active (AD-11).
- On commit, `useBoxGesture` branches the builder + color on `boxMode`:
  `"highlight"` → `buildRegionAnnotation` (`type=highlight`, `body=null`, the
  Highlight tool's remembered color); `"comment"` → `buildCommentPin` (`type=comment`,
  `body=""`, the Comment tool's remembered color). Both build the SAME `RectPlacement`
  (the drawn, canonicalized, normalized drag rect) — one parametrized gesture, not a
  forked one (`create.ts`'s existing factories, parallel to `buildPenAnnotation` /
  `buildMemoAnnotation`).
- The box drag gesture is document-level (AP-1), gated on `boxModeRef.current !== null`,
  with an 8px commit threshold (`BOX_DRAG_THRESHOLD`). It builds a canonicalized
  normalized rect via `normalizeRect` (handles up-left drags and off-card overshoot),
  then calls the mode's builder, `addAnnotation`, and `select`.
- **Box mode must own creation while active (Story 8.4, Design D3):** `useCreateQuickBox`
  takes a `boxActive: boolean` opt (`boxMode !== null`); its `onPointerUp` and
  `onPointerDownCandidate` both early-return while box mode is active, so a box drag
  never ALSO falls through to the text-comment create or the click-pin path. This was
  a non-issue for box-highlight (Highlight's empty-selection pointerup branch is
  already a no-op) but required for Comment (its empty-selection branch drops a
  click pin).
- The `kind=rect` FILL BRANCH in `AnnotationLayer` renders `kind=rect` marks as fill
  divs in a `.annotation-regions` group (sibling of `.annotation-highlights`). It also
  still covers `type=comment` `kind=rect` (the Story 2.10 comment pins, now ALSO
  reachable via a direct box-comment drag, not just a click or a Story 3.7 convert).
  The `.annotation-highlight` base class keeps the 2.5 selection seam (hover/selected
  classes, hit-tests) working.
- Rubber-band preview: `boxPreview` state in client coordinates renders as a
  `.box-preview` fixed div (dashed border, `pointer-events:none`, `z-index:40`),
  tinted to the active mode's own color (Highlight's or Comment's). Fix request: the
  border-only preview read as an empty outline; a nested `.box-preview__fill` child
  at `--annotation-highlight-opacity` (the same token the committed region fill's
  group uses) now previews the fill too, so the live drag matches the mark about to
  land. Kept as a separate child (not `opacity` on the whole element) so the dashed
  border itself stays crisp/full-opacity.
- `M` / `m` arms Highlight with box mode on (UX-DR15); `V`/`Esc` return to cursor (AD-11).
  Box-comment has no hotkey (Story 8.4 Decision D4) — the flyout's Box option is the
  only affordance.
- No API/contract change: `RectAnchor`, `type:"highlight"`, `type:"comment"`, `body`
  already exist (AR-5); the tracked OpenAPI + generated TS types stay byte-identical.

## Story 2.12 -- cursor-mode drag-to-change-tool picker

The cursor-mode quick-box (Story 2.2 "proof box") is replaced with a
context-sensitive tool picker. In cursor mode (no annotation tool armed)
the picker has two shapes, keyed off whether there is a text selection:

- **Text drag** (selection.length > 0) pops a three-tool picker: Highlight,
  Underline, Comment. Picking a tool creates the mark on the current
  selection. No Memo here (a memo is a rect box, not a text-anchor mark).
- **Right-click** (contextmenu, selection.length === 0) pops a two-tool
  picker: Comment, Memo. The mark is placed at the click point (`pending.at`).
  The handler `preventDefault`s the native browser menu and clears any live
  selection first. Right-click works over text too (place-at-point, not on a
  word).

Picking creates the mark without a trip to the left rail. `activeTool` is
unchanged (one-shot create, not a sticky arm). The buttons are icon-only
(Phosphor glyphs matching the rail); `aria-label` + `title` carry a11y.

> Deviates from the original story spec (which proposed one four-tool
> text-drag picker incl. Memo at the selection start). Approved user fixes:
> icon-only buttons, Memo dropped from the text-drag picker, and the
> Comment/Memo place-at-point picker bound to RIGHT-CLICK.
>
> **Story 5.0 follow-up (behavior change):** the Comment/Memo picker was
> originally on an empty-area DOUBLE-CLICK. On a dense PDF the pdf.js text
> layer covers nearly the whole page, so almost every double-click selected a
> word and popped the H/U/C picker instead — the Comment/Memo picker was
> effectively unreachable, and a "Comment" pick anchored to the word rather
> than dropping a pin at the click. Moved to right-click so "place a
> comment/memo here" is a distinct, reliable gesture.

- The picker lives entirely inside the existing `pending` quick-box state
  (Decision 1): the machine (`machine.ts`), the shell, the position/clamp,
  the focus-in/return, and the dismiss-on-pick/outside-click/Esc/scroll
  plumbing are reused verbatim. The change is the CONTENTS of the
  `pending &&` render branch: `role="menuitem"` buttons in place of one.
- `createTextTool(pages, tool)` (Decision 2): the armed `onPointerUp` branch
  AND `commitTool` both call this shared helper so there is ONE text-anchor
  create path (build via `buildAnnotations` + `addAnnotation` + clear
  selection + `select`). No duplication.
- `commitTool(tool)` branches on `pending.selection.length`: text drag (> 0)
  routes H/U/C through `createTextTool`; empty-area double-click (=== 0)
  places a Comment pin (`buildCommentPin`, degenerate point rect) or a
  default-size `kind=rect` Memo (`buildMemoAnnotation` + `activeMemoSize`)
  at `pending.at`, then selects it.
- Picking Highlight/Underline routes into the 2.5 selection quick-box
  (recolor + delete). Picking Comment routes into the 2.10 bubble (the
  shared selection box already excludes `type="comment"`). Picking Memo
  selects the new box so the 2.9 textarea autofocuses. Empty-memo cleanup
  is free (the existing deselect-cleanup already handles it).
- No contract change: all four types + both builders already exist; the
  tracked OpenAPI + generated TS types stay byte-identical.

## Story 2.13 -- pen stroke alpha (opacity)

Alpha is the THIRD pen style axis (after color and stroke_width), stored as
`style.alpha: float | null` on the `Style` model (Pydantic + generated TS
contract). `null` is backward-compatible (renders at the 0.4 default, same
as the highlighter opacity). Only pen marks carry a non-null alpha; all other
marks store `null` (AR-5).

- `AlphaRow`: a 4-step row (Low 0.2 / Mid 0.4 / High 0.6 / Full 1.0),
  mirroring `StrokeWidthRow`. Swatches visualize the step opacity. Exported
  from the barrel and reused by BOTH the pen sub-toolbox (arm-time picker) AND
  the selection quick-box (per-mark edit).
- `store.activeAlpha` / `setActiveAlpha`: sticky default (last-choice-wins,
  same model as `activeColor`/`activeStrokeWidth`). Default = 0.4.
- `store.realphaAnnotation`: per-mark alpha update (twin of
  `restrokeAnnotation`), guarded to `anchor.kind === "path"` so a stale
  selection id for a text mark is silently skipped.
- `AnnotationLayer.renderPen`: each `<path>` now carries `fillOpacity` (per-stroke,
  NOT group opacity, so overlapping strokes at different alphas render correctly).
  `PEN_DEFAULT_ALPHA = 0.4` bridges the CSS token to the TS render path.
- The live preview path (the in-flight draft) also carries `fillOpacity`.
- The selection quick-box shows `AlphaRow` when `isPenSelected`, reflecting the
  selected mark's own `style.alpha ?? activeAlpha`. Picking calls
  `realphaAnnotation` + `setActiveAlpha` + closes the box.

## Story 5.0 (structural refactor): module map + the descriptor pattern

A behavior-neutral, contract-neutral refactor that unified the "branch by
annotation kind/type" sprawl behind data contracts + a descriptor registry + a
clean module split. No feature change; the Epic-2 suites are the safety net (every
test stayed green, asserting outcomes, not internals).

**The descriptor registry (`marks.ts`).** The single source for the per-mark
kind/type facts that used to be re-encoded as `if (type === ...)` / `if (kind ===
...)` chains. `MARK_DESCRIPTORS: Record<AnnotationTool, MarkDescriptor>` keys on the
tool (`{ type, kind, quickBox }`); `quickBoxSpec(anno)` is what the selection
quick-box reads to decide its rows (stroke-width / alpha / size), its aria-label,
and whether the mark routes to the comment bubble instead. Adding a tool is one
entry here. AD-9-clean (imports `api/` + `lib/tools.ts` only; pure data).

**Data contracts (`create.ts`).** The five `Build*Options` twins collapsed onto one
`CreateBase` (now/newId/color) + per-tool extensions (`TextCreateRequest`,
`PenCreateRequest`); the three identical `{page_index, rect}` placements collapsed
onto one `RectPlacement`. Builders still assemble the same generated `Annotation`
shape (AD-3: wrap/derive, never shadow).

**Store combinator (`store/index.ts`).** The five near-twin guard-then-map mutation
`set()` blocks collapsed onto one `patchAnnotations(map, ids, now, apply)` helper
(recolor / restroke / realpha / resizeMemo). `retext` (single-id) and `delete`
(group-gather) keep their own shapes. Each action stays a DIRECT mutation — no
command stack yet (Epic 3 Story 3.2 wraps this one clean seam with zundo).

**Module split (the OOP/encapsulation answer to the overlay state islands).** Each
self-contained gesture is now its own cohesive hook under `gestures/`, owning its
SYNCHRONOUS draft refs + live-preview state and binding its own document-level
handlers (AP-1). A `useReducer` could not own these (its dispatch is async; the
document handlers read the drafts synchronously), but a hook can — so the
encapsulation preserves behavior exactly:

- `gestures/shared.ts` — `GestureContext` (the ref-backed live context every
  gesture reads) + `isExempt` (shared editable/button skip).
- `gestures/usePenGesture.ts` — pen freehand draft → preview → commit (Story 2.8).
- `gestures/useBoxGesture.ts` — box-drag rubber-band region: highlight (Story 2.11)
  or comment (Story 8.4), per `boxMode`.
- `gestures/useMemoPlacement.ts` — click-to-place memo (Story 2.9).
- `gestures/useSelection.ts` — the whole selected-mark quick-box concern (Story
  2.5/AD-12): selection state + open/close/key/dismiss/focus effects + the
  recolor/restroke/realpha/resize/delete actions (group-aware, AR-4) + box anchor
  geometry. The component renders the box from its returned API.
- `MemoBox.tsx` / `CommentBubble.tsx` — the two on-page editable surfaces, split
  out of `AnnotationLayer` (pure prop-driven components).

After the split, `AnnotationInteraction` (1186 → ~640 lines) is the composition
core: the create-on-release chain + the cursor-mode tool-type picker
(`machine.ts`) + the live previews. `AnnotationLayer` (557 → ~390 lines) is the
render shell: it keeps its opacity-group DOM containers + the kind/type group
filters DELIBERATELY (they encode COMPOSITING — the isolated highlight opacity
group — and the comment DUAL-render — a text comment paints in the fill group AND
the pin group — not a clean (kind,type)→render partition; collapsing them would
change paint). `marks.ts` is the clean seam for the future cross-type hit-layer.

## Story 3.1 (edit annotations): the command path + drag-handle move/resize

3.1 is the convergence story: every annotation mutation now routes through ONE
surface (the store actions), nothing mutates around it (AD-7, AE-3), and the
missing geometry edits land. NO command STACK yet — that is Story 3.2 (zundo wraps
this surface). NO autosave (3.4).

- **`setAnnotationGeometry(id, anchor, now)` (store).** The move/resize command-path
  action, shared by `kind=rect` (memo/region/comment-pin) and `kind=path` (pen). It
  replaces the anchor's VALUES and bumps `updated_at`; a kind CHANGE is rejected as a
  no-op (a geometry edit never rewrites the discriminator, AC-8). The GESTURE computes
  the new anchor with the `anchor/` helpers — the store does no coordinate math
  (AD-9: it still imports `api/` only). `resizeMemoAnnotation` (the preset SizeRow)
  stays as-is; free corner-resize goes through `setAnnotationGeometry`.
- **anchor/ edit transforms.** `translateRect` / `translatePoints` (move; the DELTA is
  clamped so size/shape is preserved at the page edge), `resizeRectCorner` (free
  corner drag → canonicalized rect), `scalePoints` (pen resize about the opposite
  bbox corner; geometry only, `stroke_width` unchanged), `pointsBounds` (pen bbox →
  frame position + resize origin). All pure, in normalized `[0,1]` space, DPR-invariant.
- **`gestures/useEditGesture.ts`.** A document-level gesture (AP-1) on the edit-frame
  handles (`data-edit-handle` + `data-edit-id`). Draft ref + live preview via the
  transient store `dragPreview` (no per-pointermove commit); commits ONE
  `setAnnotationGeometry` on release (so 3.2's zundo records one undo step). Aborts on
  Esc / pointercancel / blur WITHOUT committing.
- **The edit frame (`AnnotationLayer`).** For the selected pen/memo/region mark
  (`isEditable = kind==="path" || kind==="rect"`, fix request: originally excluded
  `type==="comment"`, so a rect-kind — box — comment had NO frame at all; now ANY
  rect mark gets one, comment included, matching a region highlight exactly): a move
  grip (a pill above the frame, so it never fights a memo's textarea) + four corner
  handles, positioned via the anchor service so they ride zoom (NFR-3). Handles are
  `<button>`s → the doc-level deselect/create handlers skip them (`isExempt`), keeping
  the mark selected during a drag. `dragPreview` makes the mark + frame follow the
  pointer live. The region/comment FILL itself is ALSO a move handle (fix request:
  carries `data-edit-handle="move"`/`data-edit-id` unconditionally, mirroring the
  comment pin's + the memo wrapper's existing "click selects, drag moves" pattern) —
  so dragging the highlighted area directly moves it, not only the frame's grip.
  **Text marks get NO frame**: free-moving a text rect would desync `anchor.text`
  from the glyphs (Story 3.8 re-resolves the run instead); text marks keep restyle +
  double-click re-edit + delete only.
- **Re-edit convergence (AE-3).** Memo double-click focuses its textarea; comment
  re-edit is the existing pin→bubble. Both write `body` via `retextAnnotation`. Audit
  confirmed every mutation (retext / recolor / restroke / realpha / resize / geometry /
  delete) goes through a store action — none out of band.

**Deferred out of 3.1 (2026-06-30):** the cross-type unified hit-layer (AC #4) — it
disambiguates overlapping marks of DIFFERENT types on one spot (mostly text marks,
not edited in 3.1). Fast-follow / fold into Story 3.8. `marks.ts` stays its seam.

Still later: autosave + restore (3.4/3.5), the Annotation Bank (3.6), convert
highlight to comment (3.7), text-range adjust (3.8).

## Story 3.2 (undo/redo): zundo temporal middleware + Ctrl Z / Ctrl Shift Z

3.2 wraps the Story 3.1 mutation surface (the store actions) with `zundo` temporal
middleware and binds the keyboard shortcuts. The store actions do not change shape:
zundo observes the `annotations` Map and records each transition. The result is
client-only, in-memory undo: discarded on reload, with a 100-step cap (AC-2, AR-7).

**zundo integration.** `zundo 2.3.0` is the Zustand temporal middleware (`temporal`
from `"zundo"`). The store is wrapped in the curried form:

```ts
export const useAnnotationStore = create<AnnotationStore>()(
  temporal(
    (set, get) => ({ /* existing store body */ }),
    {
      partialize: (s) => ({ annotations: s.annotations }),
      limit: 100,
      equality: (a, b) => a.annotations === b.annotations,
    },
  ),
);
```

Only `annotations` is tracked in history (`partialize`). `selectedId`,
`hoveredId`, `dragPreview`, `active*` defaults, and all actions are excluded (AC-5).
The equality check uses Map reference equality: a no-op action that returns the same
Map reference produces no history entry (AC-5 for restroke-on-text, unknown-id
geometry, etc.). The imperative API hangs off
`useAnnotationStore.temporal.getState().{undo, redo, clear, pause, resume}`.

**One logical edit = one undo step (AC-4).** Four patterns:

- **Single-action creates/edits:** each store `set()` is one step automatically
  (highlight, pen, recolor, geometry, delete).
- **Grouped creates (two-page highlight):** `addAnnotations(created[])` (new batch
  action) adds all siblings in ONE `set()` call so they land as a single undo step.
  `AnnotationInteraction` uses this instead of `created.forEach(addAnnotation)`.
- **Move/resize:** `useEditGesture` commits ONE `setAnnotationGeometry` on release
  (3.1 design); already one step.
- **Text-edit sessions:** typing into a memo or comment textarea fires many
  `retextAnnotation` calls. On focus the temporal store is paused
  (`temporal.pause()`) and the pre-session `annotations` Map is saved
  (`textSessionRef`). On blur, `temporal.resume()` is called and the pre-session
  snapshot is pushed directly to `pastStates` so ONE undo returns to the state
  before the session started. `AnnotationLayer` owns this via `startTextEditSession`
  / `commitTextEditSession` passed as `onTextFocus` / `onTextBlur` to `MemoBox` and
  `CommentBubble`. This gives true "one undo per typing session" without
  per-keystroke history entries and without a complex separate timer.

**`patchAnnotations` no-op guard.** The internal helper (used by recolor/restroke/
realpha/resizeMemo) returns the ORIGINAL Map reference when no annotation was
modified. This lets the zundo equality check (`a.annotations === b.annotations`)
correctly skip the history entry for no-op calls (e.g. restroking a text mark,
setting geometry on an unknown id).

**`retextAnnotations` (new batch retext action).** A `CommentBubble` edit writes
the same body to all group siblings (a two-page comment) in ONE `set()` call,
so the text-edit session coalescing gives ONE undo step for the whole group.

**Keybindings: `gestures/useUndoRedo.ts`.** A standalone document-level `keydown`
handler (not folded into `useSelection` which early-returns on `e.ctrlKey`):

- `Ctrl Z` / `Cmd Z`: undo
- `Ctrl Shift Z` / `Cmd Shift Z`: redo
- `Ctrl Y`: redo (Windows alternate)

Phase-gated (`enabled`), editable/buttons exempt (`isExempt`) — so `Ctrl Z` inside
a memo/comment textarea does the browser's native text undo. `e.preventDefault()` on
handled chords. After undo/redo: if `selectedId` is no longer in `annotations`, the
selection is cleared (AC-5). Empty-stack calls are silent no-ops (`zundo` handles
them internally). Consumed in `AnnotationInteraction` alongside the other gesture hooks.
