from __future__ import annotations

import hashlib
import json
import logging
import os
import re
from dataclasses import dataclass
from datetime import date, datetime
from functools import lru_cache
from html import escape
from pathlib import Path
from threading import RLock
from typing import Any
from urllib.parse import parse_qs, urlparse

import markdown
import yaml
from bs4 import BeautifulSoup
from markdown.extensions.fenced_code import FencedCodeExtension
from markdown.extensions.tables import TableExtension

from config import get_content_dir
from utils.content_sync import archive_to_s3, delete_from_s3, sync_to_s3


logger = logging.getLogger(__name__)

SLUG_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]*$")
BLOCK_SEPARATOR_PATTERN = re.compile(r"\n+\s*<!--\s*block\s*-->\s*\n+")
FIGURE_PATTERN = re.compile(
    r"^<figure\s+class=\"portfolio-image(?:\s+align-(left|center|right))?\"[^>]*>"
    r"\s*<img\s+([^>]+?)>\s*"
    r"(?:<figcaption>(.*?)</figcaption>)?\s*</figure>$",
    re.DOTALL,
)
WIDTH_PATTERN = re.compile(r"max-width:\s*(\d+)%", re.IGNORECASE)
YOUTUBE_DOMAINS = {"youtube.com", "www.youtube.com", "youtu.be", "m.youtube.com"}

_settings_lock = RLock()


def get_projects_dir() -> Path:
    return get_content_dir() / "projects"


def get_about_file() -> Path:
    return get_content_dir() / "about.md"


def get_settings_file() -> Path:
    return get_content_dir() / "settings.json"


def validate_slug(slug: str) -> bool:
    return bool(SLUG_PATTERN.match(slug or ""))


def parse_frontmatter(content: str) -> tuple[dict[str, Any], str]:
    match = re.match(r"^---\s*\n(.*?)\n---\s*\n?(.*)$", content, re.DOTALL)
    if not match:
        return {}, content

    try:
        frontmatter = yaml.safe_load(match.group(1)) or {}
    except yaml.YAMLError:
        frontmatter = {}
    return frontmatter, match.group(2)


def serialize_frontmatter(frontmatter: dict[str, Any], markdown_content: str) -> str:
    header = yaml.dump(frontmatter, default_flow_style=False, allow_unicode=True, sort_keys=False)
    return f"---\n{header}---\n\n{markdown_content.strip()}\n"


def _build_markdown_renderer() -> markdown.Markdown:
    return markdown.Markdown(
        extensions=[
            FencedCodeExtension(),
            TableExtension(),
            "nl2br",
            "sane_lists",
            "smarty",
            "toc",
        ]
    )


def _is_external_url(url: str) -> bool:
    if not url:
        return False
    parsed = urlparse(url)
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def _optimize_html(html: str) -> str:
    if not html:
        return ""

    soup = BeautifulSoup(html, "html.parser")
    for image in soup.find_all("img"):
        image.attrs.setdefault("loading", "lazy")
        image.attrs.setdefault("decoding", "async")

    for link in soup.find_all("a"):
        href = (link.get("href") or "").strip()
        if _is_external_url(href):
            link["target"] = "_blank"
            link["rel"] = "noopener noreferrer"

    for iframe in soup.find_all("iframe"):
        iframe.attrs.setdefault("loading", "lazy")

    return str(soup)


def markdown_to_html(markdown_content: str) -> str:
    blocks = [part for part in BLOCK_SEPARATOR_PATTERN.split(markdown_content or "") if part.strip()]
    if not blocks:
        blocks = [markdown_content or ""]

    renderer = _build_markdown_renderer()
    rendered: list[str] = []
    for block in blocks:
        renderer.reset()
        html = renderer.convert(block)
        html = _optimize_html(html).strip()
        if html:
            rendered.append(f'<div class="content-block">{html}</div>')
    return "\n".join(rendered)


def render_markdown_fragment(markdown_content: str) -> str:
    renderer = _build_markdown_renderer()
    return _optimize_html(renderer.convert(markdown_content or "")).strip()


