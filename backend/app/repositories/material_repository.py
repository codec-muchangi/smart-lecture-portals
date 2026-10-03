from datetime import UTC, datetime
from uuid import UUID

from app.db.client import get_supabase

COLS = (
    "id,course_id,title,description,category,storage_path,file_name,mime_type,file_size,"
    "uploaded_by,published,created_at,updated_at,deleted_at,file_removed_at"
)


def _table():
    return get_supabase().table("materials")


def insert(row: dict) -> dict:
    return _table().insert(row).execute().data[0]


def get(material_id: UUID | str) -> dict | None:
    """A live (not soft-deleted) material, or None."""
    rows = _table().select(COLS).eq("id", str(material_id)).is_("deleted_at", "null").limit(1).execute().data
    return rows[0] if rows else None


def list_for_course(
    course_id: UUID | str,
    *,
    published_only: bool,
    q: str | None,
    category: str | None,
    page: int,
    page_size: int,
) -> tuple[list[dict], int]:
    query = _table().select(COLS, count="exact").eq("course_id", str(course_id)).is_("deleted_at", "null")
    if published_only:
        query = query.is_("published", "true")
    if category:
        query = query.eq("category", category)
    if q:
        query = query.or_(f"title.ilike.%{q}%,description.ilike.%{q}%")
    start = (page - 1) * page_size
    res = query.order("created_at", desc=True).range(start, start + page_size - 1).execute()
    return res.data, res.count or 0


def update(material_id: UUID | str, changes: dict) -> dict:
    return _table().update(changes).eq("id", str(material_id)).execute().data[0]


def soft_delete(material_id: UUID | str) -> dict:
    changes = {"deleted_at": datetime.now(UTC).isoformat(), "published": False}
    return _table().update(changes).eq("id", str(material_id)).execute().data[0]


def mark_file_removed(material_id: UUID | str) -> None:
    _table().update({"file_removed_at": datetime.now(UTC).isoformat()}).eq("id", str(material_id)).execute()


def pending_file_removals(limit: int = 100) -> list[dict]:
    """Soft-deleted materials whose stored file has not yet been removed (retry queue)."""
    return (
        _table()
        .select(COLS)
        .not_.is_("deleted_at", "null")
        .is_("file_removed_at", "null")
        .limit(limit)
        .execute()
        .data
    )


def uploader_names(ids: list[str]) -> dict[str, str]:
    if not ids:
        return {}
    rows = get_supabase().table("profiles").select("id,full_name").in_("id", ids).execute().data
    return {r["id"]: r["full_name"] for r in rows}
