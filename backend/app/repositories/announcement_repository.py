from uuid import UUID

from app.db.client import get_supabase

COLS = "id,course_id,title,body,published,published_at,created_by,created_at,updated_at"


def _table():
    return get_supabase().table("announcements")


def get(announcement_id: UUID | str) -> dict | None:
    rows = _table().select(COLS).eq("id", str(announcement_id)).limit(1).execute().data
    return rows[0] if rows else None


def list_for_course(
    course_id: UUID | str, *, published_only: bool, page: int, page_size: int
) -> tuple[list[dict], int]:
    """Students: published only (newest publication first). Lecturers: all, drafts too (newest first)."""
    query = _table().select(COLS, count="exact").eq("course_id", str(course_id))
    if published_only:
        query = query.is_("published", "true").order("published_at", desc=True)
    else:
        query = query.order("created_at", desc=True)
    start = (page - 1) * page_size
    res = query.range(start, start + page_size - 1).execute()
    return res.data, res.count or 0


def create(course_id: UUID | str, actor_id: UUID | str, title: str, body: str, publish: bool) -> dict:
    """Atomic: the announcement, its audit row and (when published) every student's notification."""
    res = (
        get_supabase()
        .rpc(
            "create_announcement",
            {
                "p_course": str(course_id),
                "p_actor": str(actor_id),
                "p_title": title,
                "p_body": body,
                "p_publish": publish,
            },
        )
        .execute()
    )
    return res.data


def update(announcement_id: UUID | str, actor_id: UUID | str, changes: dict) -> dict:
    """Atomic: the change, its audit row and (on the first publication) the students' notifications."""
    res = (
        get_supabase()
        .rpc(
            "update_announcement",
            {"p_id": str(announcement_id), "p_actor": str(actor_id), "p_changes": changes},
        )
        .execute()
    )
    return res.data
