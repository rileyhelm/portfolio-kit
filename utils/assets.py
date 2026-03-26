from __future__ import annotations

import hashlib
import json
import logging
import re
from pathlib import Path
from urllib.parse import urlparse

from config import get_content_dir, get_uploads_dir
from utils.content_sync import sync_to_s3
from utils.s3 import delete_key, get_cloudfront_domain, is_s3_configured


logger = logging.getLogger(__name__)

UPLOAD_PREFIX = "uploads/images/"
LOCAL_UPLOAD_PREFIX = "/static/uploads/images/"


def get_registry_path() -> Path:
    return get_content_dir() / "assets.json"


def compute_hash(data: bytes) -> str:
    return f"sha256:{hashlib.sha256(data).hexdigest()}"


def _default_registry() -> dict:
    return {"version": 1, "assets": {}, "hash_index": {}}


def load_registry() -> dict:
    path = get_registry_path()
    if not path.exists():
        return _default_registry()
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def save_registry(registry: dict) -> None:
    path = get_registry_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(registry, handle, indent=2)
    sync_to_s3(path)


def find_by_hash(content_hash: str) -> str | None:
    registry = load_registry()
    asset_url = registry.get("hash_index", {}).get(content_hash)
    if not isinstance(asset_url, str):
        return None
    if asset_exists(asset_url):
        return asset_url
    unregister_asset(asset_url)
    return None


def register_asset(url: str, content_hash: str, *, storage_key: str | None, size: int) -> None:
    registry = load_registry()
    registry.setdefault("assets", {})[url] = {
        "hash": content_hash,
        "storage_key": storage_key,
        "size": size,
    }
    registry.setdefault("hash_index", {})[content_hash] = url
    save_registry(registry)


def unregister_asset(url: str) -> None:
    registry = load_registry()
    entry = registry.get("assets", {}).pop(url, None)
    if entry:
        content_hash = entry.get("hash")
        if registry.get("hash_index", {}).get(content_hash) == url:
            registry["hash_index"].pop(content_hash, None)
        save_registry(registry)


def asset_exists(url: str) -> bool:
    if url.startswith(LOCAL_UPLOAD_PREFIX):
        return (get_uploads_dir() / Path(url.removeprefix(LOCAL_UPLOAD_PREFIX))).exists()
    return True


def _managed_upload_url(url: str) -> bool:
    if url.startswith(LOCAL_UPLOAD_PREFIX):
        return True
    if not is_s3_configured():
        return False
    cloudfront = get_cloudfront_domain()
    parsed = urlparse(url)
    if cloudfront and parsed.netloc == cloudfront:
        return parsed.path.lstrip("/").startswith(UPLOAD_PREFIX)
    return parsed.path.lstrip("/").startswith(UPLOAD_PREFIX)


UPLOADED_URL_PATTERN = re.compile(
    r'(?P<url>(?:https?://[^\s)"\'>]+|/static/uploads/images/[^\s)"\'>]+))'
)


def extract_asset_urls(text: str) -> set[str]:
    urls: set[str] = set()
    for match in UPLOADED_URL_PATTERN.finditer(text or ""):
        candidate = match.group("url").strip()
        if _managed_upload_url(candidate):
            urls.add(candidate)
    return urls


def scan_all_references() -> set[str]:
    from utils.content import get_about_file, get_projects_dir, get_settings_file

    refs: set[str] = set()

    about_file = get_about_file()
    if about_file.exists():
        refs |= extract_asset_urls(about_file.read_text(encoding="utf-8"))

    settings_file = get_settings_file()
    if settings_file.exists():
        refs |= extract_asset_urls(settings_file.read_text(encoding="utf-8"))

    projects_dir = get_projects_dir()
    if projects_dir.exists():
        for path in projects_dir.glob("*.md"):
            refs |= extract_asset_urls(path.read_text(encoding="utf-8"))

    return refs


def _storage_key_from_url(url: str) -> str | None:
    parsed = urlparse(url)
    key = parsed.path.lstrip("/")
    if key.startswith("static/"):
        return None
    return key or None


def _local_path_from_url(url: str) -> Path | None:
    if not url.startswith(LOCAL_UPLOAD_PREFIX):
        return None
    suffix = url.removeprefix(LOCAL_UPLOAD_PREFIX)
    return get_uploads_dir() / suffix


def cleanup_orphans(urls: set[str]) -> list[str]:
    if not urls:
        return []

    active_refs = scan_all_references()
    deleted: list[str] = []
    for url in urls:
        if url in active_refs or not _managed_upload_url(url):
            continue

        local_path = _local_path_from_url(url)
        if local_path and local_path.exists():
            local_path.unlink()
            deleted.append(url)
            unregister_asset(url)
            continue

        storage_key = _storage_key_from_url(url)
        if storage_key and delete_key(storage_key):
            deleted.append(url)
            unregister_asset(url)

    return deleted
