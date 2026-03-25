from __future__ import annotations

import os
from pathlib import Path

from fastapi.templating import Jinja2Templates

from filters import escape_jinja2_in_code_snippets
from utils.static_assets import static_url


APP_ROOT = Path(__file__).resolve().parent


def get_app_root() -> Path:
    return APP_ROOT


def get_content_dir() -> Path:
    override = os.getenv("PORTFOLIO_CONTENT_DIR", "").strip()
    if override:
        return Path(override).expanduser().resolve()
    return APP_ROOT / "content"


def get_static_dir() -> Path:
    override = os.getenv("PORTFOLIO_STATIC_DIR", "").strip()
    if override:
        return Path(override).expanduser().resolve()
    return APP_ROOT / "static"


def get_uploads_dir() -> Path:
    override = os.getenv("PORTFOLIO_UPLOADS_DIR", "").strip()
    if override:
        return Path(override).expanduser().resolve()
    return get_static_dir() / "uploads" / "images"


templates = Jinja2Templates(directory=str(APP_ROOT / "templates"))
templates.env.filters["escape_jinja2_in_code_snippets"] = escape_jinja2_in_code_snippets
templates.env.globals["static_url"] = static_url

