<h1 align="center">
  <img src="client/public/favicon.png" alt="" width="24" height="24" style="vertical-align: middle;">
  Paper Mate
</h1>

<p align="center">
  <strong>A local PDF reader for research and study.</strong><br/>
  <em>Read, mark up, and reopen papers with your notes still where you left them.</em>
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-6f8f5f.svg"></a>
  <a href="https://github.com/Cotidie/paper-mate"><img alt="Repo: Cotidie/paper-mate" src="https://img.shields.io/badge/repo-Cotidie%2Fpaper--mate-6f8f5f?logo=github"></a>
  <a href="https://github.com/Cotidie/paper-mate/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/Cotidie/paper-mate?style=flat&logo=github&color=6f8f5f"></a>
  <a href="https://github.com/Cotidie/paper-mate/issues"><img alt="GitHub issues" src="https://img.shields.io/github/issues/Cotidie/paper-mate?style=flat&logo=github&color=6f8f5f"></a>
</p>

<p align="center">
  <img alt="React" src="https://img.shields.io/badge/React-20232A?style=flat&logo=react&logoColor=61DAFB">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white">
  <img alt="Vite" src="https://img.shields.io/badge/Vite-646CFF?style=flat&logo=vite&logoColor=white">
  <img alt="PDF.js" src="https://img.shields.io/badge/PDF.js-000000?style=flat&logo=mozilla&logoColor=white">
  <img alt="FastAPI" src="https://img.shields.io/badge/FastAPI-009688?style=flat&logo=fastapi&logoColor=white">
  <img alt="Zustand" src="https://img.shields.io/badge/Zustand-443E38?style=flat">
  <img alt="Docker" src="https://img.shields.io/badge/Docker-2496ED?style=flat&logo=docker&logoColor=white">
</p>

## Overview

Paper Mate runs as a local web app. The browser handles the reading and annotation UI; a small FastAPI server saves files and annotations to disk.

The current version is the viewer and annotator. Local AI-assisted reading is planned later, but the first job is simpler: keep the paper stable, make annotation fast, and avoid sending private PDFs to a cloud service.

![Paper Mate reader with annotations and table of contents](docs/images/01-readme-paper-mate-main.png)

## Features

### 📄 Paper reading

- Local PDF opening
- Smooth scroll, zoom, and pan
- Page controls and table of contents
- Stable canvas, no layout shift from annotations

### ✍️ Annotation

- Highlight, underline, pen, memo, comment, and box tools
- Quick box for choosing tools after text selection
- Recolor, move, resize, delete, undo, and redo
- Hide or show all annotations

### 🗂️ Review and storage

- Annotation Bank with click-to-jump
- Local autosave and restore
- Original PDF left untouched
- Local library under `~/.paper-mate`

### 🔭 Planned

- Inline previews for figures, tables, footnotes, and citations
- Paper metadata and library view
- Export with annotations
- Local AI chat through CLI agents
- Click or drag a paper region into chat context

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