def _revision_from_content(content: str) -> str:
    return "sha256:" + hashlib.sha256(content.encode("utf-8")).hexdigest()[:16]


def content_revision(path: Path) -> str | None:
    if not path.exists():
        return None
    return _revision_from_content(path.read_text(encoding="utf-8"))


@lru_cache(maxsize=512)
def _parse_iso_date(value: str) -> date:
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        return date.min


def format_date(value: str | None) -> str:
    if not value:
        return ""
    try:
        parsed = datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        return value
    return parsed.strftime("%B %Y")


def _resolve_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return bool(value)


def _normalize_optional_str(value: Any) -> str | None:
    if isinstance(value, str):
        cleaned = value.strip()
        return cleaned or None
    return None


def build_figure_markdown(
    *,
    src: str,
    alt: str = "",
    caption: str = "",
    align: str = "left",
    width: int | None = None,
) -> str:
    classes = ["portfolio-image", f"align-{align if align in {'left', 'center', 'right'} else 'left'}"]
    style_attr = ""
    if width and width < 100:
        style_attr = f' style="max-width:{int(width)}%;"'

    figure = [f'<figure class="{" ".join(classes)}">']
    figure.append(f'<img src="{escape(src, quote=True)}" alt="{escape(alt, quote=True)}"{style_attr}>')
    if caption.strip():
        figure.append(f"<figcaption>{escape(caption)}</figcaption>")
    figure.append("</figure>")
    return "\n".join(figure)


def parse_image_block(markdown_block: str) -> dict[str, Any] | None:
    trimmed = markdown_block.strip()

    figure_match = FIGURE_PATTERN.match(trimmed)
    if figure_match:
        align = figure_match.group(1) or "left"
        image_tag = figure_match.group(2) or ""
        caption = BeautifulSoup(figure_match.group(3) or "", "html.parser").get_text()
        src_match = re.search(r'src="([^"]+)"', image_tag)
        alt_match = re.search(r'alt="([^"]*)"', image_tag)
        style_match = re.search(r'style="([^"]+)"', image_tag)
        width = 100
        if style_match:
            width_match = WIDTH_PATTERN.search(style_match.group(1))
            if width_match:
                width = int(width_match.group(1))
        return {
            "type": "image",
            "src": src_match.group(1) if src_match else "",
            "alt": alt_match.group(1) if alt_match else "",
            "caption": caption,
            "align": align,
            "width": width,
        }

    markdown_match = re.match(r"^!\[(.*?)\]\((.*?)\)$", trimmed)
    if markdown_match:
        return {
            "type": "image",
            "src": markdown_match.group(2),
            "alt": markdown_match.group(1),
            "caption": "",
            "align": "left",
            "width": 100,
        }

    return None


@dataclass(slots=True)
class SiteSettings:
    site_name: str
    owner_name: str
    tagline: str
    about_photo: str | None
    contact_email: str | None
    social_links: list[dict[str, str]]

    @property
    def social_links_for_display(self) -> list[dict[str, str]]:
        return [
            {"label": item.get("label", "").strip(), "url": item.get("url", "").strip()}
            for item in self.social_links
            if item.get("label", "").strip() and item.get("url", "").strip()
        ]

    def to_dict(self) -> dict[str, Any]:
        return {
            "site_name": self.site_name,
            "owner_name": self.owner_name,
            "tagline": self.tagline,
            "about_photo": self.about_photo,
            "contact_email": self.contact_email,
            "social_links": self.social_links,
        }


def default_settings() -> SiteSettings:
    return SiteSettings(
        site_name="Starter Portfolio",
        owner_name="Alex Morgan",
        tagline="A simple portfolio for selected creative work.",
        about_photo="/static/seed/about/profile.svg",
        contact_email="hello@example.com",
        social_links=[
            {"label": "Instagram", "url": "https://instagram.com/example"},
            {"label": "LinkedIn", "url": "https://www.linkedin.com/in/example"},
            {"label": "Email", "url": "mailto:hello@example.com"},
        ],
    )


