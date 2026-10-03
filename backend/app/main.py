from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import api_router
from app.api.v1.routes.health import router as health_router
from app.core.config import get_settings
from app.core.errors import register_error_handlers
from app.core.upload_limit import UploadSizeLimitMiddleware


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="Smart Lecture Portal API",
        version="1.0.0",
        docs_url="/docs" if settings.environment != "production" else None,
    )
    # Starlette wraps the LAST middleware added around all the others, so CORS goes last (outermost): even the
    # early "file too large" rejection then carries CORS headers and the browser can read the JSON error.
    app.add_middleware(UploadSizeLimitMiddleware, max_file_bytes=lambda: get_settings().max_upload_bytes)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    register_error_handlers(app)
    app.include_router(health_router)
    app.include_router(api_router, prefix="/api/v1")
    return app


app = create_app()
