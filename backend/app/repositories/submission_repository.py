from uuid import UUID

from app.db.client import get_supabase

COLS = (
    "id,assignment_id,student_id,storage_path,file_name,file_size,submitted_at,status,mark,feedback,"
    "grade_released,graded_by,graded_at,updated_at"
)
OVERVIEW_COLS = (
    "id,assignment_id,student_id,file_name,file_size,submitted_at,status,mark,feedback,grade_released,"
    "graded_at,registration_number,full_name,email"
)


def _table():
    return get_supabase().table("submissions")


def get(submission_id: UUID | str) -> dict | None:
    rows = _table().select(COLS).eq("id", str(submission_id)).limit(1).execute().data
    return rows[0] if rows else None


def get_for_student(assignment_id: UUID | str, student_id: UUID | str) -> dict | None:
    rows = (
        _table()
        .select(COLS)
        .eq("assignment_id", str(assignment_id))
        .eq("student_id", str(student_id))
        .limit(1)
        .execute()
        .data
    )
    return rows[0] if rows else None


def insert(row: dict) -> dict:
    return _table().insert(row).execute().data[0]


def update(submission_id: UUID | str, changes: dict) -> dict:
    return _table().update(changes).eq("id", str(submission_id)).execute().data[0]


def for_student(student_id: UUID | str, assignment_ids: list[str]) -> dict[str, dict]:
    """The student's own submissions for a set of assignments, keyed by assignment id."""
    if not assignment_ids:
        return {}
    rows = (
        _table()
        .select(COLS)
        .eq("student_id", str(student_id))
        .in_("assignment_id", assignment_ids)
        .execute()
        .data
    )
    return {r["assignment_id"]: r for r in rows}


def statuses_for_assignment(assignment_id: UUID | str) -> list[str]:
    rows = _table().select("status").eq("assignment_id", str(assignment_id)).execute().data
    return [r["status"] for r in rows]


def highest_mark(assignment_id: UUID | str) -> float | None:
    rows = (
        _table()
        .select("mark")
        .eq("assignment_id", str(assignment_id))
        .not_.is_("mark", "null")
        .order("mark", desc=True)
        .limit(1)
        .execute()
        .data
    )
    return float(rows[0]["mark"]) if rows else None


def list_for_assignment(
    assignment_id: UUID | str, *, status: str, q: str | None, page: int, page_size: int
) -> tuple[list[dict], int]:
    query = (
        get_supabase()
        .table("v_submission_overview")
        .select(OVERVIEW_COLS, count="exact")
        .eq("assignment_id", str(assignment_id))
    )
    if status != "all":
        query = query.eq("status", status)
    if q:
        query = query.or_(f"full_name.ilike.%{q}%,registration_number.ilike.%{q}%")
    start = (page - 1) * page_size
    res = query.order("submitted_at", desc=True).range(start, start + page_size - 1).execute()
    return res.data, res.count or 0
