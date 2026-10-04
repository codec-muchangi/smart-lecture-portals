from uuid import UUID

from app.db.client import get_supabase

COLS = (
    "id,course_id,title,description,instructions,due_at,max_marks,allow_late,published,closed,"
    "attachment_path,created_by,created_at,updated_at"
)


def _table():
    return get_supabase().table("assignments")


def insert(row: dict) -> dict:
    return _table().insert(row).execute().data[0]


def get(assignment_id: UUID | str) -> dict | None:
    rows = _table().select(COLS).eq("id", str(assignment_id)).limit(1).execute().data
    return rows[0] if rows else None


def list_for_course(
    course_id: UUID | str, *, published_only: bool, state: str, q: str | None, page: int, page_size: int
) -> tuple[list[dict], int]:
    query = _table().select(COLS, count="exact").eq("course_id", str(course_id))
    if published_only:
        query = query.is_("published", "true")
    if state == "draft":
        query = query.is_("published", "false")
    elif state == "open":
        query = query.is_("published", "true").is_("closed", "false")
    elif state == "closed":
        query = query.is_("closed", "true")
    if q:
        query = query.or_(f"title.ilike.%{q}%")
    start = (page - 1) * page_size
    res = query.order("due_at", desc=True).range(start, start + page_size - 1).execute()
    return res.data, res.count or 0


def update(assignment_id: UUID | str, changes: dict) -> dict:
    return _table().update(changes).eq("id", str(assignment_id)).execute().data[0]
