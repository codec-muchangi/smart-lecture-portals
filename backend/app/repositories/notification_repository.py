from uuid import UUID

from app.db.client import get_supabase
from app.utils.batching import chunked

COLS = "id,user_id,type,title,message,link,is_read,created_at,read_at"


def _table():
    return get_supabase().table("notifications")


def list_for_user(
    user_id: UUID | str, *, is_read: bool | None, page: int, page_size: int
) -> tuple[list[dict], int]:
    """The caller's own notifications, newest first."""
    query = _table().select(COLS, count="exact").eq("user_id", str(user_id))
    if is_read is not None:
        query = query.is_("is_read", "true" if is_read else "false")
    start = (page - 1) * page_size
    res = query.order("created_at", desc=True).range(start, start + page_size - 1).execute()
    return res.data, res.count or 0


def count_unread(user_id: UUID | str) -> int:
    res = (
        _table()
        .select("id", count="exact")
        .eq("user_id", str(user_id))
        .is_("is_read", "false")
        .limit(1)
        .execute()
    )
    return res.count or 0


def get_for_user(notification_id: UUID | str, user_id: UUID | str) -> dict | None:
    """Only ever the caller's own row: another user's notification looks like a missing one."""
    rows = (
        _table()
        .select(COLS)
        .eq("id", str(notification_id))
        .eq("user_id", str(user_id))
        .limit(1)
        .execute()
        .data
    )
    return rows[0] if rows else None


def mark_read(notification_id: UUID | str, user_id: UUID | str, read_at: str) -> dict:
    return (
        _table()
        .update({"is_read": True, "read_at": read_at})
        .eq("id", str(notification_id))
        .eq("user_id", str(user_id))
        .execute()
        .data[0]
    )


def mark_all_read(user_id: UUID | str, read_at: str) -> int:
    rows = (
        _table()
        .update({"is_read": True, "read_at": read_at})
        .eq("user_id", str(user_id))
        .is_("is_read", "false")
        .execute()
        .data
    )
    return len(rows)


# ---------- creating notifications for events (FR-NOT-03) ----------
def notify_course(course_id: UUID | str, type_: str, title: str, message: str, link: str | None) -> int:
    """One notification per actively enrolled student, in one database transaction."""
    res = (
        get_supabase()
        .rpc(
            "notify_course_students",
            {
                "p_course": str(course_id),
                "p_type": type_,
                "p_title": title,
                "p_message": message,
                "p_link": link,
            },
        )
        .execute()
    )
    return int(res.data or 0)


def insert_many(user_ids: list[str], type_: str, title: str, message: str, link: str | None) -> int:
    n = 0
    for batch in chunked(user_ids, 200):
        rows = [
            {"user_id": uid, "type": type_, "title": title, "message": message, "link": link} for uid in batch
        ]
        n += len(_table().insert(rows).execute().data)
    return n
