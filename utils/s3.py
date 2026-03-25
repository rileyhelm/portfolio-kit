from __future__ import annotations

import logging
import os
from io import BytesIO
from typing import BinaryIO

import boto3


logger = logging.getLogger(__name__)

_s3_client = None


def is_s3_configured() -> bool:
    return bool(os.getenv("S3_BUCKET", "").strip())


def get_s3_bucket() -> str:
    return os.getenv("S3_BUCKET", "").strip()


def get_aws_region() -> str:
    return os.getenv("AWS_REGION", "us-west-1").strip() or "us-west-1"


def get_cloudfront_domain() -> str:
    return os.getenv("CLOUDFRONT_DOMAIN", "").strip()


def get_public_asset_base_url() -> str:
    cloudfront = get_cloudfront_domain()
    if cloudfront:
        return f"https://{cloudfront}"

    bucket = get_s3_bucket()
    region = get_aws_region()
    if not bucket:
        return ""
    return f"https://{bucket}.s3.{region}.amazonaws.com"


def build_public_asset_url(key: str) -> str:
    base = get_public_asset_base_url().rstrip("/")
    return f"{base}/{key.lstrip('/')}"


def get_s3_client():
    global _s3_client
    if _s3_client is None:
        kwargs = {"region_name": get_aws_region()}

        access_key = os.getenv("AWS_ACCESS_KEY_ID", "").strip()
        secret_key = os.getenv("AWS_SECRET_ACCESS_KEY", "").strip()
        session_token = os.getenv("AWS_SESSION_TOKEN", "").strip()
        if access_key and secret_key:
            kwargs["aws_access_key_id"] = access_key
            kwargs["aws_secret_access_key"] = secret_key
        if session_token:
            kwargs["aws_session_token"] = session_token

        _s3_client = boto3.client("s3", **kwargs)
    return _s3_client


def upload_bytes(
    data: bytes,
    key: str,
    content_type: str,
    *,
    cache_control: str = "public, max-age=31536000, immutable",
) -> str:
    s3 = get_s3_client()
    s3.upload_fileobj(
        BytesIO(data),
        get_s3_bucket(),
        key,
        ExtraArgs={
            "ContentType": content_type,
            "CacheControl": cache_control,
        },
    )
    return build_public_asset_url(key)


def upload_fileobj(
    fileobj: BinaryIO,
    key: str,
    content_type: str,
    *,
    cache_control: str = "public, max-age=31536000, immutable",
) -> str:
    s3 = get_s3_client()
    s3.upload_fileobj(
        fileobj,
        get_s3_bucket(),
        key,
        ExtraArgs={
            "ContentType": content_type,
            "CacheControl": cache_control,
        },
    )
    return build_public_asset_url(key)


def delete_key(key: str) -> bool:
    if not is_s3_configured():
        return False
    try:
        get_s3_client().delete_object(Bucket=get_s3_bucket(), Key=key)
        return True
    except Exception:
        logger.exception("Failed to delete S3 key %s", key)
        return False

