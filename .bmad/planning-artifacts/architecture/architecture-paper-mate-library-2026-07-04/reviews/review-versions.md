# Review — Version / Reality lens

**Verdict:** Pass with one fix applied. Named tech verified current (web, July 2026); one claim needed tightening.

## Findings

1. **[HIGH → fixed] React Router mode not pinned.** React Router v7 has three modes — declarative, **data** (library, `createBrowserRouter`), and **framework** (file-based routing + SSR, Next/Remix-like, born of the Remix merge). `createBrowserRouter` is data/library mode and is React 19-compatible. The spine claimed "a client router is not a meta-framework," which is true **only in library/data mode** — *framework mode* would violate the inherited AD-2 ("no meta-framework"). Fix: AD-L3 + the Stack row now pin **library/data mode (`createBrowserRouter`), explicitly not framework mode**.
   - Source: https://reactrouter.com/start/modes , https://github.com/remix-run/react-router/discussions/12423

2. **[confirmed] PyMuPDF AGPL-3.0** (dual AGPL / commercial). The Deferred license note (PyMuPDF AGPL vs pdfminer.six MIT) is accurate. For a local single-user app the AGPL network-disclosure trigger is soft, but distributing the Docker image would engage it — correctly left as a conscious choice at the extraction story.
   - Source: https://pypi.org/project/pymupdf/ , https://github.com/pymupdf/pymupdf

3. **[low] GROBID Apache-2.0** left as an asserted fact (web search did not confirm in this pass). Non-load-bearing (a deferred upgrade seam); acceptable, verify at the extraction story if adopted.

Sources:
- https://reactrouter.com/start/modes
- https://github.com/remix-run/react-router/discussions/12423
- https://pypi.org/project/pymupdf/
