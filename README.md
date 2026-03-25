# Portfolio CMS

This project is a FastAPI-based personal portfolio site with a small markdown CMS, a live editing interface, image uploads, and server-rendered public pages.

The documentation in this directory assumes this directory is the project root. If you split it into its own repository, keep the same structure and commands.

## What It Does

- renders a homepage, about page, and individual project pages
- stores projects as markdown files with YAML frontmatter
- stores the about page as markdown
- stores site-wide settings as JSON
- supports edit login/logout for remote editing
- supports project create, edit, delete, and image upload
- supports local file storage in development
- supports optional S3-backed content and image persistence

## Routes

- `/` homepage
- `/me` about page
- `/{slug}` project page
- `/edit/login`
- `/edit/logout`
- `/api/*` edit and content-management endpoints

## Quick start

1. Copy `.env.example` to `.env`.
2. Set `EDIT_TOKEN` and `COOKIE_SECRET`.
3. Install Python dependencies.
4. Install frontend dependencies.
5. Build the frontend bundle.
6. Run the app from this directory.

## Commands

```bash
uv run pytest
npm test
npm run typecheck
npm run build
uv run uvicorn main:app --reload --port 8001
```

## Content

Projects live in `content/projects/*.md`.

Each project file uses frontmatter like this:

```yaml
---
name: Project Title
slug: project-title
date: 2026-01-01
draft: false
pinned: false
thumbnail: /static/seed/project-one/thumb.svg
youtube: https://www.youtube.com/watch?v=...
og_image: /static/seed/project-one/og.svg
---
```

- `content/about.md` stores the about page markdown.
- `content/settings.json` stores site name, owner name, tagline, about photo, contact email, and social links.
- `content/assets.json` stores upload deduplication metadata.

## Editor

The editor uses three block types:

- `text`
- `image`
- `divider`

Text blocks support markdown authoring with live rendered preview. Image blocks support upload, alt text, caption, alignment, and width. Divider blocks serialize to `---`.

## Storage behavior

- Content files are always written locally under `content/`.
- If S3 is configured, content files are also synced to `content/` keys in S3.
- Uploaded images go to S3 when configured.
- Without S3, uploads are written under `static/uploads/images/`.

## Project layout

- `main.py`: FastAPI app entrypoint
- `routers/`: page, auth, and admin routes
- `utils/`: content loading, storage, assets, image processing, S3 sync
- `templates/`: Jinja templates for public pages and errors
- `static/`: CSS, frontend TypeScript, built bundles, seed assets, uploads
- `content/`: markdown content and JSON settings
- `tests/`: backend and frontend safety checks
- `tools/`: small helper scripts

## Environment

The required environment variables are documented in `.env.example`.

In practice, most local setups only need:

- `EDIT_TOKEN`
- `COOKIE_SECRET`

S3 settings are only needed if you want hosted edits and uploads to persist through deploys.
