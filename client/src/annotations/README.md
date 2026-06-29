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
  its transient states). The tool union lives in the zero-import `tools.ts` leaf;
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
  the mark selected/ringed; clicking a mark again reopens its box. `Del`/
  `Backspace` delete; `Esc` or a pointerdown on empty page content clears the
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

Still later stories: comment tool + box-select drag (2.10-2.11),
the cursor-mode drag-to-change-tool picker (2.12), and editing/undo/persistence
(Epic 3).
