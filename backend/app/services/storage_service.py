"""Thin wrapper over Supabase Storage. All buckets are private; downloads use short-lived signed URLs that are
issued only after the caller's course access has been checked (SRS 12, 14, NFR-SEC-03)."""

import logging

from app.core.errors import NotFound, ServiceUnavailable
from app.db.client import get_supabase

log = logging.getLogger("app.storage")
MATERIALS_BUCKET = "materials"
SUBMISSIONS_BUCKET = "submissions"


def upload_object(bucket: str, path: str, data: bytes, content_type: str) -> None:
    """Store a new object. Never overwrites (upsert=false). Failure means nothing was stored."""
    try:
        get_supabase().storage.from_(bucket).upload(
            path, data, {"content-type": content_type, "upsert": "false"}
        )
    except Exception as exc:
        log.exception("Storage upload failed for %s/%s", bucket, path)
        raise ServiceUnavailable("File storage is unavailable. Please try again.") from exc


def remove_object(bucket: str, path: str) -> None:
    """Delete an object. Raises on failure so the caller can decide how to recover."""
    get_supabase().storage.from_(bucket).remove([path])


def signed_download_url(bucket: str, path: str, expires_in: int, download_name: str) -> str:
    """Short-lived URL that forces a download (Content-Disposition: attachment), so uploaded files are never
    rendered inline in the browser. `download_name` must already be URL-safe (see sanitize_filename)."""
    try:
        result = (
            get_supabase()
            .storage.from_(bucket)
            .create_signed_url(path, expires_in, {"download": download_name})
        )
    except Exception as exc:
        if "not found" in str(exc).lower():
            log.error("Stored object missing for %s/%s", bucket, path)
            raise NotFound("The file is no longer available") from exc
        log.exception("Signed URL creation failed for %s/%s", bucket, path)
        raise ServiceUnavailable("File storage is unavailable. Please try again.") from exc
    return result["signedURL"]
