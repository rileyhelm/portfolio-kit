from __future__ import annotations

import asyncio
import io
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse

from dependencies import require_edit_mode
from utils.assets import cleanup_orphans, extract_asset_urls
from utils.content import (
    build_figure_markdown,
    content_revision,
    delete_project,
    get_about_file,
    get_projects_dir,
    get_settings_file,
    load_about,
    load_project,
    load_settings,
    parse_image_block,
    render_markdown_fragment,
    save_about,
    save_project,
    save_settings,
    validate_slug,
)
from utils.image import process_image
from utils.storage import ensure_upload_dirs, upload_processed_image


router = APIRouter(prefix="/api", tags=["admin"], dependencies=[Depends(require_edit_mode)])


def _project_path(slug: str):
    return get_projects_dir() / f"{slug}.md"


def _normalize_text(value: Any) -> str | None:
    if isinstance(value, str):
        cleaned = value.strip()
        return cleaned or None
    return None


def _validate_project_payload(data: dict[str, Any], *, creating: bool) -> tuple[str, str]:
    slug = data.get("slug")
    if not isinstance(slug, str) or not validate_slug(slug.strip()):
        raise HTTPException(status_code=400, detail="Invalid slug format")

    original_slug = data.get("original_slug", slug)
    if not isinstance(original_slug, str) or not validate_slug(original_slug.strip()):
        raise HTTPException(status_code=400, detail="Invalid original slug format")

    slug = slug.strip()
    original_slug = original_slug.strip()
    if creating and load_project(slug, include_drafts=True):
        raise HTTPException(status_code=400, detail="Project with this slug already exists")
    return slug, original_slug


def _build_project_frontmatter(data: dict[str, Any], slug: str) -> dict[str, Any]:
    payload = {
        "name": str(data.get("name", slug)).strip() or slug,
        "slug": slug,
        "date": str(data.get("date", datetime.now(timezone.utc).strftime("%Y-%m-%d"))).strip(),
        "draft": bool(data.get("draft", False)),
        "pinned": bool(data.get("pinned", False)),
    }

    for field in ("thumbnail", "youtube", "og_image"):
        value = _normalize_text(data.get(field))
        if value:
            payload[field] = value
    return payload


@router.get("/project/{slug}")
async def get_project(slug: str):
    project = await asyncio.to_thread(load_project, slug, include_drafts=True)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project.to_payload()


@router.post("/create-project")
async def create_project(request: Request):
    data = await request.json()
    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="Invalid request body")

    slug, _original_slug = _validate_project_payload(data, creating=True)
    frontmatter = _build_project_frontmatter(data, slug)
    markdown_content = str(data.get("markdown", "")).strip()
    project = await asyncio.to_thread(save_project, slug, frontmatter, markdown_content)
    return {"success": True, "slug": project.slug, "revision": project.revision}


@router.post("/save-project")
async def save_project_endpoint(request: Request):
    data = await request.json()
    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="Invalid request body")

    slug, original_slug = _validate_project_payload(data, creating=False)
    current = await asyncio.to_thread(load_project, original_slug, include_drafts=True)
    if not current:
        raise HTTPException(status_code=404, detail="Project not found")

    if slug != original_slug and await asyncio.to_thread(load_project, slug, include_drafts=True):
        raise HTTPException(status_code=400, detail="Project with this slug already exists")

    base_revision = _normalize_text(data.get("base_revision"))
    if base_revision and not data.get("force"):
        current_revision = await asyncio.to_thread(content_revision, _project_path(original_slug))
        if current_revision and current_revision != base_revision:
            return JSONResponse(
                status_code=409,
                content={
                    "conflict": True,
                    "server_revision": current_revision,
                    "server_project": current.to_payload(),
                    "your_markdown": str(data.get("markdown", "")),
                    "message": "Content was modified by another session",
                },
            )

    old_refs = extract_asset_urls(current.markdown)
    for field in (current.thumbnail, current.og_image):
        if field:
            old_refs.add(field)

    frontmatter = _build_project_frontmatter(data, slug)
    markdown_content = str(data.get("markdown", ""))
    project = await asyncio.to_thread(save_project, slug, frontmatter, markdown_content)

    if slug != original_slug:
        await asyncio.to_thread(delete_project, original_slug)

    new_refs = extract_asset_urls(markdown_content)
    for field in (project.thumbnail, project.og_image):
        if field:
            new_refs.add(field)
    await asyncio.to_thread(cleanup_orphans, old_refs - new_refs)

    return {"success": True, "slug": project.slug, "revision": project.revision}


