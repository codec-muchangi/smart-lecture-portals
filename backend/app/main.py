import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.gzip import GZipMiddleware

from app.api.v1.router import api_router
from app.api.v1.routes.health import router as health_router
from app.core.config import get_settings
from app.core.errors import register_error_handlers
from app.core.logging_config import configure_logging
from app.core.middleware import RequestContextMiddleware, SecurityHeadersMiddleware
from app.core.upload_limit import UploadSizeLimitMiddleware

log = logging.getLogger("app")

# Only what the front end really sends: no wildcard headers or methods.
CORS_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
CORS_HEADERS = ["Authorization", "Content-Type", "X-Request-ID"]
CORS_EXPOSE = ["X-Unread-Count", "X-Request-ID", "Retry-After"]


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level)
    problems = settings.problems()
    if problems and settings.is_production:
        # Refuse to start rather than run production with a development-grade configuration.
        raise RuntimeError("Unsafe production configuration: " + "; ".join(problems))
    for problem in problems:
        log.warning("Configuration notice (fatal in production): %s", problem)

    docs = not settings.is_production  # the API description is not published in production
    app = FastAPI(
        title="Smart Lecture Portal API",
        version="1.0.0",
        docs_url="/docs" if docs else None,
        redoc_url="/redoc" if docs else None,
        openapi_url="/openapi.json" if docs else None,
    )
    # Starlette wraps the LAST middleware added around all the others, so the order below is inside-out:
    # body limits, request context (id, access log, 500 handling), security headers (so even a 500 carries
    # them), compression, then CORS
    # outermost: even early rejections ("file too large") and 500s carry CORS headers, so the browser can read
    # the JSON error.
    app.add_middleware(
        UploadSizeLimitMiddleware,
        max_file_bytes=lambda: get_settings().max_upload_bytes,
        max_json_bytes=lambda: get_settings().max_json_bytes,
    )
    app.add_middleware(RequestContextMiddleware, slow_seconds=lambda: get_settings().slow_request_seconds)
    app.add_middleware(
        SecurityHeadersMiddleware,
        production=lambda: get_settings().is_production,
        hsts_max_age=lambda: get_settings().hsts_max_age_seconds,
    )
    app.add_middleware(GZipMiddleware, minimum_size=1024)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=False,  # the API uses Authorization headers, never cookies
        allow_methods=CORS_METHODS,
        allow_headers=CORS_HEADERS,
        expose_headers=CORS_EXPOSE,
        max_age=600,
    )
    register_error_handlers(app)
    app.include_router(health_router)
    app.include_router(api_router, prefix="/api/v1")
    return app


app = create_app()
