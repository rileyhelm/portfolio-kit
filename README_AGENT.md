# README_AGENT.md

## Purpose
This repository is a personal portfolio site with:
- FastAPI server-side rendering
- markdown-based content storage
- live edit mode with auth
- project CRUD
- about page editing
- image uploads
- local development storage with optional S3-backed persistence

## Public routes
- `/` homepage
- `/me` about page
- `/{slug}` project page
- `/edit/login`
- `/edit/logout`

## Content model
Projects live in `content/projects/*.md` with frontmatter:
- `name`
- `slug`
- `date`
- `draft`
- `thumbnail`
- `youtube`

About page:
- `content/about.md`

Settings:
- `content/settings.json`
- `assets.json` tracks uploaded image hashes and storage keys

## Editor scope
Supported block types:
- `text`
- `image`
- `divider`

Editing expectations:
- live markdown preview/rendering
- block insertion/reordering polish
- conflict handling
- image editing quality-of-life

Important nuance:
- Normal markdown preview/output should continue to support reasonable raw HTML inside text blocks.

## Storage model
- Content is stored locally under `content/`.
- If S3 is configured, content syncs to S3 on save and hydrates from S3 on startup.
- Uploaded images:
  - S3/CDN in production when configured
  - local static uploads fallback in dev when S3 is absent

## Architecture notes
- `main.py` wires middleware, startup sync, static assets, and error handlers.
- `routers/pages.py` handles the public site.
- `routers/auth.py` handles edit login/logout.
- `routers/admin.py` handles editor APIs, optimistic saves, uploads, and settings writes.
- `utils/content.py` is the central content model and markdown rendering layer.
- `static/ts/edit/index.ts` drives the edit overlay.
- `static/ts/edit/blocks.ts` owns block parsing and serialization.

## Conventions
- Prefer straightforward code over abstractions.
- Treat this directory as the project root when reasoning about paths.
- Preserve the markdown-first authoring flow.
- Keep documentation aligned with the current repository structure.

## Verification
Before closing work, run:
- run frontend tests
- run backend tests
- run typecheck
- run build
- note any gaps clearly
