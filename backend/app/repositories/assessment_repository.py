from uuid import UUID

from app.db.client import get_supabase
from app.utils.batching import chunked

COLS = "id,course_id,name,type,max_marks,weight,published,created_by,created_at,updated_at"
MARK_COLS = "assessment_id,student_id,mark,feedback,entered_by,entered_at,updated_at"


def _table():
    return get_supabase().table("assessments")


def insert(row: dict) -> dict:
    return _table().insert(row).execute().data[0]


def get(assessment_id: UUID | str) -> dict | None:
    rows = _table().select(COLS).eq("id", str(assessment_id)).limit(1).execute().data
    return rows[0] if rows else None


def list_for_course(
    course_id: UUID | str, *, published_only: bool, page: int, page_size: int
) -> tuple[list[dict], int]:
    query = _table().select(COLS, count="exact").eq("course_id", str(course_id))
    if published_only:
        query = query.is_("published", "true")
    start = (page - 1) * page_size
    res = query.order("created_at").range(start, start + page_size - 1).execute()
    return res.data, res.count or 0


def published_for_course(course_id: UUID | str) -> list[dict]:
    """All published assessments of a course, oldest first (a course has a handful, never thousands)."""
    return (
        _table()
        .select(COLS)
        .eq("course_id", str(course_id))
        .is_("published", "true")
        .order("created_at")
        .limit(500)
        .execute()
        .data
    )


def update(assessment_id: UUID | str, changes: dict) -> dict:
    return _table().update(changes).eq("id", str(assessment_id)).execute().data[0]


def other_weights(course_id: UUID | str, exclude_id: UUID | str | None = None) -> list[float]:
    """Weights of the course's other assessments (those that have one)."""
    query = _table().select("id,weight").eq("course_id", str(course_id)).limit(1000)
    rows = query.execute().data
    return [r["weight"] for r in rows if r["weight"] is not None and str(r["id"]) != str(exclude_id)]


def highest_mark(assessment_id: UUID | str) -> float | None:
    rows = (
        get_supabase()
        .table("assessment_marks")
        .select("mark")
        .eq("assessment_id", str(assessment_id))
        .order("mark", desc=True)
        .limit(1)
        .execute()
        .data
    )
    return float(rows[0]["mark"]) if rows else None


def marks_for_assessment(assessment_id: UUID | str, student_ids: list[str]) -> dict[str, dict]:
    """Existing marks of the given students for one assessment, keyed by student id."""
    found: dict[str, dict] = {}
    for batch in chunked(student_ids):
        rows = (
            get_supabase()
            .table("assessment_marks")
            .select(MARK_COLS)
            .eq("assessment_id", str(assessment_id))
            .in_("student_id", list(batch))
            .execute()
            .data
        )
        found.update({r["student_id"]: r for r in rows})
    return found


def marks_for_student(student_id: UUID | str, assessment_ids: list[str]) -> dict[str, dict]:
    """One student's marks for several assessments, keyed by assessment id."""
    if not assessment_ids:
        return {}
    rows = (
        get_supabase()
        .table("assessment_marks")
        .select(MARK_COLS)
        .eq("student_id", str(student_id))
        .in_("assessment_id", assessment_ids)
        .execute()
        .data
    )
    return {r["assessment_id"]: r for r in rows}


def mark_counts(assessment_ids: list[str]) -> dict[str, int]:
    """How many marks each assessment has (for the lecturer's list)."""
    if not assessment_ids:
        return {}
    rows = (
        get_supabase()
        .table("assessment_marks")
        .select("assessment_id")
        .in_("assessment_id", assessment_ids)
        .limit(100000)
        .execute()
        .data
    )
    counts: dict[str, int] = {}
    for r in rows:
        counts[r["assessment_id"]] = counts.get(r["assessment_id"], 0) + 1
    return counts


def enrolled_student_ids(course_id: UUID | str, student_ids: list[str]) -> set[str]:
    """Which of the given students are ACTIVELY enrolled in the course."""
    found: set[str] = set()
    for batch in chunked(student_ids):
        rows = (
            get_supabase()
            .table("course_enrollments")
            .select("student_id")
            .eq("course_id", str(course_id))
            .eq("status", "active")
            .in_("student_id", list(batch))
            .execute()
            .data
        )
        found.update(r["student_id"] for r in rows)
    return found


def upsert_marks(assessment_id: UUID | str, actor_id: UUID | str, rows: list[dict]) -> dict:
    """Atomic: every mark, and the audit row of each change, is written in ONE database transaction."""
    res = (
        get_supabase()
        .rpc(
            "upsert_assessment_marks",
            {"p_assessment": str(assessment_id), "p_actor": str(actor_id), "p_rows": rows},
        )
        .execute()
    )
    return res.data
