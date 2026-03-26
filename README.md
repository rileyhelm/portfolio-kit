# portfolio-kit

`portfolio-kit` is a small FastAPI portfolio starter with server-rendered public pages, markdown content, and a built-in editor for projects, the about page, settings, and image uploads.

## What It Includes

- homepage, about page, and project detail pages
- markdown project files with YAML frontmatter
- markdown about page and JSON site settings
- edit login/logout plus authenticated content APIs
- local file storage for development
- optional S3-backed content and image persistence
- backend tests, frontend tests, typecheck, and production build commands

## Requirements

- Python 3.12+
- Node.js 20+
- `uv`

## Quick Start

1. Copy `.env.example` to `.env`.
2. Set `EDIT_TOKEN` and `COOKIE_SECRET`.
3. Install dependencies:

```bash
uv sync --group dev
npm ci
```

4. Build the frontend bundle:

```bash
npm run build
```

5. Run the app:

```bash
uv run uvicorn main:app --reload --port 8001
```

Prefer `uv run ...` over invoking `uvicorn` directly from an activated shell. It ensures the project uses the managed Python 3.12 environment and installed dependencies from this repo.

6. Open `/`, `/me`, and `/edit/login`.

If you want remote edits and uploaded images to survive deploys, also set the S3/CDN variables from `.env.example`.

## Verification

```bash
uv run pytest
npm test
npm run typecheck
npm run build
```

The same verification now runs in GitHub Actions on pushes and pull requests.

## Routes

- `/` homepage
- `/me` about page
- `/{slug}` project page
- `/edit/login`
- `/edit/logout`
- `/api/*` editor and content-management endpoints

## Content

Projects live in `content/projects/*.md`.

Each project file uses frontmatter like this:

```yaml
---
name: Project Title
slug: project-title
date: 2026-01-01
draft: false
thumbnail: /static/seed/project-one/thumb.svg
youtube: https://www.youtube.com/watch?v=...
---
```

- `content/about.md` stores the about page markdown.
- `content/settings.json` stores site name, owner name, tagline, about photo, contact email, and social links.
- `content/assets.json` stores upload deduplication metadata.
- `static/seed/` ships sample artwork that you can replace during handoff.

## Editor

The editor supports three block types:

- `text`
- `image`
- `divider`

Text blocks support markdown authoring with live preview. Image blocks support upload, alt text, caption, alignment, and width. Divider blocks serialize to `---`.

## Storage Behavior

- Content files are always written locally under `content/`.
- If S3 is configured, content files are also synced to `content/` keys in S3.
- Uploaded images go to S3 when configured.
- Without S3, uploads are written under `static/uploads/images/`.

## Project Layout

- `main.py`: FastAPI app entrypoint
- `routers/`: page, auth, and admin routes
- `utils/`: content loading, storage, assets, image processing, and S3 sync
- `templates/`: Jinja templates for public pages and errors
- `static/`: CSS, TypeScript sources, built bundles, seed assets, and uploads
- `content/`: markdown content and JSON settings
- `tests/`: backend and frontend verification
- `tools/`: small helper scripts