def load_settings() -> SiteSettings:
    with _settings_lock:
        path = get_settings_file()
        if not path.exists():
            return default_settings()

        with path.open("r", encoding="utf-8") as handle:
            raw = json.load(handle)

    return SiteSettings(
        site_name=str(raw.get("site_name", "Starter Portfolio")),
        owner_name=str(raw.get("owner_name", "Alex Morgan")),
        tagline=str(raw.get("tagline", "")),
        about_photo=_normalize_optional_str(raw.get("about_photo")),
        contact_email=_normalize_optional_str(raw.get("contact_email")),
        social_links=[
            {
                "label": str(item.get("label", "")).strip(),
                "url": str(item.get("url", "")).strip(),
            }
            for item in raw.get("social_links", [])
            if isinstance(item, dict)
        ],
    )


def save_settings(payload: dict[str, Any]) -> SiteSettings:
    settings = SiteSettings(
        site_name=str(payload.get("site_name", "Starter Portfolio")).strip() or "Starter Portfolio",
        owner_name=str(payload.get("owner_name", "Alex Morgan")).strip() or "Alex Morgan",
        tagline=str(payload.get("tagline", "")).strip(),
        about_photo=_normalize_optional_str(payload.get("about_photo")),
        contact_email=_normalize_optional_str(payload.get("contact_email")),
        social_links=[
            {
                "label": str(item.get("label", "")).strip(),
                "url": str(item.get("url", "")).strip(),
            }
            for item in payload.get("social_links", [])
            if isinstance(item, dict)
        ],
    )

    path = get_settings_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(settings.to_dict(), handle, indent=2)
    sync_to_s3(path)
    return settings


@dataclass(slots=True)
class Project:
    slug: str
    name: str
    date: str
    draft: bool
    pinned: bool
    thumbnail: str | None
    youtube: str | None
    og_image: str | None
    markdown: str
    html: str
    revision: str | None

    @property
    def formatted_date(self) -> str:
        return format_date(self.date)

    @property
    def hero_image(self) -> str | None:
        return self.thumbnail

    def to_card(self) -> dict[str, Any]:
        return {
            "slug": self.slug,
            "name": self.name,
            "date": self.date,
            "formatted_date": self.formatted_date,
            "draft": self.draft,
            "pinned": self.pinned,
            "thumbnail": self.thumbnail,
        }

    def to_payload(self) -> dict[str, Any]:
        return {
            "slug": self.slug,
            "name": self.name,
            "date": self.date,
            "draft": self.draft,
            "pinned": self.pinned,
            "thumbnail": self.thumbnail,
            "youtube": self.youtube,
            "og_image": self.og_image,
            "markdown": self.markdown,
            "html": self.html,
            "revision": self.revision,
        }


def _parse_project(path: Path, *, include_html: bool = True, include_revision: bool = True) -> Project:
    raw = path.read_text(encoding="utf-8")
    frontmatter, markdown_content = parse_frontmatter(raw)

    return Project(
        slug=str(frontmatter.get("slug", path.stem)).strip(),
        name=str(frontmatter.get("name", path.stem)).strip() or path.stem,
        date=str(frontmatter.get("date", "")).strip(),
        draft=_resolve_bool(frontmatter.get("draft", False)),
        pinned=_resolve_bool(frontmatter.get("pinned", False)),
        thumbnail=_normalize_optional_str(frontmatter.get("thumbnail")),
        youtube=_normalize_optional_str(frontmatter.get("youtube")),
        og_image=_normalize_optional_str(frontmatter.get("og_image")),
        markdown=markdown_content.strip(),
        html=markdown_to_html(markdown_content.strip()) if include_html else "",
        revision=_revision_from_content(raw) if include_revision else None,
    )


def load_project(slug: str, *, include_drafts: bool = False, include_html: bool = True, include_revision: bool = True) -> Project | None:
    if not validate_slug(slug):
        return None
    path = get_projects_dir() / f"{slug}.md"
    if not path.exists():
        return None
    project = _parse_project(path, include_html=include_html, include_revision=include_revision)
    if project.draft and not include_drafts:
        return None
    return project


