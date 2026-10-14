from uuid import UUID

from app.db.client import get_supabase
from app.utils.batching import chunked

SESSION_COLS = "id,course_id,session_date,start_time,end_time,topic,created_by,created_at"
RECORD_COLS = "id,session_id,student_id,status,marked_at,marked_by,note"
MAX_ROWS = 100000  # a session has a class-worth of records; a course a semester-worth of sessions


def _sessions():
    return get_supabase().table("attendance_sessions")


def _records():
    return get_supabase().table("attendance_records")


# ---------- sessions ----------
def insert_session(row: dict) -> dict:
    return _sessions().insert(row).execute().data[0]


def get_session(session_id: UUID | str) -> dict | None:
    rows = _sessions().select(SESSION_COLS).eq("id", str(session_id)).limit(1).execute().data
    return rows[0] if rows else None


def find_duplicate(course_id: UUID | str, session_date: str, start_time: str) -> dict | None:
    rows = (
        _sessions()
        .select(SESSION_COLS)
        .eq("course_id", str(course_id))
        .eq("session_date", session_date)
        .eq("start_time", start_time)
        .limit(1)
        .execute()
        .data
    )
    return rows[0] if rows else None


def list_sessions(course_id: UUID | str, *, page: int, page_size: int) -> tuple[list[dict], int]:
    """Newest first (date, then start time)."""
    start = (page - 1) * page_size
    res = (
        _sessions()
        .select(SESSION_COLS, count="exact")
        .eq("course_id", str(course_id))
        .order("session_date", desc=True)
        .order("start_time", desc=True)
        .range(start, start + page_size - 1)
        .execute()
    )
    return res.data, res.count or 0


def all_sessions(course_id: UUID | str) -> list[dict]:
    return (
        _sessions()
        .select(SESSION_COLS)
        .eq("course_id", str(course_id))
        .order("session_date", desc=True)
        .order("start_time", desc=True)
        .limit(MAX_ROWS)
        .execute()
        .data
    )


# ---------- records ----------
def records_for_session(session_id: UUID | str) -> list[dict]:
    return _records().select(RECORD_COLS).eq("session_id", str(session_id)).limit(MAX_ROWS).execute().data


def records_for_students(session_id: UUID | str, student_ids: list[str]) -> dict[str, dict]:
    """The session's records of the given students, keyed by student id."""
    found: dict[str, dict] = {}
    for batch in chunked(student_ids):
        rows = (
            _records()
            .select(RECORD_COLS)
            .eq("session_id", str(session_id))
            .in_("student_id", list(batch))
            .execute()
            .data
        )
        found.update({r["student_id"]: r for r in rows})
    return found


def records_for_student(student_id: UUID | str, session_ids: list[str]) -> list[dict]:
    """One student's records within the given sessions."""
    found: list[dict] = []
    for batch in chunked(session_ids):
        found += (
            _records()
            .select(RECORD_COLS)
            .eq("student_id", str(student_id))
            .in_("session_id", list(batch))
            .execute()
            .data
        )
    return found


def record_counts(session_ids: list[str]) -> dict[str, int]:
    """How many records each session has (for the lecturer's list)."""
    counts: dict[str, int] = {}
    for batch in chunked(session_ids):
        rows = _records().select("session_id").in_("session_id", list(batch)).limit(MAX_ROWS).execute().data
        for r in rows:
            counts[r["session_id"]] = counts.get(r["session_id"], 0) + 1
    return counts


def active_student_ids(course_id: UUID | str) -> set[str]:
    rows = (
        get_supabase()
        .table("course_enrollments")
        .select("student_id")
        .eq("course_id", str(course_id))
        .eq("status", "active")
        .limit(MAX_ROWS)
        .execute()
        .data
    )
    return {r["student_id"] for r in rows}


def upsert_records(session_id: UUID | str, actor_id: UUID | str, rows: list[dict]) -> dict:
    """Atomic: every record, and the audit row of each change, is written in ONE database transaction."""
    res = (
        get_supabase()
        .rpc(
            "upsert_attendance_records",
            {"p_session": str(session_id), "p_actor": str(actor_id), "p_rows": rows},
        )
        .execute()
    )
    return res.data
