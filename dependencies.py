from __future__ import annotations

import hashlib
import hmac
import ipaddress
import os

from fastapi import HTTPException, Request

from utils.content import SiteSettings, load_settings


COOKIE_NAME = "portfolio_kit_edit"
COOKIE_MAX_AGE = 60 * 60 * 24 * 30


def get_edit_token() -> str:
    return os.getenv("EDIT_TOKEN", "").strip()


def get_cookie_secret() -> str:
    return os.getenv("COOKIE_SECRET", "").strip() or get_edit_token()


def _env_flag(value: str | None, default: bool) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def localhost_bypass_enabled() -> bool:
    return _env_flag(
        os.getenv("LOCALHOST_EDIT_BYPASS"),
        default=not bool(get_edit_token()),
    )


def sign_cookie(payload: str) -> str:
    secret = get_cookie_secret().encode("utf-8")
    signature = hmac.new(secret, payload.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{payload}.{signature}"


def verify_cookie(value: str) -> str | None:
    if "." not in value:
        return None

    payload, signature = value.rsplit(".", 1)
    secret = get_cookie_secret().encode("utf-8")
    expected = hmac.new(secret, payload.encode("utf-8"), hashlib.sha256).hexdigest()
    if hmac.compare_digest(signature, expected):
        return payload
    return None


def _is_loopback(value: str | None) -> bool:
    if not value:
        return False

    candidate = value.strip().strip('"').strip("[]")
    if candidate.lower() == "localhost":
        return True

    try:
        return ipaddress.ip_address(candidate).is_loopback
    except ValueError:
        return False


def _is_local_request(request: Request) -> bool:
    client_host = request.client.host if request.client else None
    if not _is_loopback(client_host):
        return False

    xff = request.headers.get("x-forwarded-for")
    if xff and not _is_loopback(xff.split(",", 1)[0].strip()):
        return False

    x_real_ip = request.headers.get("x-real-ip")
    if x_real_ip and not _is_loopback(x_real_ip):
        return False

    return True


def is_edit_mode(request: Request) -> bool:
    if localhost_bypass_enabled() and _is_local_request(request):
        return True

    token = get_edit_token()
    secret = get_cookie_secret()
    if not token or not secret:
        return False

    cookie = request.cookies.get(COOKIE_NAME, "")
    return verify_cookie(cookie) == "editor"


def require_edit_mode(request: Request) -> None:
    if not is_edit_mode(request):
        raise HTTPException(status_code=403, detail="Not authorized")


def get_site_settings() -> SiteSettings:
    return load_settings()