@router.delete("/project/{slug}")
async def delete_project_endpoint(slug: str):
    project = await asyncio.to_thread(load_project, slug, include_drafts=True)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    refs = extract_asset_urls(project.markdown)
    for field in (project.thumbnail, project.og_image):
        if field:
            refs.add(field)

    await asyncio.to_thread(delete_project, slug)
    await asyncio.to_thread(cleanup_orphans, refs)
    return {"success": True}


@router.get("/about")
async def get_about():
    html, markdown, revision = await asyncio.to_thread(load_about)
    settings = await asyncio.to_thread(load_settings)
    settings_revision = await asyncio.to_thread(content_revision, get_settings_file())
    return {
        "html": html,
        "markdown": markdown,
        "revision": revision,
        "settings_revision": settings_revision,
        "settings": settings.to_dict(),
    }


@router.post("/save-about")
async def save_about_endpoint(request: Request):
    data = await request.json()
    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="Invalid request body")

    markdown_content = str(data.get("markdown", ""))
    base_revision = _normalize_text(data.get("base_revision"))
    settings_base_revision = _normalize_text(data.get("settings_base_revision"))

    if not data.get("force"):
        current_revision = await asyncio.to_thread(content_revision, get_about_file())
        current_settings_revision = await asyncio.to_thread(content_revision, get_settings_file())
        about_conflict = base_revision and current_revision and current_revision != base_revision
        settings_conflict = (
            settings_base_revision
            and current_settings_revision
            and current_settings_revision != settings_base_revision
        )
        if about_conflict or settings_conflict:
            html, server_markdown, _revision = await asyncio.to_thread(load_about)
            settings = await asyncio.to_thread(load_settings)
            message = "About page was modified by another session"
            if settings_conflict:
                message = "About settings were modified by another session"
            if about_conflict and settings_conflict:
                message = "About content and settings were modified by another session"

            return JSONResponse(
                status_code=409,
                content={
                    "conflict": True,
                    "server_revision": current_revision,
                    "server_settings_revision": current_settings_revision,
                    "server_state": {
                        "html": html,
                        "markdown": server_markdown,
                        "revision": current_revision,
                        "settings_revision": current_settings_revision,
                        "settings": settings.to_dict(),
                    },
                    "your_markdown": markdown_content,
                    "your_settings": data.get("settings"),
                    "message": message,
                },
            )

    _old_html, old_markdown, _old_revision = await asyncio.to_thread(load_about)
    old_settings = await asyncio.to_thread(load_settings)
    old_refs = extract_asset_urls(old_markdown)
    if old_settings.about_photo:
        old_refs.add(old_settings.about_photo)

    _html, _markdown, revision = await asyncio.to_thread(save_about, markdown_content)
    settings = data.get("settings")
    final_settings = old_settings
    if isinstance(settings, dict):
        final_settings = await asyncio.to_thread(save_settings, settings)

    new_refs = extract_asset_urls(markdown_content)
    for candidate in (
        final_settings.about_photo,
        final_settings.contact_email,
    ):
        if candidate:
            new_refs.add(candidate)
    for item in final_settings.social_links:
        maybe_url = _normalize_text(item.get("url"))
        if maybe_url:
            new_refs.add(maybe_url)

    await asyncio.to_thread(cleanup_orphans, old_refs - new_refs)
    settings_revision = await asyncio.to_thread(content_revision, get_settings_file())
    return {"success": True, "revision": revision, "settings_revision": settings_revision}


@router.post("/render-markdown")
async def render_markdown(request: Request):
    data = await request.json()
    markdown_content = str(data.get("markdown", "")) if isinstance(data, dict) else ""
    return {"html": await asyncio.to_thread(render_markdown_fragment, markdown_content)}


@router.post("/upload-image")
async def upload_image(request: Request):
    form = await request.form()
    file = form.get("file")
    if not isinstance(file, UploadFile) and not hasattr(file, "read"):
        raise HTTPException(status_code=400, detail="No file provided")

    try:
        ensure_upload_dirs()
        raw_bytes = await file.read()
        processed_data, content_type = await asyncio.to_thread(process_image, io.BytesIO(raw_bytes))
        url = await asyncio.to_thread(upload_processed_image, processed_data.getvalue(), content_type=content_type)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Image upload failed") from exc

    block_markdown = build_figure_markdown(src=url)
    parsed = parse_image_block(block_markdown)
    return {"success": True, "url": url, "block": parsed}
