# anchor/

Anchor service: the ONLY home of normalized↔screen coordinate math (AD-4,
AD-9). Works in top-left, y-down space; normalizes against the render layer's
page box (`getPageBox`). Tool/annotation features never compute screen↔PDF
coordinates.

Built in Story 2.2:

- `normalizeRect` / `denormalizeRect`: pure `[0,1]`↔screen projection against
  `box * scale`. The pdf.js viewport projection (bottom-left to top-left plus
  rotation) is adopted via `render/getPageBox` (`getViewport`), so this layer
  does not re-flip y (PREP-1: adopt the stable primitive, do not hand-roll).
- `canonicalize`: order a negative-drag rect so `x0<=x1, y0<=y1`.
- `pickPage`: pure two-page-split logic (which card a client rect lands on).
- `rectsFromSelection`: map a native text selection (`Range.getClientRects`) to
  one normalized entry per page it crosses (drives the AC-5 split).
