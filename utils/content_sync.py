from __future__ import annotations

import logging
from pathlib import Path, PurePosixPath

from botocore.exceptions import ClientError

from config import get_content_dir
from utils.s3 import get_s3_bucket, get_s3_client, is_s3_configured


logger = logging.getLogger(__name__)

S3_CONTENT_PREFIX = "content/"
S3_CANONICAL_MARKER_KEY = f"{S3_CONTENT_PREFIX}.s3-canonical.json"
S3_ARCHIVE_PREFIX = "content-archive/"


def local_to_s3_key(local_path: Path) -> str:
    relative = local_path.relative_to(get_content_dir())
    return f"{S3_CONTENT_PREFIX}{relative.as_posix()}"


def _content_type(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".md":
        return "text/markdown; charset=utf-8"
    if suffix == ".json":
        return "application/json; charset=utf-8"
    return "application/octet-stream"


def sync_to_s3(local_path: Path) -> bool:
    if not is_s3_configured():
        return False
    try:
        key = local_to_s3_key(local_path)
        with local_path.open("rb") as handle:
            get_s3_client().upload_fileobj(
                handle,
                get_s3_bucket(),
                key,
                ExtraArgs={"ContentType": _content_type(local_path)},
            )
        return True
    except Exception:
        logger.exception("Failed to sync content file %s", local_path)
        return False


def delete_from_s3(local_path: Path) -> bool:
    if not is_s3_configured():
        return False
    try:
        get_s3_client().delete_object(Bucket=get_s3_bucket(), Key=local_to_s3_key(local_path))
        return True
    except Exception:
        logger.exception("Failed to delete content file %s from S3", local_path)
        return False


def archive_to_s3(local_path: Path) -> bool:
    if not is_s3_configured() or not local_path.exists():
        return False
    try:
        archive_key = f"{S3_ARCHIVE_PREFIX}{local_path.name}"
        with local_path.open("rb") as handle:
            get_s3_client().upload_fileobj(
                handle,
                get_s3_bucket(),
                archive_key,
                ExtraArgs={"ContentType": _content_type(local_path)},
            )
        return True
    except Exception:
        logger.exception("Failed to archive content file %s", local_path)
        return False


def has_canonical_marker() -> bool:
    if not is_s3_configured():
        return False
    try:
        get_s3_client().head_object(Bucket=get_s3_bucket(), Key=S3_CANONICAL_MARKER_KEY)
        return True
    except ClientError as exc:
        code = str(exc.response.get("Error", {}).get("Code", ""))
        if code in {"404", "NoSuchKey", "NotFound"}:
            return False
        logger.warning("Unable to check canonical marker: %s", code)
        return False


def _safe_local_path(relative_key: str) -> Path | None:
    if not relative_key or relative_key.endswith("/"):
        return None
    pure = PurePosixPath(relative_key)
    if pure.is_absolute() or any(part in {"", ".", ".."} for part in pure.parts):
        return None

    root = get_content_dir().resolve()
    path = (root / Path(*pure.parts)).resolve()
    try:
        path.relative_to(root)
    except ValueError:
        return None
    return path


def sync_from_s3(*, require_marker: bool = False) -> int:
    if not is_s3_configured():
        return 0
    if require_marker and not has_canonical_marker():
        return 0

    synced = 0
    paginator = get_s3_client().get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=get_s3_bucket(), Prefix=S3_CONTENT_PREFIX):
        for obj in page.get("Contents", []):
            key = obj["Key"]
            if key == S3_CANONICAL_MARKER_KEY:
                continue

            relative = key[len(S3_CONTENT_PREFIX):]
            local_path = _safe_local_path(relative)
            if not local_path:
                continue

            local_path.parent.mkdir(parents=True, exist_ok=True)
            get_s3_client().download_file(get_s3_bucket(), key, str(local_path))
            synced += 1
    return synced
