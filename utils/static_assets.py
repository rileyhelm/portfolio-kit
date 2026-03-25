from __future__ import annotations

import os
from pathlib import Path


APP_ROOT = Path(__file__).resolve().parents[1]


def get_static_dir() -> Path:
    override = os.getenv("PORTFOLIO_STATIC_DIR", "").strip()
    if override:
        return Path(override).expanduser().resolve()
    return APP_ROOT / "static"


STATIC_VERSION = os.getenv("STATIC_VERSION", "").strip()
_mtime_cache: dict[str, tuple[float, str]] = {}


def _file_version(path: str) -> str:
    try:
        mtime = (get_static_dir() / path).stat().st_mtime
    except FileNotFoundError:
        return ""

    cached = _mtime_cache.get(path)
    if cached and cached[0] == mtime:
        return cached[1]

    version = str(int(mtime))
    _mtime_cache[path] = (mtime, version)
    return version


def static_url(request, path: str) -> str:
    normalized = path.lstrip("/")
    url = str(request.url_for("static", path=normalized))
    version = STATIC_VERSION or _file_version(normalized)
    if not version:
        return url
    separator = "&" if "?" in url else "?"
    return f"{url}{separator}v={version}"
