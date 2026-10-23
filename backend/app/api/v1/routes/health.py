import logging

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.db.client import get_supabase

router = APIRouter(tags=["health"])
log = logging.getLogger("app")


@router.get("/health")
def health() -> dict:
    """Liveness: the process is up. Never touches the database, so a platform can poll it freely."""
    return {"status": "ok"}


@router.get("/health/ready", response_model=None)
def ready():
    """Readiness: the database answers. A failure returns only the status, so it leaks nothing."""
    try:
        get_supabase().table("profiles").select("id").limit(1).execute()
    except Exception as exc:
        log.error("Readiness check failed: %s", type(exc).__name__)
        return JSONResponse({"status": "unavailable"}, status_code=503, headers={"Retry-After": "5"})
    return {"status": "ready"}
