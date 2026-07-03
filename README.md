# Paper Mate

**A local PDF reader for research papers.**

Paper Mate is for reading papers, marking them up, and coming back later with the notes still where you left them.

## Overview

Paper Mate runs as a local web app. The browser handles the reading and annotation UI; a small FastAPI server saves files and annotations to disk.

The current version is the viewer and annotator. Local AI-assisted reading is planned later, but the first job is simpler: keep the paper stable, make annotation fast, and avoid sending private PDFs to a cloud service.

## Screenshot placeholder

Add a screenshot here when the public reader view is ready.

Suggested shot: a paper open in the reader with the tool rail, a few highlights, a memo, and the Annotation Bank visible.

```md
![Paper Mate reader screenshot](docs/images/paper-mate-reader.png)
```

## Features

- Open a PDF from disk in a desktop web reader.
- Navigate with scrolling, page controls, zoom, pan, and the document table of contents.
- Add highlights, underlines, pen strokes, text memos, comments, and box selections.
- Drag over text and choose the annotation type from a quick box.
- Recolor, move, resize, delete, undo, and redo annotations.
- Use the Annotation Bank to scan notes and jump back to the page.
- Hide every annotation for a clean read, then show them again unchanged.
- Autosave annotations to local disk and restore them when the same PDF opens again.
- Leave the original PDF untouched. Paper Mate stores annotations beside it in a local library.

## Quick Start

### Run with Docker

```sh
git clone https://github.com/Cotidie/paper-mate.git
cd paper-mate

cp .env.example .env
set -a; [ -f .env ] && . ./.env; set +a
mkdir -p "${PAPER_MATE_DATA:-$HOME/.paper-mate}"

docker compose up --build
```

Open `http://localhost:8000` after the container starts.

### Develop locally

Run the backend and frontend in separate shells:

```sh
cd server && uv run uvicorn app.main:app --reload --port 8000
```

```sh
cd client && npm install && npm run dev
```

Open the Vite URL shown in the terminal, usually `http://localhost:5173`.

## Perfect For

- Researchers who read papers every day.
- Graduate students marking lecture notes, papers, and drafts.
- Anyone who wants PDF annotation without uploading papers to a cloud service.
- Readers who prefer local files, local annotations, and a quiet interface.

## License

Paper Mate is released under the MIT License. See [LICENSE](LICENSE).

## Acknowledgement

Paper Mate uses PDF.js for PDF rendering, React and Vite for the client app, FastAPI for the local backend, Zustand for client state, and perfect-freehand for pen strokes.

The product shape comes from the BMad planning artifacts in this repository, especially the v1 viewer and annotator spec.
