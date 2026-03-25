from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse

from config import templates
from dependencies import get_site_settings, is_edit_mode
from utils.content import (
    absolute_url,
    extract_meta_description,
    load_about,
    load_project,
    load_projects,
    resolve_og_image,
    youtube_embed_url,
)


router = APIRouter()


def _base_context(request: Request) -> dict:
    settings = get_site_settings()
    return {
        "request": request,
        "settings": settings,
        "current_year": datetime.now().year,
        "is_edit_mode": is_edit_mode(request),
        "page_title": None,
        "page_meta_description": settings.tagline,
        "og_image_link": absolute_url(request, settings.about_photo),
    }


@router.get("/", response_class=HTMLResponse)
async def home(request: Request):
    context = _base_context(request)
    context["projects"] = [project.to_card() for project in load_projects(include_drafts=is_edit_mode(request))]
    return templates.TemplateResponse("index.html", context)


@router.get("/about", include_in_schema=False)
async def about_redirect():
    return RedirectResponse("/me", status_code=301)


@router.get("/me", response_class=HTMLResponse)
async def about(request: Request):
    context = _base_context(request)
    about_html, _, _revision = load_about()
    context.update(
        {
            "about_content": about_html,
            "page_title": "About",
            "page_meta_description": f"About {context['settings'].owner_name}",
        }
    )
    return templates.TemplateResponse("about.html", context)


@router.get("/{slug}", response_class=HTMLResponse)
async def project_detail(request: Request, slug: str):
    project = load_project(slug, include_drafts=is_edit_mode(request))
    if not project:
        raise HTTPException(status_code=404)

    context = _base_context(request)
    context.update(
        {
            "project": project,
            "youtube_embed_url": youtube_embed_url(project.youtube),
            "page_title": project.name,
            "page_meta_description": extract_meta_description(project.html) or context["settings"].tagline,
            "og_image_link": resolve_og_image(project, request),
        }
    )
    return templates.TemplateResponse("project.html", context)

