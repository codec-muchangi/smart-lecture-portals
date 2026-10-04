"""Course materials (SRS 4.5, FR-MAT-01..05, FR-LEC-04, FR-STU-04).

Business rules live here; routes stay thin.

Consistency model (Supabase Storage and PostgreSQL cannot share a transaction):
  upload : store file -> insert row; if the insert fails the stored file is removed again.
  delete : soft-delete row -> remove file -> stamp file_removed_at; a failed removal is retried by
           scripts/purge_deleted_materials.py (retention rule: the file is removed, the metadata row is kept).
"""

import logging
import uuid
from typing import BinaryIO
from uuid import UUID

from app.core.config import get_settings
from app.core.errors import NotFound, ValidationFailed
from app.core.security import assert_course_access, assert_course_lecturer, ensure_course_writable
from app.repositories import material_repository as repo
from app.schemas.common import CurrentUser
from app.schemas.material import DESCRIPTION_MAX, TITLE_MAX, TITLE_MIN
from app.services import audit_service, storage_service, upload_service
from app.services.storage_service import MATERIALS_BUCKET
from app.utils.search import safe_search

log = logging.getLogger("app.materials")


# ---------- helpers ----------
def _with_uploader_names(rows: list[dict]) -> list[dict]:
    names = repo.uploader_names(sorted({r["uploaded_by"] for r in rows}))
    return [{**r, "uploader_name": names.get(r["uploaded_by"])} for r in rows]


def _load_for_user(user: CurrentUser, material_id: UUID) -> tuple[dict, dict]:
    """Material + its course, or 404. Students additionally cannot see unpublished materials."""
    material = repo.get(material_id)
    if material is None:
        raise NotFound("Material not found")
    course = assert_course_access(user, UUID(str(material["course_id"])))
    if user.role == "student" and not material["published"]:
        raise NotFound("Material not found")
    return material, course


def _load_for_lecturer(user: CurrentUser, material_id: UUID) -> tuple[dict, dict]:
    material = repo.get(material_id)
    if material is None:
        raise NotFound("Material not found")
    course = assert_course_lecturer(user, UUID(str(material["course_id"])))
    return material, course


def _clean_title(title: str) -> str:
    title = title.strip()
    if not (TITLE_MIN <= len(title) <= TITLE_MAX):
        raise ValidationFailed("Invalid title", {"title": f"Must be {TITLE_MIN}-{TITLE_MAX} characters"})
    return title


def _clean_description(description: str | None) -> str | None:
    description = (description or "").strip() or None
    if description and len(description) > DESCRIPTION_MAX:
        raise ValidationFailed(
            "Invalid description", {"description": f"At most {DESCRIPTION_MAX} characters"}
        )
    return description


# ---------- queries ----------
def list_materials(
    user: CurrentUser, course_id: UUID, *, q: str | None, category: str | None, page: int, page_size: int
) -> dict:
    assert_course_access(user, course_id)
    rows, total = repo.list_for_course(
        course_id,
        published_only=user.role == "student",
        q=safe_search(q),
        category=category,
        page=page,
        page_size=page_size,
    )
    return {"items": _with_uploader_names(rows), "page": page, "page_size": page_size, "total": total}


def get_download(user: CurrentUser, material_id: UUID) -> dict:
    material, _ = _load_for_user(user, material_id)  # authorization happens BEFORE any URL is issued
    ttl = get_settings().signed_url_ttl_seconds
    url = storage_service.signed_download_url(
        MATERIALS_BUCKET, material["storage_path"], ttl, material["file_name"]
    )
    return {"url": url, "expires_in": ttl, "file_name": material["file_name"]}


# ---------- commands ----------
def create_material(
    user: CurrentUser,
    course_id: UUID,
    *,
    title: str,
    description: str | None,
    category: str,
    published: bool,
    file_obj: BinaryIO,
    original_name: str | None,
) -> dict:
    course = assert_course_lecturer(user, course_id)
    ensure_course_writable(course)
    title, description = _clean_title(title), _clean_description(description)
    upload = upload_service.read_and_validate(file_obj, original_name)
    data, safe_name, mime = upload.data, upload.safe_name, upload.mime_type

    material_id = str(uuid.uuid4())  # server-generated; the client never influences the storage path
    storage_path = f"{course['id']}/{material_id}/{safe_name}"
    storage_service.upload_object(MATERIALS_BUCKET, storage_path, data, mime)
    try:
        row = repo.insert(
            {
                "id": material_id,
                "course_id": str(course["id"]),
                "title": title,
                "description": description,
                "category": category,
                "storage_path": storage_path,
                "file_name": safe_name,
                "mime_type": mime,
                "file_size": len(data),
                "uploaded_by": str(user.id),
                "published": published,
            }
        )
    except Exception:
        try:  # compensate: do not leave an orphaned file behind
            storage_service.remove_object(MATERIALS_BUCKET, storage_path)
        except Exception:
            log.exception("Could not remove orphaned object %s after failed insert", storage_path)
        raise
    audit_service.record(
        user.id,
        "material.create",
        "material",
        material_id,
        new={
            "course_id": str(course["id"]),
            "title": title,
            "category": category,
            "file_name": safe_name,
            "file_size": len(data),
            "published": published,
        },
    )
    return _with_uploader_names([row])[0]


def update_material(user: CurrentUser, material_id: UUID, requested: dict) -> dict:
    material, course = _load_for_lecturer(user, material_id)
    ensure_course_writable(course)
    changes = {k: v for k, v in requested.items() if material.get(k) != v}
    if changes:
        old = {k: material.get(k) for k in changes}
        material = repo.update(material_id, changes)
        audit_service.record(user.id, "material.update", "material", material_id, old=old, new=changes)
    return _with_uploader_names([material])[0]


def delete_material(user: CurrentUser, material_id: UUID) -> None:
    material, course = _load_for_lecturer(user, material_id)
    ensure_course_writable(course)
    repo.soft_delete(material_id)
    removed = _remove_stored_file(material)
    audit_service.record(
        user.id,
        "material.delete",
        "material",
        material_id,
        old={
            "title": material["title"],
            "file_name": material["file_name"],
            "published": material["published"],
        },
        new={"storage_removed": removed},
    )


def _remove_stored_file(material: dict) -> bool:
    try:
        storage_service.remove_object(MATERIALS_BUCKET, material["storage_path"])
        repo.mark_file_removed(material["id"])
        return True
    except Exception:
        log.exception(
            "Stored file for material %s not removed; it will be retried by the purge job", material["id"]
        )
        return False


def purge_removed_files(limit: int = 100) -> tuple[int, int]:
    """Retry file removal for soft-deleted materials. Returns (removed, still_failing)."""
    ok = failed = 0
    for material in repo.pending_file_removals(limit):
        if _remove_stored_file(material):
            ok += 1
        else:
            failed += 1
    return ok, failed
