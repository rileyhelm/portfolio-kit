# Setup

These steps assume this repository is the project root.

## Local Setup

1. Copy `.env.example` to `.env`.
2. Set:
   - `EDIT_TOKEN`
   - `COOKIE_SECRET`
   - S3/CDN variables only if you want hosted editing and uploads to persist across deploys
3. Install dependencies:

```bash
uv sync --group dev
npm ci
```

4. Build the frontend bundle:

```bash
npm run build
```

5. Run the app locally:

```bash
uv run uvicorn main:app --reload --port 8001
```

Prefer `uv run ...` over calling `uvicorn` directly from an activated shell. It keeps the command pinned to this project's managed Python environment.

6. Confirm:
   - `/`
   - a sample project page
   - `/me`
   - `/edit/login`

## Before Public Handoff

1. Replace the sample content in `content/`.
2. Replace any sample seed images you do not want to ship from `static/seed/`.
3. Run verification:

```bash
uv run pytest
npm test
npm run typecheck
npm run build
```

4. Add the same environment variables in your host.
5. If remote edits or uploads must survive deploys, configure S3/CDN.
6. Deploy and smoke-test:
   - homepage
   - a project page
   - `/me`
   - `/edit/login`
   - image upload
   - save project
   - save about

## Normal Content Workflow

1. Log in at `/edit/login`.
2. Edit the about page or a project.
3. Upload images from the editor as needed.
4. Save.
5. Refresh the public page and confirm the change.

## Working With A Coding Agent

1. Open a new chat in the repo.
2. Tell the agent to work only inside the project root.
3. Point it to `README.md`, `README_AGENT.md`, and `SETUP.md`.
4. Describe the change in plain language.
5. Ask it to implement, verify, and summarize the result.
