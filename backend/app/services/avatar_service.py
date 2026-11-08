"""Profile photos: upload, replace and remove.

Rules (same spirit as materials/submissions):
- The file TYPE is decided by its first bytes (JPEG / PNG / WebP), never by the
  client's filename or Content-Type, so a renamed .exe is rejected.
- The storage path is generated here: <user_id>/<random>.<ext>. A new upload always
  gets a new address, so browsers never show a stale cached photo.
- Order is upload -> save to DB -> delete the old file. If the DB save fails the new
  file is removed, so a failure never loses the user's current photo.
"""

import logging
import uuid

from app.core.errors import FileTooLarge, FileTypeNotAllowed, NotFound, ValidationFailed
from app.repositories import profile_repository as repo
from app.schemas.common import CurrentUser
from app.services import audit_service, profile_service, storage_service

log = logging.getLogger("app.avatar")

MAX_AVATAR_MB = 2
MAX_AVATAR_BYTES = MAX_AVATAR_MB * 1024 * 1024


def detect_image_type(data: bytes) -> tuple[str, str] | None:
    """Return (extension, mime) from the file signature, or None if not allowed."""
    if data.startswith(b"\xff\xd8\xff"):
        return "jpg", "image/jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png", "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp", "image/webp"
    return None


def _own_object_path(url: str | None, user: CurrentUser) -> str | None:
    """Storage path of a photo WE stored for this user, else None (old links are left alone)."""
    if not url:
        return None
    marker = f"/storage/v1/object/public/{storage_service.AVATARS_BUCKET}/"
    if marker not in url:
        return None
    path = url.split(marker, 1)[1].split("?", 1)[0]
    return path if path.startswith(f"{user.id}/") else None


def _discard(path: str) -> None:
    """Best-effort delete. A leftover file is harmless, so never fail the request."""
    try:
        storage_service.remove_object(storage_service.AVATARS_BUCKET, path)
    except Exception:
        log.warning("Could not delete avatar object %s", path, exc_info=True)


def set_avatar(user: CurrentUser, data: bytes) -> dict:
    if not data:
        raise ValidationFailed("The uploaded file is empty", {"file": "Empty file"})
    if len(data) > MAX_AVATAR_BYTES:
        raise FileTooLarge(f"The photo is larger than {MAX_AVATAR_MB} MB", {"max_mb": MAX_AVATAR_MB})
    kind = detect_image_type(data)
    if kind is None:
        raise FileTypeNotAllowed(
            "Use a JPEG, PNG or WebP photo",
            {"allowed_types": ["jpg", "png", "webp"], "file": "Not a JPEG, PNG or WebP image"},
        )
    ext, mime = kind

    current = repo.get_profile(user.id)
    if current is None:
        raise NotFound("Profile not found")

    bucket = storage_service.AVATARS_BUCKET
    path = f"{user.id}/{uuid.uuid4().hex}.{ext}"
    storage_service.upload_object(bucket, path, data, mime)
    try:
        url = storage_service.public_url(bucket, path)
        repo.update_profile(user.id, {"avatar_url": url})
    except Exception:
        _discard(path)
        raise

    old = _own_object_path(current.get("avatar_url"), user)
    if old and old != path:
        _discard(old)

    audit_service.record(
        user.id,
        "profile.update",
        "profile",
        user.id,
        old={"avatar": "set" if current.get("avatar_url") else "none"},
        new={"avatar": "uploaded"},
    )
    return profile_service.get_me(user)


def clear_avatar(user: CurrentUser) -> dict:
    current = repo.get_profile(user.id)
    if current is None:
        raise NotFound("Profile not found")
    if not current.get("avatar_url"):
        return profile_service.get_me(user)

    repo.update_profile(user.id, {"avatar_url": None})
    old = _own_object_path(current.get("avatar_url"), user)
    if old:
        _discard(old)
    audit_service.record(
        user.id,
        "profile.update",
        "profile",
        user.id,
        old={"avatar": "set"},
        new={"avatar": "removed"},
    )
    return profile_service.get_me(user)
