from __future__ import annotations

from contextlib import asynccontextmanager
import logging

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.gzip import GZipMiddleware
from starlette.status import HTTP_404_NOT_FOUND, HTTP_500_INTERNAL_SERVER_ERROR

from config import get_static_dir, templates
from middleware.cache_control import CacheControlMiddleware
from middleware.forwarded_proto import ForwardedProtoMiddleware
from middleware.security_headers import SecurityHeadersMiddleware
from routers import admin, auth, pages
from utils.content import startup_sync_policy
from utils.content_sync import sync_from_s3
from utils.storage import ensure_upload_dirs


logger = logging.getLogger(__name__)

load_dotenv()


def create_app() -> FastAPI:
    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        ensure_upload_dirs()
        policy = startup_sync_policy()
        if policy not in {"off", "disabled", "none"}:
            require_marker = policy == "guarded"
            try:
                count = sync_from_s3(require_marker=require_marker)
                if count:
                    logger.info("Synced %s content file(s) from S3", count)
            except Exception:  # pragma: no cover - startup logging only
                logger.exception("Startup S3 content sync failed")
        yield

    app = FastAPI(lifespan=lifespan)
    app.add_middleware(ForwardedProtoMiddleware)
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(GZipMiddleware, minimum_size=500)
    app.add_middleware(
        CacheControlMiddleware,
        static_cache_control="public, max-age=31536000, immutable",
        page_cache_control="public, max-age=300, stale-while-revalidate=60",
    )
    app.mount("/static", StaticFiles(directory=str(get_static_dir())), name="static")

    app.include_router(auth.router)
    app.include_router(admin.router)
    app.include_router(pages.router)

    @app.exception_handler(StarletteHTTPException)
    async def http_exception_handler(request: Request, exc: StarletteHTTPException):
        if exc.status_code == HTTP_404_NOT_FOUND:
            return templates.TemplateResponse(
                "404.html",
                {"request": request, "page_title": "Not Found", "is_edit_mode": False},
                status_code=HTTP_404_NOT_FOUND,
            )
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})

    @app.exception_handler(500)
    async def server_error_handler(request: Request, _exc: Exception):
        return templates.TemplateResponse(
            "500.html",
            {"request": request, "page_title": "Error", "is_edit_mode": False},
            status_code=HTTP_500_INTERNAL_SERVER_ERROR,
        )

    return app


app = create_app()


if __name__ == "__main__":
    import os

    import uvicorn

    port = int(os.getenv("PORT", os.getenv("APP_PORT", "8001")))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)
