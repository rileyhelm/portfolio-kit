from __future__ import annotations

import logging
from datetime import datetime
from pathlib import Path

from config import get_uploads_dir
from utils.assets import (
    UPLOAD_PREFIX,
    compute_hash,
    find_by_hash,
    register_asset,
)
from utils.s3 import upload_bytes, is_s3_configured


logger = logging.getLogger(__name__)


def upload_processed_image(data: bytes, *, content_type: str) -> str:
    content_hash = compute_hash(data)
    existing = find_by_hash(content_hash)
    if existing:
        return existing

    timestamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S-%f")
    filename = f"{timestamp}.webp"

    if is_s3_configured():
        key = f"{UPLOAD_PREFIX}{filename}"
        url = upload_bytes(data, key, content_type)
        register_asset(url, content_hash, storage_key=key, size=len(data))
        return url

    uploads_dir = get_uploads_dir()
    uploads_dir.mkdir(parents=True, exist_ok=True)
    output_path = uploads_dir / filename
    output_path.write_bytes(data)
    url = f"/static/uploads/images/{filename}"
    register_asset(url, content_hash, storage_key=None, size=len(data))
    return url


def ensure_upload_dirs() -> None:
    get_uploads_dir().mkdir(parents=True, exist_ok=True)