def load_projects(*, include_drafts: bool = False, include_html: bool = False, include_revision: bool = False) -> list[Project]:
    projects_dir = get_projects_dir()
    if not projects_dir.exists():
        return []

    projects = []
    for path in projects_dir.glob("*.md"):
        project = _parse_project(path, include_html=include_html, include_revision=include_revision)
        if not include_drafts and project.draft:
            continue
        projects.append(project)

    projects.sort(
        key=lambda item: (
            0 if item.pinned else 1,
            -_parse_iso_date(item.date).toordinal(),
            item.slug,
        )
    )
    return projects


def save_project(slug: str, frontmatter: dict[str, Any], markdown_content: str) -> Project:
    if not validate_slug(slug):
        raise ValueError(f"Invalid slug: {slug}")

    projects_dir = get_projects_dir()
    projects_dir.mkdir(parents=True, exist_ok=True)
    path = projects_dir / f"{slug}.md"
    payload = {
        "name": str(frontmatter.get("name", slug)).strip() or slug,
        "slug": slug,
        "date": str(frontmatter.get("date", "")).strip(),
        "draft": _resolve_bool(frontmatter.get("draft", False)),
        "pinned": _resolve_bool(frontmatter.get("pinned", False)),
    }

    for field in ("thumbnail", "youtube", "og_image"):
        value = _normalize_optional_str(frontmatter.get(field))
        if value:
            payload[field] = value

    content = serialize_frontmatter(payload, markdown_content)
    path.write_text(content, encoding="utf-8")
    sync_to_s3(path)
    return _parse_project(path)


def delete_project(slug: str) -> bool:
    if not validate_slug(slug):
        raise ValueError(f"Invalid slug: {slug}")
    path = get_projects_dir() / f"{slug}.md"
    if not path.exists():
        return False
    archive_to_s3(path)
    path.unlink()
    delete_from_s3(path)
    return True


def load_about() -> tuple[str, str, str | None]:
    path = get_about_file()
    if not path.exists():
        return "", "", None
    raw = path.read_text(encoding="utf-8")
    _frontmatter, markdown_content = parse_frontmatter(raw)
    markdown_content = markdown_content.strip()
    return markdown_to_html(markdown_content), markdown_content, _revision_from_content(raw)


def save_about(markdown_content: str) -> tuple[str, str, str | None]:
    path = get_about_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = serialize_frontmatter({"title": "About"}, markdown_content)
    path.write_text(raw, encoding="utf-8")
    sync_to_s3(path)
    return load_about()


def resolve_og_image(project: Project, request) -> str | None:
    candidate = project.og_image or project.thumbnail
    return absolute_url(request, candidate)


def absolute_url(request, value: str | None) -> str | None:
    if not value:
        return None
    if value.startswith(("http://", "https://")):
        return value
    return str(request.url.replace(path=value, query=""))


def extract_meta_description(html_content: str, *, word_limit: int = 28) -> str:
    if not html_content:
        return ""
    text = BeautifulSoup(html_content, "html.parser").get_text(separator=" ", strip=True)
    words = text.split()
    snippet = " ".join(words[:word_limit])
    if len(words) > word_limit:
        snippet += "..."
    return snippet


def youtube_embed_url(url: str | None) -> str | None:
    if not url:
        return None
    parsed = urlparse(url.strip())
    host = parsed.netloc.lower()
    if host not in YOUTUBE_DOMAINS:
        return None

    video_id = ""
    if host == "youtu.be":
        video_id = parsed.path.strip("/")
    elif parsed.path == "/watch":
        video_id = parse_qs(parsed.query).get("v", [""])[0]
    elif parsed.path.startswith("/shorts/"):
        video_id = parsed.path.split("/", 2)[2]
    elif parsed.path.startswith("/embed/"):
        video_id = parsed.path.split("/", 2)[2]

    video_id = re.sub(r"[^A-Za-z0-9_-]", "", video_id)
    if not video_id:
        return None
    return f"https://www.youtube.com/embed/{video_id}"


def startup_sync_policy() -> str:
    return os.getenv("CONTENT_STARTUP_SYNC_POLICY", "always").strip().lower() or "always"

