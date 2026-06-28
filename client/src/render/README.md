# render/

pdfjs-dist wrapper: page canvas + text layer, viewport/projection. Single
source of the rendered page box (AD-4). Never knows about annotations.

Built in Story 1.3 (`index.ts`): worker wiring, `loadDocument`, `getPageBox`
(the scale-1.0 AD-4 page box), `renderPage` (HiDPI canvas + v4 `TextLayer`),
and the DOM-free `fitToWidthScale` helper. Depends on `api/` only.
